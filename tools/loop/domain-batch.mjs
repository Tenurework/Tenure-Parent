export const meta = {
  name: 'domain-batch',
  description:
    'One agent per domain, each closing its own next requirements against its own ledger — seventeen disjoint file sets, every claim refuted by somebody who did not write it',
  whenToUse:
    'The general engine for the 2,265-item programme. `node tools/loop/next-batch.mjs --size 60 --json` hands out work that is already partitioned by domain, so seventeen agents can run without ever touching the same file.',
  phases: [
    { title: 'Close', detail: 'one agent per domain, owning its ledger and its docs' },
    { title: 'Refute', detail: 'independent refuters that re-derive every claimed inventory from the tree' },
  ],
}

/**
 * The domains, and the file set each agent owns exclusively.
 *
 * Partitioned by domain rather than by layer, because the queue already is: a
 * batch from `next-batch.mjs` gives every domain its own next requirements, and
 * each domain has exactly one ledger. Two agents in one ledger is the collision
 * this programme exists to avoid — the previous run lost work to it twice.
 */
const DOMAINS = [
  { key: 'ANL', name: 'Analytics, Reporting and Visualization Cloud', ledger: 'analytics-reporting-execution-ledger.md' },
  { key: 'CAT', name: 'Global Deployer Integration Catalog and Tenant Connection Composer', ledger: 'connection-composer-execution-ledger.md' },
  { key: 'CFG', name: 'Declarative Tenant Configurator and Deployer UX', ledger: 'declarative-configurator-execution-ledger.md' },
  { key: 'EXT', name: 'Global Integration Ecosystem and Connector Certification', ledger: 'integration-ecosystem-execution-ledger.md' },
  { key: 'FIN', name: 'Financial Management Cloud', ledger: 'financial-management-execution-ledger.md' },
  { key: 'GE', name: 'Global Engine', ledger: 'global-engine-execution-ledger.md' },
  { key: 'HCM', name: 'People, HR and Workforce Cloud', ledger: 'people-hr-workforce-execution-ledger.md' },
  { key: 'IER', name: 'Identity, Eligibility, Entitlement, Roster and Access Continuity', ledger: 'identity-eligibility-entitlement-execution-ledger.md' },
  { key: 'INT', name: 'Global Integration Ecosystem', ledger: 'integration-ecosystem-execution-ledger.md' },
  { key: 'OPS', name: 'Operations, Supply, Manufacturing and Service Cloud', ledger: 'operations-cloud-execution-ledger.md' },
  { key: 'PACK', name: 'ERP Archetype and Specialized System Pack Factory', ledger: 'erp-pack-factory-execution-ledger.md' },
  { key: 'PAY', name: 'Global Payments, Treasury and Stripe Control Plane', ledger: 'payments-treasury-execution-ledger.md' },
  { key: 'PLN', name: 'Planning, EPM and Decision Cloud', ledger: 'planning-epm-execution-ledger.md' },
  { key: 'SIMON', name: 'Simon OSE Tenant Absorption and Global Update Inheritance', ledger: 'simon-ose-absorption-execution-ledger.md' },
  { key: 'STUDIO', name: 'System Studio AWS Authoritative Control Plane', ledger: 'system-studio-aws-control-plane-execution-ledger.md' },
  { key: 'TTES', name: 'Tenant Experience System and Product UI/UX', ledger: 'tenant-experience-execution-ledger.md' },
  { key: 'WRK', name: 'Universal Work Graph and Workspace Connector Cloud', ledger: 'universal-work-graph-execution-ledger.md' },
]

/**
 * EXT and INT share a ledger, so they must not run as two agents.
 *
 * `integration-ecosystem-execution-ledger.md` is named by both prefixes. Two
 * agents appending rows to one markdown file interleave their writes and lose
 * each other's — which is the same defect as two agents in one source file, in
 * the one place nobody thinks to look for it.
 */
const OWNERS = (() => {
  /**
   * Domains another workflow is holding this round.
   *
   * Two workflows can run at once only while their file sets stay apart, and a
   * ledger is a file. `aws-bridge-integrate` owns the STUDIO ledger while it
   * reconciles the AWS bridge into it, so a STUDIO agent here would interleave
   * markdown writes with it and both would lose rows.
   */
  const excluded = new Set(
    (Array.isArray(args?.exclude) ? args.exclude : String(args?.exclude ?? '').split(','))
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean),
  )

  const byLedger = new Map()
  for (const d of DOMAINS) {
    if (excluded.has(d.key)) continue
    const existing = byLedger.get(d.ledger)
    if (existing) {
      existing.key += `+${d.key}`
      existing.name += ` / ${d.name}`
    } else {
      byLedger.set(d.ledger, { ...d })
    }
  }
  return [...byLedger.values()]
})()

