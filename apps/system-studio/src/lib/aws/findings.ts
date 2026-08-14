/**
 * STUDIO-110-006 — security findings, and which of the six products actually
 * answered.
 *
 * The only "findings" the Studio had were documentation discrepancies compiled
 * out of `docs/architecture` — no severity, no dedupe, no affected tenants, no
 * SLA. Nothing in the repository had ever called Security Hub, GuardDuty,
 * Inspector, Macie, Config or Access Analyzer.
 *
 * The design decision that earns this module is the `sources` array. With six
 * products feeding one aggregator, an empty findings list is meaningless on its
 * own: it could mean a clean estate, or five products switched off, or a role
 * that cannot call GetFindings. So the page never renders findings without also
 * rendering, per product, whether it was AGGREGATED, DIRECT, NOT_ENABLED or
 * UNKNOWN.
 *
 * Dedupe is on `Id` + `ProductArn` + the sorted resource ids. Security Hub
 * re-emits a finding on every update, and the same GuardDuty finding arrives
 * again through the aggregator; keying on `Id` alone merges two genuinely
 * different findings that share an id across products, and keying on the whole
 * record merges nothing at all.
 */

import { analyzerReadings, type AnalyzerReadings, type ExternalExposure } from "./analyzer"
import { SECURITY_REFRESH_MS } from "./capabilities"
import {
  complianceReadings,
  describeRecorder,
  type ComplianceReadings,
  type ConfigRuleReading,
} from "./compliance"
import {
  describeTruncation,
  ecrReadings,
  type EcrReadings,
  type RepositoryReading,
  type Severity as EcrSeverity,
} from "./ecr"
import {
  GUARDDUTY_COST_NOTE,
  GUARDDUTY_NOT_ENABLED_REMEDY,
  SEVERITY_ORDER,
  STATUS_UNVERIFIED_CAVEAT,
  describePageBound,
  guardDutyReadings,
  type GuardDutyAttribution,
  type GuardDutyFinding,
  type GuardDutyReadings,
  type SeverityBand,
} from "./guardduty"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import { describeRead, liveGateway, readAws, type AwsGateway, type AwsRead } from "./read"
import {
  attributionOf,
  tagIndex,
  taggedResources,
  type Attribution,
  type TaggedResource,
} from "./tags"

/** The six products the requirement names. Security Hub aggregates all of them. */
export const FINDING_PRODUCTS = [
  "Security Hub",
  "GuardDuty",
  "Inspector",
  "Macie",
  "Config",
  "IAM Access Analyzer",
] as const

export type FindingProduct = (typeof FINDING_PRODUCTS)[number]

export type SourceState = "AGGREGATED" | "DIRECT" | "NOT_ENABLED" | "UNKNOWN"

export interface FindingSource {
  product: FindingProduct
  state: SourceState
  deniedAction?: string
  minimumStatement?: string
  detail: string
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL"

/** Hours a severity band may sit open before it is past its SLA. */
export const SEVERITY_SLA_HOURS: Readonly<Record<Severity, number>> = {
  CRITICAL: 24,
  HIGH: 72,
  MEDIUM: 336,
  LOW: 720,
  INFORMATIONAL: Number.POSITIVE_INFINITY,
}

export interface SecurityFinding {
  /** `Id`+`ProductArn`+resources — the dedupe key, kept so a page can show it. */
  key: string
  id: string
  productArn: string
  product: string
  title: string
  severity: Severity
  firstObservedAt: string
  recordState: string
  resourceIds: readonly string[]
  /** Resolved from the `tenure:tenant` tag. Untagged is SHARED, never dropped. */
  affects: Attribution
  ageHours: number
  pastSla: boolean
}

interface GetFindingsResponse {
  Findings?: Array<{
    Id?: string
    ProductArn?: string
    ProductName?: string
    Title?: string
    Description?: string
    /**
     * ASFF's finding-type taxonomy — `TTPs/Discovery/Recon:EC2-PortProbe…`.
     *
     * Read for the pipeline, NOT for `SecurityFinding`: adding a field to that
     * interface would break the two files that construct it as an object literal
     * (`src/app/platform/security/posture.test.ts:62` and
     * `e2e/security-page-logic.spec.ts:49`). The extras live in a side map keyed
     * by the dedupe key instead — see `HubExtra`.
     */
    Types?: string[]
    Severity?: { Label?: string; Original?: string; Normalized?: number }
    FirstObservedAt?: string
    LastObservedAt?: string
    UpdatedAt?: string
    CreatedAt?: string
    RecordState?: string
    AwsAccountId?: string
    Region?: string
    Workflow?: { Status?: string }
    Remediation?: { Recommendation?: { Text?: string; Url?: string } }
    Resources?: Array<{ Id?: string; Type?: string; Region?: string; Partition?: string }>
  }>
  NextToken?: string
}

/**
 * The ASFF fields the pipeline needs and `SecurityFinding` cannot carry.
 *
 * Keyed by `findingKey(...)`, populated in the same loop that builds the
 * `SecurityFinding`s, so the two can never fall out of step by one record.
 */
interface HubExtra {
  types: readonly string[]
  description: string | null
  severityLabel: string | null
  severityOriginal: string | null
  severityNormalized: number | null
  lastObservedAt: string | null
  updatedAt: string | null
  remediationText: string | null
  remediationUrl: string | null
  workflowStatus: string | null
  accountId: string | null
  region: string | null
  partition: string | null
}

/** Security Hub's own word for "the hub is not switched on in this account". */
const NOT_ENABLED_NAMES = new Set(["InvalidAccessException", "ResourceNotFoundException"])

/**
 * The dedupe key.
 *
 * All three components, and the ProductArn is load-bearing: two products can
 * emit findings with the same `Id` for the same resource — a Config rule and a
 * Security Hub standard control routinely do — and merging them hides one.
 */
export function findingKey(input: {
  id: string
  productArn: string
  resourceIds: readonly string[]
}): string {
  return [input.id, input.productArn, [...input.resourceIds].sort().join("|")].join("::")
}

function severityOf(label: string | undefined): Severity {
  switch ((label ?? "").toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL"
    case "HIGH":
      return "HIGH"
    case "MEDIUM":
      return "MEDIUM"
    case "LOW":
      return "LOW"
    default:
      // Never a numeric guess from `Severity.Normalized`. An unlabelled finding
      // is informational until a product says otherwise; inventing HIGH from a
      // number is how a page cries wolf.
      return "INFORMATIONAL"
  }
}

export interface SecuritySurface {
  identity: AwsRead<Identity>
  read: AwsRead<readonly SecurityFinding[]>
  findings: readonly SecurityFinding[]
  sources: readonly FindingSource[]
  headline: string
  /** How many raw records collapsed into `findings`. Stated, not hidden. */
  duplicatesRemoved: number
  asOf: string
  refreshMs: number
  /**
   * Every source now readable, normalised to one shape and deduplicated across
   * sources — Security Hub, GuardDuty, Access Analyzer, ECR image scans and
   * Config rule non-compliance. See the pipeline section at the foot of this
   * file.
   *
   * REQUIRED, not optional. `SecuritySurface` has no construction site outside
   * this module — grepped, and the only two things that build a literal of a
   * type exported from here build `SecurityFinding` and `FindingSource`, which
   * this change does not touch — so a required field cannot be silently omitted
   * by a caller the compiler never sees.
   */
  pipeline: FindingsPipeline
}

export async function securityFindings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<SecuritySurface> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const tags = tagIndex(tagged.state === "ACTUAL" ? tagged.value : [])

  let raw = 0
  let hubNotEnabled = false
  const hubExtras = new Map<string, HubExtra>()

