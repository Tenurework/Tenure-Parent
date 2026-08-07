export const meta = {
  name: 'tenure-cluster-implementation',
  description: 'Survey a Bible domain, then implement it in CLUSTERS — one agent per file-area, many requirements each',
  whenToUse: 'Bulk Bible-to-production throughput across a whole domain',
  phases: [
    { title: 'Survey', detail: 'read the domain Bible + ledger + code; find genuinely-open requirements' },
    { title: 'Implement', detail: 'one agent per file-area cluster, carrying every requirement in it' },
    { title: 'Verify', detail: 'one refuter per cluster, re-running the mutations itself' },
  ],
}

/**
 * `args` arrives as a JSON STRING, not an object. `const D = args || {}` left
 * every field undefined and a whole fan-out silently ran on defaults.
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

const DOMAIN = D.domain
const LEDGER = D.ledger || ''
const OWNS = D.owns || []
const FOCUS = D.focus || ''
const SURVEYORS = D.surveyors ?? 6
const MAX_CLUSTERS = D.maxClusters ?? 8

if (!DOMAIN) return { error: 'no domain supplied — args did not arrive' }

const RULES = `
You are implementing the Tenure platform in C:/Users/satvi/Tenure-Parent (branch main).

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure (remote "live").
  It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, or rewrite history. The orchestrator does that.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
  Never weaken a guard, loosen a ratchet, or delete an assertion to get green.
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or money movement.
- Never treat an AI, agent, operator or test result as human approval.

QUALITY BAR — zero mocks, zero placeholders, zero stubs:
- Real code reached by a real production caller. A type or helper nothing calls is dead code,
  and dead code carrying a comment claiming otherwise is worse than nothing. Name the caller.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run the test, CONFIRM IT FAILS,
  restore, confirm it passes. Report each mutation and both results.
- Beware the fake test: a stand-in returning a canned value regardless of the code under test
  proves nothing. Make it behave like the real dependency.
- If a comment or evidence string claims something untrue, fix the CLAIM, not the test.
- Do not mark PASS what is not true. A requirement titled "signed X" is not PASS while X is
  unsigned. BLOCKED_ARCHITECTURE with an honest reason is worth more than a false PASS.
- docs/architecture/REVIEW-FINDINGS.md overrides PLATFORM-ARCHITECTURE.md where they disagree.
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
          id: { type: 'string' },
          title: { type: 'string' },
          why_open: { type: 'string', description: 'file:line evidence it is NOT already implemented' },
          files: { type: 'array', items: { type: 'string' } },
          smallest_real_change: { type: 'string' },
          already_done: { type: 'boolean' },
        },
      },
    },
  },
}

const CLUSTER_SCHEMA = {
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
          status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'BLOCKED_ARCHITECTURE', 'NOT_APPLICABLE'] },
          summary: { type: 'string' },
          mutation_proof: { type: 'string' },
          caller: { type: 'string' },
          blocked_reason: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'type-check and test commands run, with results' },
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

phase('Survey')
log(`${DOMAIN}: ${SURVEYORS} surveyors over ${OWNS.length} owned paths`)

const surveys = await parallel(
  Array.from({ length: SURVEYORS }, (_, i) => () =>
    agent(
      `${RULES}

Survey the ${DOMAIN} domain. Read in this order:
  1. docs/architecture/capability-completeness-registry.yaml — requirements whose id starts "${DOMAIN}-"
  2. ${LEDGER}
  3. The Bible documents those requirements cite, and docs/architecture/REVIEW-FINDINGS.md
  4. The real code under: ${OWNS.join(', ')}

${FOCUS ? 'DOMAIN FOCUS: ' + FOCUS : ''}

You are surveyor ${i + 1} of ${SURVEYORS}: take the ${DOMAIN} requirements whose position in the
registry, counted in order, satisfies (index %% ${SURVEYORS}) === ${i}.

Decide from the REAL CODE whether each is genuinely unimplemented. Be sceptical of the ledger:
an item marked open may be done, and one marked done may be a declaration with no caller.

Report up to 10 genuinely-open items. For each give file:line evidence, the exact files, and the
smallest change that would make it really true. Group your files tightly — items that share a
file area will be implemented together by one agent, so name real neighbouring files.

Do not edit anything in this phase.`,
      { label: `survey:${DOMAIN}:${i + 1}`, phase: 'Survey', schema: SURVEY_SCHEMA },
    ),
  ),
)

const pool = surveys
  .filter(Boolean)
  .flatMap((s) => s.items || [])
  .filter((it) => it && !it.already_done && (it.files || []).length > 0)

// Cluster by file area rather than one agent per requirement.
//
// The cost of an agent is dominated by reading itself into the area, not by the
// edit — so eight requirements in one area cost barely more than one, and a
// 1:1 agent-per-item fan-out spends most of its budget re-reading the same
// files. Clusters are disjoint by construction, so they still cannot collide.
const areaOf = (f) => {
  const p = String(f).split('\\').join('/').split('/')
  if (p[0] === 'packages') return `packages/${p[1]}`
  if (p[0] === 'apps' && p[2] === 'src' && p[3] === 'lib') return p.slice(0, 5).join('/')
  return p.slice(0, 4).join('/')
}

const clusters = new Map()
const seen = new Set()
for (const it of pool) {
  if (seen.has(it.id)) continue
  seen.add(it.id)
  const area = areaOf((it.files || [])[0])
  if (!clusters.has(area)) clusters.set(area, [])
  clusters.get(area).push(it)
}

const work = [...clusters.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, MAX_CLUSTERS)
  .map(([area, items]) => ({ area, items }))

const covered = work.reduce((n, c) => n + c.items.length, 0)
log(`${DOMAIN}: ${pool.length} open -> ${work.length} clusters carrying ${covered} requirements`)

if (work.length === 0) return { domain: DOMAIN, confirmed: [], note: 'survey found nothing open' }

const results = await pipeline(
  work,
  (c) =>
    agent(
      `${RULES}

Implement ALL ${c.items.length} requirements below. They share the file area ${c.area}, which is
why they are one task: read yourself into that area once and do them together.

FILES YOU OWN — these, plus tests beside them and the ledger ${LEDGER}:
${[...new Set(c.items.flatMap((i) => i.files || []))].map((f) => '  - ' + f).join('\n')}

YOU ALSO OWN THE CALL SITES THAT CONSUME THEM.

This is deliberate and it is the most important instruction here. A previous run confined
each agent to a single package, and every single package requirement came back
BLOCKED_ARCHITECTURE for the same reason: the improvement was real but nothing called it,
and the wiring lived one directory outside the allowlist. Cache invalidation with no cache
constructed. An audit chain whose writers never pass a sequence. Correct code, zero effect.

So: trace the consumers of what you change and wire them. If \`packages/x\` gains a capability,
find who should call it in \`apps/web\` or \`apps/system-studio\` and make them call it. Editing a
call site to actually use your change is IN SCOPE and expected.

The limit is topical, not directory-based: touch what your requirements genuinely need and
nothing else. Do not refactor a file you happen to open. If another agent has clearly edited a
file since you read it, re-read before editing rather than overwriting.

If a requirement truly cannot be finished — it needs a schema migration, an external
credential, a decision only a human can make — return BLOCKED_ARCHITECTURE or BLOCKED_EXTERNAL
for THAT requirement, naming exactly what was needed, and still finish the others.
"I was not allowed to wire it" is no longer an acceptable blocker.

REQUIREMENTS:
${c.items.map((i, n) => `${n + 1}. ${i.id} — ${i.title}\n   open because: ${i.why_open}\n   smallest real change: ${i.smallest_real_change}`).join('\n\n')}

Re-verify each before trusting the survey — another agent wrote it. If the code already
satisfies one, return NOT_APPLICABLE with the file:line proving it; that is a real answer.

For each requirement you implement: wire it to a caller, test it, MUTATE the behaviour, confirm
the test reds, restore, confirm green. Put every mutation and its result in mutation_proof.
Then run \`npm run type-check\` (0 errors — you share this tree, so check an error is yours) and
the narrowest test command covering your files, and append each entry to ${LEDGER}.

Return one result per requirement. Statuses: PASS / FAIL / BLOCKED_EXTERNAL /
BLOCKED_ARCHITECTURE / NOT_APPLICABLE. There is no PARTIAL.`,
      { label: `cluster:${c.area}`, phase: 'Implement', schema: CLUSTER_SCHEMA },
    ),
  (out, c) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { cluster: c, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven in ${c.area}. Default refuted=true for each; set false ONLY for ones you verified.

${claimed.map((r) => `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation: ${r.mutation_proof}`).join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ')}

For EACH claim check, in order:
  1. Reachable from a production call path? Trace it. Dead code fails.
  2. RE-RUN THE MUTATION yourself — apply, run, observe, restore. Do not take their word.
  3. Is any test's stand-in canned, proving nothing regardless of the code? Fake test.
  4. Does any new comment or string claim something untrue?
  5. Was a guard weakened, a ratchet loosened, or an assertion deleted to get green?

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you did.`,
      { label: `refute:${c.area}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ cluster: c, out, verdicts: v }))
  },
)

const rows = []
for (const r of results.filter(Boolean)) {
  const verdictFor = new Map((r.verdicts?.verdicts || []).map((v) => [v.id, v]))
  for (const res of r.out?.results || []) {
    const v = verdictFor.get(res.id)
    rows.push({
      id: res.id,
      area: r.cluster.area,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy: res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
      caller: res.caller,
      blocked: res.blocked_reason,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${DOMAIN}: ${confirmed.length} confirmed of ${rows.length} attempted`)

return {
  domain: DOMAIN,
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
}
