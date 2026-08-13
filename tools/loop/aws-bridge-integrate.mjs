export const meta = {
  name: 'aws-bridge-integrate',
  description:
    'Give the newly-readable AWS services somewhere to live: five new operator surfaces, the aggregation layer that folds them into inventory / posture / health / drift / cost, and the ratchet that makes a dark service impossible to ship again',
  whenToUse:
    'After aws-bridge-services has landed the per-service readers. Runs the navigation reconciliation last, once the new routes exist.',
  phases: [
    { title: 'Integrate', detail: 'five new surfaces and eleven aggregation modules, disjoint files' },
    { title: 'Reconcile', detail: 'the navigation, once the new routes exist' },
  ],
}

const RULES = `
You are building the Tenure platform in C:/Users/satvi/Tenure-Parent, on branch
"studio-program" (NOT main). The working tree is shared with other agents right now:
touch ONLY the files named as yours below.

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, git checkout or rewrite history.
  The orchestrator does that. Do not run \`git add -A\`.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or money movement. Pricing work here
  is QUOTING ONLY.
- Never treat an AI, agent, operator or test result as human approval.
- READ-ONLY AWS. Do not add a code path that creates, updates, deletes, puts, sends or
  invokes. src/lib/aws/mutate.ts is the ONLY place mutations live and you are not extending it.

THE FIVE THINGS THAT SHIPPED BROKEN HERE. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`,
   \`if (false && !isPaymentMode(...))\`, \`|| true\`, a \`// MUTATION\` stub shipped in
   production, and \`false && CREDENTIAL.test(write)\`. Each read GREEN. If you disable a check
   to iterate, restore it before you report, and say in your result that you did.

2. A FABRICATED APPROVAL. Never write an approval, review, certification or sign-off a human
   did not give. Never invent an AWS account id, ARN, region, price, date or resource name.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. An OPTIONAL field a caller omits is
   invisible to \`tsc\`. Grep every construction site of any type you change and NAME them.
   This applies hardest to YOU: several of these modules are consumed by every surface.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Anything you generate must be
   byte-identical on Linux and Windows. Do NOT run \`npm run generate\` — the orchestrator runs
   it once at the end against a clean tree. Do NOT run \`npm install\`.

NOTHING MOCK. NOTHING. Every number, list and state on screen comes from a real source — the
registry, the ledger, the AWS inventory, the catalogs. No sample tenants, no lorem, no
illustrative figures, no hard-coded example rows. Operator surfaces import
\`CUSTOMER_TENANT_BINDINGS\`, never the unfiltered \`TENANT_BINDINGS\`.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. Name the caller in your result.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm it passes. Report each mutation and both results verbatim.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact commands that would unblock it, is
  worth more than a false PASS.

HOUSE FACTS you will otherwise rediscover the expensive way:
- apps/system-studio must NOT import a Prisma client — \`tests/security/operator-plane-content.test.mjs\`
  asserts it. The Studio reads AWS and DynamoDB, never the tenant database.
- STUDIO-000-007 is enforced by a TYPE: \`AwsRead<T>\` in src/lib/aws/read.ts has NO arm
  carrying an optional \`T\`. A denied read renders UNKNOWN with the principal, the action and
  a pasteable minimum IAM statement — NEVER as an empty list, a zero or a default.
- The console must keep booting without AWS credentials. A page that 500s because STS is
  unreachable is not an acceptable refusal.
- Region and partition resolve from the resolved identity, NEVER a literal.
- New audit writes go through \`recordAuditEvent\`; every ratchet may only FALL.
- Verify your own file compiles: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`.
  Errors in OTHER agents' files are expected mid-flight — report only yours.
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
    readers_consumed: { type: 'array', items: { type: 'string' } },
    routes_added: { type: 'array', items: { type: 'string' } },
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

