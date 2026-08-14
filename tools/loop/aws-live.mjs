export const meta = {
  name: 'aws-live',
  description:
    'Make the AWS reads reach the screen: wire the eleven readers no surface consumes, register them for live polling, and give the console an export',
  whenToUse:
    'The SDKs, capabilities and readers exist — 38 packages, 114 capabilities, 50 modules — and eleven of those modules render nowhere. The operator sees a console with no live data and is right to.',
  phases: [
    { title: 'Wire', detail: 'one agent per surface, disjoint page ownership' },
    { title: 'Refute', detail: 'independent refuters that re-run every mutation' },
  ],
}

const RULES = `
You are building the Tenure System Studio in C:/Users/satvi/Tenure-Parent, on branch "main".
Other agents are working in this tree on the SHELL (layout.tsx, globals.css, Nav.tsx,
components/md3/*, signin/**, PreferencesMenu, infrastructure/studio/*.tf). Touch ONLY the
files named as yours.

NON-NEGOTIABLE SECURITY CONSTRAINTS:
- NEVER push, commit or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit/push/reset/stash/checkout, and do not run \`git add -A\`.
- Do NOT weaken the production-disarming guards, and do not touch \`deploy-studio.yml\`'s
  \`workflow_run\` gate.
- READ-ONLY AWS. Do not add a capability, command or code path that creates, updates, deletes,
  puts, sends or invokes. \`src/lib/aws/mutate.ts\` is the only place mutations live and you are
  not extending it.
- Do not read, print, copy or rotate secret VALUES.

═══ WHY YOU EXIST ═══

The operator's words: "install all AWS SDKs for live data streaming and exporting from AWS
console to tenure studio. it still hasnt happned yet."

The SDKs ARE installed — 38 \`@aws-sdk/client-*\` packages, 114 capabilities, 50 reader modules
under \`src/lib/aws/\`. What has not happened is the part that matters: ELEVEN of those readers
are imported by no page at all, so the work they do never reaches a screen. Measured:

    cdn  certificates  compliance  dashboards  dns  guardduty  logs
    organization  pricing  quotas  waf

Each is real, tested code with a capability and an IAM grant, reaching nothing. That is the
same reachability failure the services wave was refuted for, still standing.

═══ THE STANDARD ═══
- Real code reached by a real production caller. Name the route that renders it.
- A denied, throttled, unconfigured or errored read renders through the shared
  \`components/md3/UnknownState\`, carrying the principal, the action and a pasteable minimum
  IAM statement. NEVER an empty list, a zero, or a reassuring default. \`AwsRead<T>\` has no arm
  carrying an optional \`T\`, so reaching \`.value\` on a failed read does not compile — keep it.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm green. Report each mutation and both results.
- Close a REAL requirement id from
  \`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md\`, and append your
  entry to \`docs/implementation/system-studio-aws-control-plane-execution-ledger.md\` in the
  format already there — Status, Reason, Evidence naming a command and a count. Append only.
  Never invent an id.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact unblocking commands, beats a false PASS.

═══ HOUSE FACTS ═══
- Any route calling \`authorizeCommand\`/\`isOperator\`/\`auth()\`/\`operatorConfigProblems\` MUST
  declare \`export const dynamic = "force-dynamic"\` or Next prerenders it at BUILD time and the
  authorization check never runs in production —
  \`tests/architecture/authorizing-routes-are-dynamic.test.mjs\` holds this.
- \`layout.spec.ts\` runs every route at 1440, 1180, 900 and 320px: no overlapping text, nothing
  overflowing its container, no sideways page scroll. It PRINTS the offending element when a
  page scrolls — read the message rather than guessing. \`globals.css\` gives
  \`overflow-wrap: anywhere\` to \`p, li, dt, dd, code, .slug, .chip, legend\` — NOT to \`span\`,
  NOT to \`td\`. A flex item defaults to \`min-width: auto\`; \`.row\` and \`.cell\` carry
  \`min-inline-size: 0\` for that reason.
- apps/system-studio must NOT import a Prisma client.
- Do NOT run \`npm run generate\` or \`npm install\` — the orchestrator does both, once.
- Unit tests: \`npm run test --workspace apps/web -- --ci <path>\` (the Studio has no jest of its
  own; apps/web's \`roots\` include \`../system-studio/src\`).
- Verify your files compile: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`. Errors in
  other agents' files are expected mid-flight — report only yours.