  const read = await readAws<readonly SecurityFinding[]>(
    "securityhub:GetFindings",
    async () => {
      const byKey = new Map<string, SecurityFinding>()
      let token: string | undefined
      try {
        do {
          const response = (await gw.call("securityhub:GetFindings", {
            NextToken: token,
          })) as GetFindingsResponse

          for (const finding of response?.Findings ?? []) {
            raw += 1
            const id = finding.Id ?? ""
            const productArn = finding.ProductArn ?? ""
            const resourceIds = (finding.Resources ?? [])
              .map((r) => r.Id ?? "")
              .filter(Boolean)
            const key = findingKey({ id, productArn, resourceIds })
            if (byKey.has(key)) continue

            const firstObservedAt = finding.FirstObservedAt ?? finding.CreatedAt ?? now().toISOString()
            const ageHours = Math.max(
              0,
              (now().getTime() - Date.parse(firstObservedAt)) / 3_600_000,
            )
            const severity = severityOf(finding.Severity?.Label)

            byKey.set(key, {
              key,
              id,
              productArn,
              product: finding.ProductName ?? productArn,
              title: finding.Title ?? "(untitled finding)",
              severity,
              firstObservedAt,
              recordState: finding.RecordState ?? "ACTIVE",
              resourceIds,
              affects: attributionOf(tags.get(resourceIds[0] ?? "") ?? {}),
              ageHours,
              pastSla: ageHours > SEVERITY_SLA_HOURS[severity],
            })

            hubExtras.set(key, {
              types: (finding.Types ?? []).filter(
                (t): t is string => typeof t === "string" && t.trim() !== "",
              ),
              description: text(finding.Description),
              severityLabel: text(finding.Severity?.Label),
              severityOriginal: text(finding.Severity?.Original),
              severityNormalized:
                typeof finding.Severity?.Normalized === "number" &&
                Number.isFinite(finding.Severity.Normalized)
                  ? finding.Severity.Normalized
                  : null,
              lastObservedAt: text(finding.LastObservedAt) ?? text(finding.UpdatedAt),
              updatedAt: text(finding.UpdatedAt),
              remediationText: text(finding.Remediation?.Recommendation?.Text),
              remediationUrl: text(finding.Remediation?.Recommendation?.Url),
              workflowStatus: text(finding.Workflow?.Status),
              accountId: text(finding.AwsAccountId),
              region:
                text(finding.Region) ??
                text((finding.Resources ?? []).map((r) => r.Region).find(Boolean)),
              // The partition is the resource's own, when ASFF carried one. Never
              // the literal "aws" — GE-010-007 was a residency defect caused by
              // exactly that fallback.
              partition: text((finding.Resources ?? []).map((r) => r.Partition).find(Boolean)),
            })
          }
          token = response?.NextToken || undefined
        } while (token)
      } catch (error) {
        if (NOT_ENABLED_NAMES.has((error as { name?: string })?.name ?? "")) {
          hubNotEnabled = true
          return []
        }
        throw error
      }
      return [...byKey.values()]
    },
    { now, denial, isEmpty: () => false },
  )

  const findings = read.state === "ACTUAL" || read.state === "STALE" ? read.value : []
  const asOf = now().toISOString()
  const sources = sourcesFor(read, hubNotEnabled)

  const headline =
    read.state === "DENIED"
      ? `unknown — this engine's role was refused ${read.action} (${read.errorCode}) as ${read.principal}. ` +
        `Minimum statement: ${read.minimumStatement}. No findings table is shown, because none was read.`
      : hubNotEnabled
        ? `Security Hub is not enabled in this account, so none of ${FINDING_PRODUCTS.length} products could be read through it, as of ${asOf}`
        : read.state === "THROTTLED"
          ? `throttled — AWS rate-limited securityhub:GetFindings; retrying in ${read.retryAfterMs}ms`
          : read.state === "ERROR"
            ? `error — ${read.code}: ${read.safeDetail}`
            : findings.length === 0
              ? `no open findings from ${FINDING_PRODUCTS.length} sources, as of ${asOf}`
              : `${findings.length} open finding(s) from ${FINDING_PRODUCTS.length} sources, as of ${asOf}` +
                `${raw > findings.length ? ` — ${raw - findings.length} duplicate record(s) collapsed` : ""}`

  /*
   * The pipeline runs from HERE, on the reading this function already performed,
   * rather than re-reading Security Hub: `hub` is handed in built, so the
   * aggregator is called once per load and the four direct sources are added to
   * it. `identity` and `tagged` travel for the same reason.
   */
  const pipeline = await findingsPipeline(
    supplied,
    {
      identity,
      tagged,
      hub: hubContributionFrom({
        read,
        hubNotEnabled,
        extras: hubExtras,
        tagged,
        asOf,
      }),
    },
    { now },
  )

  return {
    identity,
    read,
    findings,
    sources,
    headline,
    duplicatesRemoved: Math.max(0, raw - findings.length),
    asOf,
    refreshMs: SECURITY_REFRESH_MS,
    pipeline,
  }
}

/**
 * Per-product state.
 *
 * When the hub answered, every product it aggregates is AGGREGATED. When the hub
 * is off, every product is NOT_ENABLED *through the hub* and the page says which
 * ones it therefore could not read. When the call was refused, every product is
 * UNKNOWN — not one of them is reported as clean.
 */
function sourcesFor(read: AwsRead<readonly SecurityFinding[]>, hubNotEnabled: boolean): readonly FindingSource[] {
  return FINDING_PRODUCTS.map((product): FindingSource => {
    if (read.state === "DENIED") {
      return {
        product,
        state: "UNKNOWN",
        deniedAction: read.action,
        minimumStatement: read.minimumStatement,
        detail: `not read — ${read.action} was refused (${read.errorCode}).`,
      }
    }
    if (read.state === "THROTTLED" || read.state === "ERROR" || read.state === "UNCONFIGURED") {
      return { product, state: "UNKNOWN", detail: `not read — the aggregator call did not complete (${read.state}).` }
    }
    if (hubNotEnabled) {
      return {
        product,
        state: "NOT_ENABLED",
        detail:
          product === "Security Hub"
            ? "Security Hub is not enabled in this account."
            : `not readable — ${product} publishes through Security Hub, which is not enabled here.`,
      }
    }
    return { product, state: "AGGREGATED", detail: "read through Security Hub's aggregated findings." }
  })
}

/* ══════════════════════════ ONE FINDINGS PIPELINE ═════════════════════════ */

/**
 * STUDIO-110-006 (extension) — every source that produces a security finding,
 * normalised to one shape, deduplicated across sources, and honest about which
 * of them was not checking at all.
 *
 * ## Why a second shape in the same file
 *
 * `SecurityFinding` above is Security Hub's record, and it stays exactly as it
 * is: two files construct it as an object literal
 * (`src/app/platform/security/posture.test.ts:62` and
 * `e2e/security-page-logic.spec.ts:49`) and adding a field to it would red their
 * `tsc` for a reason that has nothing to do with them. The pipeline is therefore
 * an ADDITION — `NormalisedFinding` — and the only change to an existing
 * exported type is one REQUIRED field on `SecuritySurface`, which has no
 * construction site outside this module.
 *
 * ## Five sources, and only one of them is an aggregator
 *
 * Security Hub INGESTS GuardDuty. Reading both and concatenating counts the same
 * threat twice, and a doubled critical count is a number an operator plans
 * against. So rows are keyed on `resource ARN + finding type` and collapsed —
 * and when a row was seen by more than one source that is recorded rather than
 * discarded, because two independent products agreeing is information. It is on
 * `NormalisedFinding.seenBy`, and every contributing record survives whole in
 * `contributions`.
 *
 * A finding with NO resource ARN, or with no type its source stated, cannot be
 * joined on. Those key on `source + id` and never merge with anything: guessing
 * that two ARN-less findings are the same finding is how a real one disappears.
 *
 * ## One severity scale, with the native value beside it
 *
 * The normalised scale is `SeverityBand` from `guardduty.ts` — imported, not
 * re-declared, so there is one vocabulary and not two that drift. `UNRANKED`
 * sorts ABOVE critical, which is that module's deliberate decision and is the
 * right one here for a further reason: Access Analyzer and AWS Config publish NO
 * severity at all. An active external-access finding and a failing Config rule
 * are therefore UNRANKED, and land at the top of the table rather than being
 * assigned a severity this engine invented.
 *
 * Every contribution carries `native`: the source's own scale, its own value
 * verbatim, its numeric form where it has one, and the sentence describing how
 * the mapping was made. Nobody has to trust the mapping blindly, because the
 * input to it is on the row.
 *
 * ## A source that is not enabled contributes a MARKER, never a zero
 *
 * This is the whole point. A GuardDuty detector that does not exist, an account
 * with no analyzer, a repository with `scanOnPush` off and a Config rule at
 * `INSUFFICIENT_DATA` all produce no findings, and through a naive pipeline all
 * four render as a clean estate. So `SourceContribution.state` is `NOT_CHECKED`
 * for those, `findings` is empty BY CONSTRUCTION on that arm, and at least one
 * `SourceCaveat` naming the reason is required — `notCheckedContribution` is the
 * only way to build one and it cannot produce a caveat-free marker.
 *
 * A source can also answer PARTLY: GuardDuty with one detector refused, ECR with
 * a repository that does not scan, Config with rules that have evaluated
 * nothing. Those are `REPORTED` with caveats, because dropping the whole source
 * would hide the findings it did return and reporting it clean would hide the
 * hole.
 */

/* ------------------------------------------------------------- vocabulary -- */

/** Every source this pipeline reads, in the order a surface prints them. */
export const PIPELINE_SOURCES = [
  "securityhub",
  "guardduty",
  "access-analyzer",
  "ecr-image-scan",
  "config",
] as const

export type PipelineSourceId = (typeof PIPELINE_SOURCES)[number]

