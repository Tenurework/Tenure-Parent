export const meta = {
  name: 'studio-scale',
  description:
    'Compact by default: bring the type scale, control heights, row density and card padding down so a working set fits one screen, and make it falsifiable',
  whenToUse:
    'After studio-ux has landed the token layer and the shell. This tunes the BASE scale the density toggle sits around, which is a different decision from the toggle.',
  phases: [
    { title: 'Scale', detail: 'tokens, then the surfaces that override them' },
    { title: 'Refute', detail: 'an independent check that the console actually got denser' },
  ],
}

const RULES = `
You are tuning the Tenure System Studio in C:/Users/satvi/Tenure-Parent, on branch "main".

NON-NEGOTIABLE:
- NEVER push, commit or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). Do NOT git commit/push/reset/stash/checkout, and do not run \`git add -A\`.
- Do NOT weaken the production-disarming guards or \`deploy-studio.yml\`'s workflow_run gate.
- Do not read, print, copy or rotate secret VALUES.

═══ THE INSTRUCTION, VERBATIM ═══

"make sure that current UIUX whatever resource being used must match aesthetics of apple apps
and proper sizing of components (not too large or even large, just medium to small so its
compact and most is visible in a single view)"

Read \`docs/decisions/ADR-0009-design-system-substrate.md\`, section "Component scale: compact
by default", before you touch anything. It is the decision this work implements and it binds
the token layer rather than individual pages.

WHAT "APPLE AESTHETICS" MEANS HERE, AND WHAT IT DOES NOT. ADR-0009 already settled that the
substrate does NOT change — SwiftUI is not available to a web application and Liquid Glass
cannot satisfy the contrast requirement this console is held to. So this is not a re-skin.
What is being taken is the restraint: a working body size with headings that step by ratio
rather than by leaps, hierarchy carried by weight and space before size, controls at a medium
height, and borders removed rather than added. Do not introduce translucency, do not add
\`backdrop-filter\`, and do not copy any vendor's trade dress — Bible §20 forbids it by name.

═══ THE STANDARD ═══
- Every number you change, you justify. "Smaller" is not a specification; say what the value
  was, what it is, and what it buys — usually rows visible in a standard viewport.
- STUDIO-030-007 still holds: WCAG 2.2 AA contrast, and a 24px minimum touch target. Meet the
  target with the HIT AREA, not by inflating the visible box — an input can be visually medium
  and still have a compliant target. Prove both.
- STUDIO-030-005 still holds: comfortable and compact both exist, and compact loses no
  information. You are moving the base the toggle sits around, not deleting the toggle.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm it passes. Report each mutation and both results.
- Do NOT run \`npm run generate\` or \`npm install\`.
- Verify: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`, and the Playwright specs you
  own. Local harness: \`npx dynalite@3.2.2 --port 8001\`, \`node tools/create-registry-table.mjs\`,
  \`node tools/dev/seed-studio-fleet.mjs\` with
  \`AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci\`, then
  \`npm run studio:build\` and \`node .next/standalone/apps/system-studio/server.js\`
  (\`next start\` cannot serve \`output: standalone\`). Use your own port if 3100 is taken.

DISK. This is a hard constraint, not housekeeping. If you build into your own \`distDir\`, use
ONE directory named for yourself and DELETE IT before you return. A build is roughly 650MB, an
earlier wave left sixteen of them, and one had grown to 8.8GB from repeated rebuilds into the
same place — together they filled the volume to 12MB free. What that looks like when it happens
is not an out-of-space error: it is a test suite that reports a different number of tests on
every run and fails in a different place each time, which reads exactly like flakiness and
wastes an afternoon. Check \`df -h /c\` before you build; if there is under 5GB free, delete your
own scratch directory first and say so in your result.

NEVER delete a scratch directory that is not yours. Another agent is very likely still building
or serving from it, and \`.next-<something-else>\` being an hour stale is not evidence otherwise —
a directory's contents stop changing the moment a build finishes and a server starts reading it.
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
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    before_after: { type: 'array', items: { type: 'string' } },
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

phase('Scale')
log('Base scale: type, controls, rows, cards — then the surfaces that override them')

const work = await parallel([
  () =>
    agent(
      `${RULES}

TASK — STUDIO-030-001: bring the BASE scale down so a working set fits one screen.

YOU OWN, exclusively:
  apps/system-studio/src/app/globals.css   (the type-scale, spacing, shape and component
                                            geometry tokens, and the component rules that
                                            consume them — NOT the colour tokens, which were
                                            just settled and must not move)
  docs/architecture/studio-design-system.md

