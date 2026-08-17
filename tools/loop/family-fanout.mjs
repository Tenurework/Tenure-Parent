export const meta = {
  name: 'family-fanout',
  description:
    'One agent per requirement family, each closing what it can genuinely close and writing its own ledger, then an independent refuter per family',
  whenToUse:
    'To move the programme count when the remaining work is spread across many domains rather than concentrated in one. Every family owns a different ledger and a different module tree, which is what makes the fan-out safe.',
  phases: [
    { title: 'Close', detail: 'one agent per family' },
    { title: 'Refute', detail: 'one skeptic per family' },
  ],
}

/* ── Families, smallest remaining first ───────────────────────────────────────
 *
 * Ordered so the ones that can plausibly be FINISHED come first. A family at 13
 * remaining is a different kind of task from one at 652, and pretending
 * otherwise is how a wave returns nothing everywhere instead of something
 * somewhere.
 */
const FAMILIES = [
  { key: 'TTES',   remaining: 13,  ledger: 'tenant-experience-execution-ledger.md' },
  { key: 'ANL',    remaining: 24,  ledger: 'analytics-reporting-execution-ledger.md' },
  { key: 'PLN',    remaining: 25,  ledger: 'planning-epm-execution-ledger.md' },
  { key: 'OPS',    remaining: 29,  ledger: 'operations-cloud-execution-ledger.md' },
  { key: 'HCM',    remaining: 30,  ledger: 'people-hr-workforce-execution-ledger.md' },
  { key: 'FIN',    remaining: 31,  ledger: 'financial-management-execution-ledger.md' },
  { key: 'PACK',   remaining: 36,  ledger: 'erp-pack-factory-execution-ledger.md' },
  { key: 'CAT',    remaining: 55,  ledger: 'connection-composer-execution-ledger.md' },
  { key: 'INT',    remaining: 62,  ledger: 'integration-ecosystem-execution-ledger.md' },
  { key: 'CFG',    remaining: 75,  ledger: 'declarative-configurator-execution-ledger.md' },
  { key: 'WRK',    remaining: 75,  ledger: 'universal-work-graph-execution-ledger.md' },
  { key: 'SIMON',  remaining: 154, ledger: 'simon-ose-absorption-execution-ledger.md' },
]

const RULES = `
You are working in C:/Users/satvi/Tenure-Parent on branch "main". Read
C:/Users/satvi/Tenure-Parent/CLAUDE.md before you touch anything.

NON-NEGOTIABLE:
- NEVER push, commit, reset, stash, checkout, or run \`git add\`. The orchestrator commits.
- NEVER push to https://github.com/Tenurework/Tenure (remote "live"). A push there rolls
  production for a live pilot carrying real student data.
- Do not weaken the production-disarming guards. \`if: github.repository == 'Tenurework/Tenure'\`
  stays on every AWS-touching job. It working is the failure mode.
- Do not read, print or copy secret VALUES.
- Do NOT run \`npm run generate\` or \`npm install\`.

NO SCHEMA CHANGES IN THIS WAVE. Do not edit \`apps/web/prisma/schema.prisma\` and do not add a
migration. This is not squeamishness: a previous run produced six unverified Prisma migrations
that had to be quarantined on a branch and never merged, because migrations are exactly the thing
that cannot be reviewed on the strength of "an agent wrote it", and because a dozen agents
inventing migrations in parallel produces a schema nobody can reason about. If a requirement
genuinely needs a schema change, report it as NEEDS_SCHEMA with the shape it needs and move on to
one that does not.

PREFER WORK THAT NEEDS NO BUILD. Eleven other agents are running right now. \`npm run studio:build\`
takes ~350s and a rendered page needs a server, so a wave where everyone builds is a wave where
nobody finishes. Most requirements in this repository can be proven with \`node --test\` or with a
logic-only Playwright spec that needs neither browser nor server — \`preferences-logic.spec.ts\` and
\`md3-tokens-logic.spec.ts\` are the pattern. Choose those requirements first. If a requirement
truly needs a rendered page, say so in your result and pick a different one.

DISK AND PROCESSES, if you do end up building:
- Build into ONE directory named for yourself (\`.next-<you>\`) and DELETE it before you return.
- STOP YOUR SERVER by the PID you started, before you build again and before you return. On
  Windows a running standalone server holds files under \`.next\` OPEN and the next build BLOCKS at
  ZERO CPU emitting no BUILD_ID — it looks exactly like a slow build. Measured: 25 minutes at 0%,
  then 210 seconds once the server was stopped.
- NEVER delete a directory or kill a process that is not yours.
- \`df -h /c\` before building. Under 5GB free, clean your own directory first and say so.
`

