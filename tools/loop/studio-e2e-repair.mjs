export const meta = {
  name: 'studio-e2e-repair',
  description:
    'Turn the Studio Playwright suite green again after the AWS-bridge rewrite: one agent per failing spec, each reading its own failure out of the CI log',
  whenToUse:
    'CI run 31775014951 left `Studio · Playwright` red with ~26 distinct failures across 11 specs. Red main is the only work until it is green.',
  phases: [{ title: 'Repair', detail: 'one agent per failing spec, disjoint source ownership' }],
}

const RULES = `
You are repairing the Tenure platform in C:/Users/satvi/Tenure-Parent, on branch "main".
Up to ten other agents are working in this tree right now: touch ONLY the files named as
yours below.

WHY YOU EXIST. The push \`6dfc541..5561de0\` turned CI red. \`Lint · Type Check · Test · Build\`
and \`Studio · Playwright\` both failed; the unit-test half is already fixed. Yours is the
browser half. A red main is the only work in this repository until it is green, so this is
not an improvement task — it is a repair, and the smallest correct change wins.

READ YOUR OWN FAILURE FIRST. Do not guess from the spec source:

    gh run view --job 94688542895 --log-failed 2>&1 | grep -B 5 -A 30 "<your spec file name>"

That is the real run, with the real assertion messages, on the real environment. If the
output is truncated or the grep misses, widen it — but do not start editing before you have
read what actually failed.

NON-NEGOTIABLE SECURITY CONSTRAINTS:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, git checkout or rewrite history. Do not
  run \`git add -A\`. The orchestrator does that.
- Do NOT remove or weaken the production-disarming guards in .github/workflows/**.
- Do not read, print, copy or rotate secret VALUES.
- Never treat an AI, agent, operator or test result as human approval.

THE RULE THAT DECIDES EVERY CHOICE YOU MAKE HERE. A spec is an oracle. When a spec and the
code disagree, the DEFAULT is that the code is wrong. You may change a spec only when the
behaviour it pins was deliberately and correctly changed by the AWS-bridge rewrite — and
then you must say, in your result, exactly what moved and why the new assertion is as strong
as the old one. Weakening an assertion to get green is the single worst outcome available to
you, and it is worse than leaving the test red with an honest explanation.

Concretely, the shapes to expect:
  · A spec that pins SOURCE TEXT (\`expect(source).toContain("await estateInventory()")\`)
    against a page whose read legitimately moved into a sibling module. The behaviour still
    holds; the assertion is looking in the wrong file. Point it at the new one — do not
    delete it, and do not loosen the pattern to something that would pass on a page that had
    stopped reading the estate altogether.
  · A LAYOUT failure ("no text overlaps other text") after a Material 3 rewrite. That is a
    real CSS regression on a real page. Fix the page, NOT the spec. \`e2e/layout.spec.ts\` is
    owned by nobody in this wave and must not be edited by anyone.
  · A LOGIC spec whose vocabulary grew — e.g. an alarm verdict set that gained an arm, so a
    table asserting "every verdict has a rank and a tone" now finds one it does not know.
    Add the arm to whatever the spec reads, do not shrink the assertion.

WHAT YOU CANNOT VERIFY HERE, AND WHAT TO DO ABOUT IT. The Studio Playwright job needs
DynamoDB Local on :8000, and Docker Desktop is not answering on this machine. So the
server-backed specs cannot be reproduced locally, and you must NOT claim you ran them.
What you CAN do, and must:
  · \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\` — zero errors in YOUR files.
  · \`npm run test --workspace apps/web -- --ci <path>\` for any unit test near your change
    (that runner covers apps/system-studio/src too — its jest \`roots\` include it).
  · For a spec that needs no browser — the \`*-logic.spec.ts\` files that never call
    \`page.goto\` — run it directly:
        cd apps/system-studio && npx playwright test e2e/<your>.spec.ts
    and report the counts.
  · Reason from the CI log's assertion message, and state plainly in your result which of
    your fixes is verified and which is reasoned-but-unverified. An honest
    "reasoned, not run, because DynamoDB Local is unavailable" is worth more than a claim
    CI is about to contradict.

QUALITY BAR:
- Real code reached by a real production caller. Name the caller.
- Do not disable, skip, \`.fixme\`, \`.slow\` or conditionally-skip a test to get green. If a
  test genuinely cannot pass, leave it failing and say why.
- Guards that shipped switched off in this repository five times — \`if (false && verdict)\`,
  \`|| true\`, \`false && CREDENTIAL.test(write)\` — all read green. Do not add a sixth.
- Do NOT run \`npm run generate\` or \`npm install\`; the orchestrator does both, once.
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
        required: ['test', 'status', 'root_cause', 'fix'],
        properties: {
          test: { type: 'string' },
          status: { type: 'string', enum: ['FIXED', 'FIXED_UNVERIFIED', 'STILL_FAILING', 'NOT_MINE'] },
          root_cause: { type: 'string' },
          fix: { type: 'string' },
          spec_changed: { type: 'boolean' },
          spec_change_justification: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    verified_how: { type: 'string' },
  },
}

/**
 * One entry per failing spec, with the source it is allowed to touch.
 *
 * `e2e/layout.spec.ts` appears in three entries and is owned by NONE of them: the
 * overlap failures are on three different pages and the fix belongs to each page,
 * not to the oracle that caught them.
 */
const REPAIRS = [
  {
    key: 'layout-index',
    spec: 'e2e/layout.spec.ts (the `/` cases only — DO NOT EDIT the spec)',
    owns: 'apps/system-studio/src/app/page.tsx and everything under apps/system-studio/src/app/console-index/',
    what: `\`/ — no text overlaps other text\` fails at 1440px. It PASSES at 1180, 900 and 320,
which is the interesting part: a regression that appears only at the widest breakpoint is
usually a grid or flex row that stops wrapping once there is room, and two children then
share a cell. The console index was rebuilt on the Material 3 primitives this session.`,
  },
  {
    key: 'layout-tenant-new',
    spec: 'e2e/layout.spec.ts (the `/tenants/new` cases only — DO NOT EDIT the spec)',
    owns: 'everything under apps/system-studio/src/app/tenants/new/',
    what: `\`/tenants/new — no text overlaps other text\` fails at 1440, 1180 AND 320px. Failing
at three of four widths means it is not a breakpoint edge — something on the compose form
overlaps in almost every layout. The form gained a priced running total and a ChoiceGroup
component this session.`,
  },
  {
    key: 'layout-audit',
    spec: 'e2e/layout.spec.ts (the `/platform/audit` cases only — DO NOT EDIT the spec)',
    owns: 'everything under apps/system-studio/src/app/platform/audit/',
    what: `\`/platform/audit — no text overlaps other text\` fails at 1440, 1180 and 900px. The
audit surface was rebuilt this session and gained an \`entries.ts\` module and a hold control.`,
  },
  {
    key: 'aws-unknown',
    spec: 'e2e/aws-unknown-is-not-absent.spec.ts',
    owns: 'e2e/aws-unknown-is-not-absent.spec.ts, apps/system-studio/src/app/tenants/[slug]/page.tsx, apps/system-studio/src/app/tenants/[slug]/footprint.ts, apps/system-studio/src/app/tenants/[slug]/summary.ts, apps/system-studio/src/app/tenants/[slug]/next-moves.ts, apps/system-studio/src/app/tenants/[slug]/tenant-answers.test.ts, apps/system-studio/src/app/tenants/[slug]/tenant.module.css, e2e/tenant-surface.spec.ts',
    what: `Two groups, and they are almost certainly one cause.

\`the drift comparison is reached from a page\` asserts on SOURCE TEXT of
\`app/tenants/[slug]/page.tsx\`: it expects the literal \`await estateInventory()\` and a
literal array \`[estate.ecsServices, estate.databases, estate.distributions,
estate.certificates]\`. The CI log shows the received string now begins
\`import Link from "next/link"\` — i.e. the page was rewritten and the estate read moved.

This is the case where a spec may legitimately be repointed, BUT the property it was
protecting is real and must survive: the drift comparison must still be reached from a
page, and it must still be passed the READINGS rather than flattened arrays, because
flattening is what turns "we could not read this" into "there is none of it". Find where
that read lives now, assert it there, and make sure the new assertion would still fail if
somebody flattened the readings. If the page NO LONGER reaches the drift comparison at all,
that is not a spec problem — say so loudly, because it means the tenant page stopped
computing drift.

\`e2e/tenant-surface.spec.ts\` also has failures. Read them; they are on the same page.`,
  },
  {
    key: 'identity-surface',
    spec: 'e2e/identity-surface.spec.ts',
    owns: 'e2e/identity-surface.spec.ts and everything under apps/system-studio/src/app/platform/identity/',
    what: `Two failures: \`a guard that is not running is worded differently from one that is
clean\` and \`the verdict never prints a clean bill of health over a gap\`.

These two assertions ARE the page's reason to exist — an absence of findings from a control
that is not running is not a pass. If they fail, either the wording collapsed or the verdict
can reach its clean arm over a gap. Do NOT relax either assertion. Note the page's auth gate
changed this session from \`isOperator\` to \`authorizeCommand("platform.read", …)\`, which may
change what an unauthenticated run renders.`,
  },
  {
    key: 'health-verdicts',
    spec: 'e2e/health-page-logic.spec.ts and e2e/fleet-health-logic.spec.ts',
    owns: 'e2e/health-page-logic.spec.ts, e2e/fleet-health-logic.spec.ts, everything under apps/system-studio/src/app/platform/health/, and apps/system-studio/src/lib/aws/health.ts',
    what: `\`every verdict has a rank and a tone, and no tone is the only carrier\` fails, and so
does \`the tenant's own page names every source it could not read\`.

The first is very likely mine to explain: \`ALARM_VERDICTS\` gained an \`UNREADABLE\` arm this
session, because a throttled or unconfigured alarm read was producing \`rows: []\` — the same
value an empty-but-successful read produces — so a non-answer rendered as a reassuring zero.
\`VERDICT_TONE\` and \`VERDICT_RANK\` in \`platform/health/answer.ts\` were updated; whatever this
spec reads may not have been. Add the arm wherever it is missing. Do not remove the arm and
do not shrink the assertion — it is the assertion that made the defect visible.

\`e2e/health-page-logic.spec.ts\` calls no \`page.goto\`, so you CAN run it:
\`cd apps/system-studio && npx playwright test e2e/health-page-logic.spec.ts\`. Report counts.`,
  },
  {
    key: 'states-logic',
    spec: 'e2e/states-logic.spec.ts',
    owns: 'e2e/states-logic.spec.ts and apps/system-studio/src/components/states.tsx',
    what: `Failing, and it was ALREADY failing before this session — the MD3 foundation agent
reported "the platform page renders DegradedState from the inventory's own refusals" as a
pre-existing failure in an unmodified file. Check that claim against \`git log\` before
accepting it: if it is pre-existing, it is still red main and still yours to fix; if this
session broke it, the cause is nearer to hand.

This spec calls no \`page.goto\`, so run it directly and report counts.`,
  },
  {
    key: 'platform-and-signin',
    spec: 'e2e/platform.spec.ts and e2e/signin.spec.ts',
    owns: 'e2e/platform.spec.ts, e2e/signin.spec.ts, apps/system-studio/src/app/platform/page.tsx, apps/system-studio/src/app/platform/engine-answer.ts, apps/system-studio/src/app/platform/engine-answer.test.ts, apps/system-studio/src/app/platform/platform.module.css, and everything under apps/system-studio/src/app/signin/',
    what: `Two failures in each. \`/platform\` was rebuilt this session and ALSO moved behind the
navigation's Diagnostics group, so a spec asserting how it is reached may be asserting the
old flat nav. If so, repoint it at the new structure — the route still serves and must.

For signin: nothing in this session was supposed to touch it, so read the failure carefully
before changing anything. A signin regression is the most expensive kind here, because it is
the door.`,
  },
  {
    key: 'high-risk-gate',
    spec: 'e2e/high-risk-fails-closed.spec.ts',
    owns: 'e2e/high-risk-fails-closed.spec.ts, apps/system-studio/src/lib/tenant-state.ts, apps/system-studio/src/lib/audit-ledger.ts',
    what: `\`every attempt is on the audit ledger, refusals included, and the chain links\` fails.

This is the append-only audit chain, and it is one of the most load-bearing assertions in the
console: a refusal that is not recorded is the half of the record an incident review is
about. Treat a failure here as a real defect until you have proved otherwise. Do NOT change
the assertion. If the chain genuinely no longer links, that outranks everything else in this
wave — say so in your result in the first sentence.`,
  },
  {
    key: 'configuration-surface',
    spec: 'e2e/configuration-surface.spec.ts',
    owns: 'e2e/configuration-surface.spec.ts and everything under apps/system-studio/src/app/tenants/[slug]/configuration/',
    what: `\`survives 320 CSS pixels: no sideways scroll, no overlap, nothing spilling\` fails.
Only at 320px, which is the hard case and the one the configuration editor has failed before.
The editor gained a priced running total and a change-cost delta this session. Fix the page.`,
  },
]

