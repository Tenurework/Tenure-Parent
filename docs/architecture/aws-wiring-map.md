# AWS wiring map

Serves **STUDIO-000-002** (map every infrastructure stack relevant to System Studio) and
**STUDIO-000-008** (a resource graph carrying owner, stack and dependencies). Both are satisfiable
by prose, and prose is what was there; this is the half that can refuse.

**What this document is.** Every AWS service the Tenure estate provisions, the Terraform that
provisions it, the capability that is allowed to read it, the module that exposes the read, and
the surface that renders it to an operator.

**Why it can be trusted.** It is not prose about the system; it is the same table
`tests/architecture/every-provisioned-service-has-a-reader.test.mjs` asserts against, checked cell
for cell on every CI run. Editing a row here without changing the estate turns the build red, and
so does adding a `resource "aws_*"` to `infrastructure/` that no row classifies. The document
cannot drift from the check, because the check reads the document.

**The defect it exists against.** In the operator's words: *"Wiring of AWS to Tenure global system
is not at all fully completed (this is critical)."* That was true, it was invisible, and it was
found only by counting SDK clients by hand against the Terraform. A provisioned service that
nothing reads fails no test and raises no alarm — it renders as an absence, and an absence reads
exactly like a clean estate. This map makes the count automatic and the gap a build failure.

---

## The estate, counted

| Measure | Count | Source |
| --- | --- | --- |
| Terraform files scanned | 35 | `infrastructure/**/*.tf` |
| Distinct `aws_*` resource types declared | 57 | parsed from the same files |
| AWS services those resource types belong to | 18 | the classification table below |
| Services named by at least one capability | 18 | `apps/system-studio/src/lib/aws/capabilities.ts` |
| Services with a reader module | 18 | `apps/system-studio/src/lib/aws/` |
| Services rendered by a surface today | 15 | routes under `apps/system-studio/src/app/` |
| Services provisioned but rendered nowhere | 3 | the ratchet below — may only fall |

The gap is three, it is named, and it can only get smaller.

---

## Service by service

Read the columns as a chain: **Terraform provisions it → a capability is allowed to read it → a
reader module performs the read → a surface renders the answer.** A break anywhere in that chain
is a service the operator cannot see, whatever the AWS console would show.

The **capability** column gives the IAM service prefix. The individual capability keys — 114 of
them across 38 prefixes — live in `apps/system-studio/src/lib/aws/capabilities.ts`, which is the
only place they are declared; they are deliberately not copied here, because a copied list is a
list that goes stale silently.

