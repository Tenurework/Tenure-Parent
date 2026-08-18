/**
 * GE-103-015 — "Retain only a minimal non-content Parent tombstone: tenant ID,
 * lifecycle timestamps, purge-manifest digest, approvals, and evidence
 * reference. It must contain no recoverable customer content."
 *
 * What is left in the Parent after a tenant is destroyed. Five fields, and the
 * word doing the work in that sentence is **only**.
 *
 * ── Why an allowlist, and not a scan ───────────────────────────────────────
 *
 * The obvious implementation looks for content and refuses what it finds:
 * addresses, names, anything that looks like a row. That is a blocklist, and a
 * blocklist is a claim that somebody enumerated every shape customer data can
 * take — which is false the first time a customer's records contain something
 * nobody thought of.
 *
 * So the check is the other way round. The key set is EXACTLY these five; any
 * other key is refused without being read. And each of the five is constrained
 * to a shape that cannot carry prose: an identifier, an instant, a hex digest,
 * or a pointer. No field of a tombstone is a sentence, so the rule "no value
 * may contain a space" is a property of the design rather than a heuristic —
 * and it is what makes "no recoverable customer content" checkable instead of
 * asserted.
 *
 * A legal name IS customer content. So is a display name, a contact address,
 * and the free-text reason somebody typed into the purge form. None of them is
 * here, and `slug` is not here either: a slug is chosen by the customer, often
 * IS their name, and the immutable `tenantId` is what every other record points
 * at anyway (`tenant-registry.ts` makes exactly this argument).
 */

/** The five the requirement names, and the complete key set of a tombstone. */
export const TOMBSTONE_FIELDS = [
  "tenantId",
  "lifecycle",
  "purgeManifestDigest",
  "approvals",
  "evidenceRef",
] as const

export type TombstoneField = (typeof TOMBSTONE_FIELDS)[number]

/** What each approval row may say. Three keys, none of them prose. */
export interface TombstoneApproval {
  principalId: string
  /** What this identity did. Not a job title and not a free-text note. */
  role: "requested" | "approved" | "performed"
  at: string
}

export interface TombstoneLifecycle {
  /** When the tenant first existed in the Parent. */
  registeredAt: string
  /** When the destructive approval was recorded. */
  purgeApprovedAt: string
  /** When the last byte went. */
  purgedAt: string
}

export interface Tombstone {
  /** The immutable id, never the slug and never a name. */
  tenantId: string
  lifecycle: TombstoneLifecycle
  /** SHA-256 over the purge manifest. One-way: a digest is not a payload. */
  purgeManifestDigest: string
  approvals: readonly TombstoneApproval[]
  /** A pointer to the evidence, which lives elsewhere and outlives this row. */
  evidenceRef: string
}

export interface TombstoneProblem {
  field: string
  reason: string
  detail: string
}

/**
 * An opaque identifier: no spaces, no `@`, nothing that reads as a name.
 *
 * Deliberately permissive about WHICH id scheme — `tenant-registry.ts` does not
 * fix one — and strict about what an id may not contain. An `@` means an
 * address; a space means prose. Both are content.
 */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/

/** SHA-256, lowercase hex. A truncated or upper-case digest is refused rather than normalised. */
const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * A pointer, not a payload.
 *
 * The scheme is named so a reader knows where to go, and the rest may not
 * contain a space or a brace — a JSON blob pasted into this field would be the
 * whole audit record inlined into the one row that is supposed to survive
 * BECAUSE it is not the record.
 */
