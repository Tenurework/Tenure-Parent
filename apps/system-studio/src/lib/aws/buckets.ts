/**
 * STUDIO-070-004 (S3) — the buckets the estate owns, and whether any of them is
 * open to the internet.
 *
 * `infrastructure/terraform/s3.tf` creates two buckets and sets, between them, a
 * four-flag public-access block, KMS default encryption, versioning, two
 * lifecycle configurations and a CORS rule whose `allowed_origins` is `["*"]`
 * with a comment saying "Restrict to tenurework.com domain post-pilot". Not one
 * of those facts was ever read back. The registry held seven S3 posture
 * capabilities and no module called any of them, so the posture Terraform
 * DECLARES and the posture the account HOLDS had never been compared — and the
 * drift that matters is somebody clearing a public-access block in the console
 * at 2am, which would have surfaced nowhere at all.
 *
 * This module is the read-back. It renders nothing.
 *
 * ## Seven capabilities, seven readings, on purpose
 *
 * `s3:ListAllMyBuckets` is one account-wide action. The other six authorize
 * PER BUCKET, under six different IAM action names, three of which are spelled
 * differently from the API that needs them (`GetBucketEncryption` authorizes
 * under `s3:GetEncryptionConfiguration`, `GetBucketLifecycleConfiguration` under
 * `s3:GetLifecycleConfiguration`, `GetBucketCors` under `s3:GetBucketCORS`). A
 * role routinely holds some and not others, and a bucket in another region, or
 * one whose policy this principal may not read, fails exactly one of the six and
 * answers the other five.
 *
 * So every FACT on every bucket is its own `AwsRead`. A denied
 * `GetBucketPolicyStatus` makes that bucket's policy status unknown and leaves
 * its encryption, versioning, lifecycle and tags real. There is no path in this
 * file from one refused sub-call to a whole row of unknowns, and — the thing
 * that actually gets people hurt — no path from a refused sub-call to a
 * reassuring default. `sqs.ts` and `retained.ts` paid for this lesson with
 * `backup:ListBackupVaults`; this module is built the way those ended up.
 *
 * ## "There is no configuration" is an ANSWER, not an error
 *
 * S3 reports several absences by raising. `GetPublicAccessBlock` raises
 * `NoSuchPublicAccessBlockConfiguration` when the bucket has no block at all —
 * which is not a failure to read, it is the READING, and it is the worst one
 * this module can return. `GetBucketTagging` raises `NoSuchTagSet`,
 * `GetBucketLifecycleConfiguration` raises `NoSuchLifecycleConfiguration`,
 * `GetBucketPolicyStatus` raises `NoSuchBucketPolicy`, `GetBucketCors` raises
 * `NoSuchCORSConfiguration` and `GetBucketEncryption` raises
 * `ServerSideEncryptionConfigurationNotFoundError`, all for the same reason:
 * there is nothing configured.
 *
 * Each is caught INSIDE the call and turned into a definite fact, because
 * letting it reach `readAws` would classify it as ERROR — a red box — and a red
 * box next to "public access block" reads as "we could not check", which is the
 * exact opposite of "there is no public access block on this bucket".
 *
 * ## Region, and what this engine honestly cannot say
 *
 * A bucket's region comes from `Bucket.BucketRegion` on the `ListBuckets`
 * response and from nowhere else. S3 returns that field only when the request
 * carries at least one parameter, and `client.ts` sends `ContinuationToken`
 * alone — which is absent on the first page. There is no `s3:GetBucketLocation`
 * capability in the registry and this module does not get to add one.
 *
 * So a bucket whose region AWS did not state carries `{ kind: "unstated" }` with
 * that sentence in it. It does NOT inherit the caller's region. Filling it in
 * from the resolved identity would be the GE-010-007 defect exactly: a
 * data-residency page confidently placing a bucket in a region nobody read.
 *
 * ## Attribution, and why S3 differs from SQS here
 *
 * Through `tags.ts` and the Resource Groups Tagging API, like every other
 * module. With one deliberate difference: the Tagging API answers for ONE region
 * and an S3 bucket ARN carries no region, so "this ARN is not in the tag index"
 * does not mean "this bucket has no tags" the way it does for a queue — it means
 * that, or it means the bucket lives elsewhere. This module therefore falls back
 * to the bucket's OWN `GetBucketTagging` answer before it will say
 * `unattributed`, and says `unknown` when neither source could be read. Each
 * reading carries `attributionSource`, so where the answer came from is on the
 * record rather than inferred.
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  errorName,
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
 * How many `ListBuckets` pages to walk before stopping.
 *
 * A page is up to 10,000 buckets, so this is a bound rather than a limit anybody
 * meets. It exists because an unbounded page loop in a server render with a
 * person waiting is how one agent takes down the console, and because a token
 * that never clears is a real failure mode of a paginated API.
 *
 * Hitting it does NOT throw and does NOT render as a complete estate: the
 * listing carries a `truncated` arm naming how far it got. "There were more" is
 * a fact a surface has to print, not an exception that erases the buckets that
 * were read.
 */
export const MAX_LIST_PAGES = 20

/**
 * How many buckets get a posture read in one load.
 *
 * Six calls per bucket against an account-wide S3 throttle shared with the
 * running product. The estate has two buckets; the cap exists so an account that
 * has grown four hundred does not turn one page render into 2,400 API calls.
 *
 * Buckets past the cap are NOT dropped and NOT rendered as compliant: every one
 * of their facts is UNCONFIGURED with a `why` saying the engine stopped, which
 * is a visibly different sentence from "this bucket is blocked".
 */
export const MAX_POSTURE_BUCKETS = 100

/** How many buckets are read at once. Bounded so one load is not a burst. */
const POSTURE_CONCURRENCY = 4

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* --------------------------------------------------------- the API shapes -- */

/** Declared rather than imported — `client.ts` is the one module that holds an SDK. */
interface ListBucketsResponse {
  Buckets?: Array<{ Name?: string; CreationDate?: Date | string; BucketRegion?: string }>
  ContinuationToken?: string
}