| Service | Name | Terraform resource types | Capability | Reader module | Surface |
| --- | --- | --- | --- | --- | --- |
| acm | Certificate Manager | aws_acm_certificate | acm:* | certificates.ts | — awaiting a surface |
| cloudfront | CloudFront | aws_cloudfront_distribution, aws_cloudfront_function | cloudfront:* | cdn.ts | — awaiting a surface |
| cloudwatch | CloudWatch (alarms, metrics, dashboards) | aws_cloudwatch_dashboard, aws_cloudwatch_metric_alarm | cloudwatch:* | alarms.ts, metrics.ts, dashboards.ts | app/platform/health, app/platform/messaging |
| events | EventBridge | aws_cloudwatch_event_api_destination, aws_cloudwatch_event_connection, aws_cloudwatch_event_rule, aws_cloudwatch_event_target | events:* | eventbridge.ts | app/platform/messaging |
| logs | CloudWatch Logs | aws_cloudwatch_log_group | logs:* | logs.ts | — awaiting a surface |
| cognito-idp | Cognito user pools | aws_cognito_user, aws_cognito_user_pool, aws_cognito_user_pool_client, aws_cognito_user_pool_domain | cognito-idp:* | cognito.ts | app/platform/identity |
| rds | RDS | aws_db_instance, aws_db_parameter_group, aws_db_subnet_group | rds:* | database.ts | app/platform/data |
| dynamodb | DynamoDB | aws_dynamodb_table | dynamodb:* | dynamodb-tables.ts | app/platform/data, app/platform/audit |
| ecr | ECR | aws_ecr_lifecycle_policy, aws_ecr_repository | ecr:* | ecr.ts | app/platform/compute |
| ecs | ECS | aws_ecs_cluster, aws_ecs_cluster_capacity_providers, aws_ecs_service, aws_ecs_task_definition | ecs:* | containers.ts | app/platform/compute |
| elasticache | ElastiCache | aws_elasticache_cluster, aws_elasticache_parameter_group, aws_elasticache_subnet_group | elasticache:* | elasticache.ts | app/platform/data |
| iam | IAM | aws_iam_openid_connect_provider, aws_iam_policy, aws_iam_role, aws_iam_role_policy, aws_iam_role_policy_attachment | iam:* | iam.ts | app/platform/identity, app/platform/security |
| ec2 | EC2 / VPC | aws_internet_gateway, aws_route_table, aws_route_table_association, aws_security_group, aws_subnet, aws_vpc, aws_vpc_security_group_egress_rule, aws_vpc_security_group_ingress_rule | ec2:* | network.ts | app/platform/network |
| elasticloadbalancing | Elastic Load Balancing v2 | aws_lb, aws_lb_listener, aws_lb_target_group | elasticloadbalancing:* | loadbalancer.ts | app/platform/network |
| s3 | S3 | aws_s3_bucket, aws_s3_bucket_cors_configuration, aws_s3_bucket_lifecycle_configuration, aws_s3_bucket_public_access_block, aws_s3_bucket_server_side_encryption_configuration, aws_s3_bucket_versioning | s3:* | buckets.ts | app/platform/data |
| secretsmanager | Secrets Manager | aws_secretsmanager_secret, aws_secretsmanager_secret_version | secretsmanager:* | secrets.ts | app/platform/identity |
| ses | SES | aws_ses_configuration_set, aws_ses_domain_dkim, aws_ses_domain_identity, aws_ses_email_identity, aws_sesv2_account_suppression_attributes | ses:* | ses.ts | app/platform/messaging |
| sqs | SQS | aws_sqs_queue | sqs:* | sqs.ts | app/platform/messaging |

---

## Why the classification is a committed table and not a regex

Three rows above are the entire argument.

`aws_cloudwatch_event_rule`, `aws_cloudwatch_event_connection`, `aws_cloudwatch_event_target` and
`aws_cloudwatch_event_api_destination` are **EventBridge**. Terraform still carries the
`aws_cloudwatch_` prefix from before the service was renamed; IAM has called the actions `events:*`
ever since. `aws_cloudwatch_log_group` is **CloudWatch Logs**, whose actions are `logs:*`. Only
`aws_cloudwatch_dashboard` and `aws_cloudwatch_metric_alarm` are actually `cloudwatch:*`.

A regex that took the token after `aws_` would map all seven to `cloudwatch`, find a capability,
find `alarms.ts`, find the health surface, and report **GREEN over two services nothing reads** —
a guard that cannot fail, which is the failure this repository has shipped five times. So every
mapping is written down, and every mapping is a decision somebody can argue with.

The same trap sits in three other rows. `aws_lb*` is `elasticloadbalancing:*`, not `lb:*`.
`aws_db_*` is `rds:*`, not `db:*`. Every VPC, subnet, route table, gateway and security-group
resource is `ec2:*`, whatever its Terraform name says. `aws_sesv2_account_suppression_attributes`
is still `ses:*`; the v2 API did not get a new IAM prefix.

---

## The three services awaiting a surface

Each of these has a reader module that works and a capability that permits the read. What is
missing is a route that calls it, so the answer reaches nobody. The list **may only get shorter**:
`AWAITING_A_SURFACE_CEILING` is asserted as an equality, so wiring one of these up turns the build
red until the entry is deleted and the ceiling lowered in the same commit. That red is the
notification that the gap closed.

