/**
 * STUDIO-070-004 (ECR) — what is actually deployed, and is it known-vulnerable.
 *
 * `infrastructure/terraform/ecr.tf` and `infrastructure/studio/ecr.tf` each
 * create a repository with `scan_on_push = true` and a lifecycle policy, and
 * nothing in the running product had ever issued an ECR call. So the registry
 * that holds the image serving the pilot was dark: a CRITICAL CVE that ECR found
 * on push produced exactly the same console as a repository nobody had pushed to
 * — nothing at all.
 *
 * ## The correlation key is the DIGEST, and that is not a preference
 *
 * `image_tag_mutability = "MUTABLE"` is set on both repositories in this estate.
 * A mutable tag is precisely the mechanism by which a tag and a digest stop
 * agreeing: `latest`, or `sha-abc123`, can be re-pushed onto different bytes, and
 * from that moment the tag names one thing and the running task is another. So
 * every reading in this module is keyed by `imageDigest`, tags are carried as a
 * LIST attached to a digest, and `tagBindings` reports any tag this engine saw on
 * more than one digest rather than silently picking the first. A module that
 * keyed on the tag would answer "which CVEs does `latest` have" — a question
 * whose answer changes under it — instead of "which CVEs does the image with this
 * digest have", which is the only stable one.
 *
 * ## An absence of findings is not an absence of vulnerabilities
 *
 * This is the whole reason the module has more than one union in it. Five
 * different facts all render as "no CVE rows" if a surface is careless:
 *
 *   - the image was scanned and genuinely has nothing        (`clean`)
 *   - the repository does not scan on push, so nothing looked (`not-scanned`)
 *   - the scan is still running, or failed, or the image type is unsupported
 *                                                             (`scan-incomplete`)
 *   - `ecr:DescribeImageScanFindings` was refused              (`unknown`)
 *   - the image was never described at all                    (per-repo AwsRead)
 *
 * Only the first is a claim. `ScanOnPush` is therefore its own union with a
 * `disabled` arm carrying the sentence that says so, `DeployedRiskState` has an
 * `unverified` arm distinct from `clear`, and `describeVulnerability` prints five
 * visibly different strings. A reassuring zero is the defect this module exists
 * to prevent.
 *
 * ## Four capabilities, four readings, on purpose
 *
 * `ecr:DescribeRepositories`, `ecr:DescribeImages`,
 * `ecr:DescribeImageScanFindings` and `ecr:GetLifecyclePolicy` are four separate
 * IAM actions and a role is routinely granted some without the others. Folding
 * the depth reads into the listing would make a refused `DescribeImages` render
 * as "refused ecr:DescribeRepositories", so the minimum statement an operator
 * pastes into a policy would not contain the action that is actually missing —
 * they would grant it, redeploy, and be refused identically. `retained.ts` paid
 * for that lesson with `backup:ListBackupVaults`; this module is built the way
 * `sqs.ts` ended up.
 *
 * So the listing is one `AwsRead`, and EVERY repository carries its own `AwsRead`
 * for its images and another for its lifecycle policy, and every image selected
 * for a detail read carries its own `AwsRead` for its scan findings. A repository
 * whose images were refused still appears, saying it was refused.
 *
 * ## Two "not found" errors that are answers, not faults
 *
 * `GetLifecyclePolicy` raises `LifecyclePolicyNotFoundException` when a
 * repository has no policy, and `DescribeImageScanFindings` raises
 * `ScanNotFoundException` when an image has never been scanned. Both are AWS
 * telling us the truth in the shape of an exception. Left to reach `readAws` they
 * classify as ERROR — a red box whose remedy is nothing, on the two facts an
 * operator most needs stated plainly ("nothing expires these images"; "this image
 * was never scanned"). They are caught inside the read and returned as values.
 *
 * ## What this module cannot read, said out loud
 *
 * **Whether ENHANCED scanning is on for the registry is not readable here.** It
 * is `ecr:GetRegistryScanningConfiguration`, a registry-level action that is not
 * in the capability registry and that this module does not get to add. Basic
 * scanning finds OS package CVEs only; enhanced scanning, through Inspector,
 * also finds application-language ones. So `EcrReadings.enhancedScanning` has one
 * arm, NOT_READABLE, naming the capability that would answer it — because a field
 * left off the type is a field a surface can forget, and forgetting it here means
 * printing a basic-scan clean bill as though it covered the application layer.
 *
 * ## Pagination
 *
 * Bounded, and the bound is reported rather than hidden. `sqs.ts` throws when it
 * runs out of pages; that is right for an estate of five queues where a
 * twenty-thousandth is a bug. A registry legitimately holds more images than this
 * engine will walk in a server render, so hitting the cap here is an expected
 * state and it travels as `Truncation`, which every renderer prints. What does
 * NOT happen is a first page rendered as if it were the registry.
 *
 * ## Region, partition and attribution
 *
 * Region and partition come from the `repositoryArn` AWS returns, and from the
 * resolved identity when there is none. There is no literal region in this file
 * and no `"aws"` partition fallback — GE-010-007 was a data-residency defect
 * caused by exactly that fallback. Attribution is `tags.ts` and the Resource
 * Groups Tagging API, with the fourth answer `unknown` for when the tag index
 * itself could not be read: "we could not look up this repository's tags" is not
 * "this repository has no tenant tag".
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
 * How many `DescribeRepositories` pages to walk. `client.ts` asks for 100 per
 * page, so this is two thousand repositories before the listing is declared
 * truncated — and it is DECLARED, never silently cut.
 */
export const MAX_REPOSITORY_PAGES = 20

/** How many `DescribeImages` pages to walk per repository. 100 per page. */
export const MAX_IMAGE_PAGES = 10

/** How many `DescribeImageScanFindings` pages to walk for one image. */
export const MAX_FINDING_PAGES = 5

/**
 * How many repositories get an image read in one load.
 *
 * `DescribeImages` is one call per repository against a per-account throttle.
 * The estate has two repositories; the cap exists so an account that has grown
 * three hundred does not turn one page render into three hundred API calls.
 *
 * Repositories past the cap are NOT dropped and do not render as empty: they
 * carry an UNCONFIGURED images read whose `why` says the engine stopped, which is
 * a different sentence from "this repository holds no images".
 */
export const MAX_REPOSITORY_DEPTH_READS = 100

/**
 * How many images get a scan-findings detail read across the whole load.
 *
 * `DescribeImages` already returns `imageScanFindingsSummary` for every image, so
 * the severity counts do not depend on this budget — the detail read adds the
 * finding NAMES, and it is one call per image. Images past the budget keep their
 * summary-derived vulnerability and carry an UNCONFIGURED detail read.
 */
export const MAX_SCAN_DETAIL_READS = 40

/** How many individual findings to carry per image, so a render is bounded. */
export const MAX_FINDINGS_SAMPLED = 25

/** How many detail reads are in flight at once. Bounded so one load is not a burst. */
const DETAIL_CONCURRENCY = 6

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface DescribeRepositoriesResponse {
  repositories?: Array<{
    repositoryArn?: string
    repositoryName?: string
    registryId?: string
    repositoryUri?: string
    createdAt?: string | Date
    imageTagMutability?: string
    imageScanningConfiguration?: { scanOnPush?: boolean }
    encryptionConfiguration?: { encryptionType?: string; kmsKey?: string }
  }>
  nextToken?: string
}

