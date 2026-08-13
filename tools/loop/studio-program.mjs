export const meta = {
  name: 'tenure-studio-program',
  description:
    'Three critical tracks at once: finish the AWS wiring, restructure the Studio IA per the Bible, and adopt Material 3 across every operator surface',
  whenToUse:
    'The Tenure Global Deployment Engine needs its AWS reads completed and its console made legible, in one coordinated pass',
  phases: [
    { title: 'Ground', detail: 'MD3 foundation, IA plan from the Bible, and the AWS capability registry — everything else depends on these three' },
    { title: 'Build', detail: 'one agent per AWS service and per Studio route, each owning a disjoint file set' },
    { title: 'Verify', detail: 'adversarial refuters that re-run the mutations themselves' },
  ],
}

const D = (() => {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      return JSON.parse(args)
    } catch {
      return {}
    }
  }
  return args
})()

const LEDGER = D.ledger || 'docs/implementation/system-studio-aws-control-plane-execution-ledger.md'

/**
 * Shared law. Every agent gets this verbatim.
 *
 * It is long because every clause in it was bought: each one names a defect that
 * actually shipped in this repository in the last week, and the cheapest place
 * to spend those words is before the work rather than in the repair afterwards.
 */
const RULES = `
You are building the Tenure platform in C:/Users/satvi/Tenure-Parent (branch main).

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure (remote "live").
  It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, or rewrite history. The orchestrator does that.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or money movement.
- Never treat an AI, agent, operator or test result as human approval.

THE FIVE THINGS THAT SHIPPED BROKEN LAST WEEK. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`
   around the destructive-AWS-mutation gate, \`if (false && !isPaymentMode(...))\` around
   money-mode validation, \`|| true\` making a loop skip every key, a \`// MUTATION\` stub
   shipped in production so a broken connection was offered with no reason, and
   \`false && CREDENTIAL.test(write)\` making a credential sweep return empty for every
   file. Each read GREEN. If you disable a check to iterate, restore it before you
   report, and say in your result that you did.

2. A FABRICATED APPROVAL. An agent set a provider review to APPROVED with invented
   verification dates, in a file whose own comment argued that state was the only
   untrue one. Never write an approval, a review, a certification or a sign-off that
   a human did not give.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. An OPTIONAL field a caller omits is
   invisible to \`tsc\`. Grep every construction site of any type you change and NAME
   the ones you checked in your result.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. One claimed the pilot's slug and
   deleted the seeded institution and all 26 of its clubs, reddening two unrelated
   suites with a message naming a migration. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Sorting native paths, unsorted
   \`readdirSync\`, hashing raw CRLF bytes, and walking Playwright's \`error-context.md\`
   files each made a committed file "current here, stale in CI". Anything you generate
   must be byte-identical on Linux and Windows.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. Name the caller in your result.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT
  FAILS, restore, confirm it passes. Report each mutation and both results.
- A stand-in that returns a canned value regardless of the code under test proves
  nothing. For AWS, that means your fake must be able to return AccessDenied, a
  throttle, an empty-but-successful list AND a populated list, and the surface must
  say something DIFFERENT for each.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact commands that would unblock
  it, is worth more than a false PASS.

HOUSE FACTS you will otherwise rediscover:
- apps/system-studio must NOT import a Prisma client — \`tests/security/operator-plane-content.test.mjs\`
  asserts it. The Studio reads AWS and DynamoDB, never the tenant database.
- A new workspace package must reach package-lock.json (\`npm install --package-lock-only\`)
  or \`npm ci\` kills every CI job on its first step.
- apps/web targets ES2017: the regex dotAll flag \`/…/s\` is a compile error; use \`[\\s\\S]*\`.
- New audit writes go through \`recordAuditEvent\`; the raw \`db.auditEvent.create\` ratchet
  is 32 and may only FALL.
- \`npm run test:isolation\` (208 tests) is a real check and is easy to miss.
- The Studio Playwright suite has NO \`webServer\`: you start the server yourself, and the
  operator env must reach BOTH the server and the Playwright process.
  \`PLATFORM_OPERATORS\` is \`email:role\` — a bare address is refused, not defaulted.
  \`AWS_ACCOUNT_ID\` and \`AWS_PARTITION\` must be set or the console refuses to boot,
  deliberately: it will not invent an estate.
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

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
  },
}

// ── Phase 1: the three things everything else depends on ────────────────────
//
// Run first and together, because a page cannot adopt a token layer that does
// not exist and an AWS service cannot register a capability the registry has no
// shape for. Their file sets are disjoint from each other.

phase('Ground')
log('Foundation: Material 3 layer, information architecture, AWS capability registry')

const ground = await parallel([
  () =>
    agent(
      `${RULES}

