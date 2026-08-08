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

import { SECURITY_REFRESH_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import { liveGateway, readAws, type AwsGateway, type AwsRead } from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution } from "./tags"

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
    Severity?: { Label?: string }
    FirstObservedAt?: string
    CreatedAt?: string
    RecordState?: string
    Resources?: Array<{ Id?: string }>
  }>
  NextToken?: string
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

  return {
    identity,
    read,
    findings,
    sources,
    headline,
    duplicatesRemoved: Math.max(0, raw - findings.length),
    asOf,
    refreshMs: SECURITY_REFRESH_MS,
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
