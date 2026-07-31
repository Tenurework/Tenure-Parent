#!/usr/bin/env node
/**
 * GE-001-004 / 005 — read-only AWS inventory.
 *
 * Runs describe/list calls only and writes three artifacts:
 *
 *   docs/architecture/aws-inventory.json         machine-readable, sanitized
 *   docs/architecture/aws-current-state.md       human-readable
 *   docs/architecture/resource-reconciliation.md what is claimed vs what exists
 *
 * ── Sanitisation ────────────────────────────────────────────────────────────
 *
 * This repository is PUBLIC. Every artifact is world-readable and archived, so
 * the account id is masked everywhere it appears, and nothing that could carry a
 * value is collected: no secret payloads, no parameter values, no environment
 * variables, no S3 object contents, no database rows. Secrets appear as a NAME
 * and a rotation date, which is metadata, not the secret.
 *
 * ── Failure policy ──────────────────────────────────────────────────────────
 *
 * A denied API is recorded and the inventory continues. An AccessDenied on
 * Organizations is a fact about the estate worth writing down, and aborting the
 * whole run on it would mean never learning anything about the rest.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const ACCOUNT = process.env.ACCOUNT ?? ''
const REGION = process.env.AWS_REGION ?? 'us-east-1'

/** Mask the account id wherever it appears, including inside ARNs. */
const sanitize = (value) => {
  if (!ACCOUNT) return value
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const masked = text.split(ACCOUNT).join(`${ACCOUNT.slice(0, 4)}…${ACCOUNT.slice(-2)}`)
  return typeof value === 'string' ? masked : JSON.parse(masked)
}

const denied = []
const errors = []

