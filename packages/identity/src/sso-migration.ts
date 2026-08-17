import type { ExternalIdentity } from "./entities"

/**
 * IER-100-008 and IER-100-011 — the enterprise SSO migration wave ladder, and
 * what rolling one back is allowed to create.
 *
 * The Bible's §15.2 lists ten stages and then one sentence that is the whole
 * substance of the requirement:
 *
 *   > Each wave has counts, exceptions, failed links, duplicate profiles,
 *   > support plan, session behavior, rollback, and approval.
 *
 * A migration that is a boolean — `ssoEnabled` — has none of those. It also has
 * no way to express the two states that actually matter on the day: a cohort
 * that is half linked, and a person who cannot get in. Both of those are
 * ordinary, and both are invisible to a flag.
 *
 * ## The ladder is ordered, and advancing one step at a time is the point
 *
 * `MIGRATION_WAVES` is in order. `planWaveAdvance` refuses a jump, because every
 * skipped wave is a wave whose counts nobody produced: going from `PILOT`
 * straight to `SSO_REQUIRED` means the hybrid period during which failed links
 * surface never happened, and the first person to discover a failed link is
 * someone who can no longer sign in.
 *
 * ## Rollback is a period, not a permanent state
 *
 * `ROLLBACK_WINDOW` is listed by §15.2 *after* local-login disablement, which
 * reads oddly until you notice what it means: it is the window in which
 * rollback is still possible, not one in which the old method is switched back
 * on. So `localLoginPermitted("ROLLBACK_WINDOW")` is false. Rolling back is a
 * deliberate, approved act (`planWaveRollback`) that returns the tenant to
 * `HYBRID`; it is not the ambient state of the window.
 *
 * ## Rollback must not mint a second authority (IER-100-011)
 *
 * The tempting implementation of "restore password sign-in" is to create a
 * local credential and send a reset link. That is a *new* way to be this
 * person, established without the evidence the original link required — which
 * is exactly the duplicate authority the requirement forbids. So a rollback
 * returns `reactivateIdentityIds`: ids that were already there. After `RETIRED`
 * there are none, and the refusal says so rather than helpfully inventing one —
 * recovery at that point is a reviewed re-link, which is a decision with a
 * person on the other side of it.
 */

/**
 * The waves, in order.
 *
 * All ten stages §15.2 names, mapped onto the seven the requirement names
 * (test, pilot, hybrid, preferred, required, disablement, retirement) plus the
 * three that precede or interleave with them (discovery, pre-link, rollback
 * window). The order is load-bearing: `planWaveAdvance` reads it.
 */
export const MIGRATION_WAVES = [
  /** Attribute contract agreed with the institution. Nothing about login moves. */
  "DISCOVERY",
  /** A test IdP and non-production users only. No production person signs in through it. */
  "TEST_IDP",
  /** High-confidence users pre-linked from an approved cross-reference. Still no login change. */
  "PRE_LINK",
  /** A named cohort may use SSO. */
  "PILOT",
  /** Both methods live. This is where failed links surface while there is still a way in. */
  "HYBRID",
  /** SSO is offered first; the local method still works. */
  "SSO_PREFERRED",
  /** The local method is refused. Credentials still exist. */
  "SSO_REQUIRED",
  /** Local credentials are disabled. */
  "LOCAL_DISABLED",
  /** The period in which the previous two steps can still be undone. */
  "ROLLBACK_WINDOW",
  /** The old method is retired. There is nothing left to reactivate. */
  "RETIRED",
] as const

export type MigrationWave = (typeof MIGRATION_WAVES)[number]

export function isMigrationWave(value: string): value is MigrationWave {
  return (MIGRATION_WAVES as readonly string[]).includes(value)
}

/** Position in the ladder. `-1` for a value that is not a wave. */
export function waveIndex(wave: string): number {
  return (MIGRATION_WAVES as readonly string[]).indexOf(wave)
}

/**
 * Waves in which the local (password / invitation) method may still be offered.
 *
 * A set rather than an index comparison, because the ladder is not monotonic in
 * this property: `ROLLBACK_WINDOW` sits after `LOCAL_DISABLED` and local login
 * is off in both. An `index <= waveIndex("SSO_PREFERRED")` test would read as
 * tidier and would silently switch passwords back on for the whole rollback
 * window.
 */