interface DescribeImagesResponse {
  imageDetails?: Array<{
    registryId?: string
    repositoryName?: string
    imageDigest?: string
    imageTags?: string[]
    imageSizeInBytes?: number
    imagePushedAt?: string | Date
    artifactMediaType?: string
    imageManifestMediaType?: string
    lastRecordedPullTime?: string | Date
    imageScanStatus?: { status?: string; description?: string }
    imageScanFindingsSummary?: ImageScanFindingsSummary
  }>
  nextToken?: string
}

/** The summary ECR returns beside every image in `DescribeImages`. */
export interface ImageScanFindingsSummary {
  imageScanCompletedAt?: string | Date
  vulnerabilitySourceUpdatedAt?: string | Date
  findingSeverityCounts?: Record<string, number>
}

interface DescribeImageScanFindingsResponse {
  imageScanStatus?: { status?: string; description?: string }
  imageScanFindings?: {
    imageScanCompletedAt?: string | Date
    vulnerabilitySourceUpdatedAt?: string | Date
    findingSeverityCounts?: Record<string, number>
    findings?: Array<{ name?: string; severity?: string; uri?: string; attributes?: Array<{ key?: string; value?: string }> }>
    enhancedFindings?: Array<{
      title?: string
      severity?: string
      packageVulnerabilityDetails?: {
        vulnerabilityId?: string
        vulnerablePackages?: Array<{ name?: string; version?: string }>
      }
    }>
  }
  nextToken?: string
}

interface GetLifecyclePolicyResponse {
  registryId?: string
  repositoryName?: string
  lifecyclePolicyText?: string
  lastEvaluatedAt?: string | Date
}

/* ----------------------------------------------------------- truncation -- */

/**
 * Whether a paged read reached the end, or gave up at its bound.
 *
 * A separate value rather than a boolean so the reason travels with it. "There
 * were more" and "that was all of them" are the two answers, and only the second
 * licenses a surface to say "2 repositories" without a qualifier.
 */
export type Truncation =
  | { kind: "complete" }
  | { kind: "truncated"; pagesRead: number; itemsRead: number; why: string }

export const COMPLETE: Truncation = { kind: "complete" }

/** The sentence a surface prints for a truncation. Empty when it is complete. */
export function describeTruncation(truncation: Truncation): string {
  return truncation.kind === "complete"
    ? ""
    : ` — TRUNCATED: ${truncation.why} (${truncation.itemsRead} read over ${truncation.pagesRead} page(s); there were more)`
}

/** A paged result and whether it is all of them. */
interface Paged<T> {
  items: readonly T[]
  truncation: Truncation
}

/* ------------------------------------------------------------ the shapes -- */

/**
 * Whether a tag on this repository can be moved onto different bytes.
 *
 * `unreported` is its own arm rather than being read as MUTABLE. MUTABLE IS the
 * API's default when the field is absent, but "AWS did not tell us" and "AWS said
 * mutable" are different observations and only the second is something somebody
 * chose. Reporting the first as a finding would put a repository on a remediation
 * list because of a field an SDK version stopped returning.
 */
export type TagMutability =
  | { kind: "immutable" }
  | { kind: "mutable"; why: string }
  | { kind: "unreported"; why: string }

/**
 * Whether ECR scans an image when it is pushed.
 *
 * `disabled` carries the sentence that matters — that the absence of findings in
 * this repository proves nothing — because that sentence is the finding. A
 * boolean would let a surface render "scan on push: false" in grey next to "0
 * vulnerabilities" in green, which is the exact composition this module exists to
 * make impossible.
 */
export type ScanOnPush =
  | { kind: "enabled" }
  | { kind: "disabled"; why: string }
  | { kind: "unreported"; why: string }

/**
 * Whether the registry runs ENHANCED scanning.
 *
 * One arm, deliberately. See the module header: the fact lives behind
 * `ecr:GetRegistryScanningConfiguration`, which is not in the capability
 * registry. This type exists so the absence is a value a surface must render
 * rather than a field a surface can forget.
 */
export interface EnhancedScanningCoverage {
  state: "NOT_READABLE"
  needs: "ecr:GetRegistryScanningConfiguration"
  why: string
}

/** The same object every time: nothing about it varies per repository. */
export const ENHANCED_SCANNING_NOT_READABLE: EnhancedScanningCoverage = {
  state: "NOT_READABLE",
  needs: "ecr:GetRegistryScanningConfiguration",
  why:
    "whether this registry runs ENHANCED scanning is a registry-level read " +
    "(ecr:GetRegistryScanningConfiguration) that this engine does not hold. Basic scanning finds " +
    "OS package CVEs only; findings below may therefore be complete for the OS layer and silent " +
    "about the application layer. Unknown, not covered.",
}

/** The severities ECR reports, in the order an operator triages them. */
export const SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFORMATIONAL",
  "UNDEFINED",
] as const

export type Severity = (typeof SEVERITIES)[number]

export type SeverityCounts = Readonly<Record<Severity, number>>

export const NO_FINDINGS: SeverityCounts = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFORMATIONAL: 0,
  UNDEFINED: 0,
}

/** One CVE, named. Enough to search for it; not the paragraph of prose AWS ships. */
export interface ScanFinding {
  name: string
  severity: Severity
  packageName: string | null
  packageVersion: string | null
}

/**
 * What is known about one image's vulnerabilities.
 *
 * Five arms, because five different facts otherwise render as "no rows". See the
 * module header. `source` on the `findings` and `clean` arms records WHICH read
 * produced the counts, so an operator can tell a summary that came free with the
 * image listing from a detail read that was actually performed.
 */
export type ImageVulnerability =
  /** Scanned, and it found things. The counts are AWS's own, never assembled. */
  | {
      kind: "findings"
      counts: SeverityCounts
      total: number
      completedAt: string | null
      source: "summary" | "detail"
      /** Named findings, capped. Empty when only the summary was read. */
      sampled: readonly ScanFinding[]
      truncation: Truncation
    }
  /** Scanned, completed, and genuinely nothing. The only arm that is a clean bill. */
  | { kind: "clean"; completedAt: string | null; source: "summary" | "detail" }
  /** Nothing looked. Either scan-on-push is off, or ECR has no scan for this image. */
  | { kind: "not-scanned"; why: string }
  /** A scan exists but has not produced an answer: running, failed, or unsupported. */
  | { kind: "scan-incomplete"; status: string; description: string | null; why: string }
  /** The read itself did not happen. Refused, throttled, capped or broken. */
  | { kind: "unknown"; why: string }

/**
 * A repository's lifecycle policy — what expires, and after how long.
 *
 * `absent` is a value rather than an error because that is what it is: AWS
 * answered, and the answer is that nothing expires these images. That is a cost
 * finding and a supply-chain finding at once, and it must not render as a red box.
 */
export type LifecyclePolicy =
  | { kind: "policy"; rules: readonly LifecycleRule[]; lastEvaluatedAt: string | null }
  | { kind: "absent"; why: string }
  | { kind: "unreadable"; raw: string; why: string }

/** One rule of a lifecycle policy, in the words the policy uses. */
export interface LifecycleRule {
  priority: number
  description: string | null
  /** `tagged`, `untagged`, `any` — which images this rule looks at. */
  tagStatus: string
  tagPrefixList: readonly string[]
  /** `imageCountMoreThan` or `sinceImagePushed`. */
  countType: string
  countUnit: string | null
  countNumber: number | null
  /** `expire` is the only action ECR has, but it is read, not assumed. */
  action: string
}

/**
 * Which tenant a repository belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * repository whose tags were never read must not render as "unattributable —
 * missing tenure:tenant", because that sentence sends an operator to add a tag
 * that is probably already there.
 */
