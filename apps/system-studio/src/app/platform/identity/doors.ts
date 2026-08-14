/**
 * What `/platform/identity` concludes, decided as data rather than in JSX.
 *
 * ── The question this module answers ────────────────────────────────────────
 *
 * "Who can get into this control plane and into this account, and what is
 * protecting those doors?"
 *
 * There are two doors and they are not the same door. The FRONT door is the
 * Cognito user pool that gates this console: an account in it is a person who
 * can sign in and read every tenant's operational state. The ACCOUNT door is
 * IAM: a principal with `Action: "*"` on `Resource: "*"` can do anything to the
 * estate the console only reads. A page that counted one and not the other would
 * answer half the question with total confidence.
 *
 * ── The rule this module is built around ───────────────────────────────────
 *
 * **An absence of findings from a control that is not running is NOT a pass.**
 *
 * An account with no IAM Access Analyzer has no external-access findings. A
 * wildcard sweep that could not read `AdministratorAccess` — an AWS-managed
 * policy, whose document `iam:GetAccountAuthorizationDetails` is not asked for —
 * reports no wildcard on the one principal that has every one. A KMS rotation
 * posture computed over a truncated key listing reports no key with rotation
 * off. Through a naive page every one of those renders as a clean estate.
 *
 * So `GuardState` has five arms and only ONE of them — `CHECKED_CLEAN` — is a
 * pass. `isPass` is the single place that decision is made, `identityVerdict`
 * cannot reach its clear arm while one guard sits in any other arm, and the page
 * renders the not-passing guards in their own card ABOVE the findings rather
 * than as a column in a table nobody scrolls to.
 *
 * ── The 2026-08-13 audit, and the panel that would have shown it ───────────
 *
 * The migration reissued a shared secret as a PERMANENT password with the pool's
 * MFA set to OPTIONAL, and nothing in this console could see either fact. Both
 * are guards here, and both are `FINDINGS` rather than a footnote:
 * `guardFromConsoleMfa` maps `MfaPosture.optional` to `FINDINGS` — a second
 * factor nobody is required to enrol is the same protection as none — and
 * `guardFromOperatorRoster` maps the reader's `neverForcedAPasswordChange`
 * suspicion to `FINDINGS` with its own caveat carried alongside it.
 *
 * ── Purity, and why it matters here ────────────────────────────────────────
 *
 * Every export below is a pure function of values a caller already read, and
 * every import is `import type`. Nothing here drags `server-only`, an SDK
 * client or a live gateway into the module graph, which is what lets the whole
 * decision be driven at the node level through arms an operator pointed at a
 * healthy estate can never reach — a refused roster read, an account with no
 * analyzer, a truncated key listing.
 *
 * It also means this module never reads AWS. The readers under `src/lib/aws/`
 * are the only path to the SDK; this turns what they returned into what the page
 * says.
 */

import type { BadgeTone } from "../../../components/md3/Badge"
import type { Severity } from "../../../components/md3/SeverityChip"
import type {
  AnalyzerReadings,
  ExternalAccessState,
} from "../../../lib/aws/analyzer"
import type {
  CognitoReadings,
  MfaPosture,
  OperatorReading,
  OperatorStatus,
  PoolReading,
} from "../../../lib/aws/cognito"
import type {
  IamAccessKey,
  IamPosture,
  IamPostureSurface,
  IamPrincipal,
  IamWildcard,
  WildcardKind,
} from "../../../lib/aws/iam"
import type { KeyReading, KmsReadings } from "../../../lib/aws/keys"
import type { AwsRead } from "../../../lib/aws/read"
import type { SecretsReadings } from "../../../lib/aws/secrets"

/* ─────────────────────────────────────────────────────────── the doors ──── */

/**
 * The two doors, as a closed union.
 *
 * Every guard declares which one it protects, so the page can group by door and
 * an operator can see that the console's front door and the account's are
 * guarded by different things and fail independently.
 */
export const DOORS = ["control-plane", "account"] as const

export type Door = (typeof DOORS)[number]

export const DOOR_WORDS: Readonly<Record<Door, string>> = {
  "control-plane": "This control plane",
  account: "This AWS account",
}

/* ────────────────────────────────────────────────────── guard coverage ──── */

/**
 * What a guard is doing, worst first — and only one of these is a pass.
 *
 *   * `FINDINGS`      — it ran and found something. The alarm.
 *   * `UNREADABLE`    — this engine was refused, throttled or errored. A fact
 *                       about this CONSOLE's grants, not about the estate.
 *   * `NOT_RUNNING`   — the control does not exist in the account at all. An
 *                       account with no Access Analyzer lands here, and its
 *                       silence is the finding rather than the absence of one.
 *   * `PARTIAL`       — it ran, and its own coverage report says not over all of
 *                       it. A truncated listing, an unswept policy document.
 *   * `CHECKED_CLEAN` — it ran, over everything it claims to cover, and found
 *                       nothing. The ONLY pass.
 *
 * The array order is the render order and the ranking. `UNREADABLE`,
 * `NOT_RUNNING` and `PARTIAL` are deliberately three words rather than one
 * "unknown": their remedies are grant the statement, create the control, and
 * raise the bound — and a page that collapsed them would send two operators in
 * three the wrong way.
 */
export const GUARD_STATES = [
  "FINDINGS",
  "UNREADABLE",
  "NOT_RUNNING",
  "PARTIAL",
  "CHECKED_CLEAN",
] as const

export type GuardState = (typeof GUARD_STATES)[number]

/** The word each state prints. Never the tone alone — colour is not the carrier. */
export const GUARD_WORDS: Readonly<Record<GuardState, string>> = {
  FINDINGS: "Found something",
  UNREADABLE: "Not readable from here",
  NOT_RUNNING: "Not running — nothing is checking",
  PARTIAL: "Checked in part",
  CHECKED_CLEAN: "Checked and clean",
}

