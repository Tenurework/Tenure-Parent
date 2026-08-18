export const meta = {
  name: 'wave3-repair',
  description:
    'Close the sixteen platform-suite failures wave 3 left behind, one agent per failure, each proving its fix by running the named test',
  whenToUse:
    'After a large fan-out lands. Thirty-two agents adding modules leaves guards that demand a decision about each new module — a disposition, an owner, an adjudicated capability word — and those are independent of each other.',
  phases: [{ title: 'Repair', detail: 'one agent per failing guard' }],
}

/* The sixteen, each named by the test that fails and where it lives. Grouped so
 * one agent owns everything a single guard touches — two failures in the same
 * spec are one agent's job, because fixing one usually moves the other. */
const FAILURES = [
  {
    key: 'cfg-disposition',
    tests: ['tests/architecture/cfg-form-disposition-covers-the-tree.test.mjs'],
    what: 'every configuration module in the tree has a disposition',
  },
  {
    key: 'fin-claims',
    tests: ['tests/architecture/fin-finance-surface.test.mjs'],
    what:
      'every capability claim the surface makes has been adjudicated — a person must read the line and decide whether the code does what the word means. Vocabulary: TRUE, SCOPED, OVERSTATED, each with a note. Add entries to CLAIM_VERDICTS in tools/fin-finance-surface.mjs.',
  },
  {
    key: 'ge-landing-zone',
    tests: ['tests/architecture/ge-landing-zone-model.test.mjs'],
    what:
      'the derivations read the real files rather than matching nothing ("Only 0 resources derived from the inventory; expected at least 35"), and every resource in the estate is placed exactly once against a modelled node',
  },
  {
    key: 'ge-rule-six',
    tests: ['tests/architecture/ge-phase-gate-rule-six.test.mjs'],
    what: 'no GE gate is recorded better than Rule 6 allows',
  },
  {
    key: 'module-graph',
    tests: ['tests/architecture/module-graph-callers-carry-provides.test.mjs'],
    what: 'the detector finds the mappings it is auditing ("expected the known ModuleLike mappings, found 1")',
  },
  {
    key: 'ops-inventory',
    tests: ['tests/architecture/ops-operations-inventory.test.mjs'],
    what:
      'the committed inventory is what the tree says today, AND the derivation is stable when run twice — an unstable derivation is the more serious of the two and usually means an unsorted read or a clock',
  },
  {
    key: 'ownership',
    tests: ['tests/architecture/ownership.test.mjs'],
    what:
      'every source file belongs to a domain. New modules landed with no owner; give each a prefix in tools/ownership-map.mjs under the domain whose SUBJECT it is, with a comment saying why. Do not widen a prefix so far that it swallows a neighbouring domain.',
  },
  {
    key: 'pay-contexts',
    tests: ['tests/architecture/pay-bounded-contexts.test.mjs'],
    what: 'the module table is every module, with its real imports',
  },
  {
    key: 'ttes-budgets',
    tests: ['tests/architecture/ttes-governance-dashboard.test.mjs'],
    what:
      'the debt budgets hold, and hold in BOTH directions — the ratchet fails if debt grew AND if debt was paid down without lowering the budget',
  },
  {
    key: 'wrk-ledger',
    tests: ['tests/architecture/wrk-requirements-are-imported.test.mjs'],
    what: 'the work-graph ledger invents no requirement and repeats none',
  },
  {
    key: 'handoff-detector',
    tests: ['tests/security/handoff-invents-nothing.test.mjs'],
    what:
      'the detector reads real values out of the document ("no offered values found — the table matcher is not reading the document"). A detector that matches nothing passes vacuously, so this is a broken guard, not a broken document.',
  },
  {
    key: 'workflow-drift',
    tests: ['tests/security/workflow-drift.test.mjs'],
    what: 'the count of workflows relying on the repository default only shrinks',
  },
  {
    key: 'simon-sets',
    tests: ['tests/simon-absorption-inventory.test.mjs'],
    what: 'the target workflow and workspace sets are exactly what the tree holds',
  },
]