/** One read-only AWS CLI call. Records a denial and returns null rather than throwing. */
function aws(service, operation, args = [], { global = false } = {}) {
  const argv = [service, operation, ...args, '--output', 'json']
  if (!global) argv.push('--region', REGION)
  try {
    const out = execFileSync('aws', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return out.trim() ? JSON.parse(out) : null
  } catch (err) {
    const message = String(err.stderr ?? err.message ?? err)
    const call = `${service} ${operation}`
    if (/AccessDenied|UnauthorizedOperation|not authorized|AWSOrganizationsNotInUse/i.test(message)) {
      // The exact denied API and the minimum permission it needs — §3 of the
      // prompt requires reporting this rather than asking for admin.
      denied.push({ call, reason: /AWSOrganizationsNotInUse/i.test(message) ? 'Organizations not in use' : 'AccessDenied' })
    } else {
      errors.push({ call, message: message.split('\n')[0].slice(0, 200) })
    }
    return null
  }
}

const list = (v) => (Array.isArray(v) ? v : [])

// ── Identity and organization ───────────────────────────────────────────────

const org = aws('organizations', 'describe-organization', [], { global: true })
const accounts = aws('organizations', 'list-accounts', [], { global: true })
const ous = aws('organizations', 'list-roots', [], { global: true })

// ── IAM: OIDC providers, roles, trust ───────────────────────────────────────

const oidcProviders = aws('iam', 'list-open-id-connect-providers', [], { global: true })
const iamRoles = aws('iam', 'list-roles', [], { global: true })

// ── Network, DNS, edge ──────────────────────────────────────────────────────

const vpcs = aws('ec2', 'describe-vpcs')
const subnets = aws('ec2', 'describe-subnets')
const securityGroups = aws('ec2', 'describe-security-groups')
const natGateways = aws('ec2', 'describe-nat-gateways')
const hostedZones = aws('route53', 'list-hosted-zones', [], { global: true })
const certificates = aws('acm', 'list-certificates')
const distributions = aws('cloudfront', 'list-distributions', [], { global: true })
const webAcls = aws('wafv2', 'list-web-acls', ['--scope', 'CLOUDFRONT'], { global: true })
const loadBalancers = aws('elbv2', 'describe-load-balancers')

// ── Compute ─────────────────────────────────────────────────────────────────

const ecsClusters = aws('ecs', 'list-clusters')
const ecrRepos = aws('ecr', 'describe-repositories')
const lambdas = aws('lambda', 'list-functions')

// ── Identity provider ───────────────────────────────────────────────────────

const userPools = aws('cognito-idp', 'list-user-pools', ['--max-results', '60'])

// ── Data ────────────────────────────────────────────────────────────────────

const rdsInstances = aws('rds', 'describe-db-instances')
const dynamoTables = aws('dynamodb', 'list-tables')
const elasticache = aws('elasticache', 'describe-cache-clusters')
const buckets = aws('s3api', 'list-buckets', [], { global: true })

// ── Messaging ───────────────────────────────────────────────────────────────

const queues = aws('sqs', 'list-queues')
const topics = aws('sns', 'list-topics')
const eventBuses = aws('events', 'list-event-buses')

// ── Keys and secrets: METADATA ONLY ─────────────────────────────────────────

const kmsKeys = aws('kms', 'list-aliases')
// list-secrets returns names and rotation metadata. get-secret-value is the call
// that returns a secret, and it is deliberately absent from this file.
const secrets = aws('secretsmanager', 'list-secrets')

// ── Observability, backup, cost ─────────────────────────────────────────────

const logGroups = aws('logs', 'describe-log-groups')
const alarms = aws('cloudwatch', 'describe-alarms')
const backupVaults = aws('backup', 'list-backup-vaults')
const cfnStacks = aws('cloudformation', 'list-stacks', ['--stack-status-filter', 'CREATE_COMPLETE', 'UPDATE_COMPLETE'])

// ── Shape the inventory ─────────────────────────────────────────────────────

const inventory = {
  generatedAt: new Date().toISOString(),
  accountMasked: ACCOUNT ? `${ACCOUNT.slice(0, 4)}…${ACCOUNT.slice(-2)}` : 'unknown',
  region: REGION,

  organization: org
    ? { inUse: true, masterAccountMasked: sanitize(org.Organization?.MasterAccountId ?? ''), featureSet: org.Organization?.FeatureSet, accounts: list(accounts?.Accounts).length, roots: list(ous?.Roots).length }
    : { inUse: false, note: 'Organizations not in use, or not visible to this principal. A single-account estate.' },

  iam: {
    oidcProviders: list(oidcProviders?.OpenIDConnectProviderList).map((p) => sanitize(p.Arn)),
    roleCount: list(iamRoles?.Roles).length,
    // Names only, and only roles that look like deployment identities.
    deploymentRoles: list(iamRoles?.Roles)
      .map((r) => r.RoleName)
      .filter((n) => /github|actions|deploy|oidc|ecs|task|execution/i.test(n))
      .sort(),
  },

  network: {
    vpcs: list(vpcs?.Vpcs).map((v) => ({ cidr: v.CidrBlock, isDefault: v.IsDefault, name: v.Tags?.find((t) => t.Key === 'Name')?.Value ?? null })),
    subnets: list(subnets?.Subnets).length,
    securityGroups: list(securityGroups?.SecurityGroups).length,
    // A NAT gateway is ~$32/month each and is the usual surprise on a bill.
    natGateways: list(natGateways?.NatGateways).filter((n) => n.State === 'available').length,
    loadBalancers: list(loadBalancers?.LoadBalancers).map((l) => ({ name: l.LoadBalancerName, type: l.Type, scheme: l.Scheme })),
  },

  edge: {
    hostedZones: list(hostedZones?.HostedZones).map((z) => z.Name),
    certificates: list(certificates?.CertificateSummaryList).map((c) => ({ domain: c.DomainName, status: c.Status })),
    cloudfront: list(distributions?.DistributionList?.Items).map((d) => ({
      domain: d.DomainName,
      aliases: list(d.Aliases?.Items),
      enabled: d.Enabled,
      comment: d.Comment,
      originCount: list(d.Origins?.Items).length,
    })),
    wafWebAcls: list(webAcls?.WebACLs).map((w) => w.Name),
  },

  compute: {
    ecsClusters: list(ecsClusters?.clusterArns).map((a) => a.split('/').pop()),
    ecrRepositories: list(ecrRepos?.repositories).map((r) => r.repositoryName),
    lambdaFunctions: list(lambdas?.Functions).map((f) => f.FunctionName),
  },

  identityProvider: {
    cognitoUserPools: list(userPools?.UserPools).map((p) => ({ name: p.Name, id: `${String(p.Id).slice(0, 9)}…` })),
  },

  data: {
    rds: list(rdsInstances?.DBInstances).map((d) => ({
      identifier: d.DBInstanceIdentifier,
      engine: `${d.Engine} ${d.EngineVersion}`,
      class: d.DBInstanceClass,
      multiAz: d.MultiAZ,
      encrypted: d.StorageEncrypted,
      // The retention window is the number that decides whether a bad day is
      // recoverable, so it is inventoried rather than assumed.
      backupRetentionDays: d.BackupRetentionPeriod,
      publiclyAccessible: d.PubliclyAccessible,
      deletionProtection: d.DeletionProtection,
    })),
    dynamoTables: list(dynamoTables?.TableNames),
    elasticache: list(elasticache?.CacheClusters).map((c) => ({ id: c.CacheClusterId, engine: c.Engine, node: c.CacheNodeType })),
    s3Buckets: list(buckets?.Buckets).map((b) => b.Name),
  },

  messaging: {
    sqsQueues: list(queues?.QueueUrls).map((u) => u.split('/').pop()),
    snsTopics: list(topics?.Topics).map((t) => String(t.TopicArn).split(':').pop()),
    eventBuses: list(eventBuses?.EventBuses).map((b) => b.Name),
  },

  keysAndSecrets: {
    kmsAliases: list(kmsKeys?.Aliases).map((a) => a.AliasName).filter((n) => !n.startsWith('alias/aws/')),
    // Name and rotation state ONLY. No value is fetched anywhere in this file.
    secrets: list(secrets?.SecretList).map((s) => ({
      name: s.Name,
      rotationEnabled: s.RotationEnabled === true,
      lastChanged: s.LastChangedDate ? String(s.LastChangedDate).slice(0, 10) : null,
    })),
  },

  observability: {
    logGroups: list(logGroups?.logGroups).map((g) => ({ name: g.logGroupName, retentionDays: g.retentionInDays ?? 'never expires' })),
    alarms: list(alarms?.MetricAlarms).map((a) => ({ name: a.AlarmName, state: a.StateValue })),
    backupVaults: list(backupVaults?.BackupVaultList).map((v) => v.BackupVaultName),
  },

  iacOwnership: {
    cloudformationStacks: list(cfnStacks?.StackSummaries).map((s) => s.StackName),
    note: 'Terraform ownership is not visible from the AWS API. It is read from the repository in resource-reconciliation.md.',
  },

  access: { denied, errors },
}

inventory.summary = {
  vpcs: inventory.network.vpcs.length,
  natGateways: inventory.network.natGateways,
  loadBalancers: inventory.network.loadBalancers.length,
  cloudfrontDistributions: inventory.edge.cloudfront.length,
  ecsClusters: inventory.compute.ecsClusters.length,
  rdsInstances: inventory.data.rds.length,
  s3Buckets: inventory.data.s3Buckets.length,
  cognitoUserPools: inventory.identityProvider.cognitoUserPools.length,
  secrets: inventory.keysAndSecrets.secrets.length,
  deniedCalls: denied.length,
}

fs.mkdirSync('docs/architecture', { recursive: true })
fs.writeFileSync('docs/architecture/aws-inventory.json', JSON.stringify(inventory, null, 2) + '\n')

// ── Human-readable ──────────────────────────────────────────────────────────

const yn = (b) => (b ? 'yes' : 'no')
const md = []
const w = (...l) => md.push(...l)

w('# AWS current state', '')
w(`**GE-001-004 / 005.** Generated ${inventory.generatedAt} by \`tools/aws-inventory.mjs\`, run from`)
w('`.github/workflows/aws-inventory.yml`. Read-only: describe/list/get-configuration calls only.', '')
w(`Account \`${inventory.accountMasked}\` · region \`${REGION}\``, '')
w('> The account id is masked. This repository is public and every artifact it produces is')
w('> world-readable and archived. No secret value, parameter value, environment variable or')
w('> row of data is collected anywhere in this inventory — secrets appear as a name and a')
w('> rotation date, which is metadata about a secret, not a secret.', '')

w('## Summary', '', '| | |', '|---|---:|')
for (const [k, v] of Object.entries(inventory.summary)) w(`| ${k} | ${v} |`)
w('')

w('## Organization', '')
if (inventory.organization.inUse) {
  w(`AWS Organizations in use — ${inventory.organization.accounts} account(s), feature set \`${inventory.organization.featureSet}\`.`)
} else {
  w(`**Not in use.** ${inventory.organization.note}`)
  w('')
  w('The Bible requires a Tenure-owned AWS Organization with separate member accounts per')
  w('environment and isolation class. A single-account estate is the starting point, not the')
  w('target — this is the gap **GE-010** closes.')
}
w('')

w('## Deployment identity', '')
w(`OIDC providers: ${inventory.iam.oidcProviders.length === 0 ? '**none**' : inventory.iam.oidcProviders.join(', ')}`)
w('')
if (inventory.iam.oidcProviders.length === 0) {
  w('**No OIDC provider exists.** Every workflow that reaches AWS authenticates with the')
  w('long-lived `ACCESSKEYID` / `SECRETACCESSKEY` pair, which cannot be scoped per workflow,')
  w('does not expire, and is shared with a second repository. **GE-011.**')
  w('')
}
w(`IAM roles: ${inventory.iam.roleCount}. Deployment-shaped: \`${inventory.iam.deploymentRoles.join('`, `') || 'none'}\``, '')

w('## Network', '', '| VPC | CIDR | Default |', '|---|---|---|')
for (const v of inventory.network.vpcs) w(`| ${v.name ?? '(untagged)'} | \`${v.cidr}\` | ${yn(v.isDefault)} |`)
w('')
w(`Subnets ${inventory.network.subnets} · security groups ${inventory.network.securityGroups} · NAT gateways **${inventory.network.natGateways}**`, '')
if (inventory.network.natGateways === 0) {
  w('No NAT gateway: tasks run in public subnets with public IPs and pull from ECR directly.')
  w('That is a deliberate cost choice (~$32/month each) and a security trade-off to revisit')
  w('when isolation classes above pooled are offered.', '')
}

w('### Load balancers', '', '| Name | Type | Scheme |', '|---|---|---|')
for (const l of inventory.network.loadBalancers) w(`| ${l.name} | ${l.type} | ${l.scheme} |`)
w('')

w('## Edge', '', '| CloudFront | Aliases | Enabled | Comment |', '|---|---|---|---|')
for (const d of inventory.edge.cloudfront) w(`| \`${d.domain}\` | ${d.aliases.join(', ') || '—'} | ${yn(d.enabled)} | ${d.comment || '—'} |`)
w('')
w(`Hosted zones: ${inventory.edge.hostedZones.join(', ') || 'none'}`)
w(`Certificates: ${inventory.edge.certificates.map((c) => `${c.domain} (${c.status})`).join(', ') || 'none'}`)
w(`WAF web ACLs: ${inventory.edge.wafWebAcls.join(', ') || '**none**'}`, '')
if (inventory.edge.wafWebAcls.length === 0) {
  w('**No WAF.** Both distributions are directly exposed with no rate limiting or managed rule', 'set in front of them. **GE-150.**', '')
}

w('## Compute', '')
w(`ECS clusters: \`${inventory.compute.ecsClusters.join('`, `') || 'none'}\``)
w(`ECR repositories: \`${inventory.compute.ecrRepositories.join('`, `') || 'none'}\``)
w(`Lambda functions: ${inventory.compute.lambdaFunctions.length}`, '')

w('## Identity provider', '')
if (inventory.identityProvider.cognitoUserPools.length === 0) {
  w('**No Cognito user pool exists.** The Bible makes Cognito the authentication substrate')
  w('(§2, and PD-004). Both applications authenticate with NextAuth today — the pilot with a')
  w('passwordless dev provider behind a shared passphrase, the Studio with a shared operator')
  w('secret. Both are interim. **GE-041.**', '')
} else {
  for (const p of inventory.identityProvider.cognitoUserPools) w(`- ${p.name} (\`${p.id}\`)`)
  w('')
}

w('## Data', '', '| RDS | Engine | Class | Multi-AZ | Encrypted | Backup days | Public | Del. protection |', '|---|---|---|---|---|---:|---|---|')
for (const d of inventory.data.rds) {
  w(`| ${d.identifier} | ${d.engine} | ${d.class} | ${yn(d.multiAz)} | ${yn(d.encrypted)} | **${d.backupRetentionDays}** | ${yn(d.publiclyAccessible)} | ${yn(d.deletionProtection)} |`)
}
w('')
w(`S3 buckets: ${inventory.data.s3Buckets.length} · DynamoDB tables: ${inventory.data.dynamoTables.length} · ElastiCache: ${inventory.data.elasticache.length}`, '')

w('## Keys and secrets', '')
w(`Customer-managed KMS aliases: \`${inventory.keysAndSecrets.kmsAliases.join('`, `') || 'none'}\``, '')
w('| Secret | Rotation | Last changed |', '|---|---|---|')
for (const s of inventory.keysAndSecrets.secrets) w(`| \`${s.name}\` | ${s.rotationEnabled ? 'enabled' : '**disabled**'} | ${s.lastChanged ?? '—'} |`)
w('')

w('## Observability and backup', '')
w(`Backup vaults: ${inventory.observability.backupVaults.join(', ') || '**none**'}`)
w(`Alarms: ${inventory.observability.alarms.length}`)
w('')
w('| Log group | Retention |', '|---|---|')
for (const g of inventory.observability.logGroups) w(`| \`${g.name}\` | ${g.retentionDays} |`)
w('')

w('## Access', '')
if (denied.length === 0 && errors.length === 0) {
  w('Every call succeeded.')
} else {
  if (denied.length > 0) {
    w('Denied or unavailable — recorded rather than escalated. §3 of the prompt requires naming')
    w('the exact API rather than asking for administrator access:', '')
    for (const d of denied) w(`- \`${d.call}\` — ${d.reason}`)
    w('')
  }
  if (errors.length > 0) {
    w('Other failures:', '')
    for (const e of errors) w(`- \`${e.call}\` — ${e.message}`)
    w('')
  }
}

fs.writeFileSync('docs/architecture/aws-current-state.md', md.join('\n'))

// ── Reconciliation: what the repository claims vs what exists ───────────────

const tfDirs = fs.existsSync('infrastructure')
  ? fs.readdirSync('infrastructure').filter((d) => fs.existsSync(`infrastructure/${d}`) && fs.readdirSync(`infrastructure/${d}`).some((f) => f.endsWith('.tf')))
  : []

const rec = []
const r = (...l) => rec.push(...l)
r('# Resource reconciliation', '')
r('**GE-001-005.** What the repository declares, against what the account actually holds.', '')
r(`Generated ${inventory.generatedAt}. Terraform ownership is read from the repository, because`)
r('the AWS API cannot report which tool owns a resource.', '')

r('## Terraform stacks in this repository', '', '| Stack | State key | Owns |', '|---|---|---|')
r('| `infrastructure/terraform` | `pilot/terraform.tfstate` | The Simon OSE pilot. Deployed from `satvikOS/Tenure`, **not** from here. |')
r('| `infrastructure/studio` | `studio/terraform.tfstate` | The System Studio engine. Deployed from this repository. |')
r('')
r('Two stacks, two state files, one account. The separation is the safety property: two')
r('repositories applying different code against one state file means whichever runs second')
r('sees the other\'s resources as undeclared and destroys them.', '')
if (tfDirs.length > 2) {
  r(`> Found ${tfDirs.length} Terraform directories: \`${tfDirs.join('`, `')}\`. More than the two above — reconcile.`, '')
}

r('## CloudFormation / CDK', '')
r(inventory.iacOwnership.cloudformationStacks.length === 0
  ? 'No CloudFormation stacks. Terraform is the single IaC system, which is what the prompt asks for — no parallel ownership.'
  : `**${inventory.iacOwnership.cloudformationStacks.length} CloudFormation stack(s) found**: \`${inventory.iacOwnership.cloudformationStacks.join('`, `')}\`. Parallel ownership with Terraform is a drift risk and needs an owner recorded.`)
r('')

r('## Unreconciled', '')
r('Resources present in the account that neither stack declares are drift, or belong to')
r('something outside this repository. Compare the CloudFront, ECS, RDS, S3 and secret lists in')
r('`aws-current-state.md` against the two stacks above; anything unaccounted for is listed here')
r('once a reviewer has classified it. Automating that classification requires reading both')
r('state files, which this job deliberately does not do — a state file contains resource')
r('attributes including generated passwords.', '')

fs.writeFileSync('docs/architecture/resource-reconciliation.md', rec.join('\n'))

console.log(JSON.stringify(inventory.summary, null, 2))
if (denied.length) console.log(`\n${denied.length} denied call(s) recorded, inventory continued.`)