export type RepositoryAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** One image in a repository, keyed by its digest. Tags hang off it, never the reverse. */
export interface ImageReading {
  /** The correlation key. `sha256:…`, exactly as AWS returned it. */
  digest: string
  repositoryName: string
  /** Every tag AWS reports on THIS digest. Zero is normal and is itself a fact. */
  tags: readonly string[]
  pushedAt: string | null
  sizeBytes: number | null
  artifactMediaType: string | null
  manifestMediaType: string | null
  /** Null when AWS did not report one — not "never pulled", which is a different claim. */
  lastPulledAt: string | null
  vulnerability: ImageVulnerability
  /**
   * The detail read, when one was performed. UNCONFIGURED when the budget was
   * spent — which is not "no findings", and is why it is a reading and not a null.
   */
  scanDetail: AwsRead<ScanDetail>
}

/** What one `DescribeImageScanFindings` answered. */
export interface ScanDetail {
  digest: string
  status: string
  statusDescription: string | null
  counts: SeverityCounts
  total: number
  completedAt: string | null
  sampled: readonly ScanFinding[]
  truncation: Truncation
  /** AWS answered that this image has no scan. A value, not an exception. */
  noScan: boolean
}

/** One repository, its configuration, its images and its policy. */
export interface RepositoryReading {
  name: string
  /** AWS's own `repositoryArn`. Null only when AWS did not return one. */
  arn: string | null
  registryId: string | null
  uri: string | null
  createdAt: string | null
  region: string | null
  partition: string | null
  tagMutability: TagMutability
  scanOnPush: ScanOnPush
  encryptionType: string | null
  attribution: RepositoryAttribution
  /** Refused, throttled, capped, broken or read — per repository, action named. */
  images: AwsRead<readonly ImageReading[]>
  /** How much of this repository's image list was walked. */
  imageTruncation: Truncation
  /** Independent of `images`: one can be refused while the other answers. */
  lifecycle: AwsRead<LifecyclePolicy>
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { images: number; scan: number; lifecycle: number }
  asOf: string
}

/**
 * A tag this engine saw on more than one digest.
 *
 * Under `image_tag_mutability = "MUTABLE"` this is the observable form of the
 * defect the digest keying exists for. Reported rather than resolved: picking one
 * digest would be inventing an answer to "which one is deployed", which this
 * module cannot know.
 */
export interface TagCollision {
  repositoryName: string
  tag: string
  digests: readonly string[]
}

/** An image with findings, lifted out so it can be counted and named. */
export interface VulnerableImage {
  repositoryName: string
  digest: string
  tags: readonly string[]
  counts: SeverityCounts
  total: number
  pushedAt: string | null
  attribution: RepositoryAttribution
}

/**
 * Whether anything in this registry is known-vulnerable.
 *
 * The headline. Every arm is careful about what it claims: `clear` is reachable
 * ONLY when every repository that answered scans on push and every image that
 * answered completed a scan with nothing in it. Anything less is `unverified`,
 * whose whole job is to say that the zero on the screen is not evidence.
 */
export type DeployedRiskState =
  /** The repository listing itself was not readable, so nothing can be said. */
  | { kind: "unknown"; why: string }
  /** No repository at all. Not a risk statement — there is nothing to deploy. */
  | { kind: "no-repositories" }
  /** At least one image carries findings. This is the alarm. */
  | {
      kind: "vulnerable"
      images: readonly VulnerableImage[]
      critical: number
      high: number
      /** Repositories that do not scan on push. Their silence is not evidence either. */
      unscanned: readonly string[]
      /** Repositories or images this engine could not read. Named, so nothing is implied. */
      unreadable: readonly string[]
    }
  /**
   * No findings, and at least one reason that means nothing. The zero is not a
   * clean bill and this arm exists so a surface cannot print it as one.
   */
  | {
      kind: "unverified"
      why: string
      unscanned: readonly string[]
      unreadable: readonly string[]
      imagesConsidered: number
    }
  /** Every repository scans, every image completed, and every one is clean. */
  | { kind: "clear"; repositoriesScanned: number; imagesScanned: number }

/** Everything an ECR surface needs, in one load. */
export interface EcrReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The repositories. DENIED here is a refused `ecr:DescribeRepositories` and is
   * NEVER `[]` — an operator reading "no repositories" when the truth is "we were
   * not allowed to look" is the single most dangerous thing this surface can say.
   */
  repositories: AwsRead<readonly RepositoryReading[]>
  /** How much of the repository listing was walked. */
  truncation: Truncation
  deployedRisk: DeployedRiskState
  /** Tags seen on more than one digest. Empty is the normal, healthy answer. */
  tagCollisions: readonly TagCollision[]
  enhancedScanning: EnhancedScanningCoverage
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { repositories: number; images: number; scan: number; lifecycle: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK hands back `Date` for these fields and a JSON transport hands back a
 * string. Both are accepted; anything else becomes null rather than
 * `Invalid Date`, because a render showing "Invalid Date" as a push time is a
 * render an operator stops trusting.
 */
export function isoTime(value: string | Date | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Truncated so a malformed policy cannot become an unbounded string in a render. */
function shortRaw(raw: string): string {
  return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw
}

/** A severity ECR reported, or UNDEFINED. Never dropped: an unknown CVE still counts. */
export function normaliseSeverity(raw: string | undefined | null): Severity {
  const upper = (raw ?? "").toUpperCase()
  return (SEVERITIES as readonly string[]).includes(upper) ? (upper as Severity) : "UNDEFINED"
}

/**
 * `findingSeverityCounts` as a complete record.
 *
 * ECR OMITS a severity with no findings rather than reporting zero, so the
 * missing keys are filled in here — and a severity ECR reports that this engine
 * does not model lands in UNDEFINED rather than being dropped. A dropped count is
 * a CVE nobody sees.
 */
export function severityCounts(raw: Record<string, number> | undefined): SeverityCounts {
  const counts: Record<Severity, number> = { ...NO_FINDINGS }
  for (const [key, value] of Object.entries(raw ?? {})) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) continue
    counts[normaliseSeverity(key)] += n
  }
  return counts
}

export function totalFindings(counts: SeverityCounts): number {
  return SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0)
}

/**
 * Scan statuses that mean "there will be no findings from this scan".
 *
 * `COMPLETE` and `ACTIVE` are the two that produce an answer — `ACTIVE` is what
 * enhanced scanning reports for an image it is continuously monitoring. Everything
 * else is a state, and each of them renders as `scan-incomplete` rather than as a
 * clean bill.
 */
const ANSWERING_STATUSES = new Set(["COMPLETE", "ACTIVE"])

/** Why a scan status other than COMPLETE/ACTIVE means the zero on screen is not evidence. */
function whyStatusProvesNothing(status: string, description: string | null): string {
  const suffix = description ? ` (${description})` : ""
  switch (status) {
    case "IN_PROGRESS":
    case "PENDING":
      return `ECR is still scanning this image (${status})${suffix}. No findings yet is not no vulnerabilities.`
    case "FAILED":
      return `ECR's scan of this image FAILED${suffix}. Nothing was assessed.`
    case "UNSUPPORTED_IMAGE":
      return `ECR cannot scan this image type${suffix}. Nothing was assessed.`
    case "SCAN_ELIGIBILITY_EXPIRED":
      return `this image is older than ECR's basic-scan eligibility window${suffix}. Its findings are no longer refreshed.`
    case "FINDINGS_UNAVAILABLE":
      return `ECR reports findings unavailable for this image${suffix}. Nothing can be read.`
    default:
      return `ECR reports scan status ${status}${suffix}, which is not an answer.`
  }
}

