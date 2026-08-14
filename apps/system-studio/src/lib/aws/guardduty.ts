/**
 * STUDIO-070-004 (GuardDuty) — is anything watching this account for a
 * compromise, and what has it seen.
 *
 * ## The confusion this module exists to end
 *
 * A GuardDuty detector that does not exist returns no findings. A detector that
 * exists but is SUSPENDED returns no NEW findings. An account under active
 * attack whose `guardduty:ListFindings` was refused returns no findings either.
 * Through any reader that folds those into a number, all three render as `0`,
 * and `0 findings` is read by every operator alive as "we are clean".
 *
 * Two of those three are the opposite of clean, so this module never produces a
 * finding count without the sentence that qualifies it, and the top-line answer
 * — `GuardDutyPosture` — is a union in which "nothing is watching" is its own
 * arm carrying the remedy and the cost of fixing it, rather than a zero.
 *
 * ## What this engine CANNOT read, said out loud rather than defaulted
 *
 * **Whether a detector is ENABLED is not readable by this engine today.**
 *
 * `guardduty:ListDetectors` returns detector IDs and nothing else — a suspended
 * detector is listed exactly like a running one. Status, the finding publishing
 * frequency, and which data sources and protection plans are switched on (S3
 * data events, EKS audit logs, Malware Protection, RDS login events, Lambda
 * network activity) all live in `GetDetector`, and `guardduty:GetDetector` is
 * NOT in `capabilities.ts`. This module does not get to add it — the registry is
 * the one place the capability surface is decided, and a module that quietly
 * grew its own would defeat the point of having one.
 *
 * So every detector carries a `DetectorConfiguration` whose only arm is
 * NOT_READABLE, naming the capability and listing each fact that stays unknown.
 * A field that silently held `"ENABLED"`, or that was left off the type, would
 * let a surface print a detector row that reads as running. `guardDutyCoverage`
 * therefore cannot reach `CHECKING`: the best this reader can honestly report is
 * `PARTIAL` — a detector exists and its findings were read, and whether it is
 * still running was not verified. The day `guardduty:GetDetector` enters the
 * registry, `DetectorConfiguration` gains a second arm and that changes; until
 * then it is stated rather than assumed.
 *
 * ## Two capabilities behind one list, kept apart
 *
 * `guardduty:ListFindings` (the ids) and `guardduty:GetFindings` (the findings)
 * are separate IAM actions and a role is routinely granted one without the
 * other. They are two `AwsRead`s on every detector for the reason `retained.ts`
 * paid for with `backup:ListBackupVaults`: folding them makes a refused
 * `GetFindings` print the minimum statement for `ListFindings`, so an operator
 * grants the action that was never missing, redeploys, and is refused
 * identically.
 *
 * A denied detail degrades on its own. A detector whose findings were refused
 * still appears, saying it was refused, and the OTHER detectors still report.
 *
 * ## Ranked by severity, and the type verbatim
 *
 * `UnauthorizedAccess:EC2/SSHBruteForce` is what an operator pastes into the
 * GuardDuty documentation and into a search. A paraphrase — "brute force against
 * an instance" — is not that string, so `GuardDutyFinding.type` is AWS's own and
 * `describeFinding` prints it unaltered.
 *
 * Ranking is by AWS's published severity bands, and a finding whose severity is
 * absent or out of range is `UNRANKED` and sorts ABOVE critical rather than
 * below informational. Sorting an unreadable severity to the bottom is a guess
 * that it is unimportant, and it is the guess that buries it.
 *
 * ## Bounded, and honest when the bound is reached
 *
 * Every page loop has a cap and every cap has a `PageBound` that says "there
 * were more". A reader that silently returns the first page tells the same lie
 * as an empty list; a reader with no bound is how one server render becomes a
 * thousand API calls.
 *
 * ## Region, partition, attribution
 *
 * Region and partition come from the resolved identity and from the `Region`,
 * `Partition` and `AccountId` AWS puts on each finding. There is no region
 * literal and no `"aws"` fallback in this file — GE-010-007 was a residency
 * defect caused by exactly that fallback.
 *
 * Attribution goes through `tags.ts` and the Resource Groups Tagging API. It
 * keeps `tags.ts`'s deliberate split between `shared` (somebody decided) and
 * `unattributed` (nobody tagged it), and adds the fourth answer neither can
 * express: `unknown`, for when the tag index itself was denied or when the
 * finding names no resource ARN to join on. "We could not look this up" is not
 * "this has no tenant tag".
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
 * How many `ListDetectors` pages to walk. `client.ts` asks for 50 per page, so
 * this is 250 detectors — an account has one per region, and the cap exists
 * because a page loop with no bound is an outage, not because 250 is expected.
 */
export const MAX_DETECTOR_PAGES = 5

/** How many `ListFindings` pages to walk per detector. 50 ids per page. */
export const MAX_FINDING_PAGES = 10

/**
 * How many finding ids are hydrated per detector.
 *
 * `GetFindings` takes at most 50 ids per call, so 500 is ten calls. Past this
 * the ids are still COUNTED and the bound says so — the surface reads "500 of N,
 * ranked by severity", never "N findings" over a list of 500.
 */
export const MAX_FINDINGS_PER_DETECTOR = 500

/** `GetFindings` accepts at most 50 finding ids in one request. AWS's limit. */
export const GET_FINDINGS_BATCH = 50

/**
 * How many detectors get their findings read in one load.
 *
 * Detectors past the cap are NOT dropped and do NOT render as having no
 * findings: their finding reads are UNCONFIGURED saying the engine stopped.
 */
export const MAX_DETECTOR_FINDING_READS = 10

