/**
 * STUDIO-070-004 (ANALYZER) — IAM Access Analyzer, and the one question this
 * console could not previously ask at all: *is anything in this estate shared
 * outside the account?*
 *
 * `infrastructure/terraform` provisions S3 buckets, KMS keys, IAM roles, SQS
 * queues, Secrets Manager secrets and ECR repositories. Every one of those is a
 * resource type IAM Access Analyzer evaluates, which makes it the single read
 * that answers "external access" across the whole estate at once rather than
 * six separate policy reads that each answer a sixth of it. Nothing in the
 * running product had ever issued an `access-analyzer:*` call, so the service was
 * dark: Terraform could create an analyzer and the console could not see it, and
 * an account with no analyzer at all looked exactly the same as one with no
 * exposure.
 *
 * ## "No analyzer" and "no external access" are opposite claims
 *
 * This is the whole reason the module exists, and it is the one place a plain
 * `AwsRead<T>` is not enough on its own.
 *
 * `access-analyzer:ListAnalyzers` returning nothing is a legitimate, successful,
 * EMPTY read — the API answered and there are genuinely no analyzers. But the
 * QUESTION an operator is asking is not "how many analyzers are there", it is "is
 * anything shared outside this account", and for THAT question an account with no
 * analyzer has produced no evidence whatsoever. Rendering the EMPTY analyzer list
 * as "no external-access findings" would be the `AwsRead` failure mode wearing a
 * disguise: a technically-correct empty list read as a reassuring answer to a
 * different question.
 *
 * So the listing keeps its honest EMPTY, and `ExternalAccessState` — the thing a
 * surface actually renders — turns that EMPTY into `no-analyzer`, whose sentence
 * says "unknown" and carries the remedy. There is no path in this file from an
 * empty analyzer list to any arm that claims an absence of exposure.
 *
 * The same applies one level in: an account whose only analyzer is an
 * `ACCOUNT_UNUSED_ACCESS` analyzer, or whose analyzer is `CREATING` or `FAILED`,
 * has no external-access evidence either. Those become `not-answering`, again
 * with the remedy, and again never "none found".
 *
 * ## Two capabilities, two readings, degrading independently
 *
 * `access-analyzer:ListAnalyzers` and `access-analyzer:ListFindingsV2` are
 * separate IAM actions on different resources — the first is `*`, the second is
 * `arn:*:access-analyzer:*:*:analyzer/*` — and a role is routinely granted one
 * without the other. Folding the findings read into the listing would make a
 * refused `ListFindingsV2` render as "refused access-analyzer:ListAnalyzers", so
 * the minimum statement an operator pastes would not contain the action that is
 * actually missing: they would grant it, redeploy, and be refused identically.
 *
 * So the listing is one `AwsRead`, and EVERY analyzer carries its own `AwsRead`
 * for its findings. An analyzer whose findings were refused still appears, saying
 * it was refused, and the account-level verdict names it as unread rather than
 * counting it as clear. One denied detail does not collapse the row, and it does
 * not render as a reassuring default either.
 *
 * ## What this module honestly cannot read, said out loud
 *
 * **The external principal and the exposed action are NOT available to this
 * engine.** They are not fields of `FindingSummaryV2`, which is what
 * `ListFindingsV2` returns — that shape carries the finding id, the resource, the
 * resource type, the owning account, the finding type, the status and four
 * timestamps, and nothing else. The principal and the action live on
 * `GetFindingV2`, whose capability key `access-analyzer:GetFindingV2` is not in
 * `capabilities.ts`, and this module does not get to add one.
 *
 * So every exposure carries an `externalPrincipal` and an `exposedAction` whose
 * only arm is NOT_READABLE and which names the capability that would answer it.
 * A field silently holding `null`, or left off the type, would let a surface print
 * an exposure row with a blank principal and let an operator read that as "shared
 * with nobody in particular" — which is the exact shape of lie the read plane
 * exists to prevent. See the ledger entry for the registry line that would close
 * it.
 *
 * ## Region and partition
 *
 * Both come from the resolved identity — `sts:GetCallerIdentity` for the account
 * and partition, the SDK's own resolved region for the region — and from the ARNs
 * AWS returns on each analyzer and each exposed resource. There is no literal
 * region in this file and no `"aws"` partition fallback. GE-010-007 was a
 * data-residency defect caused by exactly that fallback.
 *
 * ## Bounds, and the signal when one is hit
 *
 * A reader that silently returns the first page is the same lie as an empty list.
 * A reader with no bound is how one page render becomes an outage. Both loops are
 * capped, and hitting a cap sets `truncated` with a sentence naming what was cut —
 * the result is never rendered as if it were the whole estate. Unlike
 * `sqs.ts`, which throws at its cap, truncation here is a VALUE: a thousand
 * findings that were read are worth showing, and throwing them away to report
 * "there were more" would be the second-worst answer on the page.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so an exposed bucket
 * attributes the same way an RDS instance does. `tags.ts` keeps `shared`
 * (somebody decided) and `unattributed` (nobody tagged it) apart. This module
 * adds a FOURTH answer, `unknown`, for when the tag index itself could not be
 * read: "we could not look up this resource's tags" is not "this resource has no
 * tenant tag".
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many `ListAnalyzers` pages to walk. `client.ts` asks for 100 per page, so
 * this is a thousand analyzers before the cap. AWS's own account limit is far
 * below that; the bound exists because a loop with no bound is an outage, not
 * because a thousand analyzers is expected.
 */