const RULES = `
You are building the Tenure platform in C:/Users/satvi/Tenure-Parent, on branch
"studio-program" (NOT main). The working tree is shared with sixteen other agents right now:
touch ONLY the files named as yours below.

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, git checkout or rewrite history.
  The orchestrator does that. Do not run \`git add -A\`.
- Do NOT remove or weaken the production-disarming guards
  (\`if: github.repository == 'Tenurework/Tenure'\` in .github/workflows/**).
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Do not execute payments, payroll, bank instructions or money movement. Anything that
  quotes, prices or plans money is quoting only, in INTEGER MINOR UNITS with an explicit
  currency, never a float.
- Never treat an AI, agent, operator or test result as human approval.

THE FIVE THINGS THAT SHIPPED BROKEN HERE. Do not reproduce any of them:

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`,
   \`if (false && !isPaymentMode(...))\`, \`|| true\` making a loop skip every key, a
   \`// MUTATION\` stub shipped in production, and \`false && CREDENTIAL.test(write)\` making a
   credential sweep return empty for every file. Each read GREEN. If you disable a check to
   iterate, restore it before you report, and say in your result that you did.

2. A FABRICATED APPROVAL. An agent set a provider review to APPROVED with invented
   verification dates. Never write an approval, review, certification or sign-off a human
   did not give. Never invent an account id, ARN, region, price, date, benchmark or citation.

3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. An OPTIONAL field a caller omits is
   invisible to \`tsc\`. Grep every construction site of any type you change and NAME them.

4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. One claimed the pilot's slug and deleted
   the seeded institution and all 26 of its clubs. Scope every teardown to ids you made.

5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Sorting native paths, unsorted
   \`readdirSync\`, hashing raw CRLF bytes, and walking Playwright's \`error-context.md\` files
   each made a committed file "current here, stale in CI". Anything you generate must be
   byte-identical on Linux and Windows. Do NOT run \`npm run generate\` and do NOT run
   \`npm install\` — the orchestrator does both, once, against a clean tree.

THE EVIDENCE PROTOCOL. This is the whole point of the ledger and it is the thing this
programme has historically failed:
- A requirement is PASS only when real code, reached by a real production caller, does what
  the requirement says, AND a test proven to catch its absence exists. Not when a document
  describes it. Not when a type declares it. Not when a script wrote a row.
- There is no PARTIAL. An unfinished requirement is FAIL if the rest can be built now, and
  BLOCKED_EXTERNAL — naming the exact commands or the ADR that would unblock it — if it
  cannot. \`tools/loop/next-batch.mjs\` only recognises PASS, BLOCKED_EXTERNAL and
  NOT_APPLICABLE; any other word returns the item to the queue every tick, forever.
- An honest FAIL outranks a false PASS. The measured history of this programme is ~45 claims
  against 11 confirmations. A refuter re-runs your mutation and re-derives your inventory
  from the tree; a claim you cannot support will be found.
- **An inventory or a mapping is a claim about the repository.** Every row in one must name
  the file, route, table, workflow or module it came from, at a path that exists. A plausible
  document assembled from the Bible's own wording, describing code nobody has, is the single
  most likely way to fail this batch — and it is trivially detected by opening one path.

HOUSE FACTS you will otherwise rediscover the expensive way:
- Three test runners. \`npm run test --workspace apps/web -- --ci\` is jest and covers
  apps/web, packages/** AND apps/system-studio/src (its \`roots\` include them).
  \`npm run test:platform\` is plain \`node --test\` over \`tests/**\` at the repository root —
  no TypeScript, no jest globals, so a \`.test.mjs\` there must run under bare node.
  \`e2e/\` is Playwright. Use the right one and say which you used.
- apps/web targets ES2017: the regex dotAll flag \`/…/s\` is a compile error; use \`[\\s\\S]*\`.
- apps/system-studio must NOT import a Prisma client — the Studio reads AWS and DynamoDB,
  never the tenant database. \`tests/security/operator-plane-content.test.mjs\` asserts it.
- New audit writes go through \`recordAuditEvent\`; ratchets (RAW_WRITE_CEILING=32,
  UNAUTHORIZED_MUTATORS, UNCLAIMED, SHARED.size, DATABASE_EXEMPT.size) may only FALL. Raising
  one to make a build green defeats its purpose.
- A new workspace package must reach package-lock.json or \`npm ci\` kills every CI job on its
  first step.
- \`docs/architecture/REVIEW-FINDINGS.md\` OVERRIDES \`PLATFORM-ARCHITECTURE.md\` wherever they
  disagree. It names 11 P0 defects found against the real code. Read it before implementing
  anything from the architecture, or you will implement a known-broken design.
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
          evidence_paths: { type: 'array', items: { type: 'string' } },
          blocked_reason: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
    ledger_updated: { type: 'boolean' },
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

/** How many requirements each agent takes. Passed as `args` so a tick can size itself. */
const PER_DOMAIN = Number(args?.perDomain) || 3

phase('Close')
log(`${OWNERS.length} domains, ${PER_DOMAIN} requirements each — up to ${OWNERS.length * PER_DOMAIN} decided this wave`)

const built = await pipeline(
  OWNERS,

  (d) =>
    agent(
      `${RULES}