const LOCAL_LOGIN_WAVES: ReadonlySet<MigrationWave> = new Set([
  "DISCOVERY",
  "TEST_IDP",
  "PRE_LINK",
  "PILOT",
  "HYBRID",
  "SSO_PREFERRED",
])

export function localLoginPermitted(wave: MigrationWave): boolean {
  return LOCAL_LOGIN_WAVES.has(wave)
}

export type LoginAudience = "PRODUCTION" | "NON_PRODUCTION"

/**
 * Whether the federated method is offered at this wave.
 *
 * `DISCOVERY` and `PRE_LINK` are deliberately false for both audiences: both are
 * back-office stages — an attribute contract and a pre-linking run — and drawing
 * an SSO button during either sends people at a provider that is not ready for
 * them. `TEST_IDP` is true for non-production users only, which is what "test
 * IdP and non-production users" means.
 *
 * Cohort membership is NOT a wave property and is deliberately absent: whether
 * a particular person is in the pilot cohort is an eligibility decision about
 * that person, and answering it here would put a roster inside a state machine.
 */
export function ssoOffered(wave: MigrationWave, audience: LoginAudience): boolean {
  if (wave === "DISCOVERY" || wave === "PRE_LINK") return false
  if (wave === "TEST_IDP") return audience === "NON_PRODUCTION"
  return true
}

export type SessionEffect =
  | { sessions: "UNCHANGED"; detail: string }
  | { sessions: "REVOKE_LOCAL_CREDENTIAL_SESSIONS"; detail: string }

/**
 * What entering a wave does to sessions that are already open.
 *
 * §15.2 requires each wave to declare this. The one that matters is
 * `SSO_REQUIRED`: a session opened with a password must not outlive the wave
 * that stops accepting passwords, or the control does nothing for the length of
 * the absolute session timeout and the people it was aimed at are the ones least
 * likely to notice.
 */
export function sessionEffect(entering: MigrationWave): SessionEffect {
  if (entering === "SSO_REQUIRED" || entering === "LOCAL_DISABLED" || entering === "RETIRED") {
    return {
      sessions: "REVOKE_LOCAL_CREDENTIAL_SESSIONS",
      detail:
        "Sessions opened with the local method are revoked on entry. A session that outlives the wave " +
        "forbidding the credential it was opened with makes the wave decorative for as long as the " +
        "absolute timeout allows.",
    }
  }
  return {
    sessions: "UNCHANGED",
    detail: "No session is ended by entering this wave. Both methods remain acceptable within it.",
  }
}

/**
 * Whether a rollback is still possible from this wave.
 *
 * Derived here and consumed by `recoveryPath` and `planWaveRollback` so there is
 * one answer. Two functions each deciding "can we still go back" is how a page
 * comes to offer a recovery route the engine refuses.
 */
export function rollbackAvailable(wave: MigrationWave): boolean {
  if (wave === "DISCOVERY" || wave === "TEST_IDP" || wave === "PRE_LINK") return false
  return wave !== "RETIRED"
}

export type RecoveryPath =
  /** The old method is on. Somebody locked out of SSO signs in the way they used to. */
  | { path: "LOCAL_LOGIN"; detail: string }
  /** The old method is off but reactivatable. Support can roll the tenant back. */
  | { path: "OPERATOR_ROLLBACK"; detail: string }
  /** Nothing to reactivate. A new credential needs the reviewed link flow. */
  | { path: "REVIEWED_RELINK"; detail: string }

/**
 * What somebody who cannot get in is actually offered, per wave.
 *
 * This exists because it is the sentence a sign-in page has to print, and
 * getting it wrong is worse than printing nothing: "ask us to restore password
 * sign-in" after retirement sends a person to a support queue that will refuse
 * them, and the alternative an unwary support process reaches for at that point
 * is to create them a fresh local account — the duplicate authority IER-100-011
 * forbids.
 */