/**
 * The tone each state renders with.
 *
 * `NOT_RUNNING` is `bad` and not `warn`: a control that is not running produces
 * exactly the same empty list as a control that ran and found nothing, and the
 * whole value of this page is that the two are visually distinct. `CHECKED_CLEAN`
 * is the only `ok` in the table.
 */
export const GUARD_TONE: Readonly<Record<GuardState, BadgeTone>> = {
  FINDINGS: "bad",
  UNREADABLE: "warn",
  NOT_RUNNING: "bad",
  PARTIAL: "warn",
  CHECKED_CLEAN: "ok",
}

/**
 * Whether a guard's state counts as protection.
 *
 * The single place the rule at the top of this file is applied. Every count of
 * "how many doors are guarded" on the page goes through it, so there is no
 * second opinion to drift.
 */
export function isPass(state: GuardState): boolean {
  return state === "CHECKED_CLEAN"
}

/** One guard on one door, and why it is in the state it is in. */
export interface GuardRow {
  /** Stable, unique, and the React key. Not the control name. */
  key: string
  door: Door
  /** What the guard is, in the operator's language. */
  control: string
  /** The question it answers about the door. */
  question: string
  state: GuardState
  /**
   * How many things it found, when it ran and can count. Null whenever the
   * guard did not run — a zero under a control that is not running is the exact
   * number this page exists to stop printing.
   */
  findings: number | null
  /** Why it is in that state, from the reader's own sentence wherever there is one. */
  detail: string
  /** What to do next. Never "try again". */
  remedy: string
}

/** Worst first, then by door, then by control, so the order is total and stable. */
export function sortGuards(rows: readonly GuardRow[]): readonly GuardRow[] {
  const rank = (state: GuardState) => GUARD_STATES.indexOf(state)
  return [...rows].sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      DOORS.indexOf(a.door) - DOORS.indexOf(b.door) ||
      a.control.localeCompare(b.control),
  )
}

/** The guards that are NOT protection. The card that sits above the findings. */
export function notPassing(rows: readonly GuardRow[]): readonly GuardRow[] {
  return sortGuards(rows.filter((row) => !isPass(row.state)))
}

/** The guards that are. Rendered so the list above can be read against it. */
export function passing(rows: readonly GuardRow[]): readonly GuardRow[] {
  return sortGuards(rows.filter((row) => isPass(row.state)))
}

/* ─────────────────────────────────────────────── who can get in — Cognito ── */

/**
 * The pool that gates THIS console, or null.
 *
 * Identification is by tag, in `identifyConsolePool`, and never by name: a pool
 * called `tenure-prod-operators` is a string somebody typed, and a console that
 * picks its own front door by name is a console that describes the wrong pool's
 * MFA setting with total confidence. Null here means "not identified", which the
 * page renders as a finding of its own rather than as an absence of operators.
 */
export function consolePool(readings: CognitoReadings): PoolReading | null {
  // Bound to a local before the narrowing is used. `readings.consolePool` is a
  // property access, and a property access is re-widened at every mention, so
  // reaching for `readings.consolePool.poolId` inside the callback below does
  // not compile — which is the compiler pointing at the arm that has no poolId.
  const identification = readings.consolePool
  if (identification.kind !== "identified") return null
  const pools = readings.pools
  if (pools.state !== "ACTUAL" && pools.state !== "STALE") return null
  return pools.value.pools.find((pool) => pool.poolId === identification.poolId) ?? null
}

/**
 * Whether one account is a way into this console.
 *
 * Three arms, because "disabled" and "the roster did not say whether it is
 * enabled" are different facts and only the first closes a door. `uncertain`
 * exists so an account this engine cannot classify makes the administrator count
 * a FLOOR instead of quietly falling out of it.
 *
 * FORCE_CHANGE_PASSWORD is deliberately `open`. That is precisely the state the
 * 2026-08-13 audit found accounts sitting in, holding a password an
 * administrator set; treating a pending account as "not yet a way in" is how the
 * migration went unnoticed.
 */
export type OperatorDoor =
  | { kind: "open"; why: string }
  | { kind: "closed"; why: string }
  | { kind: "uncertain"; why: string }

export function operatorDoor(operator: OperatorReading): OperatorDoor {
  if (operator.enabled === false) {
    return {
      kind: "closed",
      why: "the account is disabled in the pool — Cognito refuses its sign-in outright",
    }
  }
  if (operator.status.code === "ARCHIVED") {
    return { kind: "closed", why: "the account is ARCHIVED and cannot authenticate" }
  }
  if (operator.enabled === null) {
    return {
      kind: "uncertain",
      why:
        "the roster answered for this account without an Enabled flag, so whether it can sign in " +
        "was not read. Counted as a floor rather than assumed shut.",
    }
  }
  if (operator.status.code === "ABSENT" || operator.status.code === "UNRECOGNISED") {
    return {
      kind: "uncertain",
      why:
        "the account's status is one this engine did not read or does not model, so whether it " +
        "can sign in was not established.",
    }
  }
  return {
    kind: "open",
    why: `status ${operator.status.code} — this account can present credentials to the pool`,
  }
}

/** The status word a table prints, with the raw value where AWS gave one this engine does not model. */
export function statusWord(status: OperatorStatus): string {
  switch (status.code) {
    case "UNRECOGNISED":
      return `${status.raw} — a status this engine does not model`
    case "ABSENT":
      return "not returned by the roster"
    default:
      return status.code
  }
}