interface PublicAccessBlockResponse {
  PublicAccessBlockConfiguration?: {
    BlockPublicAcls?: boolean
    IgnorePublicAcls?: boolean
    BlockPublicPolicy?: boolean
    RestrictPublicBuckets?: boolean
  }
}

interface EncryptionResponse {
  ServerSideEncryptionConfiguration?: {
    Rules?: Array<{
      ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: string; KMSMasterKeyID?: string }
      BucketKeyEnabled?: boolean
    }>
  }
}

interface VersioningResponse {
  Status?: string
  MFADelete?: string
}

interface LifecycleResponse {
  Rules?: Array<{
    ID?: string
    Status?: string
    Prefix?: string
    Filter?: { Prefix?: string; And?: { Prefix?: string } }
    Expiration?: { Days?: number; Date?: Date | string; ExpiredObjectDeleteMarker?: boolean }
    NoncurrentVersionExpiration?: { NoncurrentDays?: number }
    Transitions?: Array<{ Days?: number; Date?: Date | string; StorageClass?: string }>
    AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: number }
  }>
}

interface PolicyStatusResponse {
  PolicyStatus?: { IsPublic?: boolean }
}

interface TaggingResponse {
  TagSet?: Array<{ Key?: string; Value?: string }>
}

interface CorsResponse {
  CORSRules?: Array<{
    ID?: string
    AllowedOrigins?: string[]
    AllowedMethods?: string[]
    AllowedHeaders?: string[]
    ExposeHeaders?: string[]
    MaxAgeSeconds?: number
  }>
}

/* --------------------------------------------------------------- the facts -- */

/**
 * The four flags, as S3 names them.
 *
 * A flag AWS did not return is read as NOT set. That direction is deliberate and
 * it is the only safe one: a block this engine did not see must never render as
 * a block that is in force.
 */
export interface PublicAccessFlags {
  blockPublicAcls: boolean
  ignorePublicAcls: boolean
  blockPublicPolicy: boolean
  restrictPublicBuckets: boolean
}

export type PublicAccessBlockFact =
  /** A block exists. `allFourSet` is false when ANY of the four is off. */
  | { kind: "configured"; flags: PublicAccessFlags; allFourSet: boolean }
  /**
   * `NoSuchPublicAccessBlockConfiguration`. There is no block on this bucket —
   * an answer, and the loudest one this module returns.
   */
  | { kind: "absent"; why: string }

/** Which of the four are off, named. Empty when all four are set. */
export function publicAccessGaps(fact: PublicAccessBlockFact): readonly string[] {
  if (fact.kind === "absent") {
    return [
      "BlockPublicAcls",
      "IgnorePublicAcls",
      "BlockPublicPolicy",
      "RestrictPublicBuckets",
    ]
  }
  const gaps: string[] = []
  if (!fact.flags.blockPublicAcls) gaps.push("BlockPublicAcls")
  if (!fact.flags.ignorePublicAcls) gaps.push("IgnorePublicAcls")
  if (!fact.flags.blockPublicPolicy) gaps.push("BlockPublicPolicy")
  if (!fact.flags.restrictPublicBuckets) gaps.push("RestrictPublicBuckets")
  return gaps
}

/**
 * A bucket's default encryption.
 *
 * `sse-kms` and `sse-s3` are separate arms rather than a boolean because they
 * are separate compliance answers: SSE-S3 satisfies "encrypted at rest" and does
 * not satisfy "encrypted under a key this account controls and can revoke", and
 * `s3.tf` deliberately asks for `aws:kms` on the documents bucket and asks for
 * nothing at all on the exports bucket.
 */
export type EncryptionFact =
  | { kind: "sse-kms"; kmsKeyId: string | null; bucketKeyEnabled: boolean | null }
  | { kind: "dsse-kms"; kmsKeyId: string | null; bucketKeyEnabled: boolean | null }
  | { kind: "sse-s3" }
  /** `ServerSideEncryptionConfigurationNotFoundError`. No default encryption rule. */
  | { kind: "none"; why: string }
  /** An algorithm this module does not know. Named rather than silently ignored. */
  | { kind: "unrecognised"; algorithm: string }

export interface VersioningFact {
  /**
   * `never-enabled` is its own value rather than `null`. GetBucketVersioning
   * answers `{}` — a SUCCESSFUL empty response — for a bucket that has never had
   * versioning, which is a different fact from `Suspended` (it was on and
   * somebody turned it off) and a very different one from "we could not read it".
   */
  status: "Enabled" | "Suspended" | "never-enabled"
  /**
   * `not-stated` rather than "Disabled". S3 omits MFADelete on a bucket that has
   * never had versioning; reporting that as Disabled would be inventing an
   * observation AWS did not make.
   */
  mfaDelete: "Enabled" | "Disabled" | "not-stated"
}

export interface LifecycleRuleReading {
  id: string | null
  status: "Enabled" | "Disabled" | "unrecognised"
  /** From `Filter.Prefix`, `Filter.And.Prefix` or the legacy top-level `Prefix`. */
  prefix: string | null
  expirationDays: number | null
  expirationDate: string | null
  noncurrentVersionExpirationDays: number | null
  abortIncompleteMultipartUploadDays: number | null
  transitions: readonly { days: number | null; date: string | null; storageClass: string | null }[]
}

export type LifecycleFact =
  | { kind: "rules"; rules: readonly LifecycleRuleReading[] }
  /** `NoSuchLifecycleConfiguration`. Nothing expires; every object bills forever. */
  | { kind: "none"; why: string }

export type PolicyStatusFact =
  /** S3 itself says this bucket is public. The headline finding. */
  | { kind: "public" }
  | { kind: "not-public" }
  /** `NoSuchBucketPolicy`. No policy at all, so no policy makes it public. */
  | { kind: "no-policy"; why: string }

export type BucketTagsFact =
  | { kind: "tags"; tags: Readonly<Record<string, string>> }
  /** `NoSuchTagSet`. Definitively untagged — which is itself the attribution finding. */
  | { kind: "none"; why: string }

