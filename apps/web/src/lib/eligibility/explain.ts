import type { Decision, DecisionReceipt, EligibilityOutcome, Fact } from "./evaluate"
import type { SourceRole } from "./policy"
import { SHIPPED_POLICY_ARCHIVE, type ArchivedPolicyVersion, type PolicyArchive } from "./policy-archive"
import { sealReceipt, subjectPseudonym, type SealedReceipt } from "./receipt"

/**
 * IER-070-010 — "Implement safe end-user, admin, auditor, and operator
 * explanation layers."
 *
 * Bible §12.3 names four audiences and gives each a different sentence:
 *
 *  - **End user** — "generic safe outcome and actionable next step without
 *    revealing tenant membership or sensitive policy."
 *  - **Tenant access admin** — "masked reason codes, source freshness,
 *    required remediation, and decision timeline."
 *  - **Authorized investigator/auditor** — "complete policy/version/source/
 *    evidence trace under purpose-based access."
 *  - **Platform operator** — "system health and technical failure without
 *    default access to tenant PII."
 *
 * and then the rule that binds them: "'Why allowed?' and 'Why denied?' must be
 * answerable without exposing another person, hidden resource existence,
 * protected attributes, or raw source records."
 *
 * ## Four projections, not one payload with flags
 *
 * The tempting shape is one explanation object with `if (isAdmin)` around the
 * risky fields. That shape has failed here before: the whole object gets built,
 * logged, cached and serialised once, and the filter is applied at the last
 * hop by whichever caller remembered. So each audience gets a SEPARATE type
 * that never holds the field it may not see. An end-user explanation has no
 * `policyDigest` property to leak, not a null one.
 *
 * ## Purpose-based access is a refusal, not a comment
 *
 * The auditor layer is the only one that returns raw subject identity and the
 * full policy document, and §12.3 conditions it on purpose. `explainDecision`
 * therefore refuses an auditor request that states no purpose and says so, in
 * band, as a returned refusal rather than a thrown error — a caller that
 * forgot the purpose should render "not available" and not a stack trace.
 *
 * ## The historical part
 *
 * The auditor trace resolves the receipt's own `policyDigest` through the
 * policy archive (IER-070-009). A decision made under a superseded version is
 * explained by the version that made it. When the digest is not archived the
 * trace says `POLICY_VERSION_NOT_ARCHIVED` and returns no document at all,
 * because describing a historical decision with today's rules is worse than
 * declining to describe it.
 */

export const EXPLANATION_AUDIENCES = [
  "END_USER",
  "TENANT_ACCESS_ADMIN",
  "AUDITOR",
  "PLATFORM_OPERATOR",
] as const
export type ExplanationAudience = (typeof EXPLANATION_AUDIENCES)[number]

/** What the subject is told. Four states, none of which names a policy. */
export const SUBJECT_DISPOSITIONS = ["ALLOWED", "ACTION_NEEDED", "UNDER_REVIEW", "NOT_AVAILABLE"] as const
export type SubjectDisposition = (typeof SUBJECT_DISPOSITIONS)[number]

/**
 * Eight outcomes to four dispositions.
 *
 * Exhaustive by type: adding an outcome to `ELIGIBILITY_OUTCOMES` without
 * deciding what the subject is told about it is a compile error, which is the
 * only way this table stays complete.
 */
const SUBJECT_DISPOSITION: Readonly<Record<EligibilityOutcome, SubjectDisposition>> = {
  ELIGIBLE: "ALLOWED",
  // The conditions ARE the access and they are unmet: there is something to do.
  CONDITIONALLY_ELIGIBLE: "ACTION_NEEDED",
  // A date to wait for is an action in the sense that matters: the person knows
  // nothing is wrong and nobody needs to be called.
  PENDING_EFFECTIVE_DATE: "ACTION_NEEDED",
  SUSPENDED: "ACTION_NEEDED",
  EXPIRED: "ACTION_NEEDED",
  INELIGIBLE: "NOT_AVAILABLE",
  // Neither denied nor granted. Telling a person "denied" when the truth is
  // "we could not look" sends them to appeal a decision nobody made.
  INDETERMINATE: "UNDER_REVIEW",
  MANUAL_REVIEW_REQUIRED: "UNDER_REVIEW",
}