/** What each source is called in a sentence. One spelling, in one place. */
export const PIPELINE_SOURCE_LABEL: Readonly<Record<PipelineSourceId, string>> = {
  securityhub: "Security Hub",
  guardduty: "GuardDuty",
  "access-analyzer": "IAM Access Analyzer",
  "ecr-image-scan": "ECR image scan",
  config: "AWS Config",
}

/** The IAM action whose refusal makes each source unreadable. AWS's spelling. */
export const PIPELINE_SOURCE_ACTION: Readonly<Record<PipelineSourceId, string>> = {
  securityhub: "securityhub:GetFindings",
  guardduty: "guardduty:ListDetectors",
  "access-analyzer": "access-analyzer:ListAnalyzers",
  "ecr-image-scan": "ecr:DescribeRepositories",
  config: "config:DescribeConfigRules",
}

/**
 * The one normalised scale, adopted from `guardduty.ts` rather than re-declared.
 *
 * Two unions with the same six arms is two vocabularies to keep in step, which
 * is the failure `read.ts` exists to prevent one level down.
 */
export type NormalisedSeverity = SeverityBand

/** Worst first. `UNRANKED` is 0 — above CRITICAL. See `guardduty.ts`'s header. */
export const NORMALISED_SEVERITY_ORDER: Readonly<Record<NormalisedSeverity, number>> =
  SEVERITY_ORDER

/**
 * Which tenant a finding is about.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied. Structurally identical to
 * the union `guardduty.ts`, `analyzer.ts`, `ecr.ts` and `compliance.ts` each
 * declare, and imported from one of them so it stays that way by construction.
 */
export type PipelineAttribution = GuardDutyAttribution

/**
 * The source's own severity, carried beside the normalised one.
 *
 * All four fields, always. `value` null means the source returned no severity,
 * which is a fact, and `mapping` is the sentence that lets a reader check the
 * normalisation instead of trusting it.
 */
export interface NativeSeverity {
  /** What the source calls its scale, in the source's own words. */
  scale: string
  /** The source's own value, VERBATIM. Null when it published none. */
  value: string | null
  /** The numeric form, where the scale is numeric. Null otherwise. */
  numeric: number | null
  /** How `value` became the normalised band. Stated, so it is checkable. */
  mapping: string
}

/** Everything about a finding that is peculiar to the source that found it. */
export type SourceDetail =
  | {
      source: "securityhub"
      productArn: string
      productName: string
      recordState: string
      workflowStatus: string | null
      /** ASFF's whole `Types` array, not just the one used as the key. */
      types: readonly string[]
      ageHours: number
      pastSla: boolean
      slaHours: number
    }
  | {
      source: "guardduty"
      detectorId: string
      description: string | null
      occurrences: number | null
      archived: boolean | null
      serviceName: string | null
      featureName: string | null
      /** Travels with every GuardDuty row: detector status is not readable. */
      statusCaveat: string
    }
  | {
      source: "access-analyzer"
      analyzerArn: string
      findingStatus: string
      resourceType: string
      resourceOwnerAccount: string | null
      /** AWS's own error string on an Error finding. Null when there is none. */
      error: string | null
      /** Not readable without access-analyzer:GetFindingV2. Said, not defaulted. */
      externalPrincipal: string
      exposedAction: string
    }
  | {
      source: "ecr-image-scan"
      repositoryName: string
      imageDigest: string
      imageTags: readonly string[]
      packageName: string | null
      packageVersion: string | null
      /** Whether the counts came free with the listing or from a detail read. */
      scanSource: "summary" | "detail"
      /** Basic vs enhanced scanning is not readable. Said on every row. */
      scanningCoverageCaveat: string
    }
  | {
      source: "config"
      ruleName: string
      ruleOwner: string | null
      sourceIdentifier: string | null
      ruleState: string | null
      /** Config's own count. Null when it stated none — never a zero. */
      nonCompliantResources: number | null
      /** AWS's own `CapExceeded`: the count is a floor, not a total. */
      countCapped: boolean
    }

/** One source's record of one finding, before any merge. Nothing is lost here. */
export interface FindingContribution {
  source: PipelineSourceId
  /** The source's own id for it. */
  id: string
  /**
   * The source's own finding type, VERBATIM. Null when the source stated none —
   * ASFF findings without a `Types` array are real. A null type cannot be joined
   * on, and `dedupeKey` says so rather than inventing one.
   */
  type: string | null
  /** Where `type` came from, or why there is none. */
  typeProvenance: string
  title: string
  severity: NormalisedSeverity
  native: NativeSeverity
  /** The resource this is about. Null when the source named none. */
  resourceArn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  resourceProvenance: string
  /** A human handle for the resource, when there is one. */
  resourceLabel: string | null
  attribution: PipelineAttribution
  firstSeen: string | null
  lastSeen: string | null
  /** What to do about it. Never invented — see each normaliser. */
  remedy: string
  accountId: string | null
  region: string | null
  partition: string | null
  detail: SourceDetail
}

/** Why a source's answer is partial, or why it is not an answer at all. */
export interface SourceCaveat {
  /**
   * NOT_ENABLED — the control is not running, so its silence is not evidence.
   * UNREADABLE — the call was refused, throttled or broken.
   * CAPPED — this engine stopped reading before the source ran out.
   * UNVERIFIED — it answered, and something about the answer is not checkable.
   */
  reason: "NOT_ENABLED" | "UNREADABLE" | "CAPPED" | "UNVERIFIED"
  detail: string
}

/**
 * What one source put into the pipeline.
 *
 * `NOT_CHECKED` is the marker the requirement names. On that arm `findings` is
 * empty and `caveats` is non-empty, both by construction —
 * `notCheckedContribution` is the only constructor and it takes the caveat as an
 * argument.
 */
export interface SourceContribution {
  source: PipelineSourceId
  state: "REPORTED" | "NOT_CHECKED"
  findings: readonly FindingContribution[]
  caveats: readonly SourceCaveat[]
  /** What was read, or what was not, in one sentence. */
  detail: string
  /** The IAM action to grant, when a refusal is why. Null otherwise. */
  action: string | null
  /** A pasteable minimum statement, when the read was DENIED. Null otherwise. */
  minimumStatement: string | null
  /** What to do to make this source check. Null when it already is. */
  remedy: string | null
}

/** One row of the unified table: every source that saw it, merged once. */
export interface NormalisedFinding {
  /** `resource ARN::type`, or an un-joinable key. See `dedupeKey`. */
  key: string
  /** The source whose record supplied the merged fields. See `PRIMARY_RANK`. */
  source: PipelineSourceId
  /** Every source that reported it. Length > 1 is corroboration. */
  seenBy: readonly PipelineSourceId[]
  corroborated: boolean
  /** The sentence a surface prints about that agreement. */
  corroboration: string
  id: string
  type: string | null
  typeProvenance: string
  title: string
  /** Worst band any source gave it, ignoring UNRANKED unless that is all there is. */
  severity: NormalisedSeverity
  /** The primary source's native severity. Every source's is in `contributions`. */
  native: NativeSeverity
  resourceArn: string | null
  resourceProvenance: string
  resourceLabel: string | null
  attribution: PipelineAttribution
  /** Earliest first-seen any source stated. Null when none stated one. */
  firstSeen: string | null
  /** Latest last-seen any source stated. Null when none stated one. */
  lastSeen: string | null
  remedy: string
  accountId: string | null
  region: string | null
  partition: string | null
  detail: SourceDetail
  /** Every contributing record, whole. Nothing is flattened away. */
  contributions: readonly FindingContribution[]
}

/** One band's count, for a surface that ranks. */
export interface SeverityTally {
  severity: NormalisedSeverity
  count: number
}

/** The whole pipeline, in one value. */
export interface FindingsPipeline {
  /** Every source, in `PIPELINE_SOURCES` order, reported or not. Never filtered. */
  sources: readonly SourceContribution[]
  /** Deduplicated and ranked, worst first. */
  findings: readonly NormalisedFinding[]
  /** Records that merged into another row. Stated, never hidden. */
  duplicatesCollapsed: number
  /** The rows more than one source saw. */
  corroborated: readonly NormalisedFinding[]
  /** The sources that contributed a marker rather than findings. */
  notChecked: readonly SourceContribution[]
  /** Sources that answered but not completely. */
  partial: readonly SourceContribution[]
  counts: readonly SeverityTally[]
  headline: string
  asOf: string
}

/* ---------------------------------------------------------------- helpers -- */

/** A non-empty string, or null. Used from `securityFindings` too — hoisted. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/**
 * Which source's record supplies the merged row's fields.
 *
 * The DIRECT reader wins over the aggregator, always. Security Hub's copy of a
 * GuardDuty finding has neither the detector id nor the occurrence count nor the
 * event window; the product's own record has all three. Ranking the aggregator
 * last is therefore not a preference, it is the choice that loses least.
 */