const HOW_TO_COUNT = `
═══ HOW A REQUIREMENT ACTUALLY BECOMES "DONE" ═══

This matters more than the code. Work that does not land in a ledger does not count, and a
previous wave lost seven requirements' worth of effort for exactly that reason.

  1. THE REGISTRY IS GENERATED, NOT AUTHORED.
     \`docs/architecture/capability-completeness-registry.yaml\` is produced by
     \`tools/document-graph.mjs\` and lists all 2265 requirements with the status a LEDGER records.
     Read it to find your family's ids and their current status. Do not edit it.

  2. STATUS IS READ FROM THE LEDGER, NEVER FROM A BIBLE'S OWN CHECKBOX.
     The registry's header says why: "a document must not mark its own homework."

  3. SO YOU MUST WRITE A LEDGER ROW. Yours is \`docs/implementation/<your ledger>\`, and you own
     that file exclusively — no other agent in this wave touches it. The parser
     (\`document-graph.mjs\`, around line 437) reads rows shaped:

         ## <ID> — a title that says what is now true

         - [x] **<ID>** — the requirement's own sentence, quoted from the authority
           - Status: PASS
           - Code: the production modules, by path, with the exported names
           - Caller: what imports them, by path and line. A module nothing calls is not shipped.
           - Tests: the spec and its actual counts
           - Evidence: the command you ran and its verbatim output

     The id must be followed by a word boundary — \`**GE-042-004**\` and
     \`**GE-042-004 (the adapter half)**\` both parse; the second form is how you close one
     requirement across several rows.

  4. A TICKED BOX MUST BE A PASS. \`tests/architecture/a-ticked-box-is-a-passing-requirement.test.mjs\`
     fails the build if you tick a box whose registry status is not PASS. Do not tick optimistically.

  5. FAIL IS A LEGITIMATE ANSWER, AND OFTEN THE HONEST ONE. Write the row with Status: FAIL and
     say precisely what is missing. A recorded FAIL is worth more than a fabricated PASS: it is
     the difference between 802 requirements nobody has looked at and 802 nobody has DECIDED.
`

const STANDARD = `
═══ THE STANDARD ═══

MUTATION PROOF, OR IT DID NOT HAPPEN. For every behaviour you claim: apply a mutation that should
break it, RUN the test, CONFIRM IT FAILS, restore, confirm it passes. Report the mutation and both
results verbatim. A test that passes against a broken implementation proves nothing, and this has
happened here twice this week — once where two mutations masked each other (mutate ONE thing at a
time, and use a literal value so no other token can absorb it), and once where a hit-area test
passed against a 16px control because its probe accepted the wrapper element.

BUILD ON WHAT EXISTS. This repository is large and its conventions are strong. Before writing a
module, grep for one that already does most of it. Before writing a helper, check
\`apps/web/src/lib/\` and \`packages/\`. A second implementation of something that exists is a defect,
not a contribution — the repository already carries a note about what having two parsers cost.

WHAT "REAL" MEANS HERE. No stubs, no TODO, no function that returns a constant so a test can pass.
No hardcoded demo data. If a value cannot be computed, the code must say it could not — this
codebase's central rule is that "we looked and found nothing" and "we could not look" are
different answers, and collapsing them is the bug it most often finds.

PLAYWRIGHT, if you write a spec: wait, THEN measure. \`boundingBox()\` samples once and returns null
for anything not yet painted; \`expect(x).toBeVisible()\` retries. Measuring straight after
\`goto()\` is a coin toss that turned CI red twice this week.

SCOPE. Close between TWO and SIX requirements properly rather than fifteen shallowly. The refuter
that follows you re-runs every mutation, and a claim it overturns costs more than a claim you
never made. Depth beats breadth; the count only means something if each one survives.
`

const CLOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['family', 'results'],
  properties: {
    family: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'requirement', 'summary', 'mutation_proof'],
        properties: {
          id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NEEDS_SCHEMA', 'NOT_APPLICABLE'],
          },
          requirement: { type: 'string' },
          summary: { type: 'string' },
          mutation_proof: { type: 'string' },
          code: { type: 'string' },
          caller: { type: 'string' },
          tests: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    ledger_rows_written: { type: 'array', items: { type: 'string' } },
    needed_a_build: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['family', 'verdicts'],
  properties: {
    family: { type: 'string' },
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

phase('Close')
log(`${FAMILIES.length} families in parallel — each owns one ledger and its own module tree`)

const outcomes = await pipeline(
  FAMILIES,

  /* ── close what can be closed ─────────────────────────────────────────── */
  (fam) =>
    agent(
      `${RULES}${HOW_TO_COUNT}${STANDARD}

YOUR FAMILY IS ${fam.key}. It has ${fam.remaining} requirements the ledgers do not record as
passing, out of 2265 across the programme.

YOU OWN, EXCLUSIVELY:
  docs/implementation/${fam.ledger}          — your ledger. No other agent touches it.
  plus the production modules your requirements actually need.

ELEVEN OTHER AGENTS ARE RUNNING RIGHT NOW, one per family, each owning its own ledger. They will
be editing the repository at the same time as you. Therefore:

  · Before you edit a file that is not obviously yours — anything under \`apps/web/src/lib/\`,
    \`packages/\`, \`apps/system-studio/src/app/globals.css\`, \`tools/\`, or a shared test — consider
    whether another domain plausibly owns it. If it is genuinely shared, prefer ADDING a new file
    over editing a shared one, and list every shared file you touched in \`files_changed\` so the
    orchestrator can see the overlap.
  · NEVER edit another family's ledger, and never edit
    \`docs/architecture/capability-completeness-registry.yaml\` (generated).
  · Do not run \`git add\`, and do not "fix" a change you did not make. A file you did not expect
    to be modified is probably another agent mid-flight, not damage.

WHAT TO DO:

  1. READ YOUR REQUIREMENTS. Find them in the registry — every entry carries \`id\`, \`prefix\`,
     \`source_document\` and \`section\`, so you can read each requirement's own sentence in the
     authority document it comes from. Read the sentence, not the id. A requirement is closed when
     what it SAYS is true.

  2. READ YOUR LEDGER. It tells you what has been tried, what was refused, and why. Some of your
     ${fam.remaining} will already have a row explaining exactly what is missing — that is the
     cheapest possible starting point, and it is why this step is not optional.

  3. PICK TWO TO SIX you can genuinely close now, preferring ones provable without a build.
     Say in \`notes\` what you considered and rejected, and why. That list is useful even when it
     is long: it tells the next wave where the real blockers are.

  4. CLOSE THEM. Real code, real tests, mutation-proven, wired to a caller.

  5. WRITE YOUR LEDGER ROWS, in the shape above, for everything you attempted — PASS and FAIL
     alike.

Be honest about the shape of your family. If ${fam.key} turns out to need infrastructure that does
not exist — a service, a schema, an external credential — then the valuable output of this run is
a precise account of that, with FAIL rows naming the blocker, rather than two thin passes.`,
      {
        label: `close:${fam.key}`,
        phase: 'Close',
        schema: CLOSE_SCHEMA,
        effort: 'high',
      },
    ),

  /* ── refute it ────────────────────────────────────────────────────────── */
  (closed, fam) => {
    if (!closed) return null
    const claims = (closed.results || []).filter((r) => r.status === 'PASS')
    if (claims.length === 0) return { family: fam.key, verdicts: [], tree_left_clean: true }

    return agent(
      `${RULES}

You are a REFUTER for family ${fam.key}. Another agent claims it closed these ${claims.length}
requirements. Your default is refuted=true. Set it false ONLY for what you verify YOURSELF by
running it.

${claims
  .map(
    (r) =>
      `- ${r.id}\n  requirement: ${r.requirement}\n  claim: ${r.summary}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

CHECK, in this order, and stop at the first thing that is false:

 1. DOES THE REQUIREMENT'S OWN SENTENCE SAY WHAT THE CLAIM SAYS IT SAYS? Open the authority
    document and read it. The most common failure in this repository is not broken code, it is a
    requirement closed against a narrower reading of itself. One agent closed "build twenty-two
    accessible primitives" on the strength of eleven. If the claim closes part of a requirement,
    it is FAIL, not PASS.

 2. RE-RUN EVERY MUTATION YOURSELF. Apply it, run the test, watch it fail, restore, confirm green.
    A mutation that SURVIVES means the test does not test what was claimed — that has happened
    here, and it is the single highest-value thing you will do. Mutate ONE thing at a time: two
    mutations at once can mask each other, which fooled an agent this week.

 3. IS THE CODE REACHED? \`grep\` for the caller. A module nothing imports is not shipped, however
    well tested. "No surface imports it yet" is FAIL.

 4. IS IT REAL? No stub, no constant return, no hardcoded demo value, no silently-swallowed error.
    Check specifically that a value which cannot be computed is reported as unknown rather than as
    zero or empty — that distinction is this codebase's central rule.

 5. DOES THE LEDGER ROW MATCH THE WORK? Status: PASS with evidence that does not reproduce is
    worse than no row.

Edit files ONLY to apply and restore mutations, and only in ${fam.key}'s own area. Other agents are
working in this tree; a file changing under you is another family, not sabotage. Set
tree_left_clean to whether you left everything exactly as you found it.`,
      { label: `refute:${fam.key}`, phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ closed, verdict: v, fam }))
  },
)

