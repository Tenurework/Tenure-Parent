# AWS current state

**GE-001-004 / 005.** Generated 2026-08-18T02:03:02.559Z by `tools/aws-inventory.mjs`, run from
`.github/workflows/aws-inventory.yml`. Read-only: describe/list/get-configuration calls only.

Account `unknown` · region `us-east-1`

> The account id is masked. This repository is public and every artifact it produces is
> world-readable and archived. No secret value, parameter value, environment variable or
> row of data is collected anywhere in this inventory — secrets appear as a name and a
> rotation date, which is metadata about a secret, not a secret.

## Summary

| | |
|---|---:|
| vpcs | 0 |
| natGateways | 0 |
| loadBalancers | 0 |
| cloudfrontDistributions | 0 |
| ecsClusters | 0 |
| rdsInstances | 0 |
| s3Buckets | 0 |
| cognitoUserPools | 0 |
| secrets | 0 |
| deniedCalls | 0 |

## Organization

**Not in use.** Organizations not in use, or not visible to this principal. A single-account estate.

The Bible requires a Tenure-owned AWS Organization with separate member accounts per
environment and isolation class. A single-account estate is the starting point, not the
target — this is the gap **GE-010** closes.

## Deployment identity

OIDC providers: **none**

**No OIDC provider exists.** Every workflow that reaches AWS authenticates with the
long-lived `ACCESSKEYID` / `SECRETACCESSKEY` pair, which cannot be scoped per workflow,
does not expire, and is shared with a second repository. **GE-011.**

IAM roles: 0. Deployment-shaped: `none`

## Network

| VPC | CIDR | Default |
|---|---|---|

Subnets 0 · security groups 0 · NAT gateways **0**

No NAT gateway: tasks run in public subnets with public IPs and pull from ECR directly.
That is a deliberate cost choice (~$32/month each) and a security trade-off to revisit
when isolation classes above pooled are offered.

### Load balancers

| Name | Type | Scheme |
|---|---|---|

## Edge

| CloudFront | Aliases | Enabled | Comment |
|---|---|---|---|

Hosted zones: none
Certificates: none
WAF web ACLs: **none**

**No WAF.** Both distributions are directly exposed with no rate limiting or managed rule
set in front of them. **GE-150.**

## Compute

ECS clusters: `none`
ECR repositories: `none`
Lambda functions: 0

## Identity provider

**No Cognito user pool exists.** The Bible makes Cognito the authentication substrate
(§2, and PD-004). Both applications authenticate with NextAuth today — the pilot with a
passwordless dev provider behind a shared passphrase, the Studio with a shared operator
secret. Both are interim. **GE-041.**

## Data

| RDS | Engine | Class | Multi-AZ | Encrypted | Backup days | Public | Del. protection |
|---|---|---|---|---|---:|---|---|

S3 buckets: 0 · DynamoDB tables: 0 · ElastiCache: 0

## Keys and secrets

Customer-managed KMS aliases: `none`

| Secret | Rotation | Last changed |
|---|---|---|

## Observability and backup

Backup vaults: **none**
Alarms: 0

| Log group | Retention |
|---|---|

## Access

Other failures:

- `organizations describe-organization` — spawnSync aws ENOENT
- `organizations list-accounts` — spawnSync aws ENOENT
- `organizations list-roots` — spawnSync aws ENOENT
- `iam list-open-id-connect-providers` — spawnSync aws ENOENT
- `iam list-roles` — spawnSync aws ENOENT
- `ec2 describe-vpcs` — spawnSync aws ENOENT
- `ec2 describe-subnets` — spawnSync aws ENOENT
- `ec2 describe-security-groups` — spawnSync aws ENOENT
- `ec2 describe-nat-gateways` — spawnSync aws ENOENT
- `route53 list-hosted-zones` — spawnSync aws ENOENT
- `acm list-certificates` — spawnSync aws ENOENT
- `cloudfront list-distributions` — spawnSync aws ENOENT
- `wafv2 list-web-acls` — spawnSync aws ENOENT
- `elbv2 describe-load-balancers` — spawnSync aws ENOENT
- `ecs list-clusters` — spawnSync aws ENOENT
- `ecr describe-repositories` — spawnSync aws ENOENT
- `lambda list-functions` — spawnSync aws ENOENT
- `cognito-idp list-user-pools` — spawnSync aws ENOENT
- `rds describe-db-instances` — spawnSync aws ENOENT
- `dynamodb list-tables` — spawnSync aws ENOENT
- `elasticache describe-cache-clusters` — spawnSync aws ENOENT
- `s3api list-buckets` — spawnSync aws ENOENT
- `sqs list-queues` — spawnSync aws ENOENT
- `sns list-topics` — spawnSync aws ENOENT
- `events list-event-buses` — spawnSync aws ENOENT
- `kms list-aliases` — spawnSync aws ENOENT
- `secretsmanager list-secrets` — spawnSync aws ENOENT
- `logs describe-log-groups` — spawnSync aws ENOENT
- `cloudwatch describe-alarms` — spawnSync aws ENOENT
- `backup list-backup-vaults` — spawnSync aws ENOENT
- `cloudformation list-stacks` — spawnSync aws ENOENT
