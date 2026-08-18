/**
 * GE-103-013 — "Implement `PURGED_ZERO_INCREMENTAL_COST` only after complete
 * export/contract/retention/legal-hold/tax/audit/cooling-off checks and a
 * separate protected destructive human approval."
 *
 * The lifecycle graph already makes `PURGED_ZERO_INCREMENTAL_COST` reachable
 * from exactly one place — `PURGING` — and `PURGING` from exactly one place,
 * `PURGE_PENDING`. So there is one edge on which the whole sentence can be
 * enforced, and this module is what it is enforced with.
 *
 * ── Three verdicts, because two would be a lie ─────────────────────────────
 *
 * Every check answers `satisfied`, `blocked` or `unknown`, and `unknown` is the
 * one that carries the requirement. "We looked and the retention schedule has
 * expired" and "nobody told us whether there is a retention schedule" are
 * different answers, and a gate that collapses them into a boolean deletes a
 * customer's data on the strength of a field somebody forgot to populate.
 *
 * `unknown` therefore BLOCKS, exactly as `blocked` does, and is reported
 * separately so the operator is sent to publish the fact rather than to argue
 * with a refusal. There is no `undefined means fine` anywhere below.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * `at` is a parameter. Nothing here reads a clock, for the reason
 * `change-class.ts` gives about cooling-off: a caller that supplies both the
 * start and the now can satisfy any waiting period instantly, so the caller
 * supplies the now and the PERSISTED start comes from the facts.
 */

import { C7_COOLING_OFF_MS, classify, requirementsFor, type ChangeRequirements } from "./change-class"

/** The seven the requirement names, in the order it names them. */
export const PURGE_CHECK_IDS = [
  "export",
  "contract",
  "retention",
  "legal-hold",
  "tax",
  "audit",
  "cooling-off",
] as const

export type PurgeCheckId = (typeof PURGE_CHECK_IDS)[number]

export interface PurgeCheck {
  id: PurgeCheckId
  /** What has to be true before the data goes. */
  demands: string
  /** Why an absent fact is not a pass. Rendered on the `unknown` verdict. */
  ifUnknown: string
}

export const PURGE_CHECKS: readonly PurgeCheck[] = [
  {
    id: "export",
    demands:
      "The customer has taken their data, or has recorded a decision not to. A purge with no " +
      "export behind it destroys the only copy of records the customer is entitled to.",
    ifUnknown:
      "No export outcome was supplied. Nothing here can tell whether the customer already has " +
      "their data or has never been offered it.",
  },
  {
    id: "contract",
    demands:
      "The contract has ended and its obligations are discharged. Deleting during a live term " +
      "breaches the agreement that is still in force.",
    ifUnknown: "No contract end or discharge was supplied.",
  },
  {
    id: "retention",
    demands:
      "Every retention schedule covering this tenant's records has expired. A schedule is an " +
      "obligation to KEEP; purging inside one is the violation, not the omission.",
    ifUnknown: "No retention schedule was supplied — not even an empty one, which is a real answer.",
  },
  {
    id: "legal-hold",
    demands: "No legal hold is in force. A hold outranks every other consideration on this list.",
    ifUnknown: "Nobody confirmed whether a hold is in force.",
  },
  {
    id: "tax",
    demands:
      "Every tax retention period has expired in every jurisdiction this tenant files in. These " +
      "outlive the contract, routinely by years.",
    ifUnknown: "No tax retention periods were supplied for any jurisdiction.",
  },
  {
    id: "audit",
    demands:
      "An immutable evidence reference exists that will survive the purge. After the rows are " +
      "gone, this reference is the only thing that can show the purge was authorised and done.",
    ifUnknown: "No audit evidence reference was supplied.",
  },
  {
    id: "cooling-off",
    demands:
      `The C7 cooling-off period (${C7_COOLING_OFF_MS / 60000} minutes) has elapsed since the ` +
      "purge was requested. Measured against the persisted request time, never against a second " +
      "value the same caller supplies.",
    ifUnknown: "No persisted purge request time was supplied, so no period can have elapsed.",
  },
]

export type CheckVerdict = "satisfied" | "blocked" | "unknown"

/** An export happened, or a decision not to export was recorded. */
export type ExportOutcome =
  | { taken: true; completedAt: string; digest: string }
  | { taken: false; declinedBy: string; at: string; reason: string }

/**
 * The separate, protected, destructive human approval.
 *
 * `performedBy` is the field the word "human" is about. The other three make
 * the approval valid; this one says a PERSON carried out the destruction. C7 is
 * `automatable: false` — a null here means this platform was about to do it
 * itself, which is refused however correct the rest of the record is.
 */
