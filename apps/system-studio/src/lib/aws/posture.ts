/**
 * STUDIO-010-002 / STUDIO-010-008 — verdicts about where things live, each one
 * four-valued.
 *
 * Every verdict here has an UNKNOWN arm, and it is the reason the module exists.
 * "Workloads are separated from the management account" and "we could not check"
 * are opposite messages with the same shape, and a three-valued verdict prints
 * the reassuring one when the role is short a permission. That is the
 * STUDIO-000-007 failure with a security label on it.
 *
 * Nothing here calls AWS directly. `managementAccountVerdict` is pure — it takes
 * the identity and the organization read and compares two account ids — which
 * means the case that matters (the two ids are equal) is testable without an
 * Organization, and the case that matters more (the org read failed) cannot be
 * accidentally tested against a stand-in that always succeeds.
 */

import { analyzerReadings, type AnalyzerReadings } from "./analyzer"
import { bucketPosture, type BucketReading, type S3Readings } from "./buckets"
import { minimumStatementText, type Capability } from "./capabilities"
import { cognitoReadings, type CognitoReadings } from "./cognito"
import { complianceReadings, type ComplianceReadings } from "./compliance"
import { ecrReadings, type EcrReadings } from "./ecr"
import { guardDutyReadings, type GuardDutyReadings, type SeverityBand } from "./guardduty"
import { iamPosture, type IamPostureSurface } from "./iam"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import { keyReadings, type KmsReadings } from "./keys"
import { networkReadings, type NetworkReadings } from "./network"
import { describeOrganization, type OrganizationRead } from "./organization"
import { secretReadings, type SecretsReadings } from "./secrets"
import { trailReadings, type TrailReadings } from "./trail"
import { wafReadings, type WafReadings } from "./waf"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"

/* --------------------------------------- workloads vs management account -- */

export type ManagementAccountVerdict =
  | "SEPARATED"
  | "WORKLOAD_IN_MANAGEMENT_ACCOUNT"
  | "NO_ORGANIZATION"
  | "UNKNOWN"

export interface ManagementAccountFinding {
  verdict: ManagementAccountVerdict
  /** The sentence the page prints. Names both ids when it compared two. */
  detail: string
  selfAccountId: string | null
  managementAccountId: string | null
}

/**
 * Is the account this engine serves from the one that owns the Organization?
 *
 * Four answers. `UNKNOWN` is returned whenever EITHER input is unknown — an
 * identity that could not be resolved is just as blinding as an Organization
 * that could not be read, and a verdict computed from one known and one unknown
 * id would be a guess wearing a verdict's clothes.
 */
export function managementAccountVerdict(
  identity: AwsRead<Identity>,
  organization: OrganizationRead,
): ManagementAccountFinding {
  const self =
    identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value.accountId : null

  if (!self) {
    return {
      verdict: "UNKNOWN",
      detail:
        "unknown — this engine could not resolve its own account, so it cannot say whether it is running " +
        "in the Organizations management account.",
      selfAccountId: null,
      managementAccountId: null,
    }
  }

  if (organization.state === "UNKNOWN") {
    return {
      // STUDIO-000-007. A denied `DescribeOrganization` is a question nobody was
      // allowed to ask, not an answer of "separated". Reporting the reassuring
      // verdict off a call that never ran is the exact failure this module's
      // UNKNOWN arm exists to prevent — and the detail below has always said
      // "unknown", so the label was contradicting its own sentence.
      verdict: "UNKNOWN",
      detail:
        `unknown — account ${self} is running here, but ${organization.action} was refused ` +
        `(${organization.errorCode}), so whether this is the management account is not known. ` +
        `Minimum statement: ${organization.minimumStatement}`,
      selfAccountId: self,
      managementAccountId: null,
    }
  }

  if (organization.state === "NOT_IN_USE") {
    return {
      verdict: "NO_ORGANIZATION",
      detail:
        `no organization — AWS answered AWSOrganizationsNotInUseException, so account ${self} is a ` +
        `single-account estate and there is no management account to be separated from.`,
      selfAccountId: self,
      managementAccountId: null,
    }
  }

  const management = organization.managementAccountId
  if (management === self) {
    return {
      verdict: "WORKLOAD_IN_MANAGEMENT_ACCOUNT",
      detail:
        `finding — this workload runs in account ${self}, which is the Organizations management account ` +
        `(${management}). An account that can attach a service control policy must not also run the ` +
        `workload that policy restrains.`,
      selfAccountId: self,
      managementAccountId: management,
    }
  }

  return {
    verdict: "SEPARATED",
    detail:
      `separated — this workload runs in account ${self}; the Organization is managed by ${management}.`,
    selfAccountId: self,
    managementAccountId: management,
  }
}

/* -------------------------------------------------------- centralization -- */

export type ClauseVerdict = "CENTRALIZED" | "LOCAL_ONLY" | "ABSENT" | "UNKNOWN"

export interface PostureRow {
  clause: string
  verdict: ClauseVerdict
  detail: string
  deniedAction?: string
  minimumStatement?: string
}

interface DescribeTrailsResponse {
  trailList?: Array<{
    Name?: string
    IsOrganizationTrail?: boolean
    IsMultiRegionTrail?: boolean
    LogFileValidationEnabled?: boolean
    S3BucketName?: string
    HomeRegion?: string
  }>
}

interface AggregatorsResponse {
  ConfigurationAggregators?: Array<{
    ConfigurationAggregatorName?: string
    OrganizationAggregationSource?: unknown
    AccountAggregationSources?: unknown[]
  }>
}

interface ReportDefinitionsResponse {
  ReportDefinitions?: Array<{ ReportName?: string; S3Bucket?: string; S3Prefix?: string }>
}

/**
 * Turn a reading into a clause row.
 *
 * The mapping is here, once, so no clause can decide for itself that a denial
 * means "absent". `whenActual` is the only place a verdict other than UNKNOWN
 * can be produced from a failed read — and it is never called for one.
 */
function rowFor<T>(
  clause: string,
  read: AwsRead<T>,
  whenActual: (value: T) => { verdict: ClauseVerdict; detail: string },
  whenEmpty: { verdict: ClauseVerdict; detail: string },
): PostureRow {
  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      return { clause, ...whenActual(read.value) }
    case "EMPTY":
      return { clause, ...whenEmpty }
    case "DENIED":
      return {
        clause,
        verdict: "UNKNOWN",
        detail: `unknown — the engine's role lacks ${read.action} (${read.errorCode}), so this was never checked.`,
        deniedAction: read.action,
        minimumStatement: read.minimumStatement,
      }
    case "THROTTLED":
      return {
        clause,
        verdict: "UNKNOWN",
        detail: `unknown — AWS rate-limited ${read.capability}; retrying in ${read.retryAfterMs}ms.`,
      }
    case "UNCONFIGURED":
      return { clause, verdict: "UNKNOWN", detail: `unknown — ${read.why}` }
    case "ERROR":
      return { clause, verdict: "UNKNOWN", detail: `unknown — ${read.code}: ${read.safeDetail}` }
  }
}