/* ── tally ────────────────────────────────────────────────────────────────── */

const rows = []
for (const o of outcomes.filter(Boolean)) {
  const closed = o.closed || o
  const verdicts = new Map(((o.verdict || {}).verdicts || []).map((v) => [v.id, v]))
  for (const r of closed.results || []) {
    rows.push({
      ...r,
      family: closed.family,
      confirmed: r.status === 'PASS' && verdicts.get(r.id)?.refuted === false,
      refutedWhy: verdicts.get(r.id)?.reason,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
const overturned = rows.filter((r) => r.status === 'PASS' && !r.confirmed)

log(
  `confirmed ${confirmed.length} · overturned ${overturned.length} · ` +
    `recorded FAIL ${rows.filter((r) => r.status === 'FAIL').length} · ` +
    `needs schema ${rows.filter((r) => r.status === 'NEEDS_SCHEMA').length}`,
)

return {
  program: 'family-fanout',
  confirmed,
  overturned,
  recorded: rows.filter((r) => r.status !== 'PASS'),
  files: outcomes.filter(Boolean).flatMap((o) => (o.closed || o).files_changed || []),
  builders: outcomes.filter(Boolean).filter((o) => (o.closed || o).needed_a_build).length,
  notes: outcomes
    .filter(Boolean)
    .map((o) => ({ family: (o.closed || o).family, notes: (o.closed || o).notes })),
}