const PRIMARY_RANK: Readonly<Record<PipelineSourceId, number>> = {
  guardduty: 0,
  "access-analyzer": 1,
  "ecr-image-scan": 2,
  config: 3,
  securityhub: 4,
}

/**
 * The dedupe key: resource ARN plus finding type.
 *
 * Both, and only both. Keying on the ARN alone merges a port probe and an
 * unpatched CVE on the same instance into one row; keying on the type alone
 * merges the same CVE on forty images. A record missing either cannot be joined
 * at all, and gets a key that provably collides with nothing — the source and
 * the source's own id — rather than being dropped or bundled with the other
 * un-joinable records.
 */
export function dedupeKey(contribution: FindingContribution): string {
  if (contribution.resourceArn && contribution.type) {
    return `${contribution.resourceArn}::${contribution.type}`
  }
  return `unjoinable::${contribution.source}::${contribution.id}`
}

/**
 * The worst band any source gave a row.
 *
 * `UNRANKED` is skipped unless it is all there is: a source that published no
 * severity has not said "low", and it has not said "critical" either, so a
 * source that DID publish one is better evidence. The UNRANKED contribution is
 * still on the row, in `contributions`, with its own `native`.
 */
export function mergeSeverity(
  contributions: readonly FindingContribution[],
): NormalisedSeverity {
  const ranked = contributions
    .map((c) => c.severity)
    .filter((s): s is NormalisedSeverity => s !== "UNRANKED")
  if (ranked.length === 0) return "UNRANKED"
  return ranked.reduce((worst, s) =>
    NORMALISED_SEVERITY_ORDER[s] < NORMALISED_SEVERITY_ORDER[worst] ? s : worst,
  )
}

/** The earliest of a set of timestamps, ignoring the ones nobody stated. */
function earliest(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => typeof v === "string" && v !== "")
  if (present.length === 0) return null
  return present.reduce((min, v) => (v < min ? v : min))
}

/** The latest of a set of timestamps, ignoring the ones nobody stated. */
function latest(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => typeof v === "string" && v !== "")
  if (present.length === 0) return null
  return present.reduce((max, v) => (v > max ? v : max))
}

/** A source that answered. */
function reportedContribution(
  source: PipelineSourceId,
  findings: readonly FindingContribution[],
  caveats: readonly SourceCaveat[],
  detail: string,
): SourceContribution {
  return {
    source,
    state: "REPORTED",
    findings,
    caveats,
    detail,
    action: null,
    minimumStatement: null,
    remedy: null,
  }
}

/**
 * A source that did NOT answer, as a marker.
 *
 * The only constructor for the `NOT_CHECKED` arm, and it takes the caveat rather
 * than defaulting one — so a marker with no reason on it is not a thing this
 * module can build. `findings` is `[]` here and nowhere else assigns it, which is
 * what makes "never zero findings" a property of the code and not of a comment.
 */
function notCheckedContribution(
  source: PipelineSourceId,
  caveat: SourceCaveat,
  remedy: string,
  extra: { action: string | null; minimumStatement: string | null } = {
    action: null,
    minimumStatement: null,
  },
): SourceContribution {
  return {
    source,
    state: "NOT_CHECKED",
    findings: [],
    caveats: [caveat],
    detail: caveat.detail,
    action: extra.action ?? PIPELINE_SOURCE_ACTION[source],
    minimumStatement: extra.minimumStatement,
    remedy,
  }
}

/** A denied read's action and minimum statement, or nulls. One place. */
function denialOf(read: AwsRead<unknown>): {
  action: string | null
  minimumStatement: string | null
} {
  return read.state === "DENIED"
    ? { action: read.action, minimumStatement: read.minimumStatement }
    : { action: null, minimumStatement: null }
}

/* ------------------------------------------------------- Security Hub -- (1) */

/** Security Hub's ASFF label, normalised. An absent label is UNRANKED, not LOW. */
export function hubSeverity(label: string | null): NormalisedSeverity {
  switch ((label ?? "").toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL"
    case "HIGH":
      return "HIGH"
    case "MEDIUM":
      return "MEDIUM"
    case "LOW":
      return "LOW"
    case "INFORMATIONAL":
      return "INFORMATIONAL"
    default:
      /*
       * Deliberately NOT `severityOf`'s answer.
       *
       * `severityOf` returns INFORMATIONAL for an unlabelled finding, because
       * `SecurityFinding.severity` is typed `Severity`, which has no UNRANKED
       * arm and cannot grow one without breaking the two files that build a
       * `SecurityFinding` literal. On the pipeline's six-band scale the honest
       * answer is available, so it is used: a severity AWS did not publish is
       * not an informational one. Both answers are visible on the row — this one
       * as `severity`, the label AWS actually sent as `native.value`.
       */
      return "UNRANKED"
  }
}

/** Attribution for a Security Hub row, with `unknown` when the tag read failed. */
function hubAttribution(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): PipelineAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return { kind: "unknown", why: `tags were not read — ${describeRead(tagged, "the tag index")}` }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this finding names no resource ARN to join against the tag index. Unattributed would be a " +
        "claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) return { kind: "unattributed" }
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
 * Security Hub's findings, normalised.
 *
 * Pure: it takes the reading `securityFindings` already performed rather than
 * making a second `securityhub:GetFindings` call, which would double the cost of
 * a page load and could return a different set of records than the table above
 * it is drawn from.
 */
export function hubContributionFrom(input: {
  read: AwsRead<readonly SecurityFinding[]>
  hubNotEnabled: boolean
  extras: ReadonlyMap<string, HubExtra>
  tagged: AwsRead<readonly TaggedResource[]>
  asOf: string
}): SourceContribution {
  const { read, hubNotEnabled, extras, tagged } = input

  if (hubNotEnabled) {
    return notCheckedContribution(
      "securityhub",
      {
        reason: "NOT_ENABLED",
        detail:
          "Security Hub is not enabled in this account. It aggregates GuardDuty, Inspector, Macie, " +
          "Config and IAM Access Analyzer, so its silence is the silence of six products and not a " +
          "clean estate.",
      },
      "Enable Security Hub in this region (securityhub:EnableSecurityHub), or read each product " +
        "directly. This pipeline already reads GuardDuty, Access Analyzer, ECR and Config directly, " +
        "so the hub being off narrows what is covered rather than blanking it.",
    )
  }

  if (read.state !== "ACTUAL" && read.state !== "STALE" && read.state !== "EMPTY") {
    return notCheckedContribution(
      "securityhub",
      { reason: "UNREADABLE", detail: describeRead(read, "the Security Hub findings") },
      "Grant the action named here to this engine's role and reload. Until then Security Hub has " +
        "contributed nothing, which is not the same as its having found nothing.",
      denialOf(read),
    )
  }

  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )
  const findings = read.state === "EMPTY" ? [] : read.value
  const contributions = findings.map((finding): FindingContribution => {
    const extra = extras.get(finding.key)
    const arn = finding.resourceIds.find((id) => id.startsWith("arn:")) ?? null
    const type = extra?.types[0] ?? null
    return {
      source: "securityhub",
      id: finding.id,
      type,
      typeProvenance: type
        ? "ASFF's own Types[0], verbatim"
        : "Security Hub returned no Types array on this finding, so there is no type to join on and " +
          "this row is keyed on the source and the finding id instead",
      title: finding.title,
      severity: hubSeverity(extra?.severityLabel ?? null),
      native: {
        scale: "Security Hub ASFF Severity.Label (CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL)",
        value: extra?.severityLabel ?? null,
        numeric: extra?.severityNormalized ?? null,
        mapping:
          "the label is carried across unchanged. A finding Security Hub sent with no label is " +
          "UNRANKED here — not INFORMATIONAL — and Severity.Normalized (0-100) is shown beside it " +
          "rather than being turned into a band this engine chose.",
      },
      resourceArn: arn,
      resourceProvenance: arn
        ? "the first ASFF Resources[].Id that is an ARN"
        : `the finding's Resources block carried no ARN (${finding.resourceIds.length} id(s): ` +
          `${finding.resourceIds.join(", ") || "none"})`,
      resourceLabel: finding.resourceIds[0] ?? null,
      attribution: hubAttribution(arn, tagged, index),
      firstSeen: finding.firstObservedAt,
      lastSeen: extra?.lastObservedAt ?? null,
      remedy:
        extra?.remediationText ??
        `Security Hub published no Remediation.Recommendation on this finding. Open finding ` +
          `${finding.id} from ${finding.product} in the Security Hub console for the control's own ` +
          `guidance — this engine states none it was not given.`,
      accountId: extra?.accountId ?? null,
      region: extra?.region ?? null,
      partition: extra?.partition ?? null,
      detail: {
        source: "securityhub",
        productArn: finding.productArn,
        productName: finding.product,
        recordState: finding.recordState,
        workflowStatus: extra?.workflowStatus ?? null,
        types: extra?.types ?? [],
        ageHours: finding.ageHours,
        pastSla: finding.pastSla,
        slaHours: SEVERITY_SLA_HOURS[finding.severity],
      },
    }
  })

  const caveats: SourceCaveat[] = []
  if (read.state === "STALE") {
    caveats.push({
      reason: "UNVERIFIED",
      detail: `these rows are held from ${read.asOf} and were not re-read.`,
    })
  }
  caveats.push({
    reason: "UNVERIFIED",
    detail:
      "Security Hub aggregates other products. A row here that also appears from a direct reader is " +
      "the SAME threat, and this pipeline collapses the pair rather than counting it twice.",
  })

  return reportedContribution(
    "securityhub",
    contributions,
    caveats,
    `securityhub:GetFindings answered with ${contributions.length} finding(s).`,
  )
}

