export const meta = {
  name: 'tenure-domain-implementation',
  description: 'Survey one Bible domain, implement its open requirements in an owned file area, adversarially verify each',
  whenToUse: 'Parallel Bible-to-production implementation, one domain per invocation',
  phases: [
    { title: 'Survey', detail: 'read the Bible + registry + real code; pick genuinely-open items and assign disjoint files' },
    { title: 'Implement', detail: 'one agent per requirement: real code, real test, mutation-proven' },
    { title: 'Verify', detail: 'adversarial refuter per claim, defaulting to refuted' },
  ],
}

/**
 * `args` arrives as a JSON STRING, not an object.
 *
 * Found the hard way: `const D = args || {}` left every field undefined, so a
 * fan-out of 13 workflows each fell back to the same default domain and
 * surveyed the same one 13 times. The defaults hid it — nothing errored, the
 * runs just all did the same work.
 */
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
const DOMAIN = D.domain || 'GE'
const OWNS = D.owns || []
const LEDGER = D.ledger || ''
const FOCUS = D.focus || ''
const SURVEYORS = D.surveyors ?? 8
const MAX_ITEMS = D.maxItems ?? 30

const RULES = `
You are implementing the Tenure platform in C:/Users/satvi/Tenure-Parent (branch main).

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure (remote "live").
  It is a live pilot with real student data. Do not touch it.
- Do NOT git commit, git push, git reset, git checkout of other people's files, or rewrite history.
  The orchestrator commits and pushes. You only edit files and run tests.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
  Do not weaken a guard to make a build pass.
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or Stripe money movement.
  Do not run destructive production migrations.
- Never treat an AI, agent, operator or test result as human approval.

QUALITY BAR — this is an implementation mission, not scaffolding:
- Real code wired into a real caller. No mocks, no stubs, no TODO, nothing illustrative.
  A type or an interface that nothing calls is NOT an implementation.
- Every behaviour you add gets a test that PROVES it catches: mutate the guarded behaviour,
  run the test, CONFIRM IT FAILS, restore, confirm it passes. Report the mutation and its result.
  A test whose mock returns a canned value regardless of the code under test is a fake test —
  make the fake behave like the real dependency so the assertion is load-bearing.
- If a claim in a comment or an evidence string is false, correct the CLAIM, not the test.
- Prefer finding the REAL call path. A fix applied to a function with no production caller is not a fix.

FILE OWNERSHIP — you may create/edit ONLY files under these paths:
${OWNS.map((p) => '  - ' + p).join('\n')}
Plus the single ledger file ${LEDGER || '(none)'}.
You may READ anything. If your work genuinely requires editing a file outside your area,
do NOT edit it — report it as a cross-area dependency in your result and stop at that boundary.
Other agents are editing other areas of this same working tree concurrently.

VERIFY what you touched before reporting:
  npm run type-check
  npm run test --workspace apps/web -- --ci --testPathPattern "<your area>"
Postgres is NOT available on this host: anything needing a live database is BLOCKED_EXTERNAL —
say so with the exact commands an operator would run, and do the non-database work fully.
`

const SURVEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'why_open', 'files', 'smallest_real_change'],
        properties: {
          id: { type: 'string', description: 'requirement id, e.g. GE-012-004' },
          title: { type: 'string' },
          why_open: { type: 'string', description: 'evidence it is NOT already implemented — file:line of the gap' },
          files: { type: 'array', items: { type: 'string' }, description: 'files this item would touch, within the owned area' },
          smallest_real_change: { type: 'string' },
          already_done: { type: 'boolean', description: 'true if the code already satisfies it; then it is not work' },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'summary', 'files_changed', 'mutation_proof', 'evidence'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NOT_APPLICABLE'] },
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    mutation_proof: { type: 'string', description: 'the mutation applied, the test that went red, and that it went green on restore' },
    evidence: { type: 'string', description: 'commands run and their results' },
    caller: { type: 'string', description: 'the production call path that reaches this code' },
    cross_area_blocked: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    worst_problem: { type: 'string' },
  },
}

phase('Survey')
log(`${DOMAIN}: surveying with ${SURVEYORS} readers over ${OWNS.length} owned paths`)

const slices = Array.from({ length: SURVEYORS }, (_, i) => i)
const surveys = await parallel(
  slices.map((i) => () =>
    agent(
      `${RULES}

Read, in this order:
  1. docs/architecture/capability-completeness-registry.yaml — find requirements whose id starts with "${DOMAIN}-"
  2. ${LEDGER || 'the matching ledger in docs/implementation/'}
  3. The Bible documents those requirements cite (docs/architecture/**), and
     docs/architecture/REVIEW-FINDINGS.md — where the review and the spec disagree, THE REVIEW WINS.
  4. The actual code under your owned paths.

${FOCUS ? 'DOMAIN FOCUS: ' + FOCUS : ''}

You are surveyor ${i + 1} of ${SURVEYORS}. To avoid overlap, take the ${DOMAIN} requirements whose
position in the registry, counted in order, satisfies (index %% ${SURVEYORS}) === ${i}.

For each one, decide from the REAL CODE whether it is genuinely unimplemented. Be sceptical of the
ledger — an item marked open may already be done, and an item marked done may be a declaration with
no caller. Report at most 6 items you are confident are genuinely open AND implementable entirely
within the owned file area. For each, name the exact files and the smallest change that would make
it really true.

Return items only. Do not edit anything in this phase.`,
      { label: `survey:${DOMAIN}:${i + 1}`, phase: 'Survey', schema: SURVEY_SCHEMA },
    ),
  ),
)

