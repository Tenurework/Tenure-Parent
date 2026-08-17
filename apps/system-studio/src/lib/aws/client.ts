import "server-only"

import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand } from "@aws-sdk/client-acm"
import {
  AccessAnalyzerClient,
  ListAnalyzersCommand,
  ListFindingsV2Command,
} from "@aws-sdk/client-accessanalyzer"
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  ListDistributionsCommand,
  ListInvalidationsCommand,
} from "@aws-sdk/client-cloudfront"
import {
  CloudTrailClient,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
  LookupEventsCommand,
} from "@aws-sdk/client-cloudtrail"
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetDashboardCommand,
  GetMetricDataCommand,
  ListDashboardsCommand,
} from "@aws-sdk/client-cloudwatch"
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolDomainCommand,
  GetUserPoolMfaConfigCommand,
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider"
import {
  ConfigServiceClient,
  DescribeComplianceByConfigRuleCommand,
  DescribeConfigRulesCommand,
  DescribeConfigurationAggregatorsCommand,
} from "@aws-sdk/client-config-service"
import {
  DescribeContinuousBackupsCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb"
import {
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcsCommand,
  EC2Client,
} from "@aws-sdk/client-ec2"
import {
  DescribeImageScanFindingsCommand,
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
  ECRClient,
  GetLifecyclePolicyCommand,
} from "@aws-sdk/client-ecr"
import {
  DescribeCacheClustersCommand,
  DescribeCacheParametersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache"
import {
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2"
import {
  GetFindingsCommand as GetGuardDutyFindingsCommand,
  GuardDutyClient,
  ListDetectorsCommand,
  ListFindingsCommand,
} from "@aws-sdk/client-guardduty"
import { GetProductsCommand, ListPriceListsCommand, PricingClient } from "@aws-sdk/client-pricing"
import {
  GetServiceQuotaCommand,
  ListServiceQuotasCommand,
  ServiceQuotasClient,
} from "@aws-sdk/client-service-quotas"
import {
  GetWebACLForResourceCommand,
  ListWebACLsCommand,
  WAFV2Client,
} from "@aws-sdk/client-wafv2"
import { CostExplorerClient, GetCostAndUsageWithResourcesCommand } from "@aws-sdk/client-cost-explorer"
import {
  CostAndUsageReportServiceClient,
  DescribeReportDefinitionsCommand,
} from "@aws-sdk/client-cost-and-usage-report-service"
import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs"
import { BackupClient, ListBackupVaultsCommand, ListRecoveryPointsByBackupVaultCommand } from "@aws-sdk/client-backup"
import { BudgetsClient, DescribeBudgetsCommand } from "@aws-sdk/client-budgets"
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeMetricFiltersCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs"
import {
  EventBridgeClient,
  ListRulesCommand,
  ListTargetsByRuleCommand,
} from "@aws-sdk/client-eventbridge"
import {
  DescribeAffectedEntitiesCommand,
  DescribeEventsCommand,
  HealthClient,
} from "@aws-sdk/client-health"
import {
  GetAccountAuthorizationDetailsCommand,
  IAMClient,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam"
import {
  DescribeKeyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  ListKeysCommand,
} from "@aws-sdk/client-kms"
import {
  GetFunctionConcurrencyCommand,
  LambdaClient,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda"
import {
  GetAccountCommand,
  GetConfigurationSetCommand,
  ListConfigurationSetsCommand,
  ListEmailIdentitiesCommand,
  ListSuppressedDestinationsCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2"
import {
  GetQueueAttributesCommand,
  ListQueuesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"
import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from "@aws-sdk/client-route-53"
import {
  GetBucketCorsCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import {
  DescribeOrganizationCommand,
  ListAccountsCommand,
  ListOrganizationalUnitsForParentCommand,
  ListPoliciesForTargetCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations"
import {
  DescribeDBInstancesCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBSnapshotsCommand,
  DescribeEventsCommand as DescribeRdsEventsCommand,
  DescribePendingMaintenanceActionsCommand,
  RDSClient,
} from "@aws-sdk/client-rds"
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api"
import {
  DescribeSecretCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager"
import { GetFindingsCommand, SecurityHubClient } from "@aws-sdk/client-securityhub"
import { DescribeParametersCommand, SSMClient } from "@aws-sdk/client-ssm"
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts"

import type { Capability } from "./capabilities"
import { EndpointRegionUnset, type AwsGateway } from "./read"

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
let sesv2: SESv2Client | null = null
let sqs: SQSClient | null = null
let lambda: LambdaClient | null = null
let iam: IAMClient | null = null
let budgets: BudgetsClient | null = null
let awsHealth: HealthClient | null = null
let eventbridge: EventBridgeClient | null = null
let cognito: CognitoIdentityProviderClient | null = null
let ec2: EC2Client | null = null
let elbv2: ElasticLoadBalancingV2Client | null = null
let ecr: ECRClient | null = null
let elasticache: ElastiCacheClient | null = null
let dynamodb: DynamoDBClient | null = null
let servicequotas: ServiceQuotasClient | null = null
let accessAnalyzer: AccessAnalyzerClient | null = null
let guardduty: GuardDutyClient | null = null
let pricing: PricingClient | null = null
let wafv2: WAFV2Client | null = null
let wafv2Global: WAFV2Client | null = null

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

/**
 * The one exception to "no region is ever named", and it is named by the
 * OPERATOR rather than by this file.
 *
 * Two APIs in this registry are not served from every region. The Price List
 * API answers only from a small set of regions, and WAFv2's CLOUDFRONT scope
 * answers only from the partition's global endpoint. That is a property of
 * those APIs, not a decision about where this estate's data lives — GE-010-007
 * is about writing tenant data somewhere it may not go, and reading a public
 * price list is neither tenant data nor a write.
 *
 * It is still not hard-coded. The value comes from `AWS_GLOBAL_ENDPOINT_REGION`
 * exactly as `AWS_ACCOUNT_ID` and `AWS_PARTITION` do, because the answer is
 * different in every partition: in the commercial partition it is the
 * us-east-1 global endpoint, in GovCloud these APIs are not offered at all,
 * and a literal compiled in here would be silently wrong in two of the three.
 *
 * Unset, the call is NOT made against the resolved region — that produces an
 * endpoint error an operator has to decode. It throws `EndpointRegionUnset`,
 * which `readAws` renders as UNCONFIGURED naming the variable to set. "We have
 * not been told where to ask" is not "there are no prices".
 */
function globalEndpointRegion(api: string): string {
  const configured = process.env.AWS_GLOBAL_ENDPOINT_REGION?.trim()
  if (configured) return configured
  throw new EndpointRegionUnset(
    `${api} is not served from every region, and AWS_GLOBAL_ENDPOINT_REGION is not set. ` +
      `Set it to the region this partition serves its global endpoints from. ` +
      `This engine will not guess a region: guessing one is how data ends up somewhere ` +
      `a tenant's residency did not permit.`,
  )
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

        // STUDIO-010-003. The OU hierarchy, which is where a service control
        // policy is actually attached — `ListAccounts` cannot say whether an
        // account is governed, only that it exists.
        case "organizations:ListRoots":
          if (!organizations) organizations = new OrganizationsClient({})
          return organizations.send(new ListRootsCommand({ NextToken: str(input.NextToken) }))

        case "organizations:ListOrganizationalUnitsForParent":
          if (!organizations) organizations = new OrganizationsClient({})
          return organizations.send(
            new ListOrganizationalUnitsForParentCommand({
              ParentId: str(input.ParentId),
              NextToken: str(input.NextToken),
            }),
          )

        case "organizations:ListPoliciesForTarget":
          if (!organizations) organizations = new OrganizationsClient({})
          return organizations.send(
            new ListPoliciesForTargetCommand({
              TargetId: str(input.TargetId),
              // The only filter this console asks for. Fixed here rather than
              // taken from the caller so a future reader cannot widen the read
              // to tag policies by passing a string.
              Filter: "SERVICE_CONTROL_POLICY",
              NextToken: str(input.NextToken),
            }),
          )

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

        /* ------------------------------------------------ SES (SESv2) --
         * `SendEmailCommand` is not imported, and `ses:SendEmail` is denied on
         * the task role. The console reports on this account's mail; it does
         * not send any.
         */
        case "ses:GetAccount":
          if (!sesv2) sesv2 = new SESv2Client({})
          return sesv2.send(new GetAccountCommand({}))

        case "ses:ListEmailIdentities":
          if (!sesv2) sesv2 = new SESv2Client({})
          return sesv2.send(
            new ListEmailIdentitiesCommand({ NextToken: str(input.NextToken), PageSize: 100 }),
          )

        case "ses:ListConfigurationSets":
          if (!sesv2) sesv2 = new SESv2Client({})
          return sesv2.send(
            new ListConfigurationSetsCommand({ NextToken: str(input.NextToken), PageSize: 100 }),
          )

        case "ses:GetConfigurationSet":
          if (!sesv2) sesv2 = new SESv2Client({})
          return sesv2.send(
            new GetConfigurationSetCommand({
              ConfigurationSetName: String(input.ConfigurationSetName),
            }),
          )

        case "ses:ListSuppressedDestinations":
          if (!sesv2) sesv2 = new SESv2Client({})
          return sesv2.send(
            new ListSuppressedDestinationsCommand({
              NextToken: str(input.NextToken),
              PageSize: 100,
            }),
          )

        /* ------------------------------------------------------- SQS -- */
        case "sqs:ListQueues":
          if (!sqs) sqs = new SQSClient({})
          return sqs.send(
            new ListQueuesCommand({
              QueueNamePrefix: str(input.QueueNamePrefix),
              NextToken: str(input.NextToken),
              MaxResults: 1000,
            }),
          )

        case "sqs:GetQueueAttributes":
          if (!sqs) sqs = new SQSClient({})
          return sqs.send(
            new GetQueueAttributesCommand({
              QueueUrl: String(input.QueueUrl),
              // Named rather than "All". "All" also returns the queue's access
              // policy and its KMS key id, which this console has no use for
              // and therefore should not hold in a render.
              AttributeNames: [
                "ApproximateNumberOfMessages",
                "ApproximateNumberOfMessagesNotVisible",
                "ApproximateNumberOfMessagesDelayed",
                "RedrivePolicy",
                "RedriveAllowPolicy",
                "QueueArn",
                "CreatedTimestamp",
                "LastModifiedTimestamp",
                "VisibilityTimeout",
                "MessageRetentionPeriod",
              ],
            }),
          )

        /* ---------------------------------------------------- Lambda -- */
        case "lambda:ListFunctions":
          if (!lambda) lambda = new LambdaClient({})
          return lambda.send(new ListFunctionsCommand({ Marker: str(input.Marker), MaxItems: 50 }))

        case "lambda:GetFunctionConcurrency":
          if (!lambda) lambda = new LambdaClient({})
          return lambda.send(
            new GetFunctionConcurrencyCommand({ FunctionName: String(input.FunctionName) }),
          )

        /* ------------------------------------------------------- IAM --
         * Two reads and nothing else. No Create, Attach, Put, Update or
         * Delete command is imported from this package, and the task role
         * denies every one of them by name.
         */
        case "iam:GetAccountAuthorizationDetails":
          if (!iam) iam = new IAMClient({})
          return iam.send(
            new GetAccountAuthorizationDetailsCommand({
              // Groups are not modelled by this platform, and AWS-managed
              // policy documents are AWS's, not this estate's — asking for
              // them would multiply the response size for nothing.
              Filter: ["User", "Role", "LocalManagedPolicy"],
              Marker: str(input.Marker),
              MaxItems: 100,
            }),
          )

        case "iam:ListAccessKeys":
          if (!iam) iam = new IAMClient({})
          return iam.send(
            new ListAccessKeysCommand({
              UserName: String(input.UserName),
              Marker: str(input.Marker),
            }),
          )

        /* --------------------------------------------------- Budgets --
         * `AccountId` is required by the API and is passed in by the caller
         * from `sts:GetCallerIdentity` — never from an environment default,
         * because a budget read against the wrong account returns an empty
         * list rather than an error.
         */
        case "budgets:DescribeBudgets":
          if (!budgets) budgets = new BudgetsClient({})
          return budgets.send(
            new DescribeBudgetsCommand({
              AccountId: String(input.AccountId),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        /* ------------------------------------------------ AWS Health -- */
        case "health:DescribeEvents":
          if (!awsHealth) awsHealth = new HealthClient({})
          return awsHealth.send(
            new DescribeEventsCommand({
              // Closed events are history. This surface answers "is something
              // wrong now, or about to be".
              filter: { eventStatusCodes: ["open", "upcoming"] },
              maxResults: 100,
              nextToken: str(input.nextToken),
            }),
          )

        case "health:DescribeAffectedEntities":
          if (!awsHealth) awsHealth = new HealthClient({})
          return awsHealth.send(
            new DescribeAffectedEntitiesCommand({
              filter: { eventArns: strings(input.eventArns) ?? [] },
              maxResults: 100,
              nextToken: str(input.nextToken),
            }),
          )

        /* ----------------------------------------------- EventBridge -- */
        case "events:ListRules":
          if (!eventbridge) eventbridge = new EventBridgeClient({})
          return eventbridge.send(
            new ListRulesCommand({
              EventBusName: str(input.EventBusName),
              NamePrefix: str(input.NamePrefix),
              NextToken: str(input.NextToken),
              Limit: 100,
            }),
          )

        case "events:ListTargetsByRule":
          if (!eventbridge) eventbridge = new EventBridgeClient({})
          return eventbridge.send(
            new ListTargetsByRuleCommand({
              Rule: String(input.Rule),
              EventBusName: str(input.EventBusName),
              NextToken: str(input.NextToken),
              Limit: 100,
            }),
          )

        /* --------------------------------------------------- Cognito --
         * The console's own front door. No `Admin*` command is imported
         * from this package: reading who may sign in is a different power
         * from changing it, and only the first one is here.
         */
        case "cognito-idp:ListUserPools":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(
            new ListUserPoolsCommand({ MaxResults: 60, NextToken: str(input.NextToken) }),
          )

        case "cognito-idp:DescribeUserPool":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(new DescribeUserPoolCommand({ UserPoolId: String(input.UserPoolId) }))

        case "cognito-idp:ListUserPoolClients":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(
            new ListUserPoolClientsCommand({
              UserPoolId: String(input.UserPoolId),
              MaxResults: 60,
              NextToken: str(input.NextToken),
            }),
          )

        case "cognito-idp:DescribeUserPoolClient":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(
            new DescribeUserPoolClientCommand({
              UserPoolId: String(input.UserPoolId),
              ClientId: String(input.ClientId),
            }),
          )

        case "cognito-idp:DescribeUserPoolDomain":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(new DescribeUserPoolDomainCommand({ Domain: String(input.Domain) }))

        case "cognito-idp:GetUserPoolMfaConfig":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(
            new GetUserPoolMfaConfigCommand({ UserPoolId: String(input.UserPoolId) }),
          )

        case "cognito-idp:ListUsers":
          if (!cognito) cognito = new CognitoIdentityProviderClient({})
          return cognito.send(
            new ListUsersCommand({
              UserPoolId: String(input.UserPoolId),
              Limit: 60,
              PaginationToken: str(input.PaginationToken),
              // One attribute, named. Without this the response carries every
              // custom attribute on the profile — phone numbers, names — into
              // a render that only needs to say who can sign in. `Enabled` and
              // `UserStatus` are top-level fields and arrive regardless.
              AttributesToGet: ["email"],
            }),
          )

        /* ------------------------------------------------------- EC2 --
         * Eight Describe calls and nothing else. No RunInstances, no
         * AuthorizeSecurityGroupIngress, no TerminateInstances: not one
         * mutating EC2 command is imported into this file.
         */
        case "ec2:DescribeVpcs":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeVpcsCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeSubnets":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeSubnetsCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeSecurityGroups":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeSecurityGroupsCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeRouteTables":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeRouteTablesCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeInternetGateways":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeInternetGatewaysCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeNatGateways":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeNatGatewaysCommand({
              Filter: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeVpcEndpoints":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeVpcEndpointsCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        case "ec2:DescribeNetworkAcls":
          if (!ec2) ec2 = new EC2Client({})
          return ec2.send(
            new DescribeNetworkAclsCommand({
              Filters: ec2Filters(input.Filters),
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        /* ---------------------------------------- Elastic Load Balancing -- */
        case "elasticloadbalancing:DescribeLoadBalancers":
          if (!elbv2) elbv2 = new ElasticLoadBalancingV2Client({})
          return elbv2.send(
            new DescribeLoadBalancersCommand({
              LoadBalancerArns: strings(input.LoadBalancerArns),
              Marker: str(input.Marker),
              PageSize: 400,
            }),
          )

        case "elasticloadbalancing:DescribeListeners":
          if (!elbv2) elbv2 = new ElasticLoadBalancingV2Client({})
          return elbv2.send(
            new DescribeListenersCommand({
              LoadBalancerArn: str(input.LoadBalancerArn),
              ListenerArns: strings(input.ListenerArns),
              Marker: str(input.Marker),
              PageSize: 400,
            }),
          )

        case "elasticloadbalancing:DescribeTargetGroups":
          if (!elbv2) elbv2 = new ElasticLoadBalancingV2Client({})
          return elbv2.send(
            new DescribeTargetGroupsCommand({
              LoadBalancerArn: str(input.LoadBalancerArn),
              TargetGroupArns: strings(input.TargetGroupArns),
              Marker: str(input.Marker),
              PageSize: 400,
            }),
          )

        case "elasticloadbalancing:DescribeTargetHealth":
          if (!elbv2) elbv2 = new ElasticLoadBalancingV2Client({})
          return elbv2.send(
            new DescribeTargetHealthCommand({ TargetGroupArn: String(input.TargetGroupArn) }),
          )

        case "elasticloadbalancing:DescribeRules":
          if (!elbv2) elbv2 = new ElasticLoadBalancingV2Client({})
          return elbv2.send(
            new DescribeRulesCommand({
              ListenerArn: str(input.ListenerArn),
              RuleArns: strings(input.RuleArns),
              Marker: str(input.Marker),
              PageSize: 400,
            }),
          )

        /* ------------------------------------------------------- ECR -- */
        case "ecr:DescribeRepositories":
          if (!ecr) ecr = new ECRClient({})
          return ecr.send(
            new DescribeRepositoriesCommand({
              repositoryNames: strings(input.repositoryNames),
              nextToken: str(input.nextToken),
              maxResults: 100,
            }),
          )

        case "ecr:DescribeImages":
          if (!ecr) ecr = new ECRClient({})
          return ecr.send(
            new DescribeImagesCommand({
              repositoryName: String(input.repositoryName),
              nextToken: str(input.nextToken),
              maxResults: 100,
            }),
          )

        case "ecr:DescribeImageScanFindings":
          if (!ecr) ecr = new ECRClient({})
          return ecr.send(
            new DescribeImageScanFindingsCommand({
              repositoryName: String(input.repositoryName),
              // One or the other. A digest is exact; a tag is what a deploy
              // pipeline knows, and both are supplied by the caller.
              imageId: { imageTag: str(input.imageTag), imageDigest: str(input.imageDigest) },
              nextToken: str(input.nextToken),
              maxResults: 100,
            }),
          )

        case "ecr:GetLifecyclePolicy":
          if (!ecr) ecr = new ECRClient({})
          return ecr.send(
            new GetLifecyclePolicyCommand({ repositoryName: String(input.repositoryName) }),
          )

        /* ----------------------------------------------- ElastiCache -- */
        case "elasticache:DescribeCacheClusters":
          if (!elasticache) elasticache = new ElastiCacheClient({})
          return elasticache.send(
            new DescribeCacheClustersCommand({
              CacheClusterId: str(input.CacheClusterId),
              // Node-level detail carries the endpoint address, which is what
              // makes "the cache the app is configured against" checkable.
              ShowCacheNodeInfo: true,
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        case "elasticache:DescribeReplicationGroups":
          if (!elasticache) elasticache = new ElastiCacheClient({})
          return elasticache.send(
            new DescribeReplicationGroupsCommand({
              ReplicationGroupId: str(input.ReplicationGroupId),
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        case "elasticache:DescribeCacheParameters":
          if (!elasticache) elasticache = new ElastiCacheClient({})
          return elasticache.send(
            new DescribeCacheParametersCommand({
              CacheParameterGroupName: String(input.CacheParameterGroupName),
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        /* ------------------------------------- DynamoDB control plane --
         * Four describes and no data-plane command. `GetItem`, `Query`,
         * `Scan` and every write live in `lib/registry.ts`, which is the
         * only module that reads a tenant's record; these four read the
         * TABLE — its encryption, its backups, its TTL — and cannot return
         * an item.
         */
        case "dynamodb:ListTables":
          if (!dynamodb) dynamodb = new DynamoDBClient({})
          return dynamodb.send(
            new ListTablesCommand({
              ExclusiveStartTableName: str(input.ExclusiveStartTableName),
              Limit: 100,
            }),
          )

        case "dynamodb:DescribeTable":
          if (!dynamodb) dynamodb = new DynamoDBClient({})
          return dynamodb.send(new DescribeTableCommand({ TableName: String(input.TableName) }))

        case "dynamodb:DescribeContinuousBackups":
          if (!dynamodb) dynamodb = new DynamoDBClient({})
          return dynamodb.send(
            new DescribeContinuousBackupsCommand({ TableName: String(input.TableName) }),
          )

        case "dynamodb:DescribeTimeToLive":
          if (!dynamodb) dynamodb = new DynamoDBClient({})
          return dynamodb.send(
            new DescribeTimeToLiveCommand({ TableName: String(input.TableName) }),
          )

        /* ---------------------------------------- CloudWatch metrics -- */
        case "cloudwatch:GetMetricData":
          if (!cloudwatch) cloudwatch = new CloudWatchClient({})
          return cloudwatch.send(
            new GetMetricDataCommand({
              MetricDataQueries: metricQueries(input.MetricDataQueries),
              StartTime: date(input.StartTime),
              EndTime: date(input.EndTime),
              // Newest first, so a truncated response is the recent end of the
              // window rather than the oldest datapoints in it.
              ScanBy: "TimestampDescending",
              MaxDatapoints: 1440,
              NextToken: str(input.NextToken),
            }),
          )

        case "cloudwatch:ListDashboards":
          if (!cloudwatch) cloudwatch = new CloudWatchClient({})
          return cloudwatch.send(
            new ListDashboardsCommand({
              DashboardNamePrefix: str(input.DashboardNamePrefix),
              NextToken: str(input.NextToken),
            }),
          )

        case "cloudwatch:GetDashboard":
          if (!cloudwatch) cloudwatch = new CloudWatchClient({})
          return cloudwatch.send(
            new GetDashboardCommand({ DashboardName: String(input.DashboardName) }),
          )

        /* ------------------------------------------------------ logs -- */
        case "logs:DescribeMetricFilters":
          if (!logs) logs = new CloudWatchLogsClient({})
          return logs.send(
            new DescribeMetricFiltersCommand({
              logGroupName: str(input.logGroupName),
              filterNamePrefix: str(input.filterNamePrefix),
              nextToken: str(input.nextToken),
              limit: 50,
            }),
          )

        case "logs:FilterLogEvents":
          if (!logs) logs = new CloudWatchLogsClient({})
          return logs.send(
            new FilterLogEventsCommand({
              logGroupName: String(input.logGroupName),
              startTime: millis(input.startTime),
              endTime: millis(input.endTime),
              filterPattern: str(input.filterPattern),
              nextToken: str(input.nextToken),
              // Capped here rather than by the caller: this API is billed for
              // the bytes it scans, and an unbounded limit on a page somebody
              // leaves open is a bill nobody chose.
              limit: 100,
            }),
          )

        /* -------------------------------------------------------- S3 --
         * Bucket-level only. `GetObjectCommand` is not imported and never
         * will be: these buckets hold tenant documents.
         */
        case "s3:ListBuckets":
          if (!s3) s3 = new S3Client({})
          return s3.send(new ListBucketsCommand({ ContinuationToken: str(input.ContinuationToken) }))

        case "s3:GetBucketPublicAccessBlock":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetPublicAccessBlockCommand({ Bucket: String(input.Bucket) }))

        case "s3:GetBucketEncryption":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetBucketEncryptionCommand({ Bucket: String(input.Bucket) }))

        case "s3:GetBucketVersioning":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetBucketVersioningCommand({ Bucket: String(input.Bucket) }))

        case "s3:GetBucketLifecycleConfiguration":
          if (!s3) s3 = new S3Client({})
          return s3.send(
            new GetBucketLifecycleConfigurationCommand({ Bucket: String(input.Bucket) }),
          )

        case "s3:GetBucketPolicyStatus":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetBucketPolicyStatusCommand({ Bucket: String(input.Bucket) }))

        case "s3:GetBucketTagging":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetBucketTaggingCommand({ Bucket: String(input.Bucket) }))

        case "s3:GetBucketCors":
          if (!s3) s3 = new S3Client({})
          return s3.send(new GetBucketCorsCommand({ Bucket: String(input.Bucket) }))

        /* -------------------------------------------- Secrets Manager --
         * The inventory half. Still metadata: `ListSecrets` returns names,
         * rotation state and timestamps, and cannot return a value.
         */
        case "secretsmanager:ListSecrets":
          if (!secretsManager) secretsManager = new SecretsManagerClient({})
          return secretsManager.send(
            new ListSecretsCommand({
              // A secret scheduled for deletion still exists and still has a
              // recovery window; hiding it would report it as already gone.
              IncludePlannedDeletion: true,
              MaxResults: 100,
              NextToken: str(input.NextToken),
            }),
          )

        /* ------------------------------------------------------- KMS -- */
        case "kms:DescribeKey":
          if (!kms) kms = new KMSClient({})
          return kms.send(new DescribeKeyCommand({ KeyId: String(input.KeyId) }))

        case "kms:GetKeyRotationStatus":
          if (!kms) kms = new KMSClient({})
          return kms.send(new GetKeyRotationStatusCommand({ KeyId: String(input.KeyId) }))

        /* ------------------------------------------------ CloudTrail -- */
        case "cloudtrail:GetTrailStatus":
          if (!cloudtrail) cloudtrail = new CloudTrailClient({})
          return cloudtrail.send(new GetTrailStatusCommand({ Name: String(input.Name) }))

        case "cloudtrail:LookupEvents":
          if (!cloudtrail) cloudtrail = new CloudTrailClient({})
          return cloudtrail.send(
            new LookupEventsCommand({
              StartTime: date(input.StartTime),
              EndTime: date(input.EndTime),
              LookupAttributes: lookupAttributes(input.LookupAttributes),
              MaxResults: 50,
              NextToken: str(input.NextToken),
            }),
          )

        /* ---------------------------------------------------- Config -- */
        case "config:DescribeConfigRules":
          if (!configService) configService = new ConfigServiceClient({})
          return configService.send(
            new DescribeConfigRulesCommand({ NextToken: str(input.NextToken) }),
          )

        case "config:DescribeComplianceByConfigRule":
          if (!configService) configService = new ConfigServiceClient({})
          return configService.send(
            new DescribeComplianceByConfigRuleCommand({
              ConfigRuleNames: strings(input.ConfigRuleNames),
              NextToken: str(input.NextToken),
            }),
          )

        /* -------------------------------------------------- Route 53 -- */
        case "route53:ListResourceRecordSets":
          if (!route53) route53 = new Route53Client({})
          return route53.send(
            new ListResourceRecordSetsCommand({
              HostedZoneId: String(input.HostedZoneId),
              StartRecordName: str(input.StartRecordName),
              MaxItems: 300,
            }),
          )

        /* ------------------------------------------------ CloudFront -- */
        case "cloudfront:GetDistributionConfig":
          if (!cloudfront) cloudfront = new CloudFrontClient({})
          return cloudfront.send(new GetDistributionConfigCommand({ Id: String(input.Id) }))

        case "cloudfront:ListInvalidations":
          if (!cloudfront) cloudfront = new CloudFrontClient({})
          return cloudfront.send(
            new ListInvalidationsCommand({
              DistributionId: String(input.DistributionId),
              Marker: str(input.Marker),
              MaxItems: 100,
            }),
          )

        /* ------------------------------------------------------- RDS -- */
        case "rds:DescribePendingMaintenanceActions":
          if (!rds) rds = new RDSClient({})
          return rds.send(
            new DescribePendingMaintenanceActionsCommand({
              ResourceIdentifier: str(input.ResourceIdentifier),
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        case "rds:DescribeEvents":
          if (!rds) rds = new RDSClient({})
          return rds.send(
            new DescribeRdsEventsCommand({
              SourceIdentifier: str(input.SourceIdentifier),
              // The API requires a SourceType whenever an identifier is given,
              // and rejects the call otherwise. The default names the only kind
              // of source this estate has; the caller may narrow it.
              SourceType: input.SourceIdentifier
                ? (rdsSourceType(input.SourceType) ?? "db-instance")
                : rdsSourceType(input.SourceType),
              // Minutes of history. A day by default: long enough to cover the
              // night a database restarted itself.
              Duration: num(input.Duration) ?? 1440,
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        case "rds:DescribeDBParameterGroups":
          if (!rds) rds = new RDSClient({})
          return rds.send(
            new DescribeDBParameterGroupsCommand({
              DBParameterGroupName: str(input.DBParameterGroupName),
              Marker: str(input.Marker),
              MaxRecords: 100,
            }),
          )

        /* ------------------------------------------------------- ECS -- */
        case "ecs:DescribeClusters":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(
            new DescribeClustersCommand({
              clusters: strings(input.clusters),
              include: ["SETTINGS", "STATISTICS", "CONFIGURATIONS"],
            }),
          )

        case "ecs:ListTasks":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(
            new ListTasksCommand({
              cluster: str(input.cluster),
              serviceName: str(input.serviceName),
              desiredStatus: taskStatus(input.desiredStatus),
              nextToken: str(input.nextToken),
              maxResults: 100,
            }),
          )

        case "ecs:DescribeTasks":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(
            new DescribeTasksCommand({
              cluster: str(input.cluster),
              tasks: strings(input.tasks) ?? [],
            }),
          )

        case "ecs:DescribeTaskDefinition":
          if (!ecs) ecs = new ECSClient({})
          return ecs.send(
            new DescribeTaskDefinitionCommand({
              taskDefinition: String(input.taskDefinition),
            }),
          )

        /* ------------------------------------------------------- ACM -- */
        case "acm:DescribeCertificate":
          if (!acm) acm = new ACMClient({})
          return acm.send(
            new DescribeCertificateCommand({ CertificateArn: String(input.CertificateArn) }),
          )

        /* --------------------------------------------- Service Quotas -- */
        case "servicequotas:ListServiceQuotas":
          if (!servicequotas) servicequotas = new ServiceQuotasClient({})
          return servicequotas.send(
            new ListServiceQuotasCommand({
              ServiceCode: String(input.ServiceCode),
              NextToken: str(input.NextToken),
              MaxResults: 100,
            }),
          )

        case "servicequotas:GetServiceQuota":
          if (!servicequotas) servicequotas = new ServiceQuotasClient({})
          return servicequotas.send(
            new GetServiceQuotaCommand({
              ServiceCode: String(input.ServiceCode),
              QuotaCode: String(input.QuotaCode),
            }),
          )

        /* -------------------------------------------- Access Analyzer -- */
        case "access-analyzer:ListAnalyzers":
          if (!accessAnalyzer) accessAnalyzer = new AccessAnalyzerClient({})
          return accessAnalyzer.send(
            new ListAnalyzersCommand({ nextToken: str(input.nextToken), maxResults: 100 }),
          )

        case "access-analyzer:ListFindingsV2":
          if (!accessAnalyzer) accessAnalyzer = new AccessAnalyzerClient({})
          return accessAnalyzer.send(
            new ListFindingsV2Command({
              analyzerArn: String(input.analyzerArn),
              nextToken: str(input.nextToken),
              maxResults: 100,
            }),
          )

        /* ------------------------------------------------- GuardDuty -- */
        case "guardduty:ListDetectors":
          if (!guardduty) guardduty = new GuardDutyClient({})
          return guardduty.send(
            new ListDetectorsCommand({ NextToken: str(input.NextToken), MaxResults: 50 }),
          )

        case "guardduty:ListFindings":
          if (!guardduty) guardduty = new GuardDutyClient({})
          return guardduty.send(
            new ListFindingsCommand({
              DetectorId: String(input.DetectorId),
              SortCriteria: { AttributeName: "updatedAt", OrderBy: "DESC" },
              NextToken: str(input.NextToken),
              MaxResults: 50,
            }),
          )

        case "guardduty:GetFindings":
          if (!guardduty) guardduty = new GuardDutyClient({})
          return guardduty.send(
            new GetGuardDutyFindingsCommand({
              DetectorId: String(input.DetectorId),
              FindingIds: strings(input.FindingIds) ?? [],
            }),
          )

        /* --------------------------------------------------- Pricing --
         * The one client built with a region, and it is read from the
         * environment rather than written here — see globalEndpointRegion.
         * The Price List API is not served from every region; that is a
         * property of the API, not a decision about where this estate is.
         */
        case "pricing:ListPriceLists":
          if (!pricing) pricing = new PricingClient({ region: globalEndpointRegion("the Price List API") })
          return pricing.send(
            new ListPriceListsCommand({
              ServiceCode: String(input.ServiceCode),
              EffectiveDate: date(input.EffectiveDate) ?? new Date(),
              CurrencyCode: String(input.CurrencyCode),
              RegionCode: str(input.RegionCode),
              NextToken: str(input.NextToken),
              MaxResults: 100,
            }),
          )

        case "pricing:GetProducts":
          if (!pricing) pricing = new PricingClient({ region: globalEndpointRegion("the Price List API") })
          return pricing.send(
            new GetProductsCommand({
              ServiceCode: String(input.ServiceCode),
              Filters: pricingFilters(input.Filters),
              NextToken: str(input.NextToken),
              MaxResults: 100,
            }),
          )

        /* ------------------------------------------------------- WAF --
         * Two clients, deliberately. A REGIONAL web ACL is read in the
         * resolved region; a CLOUDFRONT-scoped one is only served from the
         * partition's global endpoint, and asking the regional client for
         * it fails in a way that reads as "no WAF".
         */
        case "wafv2:ListWebACLs": {
          const scope = wafScope(input.Scope)
          if (scope === "CLOUDFRONT") {
            if (!wafv2Global) {
              wafv2Global = new WAFV2Client({
                region: globalEndpointRegion("WAFv2's CLOUDFRONT scope"),
              })
            }
            return wafv2Global.send(
              new ListWebACLsCommand({ Scope: scope, Limit: 100, NextMarker: str(input.NextMarker) }),
            )
          }
          if (!wafv2) wafv2 = new WAFV2Client({})
          return wafv2.send(
            new ListWebACLsCommand({ Scope: scope, Limit: 100, NextMarker: str(input.NextMarker) }),
          )
        }

        case "wafv2:GetWebACLForResource":
          // Regional by definition: the protected resources this call accepts
          // are load balancers, API stages and AppSync APIs, never a
          // distribution. No global client here.
          if (!wafv2) wafv2 = new WAFV2Client({})
          return wafv2.send(
            new GetWebACLForResourceCommand({ ResourceArn: String(input.ResourceArn) }),
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

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** An ISO-8601 string, or nothing. Never `new Date(undefined)`, which is Invalid Date. */
function date(value: unknown): Date | undefined {
  const raw = str(value)
  if (!raw) return undefined
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Epoch milliseconds, from a number or an ISO string. */
function millis(value: unknown): number | undefined {
  return num(value) ?? date(value)?.getTime()
}

/**
 * One of a closed set, or nothing.
 *
 * The shape every enum argument below goes through. An SDK enum member is a
 * string union in the types and a plain string at runtime, so an unchecked
 * `input.Scope as Scope` would let a caller put any string into a request — a
 * narrow version of the arbitrary-parameter endpoint this whole file avoids.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const raw = str(value)
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
}

/**
 * EC2's `{ Name, Values }` filter list, rebuilt field by field.
 *
 * Passed through rather than trusted: each entry is reconstructed from a name
 * and a list of strings, so an object carrying anything else arrives as
 * `undefined` instead of reaching the API.
 */
function ec2Filters(value: unknown): { Name: string; Values: string[] }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const built: { Name: string; Values: string[] }[] = []
  for (const entry of value) {
    const name = str((entry as { Name?: unknown } | null)?.Name)
    const values = strings((entry as { Values?: unknown } | null)?.Values)
    if (name && values && values.length > 0) built.push({ Name: name, Values: values })
  }
  return built.length > 0 ? built : undefined
}

/** CloudWatch's `MetricStat` query, rebuilt field by field. */
interface MetricQuery {
  Id: string
  MetricStat: {
    Metric: { Namespace: string; MetricName: string; Dimensions?: { Name: string; Value: string }[] }
    Period: number
    Stat: string
  }
  Label?: string
  ReturnData: boolean
}

/**
 * `GetMetricData` queries, with the `Expression` field deliberately dropped.
 *
 * A metric-math expression may contain `SEARCH()`, which returns metrics
 * matching a pattern across the whole account — a query language reaching
 * further than the capability that carries it. Only an explicit
 * namespace/name/dimension triple survives this function, so what the console
 * can ask for is what a reviewer can enumerate.
 */
function metricQueries(value: unknown): MetricQuery[] {
  if (!Array.isArray(value)) return []
  const built: MetricQuery[] = []
  for (const entry of value) {
    const q = entry as Record<string, unknown> | null
    const stat = q?.MetricStat as Record<string, unknown> | undefined
    const metric = stat?.Metric as Record<string, unknown> | undefined
    const id = str(q?.Id)
    const namespace = str(metric?.Namespace)
    const metricName = str(metric?.MetricName)
    const period = num(stat?.Period)
    const statistic = str(stat?.Stat)
    if (!id || !namespace || !metricName || !period || !statistic) continue

    const dimensions: { Name: string; Value: string }[] = []
    if (Array.isArray(metric?.Dimensions)) {
      for (const dimension of metric.Dimensions as unknown[]) {
        const name = str((dimension as { Name?: unknown } | null)?.Name)
        const dimensionValue = str((dimension as { Value?: unknown } | null)?.Value)
        if (name && dimensionValue) dimensions.push({ Name: name, Value: dimensionValue })
      }
    }

    built.push({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: namespace,
          MetricName: metricName,
          Dimensions: dimensions.length > 0 ? dimensions : undefined,
        },
        Period: period,
        Stat: statistic,
      },
      Label: str(q?.Label),
      ReturnData: true,
    })
  }
  return built
}

/** The lookup keys CloudTrail accepts. Anything else is dropped, not passed. */
const LOOKUP_KEYS = [
  "EventId",
  "EventName",
  "ReadOnly",
  "Username",
  "ResourceType",
  "ResourceName",
  "EventSource",
  "AccessKeyId",
] as const

function lookupAttributes(
  value: unknown,
): { AttributeKey: (typeof LOOKUP_KEYS)[number]; AttributeValue: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const built: { AttributeKey: (typeof LOOKUP_KEYS)[number]; AttributeValue: string }[] = []
  for (const entry of value) {
    const key = oneOf((entry as { AttributeKey?: unknown } | null)?.AttributeKey, LOOKUP_KEYS)
    const attributeValue = str((entry as { AttributeValue?: unknown } | null)?.AttributeValue)
    if (key && attributeValue) built.push({ AttributeKey: key, AttributeValue: attributeValue })
  }
  return built.length > 0 ? built : undefined
}

/** The six source kinds RDS events are raised against. */
const RDS_SOURCE_TYPES = [
  "db-instance",
  "db-parameter-group",
  "db-security-group",
  "db-snapshot",
  "db-cluster",
  "db-cluster-snapshot",
] as const

function rdsSourceType(value: unknown): (typeof RDS_SOURCE_TYPES)[number] | undefined {
  return oneOf(value, RDS_SOURCE_TYPES)
}

/** ECS task lifecycle states, for ListTasks. */
function taskStatus(value: unknown): "RUNNING" | "PENDING" | "STOPPED" | undefined {
  return oneOf(value, ["RUNNING", "PENDING", "STOPPED"] as const)
}

/** WAFv2's two scopes. Regional resources, or the edge. */
function wafScope(value: unknown): "REGIONAL" | "CLOUDFRONT" {
  return oneOf(value, ["REGIONAL", "CLOUDFRONT"] as const) ?? "REGIONAL"
}

/**
 * Price List filters. `TERM_MATCH` is forced: it is the only match type the API
 * defines, and reading it from the caller would be a parameter with one legal
 * value pretending to be a choice.
 */
function pricingFilters(
  value: unknown,
): { Type: "TERM_MATCH"; Field: string; Value: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const built: { Type: "TERM_MATCH"; Field: string; Value: string }[] = []
  for (const entry of value) {
    const field = str((entry as { Field?: unknown } | null)?.Field)
    const filterValue = str((entry as { Value?: unknown } | null)?.Value)
    if (field && filterValue) built.push({ Type: "TERM_MATCH", Field: field, Value: filterValue })
  }
  return built.length > 0 ? built : undefined
}
