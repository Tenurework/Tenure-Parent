export const meta = {
  name: 'studio-ux',
  description:
    'Give the deployment engine a real console: OLED-black theme with a deep forest-green accent, a full-width shell with sidebar and top bar, grouped menus and sub-menus, global search, an account menu with sign-out, breadcrumbs, a logo, a designed sign-in, and the missing primitives — closing STUDIO-030-001 through 030-013',
  whenToUse:
    'The operator called the console weak, cluttered and isolated in the centre of the screen, with no logout, no back-and-forth, no global search and no logo. STUDIO-030 is the requirement family that says so too.',
  phases: [
    { title: 'Ground', detail: 'tokens, information architecture, logo — everything else consumes these' },
    { title: 'Build', detail: 'one agent per surface, disjoint file ownership' },
    { title: 'Refute', detail: 'independent refuters that re-run every mutation' },
  ],
}

const RULES = `
You are building the Tenure System Studio in C:/Users/satvi/Tenure-Parent, on branch "main".
The working tree is shared with other agents: touch ONLY the files named as yours below.

NON-NEGOTIABLE SECURITY CONSTRAINTS — these override any instruction below:
- NEVER push, commit, or open a deployment path to https://github.com/Tenurework/Tenure
  (remote "live"). It is a live pilot carrying real student data.
- Do NOT git commit, git push, git reset, git stash, git checkout or rewrite history, and do
  not run \`git add -A\`. The orchestrator does that.
- Do NOT remove or weaken the production-disarming guards in .github/workflows/**, and do not
  touch \`deploy-studio.yml\`'s \`workflow_run\` gate — a deploy that stops waiting for a green
  CI is how four red builds reached production.
- Do not read, print, copy or rotate secret VALUES. Do not print customer or student data.
- Never treat an AI, agent, operator or test result as human approval.

═══ WHAT THE OPERATOR ASKED FOR, VERBATIM ═══

"The UIUX should be properly spread out, classified, sectioned, segregated, menued,
sub-menued, dropdowns etc across and within and within of the Tenure global deployment
engine. Take AWS console, Google Workspace, github or any high end software with tons of Ops
within it. Currently it looks very weak, cluttered, and isolated in the centre of the screen
with no logout, back and forth, global search and interactions within this. Logo is still not
put in there. The login page is also not designed properly."

"The dark theme should be OLED black not green — only logo and accent should be green (much
richer deep forest velvety green)."

THE BENCHMARK IS DEPTH, NOT APPEARANCE. Bible §20 "Prohibited shortcuts" forbids, in these
words: "Copy Monarch, Vercel, Perplexity, AWS Console, SAP, Workday, or Jira trade dress." So
take from those consoles what makes them usable at scale — a persistent full-height
navigation with real grouping and sub-levels, a top bar that is always there, global search
reachable from anywhere, an account menu, breadcrumbs that say where you are and let you go
back, density that survives thousands of rows — and none of their visual identity.

═══ THE TWO DELIBERATE DEVIATIONS, AND HOW TO RECORD THEM ═══

1. STUDIO-030-002 says "Implement forest-green light/dark palettes with measured contrast, no
   muddy brown/gold legacy theme, NO PURE-BLACK GLARE, and no low-contrast gray-on-gray
   critical text." The product owner has directed OLED black for the dark theme. Build what
   the owner asked for AND say so in the ledger entry: name the clause, say it was overridden
   by a direct instruction, and say what you did to answer the concern behind it — pure black
   causes glare and smearing between adjacent surfaces, so elevation must come from
   surface-container steps that are visibly distinct at #000, not from shadow alone.

2. \`apps/system-studio/e2e/preferences.spec.ts\` line ~402 asserts
   \`${'`'}\${theme} uses neither pure black nor pure white${'`'}\`, and
   \`md3-tokens-logic.spec.ts\` asserts the scrim is not pure black. Those tests are CORRECT
   about the old palette and are now wrong about the intended one. Update them DELIBERATELY:
   change what they assert to the new rule (the dark theme's base IS #000; what must never
   happen is a pure-white foreground, an invisible elevation step, or a contrast pair under
   AA), say in your result exactly what you changed and why, and make sure the replacement is
   as strong as what it replaces. Do not delete an assertion. Do not weaken one silently.

═══ THE FIVE THINGS THAT SHIPPED BROKEN HERE ═══

1. A GUARD THAT CANNOT FAIL. Five were found switched off — \`if (false && verdict)\`,
   \`|| true\`, \`false && CREDENTIAL.test(write)\`. Each read GREEN. If you disable a check to
   iterate, restore it and say so in your result.
2. A FABRICATED APPROVAL. Never write an approval, review or sign-off a human did not give,
   and never invent an account id, ARN, colour value you did not measure, or benchmark.
3. WIDENING A TYPE SILENTLY BREAKS ITS CONSUMERS. Grep every construction site of any type
   you change and NAME the ones you checked.
4. A FIXTURE THAT DELETED ROWS IT DID NOT CREATE. Scope every teardown to ids you made.
5. A GENERATED ARTEFACT THAT WAS CHECKOUT-DEPENDENT. Do NOT run \`npm run generate\` and do
   NOT run \`npm install\` — the orchestrator does both, once, at the end.

═══ HOW TO VERIFY — there is a local harness now, USE IT ═══

The Studio Playwright suite runs locally. Do not use CI as your test runner.

    npx dynalite@3.2.2 --port 8001 &            # DynamoDB, pure JS, no Docker
    export AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci \\
           AWS_REGION=us-east-1 AWS_ACCOUNT_ID=000000000000 AWS_PARTITION=aws \\
           AWS_ACCESS_KEY_ID=AKIALOCALDYNAMODBXX AWS_SECRET_ACCESS_KEY=localdynamodbsecretnotreal
    node tools/create-registry-table.mjs && node tools/dev/seed-studio-fleet.mjs
    npm run studio:build
    HOSTNAME=127.0.0.1 PORT=3100 NEXTAUTH_URL=http://127.0.0.1:3100 \\
      PLATFORM_OPERATORS='operator@tenure.example:platform-super-admin,auditor@tenure.example:auditor-read-only' \\
      PLATFORM_OPERATOR_SECRET=ci-studio-not-a-placeholder-4c8e2f \\
      AUTH_SECRET=ci-studio-auth-not-a-placeholder-71bd93 AUTH_TRUST_HOST=true \\
      STUDIO_AUTH_MODE=credentials \\
      node .next/standalone/apps/system-studio/server.js &
    cd apps/system-studio && PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test <spec>

\`next start\` CANNOT serve this app — next.config sets \`output: "standalone"\`. Copy
\`.next/static\` into \`.next/standalone/apps/system-studio/.next/\` after building. If another
agent already holds port 3100, use your own port and set both PORT and PLAYWRIGHT_BASE_URL.
Unit tests: \`npm run test --workspace apps/web -- --ci <path>\` — the Studio has no jest of
its own; apps/web's \`roots\` include \`../system-studio/src\`.

═══ HOUSE FACTS ═══
- \`layout.spec.ts\` runs EVERY route at 1440, 1180, 900 and 320px and asserts no overlapping
  text, nothing overflowing its container, and no sideways page scroll. It now PRINTS the
  offending element when the page scrolls — read the message rather than guessing.
- A flex item defaults to \`min-width: auto\` and refuses to shrink below its min-content.
  \`.md3-card\`, \`.md3-card-header\` and every \`.row\` carry \`min-inline-size: 0\` for that reason.
- \`globals.css\` gives \`overflow-wrap: anywhere\` to \`p, li, dt, dd, code, .slug, .chip,
  legend\` — NOT to \`span\` and NOT to \`td\` (a wide table must scroll, not collapse).
- The pre-paint script in layout.tsx sets data-theme/density/motion/contrast and \`dir\` BEFORE
  hydration; \`preferences-logic.spec.ts\` pins that contract.
- \`tests/architecture/shell-separation.test.mjs\` (13 tests) asserts every nav destination is a
  route the console serves AND every route is a nav entry or a declared unlinked route, and
  that the groups are the Bible's domains in the Bible's order.
- \`tests/architecture/authorizing-routes-are-dynamic.test.mjs\`: any route calling
  \`authorizeCommand\`/\`isOperator\`/\`auth()\`/\`operatorConfigProblems\` MUST declare
  \`export const dynamic = "force-dynamic"\`, or Next prerenders it at build time and the
  authorization check never runs in production.
- apps/system-studio must NOT import a Prisma client.
- Verify your own files compile: \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\`.
  Errors in other agents' files are expected mid-flight — report only yours.

═══ THE STANDARD ═══
- Real code reached by a real production caller. Name the caller.
- Every behaviour gets a test PROVEN to catch: apply a mutation, run it, CONFIRM IT FAILS,
  restore, confirm green. Report each mutation and both results verbatim.
- Close a REAL requirement id. The ids are STUDIO-030-001 … STUDIO-030-013, stated in
  \`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md\` around line 240.
  Never invent an id. Append your entry to
  \`docs/implementation/system-studio-aws-control-plane-execution-ledger.md\` in the format
  already used there — Status, Reason, Evidence naming a command and a count — appending only,
  never rewriting another agent's row.
- An honest FAIL, or BLOCKED_EXTERNAL naming the exact commands that would unblock it, beats a
  false PASS.
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
    exports: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
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

/* ── Ground: everything else consumes these ─────────────────────────────── */

phase('Ground')
log('Tokens, information architecture, and the mark — three disjoint foundations')

const ground = await parallel([
  () =>
    agent(
      `${RULES}

