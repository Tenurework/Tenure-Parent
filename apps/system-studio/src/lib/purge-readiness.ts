/**
 * GE-103-013, on the console — what would have to be true before this tenant
 * could be purged, and how much of it the Parent can actually answer.
 *
 * `purgeClearance` in `@tenure/provisioning` is the gate: seven checks and a
 * protected destructive approval, with `unknown` blocking exactly as a failure
 * does. This module is what supplies it from the ONE store the Studio has — the
 * tenant registry — and, just as importantly, what does not.
 *
 * ── Why most of these come back `unknown`, and why that is the point ───────
 *
 * There is no contract store in this platform, no tax-retention schedule, no
 * records-retention policy and no export ledger. A module that shrugged and
 * passed those checks would produce a console that says a tenant is clear for
 * destruction on the strength of four tables that do not exist. `purgeClearance`
 * already refuses to read an absent fact as a pass, so the honest thing to
 * supply is nothing — and then say, per check, exactly which store would have to
 * exist for the answer to change.
 *
 * That is the difference this console exists to hold: *we looked and found
 * nothing* is not *we could not look*.
 *
 * No `server-only`, no `@/lib/*` import, no AWS client: the rules live here so a
 * plain jest test can drive them without a DynamoDB table, the same rule
 * `summary.ts` and `next-moves.ts` follow.
 */

import {
  PURGE_CHECKS,
  purgeClearance,
  type PurgeCheckId,
  type PurgeClearance,
  type PurgeFacts,
  type TenantState,
} from "@tenure/provisioning"

/** One recorded lifecycle step, narrowed to what this module reads. */
export interface PurgeHistoryStep {
  to: TenantState
  at: string
  actor: string
}

/**
 * What the registry holds about one tenant, and nothing more.
 *
 * Deliberately not the whole `TenantRecord`: passing the record would let a
 * later edit reach for a field this module has no business reading, and the
 * whole claim here is about the boundary between what the Parent knows and what
 * it does not.
 */
export interface RegistryPurgeInputs {
  slug: string
  state: TenantState
  history: readonly PurgeHistoryStep[]
}

/**
 * For each check: what the Parent holds today, and what would have to exist for
 * it to be answerable.
 *
 * `needs: null` means the registry can answer it. Four of the seven cannot be
 * answered by anything this platform has, and naming the missing store is the
 * corrective action — a console that reports `unknown` without saying what would
 * fix it turns into a support ticket.
 */
export interface PurgeFactSource {
  check: PurgeCheckId
  holds: string
  needs: string | null
}

export const PURGE_FACT_SOURCES: readonly PurgeFactSource[] = [
  {
    check: "export",
    holds:
      "The registry records whether this tenant ever entered EXPORTING, and records nothing about " +
      "what left or whether the customer received it.",
    needs:
      "An export ledger carrying the completion time and a digest of the archive (GE-103-022). " +
      "A lifecycle state is not a receipt.",
  },
  {
    check: "contract",
    holds: "Nothing. The Parent has no record of any commercial term.",
    needs: "A contract record with a term end and a discharge flag.",
  },
  {
    check: "retention",
    holds: "Nothing. No records-retention schedule exists anywhere in this platform.",
    needs: "A retention schedule per record class, with an expiry instant.",
  },
  {
    check: "legal-hold",
    holds:
      "The lifecycle state. `LEGAL_HOLD` is a state a tenant is moved into and out of by a " +
      "recorded transition, so the Parent genuinely knows this one.",
    needs: null,
  },
  {
    check: "tax",
    holds: "Nothing. No jurisdiction or filing obligation is recorded against a tenant.",
    needs: "A tax-retention record per jurisdiction this tenant files in.",
  },
  {
    check: "audit",
    holds:
      "Step evidence rows, under the tenant's own partition. What is missing is how long they are " +
      "kept: nothing sets or reads a retention period on them.",
    needs:
      "A retention period on the audit evidence, and an immutable reference that outlives the " +
      "tenant's partition — the evidence a purge is proven by must not live inside what is purged.",
  },
  {
    check: "cooling-off",
    holds:
      "The transition into `PURGE_PENDING` — its instant and the operator who made it. That IS the " +
      "moment the purge was asked for, and it is persisted rather than supplied by the caller.",
    needs: null,
  },
]