/**
 * A lifecycle policy document as rules.
 *
 * The text is JSON AWS stores verbatim, so it can be anything a human pasted.
 * `unreadable` is its own arm: "this repository has no policy" and "this
 * repository's policy did not parse" have opposite remedies, and collapsing the
 * second into the first invents a missing policy for a repository that has one.
 */
export function parseLifecyclePolicy(
  text: string | undefined,
  lastEvaluatedAt: string | null,
): LifecyclePolicy {
  if (text === undefined || text.trim() === "") {
    return {
      kind: "absent",
      why: "ecr:GetLifecyclePolicy returned an empty policy document — nothing expires images in this repository",
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: "unreadable", raw: shortRaw(text), why: "the lifecycle policy is not JSON" }
  }
  const rulesRaw = (parsed as { rules?: unknown } | null)?.rules
  if (!Array.isArray(rulesRaw)) {
    return {
      kind: "unreadable",
      raw: shortRaw(text),
      why: "the lifecycle policy carries no `rules` array",
    }
  }
  const rules: LifecycleRule[] = []
  for (const entry of rulesRaw) {
    const rule = entry as {
      rulePriority?: unknown
      description?: unknown
      selection?: {
        tagStatus?: unknown
        tagPrefixList?: unknown
        countType?: unknown
        countUnit?: unknown
        countNumber?: unknown
      }
      action?: { type?: unknown }
    } | null
    const priority = Number(rule?.rulePriority)
    const selection = rule?.selection ?? {}
    rules.push({
      priority: Number.isFinite(priority) ? priority : 0,
      description: typeof rule?.description === "string" ? rule.description : null,
      tagStatus: typeof selection.tagStatus === "string" ? selection.tagStatus : "unstated",
      tagPrefixList: Array.isArray(selection.tagPrefixList)
        ? selection.tagPrefixList.filter((p): p is string => typeof p === "string")
        : [],
      countType: typeof selection.countType === "string" ? selection.countType : "unstated",
      countUnit: typeof selection.countUnit === "string" ? selection.countUnit : null,
      countNumber: Number.isFinite(Number(selection.countNumber))
        ? Number(selection.countNumber)
        : null,
      action: typeof rule?.action?.type === "string" ? rule.action.type : "unstated",
    })
  }
  if (rules.length === 0) {
    return {
      kind: "absent",
      why: "the lifecycle policy has no rules in it — nothing expires images in this repository",
    }
  }
  // Sorted by the priority ECR itself evaluates them in, so two loads of the same
  // repository produce the same order regardless of how the document was written.
  rules.sort((a, b) => a.priority - b.priority || a.tagStatus.localeCompare(b.tagStatus))
  return { kind: "policy", rules, lastEvaluatedAt }
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/** The raw repository record this module carries between the two reads. */
interface RawRepository {
  name: string
  arn: string | null
  registryId: string | null
  uri: string | null
  createdAt: string | null
  tagMutability: TagMutability
  scanOnPush: ScanOnPush
  encryptionType: string | null
}

function readTagMutability(raw: string | undefined): TagMutability {
  if (raw === "IMMUTABLE") return { kind: "immutable" }
  if (raw === "MUTABLE") {
    return {
      kind: "mutable",
      why:
        "tags in this repository can be re-pushed onto different bytes, so a tag names one image " +
        "today and may name another tomorrow. Correlate by digest, not by tag.",
    }
  }
  return {
    kind: "unreported",
    why: `ecr:DescribeRepositories returned imageTagMutability=${JSON.stringify(raw ?? null)}, which this engine will not read as either mutable or immutable`,
  }
}

function readScanOnPush(raw: boolean | undefined): ScanOnPush {
  if (raw === true) return { kind: "enabled" }
  if (raw === false) {
    return {
      kind: "disabled",
      why:
        "scan-on-push is OFF for this repository. Nothing scans an image when it arrives, so an " +
        "absence of findings here is an absence of scanning — it is not evidence that the images " +
        "are clean.",
    }
  }
  return {
    kind: "unreported",
    why:
      "ecr:DescribeRepositories did not report imageScanningConfiguration.scanOnPush for this " +
      "repository, so whether anything scans its images is unknown — which is not the same as off " +
      "and emphatically not the same as on.",
  }
}

/** Every repository in the registry, paginated to a stated bound. */
async function listRepositories(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Paged<RawRepository>>> {
  return readAws<Paged<RawRepository>>(
    "ecr:DescribeRepositories",
    async () => {
      const items: RawRepository[] = []
      let token: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_REPOSITORY_PAGES; page += 1) {
        pages = page + 1
        const response = (await gw.call("ecr:DescribeRepositories", {
          nextToken: token,
        })) as DescribeRepositoriesResponse
        for (const repo of response?.repositories ?? []) {
          if (!repo?.repositoryName) continue
          items.push({
            name: repo.repositoryName,
            arn: repo.repositoryArn ?? null,
            registryId: repo.registryId ?? null,
            uri: repo.repositoryUri ?? null,
            createdAt: isoTime(repo.createdAt),
            tagMutability: readTagMutability(repo.imageTagMutability),
            scanOnPush: readScanOnPush(repo.imageScanningConfiguration?.scanOnPush),
            encryptionType: repo.encryptionConfiguration?.encryptionType ?? null,
          })
        }
        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_REPOSITORY_PAGES - 1) {
          // Not thrown, and not hidden. See the module header: hitting the bound
          // is an expected state in a registry, and it travels as a value every
          // renderer prints rather than as a first page passed off as the whole.
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: items.length,
            why: `ecr:DescribeRepositories still had pages after ${MAX_REPOSITORY_PAGES}; this engine stopped there`,
          }
        }
      }
      // Sorted so two loads of the same registry produce the same order.
      // DescribeRepositories does not promise one, and an order that changes
      // between renders makes a diff of two screenshots unreadable.
      items.sort((a, b) => a.name.localeCompare(b.name))
      return { items, truncation }
    },
    {
      now: options.now,
      denial: options.denial,
      // EMPTY is decided on the ITEMS, not on the wrapper object — a `Paged`
      // with an empty list and a `complete` truncation is a registry with no
      // repositories, and `looksEmpty` would call the wrapper non-empty because
      // it has two keys.
      isEmpty: (value) => (value as Paged<RawRepository>).items.length === 0,
      ...RETRY,
    },
  )
}