export const MAX_ANALYZER_PAGES = 10

/**
 * How many `ListFindingsV2` pages to walk PER ANALYZER. 100 per page, so two
 * thousand findings each. An estate with more external-access findings than that
 * has a problem the first two thousand already describe.
 */
export const MAX_FINDING_PAGES = 20

/**
 * How many analyzers get a findings read in one load.
 *
 * `ListFindingsV2` is at least one call per analyzer and Access Analyzer throttles
 * per account. Analyzers past the cap are NOT dropped and do not render as clear:
 * they carry an UNCONFIGURED findings read whose `why` says the engine stopped,
 * and the account verdict names them as unread.
 */
export const MAX_ANALYZERS_QUERIED = 20

/** How many findings reads are in flight at once. Bounded so one load is not a burst. */
const FINDINGS_CONCURRENCY = 4

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListAnalyzersResponse {
  analyzers?: Array<{
    arn?: string
    name?: string
    type?: string
    status?: string
    statusReason?: { code?: string }
    createdAt?: unknown
    lastResourceAnalyzed?: string
    lastResourceAnalyzedAt?: unknown
    tags?: Record<string, string>
  }>
  nextToken?: string
}

interface ListFindingsV2Response {
  findings?: Array<{
    id?: string
    resource?: string
    resourceType?: string
    resourceOwnerAccount?: string
    status?: string
    findingType?: string
    error?: string
    createdAt?: unknown
    analyzedAt?: unknown
    updatedAt?: unknown
  }>
  nextToken?: string
}

/**
 * Which tenant an analyzer or an exposed resource belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * resource whose tags were never read must not render as "unattributable —
 * missing tenure:tenant", because that sends an operator to add a tag that is
 * probably already there.
 */
export type AnalyzerAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/**
 * The external principal a finding names.
 *
 * One arm, deliberately. See the module header: `ListFindingsV2` does not return
 * it, the fact lives on `GetFindingV2`, and that capability is not in the
 * registry. This type exists so the absence is a value a surface must render
 * rather than a field a surface can forget.
 */
export interface ExternalPrincipalReading {
  state: "NOT_READABLE"
  /** The capability that would answer it. Not held by this engine today. */
  needs: "access-analyzer:GetFindingV2"
  why: string
}

/** The action a finding exposes. Same shape, same reason, same missing capability. */
export interface ExposedActionReading {
  state: "NOT_READABLE"
  needs: "access-analyzer:GetFindingV2"
  why: string
}

/** The same object every time: nothing about it varies per finding. */
export const EXTERNAL_PRINCIPAL_NOT_READABLE: ExternalPrincipalReading = {
  state: "NOT_READABLE",
  needs: "access-analyzer:GetFindingV2",
  why:
    "the external principal is not a field of ListFindingsV2's FindingSummaryV2 — it is returned by " +
    "access-analyzer:GetFindingV2, which is not a capability this engine holds. Unknown, not nobody.",
}

export const EXPOSED_ACTION_NOT_READABLE: ExposedActionReading = {
  state: "NOT_READABLE",
  needs: "access-analyzer:GetFindingV2",
  why:
    "the exposed action is not a field of ListFindingsV2's FindingSummaryV2 — it is returned by " +
    "access-analyzer:GetFindingV2, which is not a capability this engine holds. Unknown, not none.",
}

/**
 * Whether an analyzer answers the external-access question at all.
 *
 * An `ACCOUNT_UNUSED_ACCESS` analyzer is a real, healthy, active analyzer that
 * produces no external-access finding no matter how much is shared, because that
 * is not the question it asks. Counting one as coverage is how an estate reads as
 * checked while nothing is checking.
 */
export type ExternalAccessRole =
  | { kind: "answers-external-access" }
  | { kind: "different-question"; analyzerType: string; why: string }
  | { kind: "not-active"; status: string; why: string }