const RULES = `
You are working in C:/Users/satvi/Tenure-Parent on branch "main". Read CLAUDE.md first.

NON-NEGOTIABLE:
- NEVER push, commit, reset, stash, checkout or run \`git add\`. The orchestrator commits.
- NEVER push to https://github.com/Tenurework/Tenure (remote "live").
- Do not weaken the production-disarming guards.
- Do not read, print or copy secret VALUES.
- Do NOT run \`npm run generate\` or \`npm install\`. You may run a SINGLE generator by name.
- No schema changes, no migrations.

TWELVE OTHER AGENTS ARE IN THIS TREE. Touch only what your failure needs. If you must edit a
file another failure plausibly owns — \`tools/ownership-map.mjs\`, a ledger, a shared generator —
say so in \`shared_files_touched\`. A file changing under you is another agent, not damage.
`

const STANDARD = `
═══ HOW TO FIX A GUARD, AND HOW NOT TO ═══

THE GUARD IS USUALLY RIGHT. These tests were written deliberately and most carry an explanation
of the defect they exist to catch. Read that comment BEFORE deciding what to change. The default
fix is to satisfy the guard — give the new module a disposition, an owner, an adjudicated
verdict — not to relax it.

BUT SOMETIMES THE GUARD IS THE BUG, and two of these look like it: "the derivations read the real
files rather than matching nothing" and "the detector reads real values out of the document" both
report finding ZERO of something. A detector that matches nothing passes vacuously on every input
— it is not protecting anything, and its floor is what caught it. If a matcher has stopped
matching because a file it reads changed shape, fix the MATCHER and say what changed. Do not
lower the floor.

NEVER: delete a test, comment one out, add a skip, widen a ratchet to fit, or exclude a file from
a scan to make it pass. If a ratchet genuinely must move, move it and ARGUE it in the file, the
way its neighbours are argued — and only ever in the direction the file says it may move.

PROVE IT. Run the named test before and after. Report both, verbatim. If your fix is a code change
rather than a data change, apply one mutation that should break it, confirm the test fails,
restore, confirm green.

REGENERATE WHAT YOU INVALIDATE. Many of these have a generator (\`node tools/<name>.mjs\`); if your
change makes a committed document stale, run that ONE generator. Never \`npm run generate\`.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'fixed', 'summary', 'before', 'after'],
  properties: {
    key: { type: 'string' },
    fixed: { type: 'boolean' },
    summary: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
    guard_was_wrong: { type: 'boolean' },
    mutation_proof: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    shared_files_touched: { type: 'array', items: { type: 'string' } },
    blocked_because: { type: 'string' },
  },
}

phase('Repair')
log(`${FAILURES.length} failing guards, one agent each`)

const results = await parallel(
  FAILURES.map((f) => () =>
    agent(
      `${RULES}${STANDARD}

YOUR FAILURE: ${f.what}

THE TEST: ${f.tests.join(', ')}

Run it first and read the whole message — these guards explain themselves, and the message
usually names the file, the missing entry, or the count that moved. Then read the test's own
header comment for what defect it exists to catch, because that decides whether the right fix is
to satisfy it or to repair it.

This failure appeared after thirty-two agents added modules and documents across the tree in one
wave. So the most likely cause is simply that something new arrived and nobody decided the thing
this guard insists somebody decides — an owner, a disposition, a capability verdict, an inventory
row. That decision is yours to make and to justify, not to route around.

Report \`before\` and \`after\` as the test's own summary lines (e.g. "# pass 12 # fail 1" then
"# pass 13 # fail 0"), verbatim. If you conclude the GUARD is wrong rather than the tree, set
guard_was_wrong and say exactly what it was measuring incorrectly — that is a real finding and I
would rather have it than a passing suite.`,
      { label: `fix:${f.key}`, phase: 'Repair', schema: SCHEMA, effort: 'high' },
    ),
  ),
)

const done = results.filter(Boolean).filter((r) => r.fixed)
const stuck = results.filter(Boolean).filter((r) => !r.fixed)

log(`${done.length} fixed, ${stuck.length} not`)

return {
  program: 'wave3-repair',
  fixed: done,
  unfixed: stuck,
  guards_that_were_wrong: results.filter(Boolean).filter((r) => r.guard_was_wrong),
  shared: results.filter(Boolean).flatMap((r) => r.shared_files_touched || []),
}