TASK — the Material 3 foundation for the System Studio, and NOTHING else.

YOU OWN, exclusively: apps/system-studio/src/app/globals.css, and any new files you
create under apps/system-studio/src/components/md3/. Do not edit any page.tsx, any
route, or anything under apps/web. Other agents are editing those right now.

\`globals.css\` already declares an \`--md-sys-color-*\` ramp that Codex scaffolded. It is
a start and it is not a system. Finish it:

  · the full MD3 colour role set for BOTH light and dark, as tokens — surface,
    surface-container (lowest/low/high/highest), on-surface, on-surface-variant,
    outline, outline-variant, error/on-error/error-container, plus the primary,
    secondary and tertiary families that are already partly there;
  · the MD3 type scale as tokens — display/headline/title/body/label, each with its
    size, line-height, weight and tracking;
  · elevation levels 0-5 as tokens, MD3 shape tokens (corner none -> extra-large),
    and the standard motion durations and easing curves;
  · a state-layer convention for hover/focus/pressed opacities, so a control's
    interaction states come from tokens rather than from ad-hoc rgba().

Then build the small set of primitives every Studio surface needs, under
components/md3/: Surface (an elevation + container-colour wrapper), Card, Button
(filled/tonal/outlined/text), Chip/Badge, DataTable shell, and an EmptyState. Each
must consume ONLY tokens — a raw hex in a component is a defect.

CONSTRAINTS THAT WILL RED THE BUILD:
- \`apps/system-studio/e2e/preferences.spec.ts\` asserts AA contrast in light, dark and
  high-contrast, and asserts NEITHER pure black NOR pure white is used. Every token pair
  you ship must clear WCAG AA against the surface it lands on. Compute it, do not eyeball it.
- The pre-paint script in \`src/app/layout.tsx\` sets data-theme/density/motion/contrast and
  \`dir\` BEFORE hydration; \`documentAttributes\` returns \`dir: null\` meaning "leave the
  server default". Do not break that contract — \`preferences-logic.spec.ts\` pins it.
- Density is a real axis here (comfortable/compact) and \`layout.spec.ts\` runs every route
  at 1440, 1180, 900 AND 320px. Tokens must work at 320.

PROVE IT: extend the contrast test so it fails when any token pair drops below AA, and
mutation-prove that by darkening one on-colour and showing it reds. Report the pair you
mutated and both results.

Write a short note to docs/architecture/studio-design-system.md naming every token
group, what it is for, and the rule that a component may not use a literal colour.`,
      { label: 'ground:md3-foundation', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),

  () =>
    agent(
      `${RULES}

TASK — decide the System Studio's information architecture from the Bible, and write it
down. This is a PLANNING task: you produce a document and the navigation, not a redesign
of every page.

YOU OWN, exclusively: docs/architecture/studio-information-architecture.md (new),
apps/system-studio/src/components/Nav.tsx, and apps/system-studio/src/app/layout.tsx.
Do not edit any page.tsx — other agents own those.

THE PROBLEM, in the operator's words: the console "is cluttered and looks like a
construction site, all messed up and confusing". Today it is eleven routes behind seven
flat tabs — Tenants, Systems, Platform, Cost, Audit, Estate, Health, Security — with no
grouping, no hierarchy, and finished surfaces sitting beside half-built ones.

READ FIRST, and let it decide the structure rather than your taste:
  Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md
  docs/implementation/system-studio-aws-control-plane-execution-ledger.md
The Bible names the domains this console is FOR. Group the navigation by those domains,
in the order the Bible presents them, and name each group the way the Bible names it.

THE ONE HARD REQUIREMENT: every surface that is unfinished, diagnostic, or exists only to
prove something to a developer moves behind ONE final tab — the last one — clearly named
as what it is (e.g. "Diagnostics"). Everything before that tab must be a finished,
Bible-defined operator surface. Decide which side of that line each of the eleven routes
falls on, and JUSTIFY each in the document by citing the requirement it serves or by
saying plainly that it serves none yet.

Do not delete a route. Moving it behind the last tab is the whole mechanism.

CONSTRAINTS: \`tests/architecture/shell-separation.test.mjs\` asserts every nav destination
is a route the console actually serves and that no tenant-side destination appears here —
so the nav and the routes must stay in agreement. \`layout.spec.ts\` runs the nav at 320px,
where the current flat row already had to learn to wrap.

Deliver: the document, and a Nav that implements it with real grouping and a clear
current-section indicator. Report which routes you put behind the last tab and why.`,
      { label: 'ground:information-architecture', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),

  () =>
    agent(
      `${RULES}

TASK — extend the AWS capability registry so the seven missing services can be read, and
nothing else. You are laying the rails; other agents lay the track.

YOU OWN, exclusively: apps/system-studio/src/lib/aws/capabilities.ts,
apps/system-studio/src/lib/aws/client.ts, apps/system-studio/src/lib/aws/read.ts,
apps/system-studio/src/lib/aws/throttle.ts, and infrastructure/studio/iam.tf.
Do NOT create the per-service reader modules — seven other agents own those.

THE GAP, measured: twenty AWS SDK clients are wired. SES, SQS, Lambda, IAM, Budgets,
AWS Health and EventBridge are NOT — and Terraform PROVISIONS SES and SQS, so the engine
creates resources it cannot see. That is the "AWS wiring is not fully complete" the
operator means.

For each of the seven, add its capability entry: the exact IAM actions it needs, the
resource pattern, and its OWN refresh cadence (a queue depth and a certificate expiry do
not move at the same speed, and one global TTL is how a console both throttles the account
and shows stale numbers). Add each client to \`client.ts\` — \`new XClient({})\`, no
credentials argument, no region literal, resolved through the default provider chain so
swapping the IAM keys needs no code change.

\`call()\` switches on the capability, deliberately: there must remain NO way to express
"send this arbitrary command", no service/action/parameter endpoint, and no operator-
supplied IAM JSON.

Grant the new reads in \`infrastructure/studio/iam.tf\` in the existing separate
\`estate-read\` policy, so a partial grant shows up as a visible diff.

STUDIO-000-007 IS THE LAW HERE and it is already enforced by a type: \`AwsRead<T>\` has NO
arm carrying an optional \`T\`, so reaching for \`.value\` on a DENIED result does not
compile. Keep it that way. A denied call renders UNKNOWN with the principal, the action
and a pasteable minimum IAM statement — never an empty list.

Add the seven new packages to package.json AND run \`npm install --package-lock-only\`, or
every CI job dies on its first step.

PROVE IT: a test that every declared capability names at least one IAM action, that no two
capabilities share a cadence by accident, and that \`call()\` cannot be reached with an
unknown capability. Mutation-prove each.`,
      { label: 'ground:aws-capability-registry', phase: 'Ground', schema: PLAN_SCHEMA, effort: 'high' },
    ),
])