/** One finding, as much of it as `ListFindingsV2` actually returns. */
export interface ExternalExposure {
  /** AWS's finding id. The handle for GetFindingV2, when this engine can call it. */
  findingId: string
  /** The exposed resource's ARN. Null on an Error finding, where AWS omits it. */
  resource: string | null
  /** `AWS::S3::Bucket`, `AWS::KMS::Key`, … — AWS's own CloudFormation-style name. */
  resourceType: string
  /** Which account owns the exposed resource. AWS's answer, never assumed to be ours. */
  resourceOwnerAccount: string | null
  /** ACTIVE, ARCHIVED or RESOLVED. Only ACTIVE is a live exposure. */
  status: string
  /** ExternalAccess, UnusedIAMRole, … Kept so a surface never mislabels one as the other. */
  findingType: string
  /** AWS's own error string on an Error finding — the analyzer could not evaluate it. */
  error: string | null
  createdAt: string | null
  analyzedAt: string | null
  updatedAt: string | null
  /** From the resource ARN where there is one, else from the resolved identity. */
  region: string | null
  partition: string | null
  attribution: AnalyzerAttribution
  /** Not readable with the capabilities this engine holds. See the module header. */
  externalPrincipal: ExternalPrincipalReading
  exposedAction: ExposedActionReading
  /** Which analyzer reported it. */
  analyzerArn: string
  asOf: string
}

/**
 * A page-bounded list of findings.
 *
 * `truncated` is the explicit "there were more" signal. A surface that ignores it
 * prints a partial estate as if it were the whole one, so the sentence is
 * pre-composed in `truncationNote` and `analyzerLines` prints it.
 */
export interface FindingListing {
  exposures: readonly ExternalExposure[]
  truncated: boolean
  pagesRead: number
  /** Null unless truncated. Names the cap and what it means. */
  truncationNote: string | null
}