async function read<T>(
  gw: AwsGateway,
  capability: Capability,
  map: (raw: unknown) => T,
  ctx: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<T>> {
  return readAws<T>(capability, async () => map(await gw.call(capability)), {
    now: ctx.now,
    denial: ctx.denial,
  })
}

export interface CentralizationPosture {
  identity: AwsRead<Identity>
  organization: OrganizationRead
  management: ManagementAccountFinding
  rows: readonly PostureRow[]
}

/**
 * Every centralization clause, read live.
 *
 * `apps/system-studio/src/app/platform/estate/page.tsx` calls this with no
 * arguments; the tests call it with a stand-in gateway. Same function.
 */
export async function centralizationPosture(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<CentralizationPosture> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const organization = await describeOrganization(supplied, { now, denial })
  const ctx = { now, denial }

  const [trails, aggregators, reports] = await Promise.all([
    read(gw, "cloudtrail:DescribeTrails", (raw) => (raw as DescribeTrailsResponse)?.trailList ?? [], ctx),
    read(
      gw,
      "config:DescribeConfigurationAggregators",
      (raw) => (raw as AggregatorsResponse)?.ConfigurationAggregators ?? [],
      ctx,
    ),
    read(
      gw,
      "cur:DescribeReportDefinitions",
      (raw) => (raw as ReportDefinitionsResponse)?.ReportDefinitions ?? [],
      ctx,
    ),
  ])

  const rows: PostureRow[] = [
    rowFor(
      "Organization trail",
      trails,
      (list) => {
        const org = list.find((t) => t.IsOrganizationTrail)
        if (org) {
          return {
            verdict: "CENTRALIZED",
            detail:
              `${org.Name} is an organization trail` +
              `${org.IsMultiRegionTrail ? ", multi-region" : ", SINGLE-REGION — events outside " + (org.HomeRegion ?? "its home region") + " are not recorded"}` +
              `${org.LogFileValidationEnabled ? ", with log-file validation" : ", WITHOUT log-file validation"}.`,
          }
        }
        const names = list.map((t) => t.Name ?? "unnamed").join(", ")
        return {
          verdict: "LOCAL_ONLY",
          detail: `${list.length} trail(s) — ${names} — and none is an organization trail. Each account records only itself.`,
        }
      },
      { verdict: "ABSENT", detail: "cloudtrail:DescribeTrails succeeded and returned no trails at all." },
    ),
    rowFor(
      "Config aggregation",
      aggregators,
      (list) => {
        const org = list.find((a) => a.OrganizationAggregationSource)
        return org
          ? {
              verdict: "CENTRALIZED",
              detail: `${org.ConfigurationAggregatorName} aggregates configuration across the organization.`,
            }
          : {
              verdict: "LOCAL_ONLY",
              detail: `${list.length} aggregator(s), none organization-wide — configuration state is per account.`,
            }
      },
      { verdict: "ABSENT", detail: "No configuration aggregator exists; there is no fleet-wide configuration view." },
    ),
    rowFor(
      "Cost and Usage Report",
      reports,
      (list) => ({
        verdict: "CENTRALIZED",
        detail: `${list.length} report definition(s): ${list
          .map((r) => `${r.ReportName ?? "unnamed"} → s3://${r.S3Bucket ?? "?"}/${r.S3Prefix ?? ""}`)
          .join(", ")}.`,
      }),
      {
        verdict: "ABSENT",
        detail:
          "cur:DescribeReportDefinitions succeeded and returned nothing — no Cost and Usage Report is delivered, " +
          "so there is no billing data any allocation could reconcile to the invoice.",
      },
    ),
  ]

  return {
    identity,
    organization,
    management: managementAccountVerdict(identity, organization),
    rows,
  }
}

/**
 * What the FinOps page needs to tell "nobody created a CUR" from "one exists and
 * this role cannot see it".
 *
 * `cost-source.ts` renders NOT_CONFIGURED when `FINOPS_CUR_BUCKET` is unset,
 * which used to be the console's only sentence on the subject and could not
 * distinguish those two. This is the missing half; `cost-source.ts` consumes it.
 */
export type CurExistence =
  | { state: "DEFINED"; reportNames: readonly string[]; bucket: string; prefix: string }
  | { state: "NONE_DEFINED" }
  | { state: "UNKNOWN"; action: string; errorCode: string; minimumStatement: string }

export async function curExistence(
  supplied?: AwsGateway,
  options: { now?: () => Date; denial?: DenialContext } = {},
): Promise<CurExistence> {
  const gw = supplied ?? liveGateway()
  const reads = await read(
    gw,
    "cur:DescribeReportDefinitions",
    (raw) => (raw as ReportDefinitionsResponse)?.ReportDefinitions ?? [],
    { now: options.now ?? (() => new Date()), denial: options.denial ?? { principal: "unknown principal", accountId: null, region: null, partition: null } },
  )

  switch (reads.state) {
    case "ACTUAL":
    case "STALE":
      return {
        state: "DEFINED",
        reportNames: reads.value.map((r) => r.ReportName ?? "unnamed"),
        bucket: reads.value[0]?.S3Bucket ?? "",
        prefix: reads.value[0]?.S3Prefix ?? "",
      }
    case "EMPTY":
      return { state: "NONE_DEFINED" }
    case "DENIED":
      return {
        state: "UNKNOWN",
        action: reads.action,
        errorCode: reads.errorCode,
        minimumStatement: reads.minimumStatement,
      }
    default:
      return {
        state: "UNKNOWN",
        action: "cur:DescribeReportDefinitions",
        errorCode: reads.state,
        minimumStatement: minimumStatementText("cur:DescribeReportDefinitions"),
      }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* STUDIO-110-009 — security posture, aggregated across every readable service */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ── The one rule this half of the module exists to enforce ─────────────────
 *
 * **A check that did not RUN is not a check that PASSED.**
 *
 * It is enforced structurally rather than by convention, in three places:
 *
 *   1. `SecurityPostureItem` is a FOUR-armed discriminated union. There is no
 *      boolean, no `ok?: boolean`, and no optional field whose absence reads as
 *      fine. `NOT_CHECKED` cannot be constructed without a `reason` AND a
 *      `remedy`; `UNKNOWN` cannot be constructed without the refused `action`
 *      and a pasteable `minimumStatement`; and — the part that costs something —
 *      `PASS` cannot be constructed without `basis` (what actually ran),
 *      `checked` (how many things it ran over) and `limits` (what this pass does
 *      NOT cover, named). A pass that cannot say what it looked at does not
 *      compile.
 *
 *   2. `PostureScore` is itself a union, and its `CLEAN` arm types `fail`,
 *      `notChecked` and `unknown` as the LITERAL `0`. It is therefore not
 *      possible — not merely discouraged — to construct a clean verdict while
 *      any item is unchecked or unknown: `tsc` rejects it at the construction
 *      site. `INCOMPLETE` types `fail` as the literal `0` for the same reason.
 *      Every arm carries all four counts, so a score can never be printed
 *      without the number of questions nobody answered next to it.
 *
 *   3. No fold below has a branch from a failed read to `PASS`. Every reader in
 *      this directory already returns a union whose "we could not look" arm is
 *      distinct from its "we looked and there is nothing" arm, and each fold
 *      maps those two to different states rather than collapsing them.
 *
 * The concrete failure this shape prevents is named in the item list: a
 * GuardDuty detector that is switched off returns zero findings, and a
 * three-valued model renders that as a quiet account. Here it is `NOT_CHECKED`,
 * and it drags the whole score off `CLEAN` on its own. So does a detector that
 * exists but whose ENABLED/SUSPENDED status this engine cannot read — see
 * `foldGuardDuty`, which has no `PASS` branch at all.
 *
 * ── Nothing here calls AWS ─────────────────────────────────────────────────
 *
 * `securityPostureFrom` is pure: it takes the twelve readings a caller already
 * loaded and returns the items and the score. `securityPosture` is the thin
 * loader that runs the twelve readers and calls it. That split is what lets
 * every arm — including the ones an operator pointed at a healthy estate can
 * never reach — be driven from a test with no AWS account.
 *
 * ── Adding a service is a compile error until it is folded ─────────────────
 *
 * `SecurityPostureInput` has twelve REQUIRED fields and no optional ones. A
 * thirteenth reader is added by adding a required field, which breaks every
 * construction site — `securityPosture` here, and every test — rather than
 * silently producing a posture with one fewer question in it. An optional field
 * would have been invisible to `tsc` at exactly the call sites that omit it.
 */

/* ------------------------------------------------------------ the states -- */

/**
 * The four states, and there is no fifth.
 *
 * `NOT_CHECKED` is a fact about the ESTATE: the control is off, absent, stopped
 * or covering only part of what it claims. `UNKNOWN` is a fact about this
 * CONSOLE: the call was refused, throttled, unconfigured or broken. They are
 * separate because their remedies are opposite — turn the control on, versus
 * grant this engine a statement — and a page that collapsed them would send
 * every operator to do the wrong one of the two.
 */
export type PostureState = "PASS" | "FAIL" | "NOT_CHECKED" | "UNKNOWN"

/**
 * How loud a `FAIL` is.
 *
 * `UNRANKED` is not a synonym for LOW: it is what a source that gave a severity
 * this engine could not read produces, and it sorts ABOVE `CRITICAL` for the
 * same reason `guardduty.ts` ranks its own `UNRANKED` band first. A finding
 * nobody classified must not be filed where nobody scrolls.
 */
export type PostureSeverity = "UNRANKED" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"

const SEVERITY_RANK: Readonly<Record<PostureSeverity, number>> = {
  UNRANKED: 0,
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
}

/** The four words `/platform/security` asks, and the only four an item may answer. */
export type PostureQuestion = "exposed" | "unencrypted" | "unrotated" | "unwatched"

/** Which reader produced an item. Closed, so a fold cannot invent a service. */
export type PostureService =
  | "guardduty"
  | "analyzer"
  | "s3"
  | "kms"
  | "secretsmanager"
  | "ec2"
  | "wafv2"
  | "ecr"
  | "config"
  | "cloudtrail"
  | "cognito"
  | "iam"

interface PostureItemBase {
  /**
   * Stable across a merge.
   *
   * These keys are deliberately the ones `app/platform/security/posture.ts`
   * declares in `UNWIRED_CONTROLS`, so `controlsFor()` — which merges live rows
   * over its placeholders BY KEY — replaces the placeholder with the live row
   * and never renders both. The two `iam::` keys match the rows
   * `controlsFromIam` already produces, so the merge is idempotent there too
   * rather than duplicating the sweep.
   */
  key: string
  service: PostureService
  question: PostureQuestion
  /** The control's own name, as AWS spells it. */
  control: string
  /** What an answer from this control would tell an operator. */
  answers: string
}

/**
 * One posture item, four-valued.
 *
 * Each arm carries exactly what that arm has to be able to say, and nothing is
 * optional. See the section header for why `PASS` is the expensive one.
 */
export type SecurityPostureItem =
  | (PostureItemBase & {
      state: "PASS"
      /** What actually ran, in the reader's own terms. Never "no issues found". */
      basis: string
      /** How many things it ran over. `0` is legitimate and must be stated. */
      checked: number
      /**
       * What this pass does NOT cover, named.
       *
       * Required, because the qualification is the part that gets dropped. ECR's
       * pass carries the registry-scanning gap; S3's carries nothing because
       * there is nothing to carry. An empty array is a claim in itself.
       */
      limits: readonly string[]
    })
  | (PostureItemBase & {
      state: "FAIL"
      severity: PostureSeverity
      /** The reader's own sentence about what is wrong. */
      detail: string
      /** What to do about it. Never "investigate", never "try again". */
      remedy: string
      /** The resources this is about — bucket names, key ids, group ids, ARNs. */
      subjects: readonly string[]
    })
  | (PostureItemBase & {
      state: "NOT_CHECKED"
      /** Why the control did not run. A fact about the estate. */
      reason: string
      /** How to make it run. */
      remedy: string
    })
  | (PostureItemBase & {
      state: "UNKNOWN"
      /** Why this console could not read it. A fact about this console's grants. */
      reason: string
      /** The AWS action, spelled as IAM spells it. */
      action: string
      /** JSON an operator pastes into a policy. */
      minimumStatement: string
    })

/* -------------------------------------------------------------- the score -- */

/**
 * The summary, as a union whose clean arm cannot hold a non-zero gap.
 *
 * `fail: 0`, `notChecked: 0` and `unknown: 0` are LITERAL types on `CLEAN`.
 * That is the whole mechanism: `scorePosture` cannot return a clean verdict off
 * an estate with an unchecked control without the compiler rejecting the object
 * it is trying to return. A convention would have been a comment; this is a
 * build failure.
 */
export type PostureScore =
  | {
      verdict: "CLEAN"
      total: number
      pass: number
      fail: 0
      notChecked: 0
      unknown: 0
      /** Why the verdict is that, naming every count it rests on. */
      because: string
    }
  | {
      verdict: "FAILING"
      total: number
      pass: number
      fail: number
      notChecked: number
      unknown: number
      /** The worst severity open. Present only on this arm — there is no other. */
      worst: PostureSeverity
      because: string
    }
  | {
      verdict: "INCOMPLETE"
      total: number
      pass: number
      fail: 0
      notChecked: number
      unknown: number
      because: string
    }

/** Whether this is the arm that says the estate is clean. Narrows for a caller. */
export function isCleanScore(
  score: PostureScore,
): score is Extract<PostureScore, { verdict: "CLEAN" }> {
  return score.verdict === "CLEAN"
}

/** The counts, computed once so no caller re-derives them differently. */
function countStates(
  items: readonly SecurityPostureItem[],
): { pass: number; fail: number; notChecked: number; unknown: number } {
  let pass = 0
  let fail = 0
  let notChecked = 0
  let unknown = 0
  for (const item of items) {
    if (item.state === "PASS") pass += 1
    else if (item.state === "FAIL") fail += 1
    else if (item.state === "NOT_CHECKED") notChecked += 1
    else unknown += 1
  }
  return { pass, fail, notChecked, unknown }
}

/** The worst severity among the failing items, or null when nothing failed. */
function worstSeverity(items: readonly SecurityPostureItem[]): PostureSeverity | null {
  let worst: PostureSeverity | null = null
  for (const item of items) {
    if (item.state !== "FAIL") continue
    if (worst === null || SEVERITY_RANK[item.severity] < SEVERITY_RANK[worst]) {
      worst = item.severity
    }
  }
  return worst
}

/**
 * The one summary, and the only place a verdict is decided.
 *
 * Order of precedence, and it is the argument:
 *
 *   1. anything FAILING  — the loudest thing that is true
 *   2. anything unchecked or unknown — clean FROM WHAT RAN, which is not clean
 *   3. otherwise CLEAN, and only then
 *
 * Step 2 is reachable with `fail === 0` and is why the `INCOMPLETE` arm types
 * `fail` as `0`. Step 3 is unreachable while either gap count is non-zero, and
 * the compiler is what makes it unreachable rather than this comment.
 */
export function scorePosture(items: readonly SecurityPostureItem[]): PostureScore {
  const { pass, fail, notChecked, unknown } = countStates(items)
  const total = items.length
  const counts =
    `${pass} passed, ${fail} failed, ${notChecked} were not checked at all and ` +
    `${unknown} could not be read by this engine, of ${total} security questions this console asks.`

  if (fail > 0) {
    // `worstSeverity` cannot be null here — `fail > 0` means at least one FAIL
    // item exists — but the fallback is UNRANKED rather than a non-null
    // assertion, because an unrankable severity is the honest answer to "we
    // have a failure and cannot rank it" and a `!` would be a claim.
    const worst = worstSeverity(items) ?? "UNRANKED"
    return {
      verdict: "FAILING",
      total,
      pass,
      fail,
      notChecked,
      unknown,
      worst,
      because:
        `${counts} The worst open failure is ${worst}. ` +
        `Neither number below the failures is a total: a question in the ` +
        `${notChecked + unknown} that went unanswered cannot produce a failure here at all.`,
    }
  }

  if (notChecked > 0 || unknown > 0) {
    return {
      verdict: "INCOMPLETE",
      total,
      pass,
      fail: 0,
      notChecked,
      unknown,
      because:
        `${counts} Nothing failed among the checks that RAN, and that says nothing whatsoever ` +
        `about the ${notChecked + unknown} question${notChecked + unknown === 1 ? "" : "s"} nobody ` +
        `answered. This is not a clean bill of health and this engine will not print one until ` +
        `every question is answered.`,
    }
  }

  return {
    verdict: "CLEAN",
    total,
    pass,
    fail: 0,
    notChecked: 0,
    unknown: 0,
    because:
      `${counts} Every question this console asks was asked of this account, over everything ` +
      `each control claims to cover, and none of them found anything. That is coverage rather ` +
      `than an absence of bad news, which is the only condition under which this engine says clean.`,
  }
}

/* ---------------------------------------------------------- fold helpers -- */

/**
 * The action and the pasteable statement for an `UNKNOWN` item.
 *
 * A DENIED read already worked out both — `read.action` is the action AWS
 * refused and `read.minimumStatement` is the JSON — so they are taken from it
 * verbatim rather than re-derived, which is how two sentences describing one
 * fact drift. A throttle, an unconfigured endpoint and an error carry no action,
 * so the capability the fold names is used instead.
 */
function refusalOf(
  read: AwsRead<unknown> | null,
  fallback: Capability,
): { action: string; minimumStatement: string } {
  if (read && read.state === "DENIED") {
    return { action: read.action, minimumStatement: read.minimumStatement }
  }
  return { action: fallback, minimumStatement: minimumStatementText(fallback) }
}

/** The `PostureSeverity` for a GuardDuty band, without remapping its meaning. */
function severityOfBand(band: SeverityBand): PostureSeverity {
  switch (band) {
    case "CRITICAL":
      return "CRITICAL"
    case "HIGH":
      return "HIGH"
    case "MEDIUM":
      return "MEDIUM"
    case "LOW":
    case "INFORMATIONAL":
      return "LOW"
    case "UNRANKED":
      return "UNRANKED"
  }
}

/* --------------------------------------------------------------- folds --- */

/**
 * GuardDuty, and it has no `PASS` branch.
 *
 * That is not an oversight. Coverage means "the control is running and we can
 * see that it is running", and the second half needs `guardduty:GetDetector`,
 * which is not in this engine's capability registry — `guardDutyCoverage` in
 * `guardduty.ts` says the same thing and caps itself at `PARTIAL` for the same
 * reason. A SUSPENDED detector generates no new findings and describes, through
 * `ListDetectors`, exactly like a running one. So a zero here is `NOT_CHECKED`
 * and the estate cannot score CLEAN on it. This is the failure the whole shape
 * exists for.
 */
export function foldGuardDuty(readings: GuardDutyReadings): SecurityPostureItem {
  const base = {
    key: "guardduty::detectors",
    service: "guardduty",
    question: "unwatched",
    control: "GuardDuty detector state",
    answers:
      "whether a detector exists in this region and what it has found — read directly rather than " +
      "through Security Hub, because a disabled detector aggregates as a product with no findings",
  } as const

  const posture = readings.posture
  switch (posture.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: posture.why,
        ...refusalOf(readings.detectors, "guardduty:ListDetectors"),
      }
    case "not-enabled":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          "guardduty:ListDetectors answered, and there is NO detector in this region. Nothing is " +
          "analysing this account's CloudTrail management events, VPC flow logs or DNS queries for " +
          "a compromise, so every empty finding list on this console is explained by that rather " +
          "than by a quiet account.",
        remedy:
          "Enable a GuardDuty detector in this region — `aws_guardduty_detector` in " +
          "infrastructure/terraform/, or guardduty:CreateDetector in the console.",
      }
    case "detectors-present": {
      if (posture.totalFindings > 0) {
        const worst = posture.severityCounts
          .filter((count) => count.count > 0)
          .map((count) => severityOfBand(count.band))
          .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0]
        return {
          ...base,
          state: "FAIL",
          severity: worst ?? "UNRANKED",
          detail:
            `${posture.totalFindings} GuardDuty finding(s) were read across ` +
            `${posture.detectorIds.length} detector(s). ${posture.caveat}`,
          remedy:
            "Open GuardDuty in this region and triage each finding. The finding list this engine " +
            "read is a floor, not a total, for the reason stated in the detail.",
          subjects: posture.detectorIds,
        }
      }
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          `${posture.detectorIds.length} detector(s) exist and returned no finding, and ` +
          `${posture.caveat}` +
          (posture.unreadable.length > 0
            ? ` Findings could not be read for ${posture.unreadable.join(", ")}.`
            : ""),
        remedy:
          "Add guardduty:GetDetector to this engine's capability registry and to its role, so a " +
          "SUSPENDED detector is distinguishable here from a running one. Until then, confirm the " +
          "detector's status in the GuardDuty console.",
      }
    }
  }
}

/** IAM Access Analyzer: is anything in this estate shared outside the account. */
export function foldAnalyzer(readings: AnalyzerReadings): SecurityPostureItem {
  const base = {
    key: "analyzer::exists",
    service: "analyzer",
    question: "exposed",
    control: "Access Analyzer external access",
    answers:
      "which resources this account shares with another account, an organization, or the public",
  } as const

  const state = readings.externalAccess
  switch (state.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: state.why,
        ...refusalOf(readings.analyzers, "access-analyzer:ListAnalyzers"),
      }
    case "no-analyzer":
    case "not-answering":
      return { ...base, state: "NOT_CHECKED", reason: state.why, remedy: state.remedy }
    case "findings-unreadable":
      return {
        ...base,
        state: "UNKNOWN",
        reason: `${state.why} Unreadable: ${state.unreadable.join(", ")}.`,
        action: "access-analyzer:ListFindingsV2",
        minimumStatement: minimumStatementText("access-analyzer:ListFindingsV2"),
      }
    case "external-access":
      return {
        ...base,
        state: "FAIL",
        severity: "CRITICAL",
        detail:
          `${state.totalActive} ACTIVE external-access finding(s) across ` +
          `${state.exposures.length} read exposure(s)` +
          (state.truncated ? ", and the finding listing was truncated — this is a floor" : "") +
          (state.unreadable.length > 0
            ? `. Findings could not be read on ${state.unreadable.join(", ")}`
            : "") +
          ".",
        remedy:
          "Open IAM Access Analyzer and, for each finding, either remove the grant or archive it " +
          "with a stated reason. A resource shared outside this account is reachable by whoever " +
          "holds the other side.",
        subjects: state.exposures.map((exposure) => exposure.resource ?? exposure.findingId),
      }
    case "none-found": {
      if (state.unreadable.length > 0 || state.truncated) {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `${state.analyzersRead.length} analyzer(s) answered and reported no ACTIVE ` +
            `external-access finding, but the answer does not cover the whole estate` +
            (state.unreadable.length > 0
              ? `: findings could not be read on ${state.unreadable.join(", ")}`
              : "") +
            (state.truncated ? ": the finding listing was truncated" : "") +
            ".",
          remedy:
            "Grant this engine access-analyzer:ListFindingsV2 on the analyzers named above, or " +
            "read them in the IAM Access Analyzer console. Until then this row is a floor.",
        }
      }
      return {
        ...base,
        state: "PASS",
        basis:
          `${state.analyzersRead.length} external-access analyzer(s) answered — ` +
          `${state.analyzersRead.join(", ")} — and not one ACTIVE external-access finding came back.`,
        checked: state.analyzersRead.length,
        limits: [],
      }
    }
  }
}

/**
 * S3 public access — the block, the policy status and the ACLs, as one item.
 *
 * `publicExposure` in `buckets.ts` already refuses to say "closed" without
 * naming the buckets it could not fully read, so `none-observed` with a
 * non-empty `partiallyUnread` is NOT_CHECKED here rather than a pass with a
 * footnote. A truncated bucket listing does the same thing for the same reason:
 * a bucket this engine never listed cannot be reported as closed.
 */
export function foldBucketPublicAccess(readings: S3Readings): SecurityPostureItem {
  const base = {
    key: "s3::public-access",
    service: "s3",
    question: "exposed",
    control: "S3 public access block",
    answers:
      "which buckets have a public access block, whether all four of its flags are set, and " +
      "whether S3 itself reports the bucket policy as public",
  } as const

  const exposure = readings.publicExposure
  if (exposure.kind === "unknown") {
    return {
      ...base,
      state: "UNKNOWN",
      reason: exposure.why,
      ...refusalOf(readings.buckets, "s3:ListBuckets"),
    }
  }

  if (exposure.kind === "exposed") {
    return {
      ...base,
      state: "FAIL",
      severity: exposure.buckets.some((bucket) => bucket.policySaysPublic) ? "CRITICAL" : "HIGH",
      detail: exposure.buckets
        .map((bucket) => `${bucket.bucket}: ${bucket.reasons.join("; ")}`)
        .join(" · "),
      remedy:
        "Set the account-level and bucket-level public access blocks with all four flags on, and " +
        "remove any bucket policy statement granting a wildcard principal.",
      subjects: exposure.buckets.map((bucket) => bucket.bucket),
    }
  }

  const truncated = readings.listing.kind !== "complete"
  if (exposure.partiallyUnread.length > 0 || truncated) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${exposure.bucketsRead} bucket(s) answered and none of them is public` +
        (exposure.partiallyUnread.length > 0
          ? `, but an exposure fact could not be read on ${exposure.partiallyUnread.join(", ")}`
          : "") +
        (truncated
          ? `, and the bucket listing did not complete: ${
              readings.listing.kind === "not-listed" || readings.listing.kind === "truncated"
                ? readings.listing.why
                : "the listing is not complete"
            }`
          : "") +
        ".",
      remedy:
        "Grant this engine s3:GetBucketPublicAccessBlock and s3:GetBucketPolicyStatus on the " +
        "buckets named above, or read them in the S3 console. A bucket nobody read is not a " +
        "bucket that is closed.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${exposure.bucketsRead} bucket(s) were read in full; every one has a public access block ` +
      `with all four flags set, and S3 reports none of them public.`,
    checked: exposure.bucketsRead,
    limits: [],
  }
}

/** Buckets whose named fact answered, split into those that satisfy it and those that do not. */
function bucketSplit<T>(
  buckets: readonly BucketReading[],
  pick: (bucket: BucketReading) => AwsRead<T>,
  satisfies: (value: T) => boolean,
): { good: string[]; bad: string[]; unread: string[] } {
  const good: string[] = []
  const bad: string[] = []
  const unread: string[] = []
  for (const bucket of buckets) {
    const read = pick(bucket)
    if (read.state === "ACTUAL" || read.state === "STALE") {
      ;(satisfies(read.value) ? good : bad).push(bucket.name)
    } else if (read.state === "EMPTY") {
      // An EMPTY posture read is a successful call that returned no
      // configuration, which for these three facts is the ABSENCE of the
      // configuration rather than an unread one. `buckets.ts` maps the "no such
      // configuration" errors onto real facts, so reaching here means AWS
      // answered with nothing at all — which cannot be scored either way.
      unread.push(bucket.name)
    } else {
      unread.push(bucket.name)
    }
  }
  return { good, bad, unread }
}

/** S3 default encryption, per bucket. SSE-S3 counts; no default rule does not. */
export function foldBucketEncryption(readings: S3Readings): SecurityPostureItem {
  const base = {
    key: "s3::encryption",
    service: "s3",
    question: "unencrypted",
    control: "S3 default encryption",
    answers: "whether each bucket encrypts new objects by default, and under which key",
  } as const

  if (readings.buckets.state !== "ACTUAL" && readings.buckets.state !== "STALE") {
    if (readings.buckets.state === "EMPTY") {
      return {
        ...base,
        state: "PASS",
        basis:
          "s3:ListBuckets answered and this account owns no bucket, so there is no bucket that " +
          "could be storing anything unencrypted.",
        checked: 0,
        limits: [],
      }
    }
    return {
      ...base,
      state: "UNKNOWN",
      reason: `the bucket listing came back ${readings.buckets.state}, so no bucket was read.`,
      ...refusalOf(readings.buckets, "s3:ListBuckets"),
    }
  }

  const split = bucketSplit(
    readings.buckets.value,
    (bucket) => bucket.encryption,
    (fact) => fact.kind === "sse-kms" || fact.kind === "dsse-kms" || fact.kind === "sse-s3",
  )

  if (split.bad.length > 0) {
    return {
      ...base,
      state: "FAIL",
      severity: "HIGH",
      detail:
        `${split.bad.length} bucket(s) have no default encryption rule, or an algorithm this ` +
        `engine does not recognise: ${split.bad.join(", ")}.`,
      remedy:
        "Set default encryption on each bucket named — `aws:kms` where the estate needs a key it " +
        "can revoke, `AES256` otherwise. Objects written before the rule exists stay unencrypted.",
      subjects: split.bad,
    }
  }

  const truncated = readings.listing.kind !== "complete"
  if (split.unread.length > 0 || truncated) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${split.good.length} bucket(s) encrypt by default` +
        (split.unread.length > 0
          ? `, and s3:GetBucketEncryption did not answer for ${split.unread.join(", ")}`
          : "") +
        (truncated ? ", and the bucket listing did not complete" : "") +
        ".",
      remedy:
        "Grant this engine s3:GetBucketEncryption on the buckets named, or read them in the S3 " +
        "console. A bucket whose encryption nobody read is not an encrypted bucket.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis: `${split.good.length} bucket(s) were read and every one has a default encryption rule.`,
    checked: split.good.length,
    limits: [
      "a default encryption rule applies to objects written AFTER it was set; objects already in " +
        "the bucket are not re-encrypted by it and this engine does not read object metadata.",
    ],
  }
}

/**
 * S3 versioning.
 *
 * Filed under `unwatched` — "changing with no control looking at it" — because
 * that is precisely what an unversioned bucket is: an object overwritten or
 * deleted in it leaves no record that it ever existed. `Suspended` and
 * `never-enabled` are both failures and `buckets.ts` keeps them apart, so the
 * detail says which.
 */
export function foldBucketVersioning(readings: S3Readings): SecurityPostureItem {
  const base = {
    key: "s3::versioning",
    service: "s3",
    question: "unwatched",
    control: "S3 bucket versioning",
    answers:
      "whether an overwrite or a delete in each bucket is recoverable, and whether MFA delete is on",
  } as const

  if (readings.buckets.state !== "ACTUAL" && readings.buckets.state !== "STALE") {
    if (readings.buckets.state === "EMPTY") {
      return {
        ...base,
        state: "PASS",
        basis: "s3:ListBuckets answered and this account owns no bucket.",
        checked: 0,
        limits: [],
      }
    }
    return {
      ...base,
      state: "UNKNOWN",
      reason: `the bucket listing came back ${readings.buckets.state}, so no bucket was read.`,
      ...refusalOf(readings.buckets, "s3:ListBuckets"),
    }
  }

  const split = bucketSplit(
    readings.buckets.value,
    (bucket) => bucket.versioning,
    (fact) => fact.status === "Enabled",
  )

  if (split.bad.length > 0) {
    return {
      ...base,
      state: "FAIL",
      severity: "MEDIUM",
      detail:
        `${split.bad.length} bucket(s) are not versioning: ${split.bad.join(", ")}. An overwrite ` +
        `or a delete in one of them leaves nothing behind to restore or to compare against.`,
      remedy:
        "Enable versioning on each bucket named, and add a lifecycle rule expiring noncurrent " +
        "versions so the storage cost is bounded.",
      subjects: split.bad,
    }
  }

  const truncated = readings.listing.kind !== "complete"
  if (split.unread.length > 0 || truncated) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${split.good.length} bucket(s) are versioning` +
        (split.unread.length > 0
          ? `, and s3:GetBucketVersioning did not answer for ${split.unread.join(", ")}`
          : "") +
        (truncated ? ", and the bucket listing did not complete" : "") +
        ".",
      remedy:
        "Grant this engine s3:GetBucketVersioning on the buckets named, or read them in the S3 " +
        "console.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis: `${split.good.length} bucket(s) were read and every one is versioning.`,
    checked: split.good.length,
    limits: [
      "versioning being ON is not the same as MFA delete being on; this item does not fail a " +
        "bucket for MFA delete, which S3 omits entirely on a bucket that has never versioned.",
    ],
  }
}

/** KMS key rotation. `notApplicable` is neither a pass nor a finding, and is not counted as one. */
export function foldKeyRotation(readings: KmsReadings): SecurityPostureItem {
  const base = {
    key: "kms::rotation",
    service: "kms",
    question: "unrotated",
    control: "KMS key rotation",
    answers:
      "whether automatic annual rotation is on for each CUSTOMER-MANAGED key — AWS-managed keys " +
      "rotate on AWS's own schedule and are excluded from every count rather than counted as passing",
  } as const

  if (readings.keys.state !== "ACTUAL" && readings.keys.state !== "STALE") {
    if (readings.keys.state === "EMPTY") {
      return {
        ...base,
        state: "PASS",
        basis: "kms:ListKeys answered and this account holds no key at all.",
        checked: 0,
        limits: [],
      }
    }
    return {
      ...base,
      state: "UNKNOWN",
      reason: `the key listing came back ${readings.keys.state}, so no key was read.`,
      ...refusalOf(readings.keys, "kms:ListKeys"),
    }
  }

  const posture = readings.posture
  if (posture.pendingDeletion.length > 0 || posture.notRotating.length > 0) {
    const subjects = [
      ...posture.notRotating,
      ...posture.pendingDeletion.map((entry) => entry.keyId),
    ]
    return {
      ...base,
      state: "FAIL",
      severity: posture.pendingDeletion.length > 0 ? "CRITICAL" : "HIGH",
      detail:
        (posture.notRotating.length > 0
          ? `${posture.notRotating.length} customer-managed key(s) are not rotating: ${posture.notRotating.join(", ")}. `
          : "") +
        (posture.pendingDeletion.length > 0
          ? `${posture.pendingDeletion.length} key(s) are scheduled for deletion: ${posture.pendingDeletion
              .map((entry) => `${entry.keyId} on ${entry.deletionDate ?? "a date AWS did not return"}`)
              .join(", ")}.`
          : ""),
      remedy:
        "Enable rotation with kms:EnableKeyRotation on each key named, and cancel any deletion " +
        "that was not intended — a key deleted takes every ciphertext under it with it.",
      subjects,
    }
  }

  const incomplete =
    !posture.complete ||
    posture.rotationUnknown.length > 0 ||
    posture.unreadable.length > 0 ||
    posture.unrecognisedManagement.length > 0
  if (incomplete) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${posture.rotating} of ${posture.customerManagedRead} customer-managed key(s) whose ` +
        `rotation was read are rotating, and this is not the whole estate` +
        (posture.rotationUnknown.length > 0
          ? `: rotation status was unreadable on ${posture.rotationUnknown.join(", ")}`
          : "") +
        (posture.unreadable.length > 0
          ? `: kms:DescribeKey did not answer for ${posture.unreadable.join(", ")}`
          : "") +
        (posture.unrecognisedManagement.length > 0
          ? `: AWS reported a key manager this engine does not model for ${posture.unrecognisedManagement.join(", ")}`
          : "") +
        (readings.truncation.kind !== "complete" ? `: ${readings.truncation.why}` : "") +
        ".",
      remedy:
        "Grant this engine kms:GetKeyRotationStatus and kms:DescribeKey on the keys named, or " +
        "raise the read budget. A key whose rotation nobody read is not a rotating key.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${posture.rotating} of ${posture.customerManagedRead} customer-managed key(s) are rotating; ` +
      `${posture.notApplicable.length} cannot rotate at all and ${posture.awsManagedExcluded} ` +
      `AWS-managed key(s) are excluded from both counts.`,
    checked: posture.customerManagedRead,
    limits: [
      `${posture.awsManagedExcluded} AWS-managed key(s) are excluded rather than passed: this ` +
        "engine does not read AWS's own rotation schedule for them.",
      ...(posture.notApplicable.length > 0
        ? [
            `${posture.notApplicable.length} customer-managed key(s) cannot have rotation enabled ` +
              `at all: ${posture.notApplicable.join(", ")}.`,
          ]
        : []),
    ],
  }
}

/** Secrets Manager rotation, and the age of what has not rotated. */
export function foldSecretRotation(readings: SecretsReadings): SecurityPostureItem {
  const base = {
    key: "secrets::rotation",
    service: "secretsmanager",
    question: "unrotated",
    control: "Secrets Manager rotation",
    answers:
      "which secrets have no rotation configured, which are past the interval somebody set for " +
      "them, and which are inside a deletion recovery window — never a secret VALUE",
  } as const

  const posture = readings.posture
  if (posture.kind === "unknown") {
    return {
      ...base,
      state: "UNKNOWN",
      reason: posture.why,
      ...refusalOf(readings.secrets, "secretsmanager:ListSecrets"),
    }
  }

  if (posture.noRotation.length > 0 || posture.overdue.length > 0) {
    return {
      ...base,
      state: "FAIL",
      severity: posture.overdue.length > 0 ? "HIGH" : "MEDIUM",
      detail:
        (posture.noRotation.length > 0
          ? `${posture.noRotation.length} secret(s) have no rotation configured: ${posture.noRotation
              .map((secret) => secret.name)
              .join(", ")}. `
          : "") +
        (posture.overdue.length > 0
          ? `${posture.overdue.length} secret(s) are past their own rotation interval: ${posture.overdue
              .map((secret) => `${secret.name} (due ${secret.dueAt})`)
              .join(", ")}.`
          : ""),
      remedy:
        "Attach a rotation Lambda and a schedule to each secret named, or rotate it by hand and " +
        "record why it has none. A credential nobody replaces outlives every process meant to " +
        "catch it.",
      subjects: [
        ...posture.noRotation.map((secret) => secret.name),
        ...posture.overdue.map((secret) => secret.name),
      ],
    }
  }

  if (posture.undetermined.length > 0 || readings.pagination.kind !== "complete") {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${posture.secretsAssessed} secret(s) were assessed and none of them is unrotated` +
        (posture.undetermined.length > 0
          ? `, but the posture of ${posture.undetermined.join(", ")} could not be decided`
          : "") +
        (readings.pagination.kind === "truncated" || readings.pagination.kind === "unknown"
          ? `, and the listing did not complete: ${readings.pagination.why}`
          : "") +
        ".",
      remedy:
        "Grant this engine secretsmanager:DescribeSecret on the secrets named, or raise the " +
        "listing budget. A secret whose rotation nobody read is not a rotating secret.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${posture.secretsAssessed} secret(s) were assessed: every one has rotation configured and ` +
      `none is past its own interval.`,
    checked: posture.secretsAssessed,
    limits:
      posture.pendingDeletion.length > 0
        ? [
            `${posture.pendingDeletion.length} secret(s) are inside a deletion recovery window and ` +
              `are not a rotation finding: ${posture.pendingDeletion.map((secret) => secret.name).join(", ")}.`,
          ]
        : [],
  }
}

/** Security-group ingress from the whole internet, on anything beyond 80 and 443. */
export function foldNetworkIngress(readings: NetworkReadings): SecurityPostureItem {
  const base = {
    key: "network::internet-ingress",
    service: "ec2",
    question: "exposed",
    control: "Security group internet ingress",
    answers:
      "which security groups admit 0.0.0.0/0 or ::/0, on which protocol and port range, and what " +
      "that reaches",
  } as const

  const exposure = readings.exposure
  if (exposure.kind === "unknown") {
    return {
      ...base,
      state: "UNKNOWN",
      reason: exposure.why,
      ...refusalOf(readings.securityGroups, "ec2:DescribeSecurityGroups"),
    }
  }

  if (exposure.kind === "open") {
    return {
      ...base,
      state: "FAIL",
      severity: "CRITICAL",
      detail:
        `${exposure.findings.length} rule(s) across ${exposure.groupsRead} security group(s) admit ` +
        `the whole internet beyond the web ports: ` +
        exposure.findings.map((finding) => `${finding.groupId} — ${finding.reach}`).join(" · ") +
        (exposure.truncated ? ". The group listing was truncated, so this is a floor." : "."),
      remedy:
        "Replace 0.0.0.0/0 and ::/0 on each rule named with the CIDR that actually needs to reach " +
        "it, or put the workload behind a load balancer and admit only the load balancer's group.",
      subjects: exposure.findings.map((finding) => finding.groupId),
    }
  }

  if (exposure.truncated) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${exposure.groupsRead} security group(s) were read and none admits the internet beyond ` +
        `80 and 443, but the group listing was TRUNCATED — the groups past the bound were never ` +
        `read and cannot be reported as closed.`,
      remedy:
        "Raise this engine's ec2:DescribeSecurityGroups page budget, or read the remaining groups " +
        "in the EC2 console.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${exposure.groupsRead} security group(s) were read in full and none admits 0.0.0.0/0 or ` +
      `::/0 on anything beyond 80 and 443.`,
    checked: exposure.groupsRead,
    limits: [
      exposure.webFacingGroupIds.length > 0
        ? `${exposure.webFacingGroupIds.length} group(s) DO admit the whole internet on 80/443 and ` +
          `are treated as expected rather than as a finding: ${exposure.webFacingGroupIds.join(", ")}.`
        : "no group admits the internet at all, on any port.",
      "a security group is not the only path in: network ACLs, and any resource with a public IP " +
        "in a subnet routed to an internet gateway, are separate questions this item does not answer.",
    ],
  }
}