/** The retry schedule is `throttle.ts`'s, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------------------ API shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListDetectorsResponse {
  DetectorIds?: string[]
  NextToken?: string
}

interface ListFindingsResponse {
  FindingIds?: string[]
  NextToken?: string
}

interface RawFinding {
  Id?: string
  Arn?: string
  Type?: string
  Title?: string
  Description?: string
  Severity?: number
  AccountId?: string
  Region?: string
  Partition?: string
  CreatedAt?: string
  UpdatedAt?: string
  Resource?: RawResource
  Service?: {
    DetectorId?: string
    ServiceName?: string
    FeatureName?: string
    Archived?: boolean
    Count?: number
    EventFirstSeen?: string
    EventLastSeen?: string
  }
}

interface RawResource {
  ResourceType?: string
  InstanceDetails?: { InstanceId?: string }
  S3BucketDetails?: Array<{ Arn?: string; Name?: string }>
  EksClusterDetails?: { Arn?: string; Name?: string }
  EcsClusterDetails?: { Arn?: string; Name?: string }
  RdsDbInstanceDetails?: { DbInstanceArn?: string; DbInstanceIdentifier?: string }
  LambdaDetails?: { FunctionArn?: string; FunctionName?: string }
  AccessKeyDetails?: { AccessKeyId?: string; UserName?: string; UserType?: string }
}

interface GetFindingsResponse {
  Findings?: RawFinding[]
}

/* -------------------------------------------------------------- severity -- */

/**
 * AWS's published severity bands, plus one this engine needs and AWS does not
 * have.
 *
 * 1.0–3.9 Low · 4.0–6.9 Medium · 7.0–8.9 High · 9.0–10.0 Critical, and 0.1–0.9
 * is documented as informational and not currently assigned. `UNRANKED` is for
 * a finding whose `Severity` was absent, non-numeric or outside 0–10: a value
 * this engine did not read must not be shown as a low one.
 */
export type SeverityBand =
  | "UNRANKED"
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFORMATIONAL"

/**
 * Rank order for display. `UNRANKED` is FIRST, above critical, on purpose — see
 * the module header. An unreadable severity is a finding somebody has to look
 * at, and the alternative places it where nobody scrolls.
 */
export const SEVERITY_ORDER: Readonly<Record<SeverityBand, number>> = {
  UNRANKED: 0,
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
  INFORMATIONAL: 5,
}

export function severityBand(severity: number | null): SeverityBand {
  if (severity === null || !Number.isFinite(severity)) return "UNRANKED"
  if (severity < 0 || severity > 10) return "UNRANKED"
  if (severity >= 9) return "CRITICAL"
  if (severity >= 7) return "HIGH"
  if (severity >= 4) return "MEDIUM"
  if (severity >= 1) return "LOW"
  return "INFORMATIONAL"
}

/* ------------------------------------------------------------ the shapes -- */

/**
 * A page loop's outcome.
 *
 * `capped` is the explicit "there were more" signal. Without it a truncated list
 * renders as the whole estate, which is the same lie as an empty one.
 */
export type PageBound =
  | { kind: "complete"; read: number }
  | { kind: "capped"; read: number; cap: number; why: string }

/**
 * What this engine knows about a detector's configuration.
 *
 * One arm, deliberately. See the module header: status, publishing frequency,
 * data sources and protection plans all live in `GetDetector`, and
 * `guardduty:GetDetector` is not a capability this engine holds. The type exists
 * so the absence is a value a surface must render, not a field it can forget.
 */
export interface DetectorConfiguration {
  state: "NOT_READABLE"
  /** The capability that would answer it. Not in `capabilities.ts` today. */
  needs: "guardduty:GetDetector"
  /** The IAM action that grant would carry, spelled as IAM spells it. */
  iamAction: "guardduty:GetDetector"
  /** Every fact that stays unknown, named individually rather than summarised. */
  unknown: readonly string[]
  why: string
}

/** The same object for every detector: nothing about it varies per detector. */
export const DETECTOR_CONFIGURATION_NOT_READABLE: DetectorConfiguration = {
  state: "NOT_READABLE",
  needs: "guardduty:GetDetector",
  iamAction: "guardduty:GetDetector",
  unknown: [
    "whether the detector is ENABLED or SUSPENDED — ListDetectors lists a suspended detector identically",
    "the finding publishing frequency (FIFTEEN_MINUTES / ONE_HOUR / SIX_HOURS)",
    "whether S3 Protection is on",
    "whether EKS Protection (audit logs and runtime monitoring) is on",
    "whether Malware Protection for EC2 and for S3 is on",
    "whether RDS Protection (login-event monitoring) is on",
    "whether Lambda Protection (network activity monitoring) is on",
  ],
  why:
    "a detector's status, publishing frequency, data sources and protection plans are returned by " +
    "guardduty:GetDetector, and that capability is not in this engine's registry. guardduty:ListDetectors " +
    "returns ids only, and it lists a SUSPENDED detector exactly as it lists a running one — so " +
    "'a detector exists' must not be read as 'threat detection is on'. Unknown, not enabled.",
}

/**
 * Which tenant something belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken, and a
 * finding may name no ARN to join on at all. A resource whose tags were never
 * read must not render as "unattributable — missing tenure:tenant", because that
 * sentence sends an operator to add a tag that is probably already there.
 */
export type GuardDutyAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** What a finding is about, as far as the finding itself says. */
export interface FindingResource {
  /** AWS's own `ResourceType` — `Instance`, `S3Bucket`, `AccessKey`, `Lambda`… */
  resourceType: string | null
  /** An ARN to join against the tag index, or null. Never assembled from a guess. */
  arn: string | null
  /** A human handle — instance id, bucket name, function name, access key id. */
  identifier: string | null
  /** Where the ARN and identifier came from, or why there is neither. Never silent. */
  provenance: string
}