export interface CorsRuleReading {
  id: string | null
  allowedOrigins: readonly string[]
  allowedMethods: readonly string[]
  allowedHeaders: readonly string[]
  maxAgeSeconds: number | null
  /** True when any origin is `*`: a presigned-upload endpoint any page may call. */
  allowsAnyOrigin: boolean
}

export type CorsFact =
  | { kind: "rules"; rules: readonly CorsRuleReading[]; anyRuleAllowsAnyOrigin: boolean }
  /** `NoSuchCORSConfiguration`. No browser may call this bucket cross-origin. */
  | { kind: "none"; why: string }

/**
 * Where a bucket lives.
 *
 * Two arms, and `unstated` carries the reason rather than being null, because a
 * null region on a residency page is read as "same as everything else".
 */
export type BucketRegionFact =
  | { kind: "stated"; region: string }
  | { kind: "unstated"; why: string }

/**
 * Which tenant a bucket belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: both
 * tag sources are AWS reads and both can be denied, throttled or broken. A
 * bucket whose tags were never read must not render as "unattributable —
 * missing tenure:tenant", because that sentence sends an operator to add a tag
 * that is probably already there.
 */
export type BucketAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** One bucket, with every fact carrying its own read state. */
export interface BucketReading {
  name: string
  /**
   * `arn:PARTITION:s3:::NAME`. S3 bucket ARNs carry no region and no account —
   * that is the ARN form, not an omission. Null when identity is unresolved,
   * because half an ARN joins against the tag index and matches nothing, which
   * reads exactly like an untagged bucket.
   */
  arn: string | null
  /** The partition from the resolved identity. Never the literal "aws". */
  partition: string | null
  region: BucketRegionFact
  createdAt: string | null
  attribution: BucketAttribution
  /** Which source decided the attribution, or why neither could. Never silent. */
  attributionSource: string

  publicAccessBlock: AwsRead<PublicAccessBlockFact>
  policyStatus: AwsRead<PolicyStatusFact>
  encryption: AwsRead<EncryptionFact>
  versioning: AwsRead<VersioningFact>
  lifecycle: AwsRead<LifecycleFact>
  tags: AwsRead<BucketTagsFact>
  cors: AwsRead<CorsFact>

  /** This bucket's posture cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/** A bucket that is open, or that this engine cannot say is closed. */
export interface PublicBucketFinding {
  bucket: string
  arn: string | null
  region: BucketRegionFact
  attribution: BucketAttribution
  /** Every reason, spelled as an operator reads them. Never empty. */
  reasons: readonly string[]
  /** True when `s3:GetBucketPolicyStatus` itself answered IsPublic. The loudest. */
  policySaysPublic: boolean
  asOf: string
}

/**
 * Whether anything in this estate is open to the internet.
 *
 * Lifted out of the bucket table for the same reason `DeadLetterState` is: it is
 * the one S3 fact that is an incident rather than a row. Every arm is careful
 * about what it claims — `none-observed` carries the buckets it could NOT fully
 * read, so it never quietly means "closed as far as we bothered to look".
 */
export type PublicExposureState =
  /** The bucket listing itself was not readable, so nothing can be said. */
  | { kind: "unknown"; why: string }
  /** At least one bucket is open, or has a block flag off. This is the alarm. */
  | {
      kind: "exposed"
      buckets: readonly PublicBucketFinding[]
      /** Buckets where an exposure fact could not be read. Named, so nothing is hidden. */
      partiallyUnread: readonly string[]
    }
  /** Nothing that answered is public. Qualified by what did not answer. */
  | {
      kind: "none-observed"
      bucketsRead: number
      partiallyUnread: readonly string[]
    }

/** How far the bucket listing got. `truncated` is the "there were more" signal. */
export type BucketListTruncation =
  | { kind: "complete"; bucketsListed: number; pagesRead: number }
  | { kind: "truncated"; bucketsListed: number; pagesRead: number; why: string }
  /** The listing was refused, throttled or broken; there is no count to give. */
  | { kind: "not-listed"; why: string }

/** Everything an S3 surface needs, in one load. */
export interface S3Readings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The buckets. DENIED here is a refused `s3:ListAllMyBuckets` and is NEVER
   * `[]` — an operator reading "no buckets" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  buckets: AwsRead<readonly BucketReading[]>
  publicExposure: PublicExposureState
  listing: BucketListTruncation
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { buckets: number; posture: number }
}

/* -------------------------------------------------- "nothing is configured" -- */

/**
 * The S3 error codes that mean "there is no such configuration".
 *
 * Matched through `errorName`, the same extraction `read.ts` uses to classify a
 * denial, plus the XML `Code` field, because S3's REST-XML errors surface the
 * code on `name` in the modelled path and on `Code` in the raw one and this
 * module must not depend on which.
 */
const ABSENT_CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  "NoSuchPublicAccessBlockConfiguration",
  "ServerSideEncryptionConfigurationNotFoundError",
  "NoSuchLifecycleConfiguration",
  "NoSuchBucketPolicy",
  "NoSuchTagSet",
  "NoSuchCORSConfiguration",
])

/** The error's S3 code, from either place the SDK can put it. */
export function s3ErrorCode(error: unknown): string {
  const named = errorName(error)
  if (named !== "UnknownError") return named
  const code = (error as { Code?: unknown } | null)?.Code
  return typeof code === "string" && code ? code : named
}

/** Whether this error is S3 saying "there is none", rather than "you may not look". */
export function isAbsentConfiguration(error: unknown, expected: string): boolean {
  const code = s3ErrorCode(error)
  return code === expected && ABSENT_CONFIGURATION_CODES.has(code)
}

/* -------------------------------------------------------------- the reads -- */

interface Ctx {
  now: () => Date
  denial: DenialContext
}

/** One bucket as `ListBuckets` returned it, before any posture call. */
interface BucketEntry {
  name: string
  createdAt: string | null
  region: BucketRegionFact
}