export function recoveryPath(wave: MigrationWave): RecoveryPath {
  if (localLoginPermitted(wave)) {
    return {
      path: "LOCAL_LOGIN",
      detail: "Your previous sign-in method still works. Use it if single sign-on does not.",
    }
  }
  if (rollbackAvailable(wave)) {
    return {
      path: "OPERATOR_ROLLBACK",
      detail:
        "Single sign-on is the only method for this workspace. If it is not working, your administrator " +
        "can restore the previous method for everyone while the problem is investigated.",
    }
  }
  return {
    path: "REVIEWED_RELINK",
    detail:
      "The previous sign-in method has been retired, so it cannot be switched back on. Access is restored " +
      "by linking your account to single sign-on again, which someone has to check — a new password account " +
      "would be a second way to be you that nobody verified.",
  }
}

export interface WaveCounts {
  /** People this wave covers. */
  inScope: number
  /** Of those, how many hold a federated credential. */
  linked: number
  /** Attempts that ended in a refusal or a manual review. */
  failedLinks: number
  /** Distinct people believed to hold two records. Not a warning — a blocker. */
  duplicateProfiles: number
}

export interface WaveException {
  personId: string
  reason: string
  authorizedBy: string
  /** Null is allowed and means indefinite, which is why it must be deliberate. */
  expiresAt: string | null
}

export interface WaveApproval {
  requestedBy: string
  approvedBy: string
  approvedAt: string
  /** The digest of the plan that was approved, so approval binds to a version. */
  digest: string
}

export interface WaveRecord {
  wave: MigrationWave
  counts: WaveCounts
  exceptions: readonly WaveException[]
  /** How support handles somebody locked out during this wave. */
  supportPlan: string
  /** What entering this wave does to open sessions. Compared against `sessionEffect`. */
  sessionEffect: SessionEffect
  /** How to get back to the previous wave. */
  rollbackPlan: string
  approval: WaveApproval | null
}

export interface WaveProblem {
  field: string
  detail: string
}

/**
 * Everything §15.2 requires a wave to carry, checked.
 *
 * The two rules worth reading are the last two.
 *
 * `failedLinks` is compared against the number of exceptions rather than
 * required to be zero, because a migration with zero failed links is a
 * migration nobody has run. The property that matters is that every failed link
 * is somebody a named person decided about; the difference between the two
 * counts is people who cannot sign in and about whom no decision exists.
 *
 * `duplicateProfiles` must be zero, and that asymmetry is deliberate. A failed
 * link is a person who cannot get in — visible, and they will tell you. A
 * duplicate profile is two records for one human, both working, quietly
 * dividing their history; advancing past it makes the split permanent and the
 * seat count wrong.
 */