/* ---------------------------------------------------------- GuardDuty -- (2) */

/** GuardDuty's findings, normalised. Pure — the read is done by its own module. */
export function guardDutyContributionFrom(readings: GuardDutyReadings): SourceContribution {
  const posture = readings.posture

  if (posture.kind === "not-enabled") {
    return notCheckedContribution(
      "guardduty",
      {
        reason: "NOT_ENABLED",
        detail:
          "guardduty:ListDetectors answered and there is NO detector in this region. Nothing is " +
          "analysing this account's CloudTrail management events, VPC flow logs or DNS queries for " +
          "a compromise, so the absence of a GuardDuty row below is explained by that.",
      },
      `${GUARDDUTY_NOT_ENABLED_REMEDY} ${GUARDDUTY_COST_NOTE}`,
    )
  }

  if (posture.kind === "unknown") {
    return notCheckedContribution(
      "guardduty",
      { reason: "UNREADABLE", detail: posture.why },
      "Grant the action named here to this engine's role and reload. Until then this pipeline " +
        "cannot say whether anything is watching the account.",
      denialOf(readings.detectors),
    )
  }

  const contributions: FindingContribution[] = []
  const caveats: SourceCaveat[] = [{ reason: "UNVERIFIED", detail: STATUS_UNVERIFIED_CAVEAT }]

  if (readings.detectors.state === "ACTUAL" || readings.detectors.state === "STALE") {
    for (const detector of readings.detectors.value) {
      if (detector.findings.state === "ACTUAL" || detector.findings.state === "STALE") {
        for (const finding of detector.findings.value) {
          contributions.push(guardDutyFindingContribution(finding))
        }
      } else if (detector.findings.state !== "EMPTY") {
        caveats.push({
          reason: "UNREADABLE",
          detail:
            `detector ${detector.detectorId}: ` +
            describeRead(detector.findings, `detector ${detector.detectorId}'s findings`),
        })
      }
      if (detector.idPages.kind === "capped") {
        caveats.push({
          reason: "CAPPED",
          detail: `detector ${detector.detectorId}: ${describePageBound(detector.idPages)}`,
        })
      }
      if (detector.unhydrated.length > 0) {
        caveats.push({
          reason: "UNREADABLE",
          detail:
            `detector ${detector.detectorId}: ${detector.unhydrated.length} listed finding(s) were ` +
            `not returned by GetFindings and are NOT counted (${detector.unhydrated.join(", ")}).`,
        })
      }
    }
  }
  if (readings.detectorPages.kind === "capped") {
    caveats.push({ reason: "CAPPED", detail: describePageBound(readings.detectorPages) })
  }

  return reportedContribution(
    "guardduty",
    contributions,
    caveats,
    `${posture.detectorIds.length} detector(s) answered with ${contributions.length} finding(s).`,
  )
}

function guardDutyFindingContribution(finding: GuardDutyFinding): FindingContribution {
  return {
    source: "guardduty",
    id: finding.id,
    // AWS's own type — `UnauthorizedAccess:EC2/SSHBruteForce`. Never a paraphrase:
    // this string is what an operator pastes into the GuardDuty documentation.
    type: finding.type,
    typeProvenance: "GuardDuty's own finding Type, verbatim",
    title: finding.title ?? finding.type,
    severity: finding.band,
    native: {
      scale: "GuardDuty Severity, 0.0-10.0",
      value: finding.severity === null ? null : String(finding.severity),
      numeric: finding.severity,
      mapping:
        "AWS's published bands: 9.0-10.0 CRITICAL, 7.0-8.9 HIGH, 4.0-6.9 MEDIUM, 1.0-3.9 LOW, " +
        "0.1-0.9 INFORMATIONAL. A severity that was absent, non-numeric or outside 0-10 is UNRANKED " +
        "and sorts ABOVE critical rather than below informational.",
    },
    resourceArn: finding.resource.arn,
    resourceProvenance: finding.resource.provenance,
    resourceLabel: finding.resource.identifier,
    attribution: finding.attribution,
    firstSeen: finding.firstSeen ?? finding.createdAt,
    lastSeen: finding.lastSeen ?? finding.updatedAt,
    remedy:
      `Investigate ${finding.type} on ` +
      `${finding.resource.identifier ?? finding.resource.arn ?? "the named resource"} in the ` +
      `GuardDuty console. guardduty:GetFindings returns no remediation field, so no fix is stated ` +
      `here that AWS did not supply — the finding type is the handle for AWS's own published ` +
      `remediation for it.`,
    accountId: finding.accountId,
    region: finding.region,
    partition: finding.partition,
    detail: {
      source: "guardduty",
      detectorId: finding.detectorId,
      description: finding.description,
      occurrences: finding.occurrences,
      archived: finding.archived,
      serviceName: finding.serviceName,
      featureName: finding.featureName,
      statusCaveat: STATUS_UNVERIFIED_CAVEAT,
    },
  }
}

/* ---------------------------------------------------- Access Analyzer -- (3) */

/** Access Analyzer's external-access findings, normalised. Pure. */
export function analyzerContributionFrom(readings: AnalyzerReadings): SourceContribution {
  const state = readings.externalAccess

  if (state.kind === "unknown") {
    return notCheckedContribution(
      "access-analyzer",
      { reason: "UNREADABLE", detail: state.why },
      state.remedy,
      denialOf(readings.analyzers),
    )
  }
  if (state.kind === "no-analyzer" || state.kind === "not-answering") {
    return notCheckedContribution(
      "access-analyzer",
      { reason: "NOT_ENABLED", detail: state.why },
      state.remedy,
    )
  }
  if (state.kind === "findings-unreadable") {
    return notCheckedContribution(
      "access-analyzer",
      { reason: "UNREADABLE", detail: state.why },
      state.remedy,
    )
  }

  const caveats: SourceCaveat[] = []
  for (const name of state.unreadable) {
    caveats.push({
      reason: "UNREADABLE",
      detail: `analyzer ${name}: its findings could not be read, so this count is a floor.`,
    })
  }
  if (state.truncated) {
    caveats.push({
      reason: "CAPPED",
      detail:
        "the analyzer or finding listing was truncated — there were more than this engine reads in " +
        "one load, so this is not the whole set.",
    })
  }
  caveats.push({
    reason: "UNVERIFIED",
    detail:
      "the external principal and the exposed action are NOT readable with the capabilities this " +
      "engine holds (access-analyzer:GetFindingV2). Each row names the exposed resource and not who " +
      "can reach it.",
  })

  const exposures = state.kind === "external-access" ? state.exposures : []
  return reportedContribution(
    "access-analyzer",
    exposures.map(analyzerFindingContribution),
    caveats,
    state.kind === "external-access"
      ? `${state.totalActive} ACTIVE external-access finding(s) from ${state.exposures.length} record(s).`
      : `${state.analyzersRead.length} analyzer(s) answered and no ACTIVE external-access finding came back.`,
  )
}