- Local harness, if you need the browser: \`npx dynalite@3.2.2 --port 8001\`, then
  \`node tools/create-registry-table.mjs\` and \`node tools/dev/seed-studio-fleet.mjs\` with
  \`AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci\`,
  \`npm run studio:build\`, then \`node .next/standalone/apps/system-studio/server.js\`
  (\`next start\` cannot serve \`output: standalone\`). Use your own port if 3100 is taken.
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
    readers_wired: { type: 'array', items: { type: 'string' } },
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

const WORK = [
  {
    key: 'edge',
    owns:
      'apps/system-studio/src/app/platform/network/page.tsx and everything else under that directory, plus apps/system-studio/e2e/network-surface.spec.ts',
    readers: 'cdn, dns, certificates, waf',
    what: `Four dark readers belong on the network surface and none of them renders.

  · \`cdn\` — CloudFront distribution CONFIG and invalidations. Origins and their protocol
    policy, minimum TLS, whether a WAF web ACL is attached, cache behaviours that bypass the
    cache, and invalidations still InProgress. An origin reachable over plain HTTP and a
    distribution with no WAF are the findings. An invalidation InProgress is the most common
    cause of "I deployed and cannot see my change" in this estate — surface it.
  · \`dns\` — Route 53 record sets, and the one question this estate has: does the DNS for a
    tenant point at OUR distribution. A record aliasing something the estate does not own is a
    subdomain takeover, and it belongs at the top when present.
  · \`certificates\` — ACM in detail: validation status, days to expiry as a NUMBER so the table
    can rank by it, renewal eligibility, and the exact CNAME still required when validation is
    pending. A certificate stuck PENDING_VALIDATION is the commonest cause of a stalled tenant
    provision.
  · \`waf\` — web ACLs and, per resource, whether anything is actually behind one. If WAFv2 is
    not in use the honest render is a clear finding with what it would take, NOT an empty table
    that reads like nothing is wrong. A successful-empty and an AccessDenied mean opposite
    things and must look different.

CORRELATE, do not just stack four tables. The value here is the join: a DNS record → the
distribution it aliases → that distribution's certificate expiry → whether a WAF sits in front.
A broken edge is a chain, and the page should show the chain.`,
  },
  {
    key: 'security',
    owns:
      'apps/system-studio/src/app/platform/security/page.tsx and everything else under that directory, plus apps/system-studio/e2e/security-surface.spec.ts',
    readers: 'guardduty, compliance',
    what: `Two dark readers belong on the security surface.

  · \`guardduty\` — whether a detector exists and is ENABLED, which protection plans are on,
    and findings by severity with their type verbatim (\`UnauthorizedAccess:EC2/SSHBruteForce\`,
    not a paraphrase).
  · \`compliance\` — AWS Config rules and their compliance, PLUS whether the recorder is
    actually recording and over which resource types.

THE RULE THIS PAGE IS BUILT ON, and both readers exist to serve it: an absence of findings
from a control that is not running is NOT a pass. A disabled GuardDuty detector reporting zero
findings, and a Config rule sitting at INSUFFICIENT_DATA, must each render VISIBLY DIFFERENTLY
from "checked and clean". \`lib/aws/posture.ts\` already models four states — pass, fail,
not-checked with reason and remedy, unknown — so use it rather than inventing a fifth vocabulary,
and make sure a clean summary is uncomputable while not-checked or unknown is non-zero.`,
  },
  {
    key: 'observability',
    owns:
      'apps/system-studio/src/app/platform/health/page.tsx and everything else under that directory, plus apps/system-studio/e2e/health-page-logic.spec.ts',
    readers: 'dashboards, logs',
    what: `Two dark readers belong on the health surface.

  · \`logs\` — log group retention posture (a group set to "never expire" is an unbounded bill
    and a compliance problem; one at a single day is a lost incident), stored bytes, KMS key,
    metric filters, and THE AGE OF THE MOST RECENT EVENT. A log group that has received
    nothing for longer than its service's deploy cadence means the thing writing to it stopped,
    which reads exactly like calm.
  · \`dashboards\` — which CloudWatch dashboards exist, when each changed, and which metrics and
    alarms they reference, parsed out of the dashboard body.

THE JOIN THAT MAKES THIS WORTH RENDERING: coverage. Which of the estate's services appear on
NO dashboard and in NO alarm — that intersection is the part of the fleet nobody is watching,
and neither reader can say it alone. \`dashboards\` returns referenced namespaces and alarm
names as structured data precisely so this page can compute it against the inventory.`,
  },
  {
    key: 'engine',
    owns:
      'apps/system-studio/src/app/platform/page.tsx, apps/system-studio/src/app/platform/engine-answer.ts and its test, plus apps/system-studio/e2e/platform.spec.ts',
    readers: 'quotas, organization',
    what: `Two dark readers belong on the engine's own state page.

  · \`quotas\` — Service Quotas for the services this estate uses, applied value against
    default, and whether it has been raised. A distribution engine that provisions a tenant
    stack discovers a quota boundary at 2am during a provisioning run; this is the page that
    should have said so first. Where a usage number is available express headroom as
    used-of-applied; where it is not, show the quota alone and SAY usage is not known rather
    than implying full headroom.
  · \`organization\` — whether an AWS Organization exists, its accounts and roots. The estate
    does not have one, and that is a real answer with consequences for STUDIO-010-*: say it
    plainly rather than rendering an empty table.

This page is the console describing ITSELF. Ground every number in a committed artefact or a
live read with a staleness check — never hand-enter one.`,
  },
  {
    key: 'cost',
    owns:
      'apps/system-studio/src/app/platform/cost/page.tsx and everything else under that directory, plus apps/system-studio/e2e/cost.spec.ts',
    readers: 'pricing',
    what: `The AWS Price List reader renders nowhere, and this is the page that needs it.

The standing product requirement: every configuration option carries a price tag — per seat
AND for the whole organisation — with a running total, so cost is known before the decision.
That number is only worth having if it is grounded, and today the catalog's rates are
transcribed.

\`lib/aws/pricing.ts\` reads the real on-demand rates for the shapes this estate provisions.
Surface them here: what the fleet's shapes actually cost per unit, beside the budget and the
month-to-date figure this page already shows, so an operator can see the rate a quote was
built from.

MONEY RULES, not negotiable: integer minor units, explicit currency, never a float. A rate
that could not be resolved is UNKNOWN and must propagate — a total that silently treats an
unpriced item as free is the exact cost surprise the requirement exists to prevent. Quoting
only; nothing on this path moves money.

\`e2e/cost.spec.ts\` is yours and pins the approval-threshold band chain — each band starting
where the last ended. Keep that intact.`,
  },
  {
    key: 'live',
    owns:
      'apps/system-studio/src/lib/aws/result.ts, apps/system-studio/src/app/api/aws/[surface]/route.ts, and apps/system-studio/e2e/api-contract.spec.ts',
    what: `LIVE DATA. The operator asked for "live data streaming … from AWS console to tenure
studio", and the seam already exists: \`/api/aws/[surface]\` is a read-only polling endpoint
with per-operator, per-surface rate limits, and \`SURFACES\` in \`lib/aws/result.ts\` is the
registry of what it can serve.

Register the surfaces the newly-wired readers feed, each with its OWN window — a queue depth
and a certificate expiry do not move at the same speed, and one global TTL is how a console
both throttles the account and shows stale numbers. Every capability already carries its own
refresh cadence in \`capabilities.ts\`; derive the window from that rather than picking a number.

Then make the polling honest, which is the part that is easy to get wrong:
  · a poll that was DENIED or THROTTLED must not overwrite a good value on screen with a zero,
    and must not silently retry forever — it reports its state;
  · every response carries its "as of" and the cadence it was read at, so a client can show
    staleness rather than implying "now";
  · the rate limiter is per operator per surface and must keep working when a page polls
    several surfaces at once.

There must remain NO way to express "call this arbitrary AWS action": \`call()\` switches on the
capability deliberately, and this route must not become a generic runner. Bible §20 forbids it
in those words — "Create a generic 'AWS action runner' endpoint."`,
  },
  {
    key: 'export',
    owns:
      'apps/system-studio/src/app/api/export/route.ts (new) and its directory, apps/system-studio/src/lib/aws/export.ts (new) and its test, plus apps/system-studio/e2e/export.spec.ts (new)',
    what: `EXPORT. The operator asked for "exporting from AWS console to tenure studio" and the
console has none — nothing in \`src/\` sets a \`Content-Disposition\`.

Give an operator the estate as data they can take away: the inventory, the coverage table, the
drift report and the posture findings, as CSV and as JSON.

WHAT MAKES THIS HARD AND WORTH DOING PROPERLY:
  · An export must carry its PROVENANCE — which account, which region, which capability
    produced each row, and the "as of" per row. An estate export with no timestamps is a
    screenshot with commas in it.
  · A DENIED read must appear in the export as a denied read, not as a missing row. An export
    that silently omits what could not be read is the same lie as a zero on a page, and it is
    worse because it leaves the building. Give every row a state column.
  · CSV injection is a real vulnerability: a field beginning \`=\`, \`+\`, \`-\` or \`@\` is executed
    by Excel. Escape it. Add a test with a field starting \`=cmd\` and prove it comes out inert.
  · Authorization is per request, server-side, through \`authorizeCommand\` — an export is a
    bulk read of the whole estate and is exactly the endpoint that must not be reachable by an
    operator family that cannot read the pages it aggregates.
  · No secret values, no raw user attributes, no access key material. Access key IDs are fine
    (an id is not a credential); anything that authenticates is not.

Return the file with a \`Content-Disposition\` naming the account, the surface and the date.`,
  },
]