export interface GuardDutyFinding {
  id: string
  /** AWS's own finding ARN, when it returned one. */
  arn: string | null
  detectorId: string
  /**
   * AWS's own finding type, verbatim — `UnauthorizedAccess:EC2/SSHBruteForce`.
   * Never a paraphrase: this string is what an operator searches for.
   */
  type: string
  title: string | null
  description: string | null
  /** AWS's numeric severity, or null when it did not return a usable one. */
  severity: number | null
  band: SeverityBand
  accountId: string | null
  /** From the finding's own `Region`, else the resolved identity. Never a literal. */
  region: string | null
  /** From the finding's own `Partition`, else the resolved identity. Never `"aws"`. */
  partition: string | null
  resource: FindingResource
  /** `Service.EventFirstSeen` — when the behaviour was first observed. */
  firstSeen: string | null
  /** `Service.EventLastSeen` — when it was last observed. */
  lastSeen: string | null
  createdAt: string | null
  updatedAt: string | null
  /** `Service.Count` — how many times this finding has recurred. */
  occurrences: number | null
  /** Whether the finding is archived. Null when AWS did not say. */
  archived: boolean | null
  serviceName: string | null
  featureName: string | null
  attribution: GuardDutyAttribution
}

export interface DetectorReading {
  detectorId: string
  /** Assembled from the resolved identity, or null when identity is unresolved. */
  arn: string | null
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: GuardDutyAttribution
  /** Status, frequency, data sources, protection plans — all NOT_READABLE. */
  configuration: DetectorConfiguration
  /** `guardduty:ListFindings`, with its own action in its own denial. */
  findingIds: AwsRead<readonly string[]>
  /** Whether the id listing was walked to completion. */
  idPages: PageBound
  /** `guardduty:GetFindings`, with ITS own action in ITS own denial. */
  findings: AwsRead<readonly GuardDutyFinding[]>
  /** Ids that were listed and that `GetFindings` did not return. Never dropped silently. */
  unhydrated: readonly string[]
  /** This detector's finding cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/** One severity band's count, for a surface that ranks. */
export interface SeverityCount {
  band: SeverityBand
  count: number
}

/**
 * The top-line answer, as a union so a zero cannot be printed bare.
 *
 * `not-enabled` is a FINDING, not an absence, and it carries the remedy and the
 * cost of acting on it. `detectors-present` never claims the account is watched:
 * its `caveat` is the sentence that has to travel with any count it carries,
 * because this engine cannot read whether the detector is running.
 */
export type GuardDutyPosture =
  /** The detector listing itself was refused, throttled or broken. */
  | { kind: "unknown"; why: string }
  /**
   * `guardduty:ListDetectors` answered, and there is no detector in this region.
   * Nothing is watching this account for a compromise. This is the finding.
   */
  | { kind: "not-enabled"; remedy: string; cost: string; asOf: string }
  /** Detectors exist. Whether they are RUNNING was not verified — see `caveat`. */
  | {
      kind: "detectors-present"
      detectorIds: readonly string[]
      /** Findings this engine actually read, by band, worst first. */
      severityCounts: readonly SeverityCount[]
      totalFindings: number
      /** Detectors whose findings could not be read. Named, so a count is qualified. */
      unreadable: readonly string[]
      /** Travels with every count. Never optional, never omitted by a surface. */
      caveat: string
      asOf: string
    }

/** Everything a GuardDuty surface needs, in one load. */
export interface GuardDutyReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The detectors. DENIED here is a refused `guardduty:ListDetectors` and is
   * NEVER `[]` — an operator reading "no detector" when the truth is "we were
   * not allowed to look" would enable a detector that is already running, or
   * worse, believe one is.
   */
  detectors: AwsRead<readonly DetectorReading[]>
  detectorPages: PageBound
  posture: GuardDutyPosture
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { detectors: number; findingIds: number; findings: number }
}

/* ------------------------------------------------------- remedy and cost -- */

/**
 * What to do when nothing is watching.
 *
 * Names the Terraform resource as well as the console, because this estate is
 * provisioned from `infrastructure/terraform/` and a detector clicked into
 * existence by hand is one the next apply does not know about.
 */
export const GUARDDUTY_NOT_ENABLED_REMEDY =
  "Enable a GuardDuty detector in this region — `aws_guardduty_detector` in " +
  "infrastructure/terraform/, or guardduty:CreateDetector in the console. Until one exists, " +
  "nothing is analysing this account's CloudTrail management events, VPC flow logs or DNS " +
  "queries for a compromise, and every security surface that reads GuardDuty will keep " +
  "answering with an empty list."

/**
 * What enabling it costs, without inventing a number.
 *
 * No per-GB or per-event price appears here. Prices are per-region and change,
 * `pricing:GetProducts` is the capability that would read the current one, and
 * this module does not hold it. A price typed into a comment is a price that is
 * wrong within a quarter and believed for a year.
 */
export const GUARDDUTY_COST_NOTE =
  "GuardDuty is not free: it is billed on the volume it analyses — CloudTrail management " +
  "events, VPC flow logs and DNS queries — with separate charges per protection plan (S3, " +
  "EKS, Malware, RDS login events, Lambda network activity). This engine states no figure: " +
  "the rate is per-region and AWS publishes a free trial for a newly enabled detector, so " +
  "read the current price in the AWS console or through pricing:GetProducts, which is a " +
  "capability this engine does not hold, before budgeting for it."

/**
 * The sentence that travels with any finding count from a detector whose status
 * this engine could not verify. There is exactly one, so it cannot be softened
 * on one surface and not another.
 */