MEASURE FIRST, THEN CHANGE. Record, for a standard 1440x900 viewport: how many estate rows are
visible without scrolling on \`/platform/estate\`, how many fleet rows on \`/tenants\`, and the
computed height of a button, an input and a table row. Those four numbers are the
justification for everything you do next, and they go in your result as before/after pairs.

THE RULES, from ADR-0009:
  · TYPE — body is the working size; headings step by ratio, not by leaps. A heading three
    times body size on an internal console is a poster. Hierarchy comes from weight, colour
    and space before size. The MD3 type scale has fifteen roles; keep all of them, retune the
    sizes and line heights so the display/headline end is not shouting.
  · CONTROLS — buttons, inputs, selects and chips at a MEDIUM height. The 24px minimum touch
    target (STUDIO-030-007) is met by the hit area — padding, or a pseudo-element — not by
    inflating the visible box.
  · ROWS — table and list rows compact enough that a screen shows a working set. Padding is
    the last thing added and the first thing cut.
  · CARDS — a card earns its padding by grouping something. Nested cards each paying full
    padding is how four facts end up filling a screen. Reduce the inner level.
  · SPACE IS HIERARCHY — the gap BETWEEN groups should exceed the gap WITHIN one. That
    difference does more work than any border, so where you can, delete the border instead of
    adding one.

WHAT MUST NOT REGRESS, and each has a spec that will tell you:
  · \`preferences.spec.ts\` — AA contrast in light, dark and high contrast. Type size changes
    the ratio required for large text; if a pair was passing only because it counted as large
    text, shrinking it breaks AA. Re-run it and say so.
  · \`layout.spec.ts\` — every route at 1440, 1180, 900 and 320px, no overlapping text, nothing
    overflowing, no sideways scroll. Smaller type means more characters per line, which
    changes wrapping everywhere.
  · \`preferences-logic.spec.ts\` — the comfortable/compact contract, still both real.
  · Zoom and reflow (STUDIO-030-007): the console must still work at 200% zoom. A base scale
    tuned so tightly that 200% breaks it has traded an accessibility requirement for density.

PROVE IT with a test that reds if the base scale drifts back up — assert the computed row
height and control height stay at or under what you set, so a later "just a bit more padding"
has to argue with a test. Mutation-prove it by inflating one and showing it reds.`,
      { label: 'scale:tokens', phase: 'Scale', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  () =>
    agent(
      `${RULES}

TASK — STUDIO-030-010: make "most is visible in a single view" a measured property rather than
an impression.

YOU OWN, exclusively:
  apps/system-studio/e2e/density-budget.spec.ts   (new)

The instruction is that a working set is visible at once. Today nothing checks that, so it can
regress to a wall of half-empty cards one padding change at a time — which is how it got here.

Write the spec that holds it. At a standard desktop viewport, on the console's densest
surfaces — \`/platform/estate\`, \`/tenants\`, \`/platform/security\` — assert a MINIMUM number of
data rows are visible above the fold, and that the first data row appears within a sensible
distance of the top of the content region (a screen of chrome before the first fact is the
defect this catches).

Pick the numbers by MEASURING the console as it is after the token agent's pass, not by
picking round figures — and state in a comment what you measured and when, so the next person
knows whether the budget is ambitious or merely current.

TWO TRAPS:
  · An assertion that passes on an EMPTY table proves nothing, and this console's tables are
    empty without AWS credentials. Seed the registry with the local harness so there are rows,
    and make the spec fail loudly if it finds none rather than passing vacuously.
  · Do not assert a maximum. A surface that legitimately shows fewer rows — because the estate
    holds fewer — must not fail. The property is "the layout does not waste the viewport", not
    "there are always N rows".

This is the falsifiable form of the product owner's instruction, and it is the only part of it
that survives an opinion.`,
      { label: 'scale:budget', phase: 'Scale', schema: RESULT_SCHEMA, effort: 'high' },
    ),
])

phase('Refute')

const claimed = work
  .filter(Boolean)
  .flatMap((w) => (w.results || []).filter((r) => r.status === 'PASS'))

const verdict =
  claimed.length === 0
    ? null
    : await agent(
        `${RULES}

You are a REFUTER. Two agents claim these ${claimed.length} requirements are done. Default
refuted=true; set false ONLY for what you verify yourself.

${claimed.map((r) => `- ${r.id}: ${r.summary}\n  mutation claimed: ${r.mutation_proof}`).join('\n\n')}

Check, in this order:
  1. DID THE CONSOLE ACTUALLY GET DENSER? Measure it. Rows visible at 1440x900 on
     \`/platform/estate\` and \`/tenants\`, before and after, against the numbers they reported.
     A claim of "compact" with no measured improvement is refuted.
  2. Is the 24px touch-target minimum still met? Measure the HIT AREA, not the visible box —
     and confirm they did not simply shrink the target, which would trade STUDIO-030-007 for
     density.
  3. Re-run \`preferences.spec.ts\`. Smaller type raises the contrast bar for anything that was
     passing as large text. Did any pair fall below AA?
  4. Re-run \`layout.spec.ts\` at all four widths. Smaller type rewraps everything.
  5. Does it still work at 200% zoom? A base scale tuned so tight that zoom breaks reflow has
     traded an accessibility requirement for appearance.
  6. Did they add \`backdrop-filter\`, translucency, or anything ADR-0009 rules out?
  7. RE-RUN THE MUTATIONS yourself — apply, run, observe the failure, restore, confirm green.

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you left it
exactly as you found it.`,
        { label: 'refute:scale', phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
      )

const verdictFor = new Map((verdict?.verdicts || []).map((v) => [v.id, v]))
const rows = work
  .filter(Boolean)
  .flatMap((w) => (w.results || []).map((r) => ({ ...r, confirmed: r.status === 'PASS' && verdictFor.get(r.id)?.refuted === false })))

log(`${rows.filter((r) => r.confirmed).length} confirmed of ${rows.length}`)

return {
  program: 'studio-scale',
  confirmed: rows.filter((r) => r.confirmed),
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  measurements: work.filter(Boolean).flatMap((w) => w.before_after || []),
}