/**
 * What this engine can and cannot say about one operator's second factor.
 *
 * Both halves, always. SMS enrolment is readable from the roster; software-token
 * (TOTP) enrolment is NOT — it lives in `UserMFASettingList`, which only the
 * per-account admin read returns, and that capability is deliberately absent.
 * Printing only the readable half would render an operator with a TOTP
 * authenticator as having no MFA, which is the inverse of the defect this page
 * exists to catch, and just as wrong.
 */
export function mfaEnrolmentSentence(operator: OperatorReading): string {
  const sms = operator.mfa.smsConfigured
    ? `SMS MFA is set up (${operator.mfa.smsDeliveryMedia.join(", ") || "no delivery medium named"})`
    : "no SMS MFA on this account"
  return `${sms}. ${operator.mfa.softwareToken.why}`
}

/* ──────────────────────────────────── who can administer — the lead answer ── */

/**
 * The wildcard kinds that amount to administering the platform.
 *
 * `ADMIN` is `Action: "*"` on `Resource: "*"`. `ALL_ACTIONS` is every action
 * scoped only by resource, which on any resource that matters is the same power.
 * `ALL_RESOURCES` is deliberately NOT here: named actions on every resource is a
 * real finding and a real risk, and it is not the ability to administer.
 */
export const ADMINISTERING_WILDCARDS: readonly WildcardKind[] = ["ADMIN", "ALL_ACTIONS"]

function administers(wildcard: IamWildcard): boolean {
  return ADMINISTERING_WILDCARDS.includes(wildcard.kind)
}

/** The roles and users holding an administering wildcard, by ARN, deduplicated. */
export function administeringPrincipals(posture: IamPosture): readonly IamPrincipal[] {
  const arns = new Set(posture.wildcards.filter(administers).map((w) => w.principalArn))
  return [...posture.roles, ...posture.users]
    .filter((principal) => arns.has(principal.arn))
    .sort((a, b) => a.arn.localeCompare(b.arn))
}

/**
 * The count the page leads with, and how sure it is of it.
 *
 * Three arms. `counted` is reachable only when BOTH halves answered completely;
 * `floor` when at least one half produced a number that something makes a
 * minimum; `unknown` when neither half produced one at all. A single integer
 * would have had to pick one of those three to be wrong about.
 */
export type AdministratorCount =
  | {
      kind: "counted"
      total: number
      consoleOperators: number
      accountAdministrators: number
    }
  | {
      kind: "floor"
      atLeast: number
      /** Null when that half produced no number at all. */
      consoleOperators: number | null
      accountAdministrators: number | null
      /** Every reason the number is a minimum rather than a total. */
      qualifiers: readonly string[]
    }
  | { kind: "unknown"; qualifiers: readonly string[] }

export function administratorCount(
  cognito: CognitoReadings,
  iam: IamPostureSurface,
): AdministratorCount {
  const qualifiers: string[] = []

  /* ── the front door ── */
  let consoleOperators: number | null = null
  const pool = consolePool(cognito)
  if (pool === null) {
    qualifiers.push(
      `the pool guarding this console was not identified, so no operator account was counted — ` +
        `${describeConsolePoolGap(cognito)}`,
    )
  } else if (pool.operators.state === "ACTUAL" || pool.operators.state === "STALE") {
    const roster = pool.operators.value
    const doors = roster.operators.map(operatorDoor)
    consoleOperators = doors.filter((door) => door.kind === "open").length
    const uncertain = doors.filter((door) => door.kind === "uncertain").length
    if (uncertain > 0) {
      qualifiers.push(
        `${uncertain} operator account(s) in ${pool.poolId} could not be classified as open or ` +
          `closed, so the console half is a minimum`,
      )
    }
    if (roster.completeness.kind === "truncated") {
      qualifiers.push(
        `the roster of ${pool.poolId} stopped at this engine's page bound after ` +
          `${roster.completeness.seen} account(s) — ${roster.completeness.why}`,
      )
    }
  } else if (pool.operators.state === "EMPTY") {
    consoleOperators = 0
  } else {
    qualifiers.push(
      `the operator roster of ${pool.poolId} was not read, so no account in it was counted`,
    )
  }

  /* ── the account door ── */
  let accountAdministrators: number | null = null
  if (iam.posture) {
    accountAdministrators = administeringPrincipals(iam.posture).length
    if (!iam.posture.sweepCoverage.complete) {
      qualifiers.push(
        `the policy sweep did not cover every policy — ${iam.posture.sweepCoverage.detail} ` +
          `AdministratorAccess is an AWS-managed policy whose document this read does not carry, ` +
          `so a principal holding it is not in this number`,
      )
    }
  } else {
    qualifiers.push(
      `IAM did not answer, so no role or user was counted — ${iam.headline}`,
    )
  }

  if (consoleOperators === null && accountAdministrators === null) {
    return { kind: "unknown", qualifiers }
  }
  if (consoleOperators !== null && accountAdministrators !== null && qualifiers.length === 0) {
    return {
      kind: "counted",
      total: consoleOperators + accountAdministrators,
      consoleOperators,
      accountAdministrators,
    }
  }
  return {
    kind: "floor",
    atLeast: (consoleOperators ?? 0) + (accountAdministrators ?? 0),
    consoleOperators,
    accountAdministrators,
    qualifiers,
  }
}

/** Why the console's own pool could not be pinned down, in the reader's words. */
export function describeConsolePoolGap(readings: CognitoReadings): string {
  const identification = readings.consolePool
  switch (identification.kind) {
    case "identified":
      return `identified: ${identification.how}`
    case "ambiguous":
      return identification.why
    case "not-tagged":
      return identification.why
    case "unknown":
      return identification.why
  }
}

/* ────────────────────────────────────────────────────────── the guards ──── */