/** WAF: is anything in front of the resources that take requests from the internet. */
export function foldWaf(readings: WafReadings): SecurityPostureItem {
  const base = {
    key: "waf::web-acls",
    service: "wafv2",
    question: "exposed",
    control: "WAF web ACL association",
    answers:
      "which load balancers and distributions have a web ACL attached, and whether any rule on it " +
      "actually blocks rather than counts",
  } as const

  const coverage = readings.coverage
  switch (coverage.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: coverage.why,
        ...refusalOf(readings.regional, "wafv2:ListWebACLs"),
      }
    case "no-web-acl-exists":
      if (coverage.exposed.length > 0) {
        return {
          ...base,
          state: "FAIL",
          severity: "HIGH",
          detail:
            `no web ACL exists in either scope (${coverage.scopesRead.join(", ")}), and ` +
            `${coverage.exposed.length} internet-facing resource(s) are taking requests with ` +
            `nothing in front of them: ${coverage.exposed.map((resource) => resource.name).join(", ")}.`,
          remedy: coverage.remedy,
          subjects: coverage.exposed.map((resource) => resource.arn),
        }
      }
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          `no web ACL exists in either scope (${coverage.scopesRead.join(", ")}), so nothing is ` +
          `inspecting requests to this estate.`,
        remedy: coverage.remedy,
      }
    case "exposed":
      return {
        ...base,
        state: "FAIL",
        severity: "HIGH",
        detail:
          `${coverage.exposed.length} internet-facing resource(s) have no web ACL attached while ` +
          `${coverage.protectedCount} do: ${coverage.exposed.map((resource) => resource.name).join(", ")}.`,
        remedy: coverage.remedy,
        subjects: coverage.exposed.map((resource) => resource.arn),
      }
    case "monitoring-only":
      return {
        ...base,
        state: "FAIL",
        severity: "MEDIUM",
        detail: coverage.why,
        remedy:
          "Change the web ACL's rules from Count to Block, or change its default action. An ACL " +
          "that matches and records stops nothing.",
        subjects: coverage.resources,
      }
    case "no-targets":
      return {
        ...base,
        state: "PASS",
        basis: coverage.why,
        checked: 0,
        limits: [
          "this is a pass because there is nothing a web ACL could attach to, not because " +
            "anything was inspected. A resource this console cannot enumerate is not covered by it.",
        ],
      }
    case "protected": {
      if (
        coverage.detailUnread.length > 0 ||
        coverage.unreadable.length > 0 ||
        coverage.blockingConfirmed < coverage.protectedCount
      ) {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `${coverage.protectedCount} internet-facing resource(s) have a web ACL attached and ` +
            `only ${coverage.blockingConfirmed} of them were confirmed to carry a rule that BLOCKS` +
            (coverage.detailUnread.length > 0
              ? `; the ACL rules could not be described for ${coverage.detailUnread.join(", ")}`
              : "") +
            (coverage.unreadable.length > 0
              ? `; the association could not be read for ${coverage.unreadable.join(", ")}`
              : "") +
            ".",
          remedy:
            "Grant this engine the read that describes a web ACL's rules, or open WAF and confirm " +
            "each attached ACL blocks rather than counts. An attached ACL is not a blocking one.",
        }
      }
      return {
        ...base,
        state: "PASS",
        basis:
          `${coverage.protectedCount} internet-facing resource(s) each have a web ACL attached, ` +
          `and all ${coverage.blockingConfirmed} were read and carry at least one blocking rule.`,
        checked: coverage.protectedCount,
        limits: [],
      }
    }
  }
}

