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

import { minimumStatementText, type Capability } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import { describeOrganization, type OrganizationRead } from "./organization"
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
      verdict: "SEPARATED",
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