/** What the listing produced: the buckets, and whether there were more. */
interface BucketListing {
  entries: readonly BucketEntry[]
  truncation: BucketListTruncation
}

const REGION_UNSTATED: BucketRegionFact = {
  kind: "unstated",
  why:
    "s3:ListBuckets returns BucketRegion only when the request carries a parameter, and this " +
    "engine's first page carries none. No s3:GetBucketLocation capability exists in the registry, " +
    "so this bucket's region is unknown — it is NOT the region this console is running in.",
}

async function listBuckets(gw: AwsGateway, ctx: Ctx): Promise<AwsRead<BucketListing>> {
  return readAws<BucketListing>(
    "s3:ListBuckets",
    async () => {
      const entries: BucketEntry[] = []
      let token: string | undefined
      let pagesRead = 0
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const response = (await gw.call("s3:ListBuckets", {
          ContinuationToken: token,
        })) as ListBucketsResponse
        pagesRead += 1
        for (const bucket of response?.Buckets ?? []) {
          if (typeof bucket?.Name !== "string" || !bucket.Name) continue
          entries.push({
            name: bucket.Name,
            createdAt: isoOrNull(bucket.CreationDate),
            // AWS's own answer, or an explicit unknown. Never the caller's region.
            region:
              typeof bucket.BucketRegion === "string" && bucket.BucketRegion
                ? { kind: "stated", region: bucket.BucketRegion }
                : REGION_UNSTATED,
          })
        }
        token = response?.ContinuationToken || undefined
        if (!token) {
          return {
            entries: sortByName(entries),
            truncation: { kind: "complete", bucketsListed: entries.length, pagesRead },
          }
        }
      }
      // The cap. The buckets that WERE read are kept — erasing them would be a
      // second lie on top of the first — and the truncation says there are more,
      // loudly enough that a surface cannot render this as the whole estate.
      return {
        entries: sortByName(entries),
        truncation: {
          kind: "truncated",
          bucketsListed: entries.length,
          pagesRead,
          why:
            `s3:ListBuckets still had pages after ${MAX_LIST_PAGES}. These ${entries.length} ` +
            `bucket(s) are real and this list is NOT the estate — buckets beyond the cap were ` +
            `never read and nothing here says anything about them.`,
        },
      }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // EMPTY means "the account has no buckets", which is the entries array
      // being empty — not the wrapper object, which never is.
      isEmpty: (value) => (value as BucketListing).entries.length === 0,
      ...RETRY,
    },
  )
}