/** ECR: whether image scanning is switched on at all. Separate from what it found. */
export function foldEcrScanning(readings: EcrReadings): SecurityPostureItem {
  const base = {
    key: "ecr::scan-on-push",
    service: "ecr",
    question: "unwatched",
    control: "ECR image scanning",
    answers: "which repositories scan an image when it is pushed, and which do not scan at all",
  } as const

  const risk = readings.deployedRisk
  switch (risk.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: risk.why,
        ...refusalOf(readings.repositories, "ecr:DescribeRepositories"),
      }
    case "no-repositories":
      return {
        ...base,
        state: "PASS",
        basis:
          "ecr:DescribeRepositories answered and this registry holds no repository, so there is no " +
          "image that could go unscanned.",
        checked: 0,
        limits: [readings.enhancedScanning.why],
      }
    case "vulnerable":
    case "unverified": {
      if (risk.unscanned.length > 0) {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `${risk.unscanned.length} repository(ies) do not scan on push: ${risk.unscanned.join(", ")}. ` +
            `Every image in them returns no finding whether or not it carries a CVE.`,
          remedy:
            "Set scanOnPush on each repository named — `image_scanning_configuration` in " +
            "infrastructure/terraform/, or ecr:PutImageScanningConfiguration.",
        }
      }
      if (risk.unreadable.length > 0) {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `every repository that answered scans on push, and ${risk.unreadable.length} could not ` +
            `be read: ${risk.unreadable.join(", ")}.`,
          remedy:
            "Grant this engine ecr:DescribeRepositories and ecr:DescribeImages on the repositories " +
            "named, or read them in the ECR console.",
        }
      }
      return {
        ...base,
        state: "PASS",
        basis: "every repository that answered scans an image on push.",
        checked: risk.kind === "unverified" ? risk.imagesConsidered : risk.images.length,
        limits: [readings.enhancedScanning.why],
      }
    }
    case "clear":
      return {
        ...base,
        state: "PASS",
        basis:
          `all ${risk.repositoriesScanned} repository(ies) scan on push and ` +
          `${risk.imagesScanned} image(s) completed a scan.`,
        checked: risk.repositoriesScanned,
        limits: [readings.enhancedScanning.why],
      }
  }
}