const NEW_READERS = `cognito, network (ec2/vpc/security-groups), loadbalancer (elbv2 + target
health), ecr, elasticache, dynamodb-tables, metrics (cloudwatch GetMetricData), logs,
buckets (s3 posture), secrets, keys (kms), trail (cloudtrail), compliance (aws config), dns
(route53 records), cdn (cloudfront config + invalidations), database (rds maintenance /
events / parameters), containers (ecs tasks + stoppedReason + task definitions),
certificates (acm detail), quotas (service quotas), analyzer (access analyzer), guardduty,
pricing (aws price list), waf (wafv2), dashboards — alongside the ones that already existed:
ses, sqs, lambda, iam, budgets, aws-health, eventbridge, alarms, inventory, findings,
organization, posture, drift, tags, identity, retained, topology, health`

const TASKS = [
  // ── Five new operator surfaces ────────────────────────────────────────────
  {
    key: 'surface-network',
    owns: 'apps/system-studio/src/app/platform/network/page.tsx (NEW) plus its own directory (network.module.css, its own helper modules and their tests)',
    kind: 'surface',
    brief: `A new operator surface: NETWORK.

THE QUESTION IT ANSWERS: "What can reach this estate from the internet, and is traffic
actually getting to the services?"

Compose it from the \`network\` and \`loadbalancer\` readers. Lead with the answer in words — how
many paths from the internet exist and whether every load-balancer target is healthy — then:
  · every security group rule allowing 0.0.0.0/0 or ::/0, with the port and the resource it is
    attached to, ranked first and hardest. This is the finding the estate cannot currently see.
  · each load balancer with its listeners, and each target group with per-target health AND
    the reason code for every unhealthy target. "Target.Timeout" and
    "Target.ResponseCodeMismatch" send an operator to different places; show the string.
  · the VPC/subnet layout with public-vs-private derived from the ROUTE TABLE, not the name.
  · security groups attached to nothing, and any HTTP listener with no redirect to HTTPS.`,
  },
  {
    key: 'surface-compute',
    owns: 'apps/system-studio/src/app/platform/compute/page.tsx (NEW) plus its own directory',
    kind: 'surface',
    brief: `A new operator surface: COMPUTE.

THE QUESTION IT ANSWERS: "What is running, what is it running, and why did anything stop?"

Compose it from the \`containers\`, \`lambda\` and \`ecr\` readers. Lead with the gap between
desired and running across the fleet, then:
  · every recently STOPPED ECS task with its \`stoppedReason\` and container exit codes. This
    single string is the most valuable thing this programme surfaces — today a crash-looping
    service is indistinguishable from a slow one.
  · the task definition revision each service actually runs, with its image DIGEST, cpu and
    memory, and whether it declares plain-text environment variables whose NAMES look like
    credentials (report the name only — never a value).
  · the ECR repository each image came from with its scan findings by severity, correlated by
    digest, and an explicit "scanning is off here" where scanOnPush is disabled.
  · Lambda functions on deprecated or soon-deprecated runtimes.`,
  },
  {
    key: 'surface-data',
    owns: 'apps/system-studio/src/app/platform/data/page.tsx (NEW) plus its own directory',
    kind: 'surface',
    brief: `A new operator surface: DATA.

THE QUESTION IT ANSWERS: "Where does this platform keep state, is it protected, and is
anything about to interrupt it?"

Compose it from the \`database\`, \`dynamodb-tables\`, \`elasticache\`, \`buckets\` and the existing
backup readers. Lead with a one-line protection verdict, then:
  · every pending RDS maintenance action with the date it will be FORCED, and recent RDS
    events (failovers, restarts, low storage);
  · every DynamoDB table with PITR, deletion protection and encryption — the TENANT REGISTRY
    lives here, so PITR off on the registry table is total loss of the fleet's own record of
    itself and must rank first;
  · every S3 bucket's public-access-block, policy status, encryption and versioning, with
    public access ranked hardest;
  · ElastiCache encryption at rest and in transit, and single-node clusters with no failover;
  · backup vaults and the age of the newest recovery point per protected resource.`,
  },
  {
    key: 'surface-messaging',
    owns: 'apps/system-studio/src/app/platform/messaging/page.tsx (NEW) plus its own directory',
    kind: 'surface',
    brief: `A new operator surface: MESSAGING.

THE QUESTION IT ANSWERS: "Can this platform actually reach people, and is anything queued
that nobody is processing?"

Compose it from the existing \`ses\`, \`sqs\` and \`eventbridge\` readers. Lead with whether the
account can send mail at all, then:
  · SES sandbox state (it silently limits who can be emailed and is the highest-value fact
    here), the verified identities, the 24-hour send quota against actual send rate, and the
    account-level suppression list;
  · every queue with its depth, in-flight count, oldest-message age and redrive policy — and a
    dead-letter queue with ANYTHING in it as its own state, not a number in a table: it is a
    delivery that failed and nobody was told;
  · EventBridge rules with their schedule or pattern and their targets, with DISABLED
    scheduled rules ranked first — a disabled schedule is a job that silently stopped, the
    same shape of defect as an alarm with its actions switched off.`,
  },
  {
    key: 'surface-identity',
    owns: 'apps/system-studio/src/app/platform/identity/page.tsx (NEW) plus its own directory',
    kind: 'surface',
    brief: `A new operator surface: IDENTITY.

THE QUESTION IT ANSWERS: "Who can get into this control plane and into this account, and
what is protecting those doors?"

Compose it from the \`cognito\`, \`iam\`, \`analyzer\`, \`keys\` and \`secrets\` readers. Lead with the
count of principals that can administer the platform, then:
  · the Cognito pool that gates THIS console: its MFA configuration, its password policy, and
    every operator account with its status and MFA enrolment. On 2026-08-13 an audit found the
    migration had reissued a shared secret as a PERMANENT password with MFA OPTIONAL and
    nothing here could see it. Build the panel that would have shown it. Never render a
    password, a token, a client secret or a raw user attribute beyond the sign-in identifier.
  · IAM roles with wildcard actions or resources, and long-lived access keys with their age;
  · Access Analyzer external-access findings — and where NO analyzer exists, that as the
    finding with its remedy, never as "no external access found";
  · KMS customer-managed keys with rotation disabled, and secrets with no rotation or older
    than their rotation interval.

The rule that governs this page: an absence of findings from a control that is not running is
NOT a pass, and must be visually distinct from checked-and-clean.`,
  },

  // ── The aggregation layer ─────────────────────────────────────────────────
  {
    key: 'inventory',
    owns: 'apps/system-studio/src/lib/aws/inventory.ts and its test',
    kind: 'module',
    brief: `Fold every newly-readable service into the estate inventory, so /platform/estate stops
being a partial picture.

Today inventory.ts composes a subset of services. Extend it to compose ALL of them:
${NEW_READERS}

TWO PROPERTIES MATTER MORE THAN BREADTH:
1. COVERAGE IS PART OF THE ANSWER. The inventory must be able to state which services it can
   see, which it was DENIED, and which have no reader at all — as data, not as an absence. A
   caller must be able to render "we cannot see ECR" differently from "there is no ECR".
2. ONE DENIED SERVICE MUST NOT COLLAPSE THE INVENTORY. Compose the reads so a denied or
   throttled service degrades to UNKNOWN for its own section while every other section stays
   real, and so the total count says explicitly that it excludes what could not be read. A
   resource count that silently omits a denied service is a lie with a number on it.

Read every service concurrently but respect each capability's own cadence and the throttle
module — a page load must not fan out sixty uncached API calls.`,
  },
  {
    key: 'topology',
    owns: 'apps/system-studio/src/lib/aws/topology.ts and its test',
    kind: 'module',
    brief: `The wiring graph: which AWS resource serves which tenant, and through what.

Extend topology.ts so it can answer, for one tenant, the whole path: DNS record -> CloudFront
distribution -> load balancer -> target group -> ECS service -> task definition -> image
digest -> ECR repository, plus the RDS instance, DynamoDB tables, S3 buckets, queues and
secrets it uses. Attribution comes from tags via tags.ts; a resource with no tenant tag is
SHARED and must be labelled shared rather than guessed at or silently dropped.

THE VALUABLE OUTPUT IS THE BROKEN EDGE, not the intact one. A DNS alias pointing at a
distribution that does not exist, a target group with no healthy targets, a service running a
task definition whose image digest is absent from ECR, a listener certificate that expires
before the next deploy window — each is a real break and the graph is how they become
visible. Model an edge as present / absent / unknown, never as a boolean, so "we could not
read that side" is distinguishable from "it is not connected".`,
  },
  {
    key: 'posture',
    owns: 'apps/system-studio/src/lib/aws/posture.ts and its test',
    kind: 'module',
    brief: `Aggregate security posture across every newly-readable service, for /platform/security.

Fold in: guardduty, analyzer, buckets (public access, encryption, versioning), keys (rotation),
secrets (rotation age), network (open ingress), waf (unprotected distributions and load
balancers), ecr (scanning off, findings), compliance (config rules), trail (logging actually
on), cognito (MFA configuration) and iam (wildcards, long-lived keys).

THE ONE RULE THIS MODULE EXISTS TO ENFORCE, and it must be structural rather than a
convention: a check that did not RUN is not a check that PASSED. Model each posture item as
one of { pass, fail, not-checked (with the reason and the remedy), unknown (denied or
throttled) } — four states, no boolean, no optional field that defaults to fine. Any summary
score must carry the count of not-checked and unknown alongside it, and it must be impossible
to compute a "clean" verdict while either is non-zero. A disabled GuardDuty detector
reporting zero findings is the exact failure this shape prevents.`,
  },
  {
    key: 'fleet-health',
    owns: 'apps/system-studio/src/lib/aws/health.ts and its test',
    kind: 'module',
    brief: `The fleet-health verdict, now that real metrics can be read.

Extend health.ts to compose alarms (state), metrics (the numbers behind them),
loadbalancer (target health), containers (stopped tasks and their reasons), aws-health (is it
us or AWS) and database (pending maintenance) into one ranked verdict.

RANKING RULES, each bought by a real defect:
  · an AWS Health event affecting a service we use outranks our own alarms — it answers "is it
    us" before an operator spends an hour deciding;
  · an alarm with its ACTIONS DISABLED outranks OK, because it will never tell anyone;
  · a target group with zero healthy targets outranks a service whose alarm has not fired yet;
  · a metric with NO DATA is not a healthy metric and must never be rendered as zero;
  · a read that was denied or throttled degrades the verdict to "cannot say", never to OK.
The verdict must name what it is based on and what it could not see, so a green light is
falsifiable.`,
  },
  {
    key: 'findings',
    owns: 'apps/system-studio/src/lib/aws/findings.ts and its test',
    kind: 'module',
    brief: `One findings pipeline over every source now readable: Security Hub (already wired),
GuardDuty, Access Analyzer, ECR image scans, and Config rule non-compliance.

Normalise them to one shape — source, type verbatim, severity, resource ARN, tenant
attribution, first and last seen, and a remedy — WITHOUT flattening away what makes each
source meaningful. Deduplicate across sources by resource ARN plus finding type, because
Security Hub ingests GuardDuty and will otherwise double-count the same threat, and say in
the output when a finding was seen by more than one source (that is corroboration, and it is
information).

Severity must be a single normalised scale with each source's native value carried alongside
it, so nobody has to trust the mapping blindly. A source that is NOT ENABLED contributes a
"not checked" marker to the pipeline, never zero findings.`,
  },
  {
    key: 'attribution',
    owns: 'apps/system-studio/src/lib/aws/tags.ts and its test',
    kind: 'module',
    brief: `Tenant attribution across every service the console can now read.

tags.ts already reaches the Resource Groups Tagging API. Extend it so every new service's
resources can be attributed, and so the module can answer the two questions the cost and
estate surfaces need: which resources belong to tenant X, and which belong to nobody.

Facts that must shape the design: the Tagging API does not cover every resource type (it
misses some Cognito, Route 53 and CloudFront resources, among others), so a resource absent
from its results is NOT untagged — it may be un-coverable, and conflating those two is how a
cost report silently misattributes. Model coverage explicitly: tagged-to-tenant, tagged-shared,
untagged, and not-coverable-by-this-API-so-read-directly. Where a service's own API exposes
tags, prefer that and say which path each answer came from.

An untagged resource is a real operational finding — it is spend nobody owns — so make it
first-class output rather than a residue.`,
  },
  {
    key: 'console-links',
    owns: 'apps/system-studio/src/lib/aws/console-link.ts and its test',
    kind: 'module',
    brief: `Deep links into the AWS console for every newly-readable resource type.

console-link.ts already builds links for the services that were wired. Extend it to cover
cognito user pools, VPCs / subnets / security groups, load balancers and target groups, ECR
repositories and images, ElastiCache clusters, DynamoDB tables, CloudWatch metrics and
dashboards and log groups, S3 buckets, Secrets Manager secrets, KMS keys, CloudTrail,
Config rules, Route 53 hosted zones, CloudFront distributions, RDS instances, ECS clusters
and tasks, ACM certificates, Service Quotas, Access Analyzer, GuardDuty and WAF web ACLs.

Every link derives its region and partition from the resolved identity — a hardcoded
\`console.aws.amazon.com\` breaks in every non-commercial partition, and a hardcoded region
sends an operator to an empty page in the wrong one. Some services are global and their
console path has no region (IAM, CloudFront, Route 53, WAF CLOUDFRONT scope); encode that
explicitly rather than letting a region leak in. A link you cannot build correctly must be
absent rather than wrong: a link to the wrong account is worse than no link.`,
  },
  {
    key: 'drift',
    owns: 'apps/system-studio/src/lib/aws/drift.ts and its test',
    kind: 'module',
    brief: `Declared-versus-observed drift, extended to every service the console can now read.

Terraform declares the estate; the readers observe it. drift.ts is where the two meet.
Extend it so each newly-readable service participates, and model THREE kinds of drift
separately because they mean different things:
  · declared but absent — the apply did not take, or something deleted it;
  · present but never declared — someone created it in the console, which is the finding
    STUDIO-000-009 asks for and the more dangerous of the two;
  · declared and present but DIFFERENT — the configuration was changed underneath us. This
    third kind is the one that matters most for the posture Terraform sets and nothing read
    back: bucket public-access blocks, encryption settings, security group rules, MFA
    configuration.

Parse what Terraform declares from the .tf sources in infrastructure/ rather than from a
state file (the state is not in this repository and must not be fetched). Be explicit that a
source-derived expectation cannot see \`count\`/\`for_each\` results and interpolated values:
where you cannot resolve a declared name, report it as un-comparable rather than as absent.
An un-comparable declaration counted as drift is noise, and noise is how a drift report gets
ignored.`,
  },
  {
    key: 'finops-pricing',
    owns: 'packages/finops/src/** (the pricing engine only — do NOT edit any app or any other package) and its tests',
    kind: 'module',
    brief: `Ground the priced configuration catalog in real AWS prices.

The standing product requirement: EVERY configuration option, at every stage where config is
set up for a new tenant, carries a price tag — per seat AND for the full organisation — with a
running total, so the tenant knows the cost as they configure. That number is only worth
having if it is grounded, and today the catalog's rates are transcribed.

A sibling agent has wired \`apps/system-studio/src/lib/aws/pricing.ts\` against the AWS Price
List API. Your job is the finops side: take resolved rates as INPUT (do not import the Studio
app from a package — the dependency runs the other way), and make the pricing engine able to
compute a tenant's shape from real rates: Fargate vCPU/GB-hours, RDS instance-hours,
ElastiCache node-hours, ALB hours and LCU, CloudFront requests and transfer, S3 storage and
requests, DynamoDB request units, SES messages, SQS requests.

RULES THAT ARE NOT NEGOTIABLE:
  · money is INTEGER MINOR UNITS, never a float, with an explicit currency and an explicit
    rounding rule stated at the boundary;
  · a rate that could not be resolved is UNKNOWN and must propagate — a running total that
    silently treats an unpriced option as free is the exact cost surprise this requirement
    exists to prevent, and it must be impossible to construct one;
  · quoting only. Nothing in this package moves money, and nothing in it may import a
    payments gateway.
Mutation-prove the propagation: make one rate unknown and show the total refuses to present
itself as complete.`,
  },
  {
    key: 'coverage-ratchet',
    owns: 'tests/architecture/every-provisioned-service-has-a-reader.test.mjs (NEW) and docs/architecture/aws-wiring-map.md (NEW)',
    kind: 'module',
    brief: `The ratchet that makes a dark AWS service impossible to ship again.

THE DEFECT THIS PREVENTS, in the operator's words: "Wiring of AWS to Tenure global system is
not at all fully completed (this is critical)." It was true, it was invisible, and it was only
found by counting SDK clients by hand. Make the count automatic and make it a build gate.

Write a test that:
  1. Parses every \`resource "aws_*"\` type declared across infrastructure/**/*.tf;
  2. Maps each to the AWS service that owns it (a small, EXPLICIT, committed table — not a
     regex guess, because \`aws_cloudwatch_event_rule\` is EventBridge and
     \`aws_cloudwatch_log_group\` is Logs, and a guess gets both wrong);
  3. Asserts every one of those services is named by at least one capability in
     apps/system-studio/src/lib/aws/capabilities.ts AND has a reader module under
     src/lib/aws/ that a real caller imports;
  4. Carries an explicit, SHRINKING allowlist of services knowingly not read, each with a
     written reason. The allowlist is a ratchet: it may only get shorter. Assert its length
     against a committed ceiling, exactly as RAW_WRITE_CEILING works.

It must be byte-stable across Linux and Windows: sort with a POSIX-normalised path, read
directories in sorted order, and never hash raw CRLF. Five red builds in this repository came
from exactly that class of bug.

Then write docs/architecture/aws-wiring-map.md: every AWS service in the estate, the
Terraform that provisions it, the capability that reads it, the module that exposes it, and
the surface that renders it — generated from the same table the test uses, so the document
cannot drift from the check. Mutation-prove the test both ways: remove a capability and show
it reds; add a fake .tf resource type and show it reds.`,
  },
  {
    key: 'ledger',
    owns: 'docs/implementation/system-studio-aws-control-plane-execution-ledger.md and docs/implementation/NEXT-SESSION.md',
    kind: 'module',
    brief: `Record what this programme actually established, under the evidence protocol.

Roughly fifty agents have just run. Your job is the honest record, and honesty here is worth
more than a high number: this programme's history is of ~45 claims against 11 confirmations,
and the handoff that survives is the one that says which was which.

For the ledger:
  · read the ledger's existing format and follow it exactly — Status, Reason, Evidence;
  · a requirement is PASS only where an independent refuter returned refuted=false. Anything
    else is FAIL with the refutation named, or BLOCKED_EXTERNAL naming the exact commands
    that would unblock it. There is no PARTIAL.
  · do NOT invent entries for work you cannot see in the tree. Verify each claim against the
    actual file before you write a row, and say in your result how many claims you could not
    corroborate.

For NEXT-SESSION.md: update §1 (where the work is), §2 (the three things the operator asked
for and where each now stands), §3 (the honest denominator — REGENERATE it with
\`node tools/loop/next-batch.mjs | head -1\` and
\`grep -c 'Status: PASS' docs/implementation/*execution-ledger.md\`, never quote from memory),
and §9 (open defects). Keep every section that is still true; do not rewrite the file
wholesale. Where this programme changed a fact in it, change that fact and leave the rest.`,
  },
]