const EVIDENCE_REF = /^(s3|dynamodb|cloudtrail|audit|arn):[A-Za-z0-9/._:#-]{3,255}$/

/** ISO-8601 instant, in UTC. Local times are refused: a tombstone outlives the zone. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

const LIFECYCLE_FIELDS = ["registeredAt", "purgeApprovedAt", "purgedAt"] as const
const APPROVAL_FIELDS = ["principalId", "role", "at"] as const
const APPROVAL_ROLES: ReadonlySet<string> = new Set(["requested", "approved", "performed"])

/**
 * Every way this is not a tombstone.
 *
 * Takes `unknown` on purpose. The value being checked has usually been read
 * back out of a store, where a TypeScript type is a claim and not a check — the
 * same argument `registry.ts` makes about widening a stored evidence row.
 */
export function tombstoneProblems(value: unknown): readonly TombstoneProblem[] {
  const problems: TombstoneProblem[] = []
  const bad = (field: string, reason: string, detail: string) =>
    problems.push({ field, reason, detail })

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [
      {
        field: "",
        reason: "not-a-tombstone",
        detail: "A tombstone is an object with exactly five fields.",
      },
    ]
  }

  const t = value as Record<string, unknown>
  const allowed = new Set<string>(TOMBSTONE_FIELDS)

  // The rule the requirement's word "only" is about. Refused without being
  // echoed: an extra key is, by construction, something nobody decided a
  // tombstone may carry, and printing its value in an error would put it in a
  // log — which is another place it must not be.
  for (const key of Object.keys(t)) {
    if (!allowed.has(key)) {
      bad(
        key,
        "not-permitted",
        `A tombstone carries exactly ${TOMBSTONE_FIELDS.join(", ")}. "${key}" is not one of them, ` +
          `and a field nobody decided a tombstone may hold is how customer content survives a purge.`,
      )
    }
  }
  for (const key of TOMBSTONE_FIELDS) {
    if (!(key in t)) {
      bad(key, "required", `A tombstone with no ${key} cannot answer the question it exists for.`)
    }
  }

  if (typeof t.tenantId === "string" && !OPAQUE_ID.test(t.tenantId)) {
    bad(
      "tenantId",
      "not-opaque",
      "The immutable tenant id, with no spaces and no `@`. A name or an address here is exactly " +
        "the recoverable customer content this row may not contain.",
    )
  }

  const lifecycle = t.lifecycle
  if (lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)) {
    const l = lifecycle as Record<string, unknown>
    for (const key of Object.keys(l)) {
      if (!(LIFECYCLE_FIELDS as readonly string[]).includes(key)) {
        bad(`lifecycle.${key}`, "not-permitted", `Lifecycle carries ${LIFECYCLE_FIELDS.join(", ")}.`)
      }
    }
    for (const key of LIFECYCLE_FIELDS) {
      const at = l[key]
      if (typeof at !== "string" || !INSTANT.test(at)) {
        bad(
          `lifecycle.${key}`,
          "not-an-instant",
          "An ISO-8601 UTC instant such as 2026-08-17T12:00:00.000Z. A tombstone outlives the " +
            "timezone of whatever wrote it.",
        )
      }
    }
  } else if ("lifecycle" in t) {
    bad("lifecycle", "malformed", "Three timestamps, as an object.")
  }

  if (typeof t.purgeManifestDigest === "string" && !SHA256_HEX.test(t.purgeManifestDigest)) {
    bad(
      "purgeManifestDigest",
      "not-a-digest",
      "64 lowercase hex characters. A digest is one-way, which is why it is safe to keep: it " +
        "proves which manifest was executed without carrying anything the manifest listed.",
    )
  }

  const approvals = t.approvals
  if (Array.isArray(approvals)) {
    if (approvals.length < 2) {
      bad(
        "approvals",
        "insufficient",
        "At least two: the identity that requested the purge and the separate identity that " +
          "approved it. One row cannot show a two-person rule was honoured.",
      )
    }
    approvals.forEach((row, i) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        bad(`approvals[${i}]`, "malformed", "Three keys: principalId, role, at.")
        return
      }
      const a = row as Record<string, unknown>
      for (const key of Object.keys(a)) {
        if (!(APPROVAL_FIELDS as readonly string[]).includes(key)) {
          bad(
            `approvals[${i}].${key}`,
            "not-permitted",
            `An approval row carries ${APPROVAL_FIELDS.join(", ")} and nothing else — a "reason" ` +
              `or a "note" is free text somebody typed, and free text is where content ends up.`,
          )
        }
      }
      if (typeof a.principalId !== "string" || !/^\S+$/.test(a.principalId)) {
        bad(`approvals[${i}].principalId`, "malformed", "One token, no whitespace.")
      }
      if (typeof a.role !== "string" || !APPROVAL_ROLES.has(a.role)) {
        bad(
          `approvals[${i}].role`,
          "unknown-role",
          `One of ${[...APPROVAL_ROLES].join(", ")}. A closed set, so a role cannot be a sentence.`,
        )
      }
      if (typeof a.at !== "string" || !INSTANT.test(a.at)) {
        bad(`approvals[${i}].at`, "not-an-instant", "An ISO-8601 UTC instant.")
      }
    })
  } else if ("approvals" in t) {
    bad("approvals", "malformed", "A list of approval rows.")
  }

  if (typeof t.evidenceRef === "string" && !EVIDENCE_REF.test(t.evidenceRef)) {
    bad(
      "evidenceRef",
      "not-a-reference",
      "A pointer such as s3://tenure-audit/purges/<id> or audit:purge/<id> — never the evidence " +
        "itself. Inlining the record here defeats the point of the record being elsewhere.",
    )
  }

  return problems
}

export class TombstoneRefused extends Error {
  constructor(readonly problems: readonly TombstoneProblem[]) {
    super(
      `A tombstone was refused on ${problems.length} ground(s): ` +
        problems.map((p) => `${p.field || "(root)"}: ${p.reason}`).join("; "),
    )
    this.name = "TombstoneRefused"
  }
}

/**
 * Build one, or refuse.
 *
 * Constructs the object field by field rather than spreading its input, so a
 * caller passing a whole tenant record cannot carry thirty extra fields through
 * on a spread that looked harmless. `tombstoneProblems` then checks the result
 * — the build and the check are separate because the check has to work on a row
 * read back out of a store, which nothing built here.
 */
export function buildTombstone(input: {
  tenantId: string
  registeredAt: string
  purgeApprovedAt: string
  purgedAt: string
  purgeManifestDigest: string
  approvals: readonly TombstoneApproval[]
  evidenceRef: string
}): Tombstone {
  const tombstone: Tombstone = {
    tenantId: input.tenantId,
    lifecycle: {
      registeredAt: input.registeredAt,
      purgeApprovedAt: input.purgeApprovedAt,
      purgedAt: input.purgedAt,
    },
    purgeManifestDigest: input.purgeManifestDigest,
    approvals: input.approvals.map((a) => ({
      principalId: a.principalId,
      role: a.role,
      at: a.at,
    })),
    evidenceRef: input.evidenceRef,
  }

  const problems = tombstoneProblems(tombstone)
  if (problems.length > 0) throw new TombstoneRefused(problems)
  return tombstone
}