/** ECR: what the scans that DID run found. */
export function foldEcrFindings(readings: EcrReadings): SecurityPostureItem {
  const base = {
    key: "ecr::image-findings",
    service: "ecr",
    question: "exposed",
    control: "ECR image vulnerabilities",
    answers: "which images carry known CVEs, at what severity, and in which repository",
  } as const

  const risk = readings.deployedRisk
  switch (risk.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: risk.why,
        ...refusalOf(readings.repositories, "ecr:DescribeImageScanFindings"),
      }
    case "no-repositories":
      return {
        ...base,
        state: "PASS",
        basis: "this registry holds no repository, so there is no image to carry a finding.",
        checked: 0,
        limits: [readings.enhancedScanning.why],
      }
    case "vulnerable":
      return {
        ...base,
        state: "FAIL",
        severity: risk.critical > 0 ? "CRITICAL" : risk.high > 0 ? "HIGH" : "MEDIUM",
        detail:
          `${risk.images.length} image(s) carry findings — ${risk.critical} CRITICAL and ` +
          `${risk.high} HIGH — in ${risk.images.map((image) => image.repositoryName).join(", ")}.`,
        remedy:
          "Rebuild each image named on a patched base and redeploy it. A finding on an image that " +
          "is still the deployed tag is a finding in production.",
        subjects: risk.images.map((image) => `${image.repositoryName}@${image.digest}`),
      }
    case "unverified":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason: risk.why,
        remedy:
          "Set scanOnPush on every repository, grant this engine ecr:DescribeImageScanFindings, " +
          "and re-push the images whose scan never completed. A zero from an unscanned image is " +
          "not evidence of anything.",
      }
    case "clear":
      return {
        ...base,
        state: "PASS",
        basis:
          `${risk.imagesScanned} image(s) across ${risk.repositoriesScanned} repository(ies) each ` +
          `completed a scan and every one came back with no finding.`,
        checked: risk.imagesScanned,
        limits: [readings.enhancedScanning.why],
      }
  }
}

