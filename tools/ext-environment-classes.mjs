#!/usr/bin/env node
/**
 * EXT-020-001 — the environment class registry, and the schema every class in
 * Section 4 has to satisfy.
 *
 * The requirement: *"Implement environment class registry and schema for every
 * class in Section 4."* §4.1 of the extension is the authority. It is a table
 * of sixteen classes with four attributes each — primary purpose, permitted
 * data, promotion authority, end state — followed by one sentence that turns
 * the table into a rule:
 *
 *   > An environment may combine classes only when purpose, data, access,
 *   > release, evidence, and destruction policies remain at least as strict as
 *   > the strictest class.
 *
 * ## The table is parsed, never retyped
 *
 * `environmentClasses()` reads the markdown table out of the extension. A class
 * added to the document appears here; a class renamed there renames here; a
 * class this file has an opinion about that the document no longer contains is
 * a problem, not a silent leftover. Retyping the sixteen rows would make this
 * file a second authority on §4.1, and the repository already carries a note
 * about what having two parsers of the same document cost.
 *
 * ## Two directions of "at least as strict", not one
 *
 * The naive reading of the combination sentence is "take the maximum on every
 * axis". That is wrong on the data axis and getting it wrong is how a
 * combination that must be refused looks fine.
 *
 * Permitted data is a CEILING. `PRODUCTION` permits approved production data;
 * `LOCAL_DEV` permits generated/synthetic only. An environment that is both may
 * hold only what BOTH permit — the minimum — so the combination cannot carry
 * production data at all, which is exactly the refusal §4.1 intends.
 *
 * Promotion authority and destruction are OBLIGATIONS. Combine
 * `DR_RESTORE_DRILL` (mandatory destruction) with anything and the combination
 * inherits mandatory destruction — the maximum. Combine it with `PRODUCTION`
 * and the result demands that production be destroyed, which reads as absurd
 * and is the point: the model says out loud that those two classes must not
 * share an environment.
 *
 * `AXES` records the direction per axis with the reason, and
 * `combineClasses()` applies min or max accordingly.
 *
 * ## Where §4.1 cannot answer, this says so rather than guessing
 *
 * The combination sentence names six axes. §4.1's table supplies four of them:
 * purpose, data (permitted data), release (promotion authority), destruction
 * (end state). It supplies NO per-class value for **access** or **evidence** —
 * those live in §4.2's manifest, per environment, not per class. So
 * `combineClasses()` returns them as `unresolvedAxes` with the reason, and a
 * caller that wants them decided has to supply them. "We looked and §4.1 does
 * not say" and "the axis is satisfied" are different answers, and collapsing
 * them is the failure this repository most often finds.
 *
 * ## The rungs are judgement, pinned to the document's exact words
 *
 * Mapping "Approved protected rehearsal dataset" onto a strictness rung is a
 * decision, not a parse. A keyword regex would make that decision invisibly and
 * silently mis-rung the ambiguous rows — `SYSTEM_TEST` reads
 * "Synthetic/rehearsal fixtures", which a regex hunting for "rehearsal" would
 * put beside `CONVERSION_REHEARSAL`'s protected dataset.
 *
 * So each judgement is written down, with the column text it was made from
 * quoted verbatim, and `registryProblems()` asserts the quote still equals the
 * document. Change the wording in §4.1 and the guard fires and a human re-rungs
 * it; that is the correct behaviour for a judgement, and it is not what a
 * regex would have done.
 *
 *   node tools/ext-environment-classes.mjs [CLASS_A CLASS_B …]
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./document-graph.mjs"

export const EXTENSION_PATH = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"
export const SECTION = "### 4.1 Environment classes"

const abs = (p) => path.join(ROOT, p)

/** The four table columns, in the document's own order. */
export const CLASS_FIELDS = ["id", "purpose", "permittedData", "promotionAuthority", "endState"]

/**
 * §4.1's six combination axes.
 *
 * `source` is where a value for the axis comes from. `direction` decides what
 * "at least as strict as the strictest class" means for it — see the header.
 */