/** The front door's second factor. The fact whose absence the 2026-08-13 audit turned on. */
export function guardFromConsoleMfa(readings: CognitoReadings): GuardRow {
  const base = {
    key: "console-mfa",
    door: "control-plane" as const,
    control: "Multi-factor authentication on the console's user pool",
    question: "is a second factor REQUIRED of everyone who signs into this console?",
  }
  const pool = consolePool(readings)
  if (pool === null) {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail: `the pool guarding this console was not identified — ${describeConsolePoolGap(readings)}`,
      remedy:
        "Tag the console's user pool tenure:module = system-studio, or grant this engine " +
        "cognito-idp:ListUserPools and tag:GetResources so it can find it. Until then nothing on " +
        "this row is about the pool that actually gates this console.",
    }
  }
  return { ...base, ...mfaVerdict(pool.mfaPosture, pool.poolId) }
}

function mfaVerdict(
  posture: MfaPosture,
  poolId: string,
): Pick<GuardRow, "state" | "findings" | "detail" | "remedy"> {
  switch (posture.kind) {
    case "enforced":
      return {
        state: "CHECKED_CLEAN",
        findings: 0,
        detail:
          `MFA is enforced on ${poolId} (${posture.factors.join(", ") || "no factor named"}), ` +
          `read from ${posture.provenance}`,
        remedy: "Nothing. Every sign-in to this pool must present a second factor.",
      }
    case "optional":
      return {
        state: "FINDINGS",
        findings: 1,
        detail:
          `MFA is OPTIONAL on ${poolId}, read from ${posture.provenance} — ${posture.why}`,
        remedy:
          "Set the pool's MFA configuration to ON. Optional MFA is enforced by nobody: an " +
          "account that never enrols a factor signs in with a password alone, which is the " +
          "state the 2026-08-13 migration left this console in.",
      }
    case "off":
      return {
        state: "FINDINGS",
        findings: 1,
        detail: `MFA is OFF on ${poolId}, read from ${posture.provenance} — ${posture.why}`,
        remedy:
          "Set the pool's MFA configuration to ON. A password is the only thing between an " +
          "attacker and every tenant's operational state.",
      }
    case "unrecognised":
      return {
        state: "UNREADABLE",
        findings: null,
        detail:
          `${poolId} reports an MFA configuration this engine does not model (${posture.raw}, ` +
          `read from ${posture.provenance}). Whether a second factor is required is unread.`,
        remedy:
          "Read the pool's MFA configuration in the Cognito console. This engine will not fold " +
          "a value it does not model into the reassuring arm.",
      }
    case "unknown":
      return {
        state: "UNREADABLE",
        findings: null,
        detail: `whether a second factor is enforced on ${poolId} is unknown — ${posture.why}`,
        remedy:
          "Grant cognito-idp:GetUserPoolMfaConfig on this pool to this engine's role. Until it " +
          "is granted this row is not a report that MFA is off, and it is not a report that it is on.",
      }
  }
}

/**
 * The accounts in the pool, and what the roster says about each.
 *
 * `FINDINGS` covers three separate defects, all of which the 2026-08-13 audit
 * would have raised: an account suspected of holding a permanent password an
 * administrator set, an account still inside a temporary-password window, and an
 * account whose window has closed and which therefore cannot complete a sign-in
 * at all.
 */
export function guardFromOperatorRoster(readings: CognitoReadings): GuardRow {
  const base = {
    key: "console-roster",
    door: "control-plane" as const,
    control: "Operator accounts in the console's user pool",
    question: "who holds an account that can sign into this console, and in what state?",
  }
  const pool = consolePool(readings)
  if (pool === null) {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail: `the pool guarding this console was not identified — ${describeConsolePoolGap(readings)}`,
      remedy:
        "Tag the console's user pool tenure:module = system-studio so this engine can tell it " +
        "from every other pool in the region.",
    }
  }
  const roster = pool.operators
  if (roster.state === "EMPTY") {
    return {
      ...base,
      state: "FINDINGS",
      findings: 1,
      detail:
        `cognito-idp:ListUsers answered for ${pool.poolId} and returned no account at all. ` +
        `A console nobody can sign into is not a secure console — it is an unread one, or a ` +
        `pool that is not the one gating this console.`,
      remedy:
        "Confirm this is the pool the console authenticates against. An empty roster on the " +
        "tagged pool means the tag is on the wrong pool.",
    }
  }
  if (roster.state !== "ACTUAL" && roster.state !== "STALE") {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail: `the operator roster of ${pool.poolId} was not read`,
      remedy:
        "Grant cognito-idp:ListUsers on this pool to this engine's role. Until it is granted " +
        "this row is not a report that nobody can sign in.",
    }
  }

  const operators = roster.value.operators
  const suspected = operators.filter((o) => o.neverForcedAPasswordChange !== null)
  const pending = operators.filter((o) => o.firstSignInWindow.kind === "open")
  const expired = operators.filter((o) => o.firstSignInWindow.kind === "expired")
  const findings = suspected.length + pending.length + expired.length

  if (findings > 0) {
    return {
      ...base,
      state: "FINDINGS",
      findings,
      detail:
        `${suspected.length} account(s) suspected of holding a password an administrator set ` +
        `permanently, ${pending.length} still inside an open temporary-password window and ` +
        `${expired.length} past the end of one, out of ${operators.length} read in ${pool.poolId}`,
      remedy:
        "For each account below: force a password reset, and confirm the operator enrols a " +
        "second factor. A permanent administrator-set password is a shared secret, and a shared " +
        "secret is one person's mistake away from being everybody's.",
    }
  }
  if (roster.value.completeness.kind === "truncated") {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `${operators.length} account(s) read in ${pool.poolId} and none of them is in a state ` +
        `this engine flags — but the walk stopped at its page bound: ${roster.value.completeness.why}`,
      remedy:
        "Nothing on this row covers the accounts past the bound. Read the remaining pages in the " +
        "Cognito console before treating this as clean.",
    }
  }
  return {
    ...base,
    state: "CHECKED_CLEAN",
    findings: 0,
    detail:
      `all ${operators.length} account(s) in ${pool.poolId} were read and none is inside a ` +
      `temporary-password window, past one, or suspected of holding an administrator-set password`,
    remedy: "Nothing.",
  }
}