/** AWS Config rule verdicts. A rule at INSUFFICIENT_DATA has evaluated nothing. */
export function foldCompliance(readings: ComplianceReadings): SecurityPostureItem {
  const base = {
    key: "config::rule-compliance",
    service: "config",
    question: "unencrypted",
    control: "Config rule verdicts",
    answers:
      "each configuration rule's own verdict, including the encryption-at-rest rules — and which " +
      "rules have evaluated nothing at all",
  } as const

  const health = readings.health
  switch (health.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: health.why,
        ...refusalOf(readings.rules, "config:DescribeConfigRules"),
      }
    case "no-verdicts":
      return {
        ...base,
        state: "UNKNOWN",
        reason: `${health.why} Unreadable: ${health.unreadable.join(", ")}.`,
        action: "config:DescribeComplianceByConfigRule",
        minimumStatement: minimumStatementText("config:DescribeComplianceByConfigRule"),
      }
    case "no-rules":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason: health.why,
        remedy:
          "Turn on the Config recorder and deploy the conformance pack this estate is held to " +
          "(config:PutConfigurationRecorder, config:PutConfigRule). A recorder with no rules " +
          "checks nothing.",
      }
    case "non-compliant":
      return {
        ...base,
        state: "FAIL",
        severity: "HIGH",
        detail:
          `${health.failing.length} rule(s) are NON_COMPLIANT: ` +
          health.failing.map((rule) => `${rule.name} — ${rule.detail}`).join(" · ") +
          (health.notEvaluated.length > 0
            ? `. ${health.notEvaluated.length} further rule(s) have evaluated nothing.`
            : "."),
        remedy:
          "Open AWS Config and remediate each non-compliant resource the rule names. A rule that " +
          "is failing is a control that ran and found something.",
        subjects: health.failing.map((rule) => rule.name),
      }
    case "nothing-evaluated":
    case "partly-evaluated":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          `${health.why} Rules that have evaluated nothing: ${health.notEvaluated.join(", ")}.` +
          (health.unreadable.length > 0
            ? ` Verdicts unreadable on: ${health.unreadable.join(", ")}.`
            : "") +
          ` ${readings.enablement.recorder.why}`,
        remedy:
          "Confirm the configuration recorder is running and records the resource types those " +
          "rules watch. A rule at INSUFFICIENT_DATA reports no non-compliant resource and reads " +
          "exactly like a rule that passed.",
      }
    case "compliant": {
      if (health.unreadable.length > 0 || readings.truncation.kind !== "complete") {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `${health.passing.length} rule(s) passed` +
            (health.unreadable.length > 0
              ? `, and the verdict could not be read on ${health.unreadable.join(", ")}`
              : "") +
            (readings.truncation.kind === "more-available"
              ? `, and the rule listing stopped early: ${readings.truncation.reason}`
              : "") +
            ".",
          remedy:
            "Grant this engine config:DescribeComplianceByConfigRule on the rules named, or raise " +
            "the rule-listing budget.",
        }
      }
      return {
        ...base,
        state: "PASS",
        basis:
          `${health.passing.length} rule(s) passed and ${health.notApplicable.length} were ` +
          `correctly not applicable; every rule in the listing returned a verdict.`,
        checked: health.passing.length + health.notApplicable.length,
        limits: [readings.enablement.recorder.why],
      }
    }
  }
}