function analyzerFindingContribution(exposure: ExternalExposure): FindingContribution {
  return {
    source: "access-analyzer",
    id: exposure.findingId,
    type: exposure.findingType,
    typeProvenance: "Access Analyzer's own findingType, verbatim (ExternalAccess, UnusedIAMRole, …)",
    title: `${exposure.resourceType} grants access outside this account`,
    /*
     * UNRANKED, and that is not a shrug.
     *
     * Access Analyzer publishes NO severity. Assigning one — HIGH feels right for
     * a public bucket — would be this engine inventing a number an operator then
     * plans against. UNRANKED sorts ABOVE critical, so the row is at the top of
     * the table where somebody reads it, and `native.mapping` says why.
     */
    severity: "UNRANKED",
    native: {
      scale: "IAM Access Analyzer publishes no severity",
      value: exposure.status,
      numeric: null,
      mapping:
        "there is no mapping, because there is no native severity to map. ListFindingsV2 returns a " +
        "status (ACTIVE / ARCHIVED / RESOLVED) and no severity of any kind, so this row is UNRANKED " +
        "— which this pipeline sorts ABOVE critical — rather than being assigned a band this engine " +
        "chose. The status AWS did return is carried here as the native value.",
    },
    resourceArn: exposure.resource,
    resourceProvenance: exposure.resource
      ? "the finding's own resource ARN"
      : "AWS returned no resource on this finding, which it omits on an Error finding — so there is " +
        "nothing to join against the tag index or to deduplicate on",
    resourceLabel: exposure.resource,
    attribution: exposure.attribution,
    firstSeen: exposure.createdAt,
    lastSeen: exposure.updatedAt ?? exposure.analyzedAt,
    remedy:
      `Remove the grant in the resource policy on ${exposure.resource ?? "the named resource"}, or ` +
      `archive the finding with an analyzer archive rule if the sharing is deliberate. This engine ` +
      `does not name the statement to remove: the external principal and the exposed action are ` +
      `returned by access-analyzer:GetFindingV2, which is not a capability it holds.`,
    accountId: exposure.resourceOwnerAccount,
    region: exposure.region,
    partition: exposure.partition,
    detail: {
      source: "access-analyzer",
      analyzerArn: exposure.analyzerArn,
      findingStatus: exposure.status,
      resourceType: exposure.resourceType,
      resourceOwnerAccount: exposure.resourceOwnerAccount,
      error: exposure.error,
      externalPrincipal: exposure.externalPrincipal.why,
      exposedAction: exposure.exposedAction.why,
    },
  }
}

/* --------------------------------------------------- ECR image scans -- (4) */

/** ECR's six severities on the pipeline's scale. `UNDEFINED` is UNRANKED. */
export function ecrSeverity(severity: EcrSeverity): NormalisedSeverity {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL"
    case "HIGH":
      return "HIGH"
    case "MEDIUM":
      return "MEDIUM"
    case "LOW":
      return "LOW"
    case "INFORMATIONAL":
      return "INFORMATIONAL"
    case "UNDEFINED":
      // ECR's own word for "this CVE has no severity in the feed". Not a low one.
      return "UNRANKED"
  }
}

/** ECR image-scan findings, normalised. Pure. */
export function ecrContributionFrom(readings: EcrReadings): SourceContribution {
  const repositories = readings.repositories

  if (
    repositories.state !== "ACTUAL" &&
    repositories.state !== "STALE" &&
    repositories.state !== "EMPTY"
  ) {
    return notCheckedContribution(
      "ecr-image-scan",
      { reason: "UNREADABLE", detail: describeRead(repositories, "the ECR repository listing") },
      "Grant the action named here to this engine's role and reload. Until then no image in this " +
        "registry has been checked, which is not the same as every image being clean.",
      denialOf(repositories),
    )
  }

  if (repositories.state === "EMPTY") {
    return reportedContribution(
      "ecr-image-scan",
      [],
      [{ reason: "UNVERIFIED", detail: readings.enhancedScanning.why }],
      "ecr:DescribeRepositories answered and this registry has no repository — there is no image to " +
        "scan, so this empty contribution is an absence of subject matter rather than of checking.",
    )
  }

  const contributions: FindingContribution[] = []
  const caveats: SourceCaveat[] = [
    { reason: "UNVERIFIED", detail: readings.enhancedScanning.why },
  ]
  let countedButUnnamed = 0

  for (const repository of repositories.value) {
    if (repository.scanOnPush.kind !== "enabled") {
      caveats.push({
        reason: "NOT_ENABLED",
        detail: `repository ${repository.name}: ${repository.scanOnPush.why}`,
      })
    }
    if (repository.images.state !== "ACTUAL" && repository.images.state !== "STALE") {
      if (repository.images.state !== "EMPTY") {
        caveats.push({
          reason: "UNREADABLE",
          detail:
            `repository ${repository.name}: ` +
            describeRead(repository.images, `${repository.name}'s images`),
        })
      }
      continue
    }
    if (repository.imageTruncation.kind === "truncated") {
      caveats.push({
        reason: "CAPPED",
        detail: `repository ${repository.name}${describeTruncation(repository.imageTruncation)}`,
      })
    }
    contributions.push(...repositoryFindings(repository, readings, caveats, (n) => {
      countedButUnnamed += n
    }))
  }

  if (readings.truncation.kind === "truncated") {
    caveats.push({
      reason: "CAPPED",
      detail: `the repository listing${describeTruncation(readings.truncation)}`,
    })
  }

  return reportedContribution(
    "ecr-image-scan",
    contributions,
    caveats,
    `${repositories.value.length} repository(ies) answered with ${contributions.length} named finding(s)` +
      `${countedButUnnamed > 0 ? `, and ${countedButUnnamed} further finding(s) counted but not named` : ""}.`,
  )
}

/**
 * One repository's images, as contributions, appending its own caveats.
 *
 * Split out of `ecrContributionFrom` because the five arms of `ImageVulnerability`
 * are five different facts and four of them are caveats rather than rows — a
 * shape that reads as a nested loop with early continues is a shape in which one
 * of those four gets quietly dropped.
 */
function repositoryFindings(
  repository: RepositoryReading,
  readings: EcrReadings,
  caveats: SourceCaveat[],
  countUnnamed: (n: number) => void,
): readonly FindingContribution[] {
  if (repository.images.state !== "ACTUAL" && repository.images.state !== "STALE") return []
  const contributions: FindingContribution[] = []

  for (const image of repository.images.value) {
    const vulnerability = image.vulnerability
    if (vulnerability.kind === "unknown") {
      caveats.push({
        reason: "UNREADABLE",
        detail: `${repository.name}@${image.digest}: ${vulnerability.why}`,
      })
      continue
    }
    if (vulnerability.kind === "not-scanned") {
      caveats.push({
        reason: "NOT_ENABLED",
        detail: `${repository.name}@${image.digest}: ${vulnerability.why}`,
      })
      continue
    }
    if (vulnerability.kind === "scan-incomplete") {
      caveats.push({
        reason: "UNREADABLE",
        detail: `${repository.name}@${image.digest}: ${vulnerability.why}`,
      })
      continue
    }
    if (vulnerability.kind === "clean") continue

    if (vulnerability.sampled.length === 0 && vulnerability.total > 0) {
      // The counts came free with the image listing and no CVE was named. The
      // total must not vanish just because no row can be built from it.
      countUnnamed(vulnerability.total)
      caveats.push({
        reason: "CAPPED",
        detail:
          `${repository.name}@${image.digest}: ${vulnerability.total} finding(s) were COUNTED and ` +
          `none was named — the counts came from the image listing's summary and no ` +
          `ecr:DescribeImageScanFindings detail read was performed for this image, so those ` +
          `findings are not rows below.`,
      })
      continue
    }
    if (vulnerability.truncation.kind === "truncated") {
      caveats.push({
        reason: "CAPPED",
        detail: `${repository.name}@${image.digest}${describeTruncation(vulnerability.truncation)}`,
      })
    }

    for (const finding of vulnerability.sampled) {
      contributions.push({
        source: "ecr-image-scan",
        id: `${image.digest}::${finding.name}`,
        type: finding.name,
        typeProvenance: "ECR's own finding name — the CVE identifier, verbatim",
        title: `${finding.name} in ${finding.packageName ?? "an unnamed package"}`,
        severity: ecrSeverity(finding.severity),
        native: {
          scale: "ECR scan severity (CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL/UNDEFINED)",
          value: finding.severity,
          numeric: null,
          mapping:
            "the five named bands carry across unchanged. ECR's UNDEFINED is UNRANKED here — it is " +
            "ECR's own word for a CVE the feed gave no severity, and reading it as a low one is how " +
            "an unscored critical is buried.",
        },
        /*
         * An image has no ARN. The repository's is used, and the digest is on the
         * row — assembling an ARN for an image would be inventing one, and a
         * half-built ARN joins the tag index, matches nothing, and reads exactly
         * like an untagged resource.
         */
        resourceArn: repository.arn,
        resourceProvenance: repository.arn
          ? `the repository's own repositoryArn. An image has no ARN of its own, so the finding is ` +
            `attributed to the repository and the digest ${image.digest} identifies the image.`
          : "AWS returned no repositoryArn for this repository, and an image has no ARN of its own, " +
            "so there is nothing to join on",
        resourceLabel: `${repository.name}@${image.digest}`,
        attribution: repository.attribution,
        firstSeen: image.pushedAt,
        lastSeen: vulnerability.completedAt,
        remedy:
          `Rebuild ${repository.name} from a base image carrying a fixed ` +
          `${finding.packageName ?? "package"}, push it, and expire the vulnerable digest. ` +
          `ecr:DescribeImageScanFindings returns the package and the version present ` +
          `(${finding.packageVersion ?? "version not returned"}) and no fixed version this engine ` +
          `reads, so none is stated.`,
        accountId: repository.registryId,
        region: repository.region,
        partition: repository.partition,
        detail: {
          source: "ecr-image-scan",
          repositoryName: repository.name,
          imageDigest: image.digest,
          imageTags: image.tags,
          packageName: finding.packageName,
          packageVersion: finding.packageVersion,
          scanSource: vulnerability.source,
          scanningCoverageCaveat: readings.enhancedScanning.why,
        },
      })
    }
  }

  return contributions
}