export const STATUS_UNVERIFIED_CAVEAT =
  "a detector exists, and whether it is ENABLED or SUSPENDED was NOT verified — that needs " +
  "guardduty:GetDetector, which this engine's registry does not carry. A suspended detector " +
  "generates no new findings, so a low count here is not evidence that the account is quiet."

/* -------------------------------------------------------------- parsing -- */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

/**
 * What a finding is about.
 *
 * The ARN is taken from the finding's own resource block wherever AWS supplies
 * one. The single exception is `Instance`, where GuardDuty returns an instance
 * ID and no ARN: that ARN is assembled from the finding's OWN `Partition`,
 * `Region` and `AccountId` — AWS's three answers, not this engine's guesses —
 * and the provenance says so. If any of the three is missing the ARN is null
 * rather than half-built, because a half-built ARN joins the tag index, matches
 * nothing, and reads exactly like an untagged resource.
 */
export function findingResource(raw: RawResource | undefined, finding: RawFinding): FindingResource {
  const resourceType = str(raw?.ResourceType)
  if (!raw) {
    return {
      resourceType: null,
      identifier: null,
      arn: null,
      provenance: "the finding carried no Resource block, so there is nothing to attribute it to",
    }
  }

  const bucket = raw.S3BucketDetails?.[0]
  if (bucket && (str(bucket.Arn) || str(bucket.Name))) {
    return {
      resourceType,
      arn: str(bucket.Arn),
      identifier: str(bucket.Name) ?? str(bucket.Arn),
      provenance: "the finding's own S3BucketDetails",
    }
  }
  if (raw.LambdaDetails && (str(raw.LambdaDetails.FunctionArn) || str(raw.LambdaDetails.FunctionName))) {
    return {
      resourceType,
      arn: str(raw.LambdaDetails.FunctionArn),
      identifier: str(raw.LambdaDetails.FunctionName) ?? str(raw.LambdaDetails.FunctionArn),
      provenance: "the finding's own LambdaDetails",
    }
  }
  if (raw.EksClusterDetails && (str(raw.EksClusterDetails.Arn) || str(raw.EksClusterDetails.Name))) {
    return {
      resourceType,
      arn: str(raw.EksClusterDetails.Arn),
      identifier: str(raw.EksClusterDetails.Name) ?? str(raw.EksClusterDetails.Arn),
      provenance: "the finding's own EksClusterDetails",
    }
  }
  if (raw.EcsClusterDetails && (str(raw.EcsClusterDetails.Arn) || str(raw.EcsClusterDetails.Name))) {
    return {
      resourceType,
      arn: str(raw.EcsClusterDetails.Arn),
      identifier: str(raw.EcsClusterDetails.Name) ?? str(raw.EcsClusterDetails.Arn),
      provenance: "the finding's own EcsClusterDetails",
    }
  }
  if (
    raw.RdsDbInstanceDetails &&
    (str(raw.RdsDbInstanceDetails.DbInstanceArn) || str(raw.RdsDbInstanceDetails.DbInstanceIdentifier))
  ) {
    return {
      resourceType,
      arn: str(raw.RdsDbInstanceDetails.DbInstanceArn),
      identifier:
        str(raw.RdsDbInstanceDetails.DbInstanceIdentifier) ??
        str(raw.RdsDbInstanceDetails.DbInstanceArn),
      provenance: "the finding's own RdsDbInstanceDetails",
    }
  }
  if (raw.InstanceDetails && str(raw.InstanceDetails.InstanceId)) {
    const instanceId = str(raw.InstanceDetails.InstanceId) as string
    const partition = str(finding.Partition)
    const region = str(finding.Region)
    const accountId = str(finding.AccountId)
    if (partition && region && accountId) {
      return {
        resourceType,
        arn: `arn:${partition}:ec2:${region}:${accountId}:instance/${instanceId}`,
        identifier: instanceId,
        provenance:
          "assembled from the finding's OWN Partition, Region and AccountId plus its InstanceId — " +
          "GuardDuty returns no instance ARN, and none of these three components is this engine's guess",
      }
    }
    return {
      resourceType,
      arn: null,
      identifier: instanceId,
      provenance:
        "the finding's own InstanceDetails. No ARN: GuardDuty returns none for an instance and the " +
        "finding did not carry all of Partition, Region and AccountId, so this engine will not " +
        "assemble one it cannot stand behind",
    }
  }
  if (raw.AccessKeyDetails && (str(raw.AccessKeyDetails.UserName) || str(raw.AccessKeyDetails.AccessKeyId))) {
    return {
      resourceType,
      arn: null,
      identifier: str(raw.AccessKeyDetails.UserName) ?? str(raw.AccessKeyDetails.AccessKeyId),
      provenance:
        "the finding's own AccessKeyDetails. An access key is a credential, not a tagged resource — " +
        "there is no ARN to join against the tag index",
    }
  }
  return {
    resourceType,
    arn: null,
    identifier: null,
    provenance: resourceType
      ? `the finding names a ${resourceType} this engine does not extract an identifier from`
      : "the finding's Resource block names no resource type",
  }
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
  whatHasNoArn: string,
): GuardDutyAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return { kind: "unknown", why: whatHasNoArn }
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

/**
 * One raw finding, read.
 *
 * `Id` and `Type` are required: a finding with neither cannot be looked up in
 * the GuardDuty console and cannot be searched for, and inventing a placeholder
 * for either would put a row on a page that leads nowhere. It throws, inside
 * `readAws`, so the batch becomes ERROR naming the field.
 */
