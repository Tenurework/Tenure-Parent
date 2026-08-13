export const meta = {
  name: 'tenure-audit-incoming',
  description: 'Adversarially audit a range of commits written by another agent, through independent lenses',
  whenToUse: 'Work arrived from another author and has not been refuted',
  phases: [
    { title: 'Audit', detail: 'one reviewer per lens, each blind to the others' },
    { title: 'Confirm', detail: 'a second opinion on every finding, defaulting to refuted' },
  ],
}

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

const RANGE = D.range || 'f7a1ec2..HEAD'
const OFF_LIMITS = D.offLimits || []

const BASE = `
You are auditing C:/Users/satvi/Tenure-Parent (branch main), commit range ${RANGE}.

These commits were written by a DIFFERENT agent and have never been independently
refuted. CI is green on them, which is exactly why this pass exists: every defect worth
finding here is one CI cannot see.

NON-NEGOTIABLE:
- Do NOT commit, push, reset, stash, or rewrite history. Do not touch the "live" remote.
- Do not read, print or copy secret VALUES.
- Never weaken a guard, loosen a ratchet or delete an assertion.

DO NOT EDIT these files — another workflow is actively rewriting them right now:
${OFF_LIMITS.map((f) => `  - ${f}`).join('\n') || '  (none)'}
If a finding lives in one of those, REPORT it rather than fixing it.

WHAT TO HUNT. Every one of these actually shipped in this repository in the last week,
green, and was found only by someone looking for it:

  · A GUARD THAT CANNOT FAIL — \`if (false && …)\`, \`|| true\` in a condition, a
    \`// MUTATION\` stub left in a shipped path, a matcher that returns [] for every input.
    Five of these were found. \`grep -rn "false &&\\|| true)\\|// *MUTATION"\` is the start,
    not the end: also look for a predicate that is always true, a filter that never
    filters, and a catch that swallows the only error worth reporting.
  · A FABRICATED FACT — an approval, review, certification, verification date or
    "reviewed by" that no human gave. One shipped as APPROVED with invented dates in a
    file whose own comment argued that was the one untrue state.
  · DEAD CODE CLAIMING A CALLER — an export whose comment names a caller that does not
    exist, or a capability wired to nothing. Trace it; do not trust the comment.
  · A FAKE TEST — a stand-in returning a canned value regardless of the code under test,
    or an assertion that passes on an empty list because nothing was collected.
  · A WIDENED TYPE with construction sites left unswept.
  · A GENERATED ARTEFACT that is checkout-dependent — native path separators in a sort
    key, unsorted readdir, hashing raw CRLF bytes, or a walk that picks up test output.
  · A REFUSAL THAT LIES — a surface rendering "none" or "0" where the truth is "we were
    not allowed to look", or a 500 where a named UNKNOWN belonged.

Report only what you have VERIFIED by reading the code and, where you can, by running it.
A suspicion is not a finding. For each finding give the file and line, what is actually
wrong, and the failure a user or operator would experience.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'what', 'failure_scenario', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          what: { type: 'string' },
          failure_scenario: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          fixed: { type: 'boolean' },
          fix_summary: { type: 'string' },
        },
      },
    },
    what_is_good: { type: 'string', description: 'what this range got right, named specifically' },
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
        required: ['file', 'real', 'reason'],
        properties: {
          file: { type: 'string' },
          real: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'auth',
    what: `AUTHENTICATION AND AUTHORISATION. The range includes "Use Cognito for Studio auth", which
replaces a shared-secret Credentials provider on the console that composes, provisions and
advances EVERY tenant in the estate. Audit it as the highest-value target in the repository.

Ask: is the token actually verified — issuer, audience, expiry, signature against the JWKS —
or merely decoded? Is the operator allowlist still consulted per request, so removing someone
takes effect immediately rather than at token expiry? Can a valid Cognito token from a
DIFFERENT pool or a different client id sign in? Is the old shared-secret path fully gone or
still reachable as a fallback? Does a refusal leak whether the address was known?