/* --------------------------------------------------------- AWS Config -- (5) */

/** Config rule non-compliance, normalised. Pure. */
export function configContributionFrom(readings: ComplianceReadings): SourceContribution {
  const enablement = readings.enablement

  if (enablement.kind === "unknown") {
    return notCheckedContribution(
      "config",
      { reason: "UNREADABLE", detail: enablement.why },
      "Grant the action named here to this engine's role and reload. Until the rule listing can be " +
        "read, whether anything in this account is evaluated is unknown.",
      denialOf(readings.rules),
    )
  }
  if (enablement.kind === "not-evaluating") {
    return notCheckedContribution(
      "config",
      { reason: "NOT_ENABLED", detail: enablement.why },
      enablement.remedy,
    )
  }

  const caveats: SourceCaveat[] = [
    { reason: "UNVERIFIED", detail: describeRecorder(enablement.recorder) },
  ]
  const contributions: FindingContribution[] = []

  if (readings.rules.state === "ACTUAL" || readings.rules.state === "STALE") {
    for (const rule of readings.rules.value) {
      switch (rule.health.kind) {
        case "failing":
          contributions.push(configFindingContribution(rule, rule.health))
          break
        case "not-evaluated":
          caveats.push({ reason: "NOT_ENABLED", detail: `rule ${rule.name}: ${rule.health.why}` })
          break
        case "unreadable":
        case "verdict-unstated":
          caveats.push({ reason: "UNREADABLE", detail: `rule ${rule.name}: ${rule.health.why}` })
          break
        case "inactive":
          caveats.push({ reason: "UNVERIFIED", detail: `rule ${rule.name}: ${rule.health.why}` })
          break
        case "not-applicable":
        case "passing":
          break
      }
    }
  }

  if (readings.truncation.kind === "more-available") {
    caveats.push({
      reason: "CAPPED",
      detail:
        `the rule listing returned ${readings.truncation.returned} rule(s) and THERE WERE MORE — ` +
        `${readings.truncation.reason}`,
    })
  }

  return reportedContribution(
    "config",
    contributions,
    caveats,
    `${enablement.ruleCount} rule(s) exist, ${enablement.liveRuleCount} live, and ` +
      `${contributions.length} are failing.`,
  )
}

function configFindingContribution(
  rule: ConfigRuleReading,
  health: { kind: "failing"; nonCompliantResources: number | null; countCapped: boolean },
): FindingContribution {
  return {
    source: "config",
    id: rule.name,
    // The rule name IS the finding type for Config: it is what an operator
    // searches the rule catalogue for, and what the console keys on.
    type: rule.name,
    typeProvenance: "the Config rule's own name, verbatim — Config publishes no separate type",
    title: rule.description ?? `${rule.name} is NON_COMPLIANT`,
    /*
     * UNRANKED. AWS Config states a verdict, not a severity, and a NON_COMPLIANT
     * rule can be anything from an untagged sandbox bucket to an open database.
     * Choosing a band for it would be this engine's opinion rendered as AWS's
     * measurement.
     */
    severity: "UNRANKED",
    native: {
      scale:
        "AWS Config compliance verdict (COMPLIANT / NON_COMPLIANT / NOT_APPLICABLE / INSUFFICIENT_DATA)",
      value: "NON_COMPLIANT",
      numeric: health.nonCompliantResources,
      mapping:
        "there is no mapping, because Config publishes no severity. The verdict is carried here as " +
        "the native value and the row is UNRANKED — which this pipeline sorts ABOVE critical — " +
        "rather than being assigned a band this engine chose. The numeric is Config's own count of " +
        "failing resources, which is a floor when countCapped is true.",
    },
    resourceArn: rule.arn,
    /*
     * The rule, not the resources. Which resources are failing is returned by
     * `config:GetComplianceDetailsByConfigRule`, which this engine's registry
     * does not carry — so the finding attaches to the rule and says so, rather
     * than naming a resource nobody read.
     */
    resourceProvenance: rule.arn
      ? "the Config RULE's own ConfigRuleArn. The failing RESOURCES are not named: that needs " +
        "config:GetComplianceDetailsByConfigRule, which is not a capability this engine holds."
      : "AWS returned no ConfigRuleArn for this rule, and this engine does not assemble one",
    resourceLabel: rule.name,
    attribution: rule.attribution,
    // Config's DescribeComplianceByConfigRule returns no timestamps. Null, not now().
    firstSeen: null,
    lastSeen: null,
    remedy:
      `Open Config rule ${rule.name} to see which resources are failing — this engine reads the ` +
      `verdict and the count (${health.nonCompliantResources ?? "not stated by AWS"}` +
      `${health.countCapped ? ", CAPPED, so a floor rather than a total" : ""}) and not the ` +
      `resource list, which needs config:GetComplianceDetailsByConfigRule. Remediating the rule's ` +
      `subject is the fix; suppressing the rule is not.`,
    accountId: rule.accountId,
    region: rule.region,
    partition: rule.partition,
    detail: {
      source: "config",
      ruleName: rule.name,
      ruleOwner: rule.owner,
      sourceIdentifier: rule.sourceIdentifier,
      ruleState: rule.ruleState,
      nonCompliantResources: health.nonCompliantResources,
      countCapped: health.countCapped,
    },
  }
}

/* ------------------------------------------------------------- the merge -- */

/**
 * Collapse contributions onto one row per resource-and-type.
 *
 * Deterministic: the primary is picked by `PRIMARY_RANK` and ties break on the
 * source's own id with `<` and `>` rather than `localeCompare`, which is
 * locale-dependent and would order two identical loads differently on two
 * machines.
 */
