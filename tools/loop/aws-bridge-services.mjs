export const meta = {
  name: 'aws-bridge-services',
  description:
    'One agent per dark AWS service: read it honestly, type it so a caller cannot ignore what it does not know, and have an independent refuter re-run the mutation',
  whenToUse:
    'After aws-bridge-ground has landed the capability registry and the IAM grant. Each agent owns exactly one module and its test.',
  phases: [
    { title: 'Wire', detail: 'one reader module per service, disjoint files' },
    { title: 'Refute', detail: 'independent refuters that re-run every mutation themselves' },
  ],
}

const RULES = `
You are building the Tenure platform in C:/Users/satvi/Tenure-Parent, on branch
"studio-program" (NOT main). The working tree is shared with up to 50 other agents right
now: touch ONLY the files named as yours below.

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, git checkout or rewrite history.
  The orchestrator does that. Do not run \`git add -A\`.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or money movement.
- Never treat an AI, agent, operator or test result as human approval.
- READ-ONLY AWS. You are wiring reads. Do not add a capability, client command or code
  path that creates, updates, deletes, attaches, detaches, puts, sends or invokes.
  The reversible-mutation set in src/lib/aws/mutate.ts is the ONLY place mutations live
  and you are not extending it.

THE FIVE THINGS THAT SHIPPED BROKEN HERE. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`,
   \`if (false && !isPaymentMode(...))\`, \`|| true\` making a loop skip every key, a
   \`// MUTATION\` stub shipped in production, and \`false && CREDENTIAL.test(write)\` making a
   credential sweep return empty for every file. Each read GREEN. If you disable a check to
   iterate, restore it before you report, and say in your result that you did.

2. A FABRICATED APPROVAL. An agent set a provider review to APPROVED with invented
   verification dates. Never write an approval, review, certification or sign-off a human
   did not give. Never invent an AWS account id, ARN, region or resource name: if a test
   needs one, construct it obviously (123456789012) and say so.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. An OPTIONAL field a caller omits is
   invisible to \`tsc\`. Grep every construction site of any type you change and NAME them.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Sorting native paths, unsorted
   \`readdirSync\`, hashing raw CRLF bytes. Anything you generate must be byte-identical on
   Linux and Windows. Do NOT run \`npm run generate\` — the orchestrator runs it once at the
   end against a clean tree. Do NOT run \`npm install\` — the rails agent already did.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. Name the caller in your result.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm it passes. Report each mutation and both results verbatim.
- A stand-in that returns a canned value regardless of the code under test proves nothing.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact commands that would unblock it, is
  worth more than a false PASS.

HOUSE FACTS you will otherwise rediscover the expensive way:
- apps/system-studio must NOT import a Prisma client — \`tests/security/operator-plane-content.test.mjs\`
  asserts it. The Studio reads AWS and DynamoDB, never the tenant database.
- STUDIO-000-007 is enforced by a TYPE: \`AwsRead<T>\` in src/lib/aws/read.ts has NO arm
  carrying an optional \`T\`, so reaching \`.value\` on a DENIED result does not compile.
- \`call()\` in client.ts switches on the capability DELIBERATELY: there must remain no way
  to express "send this arbitrary command".
- Region and partition resolve from the resolved identity, NEVER a literal. A hardcoded
  us-east-1 caused GE-010-007, a data-residency defect.
- New audit writes go through \`recordAuditEvent\`; every ratchet may only FALL.
- Verify your own file compiles: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`.
  Errors in OTHER agents' files are expected mid-flight — report only yours.
- Run your own unit test with: \`npx jest --config apps/system-studio/jest.config.* <file>\`
  if a studio jest config exists; otherwise report how you ran it. Do not invent a runner.
`

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'summary', 'mutation_proof'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NOT_APPLICABLE'] },
          summary: { type: 'string' },
          mutation_proof: { type: 'string' },
          caller: { type: 'string' },
          blocked_reason: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    capabilities_used: { type: 'array', items: { type: 'string' } },
    exports: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'refuted', 'reason'],
        properties: {
          id: { type: 'string' },
          refuted: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
    tree_left_clean: { type: 'boolean' },
  },
}