phase('Wire')
log(`${WORK.length} surfaces — wiring 11 readers that reach no screen, plus live polling and export`)

const built = await pipeline(
  WORK,

  (item) =>
    agent(
      `${RULES}

TASK — ${item.what}

${item.readers ? `THE READERS YOU ARE WIRING: ${item.readers}. Read each module first and consume what it exports; do NOT rewrite them, and do NOT read AWS directly from a page — the reader is the only path to the SDK.\n` : ''}
YOU OWN, exclusively: ${item.owns}

Nothing else. Six sibling agents are wiring other surfaces, and a separate wave is rebuilding
the SHELL — layout.tsx, globals.css, Nav.tsx, components/md3/*, signin/** and the top bar are
being rewritten this hour by other agents. Consume the MD3 primitives; do not edit them. If one
you need is missing, say so in your result rather than forking it.

Pick the requirement id you are closing from the Bible and report under it. If what you
deliver does not satisfy that requirement's own sentence end to end, report FAIL with what
remains — a partial answer recorded as PASS is the one outcome this programme cannot absorb.`,
      { label: `live:${item.key}`, phase: 'Wire', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  (out, item) => {
    const claimed = (out?.results || []).filter((r) => r.status === 'PASS')
    if (claimed.length === 0) return { item, out, verdicts: null }
    return agent(
      `${RULES}

You are a REFUTER. An agent claims these ${claimed.length} requirements are implemented and
proven in: ${item.owns}. Default refuted=true; set false ONLY for what you verified yourself.

${claimed
  .map(
    (r) =>
      `- ${r.id}: ${r.summary}\n  caller: ${r.caller || '(none named)'}\n  mutation claimed: ${r.mutation_proof}`,
  )
  .join('\n\n')}

Files changed: ${(out.files_changed || []).join(', ') || '(none reported)'}

For EACH claim:
  1. IS IT ACTUALLY ON A PAGE? This wave exists because eleven readers were real, tested and
     rendered nowhere. Trace the import from the route's default export to the reader. If the
     module is imported but its value never reaches JSX, that is the same defect wearing a
     different coat — refute it.
  2. Open the Bible's wording for the id. Does the delivered thing satisfy the SENTENCE?
  3. RE-RUN THE MUTATION — apply, run, OBSERVE the failure, restore, confirm green.
  4. Can a DENIED, THROTTLED or NOT-ENABLED read render as an empty list, a zero, or a
     reassuring default anywhere in what they wrote? Follow every read to its render site.
     A disabled detector showing "0 findings" is the highest-value catch on this wave.
  5. For the export agent specifically: does a field beginning \`=\` come out inert? Try it. Is
     a denied read present as a denied row rather than absent? Is authorization checked
     server-side per request?
  6. For the live agent: is there now any way to name an arbitrary AWS action through the
     route? Bible §20 forbids a generic action runner outright — that refutes the whole set.
  7. Did they add a WRITE path to AWS, weaken a guard, or touch the deploy gate?

Edit files ONLY to apply and restore mutations, and set tree_left_clean to whether you left it
exactly as you found it.`,
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
      surface: r.item.key,
      status: res.status,
      confirmed: res.status === 'PASS' && v?.refuted === false,
      refutedWhy:
        res.status === 'PASS' && v?.refuted !== false ? v?.reason || 'no verdict returned' : undefined,
      summary: res.summary,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${confirmed.length} confirmed of ${rows.length} attempted`)

return {
  program: 'aws-live',
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  notPass: rows.filter((r) => r.status !== 'PASS'),
  wired: built.filter(Boolean).flatMap((r) => r.out?.readers_wired || []),
}