/**
 * The pool's password policy and its temporary-password window.
 *
 * A policy this engine could not read is `UNREADABLE`, never a default. AWS's own
 * default of seven days is reported as a `default` arm by the reader and is
 * `PARTIAL` here: seven days is what nobody chose, and a window nobody chose is
 * not a window anybody is maintaining.
 */
export function guardFromPasswordPolicy(readings: CognitoReadings): GuardRow {
  const base = {
    key: "console-password-policy",
    door: "control-plane" as const,
    control: "Password policy on the console's user pool",
    question: "what does this pool require of a password, and how long does a temporary one live?",
  }
  const pool = consolePool(readings)
  if (pool === null || (pool.detail.state !== "ACTUAL" && pool.detail.state !== "STALE")) {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail:
        pool === null
          ? `the pool guarding this console was not identified — ${describeConsolePoolGap(readings)}`
          : `cognito-idp:DescribeUserPool did not answer for ${pool.poolId}, so its password ` +
            `policy is unread. This is not a report that the pool has no policy.`,
      remedy:
        "Grant cognito-idp:DescribeUserPool on this pool to this engine's role, then reload.",
    }
  }

  const detail = pool.detail.value
  const window = detail.temporaryPasswordWindow
  const selfSignup = detail.adminCreateUserOnly === false

  if (selfSignup) {
    return {
      ...base,
      state: "FINDINGS",
      findings: 1,
      detail:
        `${pool.poolId} does not set allow_admin_create_user_only, so anybody who can reach the ` +
        `hosted sign-up page can create themselves an account in the pool that gates this console`,
      remedy:
        "Set the pool's AdminCreateUserConfig.AllowAdminCreateUserOnly to true. Self sign-up on " +
        "an operator pool is an open door with a guard standing beside it.",
    }
  }
  if (window.kind === "unknown") {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail: `the temporary-password window on ${pool.poolId} is unread — ${window.why}`,
      remedy: "Grant cognito-idp:DescribeUserPool on this pool to this engine's role.",
    }
  }
  if (window.kind === "default") {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `${pool.poolId} declares no temporary-password validity, so AWS's default of ` +
        `${window.days} day(s) applies — ${window.why}. Nobody chose that number.`,
      remedy:
        "Declare TemporaryPasswordValidityDays explicitly. A window nobody set is a window " +
        "nobody is maintaining, and a seeded credential lives for as long as it.",
    }
  }
  if (detail.adminCreateUserOnly === null) {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `${pool.poolId} declares a ${window.days}-day temporary-password window, but whether ` +
        `self sign-up is closed was not returned by the describe`,
      remedy:
        "Read AdminCreateUserConfig in the Cognito console. Whether anybody can sign themselves " +
        "into the operator pool is not a question this row answers.",
    }
  }
  return {
    ...base,
    state: "CHECKED_CLEAN",
    findings: 0,
    detail:
      `${pool.poolId} closes self sign-up and declares a ${window.days}-day temporary-password ` +
      `window`,
    remedy: "Nothing.",
  }
}

/** IAM's two guards on the account door: wildcard grants, and long-lived access keys. */
export function guardsFromIam(iam: IamPostureSurface): readonly GuardRow[] {
  const wildcards = {
    key: "iam-wildcards",
    door: "account" as const,
    control: "Wildcard actions and resources in this account's IAM policies",
    question: "which roles and users can do more than they were meant to?",
  }
  const keys = {
    key: "iam-access-keys",
    door: "account" as const,
    control: "Long-lived IAM access keys",
    question: "which credentials in this account are old enough to have leaked unnoticed?",
  }

  if (!iam.posture) {
    const detail = iam.headline
    const remedy =
      iam.read.state === "DENIED"
        ? "Grant the action named in the panel above to this engine's role, then reload."
        : "Nothing here is a report that this account has no wildcard policy and no old key."
    return [
      { ...wildcards, state: "UNREADABLE", findings: null, detail, remedy },
      { ...keys, state: "UNREADABLE", findings: null, detail, remedy },
    ]
  }

  const posture = iam.posture
  const out: GuardRow[] = []

  if (posture.wildcards.length > 0) {
    out.push({
      ...wildcards,
      state: "FINDINGS",
      findings: posture.wildcards.length,
      detail:
        `${posture.wildcards.length} wildcard grant(s) across ${posture.roles.length} role(s) and ` +
        `${posture.users.length} user(s). ${posture.sweepCoverage.detail}`,
      remedy:
        "Narrow each statement to the actions and resources it needs. A Condition narrows a " +
        "wildcard without removing it, and is reported as conditioned rather than as absent.",
    })
  } else if (!posture.sweepCoverage.complete) {
    out.push({
      ...wildcards,
      state: "PARTIAL",
      findings: 0,
      detail:
        `no wildcard was found in the policies this sweep could read, and it could not read all ` +
        `of them — ${posture.sweepCoverage.detail} ${posture.unswept.length} policy document(s) ` +
        `were never returned and ${posture.unreadableDocuments.length} did not parse.`,
      remedy:
        "AdministratorAccess is an AWS-managed policy and its document is not in this read. Check " +
        "the unswept policies below by hand before reading this row as clean.",
    })
  } else {
    out.push({
      ...wildcards,
      state: "CHECKED_CLEAN",
      findings: 0,
      detail:
        `every policy attached to every one of ${posture.roles.length} role(s) and ` +
        `${posture.users.length} user(s) was swept and carries no wildcard action or resource`,
      remedy: "Nothing.",
    })
  }

  if (posture.longLivedKeys.length > 0) {
    out.push({
      ...keys,
      state: "FINDINGS",
      findings: posture.longLivedKeys.length,
      detail:
        `${posture.longLivedKeys.length} active access key(s) past this console's age limit, out ` +
        `of ${posture.accessKeys.length} seen. ${posture.keyCoverage.detail}`,
      remedy:
        "Rotate each key and deactivate the old one, or replace the user with a role. A key with " +
        "no expiry is a credential that outlives the person who made it.",
    })
  } else if (!posture.keyCoverage.complete) {
    out.push({
      ...keys,
      state: "PARTIAL",
      findings: 0,
      detail:
        `no long-lived key was found among the users who answered, and not every user did — ` +
        `${posture.keyCoverage.detail}`,
      remedy:
        "Grant iam:ListAccessKeys for the users named in the coverage note. This row does not " +
        "cover them.",
    })
  } else {
    out.push({
      ...keys,
      state: "CHECKED_CLEAN",
      findings: 0,
      detail:
        `all ${posture.keyCoverage.usersAsked} user(s) answered and none holds an active access ` +
        `key past this console's age limit (${posture.accessKeys.length} key(s) seen in total)`,
      remedy: "Nothing.",
    })
  }

  return out
}