TASK — close the next ${PER_DOMAIN} undecided requirements of ONE domain: ${d.key} —
${d.name}.

YOU OWN, exclusively:
  · docs/implementation/${d.ledger} — your ledger, and nobody else's this wave
  · any NEW document you create under docs/architecture/ or docs/decisions/ whose filename
    begins with the lowercased domain prefix (e.g. \`${d.key.toLowerCase().split('+')[0]}-…\`)
  · any NEW guard test you create under tests/ whose filename begins with that same prefix
  · source files you create or change to implement your requirements, PROVIDED no other
    domain's agent would plausibly need them — see the collision rule below.

THE COLLISION RULE, and it is the reason this programme can run seventeen agents at once.
Before you edit ANY file that already exists outside your ledger and your own docs, ask
whether it is plausibly shared. These are shared and you must NOT edit them:
  apps/web/prisma/schema.prisma · apps/web/src/lib/db.ts · apps/web/src/lib/rbac.ts ·
  apps/web/src/lib/auth.ts · package.json (any) · package-lock.json ·
  .github/workflows/** · tools/document-graph.mjs · tools/platform-truth.mjs ·
  apps/system-studio/src/lib/aws/** · apps/system-studio/src/components/md3/** ·
  apps/system-studio/src/components/Nav.tsx · apps/system-studio/src/app/layout.tsx ·
  docs/implementation/NEXT-SESSION.md · any OTHER domain's ledger.
If a requirement genuinely needs one of those, return BLOCKED_EXTERNAL naming the file and
the change, and MOVE ON to the next requirement. A blocked requirement reported precisely is
worth more than a merge conflict that loses another agent's hour.

FIND YOUR WORK — do not take a list from me, derive it, so this prompt cannot go stale:

    node tools/loop/next-batch.mjs --size 80 --json

Take the first ${PER_DOMAIN} items whose id begins with ${d.key.split('+').map((k) => `"${k}-"`).join(' or ')}.
Then read, in this order:
  1. docs/implementation/${d.ledger} — the requirement's row, its Status and its Reason. If
     the Reason still says "imported from <bible>", the requirement is UNTOUCHED, and FAIL
     tells you nothing about whether anything was ever attempted.
  2. The Bible that states it — find it by grepping the repository root and docs/ for the
     requirement id. The Bible is the spec; the ledger is what has been done about it.
  3. docs/architecture/REVIEW-FINDINGS.md, if your requirement touches tenancy, RLS,
     authorization, the effective-permission rule, packs/tiers, or the audit schema. It
     overrides the architecture document and names the defects in it.

HOW TO CLOSE ONE. Most Phase-000 requirements are INVENTORIES, MAPPINGS or ADRs. Those are
not paperwork and they are not free:
  · An INVENTORY is a claim about what exists. Every row names a real path, route, table,
    workflow, module or endpoint, and you verified it by opening it. Derive it with a script
    where you can — a committed generator plus its output beats a hand-written list, because
    the list is stale the day after you write it. If you write a generator, it must produce
    byte-identical output on Linux and Windows: sort with POSIX-normalised paths, read
    directories in sorted order, never hash raw CRLF.
  · A MAPPING is a claim that two things correspond. Say what you compared, and make the
    correspondence CHECKABLE — a test that reds when one side gains an entry the other lacks
    is the difference between a mapping and a paragraph.
  · An ADR records a decision and its alternatives and consequences. It is PASS when the
    decision is made and written, not when the thing it decides is built. Follow the format
    of the ADRs already in docs/decisions/. Do NOT record a decision the operator has not
    made about money, legal terms, or production access — mark those BLOCKED_EXTERNAL.
  · An IMPLEMENTATION requirement is PASS only with real code reached by a real production
    caller, plus a test proven to catch its absence by mutation.

MUTATION-PROVE EVERYTHING YOU CLAIM. Apply the mutation, RUN it, CONFIRM IT FAILS, restore,
confirm it passes. Report the mutation verbatim and both results. For an inventory, the
mutation is to REMOVE or CORRUPT one real entry and show the check reds — if nothing reds,
your inventory is prose and its status is FAIL.

THEN WRITE THE LEDGER. For each of your requirements, update its row in
docs/implementation/${d.ledger} in the format already used there — Status, Reason, and the
evidence. Tick the checkbox only for PASS. Do not touch any other row, and do not reformat
the file.

Report each requirement with its evidence paths. If you could only close one of ${PER_DOMAIN}
honestly, report one PASS and two FAILs with reasons. That is a good result. Three false
PASSes is the worst possible one, and a refuter is going to re-derive every inventory you
claim from the tree.`,
      { label: `domain:${d.key}`, phase: 'Close', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  (out, d) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { domain: d, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER for domain ${d.key}. An agent claims these ${claimed.length} requirements
are closed. Default refuted=true for each; set false ONLY for the ones you have verified
YOURSELF, with your own hands, this run.

${claimed
  .map(
    (r) =>
      `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  evidence paths: ${(r.evidence_paths || []).join(', ') || '(none given)'}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ') || '(none reported)'}

For EACH claim, in order:
  1. OPEN EVERY EVIDENCE PATH. A path that does not exist refutes the claim outright, and is
     the single most common failure in this programme — a document assembled from the
     Bible's wording describing code nobody has. Report the first missing path by name.
  2. Read the requirement's own text in docs/implementation/${d.ledger} and in the Bible that
     states it. Does the work actually satisfy what was ASKED, or something adjacent that was
     easier? Scope drift is a refutation.
  3. If it is an INVENTORY or a MAPPING: re-derive it yourself. Count the things it claims to
     enumerate, independently — with your own grep, your own glob. A count that disagrees
     refutes it. An inventory that omits a whole category refutes it.
  4. RE-RUN THE MUTATION yourself — apply, run, OBSERVE the failure, restore, confirm green.
     If the mutation does not red anything, there is no test, and the status is FAIL.
  5. Is the status the right WORD? PASS for a document that merely describes unbuilt code is
     the defect the evidence protocol exists to stop. An ADR is PASS when the DECISION is
     written; an implementation requirement is not PASS until code runs.
  6. Does any new document, comment or ledger Reason claim something untrue — an invented
     citation, count, date, approval or benchmark?
  7. Was a guard weakened, a ratchet loosened, or an assertion deleted to get green? Read
     every deletion in \`git diff\` for these files.
  8. Did they edit a SHARED file they were told not to (schema.prisma, db.ts, rbac.ts,
     auth.ts, any package.json, package-lock.json, .github/workflows/**, another domain's
     ledger)? That refutes the whole set, because it may have destroyed a sibling's work.

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you left
it exactly as you found it.`,
      { label: `refute:${d.key}`, phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ domain: d, out, verdicts: v }))
  },
)

const rows = []
for (const r of built.filter(Boolean)) {
  const verdictFor = new Map((r.verdicts?.verdicts || []).map((v) => [v.id, v]))
  for (const res of r.out?.results || []) {
    const v = verdictFor.get(res.id)
    rows.push({
      id: res.id,
      domain: r.domain.key,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy:
        res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
      evidence: res.evidence_paths || [],
      blocked: res.blocked_reason,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(
  `${confirmed.length} CONFIRMED of ${rows.length} attempted across ${built.filter(Boolean).length} domains ` +
    `(${rows.filter((r) => r.status === 'PASS' && !r.confirmed).length} claimed-but-refuted, ` +
    `${rows.filter((r) => r.status === 'BLOCKED_EXTERNAL').length} blocked)`,
)

return {
  program: 'domain-batch',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  blocked: rows.filter((r) => r.status === 'BLOCKED_EXTERNAL'),
  failed: rows.filter((r) => r.status === 'FAIL'),
}