/** CloudTrail: is a trail LOGGING right now, and is it delivering. */
export function foldTrail(readings: TrailReadings): SecurityPostureItem {
  const base = {
    key: "cloudtrail::logging",
    service: "cloudtrail",
    question: "unwatched",
    control: "CloudTrail delivery",
    answers:
      "whether a trail is logging at this moment and whether its last delivery succeeded — a trail " +
      "created correctly and then stopped describes identically to one that is delivering",
  } as const

  const delivery = readings.delivery
  switch (delivery.kind) {
    case "unknown":
      return {
        ...base,
        state: "UNKNOWN",
        reason: delivery.why,
        ...refusalOf(readings.trails, "cloudtrail:DescribeTrails"),
      }
    case "no-status":
      return {
        ...base,
        state: "UNKNOWN",
        reason: `${delivery.why} Unreadable: ${delivery.unreadable.join(", ")}.`,
        action: "cloudtrail:GetTrailStatus",
        minimumStatement: minimumStatementText("cloudtrail:GetTrailStatus"),
      }
    case "no-trails":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          "cloudtrail:DescribeTrails answered and there is no trail in this account. No API call " +
          "made against it is being recorded anywhere.",
        remedy:
          "Create a multi-region organization trail with log-file validation enabled, delivering " +
          "to a bucket in a separate account.",
      }
    case "not-logging":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          `${delivery.stopped.length} trail(s) exist and are STOPPED: ${delivery.stopped.join(", ")}. ` +
          `A stopped trail records nothing while describing exactly like a running one.` +
          (delivery.unreadable.length > 0
            ? ` Status was unreadable on ${delivery.unreadable.join(", ")}.`
            : ""),
        remedy: "Start each trail named — cloudtrail:StartLogging — and find out why it stopped.",
      }
    case "delivery-failing":
      return {
        ...base,
        state: "FAIL",
        severity: "HIGH",
        detail:
          `${delivery.failures.length} trail(s) are logging and their last delivery FAILED: ` +
          delivery.failures
            .map((failure) => `${failure.name} — ${failure.error}`)
            .join(" · ") +
          ". Events are being captured and lost.",
        remedy:
          "Fix the destination bucket policy or the KMS key policy the error names. A trail that " +
          "cannot deliver is a trail whose records do not exist.",
        subjects: delivery.failures.map((failure) => failure.name),
      }
    case "delivery-overdue":
      return {
        ...base,
        state: "NOT_CHECKED",
        reason:
          `${delivery.overdue.length} trail(s) report logging with no delivery inside the ` +
          `threshold: ` +
          delivery.overdue
            .map(
              (entry) =>
                `${entry.name} — last delivered ${entry.lastDeliveryAt ?? "never, as far as AWS reports"}`,
            )
            .join(" · ") +
          ". This engine cannot confirm events are reaching the bucket.",
        remedy:
          "Open CloudTrail and confirm the last delivery time against the destination bucket. An " +
          "overdue delivery is not proof of failure and is not proof of success either.",
      }
    case "logging": {
      if (delivery.unreadable.length > 0) {
        return {
          ...base,
          state: "NOT_CHECKED",
          reason:
            `${delivery.trails.length} trail(s) are logging and delivering, and the status of ` +
            `${delivery.unreadable.join(", ")} could not be read.`,
          remedy:
            "Grant this engine cloudtrail:GetTrailStatus on the trails named. A trail whose status " +
            "nobody read is not a logging trail.",
        }
      }
      return {
        ...base,
        state: "PASS",
        basis:
          `${delivery.trails.length} trail(s) — ${delivery.trails.join(", ")} — each report ` +
          `IsLogging with a recent successful delivery and no delivery error.`,
        checked: delivery.trails.length,
        limits: [],
      }
    }
  }
}

/** Cognito: is a second factor REQUIRED on the pools that let people in. */
export function foldCognitoMfa(readings: CognitoReadings): SecurityPostureItem {
  const base = {
    key: "cognito::mfa",
    service: "cognito",
    question: "exposed",
    control: "Cognito user pool MFA",
    answers:
      "whether each user pool REQUIRES a second factor, which factors it accepts, and which call " +
      "said so — a second factor nobody enrolled is the same protection as none",
  } as const

  if (readings.pools.state !== "ACTUAL" && readings.pools.state !== "STALE") {
    return {
      ...base,
      state: "UNKNOWN",
      reason: `the user pool listing came back ${readings.pools.state}, so no pool was read.`,
      ...refusalOf(readings.pools, "cognito-idp:ListUserPools"),
    }
  }

  const notEnforced: string[] = []
  const unknownPools: string[] = []
  const sentences: string[] = []
  for (const finding of readings.findings) {
    if (finding.kind === "mfa-not-enforced") {
      notEnforced.push(finding.poolId)
      sentences.push(finding.text)
    } else if (finding.kind === "mfa-unknown") {
      unknownPools.push(finding.poolId)
      sentences.push(finding.text)
    } else if (finding.kind === "pools-unknown") {
      sentences.push(finding.text)
    }
  }

  if (notEnforced.length > 0) {
    return {
      ...base,
      state: "FAIL",
      severity: "CRITICAL",
      detail: sentences.join(" "),
      remedy:
        "Set the pool's MFA configuration to ON rather than OPTIONAL, and enrol every operator. " +
        "An OPTIONAL setting protects only the accounts that chose to be protected.",
      subjects: notEnforced,
    }
  }

  if (unknownPools.length > 0) {
    return {
      ...base,
      state: "UNKNOWN",
      reason: sentences.join(" "),
      action: "cognito-idp:GetUserPoolMfaConfig",
      minimumStatement: minimumStatementText("cognito-idp:GetUserPoolMfaConfig"),
    }
  }

  const inventory = readings.pools.value
  if (inventory.completeness.kind !== "complete") {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason:
        `${inventory.pools.length} user pool(s) were read and every one requires a second factor, ` +
        `but the pool listing was TRUNCATED: ${inventory.completeness.why}`,
      remedy:
        "Raise this engine's cognito-idp:ListUserPools page budget, or read the remaining pools in " +
        "the Cognito console.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${inventory.pools.length} user pool(s) were read (${inventory.scope}) and every one of them ` +
      `requires a second factor.`,
    checked: inventory.pools.length,
    limits: [
      "MFA being REQUIRED on the pool is not the same as every operator having enrolled a factor; " +
        "enrolment is reported per operator by the Cognito surface, not by this item.",
    ],
  }
}

/**
 * The IAM policy wildcard sweep.
 *
 * Keyed `iam::wildcards` deliberately: `app/platform/security/posture.ts`
 * already emits a row under that key from `controlsFromIam`, and
 * `controlsFor()` merges by key. Sharing the key makes the two idempotent
 * rather than producing two rows about one sweep.
 */
export function foldIamWildcards(surface: IamPostureSurface): SecurityPostureItem {
  const base = {
    key: "iam::wildcards",
    service: "iam",
    question: "exposed",
    control: "IAM policy wildcard sweep",
    answers:
      'which principals hold Action "*", Resource "*", a service-wide grant, a NotAction, or a ' +
      "trust policy any principal can assume",
  } as const

  if (surface.read.state === "EMPTY") {
    return {
      ...base,
      state: "PASS",
      basis:
        "iam:GetAccountAuthorizationDetails answered and this account reported no role and no " +
        "user, so there is no policy document to sweep.",
      checked: 0,
      limits: [],
    }
  }

  const posture = surface.posture
  if (posture === null) {
    return {
      ...base,
      state: "UNKNOWN",
      reason: `iam:GetAccountAuthorizationDetails came back ${surface.read.state}, so no policy was swept.`,
      ...refusalOf(surface.read, "iam:GetAccountAuthorizationDetails"),
    }
  }

  if (posture.wildcards.length > 0) {
    const worst = posture.wildcards.some(
      (wildcard) => wildcard.kind === "ADMIN" || wildcard.kind === "ANY_PRINCIPAL",
    )
    return {
      ...base,
      state: "FAIL",
      severity: worst ? "CRITICAL" : "HIGH",
      detail:
        `${posture.wildcards.length} wildcard statement(s) across ` +
        `${new Set(posture.wildcards.map((wildcard) => wildcard.principalArn)).size} principal(s): ` +
        posture.wildcards
          .map((wildcard) => `${wildcard.principalName}/${wildcard.policyName} — ${wildcard.kind}`)
          .join(" · ") +
        (posture.sweepCoverage.complete ? "." : `. ${posture.sweepCoverage.detail}`),
      remedy:
        "Replace each statement named with the actions that principal actually calls, on the ARNs " +
        "it actually touches. A Condition narrows a wildcard; it does not remove it.",
      subjects: posture.wildcards.map((wildcard) => wildcard.principalArn),
    }
  }

  if (!posture.sweepCoverage.complete) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason: `no wildcard was found, and the sweep did not cover the account: ${posture.sweepCoverage.detail}`,
      remedy:
        "Read the unswept policies by name in the IAM console, or replace the AWS-managed " +
        "policies they refer to with customer-managed copies whose documents this read returns. " +
        "Until then the wildcard count is a floor.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis: `${posture.sweepCoverage.policiesSwept} policy document(s) were swept in full and none carries a wildcard.`,
    checked: posture.sweepCoverage.policiesSwept,
    limits: [],
  }
}

