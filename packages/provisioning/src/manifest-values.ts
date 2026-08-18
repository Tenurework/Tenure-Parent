/**
 * GE-100-002 — "Separate confirmed values, defaults, optional values,
 * externally required values, secret references, and forbidden placeholders."
 *
 * `validateManifest` answers one question: is this manifest legal? It does not
 * answer the question an operator actually asks in front of a plan — *which of
 * these did I decide, and which is the engine standing in for me?* Those are
 * different facts and, until this existed, they were the same fact: a manifest
 * with `configuration: {}` and a manifest whose every value had been chosen
 * deliberately rendered identically, and a manifest waiting on a secret nobody
 * outside this engine had put in place rendered as complete.
 *
 * So every value gets a KIND, and the kinds are not decorations:
 *
 *   * `confirmed` — somebody supplied it. It is a decision, and it is fixed.
 *   * `default` — nobody supplied it and something stands in. Not a decision.
 *     Reading a default as a decision is how a tenant ends up in a region
 *     nobody chose.
 *   * `optional` — nobody supplied it, nothing stands in, and nothing needs it.
 *     Different from `default`: there is no value at all here, and a plan that
 *     shows a blank has said something true.
 *   * `externally-required` — this engine cannot produce it and no default can
 *     stand in. Somebody outside the composition has to act before provisioning
 *     can use it. A manifest carrying one of these is INCOMPLETE by design, and
 *     the plan has to say who is being waited on rather than showing a gap.
 *   * `secret-reference` — a pointer. The value lives in Secrets Manager and
 *     must never be here (`validateManifest` already refuses one that is).
 *   * `forbidden-placeholder` — a value shaped like a stand-in somebody meant
 *     to replace. `<your-domain>`, `TODO`, `changeme`, `example.com`. These are
 *     REFUSED, not reported: a placeholder that reaches provisioning becomes a
 *     DNS record, a bucket name or an invitation address, and the failure
 *     surfaces as a tenant nobody can sign into rather than as a bad field.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * No clock, no environment, no random source. The same manifest classifies the
 * same way on every machine, which is what lets the classification be part of
 * what a plan digest covers.
 */

import type { ManifestProblem, TenantManifest } from "./manifest"

/** The six kinds the requirement names, in the order it names them. */
export const VALUE_KINDS = [
  "confirmed",
  "default",
  "optional",
  "externally-required",
  "secret-reference",
  "forbidden-placeholder",
] as const

export type ValueKind = (typeof VALUE_KINDS)[number]

/**
 * Who can produce a field's value.
 *
 * The axis that decides `default` from `externally-required`, and it is not a
 * judgement call: `platform` means this engine holds a value it can use when
 * nobody supplies one; `external` means it does not and cannot.
 */
export type ValueSource = "operator" | "platform" | "external"

export interface FieldSpec {
  field: string
  /** Whether provisioning cannot proceed without a value. */
  required: boolean
  source: ValueSource
  /**
   * What stands in when nobody supplies it, in an operator's words.
   *
   * Present exactly when `source` is `platform`. A field with no stand-in and
   * no supplied value is `optional` when it is not required, and a problem when
   * it is — never a silent empty.
   */
  standsIn?: string
  /** Who outside this engine has to act. Present exactly when `source` is `external`. */
  suppliedBy?: string
}

/**
 * Every field of a manifest, and where its value can come from.
 *
 * A table rather than a chain of `if`s, because the whole value here is that
 * the list is READABLE: a field missing from this table is unclassified, and
 * `classifyManifestValues` reports that as its own finding rather than
 * defaulting it to `confirmed` — which would make a new manifest field
 * invisible on every plan until somebody noticed.
 */
export const MANIFEST_FIELD_SPECS: readonly FieldSpec[] = [
  { field: "manifestVersion", required: true, source: "platform", standsIn: "the version this engine writes" },
  { field: "slug", required: true, source: "operator" },
  { field: "legalName", required: true, source: "operator" },
  { field: "displayName", required: true, source: "operator" },
  { field: "blueprintId", required: true, source: "operator" },
  { field: "archetype", required: false, source: "operator" },
  { field: "modules", required: true, source: "operator" },
  {
    field: "entitlements",
    required: false,
    source: "platform",
    standsIn: "the plan's own entitlement set",
  },
  { field: "region", required: true, source: "operator" },
  { field: "isolation", required: true, source: "operator" },
  { field: "coexistence", required: true, source: "operator" },
  { field: "systemOfRecord", required: true, source: "operator" },
  { field: "objectAuthority", required: false, source: "operator" },
  {
    field: "configuration",
    required: false,
    source: "platform",
    standsIn: "the blueprint's and the platform's resolved values",
  },
  {
    field: "secretRefs",
    required: false,
    source: "external",
    suppliedBy:
      "whoever holds the credential — the value behind each reference has to exist in Secrets " +
      "Manager before provisioning reads it, and this engine cannot put it there",
  },
  { field: "initialAdminEmail", required: true, source: "operator" },
  { field: "notes", required: false, source: "operator" },
]

