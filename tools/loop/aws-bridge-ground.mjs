export const meta = {
  name: 'aws-bridge-ground',
  description:
    'Lay the rails the 50-agent AWS bridge runs on: every missing SDK client, every missing capability, the IAM grant, the navigation the Bible defines, and the MD3 primitives every surface consumes',
  whenToUse:
    'Before fanning out per-service and per-tab agents. Nothing else can start until the capability registry names the services.',
  phases: [{ title: 'Ground', detail: 'four disjoint foundations, in parallel' }],
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
- Do not execute payments, payroll, bank instructions or money movement.
- Never treat an AI, agent, operator or test result as human approval.
- READ-ONLY AWS. You are wiring reads. Do not add a capability, client command or code
  path that creates, updates, deletes, attaches, detaches, puts, sends or invokes.
  The reversible-mutation set in src/lib/aws/mutate.ts is the ONLY place mutations live
  and you are not extending it.

THE FIVE THINGS THAT SHIPPED BROKEN HERE. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`
   around the destructive-AWS-mutation gate, \`if (false && !isPaymentMode(...))\` around
   money-mode validation, \`|| true\` making a loop skip every key, a \`// MUTATION\` stub
   shipped in production, and \`false && CREDENTIAL.test(write)\` making a credential sweep
   return empty for every file. Each read GREEN. If you disable a check to iterate,
   restore it before you report, and say in your result that you did.

2. A FABRICATED APPROVAL. An agent set a provider review to APPROVED with invented
   verification dates. Never write an approval, review, certification or sign-off a human
   did not give. Never invent an AWS account id, ARN, region or resource name: if a test
   needs one, construct it obviously (123456789012) and say so.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. An OPTIONAL field a caller omits is
   invisible to \`tsc\`. Grep every construction site of any type you change and NAME the
   ones you checked in your result.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. One claimed the pilot's slug and deleted
   the seeded institution and all 26 of its clubs. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Sorting native paths, unsorted
   \`readdirSync\`, hashing raw CRLF bytes, and walking Playwright's \`error-context.md\`
   files each made a committed file "current here, stale in CI". Anything you generate
   must be byte-identical on Linux and Windows. Do NOT run \`npm run generate\` — the
   orchestrator runs it once at the end against a clean tree.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. Name the caller in your result.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm it passes. Report each mutation and both results verbatim.
- A stand-in that returns a canned value regardless of the code under test proves nothing.
  For AWS that means your fake MUST distinguish AccessDenied, a throttle, an
  empty-but-successful list AND a populated list, and the surface must say something
  DIFFERENT for each. A denied read rendering as "none" is a defect on its own.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact commands that would unblock it,
  is worth more than a false PASS.

HOUSE FACTS you will otherwise rediscover the expensive way:
- apps/system-studio must NOT import a Prisma client — \`tests/security/operator-plane-content.test.mjs\`
  asserts it. The Studio reads AWS and DynamoDB, never the tenant database.
- STUDIO-000-007 is enforced by a TYPE: \`AwsRead<T>\` in src/lib/aws/read.ts has NO arm
  carrying an optional \`T\`, so reaching \`.value\` on a DENIED result does not compile.
- \`call()\` in client.ts switches on the capability DELIBERATELY: there must remain no way
  to express "send this arbitrary command", no service/action/parameter endpoint, and no
  operator-supplied IAM JSON.
- Region and partition resolve from the resolved identity, NEVER a literal. A hardcoded
  us-east-1 caused GE-010-007, a data-residency defect.
- apps/web targets ES2017: the regex dotAll flag \`/…/s\` is a compile error; use \`[\\s\\S]*\`.
- New audit writes go through \`recordAuditEvent\`; ratchets (RAW_WRITE_CEILING=32,
  UNAUTHORIZED_MUTATORS, UNCLAIMED, SHARED.size, DATABASE_EXEMPT.size) may only FALL.
- The Studio Playwright suite has NO \`webServer\`: you start the server yourself.
  \`PLATFORM_OPERATORS\` is \`email:role\` — a bare address is REFUSED, not defaulted.
  \`AWS_ACCOUNT_ID\` and \`AWS_PARTITION\` must be set or the console refuses to boot.
- Verify your own file compiles: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`.
  Errors in OTHER agents' files are expected mid-flight — report only yours.
`

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    capabilities_added: { type: 'array', items: { type: 'string' } },
  },
}

phase('Ground')
log('Four foundations, disjoint file sets: capability rails, IAM grant, navigation, MD3 primitives')

const ground = await parallel([
  // ── 1. The rails ──────────────────────────────────────────────────────────
  () =>
    agent(
      `${RULES}

TASK — extend the AWS capability registry and the client layer so EVERY service the Tenure
estate actually provisions can be read. You are laying rails; ~22 other agents lay track on
them immediately after you and CANNOT add capabilities themselves. A capability you miss is
a service that stays dark.

YOU OWN, exclusively:
  apps/system-studio/src/lib/aws/capabilities.ts
  apps/system-studio/src/lib/aws/client.ts
  apps/system-studio/src/lib/aws/read.ts
  apps/system-studio/src/lib/aws/throttle.ts
  apps/system-studio/src/lib/aws/capabilities.test.ts
  apps/system-studio/package.json
  package-lock.json
Do NOT create per-service reader modules — other agents own every src/lib/aws/<service>.ts.
Do NOT edit infrastructure/studio/iam.tf — a sibling agent owns it and is reading YOUR
capability list to write the grant, so your capability entries must name their IAM actions
exactly and correctly.

THE MEASURED GAP. The registry declares 41 capabilities over 27 SDK packages. Terraform
provisions these resource types, and the ones marked (DARK) have NO reader at all:

  aws_cognito_user_pool / _client / _domain / _user            (DARK — this is the Studio's OWN auth)
  aws_vpc, aws_subnet, aws_security_group,
    aws_vpc_security_group_ingress_rule / _egress_rule,
    aws_route_table, aws_route_table_association,
    aws_internet_gateway                                        (DARK — an open 0.0.0.0/0 ingress is invisible today)
  aws_lb, aws_lb_listener, aws_lb_target_group                  (DARK — target health is THE liveness signal for ECS)
  aws_ecr_repository, aws_ecr_lifecycle_policy                  (DARK — image scan findings, and which tag is deployed)
  aws_elasticache_cluster / _parameter_group / _subnet_group    (DARK)
  aws_dynamodb_table                                            (DARK as a control-plane read: PITR, encryption, capacity, TTL)
  aws_cloudwatch_dashboard                                      (DARK)
  aws_s3_bucket + public_access_block / encryption /
    versioning / lifecycle / cors                               (only s3:ListObjectVersions today — the posture Terraform sets is never read back)
  aws_secretsmanager_secret                                     (only DescribeSecret — no ListSecrets, no rotation posture)
  aws_cloudwatch_metric_alarm                                   (alarms are described, but no metric is ever READ — cloudwatch:GetMetricData is missing)

Add capability entries for at least these, deriving the exact IAM action string for each
(verify against the AWS service-authorization reference; \`elasticloadbalancing:*\` and
\`cognito-idp:*\` are not spelled the way their SDK packages are):

  cognito-idp: ListUserPools, DescribeUserPool, ListUserPoolClients, DescribeUserPoolClient,
               DescribeUserPoolDomain, GetUserPoolMfaConfig, ListUsers
  ec2:         DescribeVpcs, DescribeSubnets, DescribeSecurityGroups, DescribeRouteTables,
               DescribeInternetGateways, DescribeNatGateways, DescribeVpcEndpoints,
               DescribeNetworkAcls
  elasticloadbalancing: DescribeLoadBalancers, DescribeListeners, DescribeTargetGroups,
               DescribeTargetHealth, DescribeRules
  ecr:         DescribeRepositories, DescribeImages, DescribeImageScanFindings,
               GetLifecyclePolicy
  elasticache: DescribeCacheClusters, DescribeReplicationGroups, DescribeCacheParameters
  dynamodb:    ListTables, DescribeTable, DescribeContinuousBackups, DescribeTimeToLive
  cloudwatch:  GetMetricData, ListDashboards, GetDashboard
  logs:        DescribeMetricFilters, FilterLogEvents
  s3:          ListAllMyBuckets, GetBucketPublicAccessBlock, GetBucketEncryption,
               GetBucketVersioning, GetBucketLifecycleConfiguration, GetBucketPolicyStatus,
               GetBucketTagging
  secretsmanager: ListSecrets
  kms:         DescribeKey, GetKeyRotationStatus
  cloudtrail:  GetTrailStatus, LookupEvents
  config:      DescribeConfigRules, DescribeComplianceByConfigRule
  route53:     ListResourceRecordSets
  cloudfront:  GetDistributionConfig, ListInvalidations
  rds:         DescribePendingMaintenanceActions, DescribeEvents, DescribeDBParameterGroups
  ecs:         DescribeClusters, ListTasks, DescribeTasks, DescribeTaskDefinition
  acm:         DescribeCertificate
  servicequotas: ListServiceQuotas, GetServiceQuota
  access-analyzer: ListAnalyzers, ListFindingsV2
  guardduty:   ListDetectors, ListFindings, GetFindings
  pricing:     ListPriceLists, GetProducts
  wafv2:       ListWebACLs, GetWebACLForResource

If your reading of the estate says one of these is not provisioned and never will be, say
so in your result and skip it — an honest omission with a reason beats a capability nobody
can exercise. If you find a provisioned service NOT on this list, add it: the list is the
floor, not the ceiling.

CADENCE MATTERS AND IS PART OF THE DESIGN. Each capability carries its OWN refresh cadence.
A queue depth and a certificate expiry do not move at the same speed, and one global TTL is
how a console both throttles the account and shows stale numbers. A target-health read is
seconds; a budget is hours; an IAM authorisation-detail dump is very expensive and must be
slow. Justify any cadence under 30s in a comment.

SDK PACKAGES. Add to apps/system-studio/package.json and then run
\`npm install --package-lock-only\` (NOT a full install — the tree is shared):
  @aws-sdk/client-cognito-identity-provider  @aws-sdk/client-ec2
  @aws-sdk/client-elastic-load-balancing-v2  @aws-sdk/client-ecr
  @aws-sdk/client-elasticache                @aws-sdk/client-service-quotas
  @aws-sdk/client-accessanalyzer             @aws-sdk/client-guardduty
  @aws-sdk/client-pricing                    @aws-sdk/client-wafv2
Pin them to the SAME major/minor line as the 27 already there (^3.11xx) so npm does not
resolve two copies of @aws-sdk/core. Add each client to client.ts as \`new XClient({})\` —
no credentials argument, no region literal, resolved through the default provider chain so
swapping the IAM keys needs no code change. NOTE: the Pricing API is only available in
us-east-1 and ap-south-1 and Health is us-east-1 (or the partition's global endpoint) —
that is a real regional constraint, not a residency violation; encode it explicitly with a
comment, do not silently hardcode a region for anything else.

PROVE IT — extend capabilities.test.ts so each of these reds when broken, and mutation-prove
each one, reporting the mutation and both results:
  · every declared capability names at least one IAM action, and the action's service prefix
    matches the client it dispatches to;
  · no capability names an action containing Create/Put/Delete/Update/Terminate/Send/Invoke
    — a write capability in a read-only console is the defect this test exists to stop;
  · \`call()\` cannot be reached with an unknown capability;
  · every capability has a cadence, and no two capabilities share a cadence CONSTANT by
    accident (equal numbers are fine; the same exported constant reused for unrelated
    services is the bug).

Report the full list of capability keys you added, exactly as another agent must spell them.`,
      { label: 'ground:capability-rails', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),

  // ── 2. The IAM grant ──────────────────────────────────────────────────────
  () =>
    agent(
      `${RULES}

TASK — grant the Studio's task role exactly the new reads the capability registry is about
to declare, and nothing wider.

YOU OWN, exclusively: infrastructure/studio/iam.tf and
tests/security/studio-task-role-is-narrow.test.mjs.
Do NOT edit capabilities.ts — a sibling agent is rewriting it RIGHT NOW to add roughly 60
new read capabilities across cognito-idp, ec2, elasticloadbalancing, ecr, elasticache,
dynamodb, cloudwatch, logs, s3, secretsmanager, kms, cloudtrail, config, route53,
cloudfront, rds, ecs, acm, servicequotas, access-analyzer, guardduty, pricing and wafv2.

BECAUSE YOUR SIBLING IS MID-WRITE: do not race it. Structure your work so the grant is
DERIVED, not transcribed — the durable answer here is that iam.tf and the registry cannot
disagree, and the guard test is what makes that true. Specifically:

  1. Read capabilities.ts to see the shape of a capability entry and its IAM action field.
  2. Write the grant in the existing SEPARATE \`estate-read\` policy so a partial grant shows
     up as a visible diff, keeping the existing structure and comments.
  3. Make \`tests/security/studio-task-role-is-narrow.test.mjs\` assert BOTH directions:
     every action in the policy is named by some capability (no wider than the code needs),
     AND every capability's action appears in the policy (no capability that will fail at
     runtime with AccessDenied nobody predicted). Today it only checks one direction.
  4. Assert no statement carries \`"Action": "*"\`, no service-level wildcard
     (\`s3:*\`, \`ec2:*\`), and no action matching
     Create|Put|Delete|Update|Terminate|Send|Invoke|Attach|Detach|Modify.
     A read-only console whose role can write is the whole risk here.
  5. Resource scoping: keep it as tight as each action allows. Several of these
     (ec2:Describe*, elasticloadbalancing:Describe*, cognito-idp:List*) do not support
     resource-level permissions and MUST be \`"*"\`; where that is true, say so in a comment
     citing that it is an AWS constraint, so a later reader does not "tighten" it into a
     broken policy. Where resource scoping IS supported (s3 bucket ARNs, secretsmanager,
     dynamodb tables, ecr repositories, kms keys), scope it.

If the registry is not finished when you need it, poll it — re-read the file rather than
guessing at names. Your test failing because a capability has no grant is the CORRECT
outcome to report if the sibling's list is still landing; say exactly which are missing.

PROVE IT: mutation-prove the guard in both directions — add a capability with no grant and
show the test reds; add a grant no capability names and show it reds. Report both.

Also run \`terraform fmt -check infrastructure/studio\` (via Docker if no local terraform:
\`docker run --rm -v "/c/Users/satvi/Tenure-Parent:/w" -w /w hashicorp/terraform:latest fmt -check -recursive infrastructure/studio\`)
and report the result. If Docker is unavailable, say BLOCKED_EXTERNAL with the exact command.`,
      { label: 'ground:iam-grant', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),

  // ── 3. The navigation the Bible defines ───────────────────────────────────
  () =>
    agent(
      `${RULES}

TASK — restructure the System Studio navigation so it stops reading as a construction site,
and put every unfinished or diagnostic surface behind ONE final tab.

YOU OWN, exclusively:
  apps/system-studio/src/components/Nav.tsx
  apps/system-studio/src/app/layout.tsx
  docs/architecture/studio-information-architecture.md
  apps/system-studio/src/app/platform/diagnostics/page.tsx   (NEW — create it)
Do NOT edit any other page.tsx — twelve route agents own those and are working right now.

THE OPERATOR'S WORDS, verbatim: the console "is cluttered and looks like a construction
site, all messed up and confusing … put all these mess in one last tab."

\`docs/architecture/studio-information-architecture.md\` ALREADY EXISTS on this branch — a
previous agent wrote the plan and stopped before implementing it. READ IT FIRST and
implement what it decided, rather than re-deciding. Where it is silent or wrong, fix it and
say what you changed and why. Let
\`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md\` decide the
group names and their order — the Bible names the domains this console is FOR; group the
navigation by those domains, in the order it presents them, naming each group the way it
names it. Not by your taste.

The routes that exist today:
  /                              the console index — what each configured system currently is
  /tenants                       the tenant fleet
  /tenants/new                   compose a tenant
  /tenants/[slug]                one tenant
  /tenants/[slug]/configuration  the priced configuration editor
  /platform                      the engine's own state
  /platform/cost                 what the fleet costs and for whom
  /platform/estate               the live AWS estate inventory
  /platform/health               alarms and fleet health
  /platform/security             findings and posture
  /platform/audit                the append-only audit ledger

THE ONE HARD REQUIREMENT: every surface that is unfinished, diagnostic, or exists only to
prove something to a developer moves behind the LAST tab, named as what it is
("Diagnostics"). Everything before that tab is a finished, Bible-defined operator surface.
Decide which side of the line each route falls on and JUSTIFY each in the document by
citing the requirement it serves, or by saying plainly that it serves none yet. DO NOT
DELETE A ROUTE — moving it behind the last tab is the whole mechanism.

Build /platform/diagnostics as a real index of what moved there and WHY, each entry linking
to the route and naming what is unfinished about it. It is not a dumping ground with no
explanation; an operator must be able to read it and know what is not ready.

CONSTRAINTS THAT WILL RED THE BUILD:
- \`tests/architecture/shell-separation.test.mjs\` asserts every nav destination is a route
  the console actually serves and that no tenant-side destination appears here. Nav and
  routes must stay in agreement — a group heading that is not a route must not be a link.
- \`apps/system-studio/e2e/layout.spec.ts\` runs every route at 1440, 1180, 900 AND 320px and
  asserts no text drawn over other text, nothing overflowing its container, and no sideways
  page scroll. The current flat row already had to learn to wrap; a grouped nav at 320px is
  harder, not easier. Test it.
- \`preferences.spec.ts\` asserts AA contrast in light, dark and high contrast, and NEITHER
  pure black NOR pure white. The pre-paint script in layout.tsx sets
  data-theme/density/motion/contrast and \`dir\` BEFORE hydration; \`documentAttributes\`
  returns \`dir: null\` meaning "leave the server default". \`preferences-logic.spec.ts\` pins
  that contract — do not break it.
- Consume the MD3 primitives in src/components/md3/ and its tokens in globals.css. A raw hex
  in Nav.tsx is a defect. A sibling agent is extending those primitives right now: import
  what exists, and if you need one that does not, say so in your result rather than forking it.

Deliver a Nav with real grouping, a clear current-section indicator, and Diagnostics last.
Report which routes you moved and the justification for each.`,
      { label: 'ground:information-architecture', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),

  // ── 4. The primitives every surface consumes ──────────────────────────────
  () =>
    agent(
      `${RULES}

TASK — finish the Material 3 layer so twelve route agents can adopt it without forking it.

YOU OWN, exclusively:
  apps/system-studio/src/app/globals.css
  everything under apps/system-studio/src/components/md3/
  docs/architecture/studio-design-system.md
  apps/system-studio/e2e/md3-tokens-logic.spec.ts
Do NOT edit any page.tsx, Nav.tsx, layout.tsx, or anything under apps/web.

WHAT EXISTS ALREADY on this branch, from a previous agent that stopped mid-flight: a token
ramp in globals.css and the primitives Surface, Card, Button, Chip, Badge, DataTable and
EmptyState under components/md3/. READ THEM FIRST. Your job is to finish and harden, not to
restart — and NOT to change the visual language a working route already depends on.

AUDIT the token layer against MD3 and close what is missing:
  · the full colour role set for BOTH light and dark — surface, surface-container
    (lowest/low/high/highest), on-surface, on-surface-variant, outline, outline-variant,
    error/on-error/error-container/on-error-container, plus complete primary, secondary and
    tertiary families with their containers and on-colours;
  · the type scale as tokens — display/headline/title/body/label at large/medium/small, each
    with size, line-height, weight and tracking;
  · elevation levels 0-5, shape tokens (corner none through extra-large and full), and the
    standard motion durations and easing curves;
  · a state-layer convention for hover/focus/pressed/dragged opacities, so a control's
    interaction states come from tokens rather than ad-hoc rgba().

THEN ADD THE PRIMITIVES THE ROUTES ARE ABOUT TO NEED and do not have. Twelve surfaces are
being rebuilt this hour to show live AWS reads, so at minimum:
  · a **KeyValue / DefinitionList** for "fact: value, as of T" rows — every AWS panel needs it;
  · an **UnknownState** — the visual form of a DENIED or throttled read, carrying the
    principal, the action, and a pasteable minimum IAM statement. This is the most important
    component in the system: STUDIO-000-007 says a denied read must NEVER render as an empty
    list, and a shared component is how twelve routes get that right at once;
  · a **StaleIndicator** — "as of" plus the capability's own cadence, visibly degraded when
    the value is older than its cadence allows;
  · **Tabs**, **Dialog**, **Snackbar**, **ProgressIndicator** (determinate and indeterminate),
    **TextField**, **Select**, **Switch** — MD3 forms, since the configurator and the compose
    form need them;
  · a **SeverityChip** whose tone comes from the MD3 error/tertiary families rather than a
    literal red or green.
Each must consume ONLY tokens — a raw hex in a component is a defect.

CONSTRAINTS THAT WILL RED THE BUILD:
- \`apps/system-studio/e2e/preferences.spec.ts\` asserts AA contrast in light, dark AND high
  contrast, and asserts NEITHER pure black NOR pure white is used anywhere. Every token pair
  you ship must clear WCAG AA against the surface it lands on — COMPUTE the ratio, do not
  eyeball it.
- Density is a real axis (comfortable/compact) and \`layout.spec.ts\` runs every route at
  1440, 1180, 900 AND 320px. Tokens and primitives must work at 320.
- \`table.grid\` is already \`display:block; overflow-x:auto\` and long AWS identifiers need
  \`overflow-wrap: anywhere\` — DataTable must keep both. A closed \`<details>\` still reports a
  bounding rect in Chrome, which is why \`details:not([open]) > *:not(summary)\` is
  display:none. Do not undo either.

PROVE IT: extend the contrast test so it FAILS when any token pair drops below AA, and
mutation-prove it by darkening one on-colour and showing it reds. Add a test that asserts no
component file under components/md3/ contains a literal colour (hex, rgb(, hsl(, or a named
CSS colour) and mutation-prove that too. Report both mutations and both results.

Update docs/architecture/studio-design-system.md to name every token group, what it is for,
each primitive and when to reach for it, and the rule that a component may not use a literal
colour.`,
      { label: 'ground:md3-primitives', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),
])

const landed = ground.filter(Boolean)
log(`Ground: ${landed.length}/4 foundations landed`)

return {
  program: 'aws-bridge-ground',
  landed: landed.length,
  foundations: landed.map((g) => ({
    summary: g.summary,
    decisions: g.decisions || [],
    files: g.files_changed || [],
    capabilities: g.capabilities_added || [],
  })),
}