export const AXES = [
  {
    axis: "purpose",
    source: "4.1:Primary purpose",
    direction: "UNION",
    why: "Purpose is not ordered. A combined environment serves every constituent purpose; there is no purpose that is 'stricter' than another.",
  },
  {
    axis: "data",
    source: "4.1:Permitted data",
    direction: "CEILING",
    why: "Permitted data is a ceiling. The combination may hold only what every constituent class permits, so the strictest combined value is the minimum rung.",
  },
  {
    axis: "access",
    source: "4.2:Identity issuer, access groups/policies, step-up requirements",
    direction: "OBLIGATION",
    why: "§4.1 carries no access column. Access is a per-environment manifest field, so the class registry cannot decide this axis and says so.",
  },
  {
    axis: "release",
    source: "4.1:Promotion authority",
    direction: "OBLIGATION",
    why: "Promotion authority is an obligation. The combination must clear the highest authority any constituent class requires, so the strictest value is the maximum rung.",
  },
  {
    axis: "evidence",
    source: "4.2:Entry criteria, exit criteria, health checks, evidence requirements",
    direction: "OBLIGATION",
    why: "§4.1 carries no evidence column. Evidence requirements are a per-environment manifest field, so the class registry cannot decide this axis and says so.",
  },
  {
    axis: "destruction",
    source: "4.1:End state",
    direction: "OBLIGATION",
    why: "End state is an obligation. The combination inherits the most demanding end-of-life any constituent class requires, so the strictest value is the maximum rung.",
  },
]

/** Axes §4.1 supplies a per-class value for. The other two are the honest gap. */
export const AXES_FROM_4_1 = AXES.filter((a) => a.source.startsWith("4.1:")).map((a) => a.axis)
export const AXES_NOT_IN_4_1 = AXES.filter((a) => !a.source.startsWith("4.1:")).map((a) => a.axis)

/** Permitted-data rungs, least to most sensitive. A CEILING axis: lower is stricter. */
export const DATA_RUNGS = [
  "SYNTHETIC",
  "CONFIGURATION_METADATA",
  "MINIMIZED_APPROVED",
  "PRODUCTION_DERIVED",
  "PRODUCTION",
]

/** Promotion-authority rungs, least to most demanding. An OBLIGATION axis: higher is stricter. */
export const AUTHORITY_RUNGS = [
  "DEVELOPER",
  "AUTOMATED_POLICY",
  "FUNCTION_OWNER",
  "BUSINESS_OR_MULTI_OWNER",
  "BOARD",
  "PROTECTED_PRODUCTION",
]

/** End-state rungs, least to most demanding. An OBLIGATION axis: higher is stricter. */
export const DESTRUCTION_RUNGS = [
  "LIFECYCLE_MANAGED",
  "RETAINED",
  "REFRESHED_IN_PLACE",
  "HIBERNATED",
  "CLOSED_ON_STABILIZATION",
  "DESTROYED",
  "MANDATORY_DESTRUCTION",
]

/**
 * The judgements. One entry per class in §4.1.
 *
 * `quote*` is the document's cell text verbatim. `registryProblems()` compares
 * it with what the parser read, so a re-worded cell fails loudly here instead
 * of keeping a rung that was decided about different words.
 */