function readFinding(
  raw: RawFinding,
  detectorId: string,
  identity: AwsRead<Identity>,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): GuardDutyFinding {
  const id = str(raw.Id)
  const type = str(raw.Type)
  if (!id || !type) {
    throw new Error(
      `guardduty:GetFindings returned a finding without ${!id ? "an Id" : "a Type"} ` +
        `(id=${JSON.stringify(raw.Id)}, type=${JSON.stringify(raw.Type)}). A finding this engine ` +
        `cannot name is not a finding an operator can act on.`,
    )
  }
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const severity = num(raw.Severity)
  const resource = findingResource(raw.Resource, raw)
  return {
    id,
    arn: str(raw.Arn),
    detectorId: str(raw.Service?.DetectorId) ?? detectorId,
    type,
    title: str(raw.Title),
    description: str(raw.Description),
    severity,
    band: severityBand(severity),
    accountId: str(raw.AccountId) ?? (identityResolved ? identity.value.accountId : null),
    // AWS's own answer first; the resolved identity second; a literal never.
    region: str(raw.Region) ?? (identityResolved ? identity.value.region : null),
    partition: str(raw.Partition) ?? (identityResolved ? identity.value.partition : null),
    resource,
    firstSeen: str(raw.Service?.EventFirstSeen),
    lastSeen: str(raw.Service?.EventLastSeen),
    createdAt: str(raw.CreatedAt),
    updatedAt: str(raw.UpdatedAt),
    occurrences: num(raw.Service?.Count),
    archived: bool(raw.Service?.Archived),
    serviceName: str(raw.Service?.ServiceName),
    featureName: str(raw.Service?.FeatureName),
    attribution: attributionFor(
      resource.arn,
      tagged,
      index,
      `this finding names no resource ARN to join against the tag index — ${resource.provenance}. ` +
        `Unattributed would be a claim about its tags; this is a claim about ours.`,
    ),
  }
}

/**
 * Worst first, then most recently seen, then by id.
 *
 * The last tiebreak compares with `<` and `>` rather than `localeCompare`, which
 * is locale-dependent and would order the same two findings differently on two
 * machines.
 */
