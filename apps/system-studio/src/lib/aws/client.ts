import "server-only"

import { ACMClient, ListCertificatesCommand } from "@aws-sdk/client-acm"
import { CloudFrontClient, ListDistributionsCommand } from "@aws-sdk/client-cloudfront"
import { CloudTrailClient, DescribeTrailsCommand } from "@aws-sdk/client-cloudtrail"
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch"
import {
  ConfigServiceClient,
  DescribeConfigurationAggregatorsCommand,
} from "@aws-sdk/client-config-service"
import { CostExplorerClient, GetCostAndUsageWithResourcesCommand } from "@aws-sdk/client-cost-explorer"
import {
  CostAndUsageReportServiceClient,
  DescribeReportDefinitionsCommand,
} from "@aws-sdk/client-cost-and-usage-report-service"
import {
  DescribeServicesCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
} from "@aws-sdk/client-ecs"
import { BackupClient, ListBackupVaultsCommand, ListRecoveryPointsByBackupVaultCommand } from "@aws-sdk/client-backup"
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs"
import { KMSClient, ListKeysCommand } from "@aws-sdk/client-kms"
import { ListHostedZonesCommand, Route53Client } from "@aws-sdk/client-route-53"
import { ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3"
import {
  DescribeOrganizationCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations"
import {
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
} from "@aws-sdk/client-rds"
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api"
import { DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"
import { GetFindingsCommand, SecurityHubClient } from "@aws-sdk/client-securityhub"
import { DescribeParametersCommand, SSMClient } from "@aws-sdk/client-ssm"
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts"

import type { Capability } from "./capabilities"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 — the one module in the Studio that holds a non-DynamoDB AWS
 * client, and the only one `forbidden-clients` permits to import `@aws-sdk/*`.
 *
 * Three properties, all of them load-bearing:
 *
 * **No credentials argument and no region literal.** Every client is
 * `new XClient({})`. Credentials come from the default provider chain — the ECS
 * task role in production, whatever the developer has locally — and the region
 * from the SDK's own resolution. Swapping the deploy role, or moving the estate
 * to another account or another partition, is then a change to the environment
 * and not to this repository. `tests/security/no-hardcoded-estate.test.mjs`
 * scans this directory and reds on a region literal, so the property is
 * enforced rather than promised.
 *
 * **Clients are built once.** The SDK keeps connections warm; a per-request
 * client would add a TLS handshake to every page load, which `registry.ts:50`
 * already learned.
 *
 * **The surface is a closed list of capabilities, not a service/action pair.**
 * `call()` takes a `Capability` from the closed union in `capabilities.ts` and
 * switches on it. There is deliberately no way to express "send this arbitrary
 * command": an endpoint that took a service and an action would make whatever
 * the task role holds reachable from a browser, and no reader of this file
 * could say what the console is able to do.
 */

let sts: STSClient | null = null
let organizations: OrganizationsClient | null = null
let tagging: ResourceGroupsTaggingAPIClient | null = null
let ecs: ECSClient | null = null
let rds: RDSClient | null = null
let cloudfront: CloudFrontClient | null = null
let acm: ACMClient | null = null
let cloudwatch: CloudWatchClient | null = null
let securityhub: SecurityHubClient | null = null
let cloudtrail: CloudTrailClient | null = null
let secretsManager: SecretsManagerClient | null = null
let ssm: SSMClient | null = null
let configService: ConfigServiceClient | null = null
let costExplorer: CostExplorerClient | null = null
let cur: CostAndUsageReportServiceClient | null = null
let logs: CloudWatchLogsClient | null = null
let backup: BackupClient | null = null
let kms: KMSClient | null = null
let route53: Route53Client | null = null
let s3: S3Client | null = null

/**
 * Every client is constructed with an empty config, on purpose.
 *
 * Not an oversight and not a TODO: the empty object IS the decision. Passing a
 * region here would compile the estate's location into the product, which is the
 * GE-010-007 residency defect — a cell in eu-west-1 whose AWS_REGION is unset
 * does not error, it talks to us-east-1.
 */
function stsClient(): STSClient {
  if (!sts) sts = new STSClient({})
  return sts
}

export function gateway(): AwsGateway {
  return {
    async call(capability: Capability, input: Record<string, unknown> = {}): Promise<unknown> {
      switch (capability) {
        case "sts:GetCallerIdentity":
          return stsClient().send(new GetCallerIdentityCommand({}))

        case "organizations:DescribeOrganization":
          if (!organizations) organizations = new OrganizationsClient({})
          return organizations.send(new DescribeOrganizationCommand({}))

        case "organizations:ListAccounts":
          if (!organizations) organizations = new OrganizationsClient({})
          return organizations.send(new ListAccountsCommand({ NextToken: str(input.NextToken) }))

        case "tag:GetResources":
          if (!tagging) tagging = new ResourceGroupsTaggingAPIClient({})
          return tagging.send(
            new GetResourcesCommand({
              PaginationToken: str(input.PaginationToken),
              ResourcesPerPage: 100,
            }),
          )

        case "ecs:ListClusters":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(new ListClustersCommand({}))

        case "ecs:ListServices":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(new ListServicesCommand({ cluster: str(input.cluster), nextToken: str(input.nextToken) }))

        case "ecs:DescribeServices":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(
            new DescribeServicesCommand({
              cluster: str(input.cluster),
              services: strings(input.services),
            }),
          )

        case "rds:DescribeDBInstances":
          if (!rds) rds = new RDSClient({})
          return rds.send(new DescribeDBInstancesCommand({ Marker: str(input.Marker) }))

        case "rds:DescribeDBSnapshots":
          if (!rds) rds = new RDSClient({})
          return rds.send(new DescribeDBSnapshotsCommand({ Marker: str(input.Marker) }))

        case "cloudfront:ListDistributions":
          if (!cloudfront) cloudfront = new CloudFrontClient({})
          return cloudfront.send(new ListDistributionsCommand({ Marker: str(input.Marker) }))

        case "acm:ListCertificates":
          if (!acm) acm = new ACMClient({})
          return acm.send(new ListCertificatesCommand({ NextToken: str(input.NextToken) }))

        case "cloudwatch:DescribeAlarms":
          if (!cloudwatch) cloudwatch = new CloudWatchClient({})
          return cloudwatch.send(
            new DescribeAlarmsCommand({
              // Both types. A composite alarm that is the actual page for an
              // on-call rota is invisible to a metric-only read, and the surface
              // would report the estate as healthier than it is.
              AlarmTypes: ["MetricAlarm", "CompositeAlarm"],
              NextToken: str(input.NextToken),
            }),
          )

        case "securityhub:GetFindings":
          if (!securityhub) securityhub = new SecurityHubClient({})
          return securityhub.send(
            new GetFindingsCommand({
              Filters: { RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }] },
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "cloudtrail:DescribeTrails":
          if (!cloudtrail) cloudtrail = new CloudTrailClient({})
          return cloudtrail.send(new DescribeTrailsCommand({}))

        /* ---------------------------------------------- STUDIO-040-005 --
         * Existence, never value.
         *
         * `DescribeSecretCommand` and `DescribeParametersCommand` are the only
         * two commands imported from these packages, and that is deliberate:
         * `GetSecretValueCommand` is not imported, is not reachable, and a
         * guard test fails the build if its name appears anywhere under
         * `apps/system-studio/src`. A control plane that renders every tenant's
         * configuration must not be able to read any tenant's credentials.
         */
        case "secretsmanager:DescribeSecret":
          if (!secretsManager) secretsManager = new SecretsManagerClient({})
          return secretsManager.send(new DescribeSecretCommand({ SecretId: String(input.SecretId) }))

        case "ssm:DescribeParameters":
          // Filtered by name rather than listing the account's parameters. The
          // API has no per-name describe that omits the value, so this is the
          // narrowest existence check that exists.
          if (!ssm) ssm = new SSMClient({})
          return ssm.send(
            new DescribeParametersCommand({
              ParameterFilters: [
                { Key: "Name", Option: "Equals", Values: strings(input.Names) ?? [] },
              ],
              MaxResults: 50,
            }),
          )

        case "config:DescribeConfigurationAggregators":
          if (!configService) configService = new ConfigServiceClient({})
          return configService.send(new DescribeConfigurationAggregatorsCommand({}))

        case "ce:GetCostAndUsageWithResources":
          if (!costExplorer) costExplorer = new CostExplorerClient({})
          return costExplorer.send(
            new GetCostAndUsageWithResourcesCommand({
              TimePeriod: { Start: String(input.start), End: String(input.end) },
              Granularity: "MONTHLY",
              Metrics: ["UnblendedCost"],
              GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
              Filter: {
                Tags: { Key: String(input.tagKey), Values: [String(input.tagValue)] },
              },
            }),
          )

        case "cur:DescribeReportDefinitions":
          if (!cur) cur = new CostAndUsageReportServiceClient({})
          return cur.send(new DescribeReportDefinitionsCommand({}))

        case "logs:DescribeLogGroups":
          if (!logs) logs = new CloudWatchLogsClient({})
          return logs.send(
            new DescribeLogGroupsCommand({
              logGroupNamePrefix: str(input.logGroupNamePrefix),
              nextToken: str(input.nextToken),
            }),
          )

        case "backup:ListBackupVaults":
          if (!backup) backup = new BackupClient({})
          return backup.send(new ListBackupVaultsCommand({ NextToken: str(input.NextToken) }))

        case "backup:ListRecoveryPointsByBackupVault":
          if (!backup) backup = new BackupClient({})
          return backup.send(
            new ListRecoveryPointsByBackupVaultCommand({
              BackupVaultName: String(input.BackupVaultName),
              NextToken: str(input.NextToken),
            }),
          )

        case "kms:ListKeys":
          if (!kms) kms = new KMSClient({})
          return kms.send(new ListKeysCommand({ Marker: str(input.Marker) }))

        case "route53:ListHostedZones":
          if (!route53) route53 = new Route53Client({})
          return route53.send(new ListHostedZonesCommand({ Marker: str(input.Marker) }))

        case "s3:ListObjectVersions":
          if (!s3) s3 = new S3Client({})
          return s3.send(
            new ListObjectVersionsCommand({
              Bucket: String(input.Bucket),
              Prefix: str(input.Prefix),
              KeyMarker: str(input.KeyMarker),
            }),
          )
      }
    },

    /**
     * The region the SDK resolved for this process.
     *
     * Read off a real client's resolved config rather than `process.env.AWS_REGION`,
     * because the SDK also reads profiles, IMDS and the container credentials
     * endpoint — and the region that matters is the one requests actually go to.
     */
    async resolvedRegion(): Promise<string> {
      return stsClient().config.region()
    },
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined
}