/** Every image in one repository, keyed by digest, paginated to a stated bound. */
async function listImages(
  gw: AwsGateway,
  repositoryName: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Paged<ImageReading>>> {
  return readAws<Paged<ImageReading>>(
    "ecr:DescribeImages",
    async () => {
      const items: ImageReading[] = []
      let token: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_IMAGE_PAGES; page += 1) {
        pages = page + 1
        const response = (await gw.call("ecr:DescribeImages", {
          repositoryName,
          nextToken: token,
        })) as DescribeImagesResponse
        for (const detail of response?.imageDetails ?? []) {
          const digest = detail?.imageDigest
          if (!digest) {
            // Without a digest there is no correlation key, and a row keyed on
            // its tags is the lie this module is built against. Dropping it
            // silently would be the other lie, so it throws — the repository's
            // images become ERROR, naming the reason.
            throw new Error(
              `ecr:DescribeImages returned an image in ${repositoryName} with no imageDigest. ` +
                `This engine correlates by digest and will not key a row on a mutable tag.`,
            )
          }
          const status = detail.imageScanStatus?.status ?? null
          const description = detail.imageScanStatus?.description ?? null
          const summary = detail.imageScanFindingsSummary
          items.push({
            digest,
            repositoryName,
            // Sorted so a digest that carries three tags renders identically on
            // two loads. AWS does not promise an order for imageTags.
            tags: [...(detail.imageTags ?? [])].filter((t) => typeof t === "string").sort(),
            pushedAt: isoTime(detail.imagePushedAt),
            sizeBytes: typeof detail.imageSizeInBytes === "number" ? detail.imageSizeInBytes : null,
            artifactMediaType: detail.artifactMediaType ?? null,
            manifestMediaType: detail.imageManifestMediaType ?? null,
            lastPulledAt: isoTime(detail.lastRecordedPullTime),
            vulnerability: vulnerabilityFromSummary(status, description, summary),
            // Replaced by the detail pass for the images that get one. This is
            // the honest default: the budget has not been spent on this image.
            scanDetail: {
              state: "UNCONFIGURED",
              capability: "ecr:DescribeImageScanFindings",
              why:
                "no scan-findings detail read was performed for this image. Its severity counts, " +
                "if any, come from the summary ECR returns with the image listing.",
            },
          })
        }
        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_IMAGE_PAGES - 1) {
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: items.length,
            why: `ecr:DescribeImages still had pages after ${MAX_IMAGE_PAGES} for ${repositoryName}; this engine stopped there`,
          }
        }
      }
      // Newest first — which build arrived last is the question this list is read
      // for — with the digest as a deterministic tie-break for images pushed in
      // the same second.
      items.sort(
        (a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "") || a.digest.localeCompare(b.digest),
      )
      return { items, truncation }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as Paged<ImageReading>).items.length === 0,
      ...RETRY,
    },
  )
}

/**
 * What the summary that came free with the image listing says.
 *
 * Kept separate from the detail read so a repository whose
 * `DescribeImageScanFindings` is refused still shows its severity counts. The two
 * capabilities are two IAM actions and this is the half that survives when the
 * other is denied.
 */
export function vulnerabilityFromSummary(
  status: string | null,
  description: string | null,
  summary: ImageScanFindingsSummary | undefined,
): ImageVulnerability {
  if (!status) {
    return {
      kind: "not-scanned",
      why:
        "ECR reports no scan status for this image. Nothing has assessed it, so there is nothing " +
        "to be reassured by.",
    }
  }
  if (!ANSWERING_STATUSES.has(status)) {
    return {
      kind: "scan-incomplete",
      status,
      description,
      why: whyStatusProvesNothing(status, description),
    }
  }
  const counts = severityCounts(summary?.findingSeverityCounts)
  const total = totalFindings(counts)
  const completedAt = isoTime(summary?.imageScanCompletedAt)
  if (total === 0) {
    return { kind: "clean", completedAt, source: "summary" }
  }
  return { kind: "findings", counts, total, completedAt, source: "summary", sampled: [], truncation: COMPLETE }
}

/** AWS's name for "this image has never been scanned". An answer, not a fault. */
const SCAN_NOT_FOUND = new Set(["ScanNotFoundException", "ImageNotFoundException"])

/** AWS's name for "this repository has no lifecycle policy". An answer, not a fault. */
const LIFECYCLE_NOT_FOUND = new Set(["LifecyclePolicyNotFoundException", "RepositoryPolicyNotFoundException"])

function errorNameOf(error: unknown): string {
  const e = error as { name?: unknown; __type?: unknown } | null
  for (const candidate of [e?.name, e?.__type]) {
    if (typeof candidate === "string" && candidate) {
      return candidate.includes("#") ? candidate.slice(candidate.lastIndexOf("#") + 1) : candidate
    }
  }
  return "UnknownError"
}