export function rankFindings(findings: readonly GuardDutyFinding[]): readonly GuardDutyFinding[] {
  return findings.slice().sort((a, b) => {
    const byBand = SEVERITY_ORDER[a.band] - SEVERITY_ORDER[b.band]
    if (byBand !== 0) return byBand
    const bySeverity = (b.severity ?? 0) - (a.severity ?? 0)
    if (bySeverity !== 0) return bySeverity
    const aSeen = a.lastSeen ?? ""
    const bSeen = b.lastSeen ?? ""
    if (aSeen !== bSeen) return aSeen < bSeen ? 1 : -1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Counts per band, worst first, and only for bands that actually occur. */
export function countBySeverity(findings: readonly GuardDutyFinding[]): readonly SeverityCount[] {
  const counts = new Map<SeverityBand, number>()
  for (const finding of findings) {
    counts.set(finding.band, (counts.get(finding.band) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([band, count]) => ({ band, count }))
    .sort((a, b) => SEVERITY_ORDER[a.band] - SEVERITY_ORDER[b.band])
}

/* --------------------------------------------------------------- reading -- */

async function listDetectors(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<{ read: AwsRead<readonly string[]>; bound: PageBound }> {
  let bound: PageBound = { kind: "complete", read: 0 }
  const read = await readAws<readonly string[]>(
    "guardduty:ListDetectors",
    async () => {
      const ids: string[] = []
      let token: string | undefined
      let page = 0
      for (; page < MAX_DETECTOR_PAGES; page += 1) {
        const response = (await gw.call("guardduty:ListDetectors", {
          NextToken: token,
        })) as ListDetectorsResponse
        for (const id of response?.DetectorIds ?? []) {
          if (typeof id === "string" && id) ids.push(id)
        }
        token = response?.NextToken || undefined
        if (!token) break
      }
      bound =
        token === undefined
          ? { kind: "complete", read: ids.length }
          : {
              kind: "capped",
              read: ids.length,
              cap: MAX_DETECTOR_PAGES,
              why:
                `guardduty:ListDetectors still had pages after ${MAX_DETECTOR_PAGES}. ` +
                `${ids.length} detector(s) were read and THERE WERE MORE — this list is not the region.`,
            }
      // Sorted so two loads of the same account produce the same order. The API
      // promises none, and an order that changes between renders makes a diff of
      // two screenshots unreadable.
      return ids.sort()
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
  return { read, bound }
}

async function listFindingIds(
  gw: AwsGateway,
  detectorId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<{ read: AwsRead<readonly string[]>; bound: PageBound }> {
  let bound: PageBound = { kind: "complete", read: 0 }
  const read = await readAws<readonly string[]>(
    "guardduty:ListFindings",
    async () => {
      const ids: string[] = []
      let token: string | undefined
      let capped = false
      for (let page = 0; page < MAX_FINDING_PAGES; page += 1) {
        const response = (await gw.call("guardduty:ListFindings", {
          DetectorId: detectorId,
          NextToken: token,
        })) as ListFindingsResponse
        for (const id of response?.FindingIds ?? []) {
          if (typeof id === "string" && id) ids.push(id)
        }
        token = response?.NextToken || undefined
        if (ids.length >= MAX_FINDINGS_PER_DETECTOR) {
          capped = true
          break
        }
        if (!token) break
        if (page === MAX_FINDING_PAGES - 1) capped = true
      }
      bound = capped
        ? {
            kind: "capped",
            read: Math.min(ids.length, MAX_FINDINGS_PER_DETECTOR),
            cap: MAX_FINDINGS_PER_DETECTOR,
            why:
              `detector ${detectorId} has more findings than this engine reads in one load. ` +
              `${Math.min(ids.length, MAX_FINDINGS_PER_DETECTOR)} were taken, ranked by severity, and ` +
              `THERE WERE MORE — this is not the detector's whole finding set.`,
          }
        : { kind: "complete", read: ids.length }
      // Capped rather than truncated silently: the ids beyond the cap are not
      // read, and `bound` is the sentence that says so.
      return ids.slice(0, MAX_FINDINGS_PER_DETECTOR).sort()
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
  return { read, bound }
}

async function getFindings(
  gw: AwsGateway,
  detectorId: string,
  ids: readonly string[],
  context: {
    identity: AwsRead<Identity>
    tagged: AwsRead<readonly TaggedResource[]>
    index: Map<string, Readonly<Record<string, string>>>
  },
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly GuardDutyFinding[]>> {
  return readAws<readonly GuardDutyFinding[]>(
    "guardduty:GetFindings",
    async () => {
      const findings: GuardDutyFinding[] = []
      for (let start = 0; start < ids.length; start += GET_FINDINGS_BATCH) {
        const batch = ids.slice(start, start + GET_FINDINGS_BATCH)
        const response = (await gw.call("guardduty:GetFindings", {
          DetectorId: detectorId,
          FindingIds: batch,
        })) as GetFindingsResponse
        for (const raw of response?.Findings ?? []) {
          findings.push(readFinding(raw, detectorId, context.identity, context.tagged, context.index))
        }
      }
      return rankFindings(findings)
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/* ------------------------------------------------------------ the surface -- */

/**
 * Every GuardDuty detector in this region, its findings ranked by severity, and
 * whether anything is watching this account at all.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function guardDutyReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<GuardDutyReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const { read: listed, bound: detectorPages } = await listDetectors(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    detectors: CAPABILITIES["guardduty:ListDetectors"].refreshMs,
    findingIds: CAPABILITIES["guardduty:ListFindings"].refreshMs,
    findings: CAPABILITIES["guardduty:GetFindings"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<DetectorReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const detectors: AwsRead<readonly DetectorReading[]> = listed
    return {
      identity,
      tagged,
      detectors,
      detectorPages,
      posture: postureOf(detectors, asOf),
      asOf,
      refreshMs,
    }
  }

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const readings: DetectorReading[] = []

  for (let position = 0; position < listed.value.length; position += 1) {
    const detectorId = listed.value[position]
    const arn = identityResolved
      ? `arn:${identity.value.partition}:guardduty:${identity.value.region}:` +
        `${identity.value.accountId}:detector/${detectorId}`
      : null
    const arnProvenance = arn
      ? "assembled from the resolved identity's partition, region and account — guardduty:ListDetectors " +
        "returns ids only, and every component here is STS's answer rather than a literal"
      : "none — identity is unresolved, and this engine will not assemble an ARN from a guessed " +
        "partition or region"

    let findingIds: AwsRead<readonly string[]>
    let idPages: PageBound
    let findings: AwsRead<readonly GuardDutyFinding[]>
    let unhydrated: readonly string[] = []

    if (position >= MAX_DETECTOR_FINDING_READS) {
      const why =
        `this engine reads findings for at most ${MAX_DETECTOR_FINDING_READS} detectors per load ` +
        `and this is detector ${position + 1} of ${listed.value.length}. Its findings were NOT read — ` +
        `which is not the same as its having none.`
      findingIds = { state: "UNCONFIGURED", capability: "guardduty:ListFindings", why }
      idPages = { kind: "capped", read: 0, cap: MAX_DETECTOR_FINDING_READS, why }
      findings = { state: "UNCONFIGURED", capability: "guardduty:GetFindings", why }
    } else {
      const listedIds = await listFindingIds(gw, detectorId, { now, denial })
      findingIds = listedIds.read
      idPages = listedIds.bound

      if (findingIds.state === "EMPTY") {
        // ListFindings answered and this detector holds no findings. GetFindings
        // is not called because there is nothing to hydrate, and EMPTY is the
        // same answer it would give. Note that this is where a naive reader
        // would print "clear" — `posture` and `describeDetector` do not.
        findings = { state: "EMPTY", capability: "guardduty:GetFindings", asOf }
      } else if (findingIds.state !== "ACTUAL" && findingIds.state !== "STALE") {
        // The ids were not read, so the findings were not either — and this is
        // reported under guardduty:GetFindings' OWN capability with a `why` that
        // names the upstream state, rather than under ListFindings' action.
        findings = {
          state: "UNCONFIGURED",
          capability: "guardduty:GetFindings",
          why:
            `the finding ids were not read, so there is nothing to fetch — ` +
            `${describeRead(findingIds, `detector ${detectorId}'s finding ids`)}`,
        }
      } else {
        const ids = findingIds.value
        findings = await getFindings(gw, detectorId, ids, { identity, tagged, index }, { now, denial })
        if (findings.state === "ACTUAL" || findings.state === "STALE") {
          const returned = new Set(findings.value.map((f) => f.id))
          unhydrated = ids.filter((id) => !returned.has(id))
        }
      }
    }

    readings.push({
      detectorId,
      arn,
      arnProvenance,
      partition: identityResolved ? identity.value.partition : null,
      region: identityResolved ? identity.value.region : null,
      accountId: identityResolved ? identity.value.accountId : null,
      attribution: attributionFor(
        arn,
        tagged,
        index,
        "this detector has no ARN this engine can state, because identity is unresolved, so it " +
          "cannot be joined against the tag index",
      ),
      configuration: DETECTOR_CONFIGURATION_NOT_READABLE,
      findingIds,
      idPages,
      findings,
      unhydrated,
      refreshMs: refreshMs.findings,
      asOf,
    })
  }

  const detectors: AwsRead<readonly DetectorReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    detectors,
    detectorPages,
    posture: postureOf(detectors, asOf),
    asOf,
    refreshMs,
  }
}

/* --------------------------------------------------------------- posture -- */

/**
 * The top-line answer.
 *
 * Exported and pure, so the derivation can be reasoned about on its own — but
 * `guardDutyReadings` is the only production caller and the tests drive it
 * through there.
 */
export function postureOf(
  detectors: AwsRead<readonly DetectorReading[]>,
  asOf: string,
): GuardDutyPosture {
  if (detectors.state === "EMPTY") {
    return {
      kind: "not-enabled",
      remedy: GUARDDUTY_NOT_ENABLED_REMEDY,
      cost: GUARDDUTY_COST_NOTE,
      asOf,
    }
  }
  if (detectors.state !== "ACTUAL" && detectors.state !== "STALE") {
    return { kind: "unknown", why: describeRead(detectors, "the GuardDuty detector listing") }
  }

  const readings = detectors.value
  const all: GuardDutyFinding[] = []
  const unreadable: string[] = []
  for (const detector of readings) {
    if (detector.findings.state === "ACTUAL" || detector.findings.state === "STALE") {
      all.push(...detector.findings.value)
      continue
    }
    if (detector.findings.state === "EMPTY") continue
    unreadable.push(detector.detectorId)
  }

  return {
    kind: "detectors-present",
    detectorIds: readings.map((d) => d.detectorId),
    severityCounts: countBySeverity(all),
    totalFindings: all.length,
    unreadable,
    caveat: STATUS_UNVERIFIED_CAVEAT,
    asOf,
  }
}

/* --------------------------------------------------------------- coverage -- */

/**
 * This reader as a security-page control row.
 *
 * Shaped to slot into `ControlRow` in `src/app/platform/security/posture.ts`
 * under the key `guardduty::detectors`, which is the placeholder that file
 * already declares and merges live rows over. The literals here are exactly its
 * `ControlState` values — the type is not IMPORTED, because `lib/aws` must not
 * depend on a page, and duplicating the union would be a second definition to
 * keep in step. The surface agent maps this object; it does not re-derive it.
 *
 * `CHECKING` is unreachable, on purpose and not by oversight. Coverage means
 * "this control is running and we can see that it is", and the second half needs
 * `guardduty:GetDetector`. `PARTIAL` is the honest ceiling until that capability
 * exists.
 */
export interface GuardDutyCoverage {
  key: "guardduty::detectors"
  question: "unwatched"
  control: "GuardDuty detector state"
  state: "NOT_CHECKING" | "UNREADABLE" | "PARTIAL"
  answers: string
  detail: string
  remedy: string
  action: string
  minimumStatement?: string
}

export function guardDutyCoverage(readings: GuardDutyReadings): GuardDutyCoverage {
  const base = {
    key: "guardduty::detectors" as const,
    question: "unwatched" as const,
    control: "GuardDuty detector state" as const,
    answers:
      "whether a detector exists in this region and what it has found — read directly, not through " +
      "Security Hub, because a disabled detector aggregates as a product with no findings",
    action: "guardduty:ListDetectors",
  }

  switch (readings.posture.kind) {
    case "not-enabled":
      return {
        ...base,
        state: "NOT_CHECKING",
        detail:
          "guardduty:ListDetectors answered, and there is NO detector in this region. Nothing is " +
          "analysing this account for a compromise, and every empty finding list on this console is " +
          "explained by that rather than by a quiet account.",
        remedy: `${GUARDDUTY_NOT_ENABLED_REMEDY} ${GUARDDUTY_COST_NOTE}`,
      }
    case "unknown":
      return {
        ...base,
        state: "UNREADABLE",
        detail: readings.posture.why,
        remedy:
          "Grant this engine's role the minimum statement below and reload. Until then this page " +
          "cannot say whether anything is watching, which is not the same as nothing being wrong.",
        ...(readings.detectors.state === "DENIED"
          ? { action: readings.detectors.action, minimumStatement: readings.detectors.minimumStatement }
          : {}),
      }
    case "detectors-present":
      return {
        ...base,
        state: "PARTIAL",
        detail:
          `${readings.posture.detectorIds.length} detector(s) exist and ` +
          `${readings.posture.totalFindings} finding(s) were read, but ${STATUS_UNVERIFIED_CAVEAT}`,
        remedy:
          "Add guardduty:GetDetector to this engine's capability registry and to its role, so a " +
          "SUSPENDED detector is distinguishable here from a running one. Until then, confirm the " +
          "detector's status in the GuardDuty console.",
      }
  }
}

/* -------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for a page bound. One place, so it cannot drift. */
export function describePageBound(bound: PageBound): string {
  return bound.kind === "complete"
    ? `${bound.read} read, and that is all of them`
    : `${bound.read} read — THERE WERE MORE. ${bound.why}`
}

/** The sentence a surface prints for a detector's configuration. */
export function describeDetectorConfiguration(configuration: DetectorConfiguration): string {
  return (
    `status and configuration NOT READABLE — needs ${configuration.needs}. ` +
    `${configuration.why} Unknown: ${configuration.unknown.join("; ")}.`
  )
}

/** The sentence a surface prints for one attribution. */
export function describeGuardDutyAttribution(attribution: GuardDutyAttribution): string {
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

/**
 * The sentence a surface prints for one finding.
 *
 * The type is printed VERBATIM and first, because that string is what an
 * operator pastes into the GuardDuty documentation.
 */
export function describeFinding(finding: GuardDutyFinding): string {
  const severity =
    finding.severity === null
      ? "severity UNRANKED — AWS returned none this engine could read, so it is ranked above " +
        "critical rather than assumed to be low"
      : `severity ${finding.severity} (${finding.band})`
  const where =
    finding.region && finding.partition
      ? `${finding.region} (partition ${finding.partition})`
      : "region unknown — identity is unresolved and the finding carried none"
  const resource =
    finding.resource.identifier ?? finding.resource.arn ?? `no resource — ${finding.resource.provenance}`
  const seen =
    finding.firstSeen || finding.lastSeen
      ? `first seen ${finding.firstSeen ?? "unknown"}, last seen ${finding.lastSeen ?? "unknown"}`
      : "first and last seen not returned by AWS"
  return (
    `${finding.type} — ${severity} — ${resource}` +
    `${finding.resource.resourceType ? ` (${finding.resource.resourceType})` : ""} — ${where} — ` +
    `${describeGuardDutyAttribution(finding.attribution)} — ${seen}` +
    `${finding.occurrences === null ? "" : `, ${finding.occurrences} occurrence(s)`}` +
    `${finding.archived === true ? ", ARCHIVED" : ""}`
  )
}

/** The sentence a surface prints for one detector. One funnel, so states cannot drift. */
export function describeDetector(detector: DetectorReading): string {
  const where =
    detector.region && detector.partition
      ? `${detector.region} (partition ${detector.partition})`
      : "region unknown — identity is unresolved"
  const head =
    `detector ${detector.detectorId} — ${where} — ` +
    `${describeGuardDutyAttribution(detector.attribution)} — ` +
    `${describeDetectorConfiguration(detector.configuration)}`

  if (detector.findings.state === "ACTUAL" || detector.findings.state === "STALE") {
    const counts = countBySeverity(detector.findings.value)
      .map((c) => `${c.count} ${c.band}`)
      .join(", ")
    const unhydrated =
      detector.unhydrated.length === 0
        ? ""
        : ` ${detector.unhydrated.length} listed finding(s) were not returned by GetFindings and are ` +
          `NOT counted: ${detector.unhydrated.join(", ")}.`
    return (
      `${head} — ${detector.findings.value.length} finding(s): ${counts}. ` +
      `Ids: ${describePageBound(detector.idPages)}.${unhydrated} ` +
      `As of ${detector.asOf}, refreshed every ${Math.round(detector.refreshMs / 1000)}s.`
    )
  }
  if (detector.findings.state === "EMPTY") {
    // The dangerous case, and the reason this module exists: zero findings from
    // a detector whose status could not be read. The caveat is not optional and
    // is not a footnote — it is in the same sentence as the zero.
    return (
      `${head} — NO findings were returned. This is NOT a clean bill of health: ` +
      `${STATUS_UNVERIFIED_CAVEAT} As of ${detector.asOf}.`
    )
  }
  // Every other state goes through the one renderer, so a refused finding read
  // reads as a refusal here exactly as it does everywhere else.
  return `${head} — ${describeRead(detector.findings, `detector ${detector.detectorId}'s findings`)}`
}

/** The sentence a surface prints for the top-line answer. */
export function describeGuardDutyPosture(posture: GuardDutyPosture): string {
  switch (posture.kind) {
    case "unknown":
      return `unknown — ${posture.why}`
    case "not-enabled":
      return (
        `NOTHING IS WATCHING — guardduty:ListDetectors answered and there is no GuardDuty detector ` +
        `in this region, as of ${posture.asOf}. An empty finding list from this account is explained ` +
        `by that, not by the account being quiet. Remedy: ${posture.remedy} Cost: ${posture.cost}`
      )
    case "detectors-present": {
      const counts =
        posture.severityCounts.length === 0
          ? "no findings were returned"
          : posture.severityCounts.map((c) => `${c.count} ${c.band}`).join(", ")
      const unreadable =
        posture.unreadable.length === 0
          ? ""
          : ` ${posture.unreadable.length} detector(s) could not be read at all ` +
            `(${posture.unreadable.join(", ")}), so this count is a floor.`
      return (
        `${posture.detectorIds.length} detector(s) exist — ${counts} — as of ${posture.asOf}. ` +
        `QUALIFIED: ${posture.caveat}${unreadable}`
      )
    }
  }
}

export interface GuardDutyLine {
  label: string
  text: string
}

/**
 * What a GuardDuty surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function guardDutyLines(readings: GuardDutyReadings): readonly GuardDutyLine[] {
  const lines: GuardDutyLine[] = [
    { label: "Threat detection", text: describeGuardDutyPosture(readings.posture) },
    {
      label: "Detectors",
      text:
        readings.detectors.state === "ACTUAL" || readings.detectors.state === "STALE"
          ? `${describeRead(readings.detectors, `${readings.detectors.value.length} detector(s)`)} · ` +
            `${describePageBound(readings.detectorPages)}`
          : describeRead(readings.detectors, "the GuardDuty detector listing"),
    },
    {
      label: "Coverage",
      text: (() => {
        const coverage = guardDutyCoverage(readings)
        return `${coverage.state} — ${coverage.detail} Remedy: ${coverage.remedy}`
      })(),
    },
  ]

  if (readings.detectors.state === "ACTUAL" || readings.detectors.state === "STALE") {
    for (const detector of readings.detectors.value) {
      lines.push({ label: `Detector ${detector.detectorId}`, text: describeDetector(detector) })
      if (detector.findings.state === "ACTUAL" || detector.findings.state === "STALE") {
        for (const finding of detector.findings.value) {
          lines.push({ label: `Finding ${finding.id}`, text: describeFinding(finding) })
        }
      }
    }
  }

  lines.push({
    label: "Read at",
    text:
      `${readings.asOf} · detectors refreshed every ` +
      `${Math.round(readings.refreshMs.detectors / 1000)}s, findings every ` +
      `${Math.round(readings.refreshMs.findings / 1000)}s`,
  })
  return lines
}