phase('Repair')
log(`${REPAIRS.length} agents, one per failing spec, disjoint source ownership`)

const repaired = await parallel(
  REPAIRS.map((item) => () =>
    agent(
      `${RULES}

TASK — make these Studio Playwright failures pass, without weakening what they assert.

YOUR SPEC: ${item.spec}

YOU OWN, exclusively: ${item.owns}

Nothing else. In particular \`e2e/layout.spec.ts\` is owned by NOBODY in this wave — three
agents are fixing three different pages it caught, and an edit to the oracle would hide all
three.

WHAT FAILED, and what is likely behind it:
${item.what}

Start by reading the real failure:
    gh run view --job 94688542895 --log-failed 2>&1 | grep -B 5 -A 30 "${item.key}"
(or grep your spec's filename). Then fix the smallest thing that makes the assertion true.

Report, per failing test: the root cause in one sentence, what you changed, and whether you
VERIFIED it or only reasoned it. If you changed a spec, set spec_changed and justify it
against the rule above — what moved, and why the new assertion is as strong as the old one.`,
      { label: `repair:${item.key}`, phase: 'Repair', schema: RESULT_SCHEMA, effort: 'high' },
    ),
  ),
)

const rows = repaired.filter(Boolean).flatMap((r, i) =>
  (r.results || []).map((x) => ({ agent: REPAIRS[i]?.key, ...x })),
)

log(
  `${rows.filter((r) => r.status === 'FIXED').length} fixed and verified · ` +
    `${rows.filter((r) => r.status === 'FIXED_UNVERIFIED').length} fixed but unverified · ` +
    `${rows.filter((r) => r.status === 'STILL_FAILING').length} still failing`,
)

return {
  program: 'studio-e2e-repair',
  fixed: rows.filter((r) => r.status === 'FIXED'),
  unverified: rows.filter((r) => r.status === 'FIXED_UNVERIFIED'),
  stillFailing: rows.filter((r) => r.status === 'STILL_FAILING'),
  specChanges: rows.filter((r) => r.spec_changed),
}