export function mergeContributions(contributions: readonly FindingContribution[]): {
  findings: readonly NormalisedFinding[]
  duplicatesCollapsed: number
} {
  const groups = new Map<string, FindingContribution[]>()
  for (const contribution of contributions) {
    const key = dedupeKey(contribution)
    const bucket = groups.get(key)
    if (bucket) bucket.push(contribution)
    else groups.set(key, [contribution])
  }

  let duplicatesCollapsed = 0
  const findings: NormalisedFinding[] = []

  for (const [key, bucket] of groups) {
    duplicatesCollapsed += bucket.length - 1
    const ordered = bucket
      .slice()
      .sort(
        (a, b) =>
          PRIMARY_RANK[a.source] - PRIMARY_RANK[b.source] ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
    const primary = ordered[0]
    const seenBy = [...new Set(ordered.map((c) => c.source))]
    const corroborated = seenBy.length > 1

    findings.push({
      key,
      source: primary.source,
      seenBy,
      corroborated,
      corroboration: corroborated
        ? `CORROBORATED — ${seenBy.length} sources reported this: ` +
          `${seenBy.map((s) => PIPELINE_SOURCE_LABEL[s]).join(", ")}. Security Hub ingests ` +
          `GuardDuty, so a row both of them carry is ONE threat counted once here — and two ` +
          `products independently naming the same type on the same resource is evidence, not ` +
          `noise. The merged fields come from ${PIPELINE_SOURCE_LABEL[primary.source]}, whose ` +
          `record is the more detailed; every source's own record is in contributions.`
        : `seen by ${PIPELINE_SOURCE_LABEL[primary.source]} alone. No other source that answered ` +
          `reported this type on this resource, which is not the same as another source ` +
          `contradicting it — the sources that did not check are listed separately.`,
      id: primary.id,
      type: primary.type,
      typeProvenance: primary.typeProvenance,
      title: primary.title,
      severity: mergeSeverity(ordered),
      native: primary.native,
      resourceArn: primary.resourceArn,
      resourceProvenance: primary.resourceProvenance,
      resourceLabel: primary.resourceLabel,
      attribution: primary.attribution,
      firstSeen: earliest(ordered.map((c) => c.firstSeen)),
      lastSeen: latest(ordered.map((c) => c.lastSeen)),
      remedy: primary.remedy,
      accountId: primary.accountId,
      region: primary.region,
      partition: primary.partition,
      detail: primary.detail,
      contributions: ordered,
    })
  }

  return { findings: rankNormalised(findings), duplicatesCollapsed }
}

/** Worst first, then most recently seen, then by key. Locale-independent. */
export function rankNormalised(
  findings: readonly NormalisedFinding[],
): readonly NormalisedFinding[] {
  return findings.slice().sort((a, b) => {
    const byBand = NORMALISED_SEVERITY_ORDER[a.severity] - NORMALISED_SEVERITY_ORDER[b.severity]
    if (byBand !== 0) return byBand
    const aSeen = a.lastSeen ?? ""
    const bSeen = b.lastSeen ?? ""
    if (aSeen !== bSeen) return aSeen < bSeen ? 1 : -1
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/** Counts per band, worst first, and only for bands that actually occur. */
export function tallyBySeverity(findings: readonly NormalisedFinding[]): readonly SeverityTally[] {
  const counts = new Map<NormalisedSeverity, number>()
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => NORMALISED_SEVERITY_ORDER[a.severity] - NORMALISED_SEVERITY_ORDER[b.severity])
}

/**
 * Assemble the pipeline from five contributions.
 *
 * Pure, and exported, so the merge and the headline can be driven without a
 * gateway. `findingsPipeline` is the only production caller.
 */
export function assemblePipeline(
  contributions: readonly SourceContribution[],
  asOf: string,
): FindingsPipeline {
  const sources = PIPELINE_SOURCES.map((id) => {
    const found = contributions.find((c) => c.source === id)
    if (found) return found
    /*
     * A source nobody supplied is NOT_CHECKED, not absent. The only way to reach
     * this is a caller that passed fewer than five contributions, and a pipeline
     * that quietly dropped a source would be the empty-list defect again.
     */
    return notCheckedContribution(
      id,
      {
        reason: "UNREADABLE",
        detail: `${PIPELINE_SOURCE_LABEL[id]} contributed nothing to this load — not even a marker.`,
      },
      `This is a defect in the pipeline's composition rather than in the estate: ` +
        `${PIPELINE_SOURCE_LABEL[id]} was not read and did not say why.`,
    )
  })

  const all = sources.flatMap((s) => s.findings)
  const { findings, duplicatesCollapsed } = mergeContributions(all)
  const notChecked = sources.filter((s) => s.state === "NOT_CHECKED")
  const partial = sources.filter((s) => s.state === "REPORTED" && s.caveats.length > 0)
  const answered = sources.filter((s) => s.state === "REPORTED")
  const corroborated = findings.filter((f) => f.corroborated)

  const names = (list: readonly SourceContribution[]) =>
    list.map((s) => PIPELINE_SOURCE_LABEL[s.source]).join(", ")

  const headline =
    answered.length === 0
      ? `NOTHING IS CHECKING — all ${sources.length} sources contributed a not-checked marker ` +
        `(${names(notChecked)}), as of ${asOf}. Every empty list on this surface is an absence of ` +
        `checking rather than an absence of findings.`
      : findings.length === 0
        ? `no finding from the ${answered.length} of ${sources.length} source(s) that answered ` +
          `(${names(answered)}), as of ${asOf}` +
          `${
            notChecked.length > 0
              ? ` — and ${notChecked.length} contributed a not-checked marker ` +
                `(${names(notChecked)}), so this is not a clean estate`
              : ""
          }.`
        : `${findings.length} finding(s) from ${answered.length} of ${sources.length} source(s) ` +
          `(${names(answered)}), as of ${asOf}` +
          `${
            duplicatesCollapsed > 0
              ? ` — ${duplicatesCollapsed} duplicate record(s) collapsed on resource ARN + finding type`
              : ""
          }` +
          `${
            corroborated.length > 0
              ? `, ${corroborated.length} corroborated by more than one source`
              : ""
          }` +
          `${
            notChecked.length > 0
              ? `. ${notChecked.length} source(s) contributed a not-checked marker (${names(notChecked)})`
              : ""
          }.`

  return {
    sources,
    findings,
    duplicatesCollapsed,
    corroborated,
    notChecked,
    partial,
    counts: tallyBySeverity(findings),
    headline,
    asOf,
  }
}

/* ----------------------------------------------------------- the surface -- */

/**
 * What `findingsPipeline` needs that it does not read for itself.
 *
 * Every field REQUIRED. An optional field a caller omits is invisible to `tsc`
 * at the call sites that omit it, and this module is consumed by a surface — so
 * the things the caller has already read are handed over explicitly or the call
 * does not compile.
 */
export interface PipelineInputs {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /** Security Hub's contribution, already built. See `hubContributionFrom`. */
  hub: SourceContribution
}

/**
 * Every source now readable, in one pipeline.
 *
 * The four direct readers run SEQUENTIALLY. There is no shared concurrency limit
 * in this directory — `readAws` retries a throttle with backoff per call, and
 * four page loops firing at once against one account is how a load turns a
 * transient 400ms wait into four THROTTLED panels. Correctness over latency on
 * an operator console.
 *
 * Each reader degrades on its own: a refused GuardDuty listing does not stop
 * Access Analyzer, ECR or Config from contributing, and each refusal arrives as
 * its own NOT_CHECKED marker carrying its own action and minimum statement.
 */
export async function findingsPipeline(
  supplied: AwsGateway | undefined,
  inputs: PipelineInputs,
  options: { now?: () => Date } = {},
): Promise<FindingsPipeline> {
  const now = options.now ?? (() => new Date())

  const guardduty = await guardDutyReadings(supplied, { now })
  const analyzer = await analyzerReadings(supplied, { now })
  const ecr = await ecrReadings(supplied, { now })
  const config = await complianceReadings(supplied, { now })

  return assemblePipeline(
    [
      inputs.hub,
      guardDutyContributionFrom(guardduty),
      analyzerContributionFrom(analyzer),
      ecrContributionFrom(ecr),
      configContributionFrom(config),
    ],
    now().toISOString(),
  )
}

/* -------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for one source's contribution. One funnel. */
export function describeSourceContribution(contribution: SourceContribution): string {
  const caveats =
    contribution.caveats.length === 0
      ? ""
      : ` Caveats: ${contribution.caveats.map((c) => `${c.reason} — ${c.detail}`).join(" · ")}`
  if (contribution.state === "NOT_CHECKED") {
    return (
      `NOT CHECKED — ${contribution.detail}` +
      `${contribution.action ? ` Action: ${contribution.action}.` : ""}` +
      `${contribution.minimumStatement ? ` Minimum statement: ${contribution.minimumStatement}.` : ""}` +
      `${contribution.remedy ? ` Remedy: ${contribution.remedy}` : ""}`
    )
  }
  return `REPORTED — ${contribution.detail}${caveats}`
}

/** The sentence a surface prints for one attribution. */
export function describePipelineAttribution(attribution: PipelineAttribution): string {
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

/** The sentence a surface prints for one normalised finding. */
export function describeNormalisedFinding(finding: NormalisedFinding): string {
  const severity =
    finding.severity === "UNRANKED"
      ? `severity UNRANKED (${finding.native.scale}) — ranked above critical rather than assumed low`
      : `severity ${finding.severity}`
  const native = `native ${finding.native.scale}: ${finding.native.value ?? "none published"}`
  const seen =
    finding.firstSeen || finding.lastSeen
      ? `first seen ${finding.firstSeen ?? "unknown"}, last seen ${finding.lastSeen ?? "unknown"}`
      : "first and last seen not stated by any source"
  const where =
    finding.region && finding.partition
      ? `${finding.region} (partition ${finding.partition})`
      : "region unknown — no source stated one and identity is unresolved"
  return (
    `${finding.type ?? "(no type published)"} — ${severity} — ${native} — ` +
    `${finding.resourceArn ?? `no resource ARN: ${finding.resourceProvenance}`} — ${where} — ` +
    `${describePipelineAttribution(finding.attribution)} — ${seen} — ${finding.corroboration} — ` +
    `Remedy: ${finding.remedy}`
  )
}

export interface PipelineLine {
  label: string
  text: string
}

/**
 * What a unified-findings surface prints.
 *
 * The surface renders exactly these strings, which is what makes the tests land
 * on the production path rather than on a helper nothing calls.
 */
export function pipelineLines(pipeline: FindingsPipeline): readonly PipelineLine[] {
  const lines: PipelineLine[] = [{ label: "Findings", text: pipeline.headline }]

  for (const source of pipeline.sources) {
    lines.push({
      label: PIPELINE_SOURCE_LABEL[source.source],
      text: describeSourceContribution(source),
    })
  }

  lines.push({
    label: "Severity",
    text:
      pipeline.counts.length === 0
        ? "no finding was contributed by any source that answered"
        : `${pipeline.counts.map((c) => `${c.count} ${c.severity}`).join(", ")} — one normalised ` +
          `scale, with each source's native value on every row`,
  })

  for (const finding of pipeline.findings) {
    lines.push({ label: finding.key, text: describeNormalisedFinding(finding) })
  }

  lines.push({
    label: "Read at",
    text:
      `${pipeline.asOf} · ${pipeline.duplicatesCollapsed} duplicate record(s) collapsed on ` +
      `resource ARN + finding type · ${pipeline.corroborated.length} finding(s) corroborated by ` +
      `more than one source · ${pipeline.notChecked.length} source(s) not checking`,
  })
  return lines
}
