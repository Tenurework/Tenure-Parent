export const meta = {
  name: 'tenure-queue-implementation',
  description: 'Implement pre-surveyed requirements from the harvested queue, each adversarially verified',
  whenToUse: 'After a survey pass has produced tools/loop/harvested-queue.json',
  phases: [
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
const OWNS = D.owns || []
const LEDGER = D.ledger || 'docs/implementation/global-engine-execution-ledger.md'
const ITEMS = D.items || []
const TAG = D.tag || 'queue'

if (ITEMS.length === 0) {
  return { tag: TAG, confirmed: [], note: 'no items supplied' }
}

const RULES = `
You are implementing the Tenure platform in C:/Users/satvi/Tenure-Parent (branch main).

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure (remote "live").
  It is a live pilot with real student data.
- Do NOT git commit, git push, git reset, or rewrite history. The orchestrator commits and pushes.
  You edit files and run tests, nothing else.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
  Never weaken a guard, loosen a ratchet, or delete an assertion to get a green build.
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or Stripe money movement.
- Never treat an AI, agent, operator or test result as human approval.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. A type, interface or helper that nothing
  calls is NOT an implementation — it is dead code, and dead code carrying a comment that
  claims otherwise is worse than nothing. Name the caller in your result or return BLOCKED.
- Every behaviour gets a test PROVEN to catch: apply a mutation to the behaviour, run the
  test, CONFIRM IT FAILS, restore, confirm it passes. Report the mutation and both results.
- Beware the fake test: if a mock returns a canned value regardless of the code under test,
  the assertion proves nothing. Make the stand-in behave like the real dependency.
- If a comment or evidence string asserts something untrue (a file that does not exist, a
  transport that is not wired, an outcome not performed), fix the CLAIM, not the test.
- docs/architecture/REVIEW-FINDINGS.md overrides docs/architecture/PLATFORM-ARCHITECTURE.md
  wherever they disagree. The review wins.

FILE OWNERSHIP — create/edit ONLY under these paths:
${OWNS.map((p) => '  - ' + p).join('\n')}
Plus a test beside them and the ledger ${LEDGER}. You may READ anything. Other agents are
editing other areas of this same working tree right now — if your change needs a file outside
your area, stop at that boundary and report it, do not edit it.

VERIFY before reporting:
  npm run type-check          (0 errors; you share this tree, so confirm an error is YOURS)
  npm run test --workspace apps/web -- --ci --testPathPattern "<your area>"
Postgres is NOT available here — anything needing a live database is BLOCKED_EXTERNAL, with
the exact commands an operator would run. Do the non-database work fully.
`

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'summary', 'files_changed', 'mutation_proof', 'evidence'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NOT_APPLICABLE'] },
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    mutation_proof: { type: 'string' },
    evidence: { type: 'string' },
    caller: { type: 'string' },
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

log(`${TAG}: implementing ${ITEMS.length} pre-surveyed items`)

const results = await pipeline(
  ITEMS,
  (it) =>
    agent(
      `${RULES}

Implement requirement ${it.id} — ${it.title || ''}

The survey's full record for this item — its file:line evidence and the smallest real
change it identified — is in ${D.waveFile || 'the wave file'}, in the entry whose id is
"${it.id}". READ THAT FIRST. It is detailed and specific, and re-deriving it wastes the
work already done.

FILES YOU OWN for this task:
${(it.files || []).map((f) => '  - ' + f).join('\n')}

Re-verify the survey before you trust it: it was written by another agent and may be wrong,
or the code may already satisfy the requirement. If it is already done, return NOT_APPLICABLE
with the file:line that shows it — that is a useful answer, not a failure.

Then: implement it, wire it to a caller, test it, mutate the test to prove it catches, run
type-check and the narrowest test command, and append your entry to ${LEDGER} with status
PASS / FAIL / BLOCKED_EXTERNAL / NOT_APPLICABLE. There is no PARTIAL and no
BLOCKED_ARCHITECTURE — next-batch.mjs decides on neither, so either respins forever.
Claim PASS only if it is really done and really proven.`,
      { label: `impl:${it.id}`, phase: 'Implement', schema: IMPL_SCHEMA },
    ),
  (impl, it) => {
    if (!impl || impl.status !== 'PASS') return { item: it, impl, verdict: null }
    return agent(
      `${RULES}

You are a REFUTER. Another agent claims ${it.id} is implemented and proven.
Default refuted=true. Set refuted=false ONLY if you actively verified the claim.

  summary: ${impl.summary}
  files:   ${(impl.files_changed || []).join(', ')}
  caller:  ${impl.caller || '(none named)'}
  mutation: ${impl.mutation_proof}

Check, in this order:
  1. Is it reachable from a production call path? Trace it yourself. Dead code fails.
  2. RE-RUN THE MUTATION yourself — apply, run, observe, restore. Do not take their word.
  3. Is the test's stand-in canned, returning the same answer regardless of the code? Fake test.
  4. Does any new comment or string claim something untrue?
  5. Was a guard weakened, a ratchet loosened, or an assertion deleted to get green?

Edit files ONLY to apply and restore a mutation. Leave the tree as you found it.`,
      { label: `refute:${it.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ item: it, impl, verdict: v }))
  },
)

const done = results.filter(Boolean)
const confirmed = done.filter((r) => r.impl?.status === 'PASS' && r.verdict?.refuted === false)
const refuted = done.filter((r) => r.impl?.status === 'PASS' && r.verdict?.refuted !== false)
const other = done.filter((r) => r.impl && r.impl.status !== 'PASS')

log(`${TAG}: ${confirmed.length} confirmed, ${refuted.length} refuted, ${other.length} not-pass`)

return {
  tag: TAG,
  confirmed: confirmed.map((r) => ({ id: r.impl.id, summary: r.impl.summary, files: r.impl.files_changed, caller: r.impl.caller, mutation: r.impl.mutation_proof })),
  refuted: refuted.map((r) => ({ id: r.impl.id, why: r.verdict?.reason, worst: r.verdict?.worst_problem })),
  other: other.map((r) => ({ id: r.impl.id, status: r.impl.status, summary: r.impl.summary, needs: r.impl.cross_area_blocked })),
}