PLATFORM_OPERATORS is \`email:role\` and production holds exactly ONE entry,
satvik@Tenurework.com:platform-super-admin. Verify that a Cognito identity outside that list
cannot reach a single operator surface, and that the role is read from the allowlist rather
than from a token claim — a role claim in a token is an authorization claim, which P4 and D9
of the architecture forbid.`,
  },
  {
    key: 'aws',
    what: `THE AWS READ PATH. The range includes "Observe retained tenant resources", "Wire Studio log
diagnostics to OIDC" and "Fix Studio post-login fleet crash".

STUDIO-000-007 is the law: a denied API call is UNKNOWN, never absent. Check every new read
for the specific failure of rendering an empty list where the truth is AccessDenied, a
throttle, or a call that was never made. Check that region and partition come from the
resolved identity rather than a literal — a hardcoded us-east-1 caused GE-010-007, a data-
residency defect. Check that the console still BOOTS without credentials: refusing to invent
an estate is correct, a 500 on the home page is not.

"Fix Studio post-login fleet crash" is worth reading closely: the crash was FleetMisconfigured
thrown because the account could not be resolved. Verify the fix resolves the account or
renders a named UNKNOWN — and did not simply reinstate a default, which would silently place
tenants in an estate nobody chose.`,
  },
  {
    key: 'ui',
    what: `THE MATERIAL 3 SCAFFOLD AND THE RESPONSIVE FIXES. The range includes "Redesign Studio scaffold
with Material 3 tokens", "Fix config editor mobile reflow", "Fix health explanation reflow at
mobile widths", "Fix health verdict reflow at mobile widths", "Add responsive configuration map".

Check the token layer for the thing that makes a design system real: does every colour pair
actually clear WCAG AA in light, dark AND high contrast, or were tokens chosen by eye? Is
pure black or pure white used anywhere — preferences.spec.ts forbids both. Do the components
consume tokens, or do literals survive beside them?

For the reflow fixes: were they fixed by making the layout work at 320px, or by hiding
content, clamping text, or lowering a tolerance? Hiding a fact at small width is a different
product, not a responsive one. Check whether any table stopped scrolling and started
truncating.`,
  },
  {
    key: 'wiring',
    what: `THE INTEGRATION CLAIMS. The range includes "Wire Slack setup references into Studio",
"Complete CAT import graph wiring", "Expose Platform progress and CFG import proof" and
"Stop web build fetching remote fonts".

For each, the question is the same and it is the one this programme keeps failing: is the
thing WIRED, or merely declared? Trace every new export to a production caller and name it.
"Complete … wiring" and "Expose …" are exactly the phrasings that have previously meant a
correct module with no caller.

For the CFG import proof and Platform progress: verify the numbers shown are DERIVED from
the ledgers and the document graph rather than written down. A progress figure somebody
typed is worse than none, because it is believed.

For the fonts change: confirm the build genuinely no longer reaches the network, and that
the fallback is a real self-hosted face rather than a system-font substitution that changes
every metric the layout was tuned against.`,
  },
]

phase('Audit')
log(`Auditing ${RANGE} through ${LENSES.length} independent lenses`)

const audits = await pipeline(
  LENSES,
  (lens) =>
    agent(
      `${BASE}

YOUR LENS — ${lens.key.toUpperCase()}. Other reviewers are covering other ground; stay on yours
so the coverage is real rather than four people reading the same diff.

${lens.what}

Start with \`git log --oneline ${RANGE}\` and \`git diff ${RANGE} --stat\`, then read the diffs
that fall in your lens. Read the FILES, not only the diffs — a defect is often what the change
failed to update.

Where a finding is safely fixable and NOT in the off-limits list, fix it and set fixed=true
with a fix_summary. Where it is not, report it precisely enough that someone else can.

Also report what this range got RIGHT, specifically. A review that only finds fault is not a
review, and the next decision depends on knowing which parts are load-bearing.`,
      { label: `audit:${lens.key}`, phase: 'Audit', schema: FINDING_SCHEMA, effort: 'high' },
    ),

  (out, lens) => {
    const claims = (out?.findings || []).filter((f) => f.severity === 'critical' || f.severity === 'high')
    if (claims.length === 0) return { lens, out, verdicts: null }
    return agent(
      `${BASE}

You are a SECOND OPINION on ${claims.length} findings another reviewer reported in the
${lens.key} lens. Default real=false for each; set true ONLY where you have confirmed it
yourself against the code.

${claims.map((f) => `- ${f.file}${f.line ? `:${f.line}` : ''} [${f.severity}] ${f.what}\n  claimed failure: ${f.failure_scenario}\n  fixed already: ${f.fixed ? 'yes — ' + (f.fix_summary || '') : 'no'}`).join('\n\n')}

A finding is real only if you can state the concrete input or state that produces the failure.
"This looks fragile" is not real. "A Cognito token from another pool is accepted because the
audience is never compared" is real — if the code says so.

Where the reviewer already applied a fix, check the FIX as well: does it hold, and did it
weaken anything to hold?`,
      { label: `confirm:${lens.key}`, phase: 'Confirm', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ lens, out, verdicts: v }))
  },
)

const all = []
for (const a of audits.filter(Boolean)) {
  const verdictFor = new Map((a.verdicts?.verdicts || []).map((v) => [v.file, v]))
  for (const f of a.out?.findings || []) {
    const v = verdictFor.get(f.file)
    all.push({
      ...f,
      lens: a.lens.key,
      confirmed: f.severity === 'critical' || f.severity === 'high' ? v?.real === true : null,
      secondOpinion: v?.reason,
    })
  }
}

const serious = all.filter((f) => f.confirmed === true)
log(`${serious.length} confirmed serious findings of ${all.length} reported`)

return {
  range: RANGE,
  confirmedSerious: serious,
  unconfirmed: all.filter((f) => f.confirmed === false),
  lowerSeverity: all.filter((f) => f.confirmed === null),
  strengths: audits.filter(Boolean).map((a) => ({ lens: a.lens.key, what: a.out?.what_is_good })),
}