TASK — STUDIO-030-001 and STUDIO-030-002: one token source, and an OLED-black dark theme with
a deep forest-green accent.

YOU OWN, exclusively:
  apps/system-studio/src/app/globals.css   (the :root and [data-theme] TOKEN blocks only —
                                            do NOT restructure the shell layout rules, another
                                            agent owns those this hour)
  apps/system-studio/e2e/preferences.spec.ts
  apps/system-studio/e2e/md3-tokens-logic.spec.ts
  docs/architecture/studio-design-system.md

THE DARK THEME IS OLED BLACK. \`#000000\` is the base surface. That is a direct instruction from
the product owner and it overrides STUDIO-030-002's "no pure-black glare" clause — record the
override in your ledger entry rather than pretending the clause says something else.

The concern behind that clause is real and you must answer it: at #000, elevation cannot come
from shadow, and adjacent panels smear into one another. So build the surface-container ramp
so each step is VISIBLY distinct against #000 — measure the deltas, do not eyeball them — and
give cards a hairline outline rather than relying on elevation alone. Say in your result what
the measured steps are.

GREEN IS THE ACCENT AND THE MARK, NOTHING ELSE. "Much richer deep forest velvety green" is the
operator's phrase. Today's dark primary is \`#9bdcba\` — a pale mint — and the surfaces
themselves carry green tint (\`--md-sys-color-on-surface-variant: #edf7f0\`). Both are wrong for
this. Surfaces become neutral (pure black through neutral greys, no hue), and the primary
becomes a deep saturated forest green used for the mark, the accent, focus rings, selected
states and primary actions. It must still clear WCAG AA against the surface it lands on —
COMPUTE every pair, do not judge by eye. \`apps/web/src/lib/a11y/contrast.ts\` already exists.

The light theme stays a forest-green palette per STUDIO-030-002, with no muddy brown or gold
and no low-contrast grey-on-grey for critical text.

THE TWO SPECS YOU OWN CURRENTLY FORBID THIS, and they are right about the old palette:
\`preferences.spec.ts\` asserts each theme "uses neither pure black nor pure white", and
\`md3-tokens-logic.spec.ts\` asserts the scrim is not pure black. Rewrite what they assert to
the new rule — the dark base IS #000; what must never happen is a pure-WHITE foreground, an
elevation step invisible against its neighbour, or any pair under AA — and make the
replacement at least as strong. Mutation-prove BOTH: darken an on-colour below AA and show it
reds; collapse two adjacent surface-container steps to the same value and show it reds.

Report the exact hex of every token you set for the dark theme's surface ramp and the primary
family, and the measured contrast ratio of each pair.`,
      { label: 'ground:tokens', phase: 'Ground', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  () =>
    agent(
      `${RULES}

TASK — the System Studio information architecture and route map. This is a PLANNING task: you
write the document that three build agents implement from. You write NO component code.

YOU OWN, exclusively: docs/architecture/studio-information-architecture.md

The Bible's "Product and UX" section names this deliverable in its own words: "System Studio
information architecture and route map."

WHAT IS WRONG TODAY, measured:
  · \`main\` is \`inline-size: min(100%, 1280px); margin-inline: auto\` — a centred column. On a
    1920px operator monitor a third of the screen is empty on each side. The operator's word
    was "isolated in the centre of the screen".
  · The masthead holds four things: a text "Tenure" mark, the words "System Studio", a
    preferences menu, and an "Internal" badge. There is no sign-out, no account, no search
    box, no breadcrumb, no environment indicator.
  · Navigation is a horizontal row of groups. It has ONE level. The operator asked for
    "menued, sub-menued, dropdowns … across and within and within".
  · A command palette EXISTS — \`components/Launcher.tsx\`, Ctrl/Cmd-K, mounted in layout.tsx —
    and nothing on screen says so, so nobody uses it.
  · 17 routes are served.

DECIDE AND WRITE DOWN:
  1. The shell: a persistent full-height left navigation plus a persistent top bar, and what
     lives in each. Full-width, with content that uses the viewport instead of a centred
     column — while keeping READING measure sane for prose (a 1600px-wide paragraph is its own
     defect; say how you solve that without re-centring the whole application).
  2. The navigation tree, TWO levels minimum: the Bible's domains as groups, and within each
     group the routes, plus sub-items where a route has real sub-surfaces. Say which routes
     get sub-items and why. \`shell-separation.test.mjs\` asserts the groups ARE the Bible's
     domains in the Bible's order — keep that true.
  3. What the top bar carries: the mark, the environment/account it is pointed at, global
     search, and an account menu containing sign-out. Say what each shows when unknown.
  4. Breadcrumbs: the model, where they render, and what they do on a dynamic route like
     \`/tenants/[slug]/configuration\`. "Back and forth" was named explicitly.
  5. Collapse behaviour at 1180, 900 and 320px, since \`layout.spec.ts\` runs all four widths.
  6. What does NOT change: the Diagnostics group stays last and keeps everything unfinished
     behind it.

Cite the Bible section for each grouping decision. Where you are choosing rather than
following, say so plainly — a document that presents taste as a citation is worse than one
that admits the choice.`,
      { label: 'ground:information-architecture', phase: 'Ground', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  () =>
    agent(
      `${RULES}

TASK — the Tenure mark, as a real asset and a real component. The operator: "Logo is still not
put in there."

YOU OWN, exclusively:
  apps/system-studio/public/**            (create the directory)
  apps/system-studio/src/components/md3/Logo.tsx
  apps/system-studio/src/components/md3/Logo.test.tsx

Today the masthead renders \`<span className="mark">Tenure</span>\` — a text string in a pill.

Build an SVG wordmark and a standalone glyph, in the deep forest green the token agent is
setting as \`--md-sys-color-primary\` — reference the TOKEN, never a hard-coded hex, so the mark
follows the theme instead of drifting from it. Ship it as an inline React SVG component rather
than an \`<img>\`: it must recolour with the theme, scale without a raster step, and carry no
network request. Provide \`<Logo />\` (mark plus wordmark, for the top bar) and \`<Logo mark />\`
(glyph only, for the collapsed sidebar and the favicon).

ACCESSIBILITY IS PART OF THE ASSET, not a decoration on it: an accessible name when it stands
alone as a link to home, and \`aria-hidden\` when it sits beside a visible "Tenure" wordmark —
a screen reader announcing "Tenure Tenure" is the defect that shape produces.

Also give the application a favicon and the metadata that references it. \`app/layout.tsx\`
belongs to the shell agent, so if the favicon needs a metadata change, put the file in place,
export what is needed, and NAME the one line the shell agent must add in your result.

Design constraint from Bible §20: this is Tenure's own mark. Do not derive it from Monarch,
Vercel, Perplexity, AWS, SAP, Workday or Jira trade dress.

PROVE IT: a test that the component renders an \`<svg>\`, that it carries no literal colour (it
must reference the token), and that the standalone form has an accessible name while the
decorative form does not. Mutation-prove each.`,
      { label: 'ground:logo', phase: 'Ground', schema: RESULT_SCHEMA, effort: 'high' },
    ),
])

log(`Ground: ${ground.filter(Boolean).length}/3 landed`)

/* ── Build: one agent per surface ───────────────────────────────────────── */

const WORK = [
  {
    key: 'shell',
    owns:
      'apps/system-studio/src/app/layout.tsx, the SHELL LAYOUT rules in apps/system-studio/src/app/globals.css (the token blocks are settled — do not re-tune colour), and apps/system-studio/e2e/layout.spec.ts',
    id: 'STUDIO-030-008',
    what: `The app shell. Read docs/architecture/studio-information-architecture.md first and
implement what it decided.

\`main\` is \`inline-size: min(100%, 1280px); margin-inline: auto\` — the centred column the
operator called "isolated in the centre of the screen". Replace it with a real shell: a
persistent full-height navigation region, a persistent top bar, and a content region that uses
the viewport. Keep prose readable — a measure cap on TEXT blocks is not the same thing as
centring the application, and the IA document says which.

STUDIO-030-008 is your requirement: "Prevent layout shift, focus loss, accidental double
submit, hidden scrolling actions, modal stacking, and stale optimistic success in long-running
workflows." A shell rebuild is exactly where layout shift and focus loss are introduced, so
prove you did not: the top bar and navigation must not reflow after hydration, and moving
between routes must not lose keyboard focus.

\`layout.spec.ts\` is yours and runs every route at 1440, 1180, 900 and 320px. It now prints the
offending element when a page scrolls sideways — keep that diagnostic. ADD an assertion that
the content region actually uses the width available at 1440px, so nobody re-centres this by
accident; that assertion is the operator's complaint, encoded.`,
  },
  {
    key: 'topbar',
    owns:
      'apps/system-studio/src/components/TopBar.tsx and topbar.module.css (new), apps/system-studio/src/components/AccountMenu.tsx (new), and apps/system-studio/e2e/topbar.spec.ts (new)',
    id: 'STUDIO-030-003',
    what: `The top bar: the mark, where you are, global search, and the account menu with
SIGN-OUT. The operator listed "no logout, back and forth, global search and interactions" as
the missing things; three of the four are yours.

  · The mark, from \`components/md3/Logo\`, linking home.
  · The account: who is signed in and with which operator role. \`lib/operators.ts\` exports
    \`roleOf\`; \`PLATFORM_OPERATORS\` is \`email:role\` and a bare address is REFUSED, never
    defaulted. Show the role, because five families exist and they can do different things.
  · The estate this console is pointed at — account and region, from the resolved identity.
    UNKNOWN when it could not be read, never blank and never a guess.
  · GLOBAL SEARCH. A command palette already exists at \`components/Launcher.tsx\` (Ctrl/Cmd-K,
    mounted in layout.tsx) and is invisible, so nobody uses it. Give it a visible trigger in
    the top bar showing its shortcut. Do NOT build a second palette — wire the one that exists.
  · SIGN-OUT, in an account menu. There is no sign-out anywhere in this application today:
    \`grep -rn "signOut" apps/system-studio/src\` returns nothing. It must end the session
    server-side, not just clear a cookie client-side. Cognito is the auth mode in production
    (\`STUDIO_AUTH_MODE=cognito\`) and \`infrastructure/studio/cognito.tf\` already declares
    \`logout_urls\`; use the federated sign-out where configured and the local one otherwise.

STUDIO-030-003 names the primitives this needs — menu, popover, button, link. Consume
\`components/md3/*\`; if one is missing, the primitives agent is building it this hour — say so
in your result rather than forking it.

The account menu is a dropdown and must be operable by keyboard alone: open, arrow, escape,
and focus returned to the trigger on close. That is STUDIO-030-007, and it is the half of a
menu that is usually missing.`,
  },
  {
    key: 'sidebar',
    owns:
      'apps/system-studio/src/components/Nav.tsx, apps/system-studio/src/components/nav.module.css (new), and tests/architecture/shell-separation.test.mjs',
    id: 'STUDIO-030-003',
    what: `The navigation: grouped, sectioned, with sub-menus. "Menued, sub-menued, dropdowns …
across and within and within."

Today it is one horizontal row of groups with a single level. Implement the tree the IA
document specifies: the Bible's domains as sections, routes within them, and sub-items where a
route has real sub-surfaces — \`/tenants/[slug]\` has configuration, history and next moves;
\`/platform\` has its own panels.

Keep every property \`shell-separation.test.mjs\` already holds — you own that file, so EXTEND
it rather than relaxing it. It currently asserts the groups ARE the Bible's domains in the
Bible's order, that every nav destination is a route the console serves, that every route is a
nav entry or a declared unlinked route, and that the Diagnostics register matches the last
group. All thirteen must still pass, and a sub-item is a destination like any other: it must
resolve to a real route.

Collapse behaviour is yours: at 320px this must not be a wall. The current-section indicator
must survive a sub-item being active — a sub-item selected with its parent section not marked
current is the defect that makes a two-level nav feel broken.`,
  },
  {
    key: 'breadcrumbs',
    owns:
      'apps/system-studio/src/components/Breadcrumbs.tsx and breadcrumbs.module.css (new), and apps/system-studio/e2e/breadcrumbs.spec.ts (new)',
    id: 'STUDIO-030-008',
    what: `"Back and forth" — where the operator is, and the way back.

A trail from home to the current surface, rendering on every route, including the dynamic ones:
\`/tenants/[slug]\`, \`/tenants/[slug]/configuration\`. A crumb must be the route's real name, not
a prettified slug segment — \`/tenants/rochester/configuration\` reads "Tenants / Simon Business
School — Ainslie OSE / Configuration", and the tenant's name comes from the binding, not from
title-casing the URL.

An unknown segment renders the segment itself rather than inventing a name, and says nothing
it cannot support.

The current page is the last crumb and is NOT a link — \`aria-current="page"\` — because a link
to where you already are is a control that does nothing. Use a \`<nav>\` with an accessible name
so a screen reader can skip it.

The IA document decides where this renders. Read it first.`,
  },
  {
    key: 'signin',
    owns: 'everything under apps/system-studio/src/app/signin/, and apps/system-studio/e2e/signin.spec.ts',
    id: 'STUDIO-030-006',
    what: `The sign-in page. The operator: "the login page is also not designed properly."

It is 111 lines and is the FIRST thing anybody sees of this product. Rebuild it on the token
layer and the primitives: the mark at real size, the product name, one clear task, and the
states that matter — signing in, refused, locked out, misconfigured, and the federated path
when \`STUDIO_AUTH_MODE=cognito\`.

STUDIO-030-006 is your requirement: "Implement skeleton, empty, no-permission, stale, partial,
error, retrying, offline, degraded, and conflict states for every asynchronous surface." A
sign-in form is an asynchronous surface and it has more of those states than any other page in
the console.

TWO THINGS THAT ARE NOT COSMETIC AND MUST SURVIVE:
  · A wrong secret must be refused WITHOUT telling an attacker which half was wrong, and
    \`signin.spec.ts\` (yours) already asserts the refusal. Keep it.
  · The page must not become a client component that leaks the operator allowlist. It renders
    server-side today; \`PLATFORM_OPERATORS\` must never reach the browser. Check the built
    output for it before you report — \`grep -r "tenure.example" .next/static\` finding a match
    is a leak.

It must also work at 320px, and under \`prefers-reduced-motion\`.`,
  },
  {
    key: 'primitives',
    owns:
      'new files under apps/system-studio/src/components/md3/ plus its index.ts, and apps/system-studio/e2e/md3-primitives-logic.spec.ts (new). Do NOT edit globals.css — hand any token you need to the tokens agent by naming it in your result.',
    id: 'STUDIO-030-003',
    what: `STUDIO-030-003 verbatim: "Build accessible primitives for button, link, input, select,
combobox, command menu, dialog, drawer, tooltip, popover, tabs, accordion, menu, toast, table,
tree, code/diff, date/time, stepper, file upload, chart, and status."

Twenty-two named. \`components/md3/\` has Surface, Card, Button, Chip, Badge, DataTable,
EmptyState, KeyValue, StaleIndicator, UnknownState, Tabs, Dialog, Snackbar, ProgressIndicator,
Field, TextField, Select, Switch, SeverityChip. READ THE DIRECTORY and build what is missing —
combobox, drawer, tooltip, popover, accordion, menu, tree, code/diff, date/time, stepper, file
upload — in that order of usefulness to this console. Two agents need Menu and Popover THIS
HOUR for the account menu and the sidebar, so build those first and say when they are ready.

"Accessible" is the load-bearing word and is where these are normally wrong. Every one of them
needs its keyboard model: a menu opens on Enter and Space, moves on arrows, closes on Escape,
and RETURNS FOCUS to its trigger. A dialog traps focus and restores it. A tooltip is reachable
without a pointer. A tree supports arrows and Home/End. If you cannot do a primitive properly,
ship fewer and say which you did not do — a combobox that looks right and cannot be operated
from a keyboard is worse than an honest gap, because it looks finished.

Every one consumes ONLY tokens. A raw hex in a component is a defect the lint catches.`,
  },
  {
    key: 'destructive',
    owns:
      'apps/system-studio/src/components/md3/DangerZone.tsx (new) and its test, plus apps/system-studio/e2e/destructive-separation.spec.ts (new)',
    id: 'STUDIO-030-004',
    what: `STUDIO-030-004: "Make destructive controls visually and spatially distinct; never place
irreversible tenant/account/key deletion next to ordinary actions."

This console can purge a tenant. \`lib/tenant-state.ts\` computes \`riskOf\` and
\`highRiskVerdict\`, and \`states-logic.spec.ts\` already proves a purge is irreversible and says
the word. What is missing is the SPATIAL rule: an irreversible control must not sit in the same
row, card or button group as a routine one.

Build the region that enforces it, and a guard that proves it holds across the console: walk
the rendered pages and fail when a control whose action \`riskOf\` classifies irreversible
shares a container with an ordinary one. A rule that lives only in a component nobody is
obliged to use is a convention, and this requirement is not asking for a convention.

Do NOT edit the tenant pages to adopt it — other agents own those. Ship the region, ship the
guard, and NAME in your result every site that would have to change.`,
  },
  {
    key: 'density',
    owns:
      'apps/system-studio/src/components/PreferencesMenu.tsx, apps/system-studio/src/lib/preferences.ts, and apps/system-studio/e2e/preferences-logic.spec.ts',
    id: 'STUDIO-030-005',
    what: `STUDIO-030-005: "Implement comfortable and compact density modes without information
loss, and persist only as operator preference."

Density is already an axis — \`data-density\` is set by the pre-paint script and
\`preferences-logic.spec.ts\` pins that contract. What is not proven is "WITHOUT INFORMATION
LOSS", which is the whole requirement: compact must change spacing and type scale, never hide
a column, truncate a value without a title, or drop a row.

Prove it. A test that renders a dense surface in both modes and asserts the same set of facts
is present in each — same rows, same columns, same text content — with only geometry differing.
That is the assertion this requirement is asking for and it does not exist today.

"Persist only as operator preference" is the second clause and also load-bearing: density is
per-operator local state, and it must not be written into the tenant registry, a manifest, or
any server-side record. Check that nothing does, and say what you checked.`,
  },
  {
    key: 'domain',
    owns:
      'infrastructure/studio/cloudfront.tf, infrastructure/studio/acm.tf (new), infrastructure/studio/variables.tf, infrastructure/studio/cognito.tf, infrastructure/studio/ecs.tf, and tests/security/studio-domain.test.mjs (new)',
    id: 'STUDIO-030-013',
    what: `The console answers on \`https://d2kj4iy5i37kfd.cloudfront.net\`. The operator wants a
real \`tenurework.com\` name.

WHAT IS TRUE TODAY, verified: \`infrastructure/studio/cloudfront.tf\` sets
\`cloudfront_default_certificate = true\` and declares NO aliases.
\`infrastructure/studio/cognito.tf\` derives \`callback_urls\` and \`logout_urls\` from
\`aws_cloudfront_distribution.studio.domain_name\`, and \`ecs.tf\` derives \`AUTH_URL\` and
\`NEXTAUTH_URL\` from the same. So the hostname is threaded through auth in four places and a
half-done rename breaks sign-in — which is why this is one agent's job and not a find-replace.

\`infrastructure/terraform/acm.tf\` already does this for the pilot's \`app.tenurework.com\`. Read
it and follow the pattern rather than inventing one.

Deliver: a variable for the studio hostname defaulting to the CloudFront domain so nothing
breaks when it is unset, an ACM certificate in us-east-1 (CloudFront accepts no other region —
state that in a comment), DNS validation records, the distribution alias and viewer
certificate, and every auth URL derived from the new name with the CloudFront domain as the
fallback.

BE HONEST ABOUT THE BLOCKER. This needs a Route 53 hosted zone for \`tenurework.com\` in this
account. \`grep -rn "aws_route53_zone" infrastructure/\` finds none, so the zone is either
elsewhere or delegated externally. If you cannot confirm the zone exists, the correct status is
BLOCKED_EXTERNAL with the exact commands the account owner would run —
\`aws route53 list-hosted-zones\` — and the Terraform written and validated behind a variable
that is off by default. Do NOT invent a zone id. Do NOT apply anything.

\`terraform fmt -check\` and \`validate\` must pass. Docker is unavailable on this machine; if you
cannot run them, say so and give the exact command.`,
  },
]

phase('Build')
log(`${WORK.length} surfaces, disjoint file ownership`)

const built = await pipeline(
  WORK,

  (item) =>
    agent(
      `${RULES}

TASK — ${item.what}

YOU OWN, exclusively: ${item.owns}

Nothing else. Eight other agents are working beside you on disjoint files. If you need
something they own, NAME it in your result rather than reaching for it.

THE REQUIREMENT YOU ARE CLOSING: ${item.id}. Read its exact wording in the Bible around line
240 of \`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md\` before you
start, and again before you report — the wording is the specification, and "close enough to
the wording" is how a ledger fills with rows nobody can defend.

Report with \`id\` set to that requirement id. If you deliver only part of it, say PASS for what
is genuinely done ONLY if the requirement's own sentence is satisfied end to end; otherwise
FAIL with what remains. A partial answer recorded as PASS is the one outcome this programme
cannot absorb.`,
      { label: `ux:${item.key}`, phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
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
  1. Open the Bible's wording for that id. Does the delivered thing satisfy the SENTENCE, or
     something adjacent that was easier? Scope drift is a refutation, and it is the most
     likely one on a UI task where "looks better" is easy to mistake for "meets the clause".
  2. Is it reachable from a rendered route? Trace it. A component nothing renders fails.
  3. RE-RUN THE MUTATION yourself — apply, run, OBSERVE the failure, restore, confirm green.
  4. KEYBOARD AND SCREEN READER. For anything interactive: can it be opened, operated and
     closed with a keyboard alone, and does focus return where it should? A menu or dialog
     that is mouse-only fails STUDIO-030-007 regardless of how it looks, and this is the check
     most likely to be skipped.
  5. Contrast: any pair the agent introduced must clear AA. Compute it; do not trust a claim.
  6. Did they weaken an assertion to get green — especially in \`preferences.spec.ts\`,
     \`md3-tokens-logic.spec.ts\`, \`shell-separation.test.mjs\` or \`layout.spec.ts\`? Read every
     deletion in \`git diff\` for those files. Deliberately CHANGING what a spec asserts is
     allowed here and was instructed; making it assert less is not.
  7. Any literal colour in a component, any invented hex presented as measured, any claimed
     contrast ratio that does not recompute?
  8. Did they touch \`deploy-studio.yml\`'s workflow_run gate, or a production-disarming guard?
     That refutes the whole set.

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
      blocked: res.blocked_reason,
    })
  }
}

const confirmed = rows.filter((r) => r.confirmed)
log(`${confirmed.length} confirmed of ${rows.length} attempted across ${built.filter(Boolean).length} surfaces`)

return {
  program: 'studio-ux',
  ground: ground.filter(Boolean).map((g) => ({ results: g.results, deviations: g.deviations || [] })),
  attempted: rows.length,
  confirmed,
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  blocked: rows.filter((r) => r.status === 'BLOCKED_EXTERNAL'),
  notPass: rows.filter((r) => r.status === 'FAIL'),
}