export interface PurgeApproval {
  requestedBy: string
  approvedBy: string
  /** Whether the caller looked `approvedBy` up and found a platform operator. */
  approverIsOperator: boolean
  /** Compared with `===` against the token the change class demands. */
  typedConfirmation: string
  /** The human who ran the destructive act, or null when nobody did. */
  performedBy: string | null
}

/**
 * What the control plane has been told, and nothing it has assumed.
 *
 * Every field is optional in the TYPE and required in FACT: an absent field is
 * `unknown`, which blocks. Optionality here means "the caller may not have
 * looked", never "this may be skipped".
 */
export interface PurgeFacts {
  slug: string
  exportOutcome?: ExportOutcome
  contract?: { endedAt: string; obligationsDischarged: boolean }
  /** Every schedule covering this tenant. An EMPTY list is a real answer: none apply. */
  retention?: readonly { subject: string; expiresAt: string }[]
  legalHold?: { active: boolean; matterRef?: string }
  /** Every jurisdiction. An EMPTY list is a real answer: this tenant files nowhere. */
  tax?: readonly { jurisdiction: string; retainUntil: string }[]
  audit?: { evidenceRef: string; retainedUntil: string }
  coolingOff?: { requestedAt: string; requestedBy: string }
  approval?: PurgeApproval
}

export interface PurgeCheckResult {
  id: PurgeCheckId
  verdict: CheckVerdict
  /** Why, in the operator's terms. Never a restatement of the verdict. */
  detail: string
}

export interface PurgeClearance {
  slug: string
  at: string
  /** True only when all seven are `satisfied` AND the approval is complete. */
  cleared: boolean
  results: readonly PurgeCheckResult[]
  /** Everything not `satisfied`, in check order. */
  blockers: readonly PurgeCheckResult[]
  approval: {
    satisfied: boolean
    requirements: ChangeRequirements
    /** Every problem at once — an approval fixed one refusal at a time is a form. */
    problems: readonly string[]
  }
  /** One paragraph a console can print verbatim. */
  explanation: string
}

/** Milliseconds since an instant, or null when the instant cannot be read. */
function elapsed(from: string, at: string): number | null {
  const a = Date.parse(from)
  const b = Date.parse(at)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return b - a
}

/** Whether `deadline` is in the past relative to `at`, or null when unreadable. */
function expired(deadline: string, at: string): boolean | null {
  const ms = elapsed(deadline, at)
  return ms === null ? null : ms >= 0
}

function checkExport(f: PurgeFacts): PurgeCheckResult {
  const o = f.exportOutcome
  if (!o) return { id: "export", verdict: "unknown", detail: PURGE_CHECKS[0].ifUnknown }
  if (o.taken) {
    if (!o.digest.trim()) {
      return {
        id: "export",
        verdict: "blocked",
        detail:
          "An export is recorded with no digest. Without one nothing can show the customer " +
          "received the records that are about to be destroyed.",
      }
    }
    return {
      id: "export",
      verdict: "satisfied",
      detail: `Export completed ${o.completedAt}, digest ${o.digest}.`,
    }
  }
  if (!o.declinedBy.trim() || !o.reason.trim()) {
    return {
      id: "export",
      verdict: "blocked",
      detail:
        "An export was declined with no named decision-maker or no reason. A declined export is " +
        "a decision somebody made, and it has to be attributable after the data is gone.",
    }
  }
  return {
    id: "export",
    verdict: "satisfied",
    detail: `Export declined by ${o.declinedBy} on ${o.at}: ${o.reason}`,
  }
}

function checkContract(f: PurgeFacts, at: string): PurgeCheckResult {
  const c = f.contract
  if (!c) return { id: "contract", verdict: "unknown", detail: PURGE_CHECKS[1].ifUnknown }
  const ended = expired(c.endedAt, at)
  if (ended === null) {
    return {
      id: "contract",
      verdict: "unknown",
      detail: `"${c.endedAt}" is not a readable instant, so whether the term has ended is unknown.`,
    }
  }
  if (!ended) {
    return {
      id: "contract",
      verdict: "blocked",
      detail: `The term runs until ${c.endedAt}, which is after ${at}.`,
    }
  }
  if (!c.obligationsDischarged) {
    return {
      id: "contract",
      verdict: "blocked",
      detail: "The term has ended and its obligations are recorded as not yet discharged.",
    }
  }
  return { id: "contract", verdict: "satisfied", detail: `Term ended ${c.endedAt}, obligations discharged.` }
}