/** Long-lived IAM access keys. Keyed to merge with the page's own `iam::key-age` row. */
export function foldIamKeyAge(surface: IamPostureSurface): SecurityPostureItem {
  const base = {
    key: "iam::key-age",
    service: "iam",
    question: "unrotated",
    control: "IAM access key age",
    answers:
      "which IAM users hold an ACTIVE access key older than this console's threshold, by key id " +
      "and by age",
  } as const

  if (surface.read.state === "EMPTY") {
    return {
      ...base,
      state: "PASS",
      basis:
        "iam:GetAccountAuthorizationDetails answered and this account reported no user, so there " +
        "is no user who could hold an access key.",
      checked: 0,
      limits: [],
    }
  }

  const posture = surface.posture
  if (posture === null) {
    return {
      ...base,
      state: "UNKNOWN",
      reason: `iam:GetAccountAuthorizationDetails came back ${surface.read.state}, so no key was aged.`,
      ...refusalOf(surface.read, "iam:ListAccessKeys"),
    }
  }

  if (posture.longLivedKeys.length > 0) {
    const oldest = posture.longLivedKeys.reduce(
      (max, key) => Math.max(max, key.ageDays ?? 0),
      0,
    )
    return {
      ...base,
      state: "FAIL",
      severity: oldest >= 365 ? "HIGH" : "MEDIUM",
      detail:
        `${posture.longLivedKeys.length} ACTIVE long-lived key(s), the oldest ${oldest} day(s) ` +
        `old: ` +
        posture.longLivedKeys
          .map((key) => `${key.userName}/${key.accessKeyId}`)
          .join(", ") +
        (posture.keyCoverage.complete ? "." : `. ${posture.keyCoverage.detail}`),
      remedy:
        "Create a replacement key, move every caller onto it, set the old key Inactive with " +
        "iam:UpdateAccessKey and delete it once nothing has broken.",
      subjects: posture.longLivedKeys.map((key) => key.accessKeyId),
    }
  }

  if (!posture.keyCoverage.complete) {
    return {
      ...base,
      state: "NOT_CHECKED",
      reason: `no long-lived key was found, and not every user answered: ${posture.keyCoverage.detail}`,
      remedy:
        "Grant this engine iam:ListAccessKeys on the users that refused, named above. Until then " +
        "the long-lived key count is a floor and not a total.",
    }
  }

  return {
    ...base,
    state: "PASS",
    basis:
      `${posture.keyCoverage.usersAnswered} user(s) answered and none holds an ACTIVE key past ` +
      `this console's threshold; ${posture.accessKeys.length} key(s) were seen in total.`,
    checked: posture.keyCoverage.usersAnswered,
    limits: [],
  }
}

/* --------------------------------------------------- the whole aggregate -- */

/**
 * Every reading the security posture is folded from.
 *
 * Twelve required fields and no optional ones — see the section header. A caller
 * that loads eleven does not compile.
 */
export interface SecurityPostureInput {
  guardduty: GuardDutyReadings
  analyzer: AnalyzerReadings
  buckets: S3Readings
  keys: KmsReadings
  secrets: SecretsReadings
  network: NetworkReadings
  waf: WafReadings
  ecr: EcrReadings
  compliance: ComplianceReadings
  trail: TrailReadings
  cognito: CognitoReadings
  iam: IamPostureSurface
}

export interface SecurityPosture {
  /** Every item, worst first: FAIL, then NOT_CHECKED, then UNKNOWN, then PASS. */
  items: readonly SecurityPostureItem[]
  score: PostureScore
  /** The newest `asOf` across the twelve readings. Never a clock this module read. */
  asOf: string
}

const STATE_ORDER: Readonly<Record<PostureState, number>> = {
  FAIL: 0,
  NOT_CHECKED: 1,
  UNKNOWN: 2,
  PASS: 3,
}

/**
 * Worst first, then by severity within the failures, then by key.
 *
 * The final tiebreak compares with `<` and `>` rather than `localeCompare`,
 * which is locale-dependent and would order two items differently on two
 * machines — the checkout-dependent-artefact shape of defect, one level down.
 */
export function rankPostureItems(
  items: readonly SecurityPostureItem[],
): readonly SecurityPostureItem[] {
  return items.slice().sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (byState !== 0) return byState
    if (a.state === "FAIL" && b.state === "FAIL") {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (bySeverity !== 0) return bySeverity
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/**
 * Fold twelve readings into one posture. Pure — nothing here calls AWS.
 *
 * Sixteen items from twelve services, because three of them answer more than one
 * question: S3 is asked separately about public access, encryption and
 * versioning; ECR separately about whether scanning is ON and about what the
 * scans found; IAM separately about wildcards and about key age. Folding those
 * into one row each would let a bucket that encrypts but is public read as half
 * a pass, and there is no half in this model.
 */
export function securityPostureFrom(input: SecurityPostureInput): SecurityPosture {
  const items = rankPostureItems([
    foldGuardDuty(input.guardduty),
    foldAnalyzer(input.analyzer),
    foldBucketPublicAccess(input.buckets),
    foldBucketEncryption(input.buckets),
    foldBucketVersioning(input.buckets),
    foldKeyRotation(input.keys),
    foldSecretRotation(input.secrets),
    foldNetworkIngress(input.network),
    foldWaf(input.waf),
    foldEcrScanning(input.ecr),
    foldEcrFindings(input.ecr),
    foldCompliance(input.compliance),
    foldTrail(input.trail),
    foldCognitoMfa(input.cognito),
    foldIamWildcards(input.iam),
    foldIamKeyAge(input.iam),
  ])

  // The newest reading's own stamp, never `new Date()`: this object is as
  // current as the freshest thing in it and no fresher, and a clock read here
  // would make every render a different representation of the same facts.
  const asOf = [
    input.guardduty.asOf,
    input.analyzer.asOf,
    input.buckets.asOf,
    input.keys.asOf,
    input.secrets.asOf,
    input.network.asOf,
    input.waf.asOf,
    input.ecr.asOf,
    input.compliance.asOf,
    input.trail.asOf,
    input.cognito.asOf,
    input.iam.asOf,
  ].reduce((newest, stamp) => (stamp > newest ? stamp : newest))

  return { items, score: scorePosture(items), asOf }
}

/**
 * Read every security-relevant service and fold the result.
 *
 * Called with no arguments in production; the tests pass a stand-in gateway.
 * Same function, and the twelve readers below are the same ones each service
 * surface calls — there is no second path to the SDK and nothing here builds a
 * client of its own.
 *
 * The twelve run concurrently and each degrades on its own: a refused
 * `kms:ListKeys` produces one UNKNOWN item and leaves the other fifteen intact.
 * `Promise.all` is safe here because every reader resolves — `readAws` turns
 * every throw into an arm of `AwsRead` — so one service being unreachable cannot
 * reject the whole aggregate.
 */
export async function securityPosture(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<SecurityPosture> {
  const now = options.now ?? (() => new Date())
  const opts = { now }

  const [
    guardduty,
    analyzer,
    buckets,
    keys,
    secrets,
    network,
    waf,
    ecr,
    compliance,
    trail,
    cognito,
    iam,
  ] = await Promise.all([
    guardDutyReadings(supplied, opts),
    analyzerReadings(supplied, opts),
    bucketPosture(supplied, opts),
    keyReadings(supplied, opts),
    secretReadings(supplied, opts),
    networkReadings(supplied, opts),
    wafReadings(supplied, opts),
    ecrReadings(supplied, opts),
    complianceReadings(supplied, opts),
    trailReadings(supplied, opts),
    cognitoReadings(supplied, opts),
    iamPosture(supplied, opts),
  ])

  return securityPostureFrom({
    guardduty,
    analyzer,
    buckets,
    keys,
    secrets,
    network,
    waf,
    ecr,
    compliance,
    trail,
    cognito,
    iam,
  })
}

/* ------------------------------------------------------ the render seam -- */

/**
 * The row shape `/platform/security` renders.
 *
 * Declared here rather than imported from `app/platform/security/posture.ts`,
 * deliberately: a library module importing a route's type would invert the
 * dependency, and the page's `ControlRow` is the contract this must satisfy
 * rather than the type this must be. It is structurally identical, so
 * `controlRowsFor(...)` is assignable to `readonly ControlRow[]` at the page's
 * call site and `tsc` there is what proves the two have not drifted.
 */
export interface SecurityControlRow {
  key: string
  question: PostureQuestion
  control: string
  /** The three arms of the page's `ControlState` this module can produce. */
  state: "CHECKING" | "NOT_CHECKING" | "UNREADABLE"
  answers: string
  detail: string
  remedy: string
  action?: string
  minimumStatement?: string
}

/**
 * Posture items as control-coverage rows.
 *
 * The mapping is the point and it is one-way: a FAIL becomes `CHECKING`,
 * because the page's `ControlState` is about whether the control RAN and a
 * failure is a control that ran and found something. What it found belongs on
 * the exposure list, which is a different table. `NOT_CHECKED` becomes
 * `NOT_CHECKING` — a fact about the estate — and `UNKNOWN` becomes
 * `UNREADABLE` — a fact about this console's grants. Collapsing those last two
 * is the one thing this whole module exists to prevent, so they map to the two
 * words the page already keeps apart.
 */
export function controlRowsFor(
  items: readonly SecurityPostureItem[],
): readonly SecurityControlRow[] {
  return items.map((item): SecurityControlRow => {
    const base = {
      key: item.key,
      question: item.question,
      control: item.control,
      answers: item.answers,
    }
    switch (item.state) {
      case "PASS":
        return {
          ...base,
          state: "CHECKING",
          detail:
            `${item.basis} ${item.checked} thing(s) were checked.` +
            (item.limits.length > 0 ? ` Not covered by this pass: ${item.limits.join(" ")}` : ""),
          remedy:
            "Nothing to do for coverage. Anything this control found, if it found anything, is on " +
            "the ranked list.",
        }
      case "FAIL":
        return {
          ...base,
          state: "CHECKING",
          detail: `${item.severity} — ${item.detail}`,
          remedy: item.remedy,
        }
      case "NOT_CHECKED":
        return { ...base, state: "NOT_CHECKING", detail: item.reason, remedy: item.remedy }
      case "UNKNOWN":
        return {
          ...base,
          state: "UNREADABLE",
          detail: item.reason,
          remedy:
            "Grant the statement below to this engine's task role. Until it is granted nothing is " +
            "known here, and this is not a report that there is nothing.",
          action: item.action,
          minimumStatement: item.minimumStatement,
        }
    }
  })
}