export function waveRecordProblems(record: WaveRecord): readonly WaveProblem[] {
  const problems: WaveProblem[] = []
  const { counts } = record

  for (const [field, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      problems.push({ field: `counts.${field}`, detail: `${field} is ${value}; a count is a non-negative integer.` })
    }
  }
  if (counts.linked > counts.inScope) {
    problems.push({
      field: "counts.linked",
      detail:
        `${counts.linked} people are linked out of ${counts.inScope} in scope. More links than people means ` +
        `the scope is wrong or a person has two, and either way the numbers below it cannot be read.`,
    })
  }

  if (!record.supportPlan.trim() || record.supportPlan.trim().length < 20) {
    problems.push({
      field: "supportPlan",
      detail:
        "No support plan. Every wave locks somebody out; the plan is what the person answering them does, " +
        "and writing it afterwards means the first few are handled by improvisation.",
    })
  }
  if (!record.rollbackPlan.trim() || record.rollbackPlan.trim().length < 20) {
    problems.push({
      field: "rollbackPlan",
      detail: "No rollback plan. A wave that cannot be undone is not a wave, it is a cutover.",
    })
  }

  const expected = sessionEffect(record.wave)
  if (record.sessionEffect.sessions !== expected.sessions) {
    problems.push({
      field: "sessionEffect",
      detail:
        `This record says entering ${record.wave} is ${record.sessionEffect.sessions}; the engine says ` +
        `${expected.sessions}. The record is what an operator reads and the engine is what happens.`,
    })
  }

  record.exceptions.forEach((exception, index) => {
    if (!exception.personId.trim()) {
      problems.push({ field: `exceptions[${index}].personId`, detail: "An exception for nobody." })
    }
    if (exception.reason.trim().length < 12) {
      problems.push({
        field: `exceptions[${index}].reason`,
        detail: "An exception with no reason is an exception nobody can review or withdraw.",
      })
    }
    if (!exception.authorizedBy.trim()) {
      problems.push({
        field: `exceptions[${index}].authorizedBy`,
        detail: "An exception nobody authorized. Somebody has to be answerable for a person kept outside the wave.",
      })
    }
  })

  if (counts.failedLinks > record.exceptions.length) {
    problems.push({
      field: "counts.failedLinks",
      detail:
        `${counts.failedLinks} links failed and ${record.exceptions.length} exceptions are recorded. The ` +
        `difference is people who cannot sign in and whom nobody has decided about.`,
    })
  }
  if (counts.duplicateProfiles > 0) {
    problems.push({
      field: "counts.duplicateProfiles",
      detail:
        `${counts.duplicateProfiles} duplicate profiles are unresolved. Advancing splits one person's history ` +
        `across two records permanently, and counts every one of them twice.`,
    })
  }

  const approval = record.approval
  if (approval === null) {
    problems.push({ field: "approval", detail: "Not approved. A wave nobody approved is a change nobody agreed to." })
  } else {
    if (!approval.requestedBy.trim() || !approval.approvedBy.trim()) {
      problems.push({ field: "approval", detail: "An approval needs both a requester and an approver." })
    } else if (approval.requestedBy === approval.approvedBy) {
      problems.push({
        field: "approval.approvedBy",
        detail: `${approval.approvedBy} both requested and approved this wave, which is one person, not a review.`,
      })
    }
    if (!approval.digest.trim()) {
      problems.push({
        field: "approval.digest",
        detail:
          "An approval with no digest is an approval of whatever the plan says now. It has to bind to the " +
          "version that was read.",
      })
    }
  }

  return problems
}

export type AdvanceRefusal = "NOT_AN_ADVANCE" | "SKIPPED_WAVE" | "RECORD_FOR_ANOTHER_WAVE" | "RECORD_INCOMPLETE"

export interface AdvanceRefused {
  advanced: false
  reason: AdvanceRefusal
  detail: string
  /** Present for RECORD_INCOMPLETE, so the operator sees all of it at once. */
  problems?: readonly WaveProblem[]
}

export interface AdvanceGranted {
  advanced: true
  wave: MigrationWave
  sessionEffect: SessionEffect
  localLoginPermitted: boolean
  recovery: RecoveryPath
}

export type AdvanceOutcome = AdvanceGranted | AdvanceRefused

/**
 * Move one step up the ladder, or refuse and say why.
 *
 * Pure: the caller persists the new wave and the record together, or neither.
 */
export function planWaveAdvance(from: MigrationWave, to: MigrationWave, record: WaveRecord): AdvanceOutcome {
  const fromIndex = waveIndex(from)
  const toIndex = waveIndex(to)

  if (toIndex <= fromIndex) {
    return {
      advanced: false,
      reason: "NOT_AN_ADVANCE",
      detail:
        `${to} is not after ${from}. Going back down the ladder is a rollback — an approved act with its own ` +
        `refusals — and doing it through this function would skip all of them.`,
    }
  }
  if (toIndex !== fromIndex + 1) {
    return {
      advanced: false,
      reason: "SKIPPED_WAVE",
      detail:
        `${from} to ${to} skips ${toIndex - fromIndex - 1} wave(s). Each skipped wave is one whose counts ` +
        `nobody produced, and the first person to find a failed link is someone who can no longer sign in.`,
    }
  }
  if (record.wave !== to) {
    return {
      advanced: false,
      reason: "RECORD_FOR_ANOTHER_WAVE",
      detail: `This record is for ${record.wave}, and the advance is to ${to}.`,
    }
  }

  const problems = waveRecordProblems(record)
  if (problems.length > 0) {
    return {
      advanced: false,
      reason: "RECORD_INCOMPLETE",
      detail: `${problems.length} thing(s) this wave has to carry are missing or wrong.`,
      problems,
    }
  }

  return {
    advanced: true,
    wave: to,
    sessionEffect: sessionEffect(to),
    localLoginPermitted: localLoginPermitted(to),
    recovery: recoveryPath(to),
  }
}