log(`Ground complete: ${ground.filter(Boolean).length}/3 foundations landed`)

// ── Phase 2: the fan-out ────────────────────────────────────────────────────
//
// Two families, run as one pipeline so a service that finishes early is being
// refuted while a slower route is still being written.

const AWS_SERVICES = [
  {
    key: 'ses',
    module: 'apps/system-studio/src/lib/aws/ses.ts',
    what: 'SES — verified identities, the configuration set, the sending quota and the 24-hour send rate, plus the account-level suppression list and whether the account is still in the sandbox. Terraform provisions SES (infrastructure/terraform/ses.tf) and nothing reads it back, so nobody can see that the pilot cannot mail a domain it has not verified. Sandbox state is the single most valuable fact here: it silently limits who can be emailed.',
  },
  {
    key: 'sqs',
    module: 'apps/system-studio/src/lib/aws/sqs.ts',
    what: 'SQS — every queue the estate owns, its ApproximateNumberOfMessages, ApproximateNumberOfMessagesNotVisible, the age of the oldest message, and its redrive policy. A dead-letter queue with anything in it is a delivery that failed and nobody was told; surface that as its own state rather than a number in a table.',
  },
  {
    key: 'lambda',
    module: 'apps/system-studio/src/lib/aws/lambda.ts',
    what: 'Lambda — functions, their runtime, last-modified, memory, timeout, reserved concurrency, and whether the runtime is deprecated or approaching deprecation. A function on a runtime AWS has already end-of-lifed is a scheduled outage, and it is invisible today.',
  },
  {
    key: 'iam',
    module: 'apps/system-studio/src/lib/aws/iam.ts',
    what: 'IAM posture — roles the estate uses, their attached policies, whether any policy carries a wildcard action or resource, and long-lived access keys with their age. STUDIO-000-009 asks for exactly this: console-created and unmanaged resources, long-lived keys, wildcard policies. Read only; never create, attach, detach or delete.',
  },
  {
    key: 'budgets',
    module: 'apps/system-studio/src/lib/aws/budgets.ts',
    what: 'Budgets — every budget, its limit, actual and forecasted spend, and its alert thresholds and whether they are wired to a real subscriber. A budget with no subscriber notifies nobody, which reads exactly like a budget that is fine. Money is integer minor units through packages/finops, explicit currency, never a float.',
  },
  {
    key: 'health',
    module: 'apps/system-studio/src/lib/aws/aws-health.ts',
    what: 'AWS Health — open and upcoming events affecting this account, their services, regions, start times and affected entities. This is how the console answers "is it us or is it AWS", which is the first question of every incident. Note the Health API needs a Business/Enterprise support plan: if the call returns SubscriptionRequiredException, that is a real UNKNOWN with a named remedy, not an empty list.',
  },
  {
    key: 'eventbridge',
    module: 'apps/system-studio/src/lib/aws/eventbridge.ts',
    what: 'EventBridge — rules, their schedule or pattern, whether each is ENABLED, and their targets. A DISABLED scheduled rule is a job that silently stopped running, which is the same shape of defect as an alarm with its actions switched off — and that one outranks OK in alarms.ts for exactly this reason. Follow that precedent.',
  },
]