/**
 * Access Analyzer, and the arm this whole page exists for.
 *
 * `no-analyzer` is `NOT_RUNNING` and NEVER `CHECKED_CLEAN`. An account with no
 * analyzer produces no external-access finding no matter how much is shared
 * outside it, and the reader's own union is careful enough to hand that over as
 * its own arm rather than as an empty list. Mapping it to a pass here would undo
 * that in one line.
 */
export function guardFromAnalyzer(readings: AnalyzerReadings): GuardRow {
  const base = {
    key: "external-access",
    door: "account" as const,
    control: "IAM Access Analyzer external-access findings",
    question: "does anything in this account grant access to a principal outside it?",
  }
  return { ...base, ...analyzerVerdict(readings.externalAccess) }
}

function analyzerVerdict(
  state: ExternalAccessState,
): Pick<GuardRow, "state" | "findings" | "detail" | "remedy"> {
  switch (state.kind) {
    case "unknown":
      return { state: "UNREADABLE", findings: null, detail: state.why, remedy: state.remedy }
    case "no-analyzer":
      return { state: "NOT_RUNNING", findings: null, detail: state.why, remedy: state.remedy }
    case "not-answering":
      return { state: "NOT_RUNNING", findings: null, detail: state.why, remedy: state.remedy }
    case "findings-unreadable":
      return { state: "UNREADABLE", findings: null, detail: state.why, remedy: state.remedy }
    case "external-access":
      return {
        state: "FINDINGS",
        findings: state.totalActive,
        detail:
          `${state.totalActive} active external-access finding(s)` +
          (state.unreadable.length > 0
            ? `, and ${state.unreadable.length} analyzer(s) whose findings could not be read ` +
              `(${state.unreadable.join(", ")}) — the count is a minimum`
            : "") +
          (state.truncated ? ". The findings listing was truncated at this engine's page bound." : ""),
        remedy:
          "Open each finding in the Access Analyzer console and either narrow the resource policy " +
          "or archive the finding with a reason. This engine reads findings and never archives one.",
      }
    case "none-found":
      if (state.unreadable.length > 0 || state.truncated) {
        return {
          state: "PARTIAL",
          findings: 0,
          detail:
            `${state.analyzersRead.length} analyzer(s) answered and reported no active ` +
            `external-access finding` +
            (state.unreadable.length > 0
              ? `, and ${state.unreadable.length} could not be read (${state.unreadable.join(", ")})`
              : "") +
            (state.truncated ? ". The findings listing was truncated at this engine's page bound." : ""),
          remedy:
            "This is not a clean account. It is a clean answer from part of one; the analyzers " +
            "named above were not read.",
        }
      }
      return {
        state: "CHECKED_CLEAN",
        findings: 0,
        detail:
          `${state.analyzersRead.length} analyzer(s) that answer the external-access question ` +
          `(${state.analyzersRead.join(", ")}) were read in full and reported no active finding`,
        remedy: "Nothing.",
      }
  }
}