/**
 * Fixed sentences. No interpolation, by construction.
 *
 * A template with a value in it is how a person's own record leaks into a
 * string that then gets logged, emailed and screenshotted. There are four
 * sentences because there are four dispositions.
 */
const SUBJECT_NEXT_STEP: Readonly<Record<SubjectDisposition, string>> = {
  ALLOWED: "No action is needed.",
  ACTION_NEEDED:
    "There is an outstanding step on your account. Complete it, or ask your institution's access administrator if you are not sure what it is.",
  UNDER_REVIEW:
    "Nothing is needed from you right now. Access is still being checked and you will be told when there is an answer.",
  NOT_AVAILABLE:
    "This workspace is not available to you. Your institution's access administrator can tell you why and what would change it.",
}

export interface EndUserExplanation {
  audience: "END_USER"
  disposition: SubjectDisposition
  nextStep: string
  /**
   * Remediation codes the subject can act on, and only those.
   *
   * A code carrying a `:` is an engine-internal code naming an attribute
   * (`STALE:affiliation.status`); it is withheld and counted rather than shown,
   * because the shape of the internal fact model is not the subject's business
   * and a count is still an honest signal that something was withheld.
   */
  actionCodes: readonly string[]
  withheldCodeCount: number
}

export interface AdminSourceFreshness {
  attribute: string
  sourceId: string
  sourceRole: SourceRole
  observedAt: string
  /** Milliseconds between the assertion and the evaluation clock, or null when either is unusable. */
  ageMs: number | null
  stale: boolean
}

export interface TimelineEntry {
  at: string
  event: string
}

export interface AdminExplanation {
  audience: "TENANT_ACCESS_ADMIN"
  outcome: EligibilityOutcome
  policyId: string
  policyVersion: string
  policyDigest: string
  /** Codes truncated past their second segment; see `maskCode`. */
  maskedReasonCodes: readonly string[]
  remediation: readonly string[]
  sourceFreshness: readonly AdminSourceFreshness[]
  timeline: readonly TimelineEntry[]
  subjectRef: string
}

export interface AuditorExplanation {
  audience: "AUDITOR"
  refused: false
  purpose: string
  outcome: EligibilityOutcome
  receipt: DecisionReceipt
  /** The version that MADE this decision, from the archive. Null when unarchived. */
  policyVersion: ArchivedPolicyVersion | null
  /** `POLICY_VERSION_NOT_ARCHIVED` when the digest resolves to nothing. */
  notes: readonly string[]
}

export interface RefusedExplanation {
  audience: "AUDITOR"
  refused: true
  refusal: "PURPOSE_REQUIRED"
}

export interface OperatorExplanation {
  audience: "PLATFORM_OPERATOR"
  outcome: EligibilityOutcome
  policyId: string
  policyVersion: string
  policyDigest: string
  /** Only codes on the operational list. Everything else is counted, not shown. */
  operationalCodes: readonly string[]
  withheldCodeCount: number
  sourceHealth: readonly { sourceId: string; stale: boolean; ageMs: number | null }[]
  staleSourceCount: number
}

export type Explanation =
  | EndUserExplanation
  | AdminExplanation
  | AuditorExplanation
  | RefusedExplanation
  | OperatorExplanation

/**
 * Keep a code's kind and its attribute; drop anything after that.
 *
 * `STALE:affiliation.status` survives whole — an admin who cannot see which
 * fact went stale cannot do the job §12.3 gives them. A third segment is where
 * a policy author's free-text code could carry a value, and it becomes `…`.
 */
export function maskCode(code: string): string {
  const parts = code.split(":")
  if (parts.length <= 2) return code
  return `${parts[0]}:${parts[1]}:…`
}

/**
 * Codes an operator may see without any tenant context.
 *
 * The list is about system health, exactly as §12.3 says: a source that could
 * not be reached, a policy outside its window, an engine defect, an attribute
 * whose value the engine could not parse. `AFFILIATION_SUSPENDED` is not here,
 * and neither is anything else that describes a person.
 */
const OPERATIONAL_CODES: readonly string[] = ["ENGINE_ERROR", "POLICY_NOT_YET_ACTIVE", "POLICY_EXPIRED"]
const OPERATIONAL_PREFIXES: readonly string[] = [
  "SOURCE_UNAVAILABLE:",
  "STALE:",
  "MALFORMED:",
  "NOT_A_DECIDING_ATTRIBUTE:",
]