const LEDGER = 'docs/implementation/system-studio-aws-control-plane-execution-ledger.md'

/**
 * The dark services, one agent each.
 *
 * `what` is deliberately about the OPERATIONAL QUESTION the read answers rather than
 * the API shape — an agent given "list the queues" builds a table, and an agent given
 * "a dead-letter queue with anything in it is a delivery that failed and nobody was
 * told" builds a state. The second is the console the operator asked for.
 */
const SERVICES = [
  {
    key: 'cognito',
    module: 'apps/system-studio/src/lib/aws/cognito.ts',
    what: `Cognito — the user pool that gates THIS CONSOLE, its clients, its domain, its MFA
configuration and password policy, and the operator accounts in it with their status
(CONFIRMED / FORCE_CHANGE_PASSWORD / RESET_REQUIRED), their MFA enrolment, and when each
last signed in. This is the highest-value dark service in the estate: on 2026-08-13 an audit
found the Cognito migration had reissued the shared secret as a PERMANENT password with
message_action SUPPRESS and MFA OPTIONAL, and nothing in the console could see it. Surface
the facts that would have made that visible — MFA configuration at the pool level, every
account still in FORCE_CHANGE_PASSWORD, and the age of the temporary-password window. Never
read, print or return a password, a secret, a token or a client secret. \`ListUsers\` returns
attributes: return the operator's status and MFA state, and do NOT return raw attribute
values beyond the sign-in identifier.`,
  },
  {
    key: 'network',
    module: 'apps/system-studio/src/lib/aws/network.ts',
    what: `The VPC network — VPCs, subnets (and which are public by virtue of a route to an
internet gateway), route tables, NAT and internet gateways, VPC endpoints, network ACLs,
and every security group with its ingress and egress rules. The operational question is
"what can reach this estate from the internet": a security group with 0.0.0.0/0 (or ::/0)
ingress on anything other than 80/443 is the finding, and it is invisible today. Compute
public-vs-private from the ROUTE TABLE, not from the subnet's name — a subnet called
"private" with a 0.0.0.0/0 route to an IGW is exactly the defect worth catching. Report
unused security groups too: an SG attached to nothing is drift, not a risk.`,
  },
  {
    key: 'loadbalancer',
    module: 'apps/system-studio/src/lib/aws/loadbalancer.ts',
    what: `The load balancers — every ALB/NLB, its scheme, its listeners and their protocols
and certificates, its target groups, and DescribeTargetHealth for each. Target health is THE
liveness signal for the ECS services this estate runs: a service can be "RUNNING" in ECS
while every target is draining or unhealthy, and today nobody can see that. An unhealthy
target must carry its reason code and description, because "Target.ResponseCodeMismatch" and
"Target.Timeout" send an operator to completely different places. A listener on HTTP with no
redirect to HTTPS is a finding. Report the certificate ARN on each HTTPS listener so the
certificates reader can correlate an expiry to a live listener.`,
  },
  {
    key: 'ecr',
    module: 'apps/system-studio/src/lib/aws/ecr.ts',
    what: `ECR — the repositories, their image-scanning configuration and tag mutability, the
images in each with their tags, pushed-at and size, and the image scan findings by severity.
The operational question is "what is actually deployed and is it known-vulnerable": correlate
by IMAGE DIGEST, not by tag, because a mutable tag is exactly how a digest and a tag stop
agreeing. A repository with scanOnPush disabled is a finding in its own right — it means the
absence of findings proves nothing, and the surface must say that rather than showing a
reassuring zero. Also report whether a lifecycle policy exists and what it expires.`,
  },
  {
    key: 'elasticache',
    module: 'apps/system-studio/src/lib/aws/elasticache.ts',
    what: `ElastiCache — clusters and replication groups, engine and engine version, node type,
number of nodes, whether encryption at rest and in transit are enabled, whether auth is
required, the maintenance window, and any pending modified values. The operational questions
are "is the cache encrypted", "is it a single node with no failover", and "is there a version
upgrade pending that will restart it". An engine version behind the current default is a
scheduled interruption; say when the automatic upgrade window is.`,
  },
  {
    key: 'dynamodb-tables',
    module: 'apps/system-studio/src/lib/aws/dynamodb-tables.ts',
    what: `DynamoDB as a control-plane read — every table, its billing mode and provisioned
capacity, its item count and size, its encryption (and whether it is a customer-managed key
or the AWS-owned default), point-in-time recovery status, deletion protection, TTL
configuration, and its global secondary indexes. This estate keeps the TENANT REGISTRY in
DynamoDB, so PITR being off on the registry table is a total loss of the fleet's own record
of itself. Rank that fact first. Do NOT read table CONTENTS — this is the table's
configuration, not its data, and the registry has its own typed reader.`,
  },
  {
    key: 'metrics',
    module: 'apps/system-studio/src/lib/aws/metrics.ts',
    what: `CloudWatch metric DATA via GetMetricData — the numbers behind the alarms the console
already describes. Today alarms.ts reads alarm STATE and no metric is ever read, so an
operator sees "OK" and cannot see the trend that is about to end it. Provide a typed,
batched reader: a caller names the metric queries it wants (namespace, metric, dimensions,
stat, period) and gets back time series with their timestamps in UTC. GetMetricData is
charged per metric requested and is easy to make expensive: batch up to the API's limit,
demand an explicit time window from the caller, and refuse an unbounded one. Return the
series AND a compact summary (latest, min, max, mean over the window) so a surface does not
have to re-derive it. Missing data points are a real state — a gap is not a zero, and
returning 0 for "no datapoint" is the defect this module must not have.`,
  },
  {
    key: 'logs',
    module: 'apps/system-studio/src/lib/aws/logs.ts',
    what: `CloudWatch Logs posture and evidence — every log group with its retention (a group
with retention "Never expire" is an unbounded bill and a compliance problem; one with 1 day
is a lost incident), its stored bytes, its KMS key if any, its metric filters, and the age of
its most recent event. A log group that has received NOTHING for longer than its service's
deploy cadence means the thing that writes to it stopped, which reads exactly like calm.
Then FilterLogEvents, bounded: a caller names the group, a time window and a pattern, and
gets matching events back with a hard cap and an explicit "there were more" signal. Never
return more than the cap silently, and never widen the pattern to empty. Redact nothing by
guessing — instead, refuse to return events from any log group whose name marks it as
carrying tenant data unless the caller passes an explicit acknowledgement, and say so.`,
  },
  {
    key: 'buckets',
    module: 'apps/system-studio/src/lib/aws/buckets.ts',
    what: `S3 posture — every bucket, its region, and for each: the public access block (all
four flags), its policy status (is it public), default encryption and whether it is SSE-KMS
or SSE-S3, versioning and MFA-delete, its lifecycle configuration, and its tags. Terraform
sets all of these and NOTHING reads them back, so a manual console change that opened a
bucket would never surface. Public access is the headline: a bucket where any of the four
block flags is false, or whose policy status says public, is the finding. GetBucket* calls
are PER BUCKET and each can fail independently — a bucket in another region or one you
cannot read the policy of must degrade to UNKNOWN for THAT FACT while the rest of the row
stays real. Do not let one denied sub-call collapse the whole bucket to unknown, and do not
let it silently render as "not public".`,
  },
  {
    key: 'secrets',
    module: 'apps/system-studio/src/lib/aws/secrets.ts',
    what: `Secrets Manager posture — every secret, its name and ARN, whether rotation is
configured and with what schedule, when it was last rotated and last accessed, its KMS key,
and whether it is scheduled for deletion. NEVER call GetSecretValue and never return a
secret VALUE — this module must not import that command at all, and your test must assert
it does not. The operational questions: which secrets have no rotation, which are older than
their rotation interval, and which are scheduled for deletion with a recovery window still
running. The 2026-08-13 audit left a shared secret in Secrets Manager that "should be
rotated afterwards" — this reader is how that stops being a note in a handoff document.`,
  },
  {
    key: 'keys',
    module: 'apps/system-studio/src/lib/aws/keys.ts',
    what: `KMS — the customer-managed keys, each key's description, state, key manager
(AWS vs CUSTOMER), rotation status and rotation period, and its aliases. ListKeys already
exists as a capability but returns key ids with no meaning attached; DescribeKey and
GetKeyRotationStatus are what make it an answer. A customer-managed key with rotation
DISABLED is the finding. AWS-managed keys always rotate and must be reported as such rather
than as a passing check — counting them as compliant is how a posture number lies. A key
pending deletion is urgent: name the deletion date.`,
  },
  {
    key: 'trail',
    module: 'apps/system-studio/src/lib/aws/trail.ts',
    what: `CloudTrail — for each trail, GetTrailStatus: is it actually logging, when did it
last deliver, and what was the last delivery error. DescribeTrails already exists and tells
you a trail is CONFIGURED, which is not the same as logging — a trail that stopped delivering
three weeks ago describes itself exactly like a healthy one in DescribeTrails. Also report
whether log file validation is enabled, whether it is multi-region, and its S3 bucket and KMS
key. Then LookupEvents, bounded and read-only: a caller names a time window and optionally a
resource or event name, and gets management events back with a hard cap. This is how the
console answers "who changed this" without leaving the console. LookupEvents is throttled
aggressively — treat a throttle as its own state, never as an empty result.`,
  },
  {
    key: 'compliance',
    module: 'apps/system-studio/src/lib/aws/compliance.ts',
    what: `AWS Config — the config rules that exist and DescribeComplianceByConfigRule for each,
plus the recorder's status: is configuration recording actually ON, and is it recording all
resource types or a subset. The existing capability only describes AGGREGATORS, which tells
you nothing about whether anything is being evaluated. The most dangerous state here is
INSUFFICIENT_DATA presented as compliant: a rule that has evaluated nothing is not passing,
and NOT_APPLICABLE, INSUFFICIENT_DATA, COMPLIANT and NON_COMPLIANT must each render
differently. If Config is not enabled in this account at all, that is a real and important
UNKNOWN with a named remedy — not an empty list of rules.`,
  },
  {
    key: 'dns',
    module: 'apps/system-studio/src/lib/aws/dns.ts',
    what: `Route 53 — for each hosted zone, its resource record sets: name, type, TTL, and
whether it is an alias and to what. The operational question this estate has is specific:
tenant URLs are platform.tenurework.com/<slug> and the Studio has its own host, so the
console must be able to answer "does the DNS for this tenant actually point at our
CloudFront distribution" without leaving the page. Correlate alias targets to the
distribution domain names the CloudFront reader returns, and flag a record pointing at
something the estate does not own — a dangling alias to a deleted distribution is a
subdomain takeover. Also report the zone's delegation set NS records against the registrar
where you can see it, or say plainly that the registrar is outside this account's visibility.`,
  },
  {
    key: 'cdn',
    module: 'apps/system-studio/src/lib/aws/cdn.ts',
    what: `CloudFront in detail — GetDistributionConfig for each distribution: its origins and
their protocol policy, the default root object, the viewer certificate and minimum TLS
version, whether a WAF web ACL is associated, its cache behaviours and which paths bypass
the cache, its logging configuration, and its geo restrictions. ListDistributions already
exists and returns a domain name and a status; the CONFIG is where the defects live — an
origin reachable over plain HTTP, a distribution with no WAF, TLSv1 still allowed. Then
ListInvalidations with their status, because a deploy that "went out" while an invalidation
is still InProgress is the most common cause of "I do not see my change" in this estate.`,
  },
  {
    key: 'database',
    module: 'apps/system-studio/src/lib/aws/database.ts',
    what: `RDS beyond the instance list — DescribePendingMaintenanceActions (a forced upgrade
with an apply-immediately date is a scheduled outage nobody has been told about),
DescribeEvents for the last window (failovers, restarts, low storage, replication errors),
and DescribeDBParameterGroups with the parameters that differ from the engine default. The
existing reader lists instances and snapshots. What an operator actually needs is: is a
maintenance action pending and when will it be forced, did this instance restart recently
and why, is storage autoscaling on and how close is it to the ceiling, and is
\`rds.force_ssl\` actually set. Report backup retention and the latest restorable time
alongside the snapshots the existing reader already sees.`,
  },
  {
    key: 'containers',
    module: 'apps/system-studio/src/lib/aws/containers.ts',
    what: `ECS at task granularity — DescribeClusters with their capacity providers and
registered instances, ListTasks/DescribeTasks for running AND recently stopped tasks with
their stoppedReason and container exit codes, DescribeTaskDefinition for the revision each
service is actually running (its image digest, cpu/memory, its log configuration, and
whether it declares secrets or plain-text environment). The existing reader stops at
DescribeServices, which reports desiredCount and runningCount and cannot explain a gap
between them. \`stoppedReason\` is the single most valuable string in this whole programme —
"OutOfMemoryError: Container killed due to memory usage" and "Task failed ELB health checks"
are different incidents and today both look like "runningCount is 1 not 2". A task
definition whose containerDefinitions carry \`environment\` entries that look like
credentials (a name matching KEY|SECRET|TOKEN|PASSWORD) is a finding — report the NAME only,
never the value.`,
  },
  {
    key: 'certificates',
    module: 'apps/system-studio/src/lib/aws/certificates.ts',
    what: `ACM in detail — DescribeCertificate for each certificate: its domain and subject
alternative names, its validation status and method and, when DNS validation is pending, the
exact CNAME record that must exist; its NotAfter with days remaining; its renewal eligibility
and renewal status; and the resources it is IN USE BY. ListCertificates already exists and
returns ARNs and domains. The two states that matter and are invisible today: a certificate
PENDING_VALIDATION forever because the validation CNAME was never created (this is the
single most common cause of a stuck tenant provisioning), and a certificate approaching
expiry that is NOT eligible for managed renewal because it is not attached to anything AWS
can validate through. Give days-to-expiry as a number so a surface can rank by it.`,
  },
  {
    key: 'quotas',
    module: 'apps/system-studio/src/lib/aws/quotas.ts',
    what: `Service Quotas — for the services this estate actually uses, the applied quota value
and the default, and whether the applied value has been raised. A distribution engine that
provisions a new tenant's stack fails at a quota boundary, and today it discovers that
boundary at 2am during a provisioning run. Cover at minimum the quotas that bound tenant
creation here: VPCs per region, security groups per VPC, rules per security group, ECS
services per cluster, ALBs per region, target groups per region, RDS instances, CloudFront
distributions per account, ACM certificates per region, SES daily sending quota, Lambda
concurrent executions, and Cognito user pools per account. Where a matching usage number is
available from a reader another agent is writing, express headroom as used-of-applied; where
it is not, return the quota alone and say plainly that usage is not known rather than
implying full headroom. GetServiceQuota is per quota code and will throttle — batch by
service and use the capability's cadence.`,
  },
  {
    key: 'analyzer',
    module: 'apps/system-studio/src/lib/aws/analyzer.ts',
    what: `IAM Access Analyzer — the analyzers configured for this account (and whether ANY
exists, because none is the finding), and their findings: which resources grant access to an
external principal, what that principal is, and which action is exposed. This is the check
that answers "is anything in this estate shared outside the account" for S3 buckets, KMS
keys, IAM roles, SQS queues, Secrets Manager secrets and ECR repositories at once — every
one of which this estate provisions. An account with no analyzer must render as UNKNOWN with
the remedy, never as "no external access found": those two are opposite claims and today the
console can make neither.`,
  },
  {
    key: 'guardduty',
    module: 'apps/system-studio/src/lib/aws/guardduty.ts',
    what: `GuardDuty — whether a detector exists and is ENABLED, which data sources and
protection plans are on (S3, EKS, Malware, RDS login events, Lambda network activity), the
publishing frequency, and the current findings by severity with their type, resource and
first/last seen. If GuardDuty is not enabled in this account, that is the finding and it must
say so with the remedy and the cost implication — an operator reading "0 findings" from a
disabled detector is being actively misled, and that specific confusion is why this module
exists. Where it IS enabled, rank by severity and give the finding type verbatim
(\`UnauthorizedAccess:EC2/SSHBruteForce\`) rather than a paraphrase.`,
  },
  {
    key: 'pricing',
    module: 'apps/system-studio/src/lib/aws/pricing.ts',
    what: `The AWS Price List API — the actual on-demand price of the resource shapes this
engine provisions, so the priced configuration catalog stops being a transcribed table. The
standing product requirement is that EVERY configuration option carries a price tag, per seat
AND per organisation, with a running total, at every stage of tenant setup. That number is
only trustworthy if it is grounded. Provide a typed reader for the shapes this estate
provisions: the Fargate vCPU-hour and GB-hour rate, the RDS instance-hour for a given class
and engine, ElastiCache node-hours, ALB hours and LCU, CloudFront request and data-transfer
tiers, S3 storage and request tiers, DynamoDB on-demand read/write request units, SES
outbound message price, and SQS request price. RULES THAT ARE NOT NEGOTIABLE: money is
INTEGER MINOR UNITS, never a float — the Price List returns decimal strings and parsing one
into a JS number is the bug; parse to integer minor units of the stated currency and carry
the currency explicitly. The Pricing API is only served from us-east-1 and ap-south-1: that
is a real API constraint, encode it with a comment. Quoting only — this module must not
import or expose anything that moves money. A price you could not fetch is UNKNOWN, and a
caller must not be able to silently substitute zero for it.`,
  },
  {
    key: 'waf',
    module: 'apps/system-studio/src/lib/aws/waf.ts',
    what: `WAFv2 — the web ACLs in this account (CLOUDFRONT scope is served from us-east-1 and
REGIONAL from the estate's region: handle both explicitly), their default action, their rules
and rule groups, and GetWebACLForResource for each load balancer and distribution so the
console can answer "is this thing behind a WAF" per resource rather than per account. The
expected answer in this estate today is probably "no web ACL exists", and that must render as
a clear, honest finding with what it would take to change — not as an empty table that reads
like nothing is wrong. If WAFv2 is not in use, ListWebACLs succeeds and returns an empty
list: distinguish that successful-empty from AccessDenied, because they mean opposite things.`,
  },
  {
    key: 'dashboards',
    module: 'apps/system-studio/src/lib/aws/dashboards.ts',
    what: `CloudWatch dashboards — which dashboards exist, when each was last modified, and what
each one actually WATCHES: parse the dashboard body's widgets down to the metrics and alarms
they reference. Terraform provisions a dashboard here and nothing reads it back, so nobody
can tell whether the dashboard still points at services that exist. The operational question
is coverage: which of the estate's services appear on no dashboard and in no alarm, because
that intersection is the part of the fleet nobody is watching. Return the referenced metric
namespaces and alarm names as structured data so a surface can compute that intersection
against the inventory rather than eyeballing a JSON blob. A dashboard body is JSON in a
string; a malformed one is a real state, not a crash.`,
  },
]