/** Customer-managed KMS keys with rotation switched off. */
export function guardFromKeys(readings: KmsReadings): GuardRow {
  const base = {
    key: "kms-rotation",
    door: "account" as const,
    control: "Automatic rotation on customer-managed KMS keys",
    question: "which keys protecting this estate have never been replaced?",
  }
  const posture = readings.posture
  const keys = readings.keys

  if (keys.state !== "ACTUAL" && keys.state !== "STALE" && keys.state !== "EMPTY") {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail:
        "the key listing was not read, so nothing is known about rotation on any key in this " +
        "account. This is not a report that every key rotates.",
      remedy: "Grant kms:ListKeys and kms:DescribeKey to this engine's role, then reload.",
    }
  }
  if (posture.notRotating.length > 0) {
    return {
      ...base,
      state: "FINDINGS",
      findings: posture.notRotating.length,
      detail:
        `${posture.notRotating.length} of ${posture.customerManagedRead} customer-managed key(s) ` +
        `whose rotation status was read have automatic rotation disabled` +
        (posture.pendingDeletion.length > 0
          ? `, and ${posture.pendingDeletion.length} key(s) are scheduled for deletion`
          : ""),
      remedy:
        "Enable automatic rotation (kms:EnableKeyRotation) on each key named below, or record why " +
        "it must not rotate. AWS-managed keys are excluded from this count entirely and are not " +
        "a pass.",
    }
  }
  if (!posture.complete) {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `every customer-managed key whose rotation this engine could read is rotating, and the ` +
        `reading does not cover the whole estate: ${posture.rotationUnknown.length} key(s) with an ` +
        `unread rotation status, ${posture.unreadable.length} whose describe did not answer, ` +
        `${posture.unrecognisedManagement.length} whose manager AWS reported as something this ` +
        `engine does not model.`,
      remedy:
        "Grant kms:GetKeyRotationStatus and kms:DescribeKey on the keys named below, or raise the " +
        "read bound. A partial denominator is not a compliant estate.",
    }
  }
  if (posture.customerManagedRead === 0) {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `the key listing answered and this account has no customer-managed key whose rotation ` +
        `could be assessed (${posture.awsManagedExcluded} AWS-managed key(s) were seen and are ` +
        `excluded — AWS rotates those on its own schedule and no customer setting exists)`,
      remedy:
        "Nothing to rotate here, and nothing here is evidence that this estate's encryption is " +
        "under keys this account controls.",
    }
  }
  return {
    ...base,
    state: "CHECKED_CLEAN",
    findings: 0,
    detail:
      `all ${posture.customerManagedRead} customer-managed key(s) in this account have automatic ` +
      `rotation enabled`,
    remedy: "Nothing.",
  }
}

/** Secrets with no rotation configured, or older than the interval somebody configured. */
export function guardFromSecrets(readings: SecretsReadings): GuardRow {
  const base = {
    key: "secret-rotation",
    door: "account" as const,
    control: "Rotation on Secrets Manager secrets",
    question: "which of this estate's secrets is nobody replacing?",
  }
  const posture = readings.posture
  if (posture.kind === "unknown") {
    return {
      ...base,
      state: "UNREADABLE",
      findings: null,
      detail: posture.why,
      remedy:
        "Grant secretsmanager:ListSecrets to this engine's role, then reload. Nothing here is a " +
        "report that every secret rotates.",
    }
  }

  const findings = posture.noRotation.length + posture.overdue.length
  if (findings > 0) {
    return {
      ...base,
      state: "FINDINGS",
      findings,
      detail:
        `${posture.noRotation.length} secret(s) with no rotation configured and ` +
        `${posture.overdue.length} past the interval somebody configured for them, out of ` +
        `${posture.secretsAssessed} assessed` +
        (posture.pendingDeletion.length > 0
          ? `. ${posture.pendingDeletion.length} secret(s) are inside a deletion recovery window.`
          : ""),
      remedy:
        "Configure rotation on each secret named below, or record why it must not rotate. A " +
        "secret nobody replaces is a credential with the lifetime of the system it protects.",
    }
  }
  if (posture.undetermined.length > 0 || posture.pagination.kind !== "complete") {
    return {
      ...base,
      state: "PARTIAL",
      findings: 0,
      detail:
        `no secret this engine could assess is unrotated or overdue, and the reading does not ` +
        `cover everything: ${posture.undetermined.length} secret(s) whose posture could not be ` +
        `decided, and the listing itself is ${posture.pagination.kind}`,
      remedy:
        "Read the secrets named below in the Secrets Manager console. A posture nobody could " +
        "decide is not a secret that rotates.",
    }
  }
  return {
    ...base,
    state: "CHECKED_CLEAN",
    findings: 0,
    detail:
      `all ${posture.secretsAssessed} secret(s) in this account have rotation configured and none ` +
      `is past its interval`,
    remedy: "Nothing.",
  }
}

/** Every guard on this page, in one call, so the page cannot forget one. */
export function allGuards(input: {
  cognito: CognitoReadings
  iam: IamPostureSurface
  analyzer: AnalyzerReadings
  keys: KmsReadings
  secrets: SecretsReadings
}): readonly GuardRow[] {
  return sortGuards([
    guardFromConsoleMfa(input.cognito),
    guardFromOperatorRoster(input.cognito),
    guardFromPasswordPolicy(input.cognito),
    ...guardsFromIam(input.iam),
    guardFromAnalyzer(input.analyzer),
    guardFromKeys(input.keys),
    guardFromSecrets(input.secrets),
  ])
}

/* ───────────────────────────────────────────────────────── the verdict ──── */

export interface IdentityVerdict {
  /** The word at the top of the page. Four, and only one of them is reassuring. */
  verdict: "Unknown" | "At risk" | "Not fully checked" | "Clear"
  tone: BadgeTone
  /** The lead sentence: the count, and how sure it is of it. */
  headline: string
  /** Why the verdict is that word, naming what would change it. */
  because: string
}

/**
 * The page's answer.
 *
 * The branch order is the whole guarantee, and it is the property the mutation
 * table in `doors.test.ts` drives:
 *
 *   1. any guard with `FINDINGS` → **At risk**;
 *   2. any guard not passing at all → **Not fully checked**;
 *   3. an administrator count that is not a total → **Unknown**;
 *   4. and only then **Clear**.
 *
 * Step 2 is the one that matters. It is what makes an account with no Access
 * Analyzer visibly different from an account whose analyzer ran and found
 * nothing, and it cannot be satisfied by a shorter findings list.
 */