/** The step that moved this tenant into `PURGE_PENDING`, or null. */
export function purgeRequestedAt(
  history: readonly PurgeHistoryStep[],
): PurgeHistoryStep | null {
  // The LAST one. A tenant can leave `PURGE_PENDING` for `LEGAL_HOLD` or
  // `OFFBOARDING` and come back, and the cooling-off period runs from the
  // current ask rather than from an abandoned one months ago.
  const steps = history.filter((s) => s.to === "PURGE_PENDING")
  return steps.length > 0 ? steps[steps.length - 1] : null
}

/**
 * The facts, and only the facts.
 *
 * Every field this returns is derived from something the registry actually
 * holds. Everything else is left absent — which `purgeClearance` reads as
 * `unknown`, which blocks.
 */
export function purgeFactsFromRegistry(input: RegistryPurgeInputs): PurgeFacts {
  const requested = purgeRequestedAt(input.history)
  return {
    slug: input.slug,
    // A tenant under a hold is IN `LEGAL_HOLD`; the state machine has no other
    // way to express one. So this is a real reading rather than an assumption.
    legalHold: { active: input.state === "LEGAL_HOLD" },
    ...(requested
      ? { coolingOff: { requestedAt: requested.at, requestedBy: requested.actor } }
      : {}),
    // No approval: the C7 approval is recorded on the PURGE_PENDING → PURGING
    // transition, which by definition has not happened yet for any tenant this
    // panel is rendered for. Supplying a blank one would be inventing a record.
  }
}

export interface PurgeReadinessRow {
  check: PurgeCheckId
  verdict: "satisfied" | "blocked" | "unknown"
  detail: string
  /** What the Parent holds, from `PURGE_FACT_SOURCES`. */
  holds: string
  /** What would have to exist, or null when the registry can already answer. */
  needs: string | null
  /** The requirement's own sentence for this check. */
  demands: string
}

export interface PurgeReadiness {
  clearance: PurgeClearance
  rows: readonly PurgeReadinessRow[]
  /** How many of the seven the Parent can answer at all. */
  answerable: number
  /** The headline a console prints. Never "clear" when anything is unknown. */
  headline: string
}

/**
 * The whole panel's content, for one tenant, as at one instant.
 *
 * `at` is a parameter for the same reason it is on `purgeClearance`: a caller
 * that supplies both the start of a cooling-off period and the now can satisfy
 * any waiting period instantly.
 */
export function purgeReadiness(input: RegistryPurgeInputs, at: string): PurgeReadiness {
  const clearance = purgeClearance(purgeFactsFromRegistry(input), at)
  const sources = new Map(PURGE_FACT_SOURCES.map((s) => [s.check, s]))
  const demands = new Map(PURGE_CHECKS.map((c) => [c.id, c.demands]))

  const rows: PurgeReadinessRow[] = clearance.results.map((result) => {
    const source = sources.get(result.id)
    return {
      check: result.id,
      verdict: result.verdict,
      detail: result.detail,
      holds: source?.holds ?? "No source is declared for this check.",
      needs: source?.needs ?? null,
      demands: demands.get(result.id) ?? "",
    }
  })

  const answerable = rows.filter((r) => r.verdict !== "unknown").length
  const unknowns = rows.length - answerable

  return {
    clearance,
    rows,
    answerable,
    headline: clearance.cleared
      ? `All ${rows.length} pre-purge checks are satisfied.`
      : `${answerable} of ${rows.length} pre-purge checks can be answered from what the Parent ` +
        `holds; ${unknowns} cannot be answered at all. An unanswerable check is not a passed one.`,
  }
}