phase('Integrate')
log(`${TASKS.length} integration tasks: 5 new surfaces, ${TASKS.length - 5} aggregation modules`)

const built = await pipeline(
  TASKS,

  (item) =>
    agent(
      `${RULES}

TASK — ${item.kind === 'surface' ? 'build a new operator surface' : 'extend the aggregation layer'}.

YOU OWN, exclusively: ${item.owns}
You may APPEND requirement entries to
docs/implementation/system-studio-aws-control-plane-execution-ledger.md (append only, never
rewrite another agent's row) — unless you are the ledger agent, who owns that file.

YOU MAY NOT EDIT: capabilities.ts, client.ts, read.ts, throttle.ts, iam.tf, globals.css,
anything under src/components/md3/, Nav.tsx, layout.tsx, any other route, or any other module
under src/lib/aws/. Sixteen sibling agents are working beside you on disjoint files. CONSUME
what they export; do not fork it.

${item.brief}

THE READERS AVAILABLE TO YOU. These modules exist under
apps/system-studio/src/lib/aws/ after the service programme:
${NEW_READERS}

READ THE DIRECTORY FIRST and use what is actually there — a reader may have returned FAIL and
be absent. If a reader you need does not exist, say so in \`readers_consumed\` and build so it
composes cleanly when it arrives. DO NOT STUB A READER, and do not read AWS directly from a
surface: readers are the only path to the SDK.

${
  item.kind === 'surface'
    ? `THIS IS A NEW ROUTE. Consume the MD3 primitives in src/components/md3/ (Surface, Card,
Button, Chip, Badge, DataTable, EmptyState, and the extended set which should include
KeyValue, UnknownState, StaleIndicator, Tabs, SeverityChip). A raw hex in a product module is
a defect. A denied or throttled read renders through the shared UnknownState — never as an
empty list, a zero, or a reassuring default.

Lead with the ANSWER in words, then Cards with real headings. Every panel states what it is
AS OF and says plainly when it does not know something.

CONSTRAINTS THAT WILL RED THE BUILD: \`e2e/layout.spec.ts\` runs every route at 1440, 1180, 900
AND 320px and asserts no overlapping text, nothing overflowing its container, and no sideways
page scroll — wide tables scroll inside their own container and long AWS identifiers need
\`overflow-wrap: anywhere\`. \`e2e/preferences.spec.ts\` asserts AA contrast in light, dark and
high contrast and no pure black or white. \`tests/architecture/shell-separation.test.mjs\`
asserts every nav destination is a route the console serves — a navigation agent will add
your route to the nav AFTER you land, so report the exact path in \`routes_added\`.

Add a Playwright spec for your route, and mutation-prove the page's decision logic by
extracting it into a pure module beside the page and testing that.`
    : `THIS IS A SHARED MODULE. Everything downstream depends on its shape, so rule 3 above
applies hardest to you: if you widen or change a type, grep EVERY construction site and name
the ones you checked. A field you add as optional is invisible to \`tsc\` at the call sites
that omit it.

Write the test beside the module and mutation-prove every behaviour: apply the mutation, run
it, CONFIRM IT FAILS, restore, confirm green. Report each mutation verbatim with both results.`
}

Report the caller that reaches your code in production. A module nothing imports is dead code,
and dead code with a comment claiming otherwise is worse than nothing.`,
      { label: item.key, phase: 'Integrate', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  (out, item) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { item, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven in: ${item.owns}. Default refuted=true for each; set false ONLY for the ones you have
verified YOURSELF, with your own hands, this run.

${claimed
  .map(
    (r) =>
      `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ') || '(none reported)'}

For EACH claim, in order:
  1. Is it reachable from a real production call path? Trace it. Dead code fails. Name the
     caller you found, or refute.
  2. RE-RUN THE MUTATION yourself — apply, run, OBSERVE the failure, restore, confirm green.
     If the mutation does not red the test, refute.
  3. Can a DENIED, throttled or NOT-ENABLED source render or aggregate as a pass, a zero, an
     empty list or a reassuring default anywhere in this code? Follow every read to its use.
     This is the single most likely defect in this programme — hunt it specifically.
  4. If a type changed: find the construction sites yourself and check the ones they did not
     name. An optional field the caller omits compiles and is wrong.
  5. Is anything MOCK — a hard-coded row, an illustrative figure, a sample tenant, a
     transcribed price, a number not traceable to the registry / ledger / AWS inventory /
     catalogs? Trace at least three values to their source.
  6. Does any new comment, string, doc or ledger entry claim something untrue? An invented
     ARN, account id, price, date, approval or evidence line is a refutation.
  7. Was a guard weakened, a ratchet loosened, or an assertion deleted to get green? Read
     every deletion in \`git diff\` for these files.
  8. Did they add a WRITE path to AWS, or anything that moves money? That refutes the set.

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you left it
exactly as you found it.`,
      { label: `refute:${item.key}`, phase: 'Integrate', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ item, out, verdicts: v }))
  },
)