const pool = surveys
  .filter(Boolean)
  .flatMap((s) => s.items || [])
  .filter((it) => it && !it.already_done && (it.files || []).length > 0)

// Disjoint file ownership, decided here so two implementers never open the same file.
const claimed = new Set()
const work = []
for (const it of pool) {
  if (work.length >= MAX_ITEMS) break
  const files = it.files || []
  if (files.some((f) => claimed.has(f))) continue
  files.forEach((f) => claimed.add(f))
  work.push(it)
}
log(`${DOMAIN}: ${pool.length} candidates -> ${work.length} with disjoint files (${pool.length - work.length} deferred for file overlap)`)

if (work.length === 0) {
  return { domain: DOMAIN, implemented: [], note: 'survey found no genuinely-open item implementable inside the owned area' }
}

const results = await pipeline(
  work,
  (it) =>
    agent(
      `${RULES}

Implement requirement ${it.id} — ${it.title}

Evidence it is open: ${it.why_open}
Smallest real change identified by the survey: ${it.smallest_real_change}

YOU OWN EXACTLY THESE FILES for this task, and no others:
${(it.files || []).map((f) => '  - ' + f).join('\n')}
(plus a test file beside them, and the ledger ${LEDGER}). Another agent owns every other file
in this repository right now. If the change cannot be made inside these files, return
status FAIL with cross_area_blocked naming what you needed, so it stays queued.

Do the whole thing:
  1. Read the surrounding code first and match its idiom, comment density and naming.
  2. Implement it for real, wired to a production caller. Name that caller in your result.
  3. Write the test. Then MUTATE the behaviour you added, run the test, confirm it FAILS,
     restore, confirm it PASSES. Put the exact mutation and both results in mutation_proof.
     If the mutation does NOT red the test, your test is fake — fix the test, not the record.
  4. Run: npm run type-check    (must be 0 errors — you share this tree, so check that any
     error you see is actually yours before touching it; if it is not yours, leave it and say so)
     and the narrowest test command covering your files.
  5. Append your entry to ${LEDGER} with status and evidence. Statuses are exactly
     PASS / FAIL / BLOCKED_EXTERNAL / NOT_APPLICABLE. There is no PARTIAL and no
     BLOCKED_ARCHITECTURE — next-batch.mjs decides on neither, so either respins forever.
     Only claim PASS if it is really done and really proven.

Report honestly. A FAIL you describe accurately is worth more than a PASS you cannot defend.`,
      { label: `impl:${it.id}`, phase: 'Implement', schema: IMPL_SCHEMA },
    ),
  (impl, it) => {
    if (!impl || impl.status !== 'PASS') return { item: it, impl, verdict: null }
    return agent(
      `${RULES}

You are a REFUTER. Another agent claims requirement ${it.id} is now implemented and proven.
Default to refuted=true. Only set refuted=false if you actively verified the claim is real.

The claim:
  summary: ${impl.summary}
  files:   ${(impl.files_changed || []).join(', ')}
  caller:  ${impl.caller || '(none named)'}
  mutation proof: ${impl.mutation_proof}

Try hard to break it. Specifically check:
  - Is the code reachable from a real production call path, or is it dead? Trace it. A function
    with no caller is not an implementation, however well tested.
  - Does the test actually fail when the behaviour is removed? RE-RUN THE MUTATION YOURSELF.
    Apply it, run the test, observe, restore. Do not take their word for it.
  - Is the test's mock canned — would it return the same value regardless of the code under test?
    That is a fake test and the claim is refuted.
  - Does it contradict docs/architecture/REVIEW-FINDINGS.md?
  - Does any comment or evidence string assert something that is not true (a file that does not
    exist, a transport that is not wired, an outcome not actually performed)?
  - Did they weaken a guard, loosen a ratchet, or delete an assertion to get green?

You may edit files ONLY to apply and then restore a mutation. Leave the tree exactly as you found it.`,
      { label: `refute:${it.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ item: it, impl, verdict: v }))
  },
)

const done = results.filter(Boolean)
const confirmed = done.filter((r) => r.impl?.status === 'PASS' && r.verdict && r.verdict.refuted === false)
const refuted = done.filter((r) => r.impl?.status === 'PASS' && (!r.verdict || r.verdict.refuted !== false))
const blocked = done.filter((r) => r.impl && r.impl.status !== 'PASS')

log(`${DOMAIN}: ${confirmed.length} confirmed, ${refuted.length} refuted, ${blocked.length} blocked/failed`)

return {
  domain: DOMAIN,
  confirmed: confirmed.map((r) => ({ id: r.impl.id, summary: r.impl.summary, files: r.impl.files_changed, caller: r.impl.caller, mutation: r.impl.mutation_proof })),
  refuted: refuted.map((r) => ({ id: r.impl.id, summary: r.impl.summary, why: r.verdict?.reason || 'no verdict returned', worst: r.verdict?.worst_problem })),
  blocked: blocked.map((r) => ({ id: r.impl.id, status: r.impl.status, summary: r.impl.summary, needs: r.impl.cross_area_blocked })),
}