const STUDIO_ROUTES = [
  { key: 'home', dir: 'apps/system-studio/src/app/page.tsx', what: 'the console index — what each configured system currently is' },
  { key: 'tenants', dir: 'apps/system-studio/src/app/tenants/page.tsx', what: 'the tenant fleet table' },
  { key: 'tenant-detail', dir: 'apps/system-studio/src/app/tenants/[slug]/page.tsx', what: 'one tenant: what it is, where it is, how it got there, what can happen next' },
  { key: 'tenant-new', dir: 'apps/system-studio/src/app/tenants/new/page.tsx', what: 'compose a tenant' },
  { key: 'tenant-config', dir: 'apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx', what: 'the tenant configuration editor and its priced running total' },
  { key: 'platform', dir: 'apps/system-studio/src/app/platform/page.tsx', what: "the engine's own state" },
  { key: 'cost', dir: 'apps/system-studio/src/app/platform/cost/page.tsx', what: 'what the fleet costs and who it costs it for' },
  { key: 'estate', dir: 'apps/system-studio/src/app/platform/estate/page.tsx', what: 'the live AWS estate inventory' },
  { key: 'health', dir: 'apps/system-studio/src/app/platform/health/page.tsx', what: 'alarms and fleet health' },
  { key: 'security', dir: 'apps/system-studio/src/app/platform/security/page.tsx', what: 'security findings and posture' },
  { key: 'audit', dir: 'apps/system-studio/src/app/platform/audit/page.tsx', what: 'the append-only audit ledger' },
]

phase('Build')
log(`Fan-out: ${AWS_SERVICES.length} AWS services + ${STUDIO_ROUTES.length} Studio surfaces, disjoint file sets`)

const work = [
  ...AWS_SERVICES.map((s) => ({ kind: 'aws', ...s })),
  ...STUDIO_ROUTES.map((r) => ({ kind: 'route', ...r })),
]