function sortByName(entries: BucketEntry[]): readonly BucketEntry[] {
  // Sorted so two loads of the same estate render in the same order. ListBuckets
  // does not promise one, and an order that changes between renders makes a diff
  // of two screenshots unreadable. `localeCompare` is deliberately not used: it
  // is locale-dependent, and this ordering must be identical on every machine.
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function isoOrNull(value: Date | string | undefined): string | null {
  if (value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readPublicAccessBlock(
  gw: AwsGateway,
  bucket: string,
  ctx: Ctx,
): Promise<AwsRead<PublicAccessBlockFact>> {
  return readAws<PublicAccessBlockFact>(
    "s3:GetBucketPublicAccessBlock",
    async () => {
      let response: PublicAccessBlockResponse
      try {
        response = (await gw.call("s3:GetBucketPublicAccessBlock", {
          Bucket: bucket,
        })) as PublicAccessBlockResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "NoSuchPublicAccessBlockConfiguration")) {
          return {
            kind: "absent",
            why:
              `${bucket} has no public access block at all (S3 answered ` +
              `NoSuchPublicAccessBlockConfiguration). None of the four blocks is in force.`,
          }
        }
        throw error
      }
      const config = response?.PublicAccessBlockConfiguration
      if (!config) {
        // A 200 with no configuration in it. Not "all four are set" — that would
        // be inventing four observations out of an empty body.
        throw new Error(
          `s3:GetBucketPublicAccessBlock answered for ${bucket} with no ` +
            `PublicAccessBlockConfiguration. This engine will not read an empty body as four ` +
            `blocks being in force.`,
        )
      }
      const flags: PublicAccessFlags = {
        blockPublicAcls: config.BlockPublicAcls === true,
        ignorePublicAcls: config.IgnorePublicAcls === true,
        blockPublicPolicy: config.BlockPublicPolicy === true,
        restrictPublicBuckets: config.RestrictPublicBuckets === true,
      }
      return {
        kind: "configured",
        flags,
        allFourSet:
          flags.blockPublicAcls &&
          flags.ignorePublicAcls &&
          flags.blockPublicPolicy &&
          flags.restrictPublicBuckets,
      }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function readPolicyStatus(
  gw: AwsGateway,
  bucket: string,
  ctx: Ctx,
): Promise<AwsRead<PolicyStatusFact>> {
  return readAws<PolicyStatusFact>(
    "s3:GetBucketPolicyStatus",
    async () => {
      let response: PolicyStatusResponse
      try {
        response = (await gw.call("s3:GetBucketPolicyStatus", {
          Bucket: bucket,
        })) as PolicyStatusResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "NoSuchBucketPolicy")) {
          return {
            kind: "no-policy",
            why: `${bucket} has no bucket policy, so no policy makes it public.`,
          }
        }
        throw error
      }
      const isPublic = response?.PolicyStatus?.IsPublic
      if (typeof isPublic !== "boolean") {
        throw new Error(
          `s3:GetBucketPolicyStatus answered for ${bucket} without PolicyStatus.IsPublic. ` +
            `"Not public" is a claim and this engine will not make it from a missing field.`,
        )
      }
      return isPublic ? { kind: "public" } : { kind: "not-public" }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function readEncryption(
  gw: AwsGateway,
  bucket: string,
  ctx: Ctx,
): Promise<AwsRead<EncryptionFact>> {
  return readAws<EncryptionFact>(
    "s3:GetBucketEncryption",
    async () => {
      let response: EncryptionResponse
      try {
        response = (await gw.call("s3:GetBucketEncryption", {
          Bucket: bucket,
        })) as EncryptionResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "ServerSideEncryptionConfigurationNotFoundError")) {
          return {
            kind: "none",
            why: `${bucket} has no default encryption rule (ServerSideEncryptionConfigurationNotFoundError).`,
          }
        }
        throw error
      }
      const rule = response?.ServerSideEncryptionConfiguration?.Rules?.[0]
      const applied = rule?.ApplyServerSideEncryptionByDefault
      const algorithm = applied?.SSEAlgorithm
      if (!algorithm) {
        throw new Error(
          `s3:GetBucketEncryption answered for ${bucket} with no SSEAlgorithm. The algorithm is ` +
            `the whole reading; this engine will not guess one.`,
        )
      }
      const kmsKeyId = typeof applied?.KMSMasterKeyID === "string" ? applied.KMSMasterKeyID : null
      const bucketKeyEnabled =
        typeof rule?.BucketKeyEnabled === "boolean" ? rule.BucketKeyEnabled : null
      if (algorithm === "aws:kms") return { kind: "sse-kms", kmsKeyId, bucketKeyEnabled }
      if (algorithm === "aws:kms:dsse") return { kind: "dsse-kms", kmsKeyId, bucketKeyEnabled }
      if (algorithm === "AES256") return { kind: "sse-s3" }
      return { kind: "unrecognised", algorithm }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function readVersioning(
  gw: AwsGateway,
  bucket: string,
  ctx: Ctx,
): Promise<AwsRead<VersioningFact>> {
  return readAws<VersioningFact>(
    "s3:GetBucketVersioning",
    async () => {
      const response = (await gw.call("s3:GetBucketVersioning", {
        Bucket: bucket,
      })) as VersioningResponse
      const status =
        response?.Status === "Enabled"
          ? "Enabled"
          : response?.Status === "Suspended"
            ? "Suspended"
            : "never-enabled"
      const mfaDelete =
        response?.MFADelete === "Enabled"
          ? "Enabled"
          : response?.MFADelete === "Disabled"
            ? "Disabled"
            : "not-stated"
      return { status, mfaDelete }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // GetBucketVersioning answers `{}` — successfully — for a bucket that has
      // never had versioning, and "we looked and there is nothing" must not
      // replace the actual reading, which is "versioning has never been enabled
      // here".
      //
      // Belt and braces, stated as such: the mapping above already turns that
      // empty body into a two-field object, so `looksEmpty` would not fire today
      // and removing this line changes no test. It is here so that a future
      // mapping which passes the response through cannot reintroduce the EMPTY,
      // and it is the mapping — not this line — that the suite proves.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

function readLifecycle(
  gw: AwsGateway,
  bucket: string,
  ctx: Ctx,
): Promise<AwsRead<LifecycleFact>> {
  return readAws<LifecycleFact>(
    "s3:GetBucketLifecycleConfiguration",
    async () => {
      let response: LifecycleResponse
      try {
        response = (await gw.call("s3:GetBucketLifecycleConfiguration", {
          Bucket: bucket,
        })) as LifecycleResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "NoSuchLifecycleConfiguration")) {
          return {
            kind: "none",
            why:
              `${bucket} has no lifecycle configuration, so nothing in it ever expires and every ` +
              `object keeps billing.`,
          }
        }
        throw error
      }
      const rules: LifecycleRuleReading[] = (response?.Rules ?? []).map((rule) => ({
        id: typeof rule.ID === "string" && rule.ID ? rule.ID : null,
        status:
          rule.Status === "Enabled"
            ? "Enabled"
            : rule.Status === "Disabled"
              ? "Disabled"
              : "unrecognised",
        prefix: rule.Filter?.Prefix ?? rule.Filter?.And?.Prefix ?? rule.Prefix ?? null,
        expirationDays: numberOrNull(rule.Expiration?.Days),
        expirationDate: isoOrNull(rule.Expiration?.Date),
        noncurrentVersionExpirationDays: numberOrNull(rule.NoncurrentVersionExpiration?.NoncurrentDays),
        abortIncompleteMultipartUploadDays: numberOrNull(
          rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
        ),
        transitions: (rule.Transitions ?? []).map((transition) => ({
          days: numberOrNull(transition.Days),
          date: isoOrNull(transition.Date),
          storageClass:
            typeof transition.StorageClass === "string" ? transition.StorageClass : null,
        })),
      }))
      return { kind: "rules", rules }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function readTagging(gw: AwsGateway, bucket: string, ctx: Ctx): Promise<AwsRead<BucketTagsFact>> {
  return readAws<BucketTagsFact>(
    "s3:GetBucketTagging",
    async () => {
      let response: TaggingResponse
      try {
        response = (await gw.call("s3:GetBucketTagging", { Bucket: bucket })) as TaggingResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "NoSuchTagSet")) {
          return { kind: "none", why: `${bucket} carries no tags at all (NoSuchTagSet).` }
        }
        throw error
      }
      const tags: Record<string, string> = {}
      for (const tag of response?.TagSet ?? []) {
        if (typeof tag?.Key === "string" && tag.Key) tags[tag.Key] = tag.Value ?? ""
      }
      // An answered-but-empty TagSet is the same fact as NoSuchTagSet: untagged.
      if (Object.keys(tags).length === 0) {
        return { kind: "none", why: `${bucket} answered s3:GetBucketTagging with an empty TagSet.` }
      }
      return { kind: "tags", tags }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function readCors(gw: AwsGateway, bucket: string, ctx: Ctx): Promise<AwsRead<CorsFact>> {
  return readAws<CorsFact>(
    "s3:GetBucketCors",
    async () => {
      let response: CorsResponse
      try {
        response = (await gw.call("s3:GetBucketCors", { Bucket: bucket })) as CorsResponse
      } catch (error) {
        if (isAbsentConfiguration(error, "NoSuchCORSConfiguration")) {
          return {
            kind: "none",
            why: `${bucket} has no CORS configuration; no browser may call it cross-origin.`,
          }
        }
        throw error
      }
      const rules: CorsRuleReading[] = (response?.CORSRules ?? []).map((rule) => {
        const allowedOrigins = (rule.AllowedOrigins ?? []).filter(
          (o): o is string => typeof o === "string",
        )
        return {
          id: typeof rule.ID === "string" && rule.ID ? rule.ID : null,
          allowedOrigins,
          allowedMethods: (rule.AllowedMethods ?? []).filter(
            (m): m is string => typeof m === "string",
          ),
          allowedHeaders: (rule.AllowedHeaders ?? []).filter(
            (h): h is string => typeof h === "string",
          ),
          maxAgeSeconds: numberOrNull(rule.MaxAgeSeconds),
          allowsAnyOrigin: allowedOrigins.includes("*"),
        }
      })
      return {
        kind: "rules",
        rules,
        anyRuleAllowsAnyOrigin: rules.some((rule) => rule.allowsAnyOrigin),
      }
    },
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/* ---------------------------------------------------------- attribution -- */

/**
 * A bucket ARN. `arn:PARTITION:s3:::NAME` — no region, no account, by design of
 * the ARN form itself. Null when identity is unresolved: see `BucketReading.arn`.
 */
export function bucketArn(name: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!name) return null
  return `arn:${identity.value.partition}:s3:::${name}`
}

/**
 * Which tenant a bucket belongs to, from the tag index first and the bucket's
 * own tags second.
 *
 * The order is the instruction — attribution goes through the Resource Groups
 * Tagging API path in `tags.ts` — and the fallback is the S3 correction. The
 * Tagging API answers for ONE region; a bucket ARN carries no region; so an ARN
 * missing from the index means "untagged" OR "in another region", and only the
 * bucket's own `GetBucketTagging` can tell those apart.
 */
export function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
  ownTags: AwsRead<BucketTagsFact>,
): { attribution: BucketAttribution; source: string } {
  const indexReadable =
    tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"

  if (indexReadable && arn) {
    const tags = index.get(arn)
    if (tags !== undefined) {
      return { attribution: fromTags(tags), source: "the tag index (tag:GetResources)" }
    }
  }

  // The index did not answer for this bucket. Its own tags are the second read,
  // and they are authoritative for a bucket in any region.
  if (ownTags.state === "ACTUAL" || ownTags.state === "STALE") {
    if (ownTags.value.kind === "tags") {
      return {
        attribution: fromTags(ownTags.value.tags),
        source: "this bucket's own s3:GetBucketTagging",
      }
    }
    return {
      attribution: { kind: "unattributed" },
      source: "this bucket's own s3:GetBucketTagging, which reports no tags at all",
    }
  }

  const why = !indexReadable
    ? `the tag index was not read — ${describeRead(tagged, "the tag index")}`
    : !arn
      ? "this bucket has no ARN this engine can state (identity is unresolved), so it cannot be " +
        "joined against the tag index, and its own tags were not readable either"
      : `this bucket is absent from the tag index — which for S3 means untagged OR in another ` +
        `region — and its own tags were not readable: ${describeRead(ownTags, "its tags")}`
  return { attribution: { kind: "unknown", why }, source: `attribution unknown — ${why}` }
}

function fromTags(tags: Readonly<Record<string, string>>): BucketAttribution {
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

/* ----------------------------------------------------------- the surface -- */

/**
 * Every bucket in the account, its public-access posture, its encryption, its
 * versioning, its lifecycle and its tenant.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function bucketPosture(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<S3Readings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const ctx: Ctx = { now, denial }
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await listBuckets(gw, ctx)
  const asOf = now().toISOString()
  const refreshMs = {
    buckets: CAPABILITIES["s3:ListBuckets"].refreshMs,
    posture: CAPABILITIES["s3:GetBucketPublicAccessBlock"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<BucketReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const buckets: AwsRead<readonly BucketReading[]> = listed
    return {
      identity,
      tagged,
      buckets,
      publicExposure: publicExposureState(buckets),
      listing: { kind: "not-listed", why: describeRead(listed, "the S3 bucket listing") },
      asOf,
      refreshMs,
    }
  }

  const entries = listed.value.entries
  const readings: BucketReading[] = new Array(entries.length)
  for (let start = 0; start < entries.length; start += POSTURE_CONCURRENCY) {
    const batch = entries.slice(start, start + POSTURE_CONCURRENCY)
    const read = await Promise.all(
      batch.map((entry, offset) =>
        readOneBucket(gw, entry, start + offset, entries.length, {
          ctx,
          identity,
          tagged,
          index,
          asOf,
          refreshMs: refreshMs.posture,
        }),
      ),
    )
    for (let i = 0; i < read.length; i += 1) readings[start + i] = read[i]
  }

  const buckets: AwsRead<readonly BucketReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    buckets,
    publicExposure: publicExposureState(buckets),
    listing: listed.value.truncation,
    asOf,
    refreshMs,
  }
}

interface OneBucketContext {
  ctx: Ctx
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  index: Map<string, Readonly<Record<string, string>>>
  asOf: string
  refreshMs: number
}

/** The UNCONFIGURED fact a bucket past the posture cap gets, per capability. */
function pastCap<T>(
  capability: Parameters<typeof readAws>[0],
  bucket: string,
  position: number,
  total: number,
): AwsRead<T> {
  return {
    state: "UNCONFIGURED",
    capability,
    why:
      `this engine reads at most ${MAX_POSTURE_BUCKETS} bucket postures per load and ${bucket} is ` +
      `number ${position + 1} of ${total}. Its posture was not read — which is not the same as ` +
      `its being blocked, encrypted or private.`,
  }
}

async function readOneBucket(
  gw: AwsGateway,
  entry: BucketEntry,
  position: number,
  total: number,
  o: OneBucketContext,
): Promise<BucketReading> {
  const name = entry.name
  const arn = bucketArn(name, o.identity)
  const partition =
    o.identity.state === "ACTUAL" || o.identity.state === "STALE"
      ? o.identity.value.partition
      : null

  const beyond = position >= MAX_POSTURE_BUCKETS
  const [publicAccessBlock, policyStatus, encryption, versioning, lifecycle, tags, cors] = beyond
    ? [
        pastCap<PublicAccessBlockFact>("s3:GetBucketPublicAccessBlock", name, position, total),
        pastCap<PolicyStatusFact>("s3:GetBucketPolicyStatus", name, position, total),
        pastCap<EncryptionFact>("s3:GetBucketEncryption", name, position, total),
        pastCap<VersioningFact>("s3:GetBucketVersioning", name, position, total),
        pastCap<LifecycleFact>("s3:GetBucketLifecycleConfiguration", name, position, total),
        pastCap<BucketTagsFact>("s3:GetBucketTagging", name, position, total),
        pastCap<CorsFact>("s3:GetBucketCors", name, position, total),
      ]
    : // Six independent calls. `Promise.all` over `readAws`, which never rejects,
      // so one refusal cannot take the other five down with it.
      await Promise.all([
        readPublicAccessBlock(gw, name, o.ctx),
        readPolicyStatus(gw, name, o.ctx),
        readEncryption(gw, name, o.ctx),
        readVersioning(gw, name, o.ctx),
        readLifecycle(gw, name, o.ctx),
        readTagging(gw, name, o.ctx),
        readCors(gw, name, o.ctx),
      ])

  const attributed = attributionFor(arn, o.tagged, o.index, tags)
  return {
    name,
    arn,
    partition,
    region: entry.region,
    createdAt: entry.createdAt,
    attribution: attributed.attribution,
    attributionSource: attributed.source,
    publicAccessBlock,
    policyStatus,
    encryption,
    versioning,
    lifecycle,
    tags,
    cors,
    refreshMs: o.refreshMs,
    asOf: o.asOf,
  }
}

/* ------------------------------------------------------- public exposure -- */

/**
 * Whether anything in this estate is open.
 *
 * Exported and pure, so the derivation can be reasoned about on its own — but
 * `bucketPosture` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function publicExposureState(
  buckets: AwsRead<readonly BucketReading[]>,
): PublicExposureState {
  if (buckets.state !== "ACTUAL" && buckets.state !== "STALE") {
    return { kind: "unknown", why: describeRead(buckets, "the S3 bucket listing") }
  }

  const findings: PublicBucketFinding[] = []
  const partiallyUnread: string[] = []

  for (const bucket of buckets.value) {
    const reasons: string[] = []
    let policySaysPublic = false

    const pab = bucket.publicAccessBlock
    if (pab.state === "ACTUAL" || pab.state === "STALE") {
      const gaps = publicAccessGaps(pab.value)
      if (pab.value.kind === "absent") {
        reasons.push(
          "no public access block is configured at all — none of the four blocks is in force",
        )
      } else if (gaps.length > 0) {
        reasons.push(`public access block flags OFF: ${gaps.join(", ")}`)
      }
    } else {
      // Not readable. It contributes NO reason and it does NOT contribute a
      // clean bill either: the bucket is named as partially unread, which is
      // what stops "none observed" from meaning "none".
      partiallyUnread.push(bucket.name)
    }

    const status = bucket.policyStatus
    if (status.state === "ACTUAL" || status.state === "STALE") {
      if (status.value.kind === "public") {
        policySaysPublic = true
        reasons.push("s3:GetBucketPolicyStatus reports this bucket as PUBLIC")
      }
    } else if (!partiallyUnread.includes(bucket.name)) {
      partiallyUnread.push(bucket.name)
    }

    if (reasons.length > 0) {
      findings.push({
        bucket: bucket.name,
        arn: bucket.arn,
        region: bucket.region,
        attribution: bucket.attribution,
        reasons,
        policySaysPublic,
        asOf: bucket.asOf,
      })
    }
  }

  if (findings.length > 0) {
    return { kind: "exposed", buckets: findings, partiallyUnread }
  }
  return { kind: "none-observed", bucketsRead: buckets.value.length, partiallyUnread }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one bucket's attribution. */
export function describeBucketAttribution(attribution: BucketAttribution): string {
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

/** The sentence a surface prints for a bucket's region. Never a silent default. */
export function describeBucketRegion(region: BucketRegionFact): string {
  return region.kind === "stated" ? region.region : `region unknown — ${region.why}`
}

/**
 * The sentence a surface prints for a bucket's public-access posture.
 *
 * Every non-readable state goes through `describeRead`, so a refused block read
 * says "unknown … refused s3:GetBucketPublicAccessBlock" here exactly as it does
 * everywhere else — and never "blocked".
 */
export function describePublicAccessBlock(read: AwsRead<PublicAccessBlockFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the public access block")
  }
  if (read.value.kind === "absent") return `NO PUBLIC ACCESS BLOCK — ${read.value.why}`
  const gaps = publicAccessGaps(read.value)
  return gaps.length === 0
    ? "all four public access blocks are set"
    : `PUBLIC ACCESS BLOCK INCOMPLETE — off: ${gaps.join(", ")}`
}

/** The sentence a surface prints for a bucket's default encryption. */
export function describeEncryption(read: AwsRead<EncryptionFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "default encryption")
  }
  switch (read.value.kind) {
    case "sse-kms":
      return `SSE-KMS${read.value.kmsKeyId ? ` under ${read.value.kmsKeyId}` : " under the AWS-managed S3 key"}`
    case "dsse-kms":
      return `DSSE-KMS${read.value.kmsKeyId ? ` under ${read.value.kmsKeyId}` : ""}`
    case "sse-s3":
      return "SSE-S3 (AES256) — encrypted, but not under a key this account controls"
    case "none":
      return `NO DEFAULT ENCRYPTION — ${read.value.why}`
    case "unrecognised":
      return `encryption algorithm not recognised by this engine: ${read.value.algorithm}`
  }
}

/** The sentence a surface prints for versioning and MFA-delete. */
export function describeVersioning(read: AwsRead<VersioningFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "versioning")
  }
  const { status, mfaDelete } = read.value
  const head =
    status === "Enabled"
      ? "versioning enabled"
      : status === "Suspended"
        ? "VERSIONING SUSPENDED — a deletion is no longer recoverable"
        : "VERSIONING NEVER ENABLED — a deletion is not recoverable"
  const mfa =
    mfaDelete === "Enabled"
      ? "MFA-delete enabled"
      : mfaDelete === "Disabled"
        ? "MFA-delete disabled"
        : "MFA-delete not stated by S3"
  return `${head}, ${mfa}`
}

/** The sentence a surface prints for a bucket's lifecycle configuration. */
export function describeLifecycle(read: AwsRead<LifecycleFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the lifecycle configuration")
  }
  if (read.value.kind === "none") return `no lifecycle rules — ${read.value.why}`
  if (read.value.rules.length === 0) {
    return "a lifecycle configuration exists with no rules in it — nothing expires"
  }
  return read.value.rules
    .map((rule) => {
      const parts = [
        `${rule.id ?? "(unnamed rule)"} ${rule.status}`,
        rule.prefix ? `prefix ${rule.prefix}` : "whole bucket",
      ]
      if (rule.expirationDays !== null) parts.push(`expires after ${rule.expirationDays}d`)
      if (rule.expirationDate) parts.push(`expires on ${rule.expirationDate}`)
      if (rule.noncurrentVersionExpirationDays !== null) {
        parts.push(`noncurrent versions after ${rule.noncurrentVersionExpirationDays}d`)
      }
      for (const transition of rule.transitions) {
        parts.push(
          `to ${transition.storageClass ?? "an unnamed class"}` +
            `${transition.days !== null ? ` after ${transition.days}d` : ""}`,
        )
      }
      return parts.join(", ")
    })
    .join(" · ")
}

/** The sentence a surface prints for a bucket's CORS rules. */
export function describeCors(read: AwsRead<CorsFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the CORS configuration")
  }
  if (read.value.kind === "none") return "no CORS configuration"
  if (read.value.anyRuleAllowsAnyOrigin) {
    const methods = [
      ...new Set(read.value.rules.filter((r) => r.allowsAnyOrigin).flatMap((r) => r.allowedMethods)),
    ].sort()
    return `CORS ALLOWS ANY ORIGIN (*) for ${methods.join(", ") || "no stated method"}`
  }
  const origins = [...new Set(read.value.rules.flatMap((r) => r.allowedOrigins))].sort()
  return `CORS allows ${origins.join(", ") || "no origin"}`
}

/** The sentence a surface prints for the estate's public exposure. */
export function describePublicExposure(state: PublicExposureState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "exposed": {
      const named = state.buckets
        .map((finding) => `${finding.bucket}: ${finding.reasons.join("; ")}`)
        .join(" · ")
      const qualifier =
        state.partiallyUnread.length === 0
          ? ""
          : ` A further ${state.partiallyUnread.length} bucket(s) could not be fully read (${state.partiallyUnread.join(", ")}).`
      return `PUBLIC ACCESS FINDING — ${state.buckets.length} bucket(s): ${named}.${qualifier}`
    }
    case "none-observed": {
      const qualifier =
        state.partiallyUnread.length === 0
          ? ""
          : `, though ${state.partiallyUnread.length} bucket(s) could not be fully read (${state.partiallyUnread.join(", ")}) and nothing here says anything about them`
      return (
        `no public bucket observed — ${state.bucketsRead} bucket(s) answered, every block that ` +
        `could be read is in force and no policy status says public${qualifier}`
      )
    }
  }
}

/** The sentence a surface prints for how far the listing got. */
export function describeListing(listing: BucketListTruncation): string {
  switch (listing.kind) {
    case "complete":
      return `${listing.bucketsListed} bucket(s) listed in full over ${listing.pagesRead} page(s)`
    case "truncated":
      return `THERE WERE MORE — ${listing.why}`
    case "not-listed":
      return `not listed — ${listing.why}`
  }
}

/** The sentence a surface prints for one bucket. One funnel, so states cannot drift. */
export function describeBucket(bucket: BucketReading): string {
  return (
    `${bucket.name} — ${describeBucketRegion(bucket.region)}` +
    `${bucket.partition ? ` (partition ${bucket.partition})` : ""} — ` +
    `${describeBucketAttribution(bucket.attribution)} · ` +
    `${describePublicAccessBlock(bucket.publicAccessBlock)} · ` +
    `${describePolicyStatus(bucket.policyStatus)} · ` +
    `${describeEncryption(bucket.encryption)} · ` +
    `${describeVersioning(bucket.versioning)} · ` +
    `${describeLifecycle(bucket.lifecycle)} · ` +
    `${describeCors(bucket.cors)} · ` +
    `as of ${bucket.asOf}, refreshed every ${Math.round(bucket.refreshMs / 1000)}s`
  )
}

/** The sentence a surface prints for a bucket's policy status. */
export function describePolicyStatus(read: AwsRead<PolicyStatusFact>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the bucket policy status")
  }
  switch (read.value.kind) {
    case "public":
      return "POLICY STATUS: PUBLIC"
    case "not-public":
      return "policy status: not public"
    case "no-policy":
      return `policy status: no bucket policy — ${read.value.why}`
  }
}

export interface BucketLine {
  label: string
  text: string
}

/**
 * What an S3 surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function bucketLines(readings: S3Readings): readonly BucketLine[] {
  const lines: BucketLine[] = [
    {
      label: "Buckets",
      text: describeRead(
        readings.buckets,
        `buckets read from AWS, refreshed every ${Math.round(readings.refreshMs.buckets / 1000)}s`,
      ),
    },
    { label: "Listing", text: describeListing(readings.listing) },
    { label: "Public access", text: describePublicExposure(readings.publicExposure) },
  ]
  if (readings.buckets.state === "ACTUAL" || readings.buckets.state === "STALE") {
    for (const bucket of readings.buckets.value) {
      lines.push({ label: bucket.name, text: describeBucket(bucket) })
    }
  }
  return lines
}