export interface AnalyzerReading {
  arn: string
  name: string
  /** ACCOUNT, ORGANIZATION, ACCOUNT_UNUSED_ACCESS, … AWS's own string, not remapped. */
  type: string
  /** ACTIVE, CREATING, DISABLED or FAILED. */
  status: string
  /** Why it is not ACTIVE, when AWS says. Null is "AWS gave no reason", not "fine". */
  statusReason: string | null
  createdAt: string | null
  lastResourceAnalyzed: string | null
  lastResourceAnalyzedAt: string | null
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: AnalyzerAttribution
  /** Whether this analyzer answers "is anything shared outside the account". */
  role: ExternalAccessRole
  /** Refused, throttled, broken or read — per analyzer, with its own action named. */
  findings: AwsRead<FindingListing>
  /** This analyzer's findings cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/** A page-bounded list of analyzers, with the same explicit truncation signal. */
export interface AnalyzerListing {
  analyzers: readonly AnalyzerReading[]
  truncated: boolean
  pagesRead: number
  truncationNote: string | null
}

/**
 * The account's answer to "is anything shared outside this account".
 *
 * Every arm is careful about what it claims. In particular there is no arm that
 * says "nothing is shared" without also carrying which analyzers were read and
 * which could not be, so `none-found` can never quietly mean "clear as far as we
 * bothered to look".
 */
export type ExternalAccessState =
  /** The analyzer listing itself was not readable, so nothing can be said. */
  | { kind: "unknown"; why: string; remedy: string }
  /**
   * The listing succeeded and there are no analyzers. THE finding: this account
   * is not being checked. Never "no external access found".
   */
  | { kind: "no-analyzer"; why: string; remedy: string }
  /** Analyzers exist and not one of them asks the external-access question. */
  | { kind: "not-answering"; why: string; remedy: string; analyzersSeen: number }
  /** Every findings read on every external-access analyzer failed. */
  | {
      kind: "findings-unreadable"
      why: string
      remedy: string
      unreadable: readonly string[]
    }
  /** At least one analyzer answered, and no ACTIVE external-access finding came back. */
  | {
      kind: "none-found"
      analyzersRead: readonly string[]
      /** Analyzers whose findings could not be read. Named, so "none" is qualified. */
      unreadable: readonly string[]
      truncated: boolean
    }
  /** Something in this estate grants access outside the account. This is the alarm. */
  | {
      kind: "external-access"
      exposures: readonly ExternalExposure[]
      totalActive: number
      unreadable: readonly string[]
      truncated: boolean
    }

/** Everything an Access Analyzer surface needs, in one load. */
export interface AnalyzerReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The analyzers. DENIED here is a refused `access-analyzer:ListAnalyzers` and is
   * NEVER `[]`; EMPTY here is a real absence of analyzers, which is itself the
   * finding rather than an answer about exposure.
   */
  analyzers: AwsRead<AnalyzerListing>
  /** What a surface renders. The only thing that answers the operator's question. */
  externalAccess: ExternalAccessState
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { analyzers: number; findings: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK deserialises these to `Date`. A string is accepted too, because the
 * wire format is ISO-8601 and a caller replaying a recorded response has strings.
 * Anything else is null — a timestamp this engine could not read must not become
 * the epoch, which renders as 1970 and reads as "ancient".
 */
export function isoOf(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Access Analyzer's JSON protocol sends epoch SECONDS, not milliseconds.
    const parsed = new Date(value * 1000)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * Whether an analyzer type asks the external-access question.
 *
 * `ACCOUNT` and `ORGANIZATION` do. `*_UNUSED_ACCESS` asks which permissions are
 * unused, and `*_INTERNAL_ACCESS` asks who inside the account can reach what —
 * both useful, neither an answer to "is this shared outside the account".
 */
export function typeAnswersExternalAccess(analyzerType: string): boolean {
  return analyzerType === "ACCOUNT" || analyzerType === "ORGANIZATION"
}

/** Whether this analyzer answers the question, and if not, why not. */
export function roleOf(analyzerType: string, status: string): ExternalAccessRole {
  if (!typeAnswersExternalAccess(analyzerType)) {
    return {
      kind: "different-question",
      analyzerType,
      why:
        `this is a ${analyzerType} analyzer. It produces no external-access finding however much ` +
        `is shared outside the account, because that is not the question it asks.`,
    }
  }
  if (status !== "ACTIVE") {
    return {
      kind: "not-active",
      status,
      why:
        `this analyzer's status is ${status}. It is not evaluating resources, so the absence of ` +
        `findings from it says nothing about what is shared.`,
    }
  }
  return { kind: "answers-external-access" }
}

/**
 * The partition and region an ARN declares.
 *
 * `arn:PARTITION:service:REGION:account:resource`. Returns nulls rather than
 * guessing: a guessed partition is the GE-010-007 shape of defect, and an
 * analyzer ARN from a GovCloud account does not say `aws`.
 */
export function arnLocation(arn: string | null): {
  /** Whether this was an ARN at all. Callers fall back only when it was not. */
  parsed: boolean
  partition: string | null
  region: string | null
  accountId: string | null
} {
  if (!arn) return { parsed: false, partition: null, region: null, accountId: null }
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") {
    return { parsed: false, partition: null, region: null, accountId: null }
  }
  return {
    parsed: true,
    partition: parts[1] || null,
    // Global services — IAM, S3 — leave the region segment EMPTY, and that empty
    // is an answer: the resource is global. It is deliberately not backfilled
    // with the caller's region by anyone reading this, because "this IAM role is
    // in eu-west-2" is a false residency claim, which is the GE-010-007 shape.
    region: parts[3] || null,
    accountId: parts[4] || null,
  }
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
  what: string,
): AnalyzerAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `${what}'s tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        `${what} has no ARN this engine can state, so it cannot be joined against the tag index. ` +
        `Unattributed would be a claim about its tags; this is a claim about ours.`,
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    // The tag index answered and this ARN is not in it. That IS an observation:
    // the Resource Groups Tagging API returns resources that have tags, so an
    // absence means no tags at all, which is what `unattributed` says.
    return { kind: "unattributed" }
  }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

interface RawAnalyzer {
  arn: string
  name: string
  type: string
  status: string
  statusReason: string | null
  createdAt: string | null
  lastResourceAnalyzed: string | null
  lastResourceAnalyzedAt: string | null
}

interface RawAnalyzerPage {
  analyzers: RawAnalyzer[]
  truncated: boolean
  pagesRead: number
}

async function listAnalyzers(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<RawAnalyzerPage>> {
  return readAws<RawAnalyzerPage>(
    "access-analyzer:ListAnalyzers",
    async () => {
      const analyzers: RawAnalyzer[] = []
      let token: string | undefined
      let pagesRead = 0
      let truncated = false

      for (let page = 0; page < MAX_ANALYZER_PAGES; page += 1) {
        const response = (await gw.call("access-analyzer:ListAnalyzers", {
          nextToken: token,
        })) as ListAnalyzersResponse
        pagesRead += 1

        for (const summary of response?.analyzers ?? []) {
          // An analyzer with no ARN cannot be queried for findings and cannot be
          // attributed. Dropping it silently would understate coverage, so it is
          // kept only when AWS gave a handle; there is no synthesised ARN here.
          if (!summary?.arn || !summary.name) continue
          analyzers.push({
            arn: summary.arn,
            name: summary.name,
            // No default. An analyzer whose type AWS did not return must not be
            // assumed to be an external-access analyzer — that assumption is the
            // one that turns "nothing is checking" into "nothing was found".
            type: typeof summary.type === "string" && summary.type ? summary.type : "UNKNOWN",
            status:
              typeof summary.status === "string" && summary.status ? summary.status : "UNKNOWN",
            statusReason:
              typeof summary.statusReason?.code === "string" ? summary.statusReason.code : null,
            createdAt: isoOf(summary.createdAt),
            lastResourceAnalyzed:
              typeof summary.lastResourceAnalyzed === "string" ? summary.lastResourceAnalyzed : null,
            lastResourceAnalyzedAt: isoOf(summary.lastResourceAnalyzedAt),
          })
        }

        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_ANALYZER_PAGES - 1) {
          truncated = true
        }
      }

      // Sorted so two loads of the same estate produce the same order. ListAnalyzers
      // does not promise one, and an order that changes between renders makes a
      // diff of two screenshots unreadable.
      analyzers.sort((a, b) => a.arn.localeCompare(b.arn))
      return { analyzers, truncated, pagesRead }
    },
    {
      now: options.now,
      denial: options.denial,
      // EMPTY means "no analyzers", which is the finding this module is built
      // around. A truncated page can never be empty, so the second clause only
      // guards the impossible case rather than hiding a real absence.
      isEmpty: (value) => {
        const page = value as RawAnalyzerPage
        return page.analyzers.length === 0 && !page.truncated
      },
      ...RETRY,
    },
  )
}

interface RawFinding {
  findingId: string
  resource: string | null
  resourceType: string
  resourceOwnerAccount: string | null
  status: string
  findingType: string
  error: string | null
  createdAt: string | null
  analyzedAt: string | null
  updatedAt: string | null
}

interface RawFindingPage {
  findings: RawFinding[]
  truncated: boolean
  pagesRead: number
}

async function listFindings(
  gw: AwsGateway,
  analyzerArn: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<RawFindingPage>> {
  return readAws<RawFindingPage>(
    "access-analyzer:ListFindingsV2",
    async () => {
      const findings: RawFinding[] = []
      let token: string | undefined
      let pagesRead = 0
      let truncated = false

      for (let page = 0; page < MAX_FINDING_PAGES; page += 1) {
        const response = (await gw.call("access-analyzer:ListFindingsV2", {
          analyzerArn,
          nextToken: token,
        })) as ListFindingsV2Response
        pagesRead += 1

        for (const finding of response?.findings ?? []) {
          if (!finding?.id) continue
          findings.push({
            findingId: finding.id,
            resource: typeof finding.resource === "string" && finding.resource ? finding.resource : null,
            resourceType:
              typeof finding.resourceType === "string" && finding.resourceType
                ? finding.resourceType
                : "UNKNOWN",
            resourceOwnerAccount:
              typeof finding.resourceOwnerAccount === "string" && finding.resourceOwnerAccount
                ? finding.resourceOwnerAccount
                : null,
            // No default to ARCHIVED or RESOLVED. A finding whose status AWS did
            // not return is treated as UNKNOWN and counted as live below, because
            // guessing "resolved" is how an exposure disappears from the page.
            status: typeof finding.status === "string" && finding.status ? finding.status : "UNKNOWN",
            findingType:
              typeof finding.findingType === "string" && finding.findingType
                ? finding.findingType
                : "UNKNOWN",
            error: typeof finding.error === "string" && finding.error ? finding.error : null,
            createdAt: isoOf(finding.createdAt),
            analyzedAt: isoOf(finding.analyzedAt),
            updatedAt: isoOf(finding.updatedAt),
          })
        }

        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_FINDING_PAGES - 1) {
          truncated = true
        }
      }

      findings.sort((a, b) => a.findingId.localeCompare(b.findingId))
      return { findings, truncated, pagesRead }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => {
        const page = value as RawFindingPage
        return page.findings.length === 0 && !page.truncated
      },
      ...RETRY,
    },
  )
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every analyzer this account has, whether any answers the external-access
 * question, and what it found.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway (`liveGateway()` → `client.ts`); a test passes a stand-in
 * gateway to the SAME function, because a test that drove a private helper would
 * stay green on the day the caller stopped calling it.
 */
export async function analyzerReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<AnalyzerReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await listAnalyzers(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    analyzers: CAPABILITIES["access-analyzer:ListAnalyzers"].refreshMs,
    findings: CAPABILITIES["access-analyzer:ListFindingsV2"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array, and
  // no branch that turns EMPTY into a claim about exposure.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<AnalyzerListing>`. A cast here
    // would be the place a future empty listing could be smuggled in.
    const analyzers: AwsRead<AnalyzerListing> = listed
    return {
      identity,
      tagged,
      analyzers,
      externalAccess: externalAccessState(analyzers),
      asOf,
      refreshMs,
    }
  }