const built = await pipeline(
  work,
  (item) =>
    item.kind === 'aws'
      ? agent(
          `${RULES}

TASK — wire ${item.key.toUpperCase()} into the Tenure Global Deployment Engine's live AWS reads.

YOU OWN, exclusively: ${item.module} and a test beside it. You may also append your
requirement entries to ${LEDGER}. You may NOT edit capabilities.ts, client.ts, read.ts,
throttle.ts or iam.tf — a foundation agent has just extended those and six other service
agents are working beside you. If the capability you need is missing from the registry,
return FAIL naming it rather than adding it yourself.

WHAT TO READ: ${item.what}

HOW IT MUST BEHAVE — this is the part that matters more than the data:
- Return the \`AwsRead<T>\` union from read.ts. A denied call is UNKNOWN carrying the
  principal, the action and a pasteable minimum IAM statement. It is NEVER an empty list.
  An operator reading "no queues" when the truth is "we were not allowed to look" is the
  single most dangerous thing this surface can do.
- A throttle is its own state, not a failure and not an empty result. Use throttle.ts.
- Resolve region and partition from the resolved identity, never a literal. A hardcoded
  us-east-1 is what caused GE-010-007, a data-residency defect.
- Attribute every resource to a tenant where a tag says so, and mark it shared where none
  does. Use the Resource Groups Tagging API path that already exists in tags.ts.
- Carry an explicit "as of" timestamp and your capability's own refresh cadence.

PROVE IT with a fake that behaves like the real client across FOUR cases — AccessDenied,
a throttle, an empty-but-successful list, and a populated list — and assert the surface
says something DIFFERENT for each. A fake returning [] regardless is the fake test this
programme has already been burned by. Mutate the production path, not the helper.

Do not render anything. A route agent will consume what you export; your job is that the
data is real, honest about what it does not know, and typed so a caller cannot ignore that.`,
          { label: `aws:${item.key}`, phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
        )
      : agent(
          `${RULES}

TASK — bring ONE System Studio surface up to Material 3 and to the structure the Bible
defines: ${item.dir} — ${item.what}.

YOU OWN, exclusively: ${item.dir}, plus any component you create in a directory named for
this route. You may NOT edit globals.css, components/md3/*, Nav.tsx, layout.tsx, or any
other route — a foundation agent owns the token layer and the navigation, and ten other
route agents are working beside you right now. Consume the MD3 primitives; do not fork them.

WHAT "up to Material 3" MEANS HERE. The token layer and the primitives (Surface, Card,
Button, Chip, DataTable, EmptyState) exist under components/md3/. Adopt them. Delete the
ad-hoc class strings and literal colours this page has accumulated — a raw hex in a
product module is a defect the lint already catches. Use the MD3 type scale rather than
hand-set sizes, elevation tokens rather than hand-rolled shadows, and the state-layer
convention for hover/focus/pressed.

WHAT "structure" MEANS HERE, and it matters more than the styling. The operator says this
console "looks like a construction site". For this page specifically:
  · lead with the answer, not the apparatus — the fact an operator came for goes at the top;
  · group related facts into Cards with real headings, rather than one flat wall of rows;
  · every panel states what it is AS OF, and says plainly when it does not know something;
  · anything on this page that is diagnostic, half-built, or exists to prove something to a
    developer does NOT belong here — say so in your result and name it, so the IA agent can
    move it behind the final Diagnostics tab. Do not move it yourself.

CONSTRAINTS THAT WILL RED THE BUILD:
- \`layout.spec.ts\` runs this route at 1440, 1180, 900 AND 320px and asserts: no text drawn
  over other text, nothing overflowing its container, and no sideways page scroll. Wide
  tables scroll inside their own container — \`table.grid\` is already
  \`display:block; overflow-x:auto\`, and long AWS identifiers need \`overflow-wrap: anywhere\`.
- A closed \`<details>\` still reports a bounding rect in Chrome even though it does not
  paint, so its contents overlap whatever follows. \`details:not([open]) > *:not(summary)\`
  is display:none for this reason — do not undo it.
- \`preferences.spec.ts\` asserts AA contrast in light, dark and high contrast, and no pure
  black or white anywhere.
- The console must keep booting without AWS credentials: a page that 500s because STS is
  unreachable is not an acceptable refusal. Render UNKNOWN, name the fix.
- Keep every existing e2e assertion green. If one pins copy you are deliberately changing,
  update the spec and JUSTIFY it in your result — do not weaken it.

PROVE IT: run the Studio Playwright specs that touch this route and report the counts.`,
          { label: `route:${item.key}`, phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
        ),

  (out, item) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { item, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven in ${item.kind === 'aws' ? item.module : item.dir}. Default refuted=true for each;
set false ONLY for the ones you have verified yourself.

${claimed.map((r) => `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation: ${r.mutation_proof}`).join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ')}

For EACH claim, in order:
  1. Is it reachable from a real production call path? Trace it. Dead code fails.
  2. RE-RUN THE MUTATION yourself — apply, run, observe, restore. Do not take their word.
  3. Is any stand-in canned — returning the same thing regardless of the code under test?
     For an AWS reader, specifically: does the fake actually distinguish AccessDenied from
     an empty successful list, and does the surface SAY something different for each? If a
     denied read can render as "none", that is a refutation on its own.
  4. Does any new comment, string or ledger entry claim something untrue?
  5. Was a guard weakened, a ratchet loosened, an assertion deleted, or a check left
     disabled behind \`false &&\` / \`|| true\` to get green?

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you did.`,
      { label: `refute:${item.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ item, out, verdicts: v }))
  },
)

// ── Report ──────────────────────────────────────────────────────────────────

const rows = []
for (const r of built.filter(Boolean)) {
  const verdictFor = new Map((r.verdicts?.verdicts || []).map((v) => [v.id, v]))
  for (const res of r.out?.results || []) {
    const v = verdictFor.get(res.id)
    rows.push({
      id: res.id,
      area: r.item.kind === 'aws' ? r.item.module : r.item.dir,
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
log(`${confirmed.length} confirmed of ${rows.length} attempted across ${built.filter(Boolean).length} areas`)

return {
  program: 'studio',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
  ground: ground.filter(Boolean).map((g) => g.summary),
}