function isOperational(code: string): boolean {
  return (
    OPERATIONAL_CODES.includes(code) ||
    OPERATIONAL_PREFIXES.some((prefix) => code.startsWith(prefix))
  )
}

function ageMsOf(evaluatedAt: string, observedAt: string): number | null {
  const at = Date.parse(evaluatedAt)
  const observed = Date.parse(observedAt)
  if (Number.isNaN(at) || Number.isNaN(observed)) return null
  return at - observed
}

export interface ExplainOptions {
  /** Required for AUDITOR (§12.3 purpose-based access). Ignored by the others. */
  purpose?: string
  /** Facts the decision read, so a sealed receipt can be scanned. Admin/operator only. */
  facts?: readonly Fact[]
  /** Defaults to the archive of policies this deployment ships. */
  archive?: PolicyArchive
}

/**
 * The one entry point. Which audience is asking decides what exists in the answer.
 */
export function explainDecision(
  decision: Decision,
  audience: ExplanationAudience,
  options: ExplainOptions = {},
): Explanation {
  const receipt = decision.receipt

  if (audience === "END_USER") {
    const disposition = SUBJECT_DISPOSITION[decision.outcome]
    const actionCodes = decision.remediation.filter((code) => !code.includes(":"))
    return {
      audience: "END_USER",
      disposition,
      nextStep: SUBJECT_NEXT_STEP[disposition],
      actionCodes,
      withheldCodeCount: decision.remediation.length - actionCodes.length,
    }
  }

  if (audience === "AUDITOR") {
    const purpose = (options.purpose ?? "").trim()
    if (purpose.length === 0) {
      return { audience: "AUDITOR", refused: true, refusal: "PURPOSE_REQUIRED" }
    }
    const archive = options.archive ?? SHIPPED_POLICY_ARCHIVE
    const policyVersion = archive.byDigest(receipt.policyDigest)
    return {
      audience: "AUDITOR",
      refused: false,
      purpose,
      outcome: decision.outcome,
      receipt,
      policyVersion,
      notes: policyVersion === null ? ["POLICY_VERSION_NOT_ARCHIVED"] : [],
    }
  }

  const sealed: SealedReceipt = sealReceipt(receipt, options.facts ?? [])

  if (audience === "TENANT_ACCESS_ADMIN") {
    const sourceFreshness = sealed.sourceRevisions.map((revision) => ({
      attribute: revision.attribute,
      sourceId: revision.sourceId,
      sourceRole: revision.sourceRole,
      observedAt: revision.observedAt,
      ageMs: ageMsOf(receipt.evaluatedAt, revision.observedAt),
      stale: revision.stale,
    }))
    const timeline: TimelineEntry[] = [
      ...sealed.sourceRevisions.map((revision) => ({
        at: revision.observedAt,
        event: `SOURCE_ASSERTED:${revision.sourceId}`,
      })),
      { at: receipt.evaluatedAt, event: `DECIDED:${receipt.outcome}` },
    ].sort((a, b) => {
      const left = Date.parse(a.at)
      const right = Date.parse(b.at)
      if (Number.isNaN(left) || Number.isNaN(right)) return 0
      return left - right
    })
    return {
      audience: "TENANT_ACCESS_ADMIN",
      outcome: decision.outcome,
      policyId: receipt.policyId,
      policyVersion: receipt.policyVersion,
      policyDigest: receipt.policyDigest,
      maskedReasonCodes: sealed.reasonCodes.map(maskCode),
      remediation: decision.remediation.map(maskCode),
      sourceFreshness,
      timeline,
      subjectRef: sealed.subjectRef,
    }
  }

  const operationalCodes = sealed.reasonCodes.filter(isOperational)
  const sourceHealth = sealed.sourceRevisions.map((revision) => ({
    sourceId: revision.sourceId,
    stale: revision.stale,
    ageMs: ageMsOf(receipt.evaluatedAt, revision.observedAt),
  }))
  return {
    audience: "PLATFORM_OPERATOR",
    outcome: decision.outcome,
    policyId: receipt.policyId,
    policyVersion: receipt.policyVersion,
    policyDigest: receipt.policyDigest,
    operationalCodes,
    withheldCodeCount: sealed.reasonCodes.length - operationalCodes.length,
    sourceHealth,
    staleSourceCount: sourceHealth.filter((entry) => entry.stale).length,
  }
}

export { subjectPseudonym }
