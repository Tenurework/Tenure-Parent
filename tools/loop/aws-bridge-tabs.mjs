export const meta = {
  name: 'aws-bridge-tabs',
  description:
    'One agent per existing Studio tab: lead with the answer, adopt Material 3, and render every live AWS read honestly — including what it was not allowed to see',
  whenToUse:
    'After aws-bridge-ground has landed the MD3 primitives and the navigation. Each agent owns exactly one route file and its own directory.',
  phases: [
    { title: 'Surface', detail: 'one agent per route, disjoint files' },
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
- READ-ONLY AWS. Do not add a code path that creates, updates, deletes, puts, sends or
  invokes. The reversible-mutation set in src/lib/aws/mutate.ts is the ONLY place mutations
  live and you are not extending it.

THE FIVE THINGS THAT SHIPPED BROKEN HERE. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`,
   \`if (false && !isPaymentMode(...))\`, \`|| true\`, a \`// MUTATION\` stub shipped in
   \`signin/page.tsx\`, and \`false && CREDENTIAL.test(write)\`. Each read GREEN. If you disable
   a check to iterate, restore it before you report, and say in your result that you did.

2. A FABRICATED APPROVAL. Never write an approval, review, certification or sign-off a human
   did not give. Never invent an AWS account id, ARN, region, price, date or resource name.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. Grep every construction site of any type
   you change and NAME the ones you checked in your result.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Do NOT run \`npm run generate\` — the
   orchestrator runs it once at the end against a clean tree. Do NOT run \`npm install\`.

NOTHING MOCK. NOTHING. This was stated with maximum emphasis by the product owner: every
number, list and state on screen comes from a real source — the registry, the ledger, the
AWS inventory, the catalogs. No sample tenants, no lorem, no illustrative figures, no
hard-coded example rows. If a surface has no data yet, it says so plainly and links to the
action that creates some. THREE FIXTURE ORGANISATIONS were rendering as customer tenants on
operator surfaces as recently as 2026-08-13: import \`CUSTOMER_TENANT_BINDINGS\`, never the
unfiltered \`TENANT_BINDINGS\`, on anything an operator sees.

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
  carrying an optional \`T\`, so reaching \`.value\` on a DENIED result does not compile. A
  denied read renders UNKNOWN with the principal, the action and a pasteable minimum IAM
  statement — NEVER as an empty list.
- The console must keep booting without AWS credentials. A page that 500s because STS is
  unreachable is not an acceptable refusal: render UNKNOWN and name the fix.
- \`AWS_ACCOUNT_ID\` and \`AWS_PARTITION\` must be set or the console refuses to boot,
  deliberately: it will not invent an estate. \`PLATFORM_OPERATORS\` is \`email:role\`.
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
    moved_to_diagnostics: { type: 'array', items: { type: 'string' } },
    readers_consumed: { type: 'array', items: { type: 'string' } },
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

/**
 * The eleven surfaces that already exist.
 *
 * `answer` is the single question an operator arrives at this page holding. It goes at
 * the top of the page, in words, before any apparatus — that instruction is the whole
 * difference between a console and the "construction site" the operator described.
 */
const ROUTES = [
  {
    key: 'home',
    file: 'apps/system-studio/src/app/page.tsx',
    answer: 'What systems are configured, and is each one where it should be?',
    detail: `The console index. It lists the configured systems from CUSTOMER_TENANT_BINDINGS —
NOT the unfiltered TENANT_BINDINGS, which carries three fixtures that rendered as customer
organisations until 2026-08-13. Lead with a one-line state of the fleet, then the systems.
Each system needs its current lifecycle state, its blueprint, its URL, and whether its live
AWS footprint agrees with what the registry says it should be. A system whose state cannot
be read must say so on its own row rather than being omitted from the count.`,
  },
  {
    key: 'tenants',
    file: 'apps/system-studio/src/app/tenants/page.tsx',
    answer: 'Which tenants exist, what state is each in, and which need me right now?',
    detail: `The tenant fleet table. Rank by what needs attention — a tenant stuck mid-provision
outranks a healthy one, and a healthy one does not need to be loud. The 25-state lifecycle in
packages/provisioning is the vocabulary; do not invent adjectives for it. The table must
scroll inside its own container at 320px, and long AWS identifiers need
\`overflow-wrap: anywhere\`. Use CUSTOMER_TENANT_BINDINGS. Show, per tenant, when its state was
last read and from where — the registry and the live estate are different sources and a row
that silently mixes them is unreadable.`,
  },
  {
    key: 'tenant-detail',
    file: 'apps/system-studio/src/app/tenants/[slug]/page.tsx',
    answer: 'What is this tenant, where is it, how did it get here, and what can happen next?',
    detail: `One tenant. Four questions in that order: what it is (blueprint, modules, seats),
where it is (its live AWS resources, by service, attributed by tag), how it got here (its
transitions through the 25-state machine with timestamps and who caused each), and what can
happen next (the transitions the state machine actually permits from here, with the
approval each requires). An action the state machine forbids must not be offered — and an
action that is permitted but gated must read as heavier than a routine one. The lifecycle
RECORDS that provisioning happened rather than executing it; say that plainly on the page
rather than implying the button provisions.`,
  },
  {
    key: 'tenant-new',
    file: 'apps/system-studio/src/app/tenants/new/page.tsx',
    answer: 'What am I about to create, and what will it cost?',
    detail: `Compose a tenant. THE STANDING PRODUCT REQUIREMENT APPLIES HERE MOST OF ALL: every
configuration option carries a price tag — per seat AND for the full organisation — with a
RUNNING TOTAL that updates as the operator configures, so the cost is known before the
decision, not after. Money is integer minor units with an explicit currency, never a float.
An option whose price cannot be resolved must say so and must NOT be silently priced at
zero. Note this file also references TENANT_BINDINGS in a comment about blueprint choice:
verify it uses the right binding set for what it renders and fix it if not.`,
  },
  {
    key: 'tenant-config',
    file: 'apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx',
    answer: 'What is this tenant configured to do, what does that cost, and what would changing it cost?',
    detail: `The configuration editor. Same pricing law as compose: a price on every option, per
seat and per organisation, with a running total — and here also the DELTA against what the
tenant is paying today, because an edit to a live tenant is a change to a bill. Group options
by the domain the Bible names rather than by schema shape. An option gated by a capability
the operator does not hold must be visible and disabled with the reason, not hidden.`,
  },
  {
    key: 'platform',
    file: 'apps/system-studio/src/app/platform/page.tsx',
    answer: 'Is the engine itself healthy, and what does it currently know?',
    detail: `The engine's own state — this is the console describing ITSELF, not a tenant. Its
build and version, the ledger's real progress, which AWS capabilities are granted and which
are denied, the identity it is running as, and the freshness of each read. The denied
capabilities list is the most valuable panel here: it is the console telling the operator
exactly what it cannot see and the IAM statement that would fix it. Ground every rendered
number in a committed artifact with a staleness check; never hand-enter one.`,
  },
  {
    key: 'cost',
    file: 'apps/system-studio/src/app/platform/cost/page.tsx',
    answer: 'What is this fleet costing, who is it costing it for, and is anything running away?',
    detail: `Cost. Lead with the number and its "as of", then attribution per tenant from the
resource tags, then the shared remainder that no tenant owns — and be explicit that shared is
shared rather than distributing it silently. Budgets and their forecast belong here, and a
budget with no subscriber notifies nobody, which reads exactly like a budget that is fine.
Money is integer minor units with an explicit currency. \`e2e/cost.spec.ts\` pins the approval
threshold bands and asserts each band starts where the last ended — keep that chain intact.`,
  },
  {
    key: 'estate',
    file: 'apps/system-studio/src/app/platform/estate/page.tsx',
    answer: 'What is actually running in this AWS account, and does it match what we declared?',
    detail: `The live estate inventory. Group by service, and for each resource show its tenant
attribution (or SHARED where no tag says otherwise), its region, and its "as of". The whole
point of this page after this programme is COVERAGE: it must be able to say which services
the engine can see and which it cannot, so a service with no reader is visible as a gap
rather than absent. A resource that Terraform declares but the estate does not have, and one
the estate has that Terraform never declared, are both drift and belong here — the second is
the more dangerous.`,
  },
  {
    key: 'health',
    file: 'apps/system-studio/src/app/platform/health/page.tsx',
    answer: 'Is anything broken right now, and is it us or is it AWS?',
    detail: `Fleet health. Lead with a verdict in words. Alarms in ALARM outrank everything; an
alarm with its actions DISABLED outranks OK, because it is an alarm that will never tell
anyone. AWS Health events answer "is it us or AWS" and belong at the top when any are open.
Where a metric reader is available, show the trend behind an alarm rather than just its
state — an OK that is about to end is the thing an operator wants ten minutes early. A gap in
a metric is not a zero.`,
  },
  {
    key: 'security',
    file: 'apps/system-studio/src/app/platform/security/page.tsx',
    answer: 'What in this estate is exposed, unencrypted, unrotated or unwatched?',
    detail: `Security posture. The hardest rule on this page: an ABSENCE OF FINDINGS FROM A
DISABLED CONTROL IS NOT A PASS. A disabled GuardDuty detector, an account with no Access
Analyzer, a repository with scanOnPush off, a Config rule with INSUFFICIENT_DATA — each must
render as "not being checked", visually distinct from "checked and clean". That distinction
is the entire value of this page and it is the easiest thing in this programme to get wrong.
Rank by severity, name each finding's type verbatim, and give each a remedy.`,
  },
  {
    key: 'audit',
    file: 'apps/system-studio/src/app/platform/audit/page.tsx',
    answer: 'Who did what, when, and can I prove the record has not been altered?',
    detail: `The append-only audit ledger. Lead with the chain verification result — the point of
a hash chain is that it can be checked, and a page that shows entries without verifying them
is a list, not a ledger. Then the entries, newest first, each naming the actor, the action,
the target and the outcome. A gap or a broken link in the chain is the most important thing
this page can ever say and must be impossible to miss. Filtering must never be able to hide a
break: if a filter is active, say what it excluded.`,
  },
]