// ── The navigation, last, once the new routes exist ─────────────────────────

phase('Reconcile')

const newRoutes = built
  .filter(Boolean)
  .flatMap((r) => r.out?.routes_added || [])
  .filter(Boolean)

log(`Reconciling navigation over ${newRoutes.length} new routes`)

const nav = await agent(
  `${RULES}

TASK — reconcile the System Studio navigation with the routes that now exist. You run LAST,
alone: no other agent is editing the tree.

YOU OWN, exclusively:
  apps/system-studio/src/components/Nav.tsx
  docs/architecture/studio-information-architecture.md
  apps/system-studio/src/app/platform/diagnostics/page.tsx
  tests/architecture/shell-separation.test.mjs

An earlier agent restructured the navigation into groups the Bible names, with a final
Diagnostics tab holding everything unfinished or developer-facing. Five new operator surfaces
have since landed:

${newRoutes.length ? newRoutes.map((r) => `  - ${r}`).join('\n') : '  (the integration agents reported none — enumerate them yourself from the filesystem)'}

ENUMERATE THE ROUTES YOURSELF from apps/system-studio/src/app/**/page.tsx rather than trusting
that list — an agent may have landed a route it did not report, and a route in the tree that
is in no navigation is a surface no operator will ever find.

Do three things:
  1. Place each new surface in the group the Bible puts its domain in, in the Bible's order.
     Do not invent a group for them; if one genuinely does not fit, say so and put it where it
     least misleads, with the reason in the document.
  2. Re-decide the Diagnostics line now that these surfaces exist. Several routes were behind
     it because nothing better existed; if a real surface now covers what a diagnostic route
     was standing in for, say so in the document. DO NOT DELETE A ROUTE.
  3. Strengthen \`tests/architecture/shell-separation.test.mjs\` so it asserts BOTH directions:
     every nav destination is a route the console serves (it already does), AND every route
     the console serves appears in the navigation or is explicitly listed as intentionally
     unlinked with a reason. A route nobody can reach is the failure mode this programme could
     otherwise ship five times over.

CONSTRAINTS: \`e2e/layout.spec.ts\` runs the nav at 1440, 1180, 900 AND 320px — a grouped nav
with five more destinations at 320px is the hard case, so test it and report what you saw.
\`preferences.spec.ts\` asserts AA contrast and no pure black or white. Consume the MD3
primitives; a raw hex in Nav.tsx is a defect.

Then, finally, run the whole gate and report the real numbers, pass and fail:
  npx tsc --noEmit -p apps/system-studio/tsconfig.json
  npm run type-check
  npm run lint
  npm run test:platform
Report each command's actual output summary. Do NOT fix another agent's file — report it.`,
  { label: 'nav:reconcile', phase: 'Reconcile', schema: RESULT_SCHEMA, effort: 'high' },
)

const rows = []
for (const r of built.filter(Boolean)) {
  const verdictFor = new Map((r.verdicts?.verdicts || []).map((v) => [v.id, v]))
  for (const res of r.out?.results || []) {
    const v = verdictFor.get(res.id)
    rows.push({
      id: res.id,
      task: r.item.key,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy:
        res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${confirmed.length} confirmed of ${rows.length} attempted across ${built.filter(Boolean).length} tasks`)

return {
  program: 'aws-bridge-integrate',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
  newRoutes,
  navigation: nav?.results || [],
  gate: nav?.evidence || '(the navigation agent reported no gate output)',
}