function checkRetention(f: PurgeFacts, at: string): PurgeCheckResult {
  const schedules = f.retention
  if (!schedules) return { id: "retention", verdict: "unknown", detail: PURGE_CHECKS[2].ifUnknown }
  const unreadable = schedules.filter((s) => expired(s.expiresAt, at) === null)
  if (unreadable.length > 0) {
    return {
      id: "retention",
      verdict: "unknown",
      detail: `Unreadable expiry on ${unreadable.map((s) => s.subject).join(", ")}.`,
    }
  }
  const live = schedules.filter((s) => expired(s.expiresAt, at) === false)
  if (live.length > 0) {
    return {
      id: "retention",
      verdict: "blocked",
      detail: `Still retained: ${live.map((s) => `${s.subject} until ${s.expiresAt}`).join("; ")}.`,
    }
  }
  return {
    id: "retention",
    verdict: "satisfied",
    detail:
      schedules.length === 0
        ? "No retention schedule covers this tenant — checked, and there are none."
        : `All ${schedules.length} schedules expired on or before ${at}.`,
  }
}

function checkLegalHold(f: PurgeFacts): PurgeCheckResult {
  const h = f.legalHold
  if (!h) return { id: "legal-hold", verdict: "unknown", detail: PURGE_CHECKS[3].ifUnknown }
  if (h.active) {
    return {
      id: "legal-hold",
      verdict: "blocked",
      detail: `A legal hold is in force${h.matterRef ? ` (${h.matterRef})` : ""}. Nothing may be destroyed.`,
    }
  }
  return { id: "legal-hold", verdict: "satisfied", detail: "No legal hold is in force." }
}

function checkTax(f: PurgeFacts, at: string): PurgeCheckResult {
  const periods = f.tax
  if (!periods) return { id: "tax", verdict: "unknown", detail: PURGE_CHECKS[4].ifUnknown }
  const unreadable = periods.filter((p) => expired(p.retainUntil, at) === null)
  if (unreadable.length > 0) {
    return {
      id: "tax",
      verdict: "unknown",
      detail: `Unreadable retention date for ${unreadable.map((p) => p.jurisdiction).join(", ")}.`,
    }
  }
  const live = periods.filter((p) => expired(p.retainUntil, at) === false)
  if (live.length > 0) {
    return {
      id: "tax",
      verdict: "blocked",
      detail: `Tax records must be kept: ${live.map((p) => `${p.jurisdiction} until ${p.retainUntil}`).join("; ")}.`,
    }
  }
  return {
    id: "tax",
    verdict: "satisfied",
    detail:
      periods.length === 0
        ? "This tenant files in no jurisdiction with a retention period — checked, and there are none."
        : `All ${periods.length} tax retention periods expired on or before ${at}.`,
  }
}

function checkAudit(f: PurgeFacts, at: string): PurgeCheckResult {
  const a = f.audit
  if (!a) return { id: "audit", verdict: "unknown", detail: PURGE_CHECKS[5].ifUnknown }
  if (!a.evidenceRef.trim()) {
    return {
      id: "audit",
      verdict: "blocked",
      detail: "The evidence reference is empty; nothing would survive the purge to prove it happened.",
    }
  }
  const survives = expired(a.retainedUntil, at)
  if (survives === null) {
    return {
      id: "audit",
      verdict: "unknown",
      detail: `"${a.retainedUntil}" is not a readable instant, so how long the evidence lasts is unknown.`,
    }
  }
  if (survives) {
    return {
      id: "audit",
      verdict: "blocked",
      detail:
        `The audit evidence at ${a.evidenceRef} was retained only until ${a.retainedUntil}, which ` +
        `is already past. Purging now would leave nothing that can show it was authorised.`,
    }
  }
  return {
    id: "audit",
    verdict: "satisfied",
    detail: `Evidence at ${a.evidenceRef} is retained until ${a.retainedUntil}, beyond this purge.`,
  }
}

function checkCoolingOff(f: PurgeFacts, at: string): PurgeCheckResult {
  const c = f.coolingOff
  if (!c) return { id: "cooling-off", verdict: "unknown", detail: PURGE_CHECKS[6].ifUnknown }
  const ms = elapsed(c.requestedAt, at)
  if (ms === null) {
    return {
      id: "cooling-off",
      verdict: "unknown",
      detail: `"${c.requestedAt}" is not a readable instant, so no elapsed time can be computed.`,
    }
  }
  if (ms < C7_COOLING_OFF_MS) {
    const left = Math.ceil((C7_COOLING_OFF_MS - ms) / 60000)
    return {
      id: "cooling-off",
      verdict: "blocked",
      detail: `Requested by ${c.requestedBy} at ${c.requestedAt}; ${left} more minute(s) to wait.`,
    }
  }
  return {
    id: "cooling-off",
    verdict: "satisfied",
    detail: `Requested by ${c.requestedBy} at ${c.requestedAt}; the period has elapsed.`,
  }
}