/** The named findings for one image, by DIGEST. Never by tag — see the header. */
async function readScanFindings(
  gw: AwsGateway,
  repositoryName: string,
  digest: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<ScanDetail>> {
  return readAws<ScanDetail>(
    "ecr:DescribeImageScanFindings",
    async () => {
      const sampled: ScanFinding[] = []
      let token: string | undefined
      let truncation: Truncation = COMPLETE
      let counts: SeverityCounts = NO_FINDINGS
      let completedAt: string | null = null
      let status = "UNKNOWN"
      let statusDescription: string | null = null
      let pages = 0

      for (let page = 0; page < MAX_FINDING_PAGES; page += 1) {
        pages = page + 1
        let response: DescribeImageScanFindingsResponse
        try {
          response = (await gw.call("ecr:DescribeImageScanFindings", {
            repositoryName,
            // The digest, deliberately, and never `imageTag`. A tag read would
            // ask about whichever image the tag points at right now, which under
            // a MUTABLE repository is a different question from the one the row
            // is answering.
            imageDigest: digest,
            nextToken: token,
          })) as DescribeImageScanFindingsResponse
        } catch (error) {
          if (page === 0 && SCAN_NOT_FOUND.has(errorNameOf(error))) {
            // AWS answered. "There is no scan for this image" is a fact, and a
            // red ERROR box on it would bury the one sentence that matters.
            return {
              digest,
              status: "NOT_SCANNED",
              statusDescription: null,
              counts: NO_FINDINGS,
              total: 0,
              completedAt: null,
              sampled: [],
              truncation: COMPLETE,
              noScan: true,
            }
          }
          throw error
        }

        status = response?.imageScanStatus?.status ?? status
        statusDescription = response?.imageScanStatus?.description ?? statusDescription
        const findings = response?.imageScanFindings
        // `findingSeverityCounts` is the WHOLE scan's counts on every page, not
        // the page's. Assigned, never accumulated: summing them across pages
        // would multiply every CVE by the page count.
        if (findings?.findingSeverityCounts) counts = severityCounts(findings.findingSeverityCounts)
        completedAt = isoTime(findings?.imageScanCompletedAt) ?? completedAt

        for (const finding of findings?.findings ?? []) {
          if (sampled.length >= MAX_FINDINGS_SAMPLED) break
          const attributes = new Map(
            (finding.attributes ?? [])
              .filter((a) => typeof a.key === "string")
              .map((a) => [a.key as string, a.value ?? null]),
          )
          sampled.push({
            name: finding.name ?? "unnamed finding",
            severity: normaliseSeverity(finding.severity),
            packageName: attributes.get("package_name") ?? null,
            packageVersion: attributes.get("package_version") ?? null,
          })
        }
        for (const finding of findings?.enhancedFindings ?? []) {
          if (sampled.length >= MAX_FINDINGS_SAMPLED) break
          const pkg = finding.packageVulnerabilityDetails?.vulnerablePackages?.[0]
          sampled.push({
            name:
              finding.packageVulnerabilityDetails?.vulnerabilityId ??
              finding.title ??
              "unnamed finding",
            severity: normaliseSeverity(finding.severity),
            packageName: pkg?.name ?? null,
            packageVersion: pkg?.version ?? null,
          })
        }

        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_FINDING_PAGES - 1) {
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: sampled.length,
            why: `ecr:DescribeImageScanFindings still had pages after ${MAX_FINDING_PAGES} for ${digest}; this engine stopped there`,
          }
        }
      }

      if (sampled.length >= MAX_FINDINGS_SAMPLED && truncation.kind === "complete") {
        truncation = {
          kind: "truncated",
          pagesRead: pages,
          itemsRead: sampled.length,
          why: `this engine names at most ${MAX_FINDINGS_SAMPLED} findings per image; the severity counts beside them are ECR's own and are complete`,
        }
      }

      // Deterministic: by severity in triage order, then by name.
      const order = new Map(SEVERITIES.map((s, i) => [s, i]))
      sampled.sort(
        (a, b) => (order.get(a.severity) ?? 99) - (order.get(b.severity) ?? 99) || a.name.localeCompare(b.name),
      )

      return {
        digest,
        status,
        statusDescription,
        counts,
        total: totalFindings(counts),
        completedAt,
        sampled,
        truncation,
        noScan: false,
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A scan detail is never meaningfully "empty": an image with no findings is
      // a COMPLETE scan with zero counts, which is a claim, and EMPTY would erase
      // the status that licenses it.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/** The lifecycle policy for one repository. "There is none" is a value here. */
async function readLifecyclePolicy(
  gw: AwsGateway,
  repositoryName: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<LifecyclePolicy>> {
  return readAws<LifecyclePolicy>(
    "ecr:GetLifecyclePolicy",
    async () => {
      try {
        const response = (await gw.call("ecr:GetLifecyclePolicy", {
          repositoryName,
        })) as GetLifecyclePolicyResponse
        return parseLifecyclePolicy(
          response?.lifecyclePolicyText,
          isoTime(response?.lastEvaluatedAt),
        )
      } catch (error) {
        if (LIFECYCLE_NOT_FOUND.has(errorNameOf(error))) {
          // AWS answered, in the shape of an exception. Nothing expires the
          // images in this repository, which is a cost finding and a
          // supply-chain finding, and it is not a broken read.
          return {
            kind: "absent",
            why:
              `ecr:GetLifecyclePolicy reports no lifecycle policy on ${repositoryName}. Nothing ` +
              `expires its images: every build ever pushed is still stored, still billed, and ` +
              `still pullable.`,
          }
        }
        throw error
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): RepositoryAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this repository's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this repository has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
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

/** The key a repository-and-digest pair takes in the scan-detail map. */
function scanKey(repositoryName: string, digest: string): string {
  return `${repositoryName}::${digest}`
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every repository in the registry, its images by digest, and what ECR found.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function ecrReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<EcrReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const listed = await listRepositories(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    repositories: CAPABILITIES["ecr:DescribeRepositories"].refreshMs,
    images: CAPABILITIES["ecr:DescribeImages"].refreshMs,
    scan: CAPABILITIES["ecr:DescribeImageScanFindings"].refreshMs,
    lifecycle: CAPABILITIES["ecr:GetLifecyclePolicy"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<RepositoryReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const repositories: AwsRead<readonly RepositoryReading[]> = listed
    return {
      identity,
      tagged,
      repositories,
      truncation: COMPLETE,
      deployedRisk: deployedRiskState(repositories),
      tagCollisions: [],
      enhancedScanning: ENHANCED_SCANNING_NOT_READABLE,
      asOf,
      refreshMs,
    }
  }

  const raw = listed.value.items
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  // Images and lifecycle policy per repository, both independently failable.
  const images: Array<AwsRead<Paged<ImageReading>>> = new Array(raw.length)
  const lifecycles: Array<AwsRead<LifecyclePolicy>> = new Array(raw.length)
  for (let start = 0; start < raw.length; start += DETAIL_CONCURRENCY) {
    const batch = raw.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (repo, offset) => {
        const position = start + offset
        if (position >= MAX_REPOSITORY_DEPTH_READS) {
          const skipped = (capability: "ecr:DescribeImages" | "ecr:GetLifecyclePolicy") =>
            ({
              state: "UNCONFIGURED",
              capability,
              why:
                `this engine reads at most ${MAX_REPOSITORY_DEPTH_READS} repositories per load and ` +
                `this one is number ${position + 1} of ${raw.length}. It was not read — which is ` +
                `not the same as its being empty.`,
            }) as const
          return {
            images: skipped("ecr:DescribeImages") as AwsRead<Paged<ImageReading>>,
            lifecycle: skipped("ecr:GetLifecyclePolicy") as AwsRead<LifecyclePolicy>,
          }
        }
        // Both are issued regardless of the other's outcome. A refused
        // GetLifecyclePolicy must not collapse the images to UNKNOWN, and a
        // refused DescribeImages must not hide the policy.
        const [imagesRead, lifecycleRead] = await Promise.all([
          listImages(gw, repo.name, { now, denial }),
          readLifecyclePolicy(gw, repo.name, { now, denial }),
        ])
        return { images: imagesRead, lifecycle: lifecycleRead }
      }),
    )
    for (let i = 0; i < read.length; i += 1) {
      images[start + i] = read[i].images
      lifecycles[start + i] = read[i].lifecycle
    }
  }

  // The scan-detail pass, across the whole load, keyed by digest. Budgeted:
  // images past it keep their summary-derived vulnerability and say so.
  const targets: Array<{ repo: number; image: number; repositoryName: string; digest: string }> = []
  for (let r = 0; r < raw.length; r += 1) {
    const read = images[r]
    if (read.state !== "ACTUAL" && read.state !== "STALE") continue
    read.value.items.forEach((image, i) => {
      targets.push({ repo: r, image: i, repositoryName: raw[r].name, digest: image.digest })
    })
  }
  const withinBudget = targets.slice(0, MAX_SCAN_DETAIL_READS)
  const details = new Map<string, AwsRead<ScanDetail>>()
  for (let start = 0; start < withinBudget.length; start += DETAIL_CONCURRENCY) {
    const batch = withinBudget.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map((t) => readScanFindings(gw, t.repositoryName, t.digest, { now, denial })),
    )
    batch.forEach((t, i) => details.set(scanKey(t.repositoryName, t.digest), read[i]))
  }

  const readings: RepositoryReading[] = raw.map((repo, r) => {
    const parts = repo.arn ? repo.arn.split(":") : []
    const imagesRead = images[r]
    const imageTruncation =
      imagesRead.state === "ACTUAL" || imagesRead.state === "STALE"
        ? imagesRead.value.truncation
        : COMPLETE

    let merged: AwsRead<readonly ImageReading[]>
    if (imagesRead.state === "ACTUAL" || imagesRead.state === "STALE") {
      const withDetail = imagesRead.value.items.map((image) => {
        const detail = details.get(scanKey(repo.name, image.digest))
        if (!detail) return image
        return {
          ...image,
          scanDetail: detail,
          vulnerability: mergeVulnerability(image.vulnerability, detail),
        }
      })
      merged = { ...imagesRead, value: withDetail }
    } else {
      // Every non-value arm travels unchanged. There is no branch here that
      // turns a refused DescribeImages into an empty image list.
      merged = imagesRead
    }

    return {
      name: repo.name,
      arn: repo.arn,
      registryId: repo.registryId,
      uri: repo.uri,
      createdAt: repo.createdAt,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the resolved identity. Never a literal, never from
      // the repositoryUri's host.
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      tagMutability: repo.tagMutability,
      scanOnPush: repo.scanOnPush,
      encryptionType: repo.encryptionType,
      attribution: attributionFor(repo.arn, tagged, index),
      images: merged,
      imageTruncation,
      lifecycle: lifecycles[r],
      refreshMs: { images: refreshMs.images, scan: refreshMs.scan, lifecycle: refreshMs.lifecycle },
      asOf,
    }
  })

  const repositories: AwsRead<readonly RepositoryReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    repositories,
    truncation: listed.value.truncation,
    deployedRisk: deployedRiskState(repositories),
    tagCollisions: tagCollisions(repositories),
    enhancedScanning: ENHANCED_SCANNING_NOT_READABLE,
    asOf,
    refreshMs,
  }
}

/**
 * The summary reading and the detail reading, reconciled.
 *
 * The detail wins when it answered, because it is the authoritative read and it
 * carries names. When it did NOT answer — refused, throttled, capped — the
 * summary is kept: one denied sub-call must degrade on its own and must not
 * collapse a row that another capability already answered. That is the whole
 * point of the two being separate IAM actions.
 */
export function mergeVulnerability(
  summary: ImageVulnerability,
  detail: AwsRead<ScanDetail>,
): ImageVulnerability {
  if (detail.state !== "ACTUAL" && detail.state !== "STALE") {
    // The summary already says whatever it says; if it said nothing useful, the
    // detail's failure is the more informative sentence and replaces it.
    if (summary.kind === "not-scanned" || summary.kind === "unknown") {
      return {
        kind: "unknown",
        why: `this image's scan findings were not read — ${describeRead(detail, "the scan findings")}`,
      }
    }
    return summary
  }
  const value = detail.value
  if (value.noScan) {
    return {
      kind: "not-scanned",
      why:
        "ECR reports no scan for this image (ScanNotFoundException). Nothing has assessed it, so " +
        "there is nothing to be reassured by.",
    }
  }
  if (!ANSWERING_STATUSES.has(value.status)) {
    return {
      kind: "scan-incomplete",
      status: value.status,
      description: value.statusDescription,
      why: whyStatusProvesNothing(value.status, value.statusDescription),
    }
  }
  if (value.total === 0) {
    return { kind: "clean", completedAt: value.completedAt, source: "detail" }
  }
  return {
    kind: "findings",
    counts: value.counts,
    total: value.total,
    completedAt: value.completedAt,
    source: "detail",
    sampled: value.sampled,
    truncation: value.truncation,
  }
}

/* -------------------------------------------------------- derived states -- */

/**
 * Tags this engine saw on more than one digest.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `ecrReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function tagCollisions(
  repositories: AwsRead<readonly RepositoryReading[]>,
): readonly TagCollision[] {
  if (repositories.state !== "ACTUAL" && repositories.state !== "STALE") return []
  const out: TagCollision[] = []
  for (const repo of repositories.value) {
    if (repo.images.state !== "ACTUAL" && repo.images.state !== "STALE") continue
    const byTag = new Map<string, string[]>()
    for (const image of repo.images.value) {
      for (const tag of image.tags) {
        const digests = byTag.get(tag) ?? []
        digests.push(image.digest)
        byTag.set(tag, digests)
      }
    }
    for (const [tag, digests] of byTag) {
      if (digests.length > 1) {
        out.push({ repositoryName: repo.name, tag, digests: [...digests].sort() })
      }
    }
  }
  out.sort((a, b) => a.repositoryName.localeCompare(b.repositoryName) || a.tag.localeCompare(b.tag))
  return out
}

/**
 * Whether anything in this registry is known-vulnerable.
 *
 * `clear` is deliberately hard to reach: every repository must scan on push,
 * every repository's images must have been readable, and every image must have
 * completed a scan with nothing in it. One repository with scan-on-push off, one
 * refused read, one scan still running, and the answer is `unverified` — which
 * renders as a sentence saying the zero is not evidence, rather than as a zero.
 */
export function deployedRiskState(
  repositories: AwsRead<readonly RepositoryReading[]>,
): DeployedRiskState {
  if (repositories.state === "EMPTY") return { kind: "no-repositories" }
  if (repositories.state !== "ACTUAL" && repositories.state !== "STALE") {
    return { kind: "unknown", why: describeRead(repositories, "the ECR repository listing") }
  }
  if (repositories.value.length === 0) return { kind: "no-repositories" }

  const vulnerable: VulnerableImage[] = []
  const unscanned: string[] = []
  const unreadable: string[] = []
  let imagesConsidered = 0
  let imagesClean = 0
  let incomplete = 0

  for (const repo of repositories.value) {
    if (repo.scanOnPush.kind !== "enabled") unscanned.push(repo.name)
    if (repo.images.state !== "ACTUAL" && repo.images.state !== "STALE") {
      if (repo.images.state !== "EMPTY") unreadable.push(repo.name)
      continue
    }
    if (repo.imageTruncation.kind === "truncated") {
      unreadable.push(`${repo.name} (image list truncated)`)
    }
    for (const image of repo.images.value) {
      imagesConsidered += 1
      switch (image.vulnerability.kind) {
        case "findings":
          vulnerable.push({
            repositoryName: repo.name,
            digest: image.digest,
            tags: image.tags,
            counts: image.vulnerability.counts,
            total: image.vulnerability.total,
            pushedAt: image.pushedAt,
            attribution: repo.attribution,
          })
          break
        case "clean":
          imagesClean += 1
          break
        case "not-scanned":
        case "scan-incomplete":
          incomplete += 1
          break
        case "unknown":
          unreadable.push(`${repo.name}@${image.digest}`)
          break
      }
    }
  }

  if (vulnerable.length > 0) {
    vulnerable.sort(
      (a, b) =>
        b.counts.CRITICAL - a.counts.CRITICAL ||
        b.counts.HIGH - a.counts.HIGH ||
        b.total - a.total ||
        a.repositoryName.localeCompare(b.repositoryName) ||
        a.digest.localeCompare(b.digest),
    )
    return {
      kind: "vulnerable",
      images: vulnerable,
      critical: vulnerable.reduce((sum, i) => sum + i.counts.CRITICAL, 0),
      high: vulnerable.reduce((sum, i) => sum + i.counts.HIGH, 0),
      unscanned,
      unreadable,
    }
  }

  const reasons: string[] = []
  if (unscanned.length > 0) {
    reasons.push(
      `${unscanned.length} repository(ies) do not scan on push (${unscanned.join(", ")}), so nothing looked at their images`,
    )
  }
  if (incomplete > 0) {
    reasons.push(`${incomplete} image(s) have no completed scan`)
  }
  if (unreadable.length > 0) {
    reasons.push(`${unreadable.length} read(s) did not answer (${unreadable.join(", ")})`)
  }
  if (reasons.length > 0) {
    return {
      kind: "unverified",
      why:
        `no findings were returned, and that is not a clean bill: ${reasons.join("; ")}. ` +
        `An absence of findings here is an absence of scanning, not an absence of vulnerabilities.`,
      unscanned,
      unreadable,
      imagesConsidered,
    }
  }
  return {
    kind: "clear",
    repositoriesScanned: repositories.value.length,
    imagesScanned: imagesClean,
  }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for a repository's tag mutability. */
export function describeTagMutability(mutability: TagMutability): string {
  switch (mutability.kind) {
    case "immutable":
      return "tags are IMMUTABLE — a tag and a digest cannot drift apart"
    case "mutable":
      return `tags are MUTABLE — ${mutability.why}`
    case "unreported":
      return `tag mutability unknown — ${mutability.why}`
  }
}

/** The sentence a surface prints for a repository's scan configuration. */
export function describeScanOnPush(scanOnPush: ScanOnPush): string {
  switch (scanOnPush.kind) {
    case "enabled":
      return "scan-on-push is ON"
    case "disabled":
      return `SCAN-ON-PUSH IS OFF — ${scanOnPush.why}`
    case "unreported":
      return `scan-on-push unknown — ${scanOnPush.why}`
  }
}

/**
 * The sentence a surface prints for one image's vulnerabilities.
 *
 * Five arms, five visibly different sentences, and exactly one of them is a clean
 * bill. One renderer for the same reason `describeRead` is one renderer: an
 * unscanned image must not read as "0 findings" on one surface and correctly on
 * another.
 */
export function describeVulnerability(vulnerability: ImageVulnerability): string {
  switch (vulnerability.kind) {
    case "findings": {
      const named = SEVERITIES.filter((s) => vulnerability.counts[s] > 0)
        .map((s) => `${vulnerability.counts[s]} ${s}`)
        .join(", ")
      const sample =
        vulnerability.sampled.length > 0
          ? ` · ${vulnerability.sampled.map((f) => `${f.name} (${f.severity})`).join(", ")}`
          : ""
      return (
        `${vulnerability.total} finding(s): ${named} — from the ${vulnerability.source} read` +
        `${vulnerability.completedAt ? `, scanned ${vulnerability.completedAt}` : ""}` +
        `${sample}${describeTruncation(vulnerability.truncation)}`
      )
    }
    case "clean":
      return (
        `no findings — a completed scan returned nothing (${vulnerability.source} read` +
        `${vulnerability.completedAt ? `, ${vulnerability.completedAt}` : ""})`
      )
    case "not-scanned":
      return `NOT SCANNED — ${vulnerability.why}`
    case "scan-incomplete":
      return `scan ${vulnerability.status} — ${vulnerability.why}`
    case "unknown":
      return `unknown — ${vulnerability.why}`
  }
}

/** The sentence a surface prints for a repository's lifecycle policy. */
export function describeLifecyclePolicy(policy: LifecyclePolicy): string {
  switch (policy.kind) {
    case "policy": {
      const rules = policy.rules
        .map((rule) => {
          const prefix = rule.tagPrefixList.length > 0 ? ` with prefix ${rule.tagPrefixList.join("/")}` : ""
          const bound =
            rule.countType === "sinceImagePushed"
              ? `older than ${rule.countNumber ?? "?"} ${rule.countUnit ?? "unit(s)"}`
              : `beyond the newest ${rule.countNumber ?? "?"}`
          return `#${rule.priority} ${rule.action} ${rule.tagStatus} images${prefix} ${bound}`
        })
        .join("; ")
      return `expires: ${rules}`
    }
    case "absent":
      return `NO LIFECYCLE POLICY — ${policy.why}`
    case "unreadable":
      return `lifecycle policy unreadable — ${policy.why}`
  }
}

/** The sentence a surface prints for one repository's attribution. */
export function describeRepositoryAttribution(attribution: RepositoryAttribution): string {
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

/** The sentence a surface prints for the registry's headline risk. */
export function describeDeployedRisk(state: DeployedRiskState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "no-repositories":
      return "no repositories — this registry holds nothing, so nothing is deployed from it"
    case "vulnerable": {
      const named = state.images
        .map(
          (i) =>
            `${i.repositoryName}@${i.digest.slice(0, 19)} (${i.tags.length > 0 ? i.tags.join(", ") : "untagged"}) ` +
            `${i.counts.CRITICAL} CRITICAL, ${i.counts.HIGH} HIGH`,
        )
        .join("; ")
      const qualifier =
        state.unscanned.length === 0 && state.unreadable.length === 0
          ? ""
          : ` And this is a floor, not a total: ${[
              state.unscanned.length > 0 ? `${state.unscanned.length} repository(ies) do not scan` : "",
              state.unreadable.length > 0 ? `${state.unreadable.length} read(s) did not answer` : "",
            ]
              .filter(Boolean)
              .join(", ")}.`
      return (
        `KNOWN-VULNERABLE — ${state.critical} CRITICAL and ${state.high} HIGH across ` +
        `${state.images.length} image(s): ${named}.${qualifier}`
      )
    }
    case "unverified":
      return `UNVERIFIED — ${state.why}`
    case "clear":
      return (
        `no known vulnerabilities — all ${state.repositoriesScanned} repository(ies) scan on push ` +
        `and all ${state.imagesScanned} image(s) completed a scan with nothing in it`
      )
  }
}

/** The sentence a surface prints for one image. One funnel, so states cannot drift. */
export function describeImage(image: ImageReading): string {
  const tags = image.tags.length > 0 ? image.tags.join(", ") : "untagged"
  const size =
    image.sizeBytes === null ? "size unreported" : `${(image.sizeBytes / 1_048_576).toFixed(1)} MiB`
  return (
    `${image.digest} — ${tags} — pushed ${image.pushedAt ?? "at an unreported time"} — ${size} — ` +
    `${describeVulnerability(image.vulnerability)}`
  )
}

/** The sentence a surface prints for one repository. */
export function describeRepository(repository: RepositoryReading): string {
  const where =
    repository.region && repository.partition
      ? `${repository.region} (partition ${repository.partition})`
      : "region unknown — identity is unresolved and AWS returned no ARN"
  const head =
    `${repository.name} — ${where} — ${describeRepositoryAttribution(repository.attribution)} — ` +
    `${describeScanOnPush(repository.scanOnPush)} · ${describeTagMutability(repository.tagMutability)}`

  const lifecycle =
    repository.lifecycle.state === "ACTUAL" || repository.lifecycle.state === "STALE"
      ? describeLifecyclePolicy(repository.lifecycle.value)
      : describeRead(repository.lifecycle, `${repository.name} lifecycle policy`)

  if (repository.images.state === "ACTUAL" || repository.images.state === "STALE") {
    return (
      `${head} · ${repository.images.value.length} image(s)` +
      `${describeTruncation(repository.imageTruncation)} · ${lifecycle} · as of ${repository.asOf}, ` +
      `images refreshed every ${Math.round(repository.refreshMs.images / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused image list
  // reads as a refusal here exactly as it does everywhere else — never as "0
  // images".
  return `${head} · ${describeRead(repository.images, `${repository.name} images`)} · ${lifecycle}`
}

export interface EcrLine {
  label: string
  text: string
}

/**
 * What an ECR surface prints.
 *
 * The route agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function ecrLines(readings: EcrReadings): readonly EcrLine[] {
  const lines: EcrLine[] = [
    {
      label: "Repositories",
      text:
        describeRead(
          readings.repositories,
          `repositories read from AWS, refreshed every ${Math.round(readings.refreshMs.repositories / 1000)}s`,
        ) + describeTruncation(readings.truncation),
    },
    { label: "Deployed risk", text: describeDeployedRisk(readings.deployedRisk) },
    { label: "Enhanced scanning", text: `unknown — ${readings.enhancedScanning.why}` },
  ]
  for (const collision of readings.tagCollisions) {
    lines.push({
      label: `Tag collision: ${collision.repositoryName}:${collision.tag}`,
      text:
        `the tag ${collision.tag} is on ${collision.digests.length} digests (${collision.digests.join(", ")}). ` +
        `Which one is deployed cannot be answered from a tag.`,
    })
  }
  if (readings.repositories.state === "ACTUAL" || readings.repositories.state === "STALE") {
    for (const repository of readings.repositories.value) {
      lines.push({ label: repository.name, text: describeRepository(repository) })
      if (repository.images.state === "ACTUAL" || repository.images.state === "STALE") {
        for (const image of repository.images.value) {
          lines.push({ label: `${repository.name} image`, text: describeImage(image) })
        }
      }
    }
  }
  return lines
}
