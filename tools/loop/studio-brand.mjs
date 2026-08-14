export const meta = {
  name: 'studio-brand',
  description:
    'Re-skin the console on ChatGPT-family neutral greys with the REAL Tenure brand green, put the real wordmark in the top bar, and make the estate reads actually refresh',
  whenToUse:
    'After the shell and the readers have landed. This changes the palette, the mark and the refresh loop — three things the product owner named directly.',
  phases: [
    { title: 'Build', detail: 'palette, brand mark, live refresh' },
    { title: 'Refute', detail: 'an independent check that each claim is true' },
  ],
}

const RULES = `
You are working in C:/Users/satvi/Tenure-Parent on branch "main".

NON-NEGOTIABLE:
- NEVER push, commit, reset, stash or checkout. Do NOT run \`git add -A\`.
- NEVER push to https://github.com/Tenurework/Tenure (remote "live").
- Do not weaken the production-disarming guards or deploy-studio.yml's workflow_run gate.
- Do not read, print, copy or rotate secret VALUES.
- Do NOT run \`npm run generate\` or \`npm install\`.

DISK AND PROCESSES — this cost the last wave seven requirements, so read it.
- Build into ONE scratch dir named for yourself (\`.next-<you>\`) and DELETE it before you return.
- STOP YOUR SERVER before you build again and before you return, by the PID you started.
  On Windows a running \`node .next/standalone/.../server.js\` holds files under \`.next\` OPEN and
  the next build BLOCKS — at zero CPU, emitting no BUILD_ID, for as long as you leave it. It looks
  exactly like a slow build on a busy machine. Measured: 25 minutes at 0%, then 210 seconds once
  the server was stopped. If a build sits silent for more than two minutes, check for a server
  before you assume the machine is busy.
- NEVER delete a scratch dir or kill a process that is not yours.
- Check \`df -h /c\` before building; under 5GB free, clean your own dir first and say so.

LOCAL HARNESS (the only way to see a rendered page):
  npx dynalite@3.2.2 --port 8001    # already running; reuse it if it answers
  export AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci \\
    AWS_REGION=us-east-1 AWS_ACCOUNT_ID=000000000000 AWS_PARTITION=aws \\
    AWS_ACCESS_KEY_ID=AKIALOCALDYNAMODBXX AWS_SECRET_ACCESS_KEY=localdynamodbsecretnotreal
  node tools/create-registry-table.mjs && node tools/dev/seed-studio-fleet.mjs
  npm run studio:build                     # builds into apps/system-studio/.next
  cp -r apps/system-studio/.next/static apps/system-studio/.next/standalone/apps/system-studio/.next/
  cp -r apps/system-studio/public apps/system-studio/.next/standalone/apps/system-studio/
  AWS_ENDPOINT_URL=http://127.0.0.1:1 AWS_MAX_ATTEMPTS=1 HOSTNAME=127.0.0.1 PORT=<your own port> \\
    NEXTAUTH_URL=http://127.0.0.1:<port> AUTH_URL=http://127.0.0.1:<port> \\
    PLATFORM_OPERATORS='operator@tenure.example:platform-super-admin,auditor@tenure.example:auditor-read-only' \\
    PLATFORM_OPERATOR_SECRET=ci-studio-not-a-placeholder-4c8e2f \\
    AUTH_SECRET=ci-studio-auth-not-a-placeholder-71bd93 AUTH_TRUST_HOST=true \\
    STUDIO_AUTH_MODE=credentials node apps/system-studio/.next/standalone/apps/system-studio/server.js &
  cd apps/system-studio && PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port> \\
    ../../node_modules/.bin/playwright test <your spec>
  (\`next start\` cannot serve \`output: standalone\`. Playwright lives at the REPO ROOT
   node_modules/.bin, not in apps/system-studio.)

PLAYWRIGHT: wait, THEN measure. \`boundingBox()\` samples once and returns null for anything not
yet painted; it does not retry the way \`expect(x).toBeVisible()\` does. Measuring straight after
\`goto()\` is a coin toss — that exact pattern turned CI red twice this week. Assert visible first.

THE STANDARD:
- Every behaviour you claim gets a test PROVEN to catch it: apply a mutation, run it, CONFIRM IT
  FAILS, restore, confirm it passes. Report each mutation and both results verbatim.
- Every number you change, you justify: what it was, what it is, what it buys.
- Verify with \`npx tsc --noEmit -p apps/system-studio/tsconfig.json\` and the specs you own.
`

/* ── The two references, spelled out so nobody invents them ───────────────── */