/**
 * Whether the destructive approval is complete, and every way in which it is not.
 *
 * The class and its demands are not invented here: purging is
 * `{ surface: "tenant-lifecycle", action: "PURGING" }`, which `classify`
 * already puts in C7. A change to the taxonomy therefore reaches this gate
 * instead of leaving it enforcing last year's rule.
 */
function approvalProblems(
  approval: PurgeApproval | undefined,
  requirements: ChangeRequirements,
  slug: string,
): readonly string[] {
  if (!approval) {
    return [
      "No approval record was supplied. An absent approval is a refusal, not a default — a caller " +
        "that forgets the field must not be able to skip the control by omission.",
    ]
  }
  const problems: string[] = []
  if (!approval.requestedBy.trim()) problems.push("Nobody is recorded as having requested the purge.")
  if (!approval.approvedBy.trim()) problems.push("Nobody is recorded as having approved it.")
  if (approval.approvedBy.trim() && approval.approvedBy === approval.requestedBy) {
    problems.push(
      `${approval.requestedBy} cannot approve their own purge. Two identities means two people.`,
    )
  }
  if (approval.approverIsOperator !== true) {
    problems.push(
      `"${approval.approvedBy}" was not verified as a platform operator. An unverified approver ` +
        `is a free-text field, and this is the one action with no undo.`,
    )
  }
  if (requirements.typedConfirmation !== null) {
    if (approval.typedConfirmation !== requirements.typedConfirmation) {
      problems.push(
        `The typed confirmation must be exactly "${requirements.typedConfirmation}" — the tenant's ` +
          `own name, so typing it is the act of reading which tenant is about to be destroyed.`,
      )
    }
  }
  if (requirements.automatable === false && !approval.performedBy?.trim()) {
    problems.push(
      `${slug}'s purge is not automatable: a person runs it. No performer is recorded, which ` +
        `means this platform was about to destroy the data itself.`,
    )
  }
  return problems
}

/**
 * The whole gate, in one answer.
 *
 * Every check runs even when an earlier one blocks. An operator who fixes one
 * refusal and is immediately handed the next has been made to discover the list
 * one item at a time, which for a fifteen-minute cooling-off period means a
 * whole afternoon.
 */
export function purgeClearance(facts: PurgeFacts, at: string): PurgeClearance {
  const results: PurgeCheckResult[] = [
    checkExport(facts),
    checkContract(facts, at),
    checkRetention(facts, at),
    checkLegalHold(facts),
    checkTax(facts, at),
    checkAudit(facts, at),
    checkCoolingOff(facts, at),
  ]

  const requirements = requirementsFor(
    classify({ surface: "tenant-lifecycle", action: "PURGING", target: facts.slug }),
    facts.slug,
  )
  const problems = approvalProblems(facts.approval, requirements, facts.slug)

  const blockers = results.filter((r) => r.verdict !== "satisfied")
  const cleared = blockers.length === 0 && problems.length === 0

  const unknowns = blockers.filter((b) => b.verdict === "unknown")
  const explanation = cleared
    ? `All ${PURGE_CHECK_IDS.length} pre-purge checks are satisfied for ${facts.slug} as at ${at}, ` +
      `and the destructive approval is complete. What follows cannot be undone.`
    : [
        `${facts.slug} is not cleared for purge as at ${at}.`,
        blockers.length > 0
          ? `${blockers.length} of ${PURGE_CHECK_IDS.length} checks are not satisfied` +
            (unknowns.length > 0
              ? `, and ${unknowns.length} of those ${unknowns.length === 1 ? "is" : "are"} unknown ` +
                `rather than failed — publish the fact, then evaluate again. An unknown is not a no, ` +
                `and it is certainly not a yes.`
              : ".")
          : "",
        ...blockers.map((b) => `  ${b.id} (${b.verdict}): ${b.detail}`),
        problems.length > 0 ? `The destructive approval is incomplete:` : "",
        ...problems.map((p) => `  ${p}`),
      ]
        .filter(Boolean)
        .join("\n")

  return {
    slug: facts.slug,
    at,
    cleared,
    results,
    blockers,
    approval: { satisfied: problems.length === 0, requirements, problems },
    explanation,
  }
}
