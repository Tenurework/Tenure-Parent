# AWS current state

**GE-001-004 / 005.** Generated 2026-07-31T23:40:04.289Z by `tools/aws-inventory.mjs`, run from
`.github/workflows/aws-inventory.yml`. Read-only: describe/list/get-configuration calls only.

Account `1549…97` · region `us-east-1`

> The account id is masked. This repository is public and every artifact it produces is
> world-readable and archived. No secret value, parameter value, environment variable or
> row of data is collected anywhere in this inventory — secrets appear as a name and a
> rotation date, which is metadata about a secret, not a secret.

## Summary

| | |
|---|---:|
| vpcs | 2 |
| natGateways | 0 |
| loadBalancers | 2 |
| cloudfrontDistributions | 2 |
| ecsClusters | 2 |
| rdsInstances | 1 |
| s3Buckets | 3 |
| cognitoUserPools | 0 |
| secrets | 6 |
| deniedCalls | 3 |

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

IAM roles: 14. Deployment-shaped: `AWSServiceRoleForECS`, `tenure-pilot-ecs-execution`, `tenure-pilot-ecs-task`, `tenure-studio-ecs-execution`, `tenure-studio-ecs-task`

## Network

| VPC | CIDR | Default |
|---|---|---|
| (untagged) | `172.31.0.0/16` | yes |
| tenure-pilot-vpc | `10.0.0.0/16` | no |

Subnets 10 · security groups 8 · NAT gateways **0**

No NAT gateway: tasks run in public subnets with public IPs and pull from ECR directly.
That is a deliberate cost choice (~$32/month each) and a security trade-off to revisit
when isolation classes above pooled are offered.

### Load balancers

| Name | Type | Scheme |
|---|---|---|
| tenure-pilot-alb | application | internet-facing |
| tenure-studio-alb | application | internet-facing |

## Edge

| CloudFront | Aliases | Enabled | Comment |
|---|---|---|---|
| `d1n6mdis7bs02g.cloudfront.net` | platform.tenurework.com | yes | Tenure pilot — Next.js via ECS Fargate |
| `d2kj4iy5i37kfd.cloudfront.net` | — | yes | Tenure System Studio — internal platform engine |

Hosted zones: none
Certificates: app.tenurework.com (FAILED), app.tenurework.com (FAILED), app.tenurework.com (FAILED), platform.tenurework.com (ISSUED)
WAF web ACLs: **none**

**No WAF.** Both distributions are directly exposed with no rate limiting or managed rule
set in front of them. **GE-150.**

## Compute

ECS clusters: `tenure-studio`, `tenure-pilot`
ECR repositories: `tenure-pilot-app`, `tenure-studio`
Lambda functions: 0

## Identity provider

**No Cognito user pool exists.** The Bible makes Cognito the authentication substrate
(§2, and PD-004). Both applications authenticate with NextAuth today — the pilot with a
passwordless dev provider behind a shared passphrase, the Studio with a shared operator
secret. Both are interim. **GE-041.**

## Data

| RDS | Engine | Class | Multi-AZ | Encrypted | Backup days | Public | Del. protection |
|---|---|---|---|---|---:|---|---|
| tenure-pilot-db | postgres 16.3 | db.t3.micro | no | yes | **1** | no | yes |

S3 buckets: 3 · DynamoDB tables: 1 · ElastiCache: 1

## Keys and secrets

Customer-managed KMS aliases: `none`

| Secret | Rotation | Last changed |
|---|---|---|
| `tenure-pilot/app` | **disabled** | 2026-07-12 |
| `rds!db-ce7fc7cf-399d-451d-9de8-a669132dd0b3` | enabled | 2026-07-31 |
| `tenure-pilot/job` | **disabled** | 2026-07-18 |
| `events!connection/tenure-pilot-job/76407ff7-57c7-4268-bec2-4346d3d35591` | **disabled** | 2026-07-18 |
| `tenure-pilot/dev-login` | **disabled** | 2026-07-30 |
| `tenure-studio/app` | **disabled** | 2026-07-31 |

## Observability and backup

Backup vaults: **none**
Alarms: 4

| Log group | Retention |
|---|---|
| `/aws/ecs/containerinsights/tenure-pilot/performance` | 1 |
| `/ecs/tenure-pilot` | 30 |
| `/ecs/tenure-studio` | 30 |

## Access

Denied or unavailable — recorded rather than escalated. §3 of the prompt requires naming
the exact API rather than asking for administrator access:

- `organizations describe-organization` — Organizations not in use
- `organizations list-accounts` — Organizations not in use
- `organizations list-roots` — Organizations not in use