export type RollbackRefusal =
  | "NOTHING_TO_ROLL_BACK"
  | "OLD_METHOD_RETIRED"
  | "NO_LOCAL_CREDENTIAL"
  | "SELF_APPROVED"
  | "NO_REASON"

export interface RollbackRequest {
  requestedBy: string
  approvedBy: string
  reason: string
  /**
   * The tenant's existing local credentials, revoked ones included.
   *
   * Deliberately the whole reason this function can decide anything: a rollback
   * reactivates rows that are already here. There is no field on this request
   * for a credential to create, which is what makes minting one unwritable
   * rather than merely discouraged.
   */
  localIdentities: readonly ExternalIdentity[]
  at: Date
}

export interface RollbackRefused {
  rolledBack: false
  reason: RollbackRefusal
  detail: string
}

export interface RollbackGranted {
  rolledBack: true
  /** Where the tenant lands: the last wave in which both methods are live. */
  to: MigrationWave
  /**
   * Identities to set back to ACTIVE. Every id came in on the request; this
   * function has no way to produce one that did not.
   */
  reactivateIdentityIds: readonly string[]
  sessionEffect: SessionEffect
  detail: string
}

export type RollbackOutcome = RollbackGranted | RollbackRefused

/** The wave a rollback lands on: both methods live, so nobody is locked out mid-investigation. */
export const ROLLBACK_TARGET: MigrationWave = "HYBRID"

/**
 * Undo a migration, without creating a second way to be somebody.
 *
 * The refusal that carries the requirement is `OLD_METHOD_RETIRED`. At that
 * point the honest answer is that there is nothing to switch back on, and the
 * unhelpful-looking refusal is the feature: the helpful version creates a local
 * credential and emails a reset link, which establishes a way to authenticate as
 * this person without any of the evidence the original link required. That is
 * the duplicate authority, and it arrives labelled as customer service.
 */
export function planWaveRollback(from: MigrationWave, request: RollbackRequest): RollbackOutcome {
  if (!rollbackAvailable(from)) {
    if (from === "RETIRED") {
      return {
        rolledBack: false,
        reason: "OLD_METHOD_RETIRED",
        detail:
          "The old method is retired, so there is nothing to reactivate. Restoring access is a reviewed " +
          "re-link of the person to the provider — creating a fresh local credential instead would be a " +
          "second authority for one person, established without the evidence the first one needed.",
      }
    }
    return {
      rolledBack: false,
      reason: "NOTHING_TO_ROLL_BACK",
      detail: `${from} has not changed how anybody signs in, so there is nothing to undo.`,
    }
  }

  if (!request.requestedBy.trim() || request.requestedBy === request.approvedBy) {
    return {
      rolledBack: false,
      reason: "SELF_APPROVED",
      detail:
        "A rollback re-enables a credential for an entire tenant. One person asking and answering is not a " +
        "review, and this is the change most likely to be made in a hurry.",
    }
  }
  if (request.reason.trim().length < 12) {
    return {
      rolledBack: false,
      reason: "NO_REASON",
      detail: "No stated reason. A rollback nobody explained is one nobody can decide when to end.",
    }
  }

  if (request.localIdentities.length === 0) {
    return {
      rolledBack: false,
      reason: "NO_LOCAL_CREDENTIAL",
      detail:
        "There are no local credentials to reactivate. A rollback restores what existed; it does not create " +
        "a credential, because a credential created here would be one nobody verified.",
    }
  }

  // Already-ACTIVE rows are left out rather than re-written: reactivating one
  // would produce an audit entry saying a credential was restored on a day
  // nothing happened to it.
  const reactivate = request.localIdentities.filter((identity) => identity.status !== "ACTIVE")

  return {
    rolledBack: true,
    to: ROLLBACK_TARGET,
    reactivateIdentityIds: reactivate.map((identity) => identity.id).sort(),
    sessionEffect: sessionEffect(ROLLBACK_TARGET),
    detail:
      `${reactivate.length} local credential(s) return to ACTIVE and the tenant lands on ${ROLLBACK_TARGET}, ` +
      `where both methods work. No credential and no person is created.`,
  }
}