- **acm** — `certificates.ts` reads certificate expiry, validation records and renewal state. No
  route imports it. Certificate expiry currently reaches the operator only through the
  load-balancer listener view, which shows the ARN and not the clock, so a certificate 10 days from
  expiry looks identical to one 300 days from expiry.
- **cloudfront** — `cdn.ts` reads distribution configuration and invalidation backlog: origin
  protocol, TLS floor, WAF association, geo restriction, access logging. Nothing renders it, so a
  distribution serving over HTTP to its origin, or with no WAF attached, is invisible to the
  console.
- **logs** — `logs.ts` reads log-group retention, encryption and metric filters. Nothing renders
  it, so a log group provisioned with no retention — unbounded storage and unbounded spend — shows
  up nowhere in the estate view.

Nothing else in the estate is dark. There is **no** service in the table with no reader at all;
that count is asserted as `0` rather than as a ceiling, because there is no defensible reason to
provision a service the control plane cannot read.

---

## Readers that exist beyond the provisioned estate

`apps/system-studio/src/lib/aws/` also holds readers for services the Terraform under
`infrastructure/` does not provision, and this map does not list them as rows: account-level and
organisation-level reads (`identity.ts`, `organization.ts`, `posture.ts`, `trail.ts`,
`compliance.ts`, `findings.ts`, `guardduty.ts`, `analyzer.ts`), cost and quota reads
(`budgets.ts`, `pricing.ts`, `quotas.ts`), the service-health feed (`aws-health.ts`), the tag index
(`tags.ts`, `inventory.ts`), and the derived views built on top of them (`topology.ts`,
`drift.ts`, `health.ts`, `retained.ts`).

Those are reads of things AWS provides rather than things Terraform creates, so "which resource
block provisions it" has no answer and a row here would have to invent one. They are governed by
the capability catalogue and by `AwsRead<T>` like every other read; they are simply out of scope
for a map whose question is *"is everything we provision also something we can see?"*

---

## How to add a service

1. Write the Terraform. The moment a new `resource "aws_*"` type lands under `infrastructure/`,
   `every-provisioned-service-has-a-reader.test.mjs` reds with the resource type and the file that
   declares it.
2. Add the capability to `apps/system-studio/src/lib/aws/capabilities.ts` — the exact IAM actions,
   the resource ARN pattern, the refresh cadence, the surface it feeds.
3. Write the reader under `apps/system-studio/src/lib/aws/`. Readers are the only path to the SDK;
   a surface that constructs an AWS client is caught by a different guard. A denied read must
   render UNKNOWN with the principal, the action and a pasteable minimum IAM statement — never an
   empty list, a zero or a default.
4. Render it on a route under `apps/system-studio/src/app/`.
5. Add the row to the table in the test, and the identical row here.

Skipping step 4 is permitted only by adding the service to `AWAITING_A_SURFACE` with a written
reason — and the ceiling refuses to be raised, so that costs a conversation rather than a commit.

---

## Enforcement

| Check | Assertion |
| --- | --- |
| Classification is complete | Every `aws_*` type in `infrastructure/**/*.tf` is classified, and every classified type still exists |
| No type has two owners | A resource type appears in exactly one service record |
| Capability coverage | Every service in the table is named by at least one capability key |
| Reader exists | Every reader module named in the table is a real file under `src/lib/aws/` |
| Surface renders it | At least one non-test file under the named route imports the reader |
| Ratchet holds | The awaiting-a-surface list is `<=` its ceiling, and equal to it — no slack |
| Reasons are written | Every allowlist entry carries a reason, not just a name |
| This document matches | Every row above is compared cell for cell against the table in the test |

Test: `tests/architecture/every-provisioned-service-has-a-reader.test.mjs`.
Runner: `npm run test:platform` (`tools/run-platform-tests.mjs` discovers it).
Gate: `.github/workflows/ci.yml`, which runs `npm run test:platform` on every push.

The test opens no socket and needs no AWS credentials. It compares three committed artefacts — the
Terraform, the capability catalogue and the reader modules — against one another, which is why it
is a build gate rather than a monitoring job.