export function identityVerdict(input: {
  admins: AdministratorCount
  guards: readonly GuardRow[]
}): IdentityVerdict {
  const headline = administratorHeadline(input.admins)
  const withFindings = input.guards.filter((guard) => guard.state === "FINDINGS")
  const notChecking = input.guards.filter((guard) => !isPass(guard.state))

  if (withFindings.length > 0) {
    const found = withFindings.reduce((sum, guard) => sum + (guard.findings ?? 0), 0)
    return {
      verdict: "At risk",
      tone: "bad",
      headline,
      because:
        `${found} finding(s) across ${withFindings.length} of ${input.guards.length} guard(s) on ` +
        `these two doors. ${notChecking.length - withFindings.length} further guard(s) are not ` +
        `protection either — they did not run, could not be read, or covered only part of what ` +
        `they claim.`,
    }
  }
  if (notChecking.length > 0) {
    return {
      verdict: "Not fully checked",
      tone: "warn",
      headline,
      because:
        `No guard that ran found anything, and ${notChecking.length} of ${input.guards.length} ` +
        `did not run over everything they claim to cover. An absence of findings from a control ` +
        `that is not running is not a pass, so this page will not call these doors guarded.`,
    }
  }
  if (input.admins.kind !== "counted") {
    return {
      verdict: "Unknown",
      tone: "warn",
      headline,
      because:
        "Every guard ran and found nothing, and the number of principals who can administer this " +
        "platform is still not a total. A clean guard list over an unknown population is not an " +
        "answer to the question this page asks.",
    }
  }
  return {
    verdict: "Clear",
    tone: "ok",
    headline,
    because:
      `All ${input.guards.length} guard(s) on both doors ran, over everything each of them claims ` +
      `to cover, and found nothing. This is the only condition under which an empty list on this ` +
      `page means the doors are guarded.`,
  }
}

/** The lead sentence: the count, in words, with its qualifiers attached to it. */
export function administratorHeadline(admins: AdministratorCount): string {
  switch (admins.kind) {
    case "counted":
      return (
        `${admins.total} principal(s) can administer this platform: ` +
        `${admins.consoleOperators} operator account(s) that can sign into this console, and ` +
        `${admins.accountAdministrators} IAM role(s) or user(s) holding an administering wildcard ` +
        `in this account.`
      )
    case "floor":
      return (
        `At least ${admins.atLeast} principal(s) can administer this platform — ` +
        `${admins.consoleOperators === null ? "an unread number of" : admins.consoleOperators} ` +
        `operator account(s) that can sign into this console, and ` +
        `${admins.accountAdministrators === null ? "an unread number of" : admins.accountAdministrators} ` +
        `IAM role(s) or user(s) holding an administering wildcard. This is a floor, not a total: ` +
        `${admins.qualifiers.join("; ")}.`
      )
    case "unknown":
      return (
        `How many principals can administer this platform is UNKNOWN. Neither door answered: ` +
        `${admins.qualifiers.join("; ")}. This is not a report that nobody can.`
      )
  }
}

/* ───────────────────────────────────────────────────── rows for the page ── */

/** The severity a wildcard renders with. `ADMIN` is administrator access under another name. */
export const WILDCARD_SEVERITY: Readonly<Record<WildcardKind, Severity>> = {
  ADMIN: "critical",
  ALL_ACTIONS: "critical",
  ANY_PRINCIPAL: "critical",
  ALL_RESOURCES: "high",
  NEGATED: "high",
  SERVICE_WIDE: "medium",
  PREFIX: "medium",
}

/** Worst kind first, then by principal, so the order is total and stable. */
export function rankWildcards(wildcards: readonly IamWildcard[]): readonly IamWildcard[] {
  const rank = (kind: WildcardKind) => Object.keys(WILDCARD_SEVERITY).indexOf(kind)
  return [...wildcards].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.principalArn.localeCompare(b.principalArn) ||
      a.policyName.localeCompare(b.policyName) ||
      a.statementIndex - b.statementIndex,
  )
}

/** A stable key for a wildcard row: principal, policy and statement together. */
export function wildcardKey(wildcard: IamWildcard): string {
  return `${wildcard.principalArn}::${wildcard.source}::${wildcard.policyName}::${wildcard.statementIndex}`
}

/** Oldest key first — age is the whole finding. Undated keys last, never first. */
export function rankKeys(keys: readonly IamAccessKey[]): readonly IamAccessKey[] {
  return [...keys].sort((a, b) => {
    if (a.ageDays === null && b.ageDays === null) return a.accessKeyId.localeCompare(b.accessKeyId)
    if (a.ageDays === null) return 1
    if (b.ageDays === null) return -1
    return b.ageDays - a.ageDays || a.accessKeyId.localeCompare(b.accessKeyId)
  })
}

/**
 * The customer-managed keys whose rotation is off, as full readings.
 *
 * `KeyRotationPosture.notRotating` is a list of key ids; the page needs the ARN,
 * the attribution and the lifecycle beside each. Joining here rather than in JSX
 * keeps the join testable — and keeps the page from reaching into
 * `readings.keys.value` on an arm that has no value.
 */
export function keysNotRotating(readings: KmsReadings): readonly KeyReading[] {
  const keys = readings.keys
  if (keys.state !== "ACTUAL" && keys.state !== "STALE") return []
  const flagged = new Set(readings.posture.notRotating)
  return keys.value
    .filter((key) => flagged.has(key.keyId))
    .sort((a, b) => a.keyId.localeCompare(b.keyId))
}

/**
 * The arms of a reading that carry no value, narrowed for `UnknownState`.
 *
 * `isUnknown` in `lib/aws/read.ts` returns a boolean rather than a type
 * predicate, and `UnknownState` accepts only the four valueless arms — so the
 * narrowing happens here, as a `switch` the compiler can follow.
 */
export function unknownArm(
  read: AwsRead<unknown>,
): Extract<AwsRead<unknown>, { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }> | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}