export const RUNGS = {
  LOCAL_DEV: {
    data: "SYNTHETIC", quoteData: "Generated/synthetic only",
    authority: "DEVELOPER", quoteAuthority: "Developer",
    destruction: "DESTROYED", quoteEndState: "Ephemeral",
    why: "One engineer's machine: nothing real may enter it, the engineer alone promotes out of it, and it does not survive.",
  },
  EPHEMERAL_PREVIEW: {
    data: "SYNTHETIC", quoteData: "Generated/synthetic only",
    authority: "AUTOMATED_POLICY", quoteAuthority: "CI policy",
    destruction: "DESTROYED", quoteEndState: "Auto-destroy",
    why: "A per-PR preview. No person approves it — a policy in CI does — and destruction is automatic rather than scheduled.",
  },
  SHARED_INTEGRATION: {
    data: "SYNTHETIC", quoteData: "Synthetic tenant fixtures",
    authority: "FUNCTION_OWNER", quoteAuthority: "Engineering release",
    destruction: "REFRESHED_IN_PLACE", quoteEndState: "Persistent with reset",
    why: "Persistent, so no destruction obligation; reset replaces the contents, which is the refresh rung and not a destruction.",
  },
  SECURITY_TEST: {
    data: "SYNTHETIC", quoteData: "Synthetic/adversarial",
    authority: "FUNCTION_OWNER", quoteAuthority: "Security owner",
    destruction: "DESTROYED", quoteEndState: "Ephemeral or isolated",
    why: "Adversarial data is still synthetic. A named function owner promotes. 'Ephemeral or isolated' is rung at the stricter of the two the cell offers.",
  },
  PERFORMANCE_TEST: {
    data: "SYNTHETIC", quoteData: "Generated volume fixtures",
    authority: "FUNCTION_OWNER", quoteAuthority: "Performance owner",
    destruction: "HIBERNATED", quoteEndState: "Scheduled/hibernated",
    why: "Volume fixtures are generated, so synthetic. Hibernation is an obligation to stop paying, not to destroy.",
  },
  PROTOTYPE: {
    data: "MINIMIZED_APPROVED", quoteData: "Synthetic or approved minimized sample",
    authority: "FUNCTION_OWNER", quoteAuthority: "Program/design owner",
    destruction: "DESTROYED", quoteEndState: "Destroy or promote design only",
    why: "The cell permits an approved minimized sample, so the ceiling is minimized rather than synthetic — a ceiling is what MAY be held, and this may hold more than synthetic.",
  },
  CONFIGURATION_SOURCE: {
    data: "CONFIGURATION_METADATA", quoteData: "Configuration metadata; no production transaction copy",
    authority: "FUNCTION_OWNER", quoteAuthority: "Configuration owner",
    destruction: "RETAINED", quoteEndState: "Versioned baseline",
    why: "Real tenant configuration is not synthetic, and the cell forbids production transactions, so it is its own rung between the two. A versioned baseline is retained, never destroyed.",
  },
  MIGRATION_DEVELOPMENT: {
    data: "MINIMIZED_APPROVED", quoteData: "Masked/minimized extracts where approved",
    authority: "FUNCTION_OWNER", quoteAuthority: "Data lead",
    destruction: "REFRESHED_IN_PLACE", quoteEndState: "Refresh-controlled",
    why: "Masked extracts of real data under approval. Refresh-controlled is a governed replacement of contents, not an end of life.",
  },
  CONVERSION_REHEARSAL: {
    data: "PRODUCTION_DERIVED", quoteData: "Approved protected rehearsal dataset",
    authority: "BUSINESS_OR_MULTI_OWNER", quoteAuthority: "Data/cutover leads",
    destruction: "DESTROYED", quoteEndState: "Destroy by policy",
    why: "A rehearsal dataset is derived from production and is protected as such — that is why it is a rung above masked extracts. Two leads, not one, is the multi-owner rung.",
  },
  SYSTEM_TEST: {
    data: "SYNTHETIC", quoteData: "Synthetic/rehearsal fixtures",
    authority: "FUNCTION_OWNER", quoteAuthority: "QA lead",
    destruction: "REFRESHED_IN_PLACE", quoteEndState: "Reset between cycles",
    why: "The cell says fixtures. A fixture is manufactured whichever rehearsal it was shaped from, and §4.3 forbids production-derived data reaching a general test environment without the exception workflow — so this is the synthetic rung, not CONVERSION_REHEARSAL's.",
  },
  UAT: {
    data: "MINIMIZED_APPROVED", quoteData: "Approved representative, masked, or synthetic data",
    authority: "BUSINESS_OR_MULTI_OWNER", quoteAuthority: "Business process owners",
    destruction: "RETAINED", quoteEndState: "Frozen evidence baseline",
    why: "Masked representative data under approval. A frozen evidence baseline must be kept — the opposite of a destruction obligation — which is why UAT combines badly with any drill class.",
  },
  TRAINING: {
    data: "SYNTHETIC", quoteData: "Synthetic named personas and safe scenarios",
    authority: "FUNCTION_OWNER", quoteAuthority: "Training lead",
    destruction: "REFRESHED_IN_PLACE", quoteEndState: "Refresh from safe template",
    why: "Named personas are still invented. Refresh from a template replaces contents in place.",
  },
  GOLD_PREPRODUCTION: {
    data: "MINIMIZED_APPROVED", quoteData: "Production-like structure; minimized data",
    authority: "BOARD", quoteAuthority: "Release/cutover board",
    destruction: "RETAINED", quoteEndState: "Promote artifacts, not database copies",
    why: "Production-LIKE structure with minimized data is the minimized ceiling, not the production one — §4.4 and EXT-020-009 both turn on gold never holding a production database copy. A board is a rung above any single owner.",
  },
  PRODUCTION: {
    data: "PRODUCTION", quoteData: "Approved production data",
    authority: "PROTECTED_PRODUCTION", quoteAuthority: "Protected production authority",
    destruction: "LIFECYCLE_MANAGED", quoteEndState: "Active/hibernate/offboard",
    why: "The only class whose ceiling is production data, the only one whose authority is the protected path, and the only one under no obligation to end.",
  },
  HYPERCARE_SUPPORT: {
    data: "CONFIGURATION_METADATA", quoteData: "Metadata and purpose-bound support access",
    authority: "FUNCTION_OWNER", quoteAuthority: "Incident/support policy",
    destruction: "CLOSED_ON_STABILIZATION", quoteEndState: "Close after stabilization",
    why: "The cell says explicitly this is not a data clone: metadata only. Closing on a condition is a real obligation but a weaker one than a deadline-bound destruction.",
  },
  DR_RESTORE_DRILL: {
    data: "PRODUCTION_DERIVED", quoteData: "Encrypted restored data under drill controls",
    authority: "FUNCTION_OWNER", quoteAuthority: "DR owner",
    destruction: "MANDATORY_DESTRUCTION", quoteEndState: "Mandatory destruction",
    why: "Restored data is production data under drill controls, one rung below live production because the controls are the drill's. Its end state is the only one the document calls mandatory, so it is the top rung.",
  },
}