const BRAND = `
═══ THE TENURE BRAND, WHICH IS NOT NEGOTIABLE AND NOT YOURS TO INVENT ═══

The source of truth is the tenant application in this same repository, plus the landing page it
came from. Read them before you change one hex:

  apps/web/src/app/globals.css                      the palette
  apps/web/src/components/brand/TenureLogo.tsx      the mark, the wordmark, the AI mark

THE GREEN RAMP, verbatim from apps/web/src/app/globals.css:

  --tenure-forest-25:  #f0f9f4      --tenure-forest-550: #23a869
  --tenure-forest-50:  #e4f2ea      --tenure-forest-600: #1f9e63
  --tenure-forest-200: #6ee7b7      --tenure-forest-650: #1c8c5a
  --tenure-forest-300: #56d199      --tenure-forest-700: #198052   <- --primary
  --tenure-forest-350: #34d399      --tenure-forest-750: #14724a
  --tenure-forest-400: #37c884      --tenure-forest-800: #0f6b42
  --tenure-forest-500: #2bb673      --tenure-forest-850: #115e3d

  --tenure-navy-50: #eef1f5   --tenure-navy-700: #26364a
  --tenure-navy-800: #1a2634  --tenure-navy-850: #16202c

\`--primary\` is \`--tenure-forest-700\` = #198052, and the file records WHY: it was darkened from
#1c8c5a by a contrast audit, because white on the old value measured 4.24:1 — below the 4.5:1 AA
floor — on the most-clicked control in the product. Do not undo that.

WHAT WENT WRONG, and what you are correcting. The console currently uses #12cc7e as its accent.
That value appears NOWHERE in the brand. An agent invented it while building an OLED-black theme
and called it "deep forest green". The product owner has said the colour is not accurate. It is
not. Replace it with the real ramp.

ONE HONEST COMPLICATION, and solve it rather than ignore it: #198052 was chosen for WHITE TEXT ON
GREEN. On a dark grey surface it is the wrong end of the ramp — as a foreground on #212121 it is
far too dark to read. The ramp exists precisely so you can pick the step that works: the lighter
steps (#34d399, #56d199, #6ee7b7) are the same brand hue and clear AA on dark neutrals. So:
  · dark themes take a LIGHTER step of the SAME ramp for green-as-foreground,
  · #198052 stays the filled-button colour where white sits on it,
and you state which step you used where, with the measured ratio. Picking a step off the brand
ramp is using the brand. Inventing a hex is not.
`

const CHATGPT = `
═══ THE NEUTRAL FAMILY THE PRODUCT OWNER ASKED FOR ═══

"change the uiux color from current to chatgpt black combo colors".

That means the near-black neutral family that interface uses — a very dark grey page, a darker
rail, a slightly lighter raised surface, warm-neutral light grey text — NOT pure #000 OLED black,
and NOT a coloured background. The current theme is #000000 with a green accent; the owner is
asking for the greys instead.

Work from these, which are the values that family is built on:

  page / main background      #212121
  rail / sidebar              #171717
  deepest (headers, wells)    #0d0d0d
  raised surface / composer   #2f2f2f
  hover                       #424242
  primary text                #ececec
  secondary text              #b4b4b4
  hairline border             rgba(255, 255, 255, 0.10)

TREAT THESE AS A STARTING POINT, NOT A SPEC. That interface publishes no design-token document,
so these are taken from the rendered product and are accurate to a shade, not to a certificate.
Where one of them fails this console's contrast floor, MOVE IT and say so — this console is held
to WCAG 2.2 AA on every declared pair in four themes, which is a harder bar than a chat UI needs.
An honest "I moved secondary text from #b4b4b4 to #bdbdbd because 4.41:1 missed the floor on
#2f2f2f" is the right answer. Shipping a pair that fails is not.

WHAT STAYS: the green is the ACCENT and nothing else. One accent, used sparingly, neutral
surfaces everywhere else — ADR-0009's "calm" directive, unchanged. A console that is 20% green is
not what was asked for.

WHAT IS FORBIDDEN, from ADR-0009: no SwiftUI, no Liquid Glass, no \`backdrop-filter\` as the
mechanism that distinguishes ordinary surfaces. The substrate does not change; the palette does.
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
          measurements: { type: 'string' },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' } },
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

phase('Build')
log('Palette, brand mark, and the refresh loop that was specified but never built')

const work = await parallel([
  /* ── 1. the palette ─────────────────────────────────────────────────────── */
  () =>
    agent(
      `${RULES}${CHATGPT}${BRAND}

TASK — repaint the console.

YOU OWN, exclusively:
  apps/system-studio/src/app/globals.css          (COLOUR TOKENS ONLY — do not retune the type
                                                   scale, spacing or component geometry; another
                                                   change owns those and yours must not collide)
  apps/system-studio/e2e/preferences.spec.ts
  apps/system-studio/e2e/md3-tokens-logic.spec.ts