/**
 * A stand-in somebody meant to replace, and why it is one.
 *
 * Whole-token or structural matches only. A substring rule would refuse
 * `Todos College` for containing `todo`, and a validator that refuses real
 * names is one that gets switched off.
 */
export interface PlaceholderShape {
  id: string
  why: string
  test: (value: string) => boolean
}

const TOKEN = (words: readonly string[]) => {
  const set = new Set(words.map((w) => w.toLowerCase()))
  return (value: string) =>
    value
      .split(/[\s_./:-]+/)
      .filter(Boolean)
      .some((token) => set.has(token.toLowerCase()))
}

export const PLACEHOLDER_SHAPES: readonly PlaceholderShape[] = [
  {
    id: "angle-template",
    why: "`<...>` is a template slot. Provisioning would create a resource literally named that.",
    test: (v) => /<[^<>]+>/.test(v),
  },
  {
    id: "brace-template",
    why: "`{{...}}` is an unrendered template. Something was supposed to substitute it and did not.",
    test: (v) => /\{\{[^}]*\}\}|\$\{[^}]*\}/.test(v),
  },
  {
    id: "shell-substitution",
    why: "`$VAR` is a shell variable that was never expanded; the manifest carries the name, not the value.",
    test: (v) => /\$[A-Za-z_][A-Za-z0-9_]*/.test(v),
  },
  {
    id: "stand-in-word",
    why: "A word that means `somebody will fill this in later`. Nobody did.",
    // Deliberately short and unambiguous. `test`, `example`, `sample` and
    // `none` are NOT here: this repository uses RFC 2606 reserved names
    // (`admin@simon.example`, `ose@example.invalid`) on purpose, precisely so a
    // fixture address can never resolve, and a rule that refused them would be
    // refusing the convention rather than catching a mistake.
    test: TOKEN([
      "todo",
      "tbd",
      "tba",
      "fixme",
      "xxx",
      "changeme",
      "replaceme",
      "placeholder",
      "lorem",
      "ipsum",
      "asdf",
      "qwerty",
    ]),
  },
  {
    id: "documentation-domain",
    why:
      "`example.com`, `example.org`, `example.net` and `localhost` are the addresses documentation " +
      "uses. They resolve to nothing this tenant owns, so an invitation sent to one is never read.",
    // Narrower than RFC 2606 on purpose — see `stand-in-word` above. These four
    // are the ones that appear in copied-and-pasted documentation; the reserved
    // TLDs are what this repository uses deliberately.
    test: (v) => /(^|[@.])(example\.(com|org|net)|localhost)(\/|$|\b)/i.test(v),
  },
]

/**
 * The reason a value is a placeholder, or null.
 *
 * Returns the FIRST shape that matches rather than all of them: the operator
 * has to change the value either way, and listing four reasons for one field
 * buries the field.
 */
export function placeholderReason(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  for (const shape of PLACEHOLDER_SHAPES) {
    if (shape.test(trimmed)) return `${shape.id}: ${shape.why}`
  }
  return null
}

/**
 * Fields whose free text is not consumed as a value.
 *
 * `notes` is prose printed on a plan and read by a person. "TODO: ask legal
 * about the retention clause" is a genuine note, and refusing it would train
 * operators to stop writing notes — which costs more than it saves, because
 * nothing downstream ever reads this string as a name, an address or an id.
 */
const PROSE_FIELDS: ReadonlySet<string> = new Set(["notes"])

/**
 * Every string in a manifest, with the path that reaches it.
 *
 * Walks nested objects and arrays, because `configuration` is an arbitrary
 * overlay and a placeholder three levels down is still a placeholder that
 * reaches a resource name.
 */