  const raw = listed.value.analyzers
  const findingReads: Array<AwsRead<RawFindingPage>> = new Array(raw.length)

  for (let start = 0; start < raw.length; start += FINDINGS_CONCURRENCY) {
    const batch = raw.slice(start, start + FINDINGS_CONCURRENCY)
    const read = await Promise.all(
      batch.map((analyzer, offset) => {
        const position = start + offset
        const role = roleOf(analyzer.type, analyzer.status)
        if (role.kind !== "answers-external-access") {
          const skipped: AwsRead<RawFindingPage> = {
            state: "UNCONFIGURED",
            capability: "access-analyzer:ListFindingsV2",
            why: role.why,
          }
          return Promise.resolve(skipped)
        }
        if (position >= MAX_ANALYZERS_QUERIED) {
          const skipped: AwsRead<RawFindingPage> = {
            state: "UNCONFIGURED",
            capability: "access-analyzer:ListFindingsV2",
            why:
              `this engine reads findings from at most ${MAX_ANALYZERS_QUERIED} analyzers per load ` +
              `and this analyzer is number ${position + 1} of ${raw.length}. Its findings were not ` +
              `read — which is not the same as its having none.`,
          }
          return Promise.resolve(skipped)
        }
        return listFindings(gw, analyzer.arn, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) findingReads[start + i] = read[i]
  }

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const fallbackPartition = identityResolved ? identity.value.partition : null
  const fallbackRegion = identityResolved ? identity.value.region : null

  const analyzerReads: AnalyzerReading[] = raw.map((analyzer, i) => {
    const where = arnLocation(analyzer.arn)
    const findingsRaw = findingReads[i]

    const findings: AwsRead<FindingListing> =
      findingsRaw.state === "ACTUAL" || findingsRaw.state === "STALE"
        ? {
            ...findingsRaw,
            value: {
              exposures: findingsRaw.value.findings.map((finding): ExternalExposure => {
                const resourceWhere = arnLocation(finding.resource)
                return {
                  findingId: finding.findingId,
                  resource: finding.resource,
                  resourceType: finding.resourceType,
                  resourceOwnerAccount: finding.resourceOwnerAccount,
                  status: finding.status,
                  findingType: finding.findingType,
                  error: finding.error,
                  createdAt: finding.createdAt,
                  analyzedAt: finding.analyzedAt,
                  updatedAt: finding.updatedAt,
                  // The resource's own ARN beats anything assembled, INCLUDING
                  // when it says the resource is global (an empty region
                  // segment). The resolved identity is the fallback only when
                  // AWS returned no ARN at all, and it is never a literal.
                  region: resourceWhere.parsed ? resourceWhere.region : fallbackRegion,
                  partition: resourceWhere.parsed ? resourceWhere.partition : fallbackPartition,
                  attribution: attributionFor(
                    finding.resource,
                    tagged,
                    index,
                    `the resource ${finding.resource ?? finding.findingId}`,
                  ),
                  externalPrincipal: EXTERNAL_PRINCIPAL_NOT_READABLE,
                  exposedAction: EXPOSED_ACTION_NOT_READABLE,
                  analyzerArn: analyzer.arn,
                  asOf,
                }
              }),
              truncated: findingsRaw.value.truncated,
              pagesRead: findingsRaw.value.pagesRead,
              truncationNote: findingsRaw.value.truncated
                ? `this analyzer still had findings after ${MAX_FINDING_PAGES} pages. What is ` +
                  `listed is not the whole set, and the count below is a floor, not a total.`
                : null,
            },
          }
        : findingsRaw

    return {
      arn: analyzer.arn,
      name: analyzer.name,
      type: analyzer.type,
      status: analyzer.status,
      statusReason: analyzer.statusReason,
      createdAt: analyzer.createdAt,
      lastResourceAnalyzed: analyzer.lastResourceAnalyzed,
      lastResourceAnalyzedAt: analyzer.lastResourceAnalyzedAt,
      region: where.parsed ? where.region : fallbackRegion,
      partition: where.parsed ? where.partition : fallbackPartition,
      accountId: where.accountId ?? (identityResolved ? identity.value.accountId : null),
      attribution: attributionFor(analyzer.arn, tagged, index, `the analyzer ${analyzer.name}`),
      role: roleOf(analyzer.type, analyzer.status),
      findings,
      refreshMs: refreshMs.findings,
      asOf,
    }
  })

  const analyzers: AwsRead<AnalyzerListing> = {
    ...listed,
    value: {
      analyzers: analyzerReads,
      truncated: listed.value.truncated,
      pagesRead: listed.value.pagesRead,
      truncationNote: listed.value.truncated
        ? `AWS still had analyzer pages after ${MAX_ANALYZER_PAGES}. The analyzers listed are not ` +
          `every analyzer in this account, so coverage below is a floor, not a total.`
        : null,
    },
  }

  return {
    identity,
    tagged,
    analyzers,
    externalAccess: externalAccessState(analyzers),
    asOf,
    refreshMs,
  }
}

/* ------------------------------------------------------- the account verdict -- */

/**
 * The remedy for an account that is not checking. One sentence, one place.
 *
 * `access-analyzer:CreateAnalyzer` is named as the thing an operator does in the
 * console or in Terraform. This engine does not and will not call it: the whole
 * of `src/lib/aws` outside `mutate.ts` is read-only.
 */
export const NO_ANALYZER_REMEDY =
  "Create an account or organization analyzer (access-analyzer:CreateAnalyzer, in the IAM Access " +
  "Analyzer console or in Terraform) in this region. Until one exists nothing evaluates whether " +
  "this estate's S3 buckets, KMS keys, IAM roles, SQS queues, Secrets Manager secrets or ECR " +
  "repositories grant access outside the account."

/**
 * Whether anything in this estate is shared outside the account.
 *
 * Exported and pure, so the derivation can be reasoned about on its own — but
 * `analyzerReadings` is the only production caller and the tests drive it through
 * there, not through here.
 *
 * Read the order of the branches: the EMPTY listing reaches `no-analyzer` BEFORE
 * anything can reach `none-found`, and `none-found` is only reachable when at
 * least one analyzer that answers the external-access question actually answered.
 */
export function externalAccessState(
  analyzers: AwsRead<AnalyzerListing>,
): ExternalAccessState {
  if (analyzers.state === "EMPTY") {
    return {
      kind: "no-analyzer",
      why:
        "access-analyzer:ListAnalyzers answered and this account has no analyzer. Nothing has " +
        "evaluated whether any resource here grants access to an external principal. That is not " +
        "the same as nothing being shared — it is the absence of the check, not the absence of the " +
        "exposure.",
      remedy: NO_ANALYZER_REMEDY,
    }
  }
  if (analyzers.state !== "ACTUAL" && analyzers.state !== "STALE") {
    return {
      kind: "unknown",
      why: describeRead(analyzers, "the IAM Access Analyzer listing"),
      remedy:
        "Grant the action named above to this engine's role, then reload. Until the analyzer " +
        "listing can be read, whether anything is shared outside this account is unknown.",
    }
  }

  const listing = analyzers.value
  const answering = listing.analyzers.filter((a) => a.role.kind === "answers-external-access")

  if (answering.length === 0) {
    return {
      kind: "not-answering",
      analyzersSeen: listing.analyzers.length,
      why:
        `${listing.analyzers.length} analyzer(s) exist and not one of them answers the ` +
        `external-access question: ` +
        listing.analyzers
          .map((a) => `${a.name} (${a.type}, ${a.status})`)
          .join("; ") +
        ". Nothing here evaluates whether a resource grants access outside the account.",
      remedy: NO_ANALYZER_REMEDY,
    }
  }

  const unreadable: string[] = []
  const readable: string[] = []
  const exposures: ExternalExposure[] = []
  let truncated = listing.truncated

  for (const analyzer of answering) {
    const findings = analyzer.findings
    if (findings.state !== "ACTUAL" && findings.state !== "STALE" && findings.state !== "EMPTY") {
      unreadable.push(analyzer.name)
      continue
    }
    readable.push(analyzer.name)
    if (findings.state === "EMPTY") continue
    if (findings.value.truncated) truncated = true
    for (const exposure of findings.value.exposures) {
      // ARCHIVED and RESOLVED findings are history, not live exposure — showing
      // one as current is a false alarm, and a false alarm is how a real one gets
      // ignored. UNKNOWN is kept: a status AWS did not return must not be assumed
      // to be a resolved one.
      if (exposure.status === "ARCHIVED" || exposure.status === "RESOLVED") continue
      // An unused-access finding from an external-access analyzer would be a
      // contradiction, but the filter is explicit rather than assumed: mislabelling
      // an unused IAM role as an external exposure is its own wrong answer.
      if (exposure.findingType !== "ExternalAccess" && exposure.findingType !== "UNKNOWN") continue
      exposures.push(exposure)
    }
  }

  if (readable.length === 0) {
    return {
      kind: "findings-unreadable",
      unreadable,
      why:
        `${answering.length} analyzer(s) answer the external-access question and this engine could ` +
        `read the findings of none of them (${unreadable.join(", ")}). Whether anything is shared ` +
        `outside this account is unknown.`,
      remedy:
        "Grant access-analyzer:ListFindingsV2 on arn:*:access-analyzer:*:*:analyzer/* to this " +
        "engine's role, then reload.",
    }
  }

  if (exposures.length > 0) {
    return {
      kind: "external-access",
      exposures,
      totalActive: exposures.length,
      unreadable,
      truncated,
    }
  }

  return { kind: "none-found", analyzersRead: readable, unreadable, truncated }
}

/* ------------------------------------------------------------ rendering -- */

/**
 * The sentence a surface prints for the account verdict.
 *
 * Six states, six visibly different sentences, and only ONE of them says nothing
 * is shared. `no-analyzer`, `not-answering`, `unknown` and `findings-unreadable`
 * all begin with "unknown" and all carry a remedy, because all four mean the same
 * thing to an operator: we did not find out. One renderer for the same reason
 * `describeRead` is one renderer — a claim must not be worded as an absence on
 * one surface and correctly on another.
 */
export function describeExternalAccess(state: ExternalAccessState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why} Remedy: ${state.remedy}`
    case "no-analyzer":
      return `unknown — NO ANALYZER EXISTS. ${state.why} Remedy: ${state.remedy}`
    case "not-answering":
      return `unknown — NO ANALYZER ANSWERS THIS QUESTION. ${state.why} Remedy: ${state.remedy}`
    case "findings-unreadable":
      return `unknown — ${state.why} Remedy: ${state.remedy}`
    case "none-found": {
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : `, though ${state.unreadable.length} analyzer(s) could not be read (${state.unreadable.join(", ")}), so this is not a complete answer`
      const cut = state.truncated ? " Some pages were not walked; see the truncation note." : ""
      return (
        `no external access found — ${state.analyzersRead.length} analyzer(s) answered ` +
        `(${state.analyzersRead.join(", ")}) and reported no active external-access finding${qualifier}.${cut}`
      )
    }
    case "external-access": {
      const named = state.exposures
        .map(
          (e) =>
            `${e.resource ?? e.findingId} (${e.resourceType})` +
            `${e.resourceOwnerAccount ? ` owned by ${e.resourceOwnerAccount}` : ""}`,
        )
        .join("; ")
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : ` A further ${state.unreadable.length} analyzer(s) could not be read.`
      const cut = state.truncated
        ? " More findings existed than were walked, so this count is a floor."
        : ""
      return (
        `EXTERNAL ACCESS — ${state.totalActive} resource(s) in this estate grant access outside ` +
        `this account: ${named}. The external principal and the exposed action are not readable ` +
        `by this engine (${EXTERNAL_PRINCIPAL_NOT_READABLE.needs} is not held).${qualifier}${cut}`
      )
    }
  }
}

/** The sentence a surface prints for one analyzer's attribution. */
export function describeAnalyzerAttribution(attribution: AnalyzerAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for one exposure. */
export function describeExposure(exposure: ExternalExposure): string {
  const where =
    exposure.region && exposure.partition
      ? `${exposure.region} (partition ${exposure.partition})`
      : exposure.partition
        ? `global, partition ${exposure.partition}`
        : "region unknown — identity is unresolved"
  return (
    `${exposure.resource ?? `finding ${exposure.findingId}`} — ${exposure.resourceType} — ${where} — ` +
    `${describeAnalyzerAttribution(exposure.attribution)} — status ${exposure.status}, ` +
    `type ${exposure.findingType}` +
    `${exposure.error ? `, analyzer error: ${exposure.error}` : ""} · ` +
    `external principal: ${exposure.externalPrincipal.why} · ` +
    `exposed action: ${exposure.exposedAction.why} · ` +
    `analyzed ${exposure.analyzedAt ?? "at a time AWS did not state"}`
  )
}

/** The sentence a surface prints for one analyzer. One funnel, so states cannot drift. */
export function describeAnalyzer(analyzer: AnalyzerReading): string {
  const where =
    analyzer.region && analyzer.partition
      ? `${analyzer.region} (partition ${analyzer.partition})`
      : "region unknown — identity is unresolved"
  const head =
    `${analyzer.name} — ${analyzer.type}, status ${analyzer.status}` +
    `${analyzer.statusReason ? ` (${analyzer.statusReason})` : ""} — ${where} — ` +
    `${describeAnalyzerAttribution(analyzer.attribution)}`

  if (analyzer.role.kind !== "answers-external-access") {
    return `${head} — does not answer the external-access question: ${analyzer.role.why}`
  }

  if (analyzer.findings.state === "ACTUAL" || analyzer.findings.state === "STALE") {
    const listing = analyzer.findings.value
    const active = listing.exposures.filter(
      (e) => e.status !== "ARCHIVED" && e.status !== "RESOLVED",
    ).length
    return (
      `${head} — ${active} active finding(s) of ${listing.exposures.length} returned across ` +
      `${listing.pagesRead} page(s)` +
      `${listing.truncationNote ? ` · TRUNCATED: ${listing.truncationNote}` : ""} · ` +
      `as of ${analyzer.asOf}, refreshed every ${Math.round(analyzer.refreshMs / 1000)}s`
    )
  }

  // Every other state goes through the one renderer, so a refused findings read
  // reads as a refusal here exactly as it does everywhere else — never as "clear".
  return `${head} — ${describeRead(analyzer.findings, `${analyzer.name} findings`)}`
}

export interface AnalyzerLine {
  label: string
  text: string
}

/**
 * What an Access Analyzer surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function analyzerLines(readings: AnalyzerReadings): readonly AnalyzerLine[] {
  const lines: AnalyzerLine[] = [
    { label: "External access", text: describeExternalAccess(readings.externalAccess) },
    {
      label: "Analyzers",
      text: describeRead(
        readings.analyzers,
        `analyzers read from AWS, refreshed every ${Math.round(readings.refreshMs.analyzers / 1000)}s`,
      ),
    },
  ]

  if (readings.analyzers.state === "ACTUAL" || readings.analyzers.state === "STALE") {
    if (readings.analyzers.value.truncationNote) {
      lines.push({ label: "Analyzers truncated", text: readings.analyzers.value.truncationNote })
    }
    for (const analyzer of readings.analyzers.value.analyzers) {
      lines.push({ label: analyzer.name, text: describeAnalyzer(analyzer) })
    }
  }

  if (readings.externalAccess.kind === "external-access") {
    for (const exposure of readings.externalAccess.exposures) {
      lines.push({ label: exposure.resource ?? exposure.findingId, text: describeExposure(exposure) })
    }
  }

  return lines
}