ALL FOUR THEMES, not just dark: light, dark, \`[data-contrast="more"]\`, and dark-contrast. The
light theme is the tenant app's paper palette and should stay recognisably Tenure; the DARK theme
is the one being restyled onto the neutral family above.

WHAT THE GUARDS ALREADY REQUIRE, and each will red if you get it wrong:
  · \`preferences.spec.ts\` computes contrast for EVERY declared pair in all four themes and fails
    below AA. It is what stopped a pale-mint-on-black pair shipping this month.
  · \`md3-tokens-logic.spec.ts\` asserts the dark container ladder is strictly monotonic with every
    adjacent step clearing 1.12:1, that no component contains a literal colour, and that no token
    is declared without a consumer or a recorded reason.
  · The scrim must still cut the brightest surface's luminance by at least half.

THE ONE STRUCTURAL THING TO GET RIGHT. The current dark theme is #000 and carries elevation with a
container ladder because shadow is invisible on pure black. On #212121 you have BOTH available
again — the ladder AND real shadow. Decide deliberately which carries elevation, say which, and
keep the ladder monotonic either way. Do not leave a ladder tuned for black sitting on grey.

REPORT, as measurements: every pair you changed, its old ratio, its new ratio, and the floor it
had to clear. "Looks better" is not a result.`,
      { label: 'brand:palette', phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  /* ── 2. the mark ────────────────────────────────────────────────────────── */
  () =>
    agent(
      `${RULES}${BRAND}

TASK — put the REAL Tenure mark and wordmark in the console.

YOU OWN, exclusively:
  apps/system-studio/src/components/md3/Logo.tsx
  apps/system-studio/src/components/md3/Logo.test.tsx
  apps/system-studio/src/components/brand/            (whatever is here)
  apps/system-studio/src/components/topbar.module.css
  apps/system-studio/src/app/layout.tsx
  tests/architecture/brand-mark-is-one-mark.test.mjs

The product owner: "the tenure logo, wordmark, color are not accurate — refer Tenure landing page
or tenure simon repo".

WHAT IS ALREADY RIGHT: the rosette GEOMETRY. \`Logo.tsx\` imports \`PETAL\` from the canonical
\`TenureLogo\`, and a guard test holds that import so the mark cannot fork. Keep both.

WHAT IS WRONG: the WORDMARK is hand-drawn as \`<path>\` outlines on a 32-unit grid — a synthetic
letterform that is not Tenure's. \`apps/web/src/components/brand/TenureLogo.tsx\` renders the
wordmark as the rosette beside the WORD "Tenure" set in the product's own type at 0.85× the mark
size, semibold, tight tracking. That is the wordmark. A drawn approximation of letterforms is
exactly the kind of thing that reads as almost-right and is worse than plain text.

Match the tenant app's component: same construction, same proportion, same gap, same weight, same
tracking. If a real difference forces a deviation — the console's top bar has its own type stack —
name the deviation and why, rather than quietly diverging again.

COLOUR: the mark takes the accent from the token layer. It must contain NO literal colour;
\`md3-tokens-logic.spec.ts\` scans this directory and fails on a hex, an \`rgb(\`, a named colour or
an inline style attribute. Another agent is repainting the tokens in the same wave — consume the
role, never the value, and you cannot collide.

PROVE the wordmark is the word: a test that fails if the letters go back to being drawn paths,
and one that fails if this file stops importing the shared PETAL.`,
      { label: 'brand:mark', phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
    ),

  /* ── 3. the refresh loop ────────────────────────────────────────────────── */
  () =>
    agent(
      `${RULES}

TASK — make the estate reads actually refresh. The contract exists; the loop does not.

YOU OWN, exclusively:
  apps/system-studio/src/components/LiveRegion.tsx      (new, or a name you argue for)
  apps/system-studio/src/components/live.module.css     (new, if you need it)
  apps/system-studio/src/lib/aws/refresh.ts             (new)
  apps/system-studio/e2e/live-refresh.spec.ts           (new)
  apps/system-studio/src/app/platform/health/page.tsx
  apps/system-studio/src/app/platform/estate/page.tsx

THE PRODUCT OWNER ASKED: "why isnt studio fully connected to the AWS with all data streaming".

Here is the true answer, established by measurement — start from it rather than re-deriving it:

  · The IAM task role grants 218 actions; the capability registry declares 120. The six that look
    missing are NAMING differences between the SDK operation and the IAM action —
    \`s3:GetBucketCors\` vs \`s3:GetBucketCORS\`, \`budgets:DescribeBudgets\` vs \`budgets:ViewBudget\`.
    Permissions are NOT the gap.
  · Every capability in \`lib/aws/capabilities.ts\` already carries \`refreshMs\`, argued per
    resource. \`api/aws/[surface]/route.ts\` already sends \`x-aws-refresh-ms\` on every response.
  · \`grep -rn "x-aws-refresh-ms" apps/system-studio/src\` finds it EMITTED and consumed NOWHERE.
    The only \`setInterval\` in the application is the sign-in retry countdown.

So the pages are server-rendered snapshots: correct at load, then frozen until a human reloads.
Build the missing half.

WHAT IT MUST DO:
  · Obey the interval the SERVER gives it — \`x-aws-refresh-ms\` from the response — never a number
    you picked. The whole point of \`refreshMs\` is that each capability's author argued for its
    own rate; a client that ignores it and polls every 5s is a client that will be throttled, and
    throttling this engine is how a page starts lying.
  · STOP when the tab is hidden (\`document.visibilityState\`), and resume on focus. A console left
    open overnight must not spend an operator's rate budget on a screen nobody is looking at.
  · BACK OFF when the server says to. A 429 or a THROTTLED read means slow down, not retry harder.
  · NEVER overwrite a good value with a failed read. This is the rule the whole codebase is built
    around: a refresh that fails leaves the last good value ON SCREEN, marked stale, with the time
    it was true. It does not blank the table, and it does not silently show old data as fresh.
    \`api-contract.spec.ts\` already asserts the server half of this — "a failed poll carries no
    rows, so it cannot overwrite a good value". Your client must honour it.
  · Be visibly honest: the operator can see when the data was last refreshed, and whether the last
    attempt succeeded.

WHAT IT MUST NOT DO: no websockets, no SSE, no new dependency. Polling on the server's own stated
interval is the design; "streaming" here means the screen keeps up, not that the transport changes.

Wire it to TWO surfaces only — health and estate — done properly, with a test. A pattern proven on
two pages is worth more than a wrapper sprayed on twelve.

PROVE IT with a spec that fails if the interval is ignored, if a failed refresh blanks the value,
or if polling continues while the tab is hidden.`,
      { label: 'brand:live', phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' },
    ),
])

phase('Refute')

const claimed = work.filter(Boolean).flatMap((w) => (w.results || []).filter((r) => r.status === 'PASS'))

const verdict =
  claimed.length === 0
    ? null
    : await agent(
        `${RULES}${BRAND}

You are a REFUTER. Three agents claim these ${claimed.length} results. Default refuted=true; set
false ONLY for what you verify YOURSELF by running it.

${claimed.map((r) => `- ${r.id}: ${r.summary}\n  mutation claimed: ${r.mutation_proof}`).join('\n\n')}

Check, in this order:

 1. IS THE GREEN THE BRAND'S GREEN? Every green in globals.css must be a value from the ramp in
    apps/web/src/app/globals.css. \`grep -oE "#[0-9a-fA-F]{6}"\` the colour blocks and compare.
    A hex that is close to a brand value but not equal to one is the exact defect being corrected
    — #12cc7e was "close to" the brand too. Refute on any invented green.
 2. IS THE DARK THEME ACTUALLY THE NEUTRAL FAMILY? The page background must be the dark grey, not
    #000000 and not a tinted grey. Load a rendered page and read \`getComputedStyle(document.body)\`
    rather than trusting the stylesheet.
 3. RUN \`preferences.spec.ts\` and \`md3-tokens-logic.spec.ts\`. Any pair below AA in any of the four
    themes, or a non-monotonic ladder, refutes the palette claim outright.
 4. IS THE WORDMARK THE WORD? Render it and check the DOM: the letters must be text, not
    \`<path>\` outlines. Confirm PETAL is still imported from the shared module.
 5. DOES THE REFRESH LOOP OBEY THE SERVER? Verify it reads \`x-aws-refresh-ms\` rather than a
    constant. Hide the tab and confirm polling STOPS. Force a failed refresh and confirm the last
    good value is still on screen and marked stale — a client that blanks the table on a failed
    read is refuted no matter how well it polls.
 6. RE-RUN EVERY MUTATION YOURSELF: apply, run, observe the failure, restore, confirm green. A
    mutation that survives means the test does not test what was claimed.

Edit files ONLY to apply and restore mutations. Set tree_left_clean to whether you left the tree
exactly as you found it.`,
        { label: 'refute:brand', phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
      )

const verdictFor = new Map((verdict?.verdicts || []).map((v) => [v.id, v]))
const rows = work
  .filter(Boolean)
  .flatMap((w) =>
    (w.results || []).map((r) => ({
      ...r,
      confirmed: r.status === 'PASS' && verdictFor.get(r.id)?.refuted === false,
    })),
  )

log(`${rows.filter((r) => r.confirmed).length} confirmed of ${rows.length}`)

return {
  program: 'studio-brand',
  confirmed: rows.filter((r) => r.confirmed),
  refuted: rows.filter((r) => r.status === 'PASS' && !r.confirmed),
  files: work.filter(Boolean).flatMap((w) => w.files_changed || []),
  tree_left_clean: verdict?.tree_left_clean,
}