function* strings(value: unknown, path: string): Generator<{ path: string; value: string }> {
  if (typeof value === "string") {
    yield { path, value }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`)
    return
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield* strings(v, path ? `${path}.${k}` : k)
    }
  }
}

/**
 * Placeholders, as manifest problems.
 *
 * Wired into `validateManifest` rather than offered beside it. A refusal a
 * caller has to remember to ask for is one that is asked for on the path
 * somebody tested and not on the path somebody added last week.
 */
export function placeholderProblems(manifest: TenantManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = []
  for (const { path, value } of strings(manifest, "")) {
    const root = path.split(/[.[]/)[0]
    if (PROSE_FIELDS.has(root)) continue
    const reason = placeholderReason(value)
    if (reason) {
      problems.push({
        field: path,
        reason: "forbidden-placeholder",
        detail:
          `"${value}" is a stand-in, not a value. ${reason} A placeholder that reaches ` +
          `provisioning becomes a real resource name, a real DNS record or a real invitation, ` +
          `and the failure surfaces as a tenant nobody can sign into rather than as a bad field.`,
      })
    }
  }
  return problems
}

export interface ClassifiedValue {
  field: string
  kind: ValueKind
  /** The sentence a plan prints beside the field. Never a restatement of `kind`. */
  detail: string
}

export interface ValueClassification {
  values: readonly ClassifiedValue[]
  /** Field names by kind, so a caller can count without filtering. */
  byKind: Readonly<Record<ValueKind, readonly string[]>>
  /**
   * Fields present on the manifest that no spec describes.
   *
   * Reported rather than assumed `confirmed`. A field added to `TenantManifest`
   * and not to `MANIFEST_FIELD_SPECS` is one nobody has decided the provenance
   * of, and silently calling it a decision is exactly the unrecorded assumption
   * this module exists to delete.
   */
  unclassified: readonly string[]
  /**
   * The one-line answer for a plan.
   *
   * Assembled here rather than by each caller so two surfaces cannot describe
   * the same manifest differently.
   */
  summary: string
}

/** Whether a manifest actually carries a value for a field. */
function supplied(manifest: TenantManifest, field: string): boolean {
  const value = (manifest as unknown as Record<string, unknown>)[field]
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as object).length > 0
  return true
}

/**
 * Separate the six kinds, for one manifest.
 *
 * `secretRefs` is expanded entry by entry rather than reported as one field:
 * the whole point of the kind is that each reference is a separate outside
 * dependency, and "secretRefs: externally-required" tells an operator nothing
 * about which credential is missing.
 */
export function classifyManifestValues(manifest: TenantManifest): ValueClassification {
  const values: ClassifiedValue[] = []
  const placeholderFields = new Set(placeholderProblems(manifest).map((p) => p.field.split(/[.[]/)[0]))

  for (const spec of MANIFEST_FIELD_SPECS) {
    if (placeholderFields.has(spec.field)) {
      values.push({
        field: spec.field,
        kind: "forbidden-placeholder",
        detail: "Carries a stand-in somebody meant to replace. Refused by validateManifest.",
      })
      continue
    }

    if (spec.field === "secretRefs") {
      const refs = Object.entries(manifest.secretRefs ?? {})
      if (refs.length === 0) {
        values.push({
          field: "secretRefs",
          kind: "optional",
          detail: "No external credential is referenced. Correct for a tenant with no integrations.",
        })
      }
      for (const [name, ref] of refs) {
        values.push({
          field: `secretRefs.${name}`,
          kind: "secret-reference",
          detail: `Points at ${ref}. The value is never in the manifest.`,
        })
        values.push({
          field: `secretRefs.${name}:value`,
          kind: "externally-required",
          detail:
            `${spec.suppliedBy}. Until it exists, provisioning resolves ${ref} to nothing and the ` +
            `step that needs it fails rather than proceeding with a blank.`,
        })
      }
      continue
    }

    if (supplied(manifest, spec.field)) {
      values.push({
        field: spec.field,
        kind: "confirmed",
        detail:
          spec.source === "platform"
            ? `Supplied, so the stand-in (${spec.standsIn}) does not apply.`
            : "Supplied by the operator composing this tenant.",
      })
      continue
    }

    if (spec.source === "platform") {
      values.push({
        field: spec.field,
        kind: "default",
        detail: `Nobody chose this. ${spec.standsIn} stands in.`,
      })
      continue
    }

    if (spec.source === "external") {
      values.push({
        field: spec.field,
        kind: "externally-required",
        detail: spec.suppliedBy ?? "Supplied from outside this engine.",
      })
      continue
    }

    values.push({
      field: spec.field,
      kind: "optional",
      // A required operator field with nothing in it is not "optional" — it is a
      // problem, and `validateManifest` is what says so. Saying it twice, in two
      // vocabularies, is how two surfaces come to disagree about what is wrong.
      detail: spec.required
        ? "Required and absent. validateManifest refuses this manifest; see its problems."
        : "Not supplied, nothing stands in, and nothing needs it.",
    })
  }

  const known = new Set(MANIFEST_FIELD_SPECS.map((s) => s.field))
  const unclassified = Object.keys(manifest as unknown as Record<string, unknown>)
    .filter((k) => !known.has(k))
    .sort()

  const byKind = Object.fromEntries(
    VALUE_KINDS.map((kind) => [kind, values.filter((v) => v.kind === kind).map((v) => v.field)]),
  ) as unknown as Record<ValueKind, readonly string[]>

  const parts: string[] = []
  const count = (kind: ValueKind, noun: string) => {
    const n = byKind[kind].length
    if (n > 0) parts.push(`${n} ${noun}${n === 1 ? "" : "s"}`)
  }
  count("confirmed", "confirmed value")
  count("default", "default")
  count("optional", "optional value")
  count("externally-required", "value that has to come from outside")
  count("secret-reference", "secret reference")
  count("forbidden-placeholder", "forbidden placeholder")

  return {
    values,
    byKind,
    unclassified,
    summary:
      parts.join(", ") +
      (unclassified.length > 0
        ? `, and ${unclassified.length} field${unclassified.length === 1 ? "" : "s"} no spec describes ` +
          `(${unclassified.join(", ")}) — provenance undecided rather than assumed.`
        : "."),
  }
}