let cachedText = null
function extensionText() {
  if (cachedText === null) cachedText = fs.readFileSync(abs(EXTENSION_PATH), "utf8")
  return cachedText
}

/** The raw markdown lines of §4.1's table, header and separator included. */
export function classTableLines(text = extensionText()) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === SECTION)
  if (start < 0) throw new Error(`${EXTENSION_PATH}: no "${SECTION}" heading — the class registry has no authority to read`)
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^### /.test(lines[i])) break
    if (lines[i].startsWith("|")) out.push(lines[i])
  }
  if (out.length === 0) throw new Error(`${EXTENSION_PATH}: "${SECTION}" contains no table`)
  return out
}

const unquote = (s) => s.replace(/`/g, "").trim()

/**
 * The sixteen classes, as the document has them.
 *
 * Anything in the id column that is not a `CONSTANT_CASE` identifier is a
 * parse failure rather than a class, because a table that stopped being a
 * table would otherwise return zero rows and make every check below vacuous.
 */
export function environmentClasses(text = extensionText()) {
  const rows = classTableLines(text)
  const cells = (line) => line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())
  const header = cells(rows[0]).map(unquote)
  if (header.length !== CLASS_FIELDS.length) {
    throw new Error(`${SECTION}: expected ${CLASS_FIELDS.length} columns, found ${header.length} — ${header.join(" / ")}`)
  }
  const out = []
  for (const line of rows.slice(1)) {
    const c = cells(line)
    if (c.every((x) => /^-+$/.test(x))) continue
    if (c.length !== CLASS_FIELDS.length) {
      throw new Error(`${SECTION}: row has ${c.length} cells, expected ${CLASS_FIELDS.length} — ${line}`)
    }
    const id = unquote(c[0])
    if (!/^[A-Z][A-Z0-9_]*$/.test(id)) throw new Error(`${SECTION}: "${id}" is not an environment class identifier`)
    out.push({ id, purpose: c[1], permittedData: c[2], promotionAuthority: c[3], endState: c[4] })
  }
  return out
}

/**
 * The schema every registry entry must satisfy: the document's four attributes,
 * each non-empty, plus a rung on each of the three axes §4.1 supplies, each
 * drawn from that axis's declared ladder.
 */
export function validateEntry(entry) {
  const problems = []
  for (const f of CLASS_FIELDS) {
    if (typeof entry?.[f] !== "string" || entry[f].trim() === "") {
      problems.push({ kind: "MISSING_FIELD", field: f, id: entry?.id ?? "(no id)" })
    }
  }
  const ladders = { data: DATA_RUNGS, authority: AUTHORITY_RUNGS, destruction: DESTRUCTION_RUNGS }
  for (const [axis, ladder] of Object.entries(ladders)) {
    const v = entry?.[axis]
    if (v === undefined) problems.push({ kind: "MISSING_RUNG", axis, id: entry?.id ?? "(no id)" })
    else if (!ladder.includes(v)) problems.push({ kind: "UNKNOWN_RUNG", axis, value: v, id: entry.id })
  }
  return problems
}

/** The registry: the document's rows joined to this file's judgements. */
export function classRegistry(text = extensionText()) {
  const out = new Map()
  for (const c of environmentClasses(text)) {
    const r = RUNGS[c.id]
    out.set(c.id, {
      ...c,
      data: r?.data,
      authority: r?.authority,
      destruction: r?.destruction,
      why: r?.why,
      undecidableAxes: [...AXES_NOT_IN_4_1],
    })
  }
  return out
}

/**
 * Everything that can be wrong between the document and this file.
 *
 * MISSING_JUDGEMENT — §4.1 has a class nobody rung. QUOTE_DRIFT — the cell text
 * a rung was decided from is no longer what the document says, so the rung is
 * about words that are gone. ORPHAN_JUDGEMENT — a rung for a class §4.1 does
 * not contain. Then the schema, per entry.
 */
export function registryProblems(text = extensionText()) {
  const problems = []
  const classes = environmentClasses(text)
  const seen = new Set()
  for (const c of classes) {
    seen.add(c.id)
    const r = RUNGS[c.id]
    if (!r) {
      problems.push({ kind: "MISSING_JUDGEMENT", id: c.id })
      continue
    }
    const quotes = [
      ["permittedData", r.quoteData],
      ["promotionAuthority", r.quoteAuthority],
      ["endState", r.quoteEndState],
    ]
    for (const [field, quoted] of quotes) {
      if (unquote(c[field]) !== quoted) {
        problems.push({ kind: "QUOTE_DRIFT", id: c.id, field, quoted, actual: unquote(c[field]) })
      }
    }
  }
  for (const id of Object.keys(RUNGS)) {
    if (!seen.has(id)) problems.push({ kind: "ORPHAN_JUDGEMENT", id })
  }
  for (const entry of classRegistry(text).values()) problems.push(...validateEntry(entry))
  return problems
}

const LADDER = { data: DATA_RUNGS, release: AUTHORITY_RUNGS, destruction: DESTRUCTION_RUNGS }
const FIELD_FOR = { data: "data", release: "authority", destruction: "destruction" }

/**
 * §4.1's combination rule, applied.
 *
 * Returns the policy a combined environment must adopt on each axis §4.1 can
 * decide, which class imposed it, the union of purposes, and — separately —
 * the axes §4.1 supplies no value for, so a caller cannot mistake "not
 * decidable here" for "satisfied".
 *
 * `supplied` lets a caller decide the two manifest axes; anything it does not
 * supply stays unresolved.
 */
export function combineClasses(ids, supplied = {}, text = extensionText()) {
  const registry = classRegistry(text)
  const unknown = ids.filter((id) => !registry.has(id))
  if (unknown.length) return { ok: false, refusals: [{ kind: "UNKNOWN_CLASS", ids: unknown }], required: {}, unresolvedAxes: [] }
  if (ids.length === 0) return { ok: false, refusals: [{ kind: "NO_CLASS", why: "A combination of nothing has no policy." }], required: {}, unresolvedAxes: [] }

  const entries = ids.map((id) => registry.get(id))
  const required = {}
  const imposedBy = {}

  required.purpose = entries.map((e) => `${e.id}: ${e.purpose}`)
  imposedBy.purpose = ids.slice()

  for (const axis of ["data", "release", "destruction"]) {
    const ladder = LADDER[axis]
    const field = FIELD_FOR[axis]
    const direction = AXES.find((a) => a.axis === axis).direction
    let best = null
    for (const e of entries) {
      const rung = ladder.indexOf(e[field])
      if (best === null || (direction === "CEILING" ? rung < best.rung : rung > best.rung)) best = { rung, id: e.id }
    }
    required[axis] = ladder[best.rung]
    imposedBy[axis] = best.id
  }

  const unresolvedAxes = []
  for (const axis of AXES_NOT_IN_4_1) {
    if (Object.prototype.hasOwnProperty.call(supplied, axis)) {
      required[axis] = supplied[axis]
      imposedBy[axis] = "SUPPLIED_BY_CALLER"
    } else {
      unresolvedAxes.push({ axis, why: AXES.find((a) => a.axis === axis).why })
    }
  }

  /**
   * The refusal that matters: a class whose own permitted data is above the
   * combined ceiling cannot do its job in this environment. That is not a
   * warning — it is §4.1 saying these classes may not be combined.
   */
  const refusals = []
  const ceiling = DATA_RUNGS.indexOf(required.data)
  for (const e of entries) {
    if (DATA_RUNGS.indexOf(e.data) > ceiling) {
      refusals.push({
        kind: "DATA_CEILING_COLLAPSE",
        id: e.id,
        needs: e.data,
        ceiling: required.data,
        imposedBy: imposedBy.data,
        why: `${e.id} exists to hold ${e.data} data; combined with ${imposedBy.data} the environment may hold only ${required.data}.`,
      })
    }
  }
  /**
   * The second refusal: a class that must be destroyed sharing an environment
   * with one that must be kept. `UAT`'s frozen evidence baseline and
   * `DR_RESTORE_DRILL`'s mandatory destruction are the pair this exists for.
   */
  const destructionRung = DESTRUCTION_RUNGS.indexOf(required.destruction)
  if (destructionRung >= DESTRUCTION_RUNGS.indexOf("DESTROYED")) {
    for (const e of entries) {
      if (["RETAINED", "LIFECYCLE_MANAGED"].includes(e.destruction)) {
        refusals.push({
          kind: "DESTRUCTION_CONFLICT",
          id: e.id,
          keeps: e.destruction,
          required: required.destruction,
          imposedBy: imposedBy.destruction,
          why: `${e.id} must be kept (${e.endState}); ${imposedBy.destruction} requires ${required.destruction}. One environment cannot do both.`,
        })
      }
    }
  }

  return { ok: refusals.length === 0, required, imposedBy, unresolvedAxes, refusals }
}

export function render(ids = []) {
  const out = []
  const classes = environmentClasses()
  out.push(`§4.1 environment classes: ${classes.length}`)
  const reg = classRegistry()
  for (const c of classes) {
    const e = reg.get(c.id)
    out.push(`  ${c.id.padEnd(22)} data=${String(e.data).padEnd(22)} release=${String(e.authority).padEnd(24)} end=${e.destruction}`)
  }
  const problems = registryProblems()
  out.push("")
  out.push(`${problems.length} registry problem(s).`)
  for (const p of problems) out.push(`  ${p.kind} ${p.id ?? ""} ${p.field ?? p.axis ?? ""}`)
  out.push("")
  out.push(`Axes §4.1 cannot decide: ${AXES_NOT_IN_4_1.join(", ")} — a manifest supplies them (§4.2).`)
  if (ids.length) {
    const r = combineClasses(ids)
    out.push("")
    out.push(`Combination ${ids.join(" + ")}: ${r.ok ? "PERMITTED" : "REFUSED"}`)
    for (const [axis, v] of Object.entries(r.required ?? {})) {
      if (axis === "purpose") continue
      out.push(`  ${axis.padEnd(12)} ${v}   (from ${r.imposedBy[axis]})`)
    }
    for (const u of r.unresolvedAxes) out.push(`  ${u.axis.padEnd(12)} UNRESOLVED — ${u.why}`)
    for (const f of r.refusals) out.push(`  REFUSED ${f.kind}: ${f.why ?? JSON.stringify(f)}`)
  }
  return out.join("\n")
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("ext-environment-classes.mjs")) {
  console.log(render(process.argv.slice(2)))
  process.exit(registryProblems().length === 0 ? 0 : 1)
}