phase('Surface')
log(`${ROUTES.length} operator surfaces, one agent and one route file each`)

const built = await pipeline(
  ROUTES,

  (item) =>
    agent(
      `${RULES}

TASK — bring ONE System Studio surface up to the standard the operator asked for:
${item.file}

THE QUESTION THIS PAGE ANSWERS, and it goes at the top in words before any apparatus:
  "${item.answer}"

${item.detail}

YOU OWN, exclusively: ${item.file}, plus any component or module you create in a directory
named for this route (its own \`.module.css\`, its own helpers, its own \`.test\`). You may also
add or update the Playwright spec that covers THIS route only.

YOU MAY NOT EDIT: globals.css, anything under src/components/md3/, Nav.tsx, layout.tsx, any
other route, or anything under src/lib/aws/. A foundation agent owns the token layer and the
navigation; ten sibling route agents and twenty-four AWS reader agents are working beside you
right now. CONSUME what they export; do not fork it.

WHAT "Material 3" MEANS HERE. The token layer and the primitives live in
src/components/md3/ — Surface, Card, Button, Chip, Badge, DataTable, EmptyState, and a set
being extended right now that should include KeyValue, UnknownState, StaleIndicator, Tabs,
Dialog, Snackbar, ProgressIndicator, TextField, Select, Switch and SeverityChip. READ THE
DIRECTORY before you start and use what is there. Delete the ad-hoc class strings and literal
colours this page has accumulated — a raw hex in a product module is a defect. Use the MD3
type scale rather than hand-set sizes, elevation tokens rather than hand-rolled shadows, and
the state-layer convention for hover/focus/pressed. If a primitive you need does not exist,
say so in your result — do not fork one.

WHAT "structure" MEANS HERE, and it matters more than the styling:
  · lead with the ANSWER, not the apparatus;
  · group related facts into Cards with real headings, not one flat wall of rows;
  · every panel states what it is AS OF, and says plainly when it does not know something;
  · a denied or throttled read renders through the shared UnknownState — never as an empty
    list, never as a zero, never as a reassuring default;
  · anything on this page that is diagnostic, half-built, or exists to prove something to a
    developer does NOT belong here. Name it in \`moved_to_diagnostics\` so the navigation agent
    can move it behind the final Diagnostics tab. DO NOT MOVE IT YOURSELF.

NEW AWS READERS ARE LANDING BESIDE YOU. Twenty-four agents are wiring cognito, network,
loadbalancer, ecr, elasticache, dynamodb-tables, metrics, logs, buckets, secrets, keys,
trail, compliance, dns, cdn, database, containers, certificates, quotas, analyzer,
guardduty, pricing, waf and dashboards, plus ses, sqs, lambda, iam, budgets, aws-health and
eventbridge which already exist. Consume the ones this page's question needs, IF the module
exists when you read the directory. If one you want is not there yet, build the page so it
composes cleanly when it arrives and say in \`readers_consumed\` which you used and which you
wanted but could not find. Do not stub a reader.

CONSTRAINTS THAT WILL RED THE BUILD:
- \`e2e/layout.spec.ts\` runs this route at 1440, 1180, 900 AND 320px and asserts: no text
  drawn over other text, nothing overflowing its container, and no sideways page scroll.
  Wide tables scroll inside their own container — \`table.grid\` is already
  \`display:block; overflow-x:auto\` — and long AWS identifiers need \`overflow-wrap: anywhere\`.
- A closed \`<details>\` still reports a bounding rect in Chrome even though it does not paint,
  so its contents overlap whatever follows. \`details:not([open]) > *:not(summary)\` is
  display:none for this reason — do not undo it.
- \`e2e/preferences.spec.ts\` asserts AA contrast in light, dark and high contrast, and NO pure
  black or white anywhere.
- Keep every existing e2e assertion green. If one pins copy you are deliberately changing,
  update the spec and JUSTIFY it in your result — do not weaken it.

PROVE IT: run the Studio Playwright specs that touch this route and report the counts. The
suite has no webServer, so you must start the server yourself; extract the env from CI rather
than typing it:
  sed -n '/name: Studio · Playwright/,/steps:/p' .github/workflows/ci.yml | grep -E "^      [A-Z_]+:"
If you genuinely cannot run the browser suite in this environment, say so plainly, and
instead mutation-prove the page's LOGIC through its own unit-testable module — extract the
decision into a pure function beside the page and test that. Do not claim a run you did not do.`,
      { label: `tab:${item.key}`, phase: 'Surface', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  (out, item) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { item, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven on the surface ${item.file}. Default refuted=true for each; set false ONLY for the
ones you have verified YOURSELF, with your own hands, this run.

${claimed
  .map(
    (r) =>
      `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ') || '(none reported)'}

For EACH claim, in order:
  1. Is it reachable from the rendered route? Trace it. A component nothing renders fails.
  2. RE-RUN THE MUTATION yourself — apply, run, OBSERVE the failure, restore, confirm green.
  3. IS ANYTHING ON THIS PAGE MOCK? This is the highest-value check on a surface. Hunt for
     a hard-coded row, an illustrative figure, a sample tenant, a placeholder count, a number
     that is not traceable to the registry / ledger / AWS inventory / catalogs. Trace at
     least three rendered values back to their source and name the source for each. An
     untraceable number refutes the claim it belongs to.
  4. Does the page import \`TENANT_BINDINGS\` where it should import \`CUSTOMER_TENANT_BINDINGS\`?
     Three fixtures rendered as customer organisations here as recently as 2026-08-13.
  5. Can a DENIED or throttled AWS read render as an empty list, a zero, or a reassuring
     default anywhere on this page? Follow each read to its render site. If yes, refute.
  6. Does the page still boot with no AWS credentials, or does it 500? Check the error path.
  7. Does any new comment, string or copy claim something untrue?
  8. Was a guard weakened, a ratchet loosened, or an e2e assertion deleted or weakened to get
     green? \`git diff\` the spec files and read every deletion.

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
      route: r.item.key,
      file: r.item.file,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy:
        res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${confirmed.length} confirmed of ${rows.length} attempted across ${built.filter(Boolean).length} surfaces`)

return {
  program: 'aws-bridge-tabs',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
  diagnosticsCandidates: built
    .filter(Boolean)
    .flatMap((r) => (r.out?.moved_to_diagnostics || []).map((d) => ({ route: r.item.key, item: d }))),
  readersWanted: built
    .filter(Boolean)
    .map((r) => ({ route: r.item.key, readers: r.out?.readers_consumed || [] })),
}