phase('Wire')
log(`${SERVICES.length} dark AWS services, one agent and one module each`)

const built = await pipeline(
  SERVICES,

  (item) =>
    agent(
      `${RULES}

TASK — wire ${item.key.toUpperCase()} into the Tenure Global Deployment Engine's live AWS reads.
This service is DARK today: Terraform provisions it and the console cannot see it.

YOU OWN, exclusively: ${item.module} and a \`.test.ts\` beside it. You may also APPEND your
requirement entries to ${LEDGER} (append only — never rewrite another agent's row).

YOU MAY NOT EDIT: capabilities.ts, client.ts, read.ts, throttle.ts, iam.tf, any other
src/lib/aws/*.ts, or any page. A foundation agent has just extended the registry and 23
sibling service agents are working beside you. READ capabilities.ts first to learn the exact
capability keys available to you. If the capability you need is missing from the registry,
return FAIL naming the exact key and IAM action you needed rather than adding it yourself.

WHAT TO READ, and the question it answers:
${item.what}

HOW IT MUST BEHAVE — this matters more than the data:
- Return the \`AwsRead<T>\` union from read.ts. A denied call is UNKNOWN carrying the
  principal, the action, and a pasteable minimum IAM statement. It is NEVER an empty list.
  An operator reading "no queues" when the truth is "we were not allowed to look" is the
  single most dangerous thing this console can do, and the type exists to stop it.
- A throttle is its own state — not a failure and not an empty result. Use throttle.ts.
- Resolve region and partition from the resolved identity, never a literal.
- Paginate to completion, with a bound. A reader that silently returns the first page is
  the same lie as an empty list; a reader with no bound is how one agent takes down the
  console. Cap it, and return an explicit "there were more" signal when you hit the cap.
- Attribute every resource to a tenant where a tag says so, and mark it shared where none
  does. Use the Resource Groups Tagging API path that already exists in tags.ts.
- Carry an explicit "as of" timestamp and your capability's own refresh cadence.
- Sub-calls that can fail independently must degrade independently — one denied detail must
  not collapse a whole row to UNKNOWN, and must not render as a reassuring default.

PROVE IT with a fake that behaves like the real client across FOUR cases — AccessDenied, a
throttle, an empty-but-successful list, and a populated list — and assert the module says
something DIFFERENT for each. A fake returning [] regardless is the fake test this programme
has already been burned by. Mutate the PRODUCTION path, not the helper: apply the mutation,
run the test, CONFIRM IT FAILS, restore, confirm green. Report each mutation verbatim with
both results.

Do not render anything. A surface agent will consume what you export; your job is that the
data is real, honest about what it does not know, and typed so a caller cannot ignore that.
List every exported symbol in \`exports\` so the surface agents know what to call.`,
      { label: `aws:${item.key}`, phase: 'Wire', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  (out, item) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { item, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven in ${item.module}. Default refuted=true for each; set false ONLY for the ones you have
verified YOURSELF, with your own hands, this run.

${claimed
  .map(
    (r) =>
      `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ') || '(none reported)'}

For EACH claim, in order:
  1. Is it reachable from a real production call path? Trace it from a route or an exported
     entry point something imports. Dead code fails. Name the caller you found, or refute.
  2. RE-RUN THE MUTATION yourself — apply it, run the test, OBSERVE the failure, restore,
     confirm green. Do not take their word. If the mutation does not red the test, refute.
  3. Is the fake canned? Specifically: does it actually distinguish AccessDenied from an
     empty successful list, and does the module return something DIFFERENT for each? If a
     denied read can be rendered as "none", refute the whole set.
  4. Does pagination terminate, and does hitting the cap surface as an explicit signal
     rather than a silently short list?
  5. Does any new comment, string or ledger entry claim something untrue? An invented ARN,
     account id, price, date or approval is a refutation.
  6. Was a guard weakened, a ratchet loosened, an assertion deleted, or a check left disabled
     behind \`false &&\` / \`|| true\`? Grep for it.
  7. Did they add a WRITE path to AWS — any Create/Put/Delete/Update/Send/Invoke command, or
     a capability granting one? That refutes every claim in the set automatically.
  8. For ${item.key} specifically, the highest-risk failure is a security-relevant absence
     rendering as a pass: "no findings" from a disabled detector, "not public" from a denied
     policy read, "rotation on" inferred from an AWS-managed key. Hunt for that shape.

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you left
it exactly as you found it.`,
      { label: `refute:${item.key}`, phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ item, out, verdicts: v }))
  },
)

const rows = []
for (const r of built.filter(Boolean)) {
  const verdictFor = new Map((r.verdicts?.verdicts || []).map((v) => [v.id, v]))
  for (const res of r.out?.results || []) {
    const v = verdictFor.get(res.id)
    rows.push({
      id: res.id,
      service: r.item.key,
      module: r.item.module,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy:
        res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
      caller: res.caller,
      blocked: res.blocked_reason,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${confirmed.length} confirmed of ${rows.length} attempted across ${built.filter(Boolean).length} services`)

return {
  program: 'aws-bridge-services',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
  exportsByService: built
    .filter(Boolean)
    .map((r) => ({ service: r.item.key, exports: r.out?.exports || [] })),
}
