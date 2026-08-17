# Tenant Experience System and Product UI/UX — execution ledger

Every `TTES-*` requirement stated by `Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md`.

Seeded by `tools/import-requirements.mjs`. **Every entry is `FAIL` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes `PASS` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

Before this file existed these requirements were in no execution document at
all. They were not queued, not counted and not failing; they were invisible, and
invisible reads exactly like done. `tests/architecture/document-graph.test.mjs`
ratchets that number downward and it may only shrink.

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `NOT_APPLICABLE`. There is no
`PARTIAL` and no `BLOCKED_ARCHITECTURE` — `tools/loop/next-batch.mjs` decides on
`PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` only, so any other word reads as
undecided and returns the item to the queue every tick, forever. An unfinished
requirement is `FAIL` if the rest can be built now, and `BLOCKED_EXTERNAL` — naming
the commands or the ADR that would unblock it — if it cannot.

- [x] **TTES-000-001** — Inventory tenant and System Studio routes/components/tokens and classify ownership.
  - Status: PASS
  - Code/config: `tools/entry-point-inventory.mjs`, `tools/ownership-map.mjs`,
    `apps/web/src/lib/a11y/css-declarations.mjs`,
    `tests/architecture/experience-separation.test.mjs`, and the two call sites
    that consume the widened inventory — `tests/security/entry-points.test.mjs`
    and `tests/architecture/nav-hrefs-are-served.test.mjs`. Generated output:
    `docs/architecture/entry-points.md`, `docs/architecture/ownership.md`.
  - Three inventories existed and none answered this. **Routes:**
    `tools/entry-point-inventory.mjs` hard-coded one `APP_ROOT =
    'apps/web/src/app'`, so the System Studio — the console that composes,
    provisions and advances every tenant — appeared in no inventory at all, and
    the headline "22 API routes · 36 pages" was counting half a platform while
    `tests/security/entry-points.test.mjs` asserted against that half that
    nothing was unguarded. **Components:** `ownership.md` classifies by platform
    DOMAIN and filed `apps/system-studio/src/components/` under "the shell and
    the design system — what every domain renders through", which is false of
    six files no other app can import. **Tokens:** nothing inventoried them, and
    the two stylesheets had diverged in silence.
  - The roots are now a list of `{app, appRoot, experience}` — `tenant` and
    `deployer` — walked together, with an Experience column on every route,
    page and action row and ids prefixed `experience:route` (both apps serve
    `/signin` and `/api/auth/[...nextauth]`, so an unprefixed allowlist entry
    for one silently covered the other). `ownership.md` gains an Experience
    axis from `EXPERIENCE_OF_SOURCE`, and the false shared claim is deleted
    rather than reworded: the console's components are owned by `control-plane`.
  - Design tokens are read with the contrast audit's own parser, moved from
    `theme-tokens.ts` into `apps/web/src/lib/a11y/css-declarations.mjs` and
    re-exported there, so one implementation serves both (a `.mjs` because CI
    pins Node 20, which cannot import `.ts`). Values are resolved through
    `var()` before comparison — `apps/web` declares `--accent:
    var(--tenure-navy-700)` and the console a literal, and comparing spellings
    would report a match as a divergence.
  - Findings the inventory produced on its first run, none of which any existing
    check could see:
    1. `apps/web/src/app/page.tsx` and `apps/system-studio/src/app/page.tsx` were
       inventoried by nothing. Git's `**/` pathspec matches nothing at depth
       zero, so `<app>/src/app/page.tsx` never matched `<root>/**/page.tsx` —
       each app's own front door was outside every count this document has
       printed. The tenant one is unguarded (`redirect("/dashboard")`) and is
       now on `INTENTIONALLY_PUBLIC` with the reason.
    2. `tools/ownership-map.mjs` wrote `ownership.md` on IMPORT, and two tests
       import `classify` from it — so the staleness assertion healed the file
       and then confirmed it healthy. It passed on every possible input. The
       `isCommand` guard `entry-point-inventory.mjs` already carried is now here
       too; mutation 11 below is the proof it was fake and is not now.
    3. Five tokens diverge, not the three the survey named: `--space-6` (24px vs
       28px) and `--ease-entry` were missed. `--ease-entry` is drift caught on
       its first day — the tenant app's motion scale landed in this same session
       with a different curve from the one the console has always had, while
       both apps agree on the durations either side of it.
  - `SHARED_TOKENS` records each divergence with a `status`. `deliberate` means
    someone decided; `unreconciled` means they differ and nobody has. A table
    offering only "deliberate" would have laundered `--ease-entry` into a
    justification the first time someone needed the build green, so the honest
    status exists and `UNRECONCILED_TOKEN_BUDGET` caps it at 1 — the next one
    reds CI.
  - Evidence: 12 mutations, 12 caught, each restored and re-run green.
    1. `EXPERIENCES.slice(0, 1)` (deployer root dropped) → 8 of 11 red,
       including "every page and route belongs to a declared experience".
    2. the old `<root>/**/page.tsx` globs restored → "covers each app-root page"
       reds naming `apps/web/src/app/page.tsx`.
    3. console `--space-2: 8px → 9px` → "a token declared by both experiences
       with different values is recorded" reds naming `--space-2`.
    4. console `--space-6: 28px → 24px` (divergence removed) → "a SHARED_TOKENS
       entry cannot outlive the divergence it describes" reds naming
       `--space-6`.
    5. console `--motion-fast: 120ms → 140ms` plus a second `unreconciled`
       record → "divergences nobody has decided about do not accumulate" reds
       with `2 … and the budget is 1`.
    6. `experienceOf` stops claiming `packages/` → "every source file belongs to
       a declared experience" reds naming real package files.
    7. `apps/system-studio/src/components/` put back in `SHARED_PREFIXES` →
       "the console components are owned, not filed as shared" reds naming all
       six.
    8. **the one that shows the widening was load-bearing** — the `operator()`
       helper in `apps/system-studio/src/app/tenants/actions.ts` stripped of its
       `auth()` and `isOperator` calls → `tests/security/entry-points.test.mjs`
       reds with `deployer:tenants/actions.ts → composeTenant` and
       `→ adoptTenantAction`. Before this change that mutation was invisible to
       the entire security suite: the console was not inventoried, so nothing
       looked at it.
    9. `deployer:/api/auth/[...nextauth]` removed from `INTENTIONALLY_PUBLIC` →
       the unguarded-entry-point test reds naming it, proving the console's
       routes now pass through the same ratchet the tenant app's do.
    10. a tenant module nav href repointed at the console-only `/tenants` →
       `nav-hrefs-are-served` reds WITH the tenant-only filter at the call site
       and goes GREEN without it. That pair is the proof the call-site edit
       matters: widening `collect()` without it would have quietly enlarged the
       set that test refuses against.
    11. `packages/workflow/` removed from a domain → the staleness assertion
       reds WITH the new `isCommand` guard on `ownership-map.mjs` and passes
       WITHOUT it, the import having rewritten the map to agree with the
       mutation first.
    12. `resolveToken` in `css-declarations.mjs` broken → 6 of 26 cases in
       `apps/web/src/lib/a11y/contrast.test.ts` fail, proving `token()` really
       delegates to the shared parser rather than keeping a copy.
  - Commands: `node --test tests/architecture/experience-separation.test.mjs`
    → 11/11. `node --test tests/security/entry-points.test.mjs
    tests/architecture/nav-hrefs-are-served.test.mjs` → green.
    `npx jest src/lib/a11y --ci` in `apps/web` → 58/58 across 3 suites.
    `npx tsc --noEmit` → 39 errors, none in any file this item touches (they are
    in `src/lib/tenant-scope.test.ts`, `src/lib/tenant-switching.itest.ts`,
    `src/components/ui/design-system.test.ts`, `src/lib/audit-record.test.ts`,
    `src/lib/approval-digest.itest.ts`, `src/lib/payments/ledger-attribution.itest.ts`,
    `src/app/`, and `packages/provisioning/src/catalogs.ts` — concurrent work in
    the same tree). `npm run test:platform` carries two failures from that same
    concurrent work and not from this: `ownership.test.mjs` "every source file
    belongs to a domain" lists 26 orphans, all under `packages/payments/`,
    `apps/web/src/lib/relay/`, `apps/web/src/lib/connections/`,
    `apps/web/src/app/(app)/gallery/` and two loose components — none of them
    this item's, and this item's one new source file
    (`apps/web/src/lib/a11y/css-declarations.mjs`) is claimed by the existing
    `apps/web/src/lib/a11y/` shared prefix; and `platform-truth.mjs --check`
    reports stale, which is a different generator fed by the ledgers.
  - **Re-verified 2026-08-07** by a later run that was handed this item as still
    open. It is not: the survey that reopened it describes the pre-implementation
    file (it cites `APP_ROOT` at `tools/entry-point-inventory.mjs:30`, a constant
    that no longer exists — `EXPERIENCES` is at :64 and both roots are walked).
    Rather than trust the entry above, four fresh mutations were run, each
    restored and re-confirmed green:
    1. `--space-3: 12px → 13px` in the REAL `apps/system-studio/src/app/globals.css`
       — the producer, not a helper — → "a token declared by both experiences
       with different values is recorded" reds naming `--space-3`. Restored → 11/11.
    2. `apps/system-studio/src/components/` returned to `SHARED_PREFIXES` → "the
       console components are owned, not filed as shared" reds. This is the exact
       false classification the requirement names. Restored → 11/11.
    3. `collect()` defaulted to `EXPERIENCES.slice(0, 1)` → 3 red, including
       "the inventory covers both experiences". This is the original defect
       itself. Restored → 11/11.
    4. a `page.tsx` created outside both experience roots → "every page and route
       in the repository belongs to a declared experience" reds naming it.
       Removed → 11/11.
    Consumers of the widened `collect()` re-checked by hand for the silent-widening
    failure: `tests/security/entry-points.test.mjs:42` matches on prefixed `e.id`
    (not `e.route`) and pins `INTENTIONALLY_PUBLIC.size` at 5;
    `tests/architecture/nav-hrefs-are-served.test.mjs:62` filters
    `.experience === 'tenant'`. Both correct.
  - One real defect found and fixed by that run, in this item's own file: the
    ownership ratchet was red on `apps/web/src/components/OrgRecordHeader.tsx`,
    a component TTES-030-001 added concurrently and could not classify itself —
    `tools/ownership-map.mjs` is not in that item's file set. Classified into
    `organization`, which already owns the `OrgTabs` it composes and the six
    `orgs/[slug]/*` surfaces that render it; both maps regenerated (644 → 645
    files, `organization` 44 → 45).
  - Commands (re-verification): `node --test
    tests/architecture/experience-separation.test.mjs
    tests/architecture/ownership.test.mjs tests/security/entry-points.test.mjs
    tests/architecture/nav-hrefs-are-served.test.mjs` → **30/30**.
    `npm run type-check` → 2 errors, neither in a file this item touches and
    neither reproducible run-to-run: `src/app/(app)/orgs/[slug]/handoff/page.tsx`
    (`OrgRecordHeader` not yet imported) and `src/components/charts/palette.ts`
    (`--chart-8` absent from the token union in `lib/a11y/tokens.ts`, modified
    concurrently). An earlier run of the same command reported a different set
    naming a `shared/ui/ShellChrome` import that no longer exists — the tree is
    being edited by other agents as this runs. This item changed no `.ts`/`.tsx`
    file at all, so no type error can originate here.
  - **Re-verified again 2026-08-07**, handed to a third run as still open. The
    survey remains stale in the same way (it cites `APP_ROOT` at
    `tools/entry-point-inventory.mjs:30`; that constant is gone). But `PASS` was
    not true of the tree as this run received it — the suite was **red, 9/11** —
    and the cause was not only drift.
  - A real defect in this item's own file, and it was in the half this item
    ADDED. `braceBody` took the function body as the first `{` after the
    function's name. The System Studio's authentication helper is declared:

    ```
    async function authorizedOperator(
      command: StudioCommand,
      scope: Omit<CommandScope, "principalId"> = {},   ← first `{` in the file
    ): Promise<string> {
    ```

    so its recorded body was the `{}` of the default value. The helper calls
    `auth()` and `authorizeCommand`; the inventory read it as reaching neither,
    the module-local helper map `exportedActionsOf` exists to build was empty
    for it, and `composeTenant`, `advanceState` and `adoptTenantAction` — the
    three actions that compose, advance and adopt tenants — were published as
    `operator` with no `session`. That is authorized-but-not-signed-in, a state
    that cannot exist in the code, and it is precisely the "reads as debt on a
    path gated harder than most" failure the `requireAdminContext` comment in
    `GUARDS` was written about. **Seven** helpers across both apps were read
    this way (`authorizedOperator`, `notifyGate`, `resolvePreparer`,
    `receiptTargetsFrom`, `auditRoster`, `auditImage`, `eligibleBackupWhere`).
    Fixed by matching the parameter list by parens and taking the first `{`
    after its `)`. Of the 113 function declarations in the repository's
    `"use server"` modules, none has a brace inside a generic parameter and none
    annotates an object-literal return type — the two shapes that would put a
    brace between `)` and the body — measured, not assumed.
  - Under-reporting was the safe direction for `tests/security/entry-points.test.mjs`
    (a guard it cannot see reads as missing, which fails loudly) which is why
    nothing caught it, and the wrong direction for this document, whose whole
    job is to say truthfully what protects the deployer experience.
  - New guard: `a deployer action guarded only through a helper still reports
    its session`, asserting on what `collect()` EMITS rather than on the brace
    reader — a test that called `braceBody` directly would stay green the moment
    the inventory stopped using it. It states the general invariant (no console
    action may report `operator` without `session`, because the console decides
    every operator command against `principalId: session.user.email`, so a
    caller with no session has no principal to decide about) plus the named
    concrete case, so a refactor removing helper inheritance cannot pass by
    leaving the general set empty. Suite is now 12 tests.
  - The ownership ratchet was red again on four files from concurrent work that
    could not classify themselves — `tools/ownership-map.mjs` is in no other
    item's file set. `apps/web/src/lib/ai.test.ts` → `integrations` (matching is
    by prefix and `…/ai.ts` does not prefix `…/ai.test.ts`, so the vendor call's
    own test was an orphan); `apps/web/src/lib/metering/` → `billing-metering`,
    which is its subject exactly — it is here rather than under `integrations`,
    which owns the vendor CALL in `lib/ai.ts`, because the question it answers
    is "how much did this tenant use", not "what may we hand to a vendor".
  - That domain's own note read "Metering does not exist: nothing measures what
    a tenant consumes". It stopped being true when WRK-120-004 landed
    `recordModelUsage`, and nothing checks a prose note, so it would have gone
    on reading that way. The CLAIM was corrected, not the classification: one
    kind of consumption is now measured, in tokens rather than dollars, and
    nothing bills for it.
  - `apps/web/src/lib/a11y/theme-tokens.ts` claimed its re-export of
    `blockAt`/`declarationsIn`/`paletteOf`/`tokenNamesIn` was "the name anything
    inside `apps/web` reaches for". Nothing reaches for it: the four live paths
    are internal (`readBlocks` → `paletteOf`/`blockAt`, `token` → `resolveToken`)
    and the generator imports `./css-declarations.mjs` DIRECTLY because it is
    `node` running `.mjs`. The re-export is a module boundary, not a call path,
    and now says so — a comment implying a consumer that does not exist is the
    failure that module's own header warns about.
  - Evidence: 7 mutations, 7 caught, each restored and re-confirmed green.
    1. `braceBody` reverted to `text.indexOf('{', from)` → the new helper-
       inheritance test reds. Restored → 12/12. This is the defect above.
    2. deployer `appRoot` pointed at a path that does not exist → **5** red,
       including "covers both experiences" and "belongs to a declared
       experience". Restored → 12/12.
    3. `--space-1: 4px → 5px` in the real `apps/system-studio/src/app/globals.css`
       — the producer — → "a token declared by both experiences with different
       values is recorded" reds. Restored.
    4. `--space-6: 28px → 24px`, unifying a recorded divergence → "a
       SHARED_TOKENS entry cannot outlive the divergence it describes" reds.
       Restored.
    5. `--border` reclassified `deliberate → unreconciled` (budget is 1 and
       `--ease-entry` already holds it) → "divergences nobody has decided about
       do not accumulate" reds. Restored.
    6. `packages/mutant-surface/src/app/page.tsx` created outside both roots →
       "every page and route in the repository belongs to a declared experience"
       reds naming it. Removed.
    7. `EXPERIENCE_OF_SOURCE` prefixes narrowed to `${e.app}/src/components/` →
       "every source file belongs to a declared experience" reds. Restored.
  - Commands (third re-verification): `npm run type-check` → **0 errors**.
    `node --test tests/architecture/experience-separation.test.mjs
    tests/architecture/ownership.test.mjs
    tests/architecture/nav-hrefs-are-served.test.mjs` → **24/24**.
    `node --test tests/security/entry-points.test.mjs` → 6/7; the one failure is
    `platform-truth.json is stale`, produced by `tools/platform-truth.mjs`,
    which imports none of this item's files and derives from the ledgers via
    `tools/loop/next-batch.mjs` — it was already stale when this run began,
    from other agents' ledger entries, and is regenerated with this one.
    Both generated documents were regenerated several times during this run
    because concurrent agents kept adding pages beneath both app roots; that
    churn is the ratchet working, not a fault in it.

- [x] **TTES-000-002** — Define separate tenant/deployer shells and prevent navigation/pattern leakage.
  - Status: PASS
  - Code/config: `tests/architecture/shell-separation.test.mjs`
  - Evidence: the first clause was already built and is not rebuilt here —
    `apps/system-studio` is its own Next application with its own
    `apps/system-studio/src/app/layout.tsx`, its own `globals.css` and its own
    components; `apps/web` has a separate shell under `components/shell/`. The
    second clause, *prevent* leakage, was held by convention only: the two
    guards that existed are narrower than the requirement
    (`tests/security/operator-boundary.test.mjs` asserts no `apps/web` route
    gates on `isPlatformOperator`; `tests/security/operator-plane-content.test.mjs`
    asserts the Studio imports no Prisma client), and neither says anything
    about UI. Nothing forbade one app importing the other's components, a
    shared shell component both navigations render through, or a control-plane
    destination in the tenant menu.
  - 8 guards, run by `npm run test:platform` (`tools/run-platform-tests.mjs`
    discovers `tests/**/*.test.mjs`; CI runs it at `.github/workflows/ci.yml:88`).
    They assert four properties, every input derived rather than listed:
    1. No file under one application's `src` imports another's — by relative
       path or by workspace package name (`tenure`, `@tenure/system-studio`).
       1,000+ specifiers resolved across both apps.
    2. No component reachable from an application's own layouts imports a
       first-party module outside that application.
    3. Every tenant menu destination — the 10 parsed from `modules/index.ts`
       plus the 4 the shell hard-codes itself (`SideNav.tsx` `href: "/settings"`,
       `ShellHeader.tsx` `href="/dashboard"` and `href="/inbox"`,
       `SearchCommand.tsx` `href="/search"`) — is a route `apps/web` serves and
       is under none of `/platform`, `/tenants`, `/api/platform`; and every
       destination in the console's `Nav.tsx` is a route the console serves and
       is not a tenant-only one. The control-plane prefixes are derived, not
       written here: the console's own top-level route segments minus any
       `apps/web` also serves, plus the `apps/web` paths
       `tools/ownership-map.mjs` assigns to the `control-plane` domain
       (`apps/web/src/app/api/platform/` — a control-plane surface served by
       the customer application, which a hand-written list would miss).
    4. No first-party workspace outside `apps/` defines a component, and no
       shell file — layout included — reaches one. (4a) scans the 16 workspace
       roots the workspace map yields that are not applications (`packages/*`,
       `modules`, `blueprints`), 239 source files, and fails any that is a
       `.tsx`/`.jsx`, carries `"use client"`/`"use server"`, imports
       `react`/`react-dom`/`next`, or calls `createElement`. (4b) walks each
       app's layouts plus its component graph and fails a first-party import
       that resolves neither inside the app nor inside one of those surveyed
       workspaces — the escape hatch of parking the same component in a
       top-level `shared/` that (4a) does not cover.
  - **Property 4 was added because property 2 did not do the job the previous
    revision of this entry credited it with.** That revision said a shell
    primitive published from `packages/` "would let both navigations render
    through one file" and that property 2 stopped it, and said "no package
    ships a `.tsx` today; this is what keeps that true". Neither was true, and
    the gap was demonstrated rather than argued: creating
    `packages/platform-config/src/ShellChrome.tsx` and importing it from BOTH
    `apps/web/src/app/(app)/layout.tsx` and `apps/system-studio/src/app/layout.tsx`
    left all 6 guards green. `shellGraph` walks *out of* the layouts but only
    follows modules under the app's own `components/`, and the layouts are not
    in the resulting set — so property 2 saw what `SideNav` imports and never
    saw what the layout rendering `SideNav` imports. That is not an edge case:
    the layout is where both navigations are mounted, so it is the likeliest
    place for a shared chrome import to land. Property 2 could not simply be
    widened to include layouts, because a layout legitimately imports
    `@tenure/platform-config`; the distinction that matters is not *outside the
    app* but *outside the app and renders*, which is what (4) tests.
  - Floors, because every assertion is an absence: fewer than 2 application
    source roots, a collapsed shell graph, fewer than 8 nav entries, fewer than
    20 tenant routes, a control-plane reader returning fewer than 5 paths,
    fewer than 8 surveyed shared workspaces, fewer than 100 files scanned by
    (4a), or a component detector that fails to recognise `SideNav.tsx` and
    `Nav.tsx` — or that flags `modules/index.ts`, which is pure data — all fail
    rather than reporting a clean repository.
  - Mutation proof — 7 mutations, 7 caught, each restored and re-run green:
    1. `import { SideNav } from "../../../web/src/components/shell/SideNav"` in
       `apps/system-studio/src/lib/fleet-health.ts` → property 1 alone reds,
       naming the file.
    2. the same import in `apps/system-studio/src/components/Nav.tsx` →
       properties 1 and 2 red.
    3. `import { navigationFor } from "@tenure/platform-config"` in `Nav.tsx` →
       property 2 alone reds, proving it is not property 1 in disguise.
    4. a nav entry with `href: "/platform/cost"` added to a manifest in
       `modules/index.ts` → `feed.cost -> /platform/cost (under /platform)`.
    5. `{ href: "/dashboard" }` added to the console's `ENTRIES` → the operator
       half reds; the tenant half stays green.
    6. `'apps/web/src/app/(app)/reports/'` added to the `control-plane` domain in
       `tools/ownership-map.mjs` → `budgeting.reports -> /reports (under /reports)`
       reds while "is a route apps/web serves" stays green, proving the
       control-plane derivation is live rather than decorative.
    7. `SideNav.tsx`'s hard-coded `href: "/settings"` → `"/settingz"` → reds,
       proving the shell's own destinations are checked and not just the catalog's.
  - Mutation proof for property 4, and re-proof of 1 and 3 against the 8-guard
    file — 6 more mutations, 6 caught, each restored and re-run 8/8 green:
    8. `packages/platform-config/src/ShellChrome.tsx` created and imported from
       BOTH layouts (`apps/web/src/app/(app)/layout.tsx`,
       `apps/system-studio/src/app/layout.tsx`) → against the 6-guard file:
       **8/8 pass, 0 fail — the leak this item exists to prevent, undetected.**
       Against the 8-guard file: property 4a reds,
       `packages/platform-config/src/ShellChrome.tsx is a .tsx/.jsx`. This is
       the mutation that justifies the change.
    9. the same component placed at `shared/ui/ShellChrome.tsx` — outside every
       workspace, so invisible to 4a — and imported from both layouts by
       relative path → property 4b reds, naming both layouts and
       `shared/ui/ShellChrome, which no survey covers`.
    10. `import { useState } from "react"` prepended to
        `packages/platform-config/src/branding.ts` → 4a reds
        `packages/platform-config/src/branding.ts imports react`, proving the
        detector is not merely an extension check.
    11. `uiEvidence()` stubbed to `return null` — the fail-open case — →
        property 4a passes emptily and the floor reds: `the component detector
        does not recognise apps/web/src/components/shell/SideNav.tsx as a
        component`. This is why the floor asserts on the detector and not only
        on the counts.
    12. `SHARED_ROOTS` filtered to `[]` → the floor reds with `0 first-party
        workspace(s) outside apps/ found, expected at least 8`, and both new
        guards red rather than passing over an empty survey.
    13. mutations 2 and 4 above re-run against the 8-guard file: the cross-app
        import in `Nav.tsx` now reds properties 1, 2 **and 4b**; the
        `href: "/platform/cost"` manifest entry still reds both halves of
        property 3. Restored → 8/8.
  - Commands (this revision): `node --test
    tests/architecture/shell-separation.test.mjs` → **8/8**.
    `npm run type-check` → **0 errors**. `npm run test:platform` → 309/313,
    the failures being `ownership.md`/`document-graph` staleness and the
    orphan-domain ratchet, all caused by source files other agents are adding
    to the tree as this runs. Proven not to be this item's: reverting this
    item's only changed file to `HEAD` and re-running
    `node --test tests/architecture/ownership.test.mjs` leaves `the committed
    map matches the code` red, and `node tools/ownership-map.mjs --check`
    reports the same staleness. This item adds no source file and changes no
    `.ts`/`.tsx`.
  - Recorded because it confused a concurrent item: mutation 9 above is the
    `shared/ui/ShellChrome` import that TTES-000-001's re-verification saw in a
    `npm run type-check` run and correctly reported as no longer existing. It
    was this mutation, held for one test run and removed.
  - Not fixed here, recorded because it is real: `tools/ownership-map.mjs` runs
    its CLI branch at module scope, so importing it writes
    `docs/architecture/ownership.md`. `tests/architecture/ownership.test.mjs`
    imports it at line 20, which regenerates the document before its own
    `--check` assertion runs — that assertion cannot currently fail. This guard
    therefore reads the map as text rather than importing it, per
    `tests/architecture/guards-do-not-write-into-the-tree.test.mjs`.
  - **Re-verification pass — property 3 read only one of the two syntaxes a
    shell writes a link in, and did not read the layouts at all.** The item was
    re-opened and each property re-proved rather than trusted. Properties 1, 2
    and 4 held. Property 3 did not, and the gap was demonstrated before it was
    argued: `<Link href="/platform/cost">Fleet cost</Link>` added to
    `apps/web/src/components/shell/ShellHeader.tsx` left **all 8 guards green,
    exit 0**. The customer masthead offered a link into the operator console and
    nothing said a word — which is this item's own stated failure mode, "the
    first operator nav entry would be caught by review, or not at all".
    Two causes, both fixed in `hardcodedDestinations`:
    - The reader matched `/\bhref:\s*"(\/[^"]*)"/` — the object-property form
      `SideNav` and the console's `ENTRIES` use — and nothing else. The JSX
      attribute form `href="/x"` is how `ShellHeader` links the wordmark and
      the work inbox and how anyone adding one link to the chrome writes it. It
      is now `HREF_LITERAL = /\bhref\s*(:|=)\s*"(\/[^"]*)"/`, which reads both
      and still ignores `href={expr}` (`NotificationBell` and `SearchCommand`
      route to whatever a notification or a search hit names — data, not a
      decision the shell made) and `href="#main"` (`SkipLink`).
    - It scanned `SHELLS.modules` — the components a layout mounts — and not the
      layouts themselves. The layout is where `<SideNav/>` and `<Nav/>` are
      mounted, so it is where a link "added to the shell" lands. It now scans
      `shellFiles(app)`, layouts included, and returns the file list it read so
      the floor can assert on it.
    The tenant shell's derived destinations went from 1 to 4: `/settings`
    (property, `SideNav.tsx`), `/dashboard` and `/inbox` (attribute,
    `ShellHeader.tsx`), `/search` (attribute, `SearchCommand.tsx`) — all four
    served by `apps/web`, none under a control-plane prefix.
  - Two floors added, because both halves of the widening fail open — a regex
    that stops matching one syntax silently drops every link written that way,
    and a file set that omits the layouts never looks where the leak lands:
    every layout in each app's shell graph must appear in the scanned file list,
    and the tenant shell must yield at least one destination of each syntax.
    Both assert against files that exist today, so the reader cannot go quiet
    without reddening.
  - Mutation proof — 7 mutations, 7 caught, tree restored to 8/8 green:
    1. `import { SideNav } from "../../../web/src/components/shell/SideNav"` in
       `apps/system-studio/src/components/Nav.tsx` → **exit 1**, properties 1, 2
       and 4b red (`not ok 2`, `not ok 3`, `not ok 5`), naming the file.
    2. `href: "/dashboard"` → `href: "/platform/cost"` (with id `dashboard.cost`)
       in `modules/index.ts` → **exit 1**, `not ok 6` and `not ok 7`:
       `dashboard.cost -> /platform/cost (under /platform)`.
    3. `ShellHeader.tsx` `href="/inbox"` → `href="/platform/cost"` — the JSX
       attribute case, **green before this pass** → **exit 1**, `not ok 6` and
       `not ok 7`: `apps/web/src/components/shell/ShellHeader.tsx hard-codes
       /platform/cost (under /platform)`.
    4. a `href: "/platform/cost"` nav item inlined into
       `apps/web/src/app/(app)/layout.tsx`'s `<SideNav sections={...}/>` — the
       layout case, also green before this pass → **exit 1**, `not ok 6` and
       `not ok 7` naming `apps/web/src/app/(app)/layout.tsx`.
    5. floor: `HREF_LITERAL` narrowed back to `(:)` → **exit 1**, `not ok 1`:
       `no attribute-syntax destination was read out of the tenant shell`. The
       guard reds instead of quietly under-reading.
    6. floor: `scanned` reverted to `SHELLS.get(app.name).modules` → **exit 1**,
       `not ok 1`: `apps/web/src/app/(app)/admin/layout.tsx is not among the
       files scanned for hard-coded destinations`.
    7. re-proof of property 4a against this revision:
       `packages/platform-config/src/ShellChrome.tsx` created →  **exit 1**,
       `not ok 4`: `packages/platform-config/src/ShellChrome.tsx is a .tsx/.jsx`.
       Deleted → 8/8.
  - Collateral repair, recorded because it was damage this pass caused: mutation
    3's restore-from-copy overwrote a `<Link href="/inbox" aria-label="Work
    inbox">` that TTES-030-001 wrote into `ShellHeader.tsx` inside the mutation
    window, leaving its `ListTodo` import unused and its comment describing a
    link that was gone. Reconstructed against what `apps/web/e2e/shell.spec.ts:137`
    asserts — `getByRole("link", { name: "Work inbox" })` → `/inbox`, which
    `apps/web/src/app/(app)/inbox/page.tsx` serves. `npm run type-check` → 0
    errors; the e2e itself could not be run, see below.
  - Commands (this revision): `node --test
    tests/architecture/shell-separation.test.mjs` → **8/8, exit 0**.
    `npm run type-check` → **0 errors**. `npm run test:platform` → 337/351; the
    14 failures are generated-artifact staleness and other items' in-flight work
    (`packages/contracts/src/index.ts` NUL byte, `ownership.md`/`document-graph`
    /contract-schema staleness, the system-studio `advance()` and configuration
    -revision guards, four ledger/prompt guards), none in a file this pass
    touched and none among this file's 8 subtests. Not run: `apps/web/e2e` — the
    Docker Desktop daemon answers `docker ps` with `500 Internal Server Error
    ... check if the server supports the requested API version`, so Postgres is
    unavailable. `docker version` reports the client only. Unblock with
    `docker compose up -d` once the daemon restarts, then
    `npx playwright test e2e/shell.spec.ts -g "work inbox"` from `apps/web`.

- [x] **TTES-000-003** — Import every `TTES-*` item into the canonical ledger.
  - Status: PASS
  - Code/config: `tests/architecture/ttes-requirements-are-imported.test.mjs` —
    6 subtests, run by `npm run test:platform`
    (`tools/run-platform-tests.mjs` discovers `tests/**/*.test.mjs`; CI runs it
    at `.github/workflows/ci.yml:88`). It imports the document graph's own
    parser rather than writing a second one, because two readers of one document
    disagree eventually and the loop acts on the graph's answer, not on a test's.
  - What was already true, stated plainly so this is not read as more than it
    is: the 34 rows were in the file before this pass. `requirementsIn()` over
    `Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md`
    returns 34 `TTES-*` ids; the ledger states 34; the two sets are equal, no id
    is stated twice, and `ledgerStatuses()` files none of them under another
    domain's ledger. Measured, not assumed.
  - What did NOT exist, and is what this closes: anything that would notice them
    leaving. `grep -rn TTES tests/ tools/ --include=*.mjs` found six files
    naming a TTES id and not one of them compares the Bible against the ledger.
    A completed import with no check over it is indistinguishable from an import
    that quietly loses ten rows six commits later, because the number nobody
    re-derives is the number everybody trusts.
  - The global ratchet in `tests/architecture/document-graph.test.mjs` is the
    wrong shape for this and stays as it is. It counts requirements reaching NO
    execution document, which is a union — so a `TTES-*` row filed under another
    domain's ledger leaves that count unmoved while the domain accountable for it
    has no row to work. It also looks in one direction only: an invented
    `TTES-000-009` inflates a denominator nobody re-derives, and a duplicated id
    is two statuses of which the loop reads whichever the parser saw last. All
    three are asserted here, plus the count.
  - Mutation run, each applied to the real file, run, and restored:
    1. `- [ ] **TTES-000-004**` → `- [ ] **TTES-000-004x**` in this ledger →
       `node --test tests/architecture/ttes-requirements-are-imported.test.mjs`
       gives 5 pass / 1 fail, `not ok 2 - every TTES requirement the Bible
       states has a row in the tenant-experience ledger`. Restored → 6/6.
    2. Added an invented `TTES-000-009` row and a second `TTES-000-003` row →
       5 pass / 1 fail, `not ok 3 - the tenant-experience ledger invents no
       requirement and repeats none`. Restored → 6/6, and
       `git diff --name-only` over this ledger came back empty.
    Not mutation-proven, and named rather than implied: subtest 1 (the count
    literal) would need an edit to the Bible, and subtest 4 (misfiling) an edit
    to another domain's ledger — both are outside this pass's file allowlist
    while sixteen other agents hold the tree.
  - Also verified: `tests/architecture/guards-do-not-write-into-the-tree.test.mjs`
    → 3/3, so this guard reads and does not repair.

- [x] **TTES-000-004** — Audit current deployed tenant product across personas/themes/viewports/accessibility.
  - Status: PASS
  - Code/config: `tools/ttes-experience-audit.mjs` (generator, `--check` mode),
    `docs/architecture/ttes-experience-audit.md` (its output, committed),
    `tests/architecture/ttes-experience-audit.test.mjs` (10 subtests, run by
    `npm run test:platform`). It reuses `apps/web/src/lib/a11y/css-declarations.mjs`
    — the brace-balanced CSS reader TTES-000-001 moved out of `theme-tokens.ts`
    — rather than writing a second stylesheet parser, for the reason that file's
    own header gives.
  - **The word "deployed", answered honestly rather than quietly.** There are two
    deployments: the live pilot at `Tenurework/Tenure`, which nothing here may
    reach, and this monorepo's nonproduction stack. This audit measures neither.
    It measures the checkout, it says so in §1 of its own output, and §7 lists
    what a checkout cannot answer — rendered contrast, focus order, screen-reader
    output, reflow at 400% zoom — as NOT ESTABLISHED, rather than letting four
    green tables imply somebody looked. An audit's silence reads as a pass, so
    the silence is written down.
  - **Derived, not written.** A written audit is a photograph of a tree that
    changed the same afternoon; its failure mode is "was right once", which reads
    identically to "is right". Every table is generated: 9 personas read from the
    three enums in `apps/web/prisma/schema.prisma` with the line each is declared
    on, 11 token scopes read from `apps/web/src/app/globals.css` by SHAPE (any
    rule declaring a custom property) so a new theme appears without anyone
    remembering to add it, 3 CSS breakpoints and 5 Tailwind prefixes with
    occurrence counts, 40 tenant pages each measured over its TRANSITIVE import
    closure, and 5 static accessibility checks over 136 non-test `.tsx` files.
  - **Findings it produced, and two false ones it produced first.** The audit's
    first run reported 3 fixed-width pages and 2 accessibility hits, and the
    majority of both was wrong — which is worth recording, because a findings
    list that has to be triaged is how a real finding gets ignored:
    * `app/page.tsx` and `orgs/[slug]/page.tsx` are 4- and 10-line `redirect()`
      stubs that emit no element. "Renders the same at 320px as at 1440px" is
      true of them and meaningless. Pages that emit no markup are now reported
      `redirect only` and not asked the question — 38 rendering pages, not 40.
    * `ConfirmDialog.tsx`'s `autoFocus` is inside an `<Overlay>`, where moving
      focus in is REQUIRED. The check is now `autofocus-outside-a-modal` and
      skips any file that renders a dialog.
    * The undeclared-token check first reported `--z-`, `--other`, `--x` and
      `--chart-N`; all four came from prose comments. Comments are stripped, and
      inline `"--avatar-bg":` style keys count as declarations, so `Avatar.tsx`
      is not reported for a token it sets itself.
    What survives: **1 of 38** rendering pages conditions nothing on a breakpoint
    (`apps/web/src/app/signin/page.tsx` — stated precisely: it is fluid
    `w-full max-w-md` and may well be fine, but nothing about it changes with
    the viewport and no test has looked at it narrow); **1** `target="_blank"`
    with no `rel` (`apps/web/src/components/documents/DocumentViewerOverlay.tsx`,
    a link to the sign-in page); **1** `autoFocus` outside a dialog
    (`apps/web/src/app/(app)/search/page.tsx`); and **high contrast has no
    in-product switch** — `prefers-contrast: more` is reachable only from the
    operating system. 0 orphan tokens, 0 undeclared references, 0 unmapped
    scopes, 0 personas the product never branches on.
  - Determinism, because a generated artefact that is "current here, stale in
    CI" has burned this programme repeatedly: directories are read in sorted
    order, every path is compared and printed POSIX-normalised, every file is
    CRLF-collapsed before it is scanned or line-counted, and nothing is stamped
    with a date, host or revision. The guard asserts no CR byte and no
    backslash path in the output, and renders twice in-process comparing bytes.
  - Mutation run — 5 mutations, 5 caught, each applied to the real file, run,
    and restored to green:
    1. `apps/web/prisma/schema.prisma:431` → `:999` in the committed audit →
       `node --test tests/architecture/ttes-experience-audit.test.mjs` gives
       9 pass / 1 fail, `not ok 1 - the committed audit matches what the
       generator produces now`. This is the REMOVE-OR-CORRUPT-ONE-ENTRY
       mutation the evidence protocol asks of an inventory.
    2. `ThemeSwitcher.tsx` → `ThemeSwitcherX.tsx` in the committed audit →
       8 pass / 2 fail, adding `not ok 2 - every path the audit cites exists`.
       A row naming a file nobody has is the fabricated-inventory failure.
    3. In the generator, `if (!/\balt\s*=/.test(m[1])) out.push` → `if (false)
       out.push` — the guard-that-cannot-fail shape, verbatim — → 9 pass /
       1 fail, `not ok 9 - the accessibility checks still fire on markup that
       is wrong`. A disarmed check prints `0` and reads as a clean bill.
    4. `ACTIVATION` key `'html.dark'` → `'html.dark-REMOVED'` → 8 pass / 2 fail,
       adding `not ok 6 - every token scope the stylesheet declares is mapped
       to something that enters it`.
    5. `PERSONA_ENUMS` reduced to two enums → 8 pass / 2 fail, adding
       `not ok 4 - the persona section reads all three enums and every value in
       them`. A partial vocabulary still renders as a full-looking table.
    After each restore: 10/10, and `git status --porcelain` over
    `tools/ttes-experience-audit.mjs` and the audit document showed them
    identical to the versions this entry describes.
  - Not run, and not claimed: no browser, no Playwright, no Postgres. The
    rendered half of this requirement is `TTES-020-004`, which is
    `BLOCKED_EXTERNAL` immediately below for the reason recorded there.
  - Pre-existing failures observed while verifying, neither attributable to
    these files: `tests/architecture/document-graph.test.mjs` → 11 pass /
    2 fail — `the compiled artifacts are current` (the two generated YAMLs are
    stale from other agents' concurrent ledger writes; the orchestrator runs
    `npm run generate`) and `a requirement stated twice is stated identically`
    (`WRK-000-001`, another domain). `requirementsIn()` over the new audit
    document returns `[]`, so it adds no requirement statement of its own.

- [x] **TTES-010-001** — Implement primitive/semantic/component/tenant token pipeline and type generation.
  - Status: PASS
  - There was one flat layer of hex literals and no type generation. `globals.css`
    declared the semantic names directly (`--primary: #198052`, `--text-1: #191a1c`), so
    there was no primitive tier for a semantic token to reference and "change the brand
    ramp" was a find-and-replace across the file. `grep -rn 'style-dictionary|tokens.json|designTokens'`
    hit only ledger prose.
  - **PRIMITIVE TIER.** 101 primitives — `--tenure-forest-*`, `-amber-*`, `-red-*`,
    `-blue-*`, `-teal-*`, `-orange-*`, `-violet-*`, `-berry-*`, `-navy-*`, `-slate-*`,
    `-paper-*`, `-ink-*`, plus the alpha steps and the two absolutes — declared once in
    `:root` so the dark and high-contrast palettes reference the same pool instead of
    each carrying a private copy. Every colour-valued semantic and component token was
    rewritten to `var(--tenure-…)`. The resolved values are byte-identical to what
    shipped, and that is the safety proof: `contrast.test.ts` resolves through the
    indirection and reported the same ratios before and after, so this is a re-layering
    and not a repaint.
  - **TYPE GENERATION.** `apps/web/scripts/generate-design-tokens.mjs` reads the
    stylesheet and emits `apps/web/src/lib/a11y/tokens.ts`: `TOKENS` (224 entries,
    `{name, layer}`), `TokenName` as a union over them, `cssVar(name: TokenName)` and
    `layerOf`. An unclassified token name THROWS rather than defaulting to a tier — a
    default would put every future token in whichever tier the fallback picked, and the
    tier is what the layering invariant is asserted against.
  - **THE THIRD COPY, WIRED.** `apps/web/src/components/charts/palette.ts` held eight
    literal `"var(--chart-N)"` strings. They are now `cssVar("--chart-1")…`, plus
    `CHART_GRID`, `CHART_AXIS`, `SURFACE`, `STATUS`, `REFERENCE` and `MUTED_SERIES`. A
    chart slot deleted from the stylesheet regenerates `tokens.ts` and fails `tsc` at
    the rendering call site, instead of emitting an undeclared custom property into a
    `fill` attribute where it renders as no fill and no test can see it.
  - Parser fix this rests on: `theme-tokens.ts` read only the FIRST `:root` block, so
    `--step-00`…`--step-4`, `--content-max`, `--gutter` and `--font-display` were
    declared, bound to Tailwind utilities, and invisible to every audit built on it. It
    now uses `paletteOf` (all unconditional `:root` blocks) and exposes `readBlocks()`
    and `declaredTokenNames()`.
  - Tests: `apps/web/src/lib/a11y/tokens.test.ts`, 13 cases — tokens.ts is exactly what
    the generator emits; the catalog accounts for every declared token and contains no
    ghost; every catalog name resolves in all four themes; only the primitive tier
    declares a raw colour; every colour-valued semantic/component token references a
    primitive; every `var()` in `tailwind.config.ts` is a catalog member; and the chart
    palette reaches the slots THROUGH `cssVar` (asserted on the source, because the
    emitted values are equal either way and comparing them alone proves nothing).
  - Mutations run:
    - Renamed `--text-1` to `--text-ink` in `globals.css` → 7 failed / 32 passed,
      including the Tailwind-reconciliation case "every token a colour utility is bound
      to resolves in all four themes"; restored → 58 passed.
    - Gave `--bg-subtle` a literal hex again (`#ebeae3`, the same colour the primitive
      resolves to, so the contrast audit stayed green) → "only the primitive tier
      declares a raw colour" and "every colour-valued semantic and component token
      references a primitive" both failed, 2 failed / 11 passed; restored → 13 passed.
      Identical colour, red test: the layering is what is being measured.
    - Reverted two chart slots to `"var(--chart-1)"` / `"var(--chart-2)"` literals →
      "the chart palette is built from the catalog" failed; restored → 70 passed.
  - Commands: `node apps/web/scripts/generate-design-tokens.mjs --check`,
    `npx jest src/lib/a11y/tokens.test.ts`, `npx jest src/components`.

- [x] **TTES-010-002** — Implement forest/cool-neutral light/dark/high-contrast themes with contrast/gamut tests.
  - Status: PASS
  - The four themes and the arithmetic were already real. The pairing list was not: it
    covered `--text-1` and `--text-2` on all three surfaces and silently omitted
    `--text-3`, which is the ramp the product writes metadata, table headers, timestamps
    and captions in — 294 occurrences across 80 files. `npx jest
    src/lib/a11y/contrast.test.ts` was 17/17 green while five real pairings failed AA.
  - **THE ROWS.** Added `--text-3` on `--bg-surface` / `--bg-base` / `--bg-subtle`
    (body), `--primary` on `--primary-light` (body — `ui/Badge.tsx:23`,
    `ThemeSwitcher.tsx:51`, `CalendarFilters.tsx:50`), `--primary-text` on
    `--primary-hover` and `--primary-press`, `--accent-text` on `--accent-hover`,
    `--accent-strong` on `--bg-base`, and `--accent` on `--bg-surface`. The last of
    those was found BY the TTES-GATE-010 ratchet on its first run.
  - **THE PALETTE, NOT THE TEST.** Light `--text-3` `#868b92` → `#63686f`
    (`--tenure-slate-560`): 3.29/2.98/2.84 → 5.38/4.87/4.66. Dark `--text-3` `#6b7280`
    → `#7f8794` (`--tenure-slate-450`): 3.91/4.12/3.68 → 5.22/5.50/4.91. Light
    `--primary-light` `#e4f2ea` → `#f0f9f4` (`--tenure-forest-25`): the accent on its
    own tint moves 4.28 → 4.60. The dark and high-contrast steps of all three already
    cleared and were not touched. Note the dark `--text-3` floor is `--bg-subtle`
    (3.68), not `--bg-surface` (3.91) as the survey said — fixed against the worse one.
  - **GAMUT.** `gamutViolations(theme)` in `apps/web/src/lib/a11y/contrast.ts`, called
    once per theme across `ALL_THEMES`. `grep -rn gamut apps packages tests tools`
    returned zero hits before this. Every declared value that IS a colour must be one
    `parseColor` can measure — so `oklch()`, `color(display-p3 …)`, `lab()`, `hwb()`
    and `color-mix()` are rejected by name rather than skipped, which is how an
    unmeasurable token would otherwise be absent from the audit rather than failing it.
    Range is checked on what was WRITTEN, not on the parse: `parseColor` clamps, so
    `rgb(300, 0, 0)` would otherwise be measured as pure red — a colour nobody
    authored. Values that merely CONTAIN a colour (`--shadow-md: 0 4px 12px rgba(…)`)
    are left alone; a shadow's alpha is an elevation decision, not a contrast one.
  - Tests: `apps/web/src/lib/a11y/contrast.test.ts` — 17 cases before, 26 after.
  - Mutations run:
    - Reverted light `--text-3` to `#868b92` in `globals.css` (the PRODUCER, not the
      helper) → "WCAG 2.2 AA contrast, in every theme › light" failed with
      `--text-3 on --bg-surface = 3.29:1, needs 4.5:1`, `--bg-base = 2.98:1`,
      `--bg-subtle = 2.84:1`; restored → 26 passed.
    - Reverted dark `--text-3` to the `#6b7280` primitive → the `dark` case failed with
      3.91:1 and 4.12:1; restored → passed.
    - Reverted `--primary-light` to the `#e4f2ea` primitive → `light` failed with
      "accent label on an accent tint: --primary on --primary-light = 4.28:1, needs
      4.5:1"; restored → passed.
    - Added `--probe: color(display-p3 1 0 0);` to `:root` → all four gamut cases
      failed; removed → 26 passed.
  - Commands: `npx jest src/lib/a11y/contrast.test.ts`.

- [x] **TTES-010-003** — Implement typography, spacing, density, shape, elevation, motion and z-layer contracts.
  - Status: PASS
  - Four of the seven contracts already existed — typography (`--step-00`…`--step-4`),
    spacing (`--space-1`…`16`), shape (`--radius-*`) and elevation (`--shadow-*`), all
    declared in `apps/web/src/app/globals.css` and bound in
    `apps/web/tailwind.config.ts`. Three did not, and this is those three.
  - **Z-LAYER.** Thirteen ordered tokens, `--z-raised: 10` through
    `--z-skip-link: 110`, each named for the REASON something is lifted rather than for
    a number. Every value is the value that already shipped, so nothing moved — except
    the two collisions, which were real:
    - `SkipLink` and `Overlay` were both `z-[100]`, and react-aria portals the modal
      backdrop to the end of `<body>`, so DOM order decided and a focused WCAG 2.4.1
      bypass link rendered UNDERNEATH an open dialog. `--z-skip-link` is now above
      `--z-overlay`.
    - The side-rail tooltip and the header's search results both tied with the header
      at `z-50`. They hang off fixed chrome and must clear it, so they have their own
      layer, `--z-chrome-popover`.
    The scrim invariant that the bare `z-index: 39` in `globals.css` encoded and that
    nothing checked — `--z-sticky < --z-scrim < --z-nav`, so the drawer scrim dims the
    page and the footer while leaving the nav it belongs to on top — is now an
    assertion.
  - **MOTION.** `--motion-fast: 120ms` / `--motion-base: 180ms` / `--motion-slow: 240ms`
    plus `--ease-entry` / `--ease-exit`, taken from the 140/150/160/180/200ms literals
    already spread across this file's keyframes and the shell's `duration-200` /
    `duration-300`. Bound as `duration-fast|base|slow` and `ease-entry|exit`. Every
    literal in `globals.css`'s own animation and transition rules is gone, and the four
    Tailwind numeric durations are migrated. `MainRegion` and `SideNav` now share one
    duration deliberately: they animate opposite edges of the same frame, and
    `duration-200` beside `duration-300` was a visible tear down the side of the page.
  - **DENSITY.** `--control-h-sm|--control-h|--control-h-lg`, `--row-h` and
    `--density-gap`, with a `:root[data-density="compact"]` override. Comfortable
    resolves to exactly the `h-8` / `h-10` / `h-11` / 32px nav row / `--space-5` gap
    that shipped before, so turning the contract on moved nothing.
    Production callers, because a token nothing reads is not a contract:
    `Button` (all four page sizes), `TextField`, `Select`, `SideNav`'s row, and
    `.bento-grid`. `data-density` is stamped on `<html>` before hydration by the same
    script in `apps/web/src/app/layout.tsx` that already sets `html.dark` and
    `html.nav-collapsed` — it has to be pre-hydration because the tokens are HEIGHTS,
    and resolving them after hydration reflows the whole frame one paint in — and
    `apps/web/src/components/DensitySwitcher.tsx` is how a person chooses it, rendered
    beside `ThemeSwitcher` on `/settings`.
  - Boundary: `arbitraryZIndex` and `arbitraryDuration` were added to
    `DESIGN_TOKEN_RULES` in `apps/web/eslint.config.mjs`, rejecting `z-[62]` and `z-40`
    alike. The messages are GENERATED from `globals.css` rather than written out, and
    `tokenClasses()` throws if the stylesheet declares none — so a rule can never
    advertise a class Tailwind does not generate.
  - Tests: `apps/web/src/app/design-contracts.test.ts` (14 cases) and the two new cases
    in `apps/web/scripts/design-token-lint.test.mjs`.
  - Mutations run:
    - Deleted the `zIndex` block from `apps/web/tailwind.config.ts` → "binds every
      declared layer as a Tailwind class, and invents none" failed (1 failed, 13
      passed); restored → 14 passed.
    - Set `--motion-base: 0s` in `globals.css` → "declares three real, strictly
      increasing durations" failed (1 failed, 13 passed); restored → 14 passed. The
      reduced-motion e2e is unaffected either way, which is exactly why the literal
      needed its own assertion.
    - Put `z-[61]` back into `TenureAIPanel.tsx` → `npx eslint
      src/components/ai/TenureAIPanel.tsx` errored on line 206 with the layer list;
      restored → exit 0.
  - Commands: `npx jest src/app/design-contracts.test.ts`,
    `npx jest scripts/design-token-lint.test.mjs`.
  - Re-verified 2026-08-07 by a later batch that was handed this row as still open.
    It is not. `apps/web/src/app/globals.css` declares the z-layer scale at :309-322,
    the motion scale at :337-341 and the density contract at :356-375 with its
    `:root[data-density="compact"]` override at :369; `apps/web/tailwind.config.ts`
    binds all three at :104-129 (`zIndex`, `transitionDuration`,
    `transitionTimingFunction`) and :84-87 (`height`); `apps/web/src/app/layout.tsx:57`
    stamps `data-density` pre-hydration and `apps/web/src/app/(app)/settings/page.tsx:198`
    renders `DensitySwitcher`. `npx jest src/app/design-contracts.test.ts` → 14/14, and
    `npx eslint` over all twelve migrated call sites (`src/components/shell`,
    `ui/Overlay.tsx`, `ai/TenureAIPanel.tsx`, `admin/DirectoryPicker.tsx`,
    `charts/ChartTooltip.tsx`, `CalendarTimeGrid.tsx`, `ClubCard.tsx`) → exit 0.

- [x] **TTES-010-004** — Implement safe tenant-brand overrides and rejection/preview.
  - Status: PASS
  - Three clauses; two were absent and the third was inverted.
  - **REJECTION.** Bible §14 asks for automated contrast/gamut checks that reject
    unsafe tenant tokens. `packages/platform-config/src/branding.ts` validated only the
    SYNTAX — `hexColor.safeParse(value).success` against
    `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` — which is the right check for the CSS
    injection risk it was written for and no check at all for legibility. A tenant
    setting `primaryColor: "#ffff00"` against the default `primaryTextColor: "#ffffff"`
    shipped a 1.07:1 primary button and nothing measured it, because the contrast audit
    reads the four STATIC themes out of the stylesheet and tenant CSS is injected after
    that. `apps/web/src/lib/a11y/tenant-brand.ts` exports `assessBrand(branding)` →
    `{accepted, rejections}`, using the existing `parseColor`/`contrastRatio` against
    two floors: the accent vs the label drawn on it at 4.5:1 (1.4.3) and the accent vs
    the card it sits on at 3:1 (1.4.11). A failing value is dropped back to the platform
    default — read from `BRANDING_DEFINITIONS`, not restated — with the reason. The ink
    is preferred as the thing to drop when a pair fails: the institution's colour is the
    identity, the ink on it is the consequence.
    Wired at the one production site: `apps/web/src/app/(app)/layout.tsx` is now
    `brandingCss(assessBrand(brandingFor(institution.slug)).accepted)`.
  - **Which themes it is measured in, and why not all four.** Tenant branding arrives as
    an injected `:root { --primary: … }`, specificity (0,1,0). The dark palette is
    declared in `html.dark`, specificity (0,1,1), so the dark block outranks it and a
    tenant's accent reaches the light themes only. Measuring against the dark card would
    reject every deep navy and maroon in higher education for a failure that does not
    happen. The premise is asserted from the stylesheet (`readBlocks().dark['--primary']`
    is declared), not from a comment.
  - **SEMANTIC LEAK.** Bible §4 says branding cannot override the focus token — and
    the focus ring was painted from `--primary`, the very token branding replaces, in
    `globals.css:349` (`[data-focus-visible]`), `globals.css:480` (`.chart-hit:focus-visible`)
    and **21** component class strings. `--border-focus` was already declared per theme
    and already used by every input border; the ring simply did not use it. All 23 now
    do. The survey named four sites; the real set was 21, found by scanning every chunk
    containing `focus` for a `*-[--token]` utility — which is what the test does, so the
    22nd cannot appear quietly.
  - **PREVIEW.** `apps/web/src/components/brand/BrandPreview.tsx`, a server component
    mounted beside Appearance on `/settings`. It draws the accent as a button label, a
    navigation rule and a focus ring in all four themes, with the measured ratio under
    each and the rejection text for anything refused. The dark rows say so explicitly
    and show the PLATFORM accent — a preview claiming the tenant's colour in dark mode
    would be a confident lie. Theme colours come from `THEME_SWATCHES`, reconciled
    token-by-token against `globals.css` by the test rather than hand-copied.
  - Tests: `apps/web/src/lib/a11y/tenant-brand.test.ts`, 19 cases.
  - Mutations run:
    - Set both floors in `assessBrand` to 0 → 5 failed / 14 passed, including "rejects a
      low-contrast accent — the #ffff00 button nobody could read" and "is what the
      production path emits into the document"; restored → 19 passed.
    - Put `var(--primary)` back on `[data-focus-visible]` in `globals.css` → "no focus
      rule in globals.css resolves to a token branding writes" failed; restored → 19
      passed.
    - Put `ring-[--primary]` back on `SearchCommand.tsx` and `SideNav.tsx` → "no focus
      utility in any component resolves to a token branding writes" failed; restored →
      19 passed.
    - Reverted `layout.tsx` to `brandingCss(brandingFor(institution.slug))` — mutating
      the PRODUCER, so a test that only called `assessBrand` directly would have stayed
      green → "is what the production path emits into the document" failed; restored →
      19 passed.
  - Residual, stated rather than hidden: `brandingCss` derives `--primary-light` as
    `color-mix(in srgb, <accent> 12%, white)`. That recipe lives in
    `packages/platform-config`, which this change does not own, and a 12% tint of an
    accent is ~4.3:1 against the accent for most hues — including the platform default.
    Gating on it would reject every tenant colour, so `assessBrand` does not, and the
    tint pairing is audited only for the platform palette (TTES-010-002). Closing it
    needs a change to `brandingCss`'s ramp.
  - Commands: `npx jest src/lib/a11y/tenant-brand.test.ts`.

- [x] **TTES-010-005** — Eliminate production raw style values outside approved exceptions.
  - Status: PASS
  - `apps/web/eslint.config.mjs` already enforced colour literals, arbitrary colour
    utilities, arbitrary shadows, unregistered fonts and vendor imports, with a dated
    exception table and a test that drives the real ESLint binary. What its own header
    said was NOT enforced was arbitrary spacing and arbitrary z-index, and for z-index
    it gave the reason: "`tailwind.config.ts` extends no `zIndex` scale and `globals.css`
    declares no `--z-*` tokens, so the rule would have no sanctioned alternative to
    name." TTES-010-003 made that false. This closes it.
  - `arbitraryZIndex` rejects `\bz-(?:\[|\d)` in any string or template plus an inline
    `zIndex` property; `arbitraryDuration` does the same for `duration-`. Numeric
    `z-40` is rejected as firmly as `z-[62]`, because nine hand-picked numeric layers —
    none of which looked wrong — are what accumulated across the shell.
  - Fourteen live call sites migrated, twelve from the survey plus two that appeared
    during the change: `SkipLink` `focus:z-[100]`→`focus:z-skip-link`, `ui/Overlay`
    `z-[100]`→`z-overlay`, `TenureAIPanel` `z-[60]`/`z-[61]`→`z-assist-scrim`/`z-assist`,
    `shell/Footer` `z-30`→`z-sticky`, `charts/ChartTooltip` and
    `admin/DirectoryPicker` `z-30`→`z-popover`, `CalendarTimeGrid` `z-30`/`z-20`→
    `z-dragged`/`z-marker`, `ClubCard` `z-10`→`z-raised`, `shell/ShellHeader`
    `z-50`→`z-header`, `shell/SearchCommand` and `ui/Tooltip` `z-50`→`z-chrome-popover`,
    `shell/SideNav` `z-40`→`z-nav`, `shell/OfflineBoundary` `z-[70]`→`z-toast`, and the
    raw `z-index: 39` in `globals.css`→`var(--z-scrim)`.
  - The stale count in the header is corrected: arbitrary spacing and type is **243
    occurrences across 59 files** as of 2026-08-07, not "237 across 58". The exact
    `node -e` command that produces the number is now in the comment beside it, so the
    next reader re-measures rather than inheriting a number nobody can reproduce. A
    spacing rule is still deliberately NOT added — that is the debt-ratchet item
    (TTES-050-004), and it cannot go green today.
  - Tests: `apps/web/scripts/design-token-lint.test.mjs`. The case that used to pin
    `z-[60]` as producing zero messages now asserts the opposite, and a second case
    asserts the rule message names every `--z-*` the stylesheet declares — so the
    generated message and the stylesheet cannot drift apart.
  - Mutations run:
    - Deleted the `arbitraryZIndex` entry from `DESIGN_TOKEN_RULES` → "rejects raw
      z-index and raw duration…" failed, `Expected substring: "Raw z-index"`; restored →
      passes.
    - Put `z-[61]` back into `apps/web/src/components/ai/TenureAIPanel.tsx` and ran
      `npx eslint src/components/ai/TenureAIPanel.tsx` → 1 error on line 206 naming the
      fourteen layer classes; restored → exit 0, no output.
  - Baseline after the change: `npx eslint "src/**/*.ts" "src/**/*.tsx"` reports **zero**
    `arbitraryZIndex` / `arbitraryDuration` violations across `apps/web/src`.
  - Re-verified 2026-08-07 by a later batch that was handed this row as still open.
    It is not. `npx jest scripts/design-token-lint.test.mjs` → 9/9, including "rejects
    raw z-index and raw duration, in both the arbitrary and the numeric form" and "names
    the z-layer classes the stylesheet actually declares". `apps/web/eslint.config.mjs`
    carries `arbitraryZIndex` at :206 and `arbitraryDuration` at :214 over
    `RAW_Z_INDEX_UTILITY` / `RAW_DURATION_UTILITY` (:136-137), and the header's spacing
    count reads "243 occurrences across 59 files as of 2026-08-07" with the `node -e`
    command that reproduces it — the stale "237 across 58" is gone. `grep -rnE
    'duration-(\[|[0-9])' apps/web/src --include=*.tsx` excluding tests returns nothing.
    Note the file is a jest test, not a `node --test` one (its own header, :14-16, says
    why): `node --test scripts/design-token-lint.test.mjs` fails with `__dirname is not
    defined in ES module scope` and that failure is the runner, not the boundary.

- [x] **TTES-020-001** - Implement/test the complete component inventory and behavior contracts.
  - Status: PASS
  - Code: `apps/web/src/components/ui/EmptyState.tsx` (now a delegating wrapper),
    `apps/web/src/components/ui/StateSurface.tsx`, and all seven call sites -
    `(app)/admin/approvals`, `(app)/admin/audit`, `(app)/admin/overrides` (x2),
    `(app)/calendar/new`, `(app)/orgs/[slug]/handoff`, `ResourcesBrowser.tsx`.
    Test: `apps/web/e2e/a11y.spec.ts` - "a filtered-to-nothing list says so".
  - The component that encodes the Bible's behaviour contract was dead code:
    the ONLY import of `StateSurface` anywhere under `apps/web/src` was its own
    test, so the fourteen-state ARIA/`presentsAsComplete`/`retryable` table was
    a declaration with no production caller. What the product rendered was
    `EmptyState` - a bare `<div>` with no role, no `aria-live` and no
    incompleteness marker - from every real call site, and it carried BOTH of
    the two meanings `states.ts` exists to separate: `ResourcesBrowser` showed
    the filtered-to-nothing case through the same component, with the same copy,
    as the genuinely-empty case.
  - `EmptyState` now delegates to `StateSurface` with a REQUIRED
    `state: "empty" | "no-results"`. No default, deliberately: a default would
    have compiled at every existing call site, kept every unit test green
    (tests build their own fixtures), and left the filtered panels announcing
    "nothing here yet" forever. `tsc` named all seven sites and each had to
    answer. `ResourcesBrowser` gained a `filtering` predicate - a search string,
    a type chip, or "My seats only" - and the audit log branches on
    `q || outcomeFilter`.
  - Deliberately NOT done: adding the twenty missing section-6 components
    (Toast, Menu, Breadcrumb, Pagination, Stepper, ...). The requirement's own
    smallest-change note says to give the existing contract a caller rather than
    add more surface area, and a Toast nothing renders would be the same dead
    code this entry is about.
  - Mutation run at the PRODUCER: changed `ResourcesBrowser.tsx`'s filtered
    branch back to `state="empty"` -> the a11y case fails at
    `expect(page.locator('[data-state="no-results"]')).toBeVisible()`;
    restored -> passes.


- [x] **TTES-020-002** - Implement owned form, grid, chart frame, workflow, memory and Relay patterns.
  - Status: PASS
  - Evidence: three owned models — `apps/web/src/components/ai/relay-reply.ts`,
    `apps/web/src/components/ui/data-table-model.ts` and
    `apps/web/src/components/charts/chart-table.ts` — each with a unit test beside
    it and one Playwright spec driving it through the real UI:
    `apps/web/e2e/relay.spec.ts`, `apps/web/e2e/data-table.spec.ts` and
    `apps/web/e2e/chart-frame.spec.ts`. All six files verified present.
  - Code - Relay: `apps/web/src/components/ai/relay-reply.ts` (+ its test),
    `TenureAIPanel.tsx`, `apps/web/src/app/(app)/layout.tsx`.
    Grid: `apps/web/src/components/ui/DataTable.tsx`,
    `apps/web/src/components/ui/data-table-model.ts` (+ test), adopted by
    `(app)/admin/audit/page.tsx` and `components/documents/DocContentView.tsx`.
    Chart frame: `apps/web/src/components/charts/ChartFrame.tsx`,
    `apps/web/src/components/charts/chart-table.ts` (+ test), adopted by
    `charts/panels/ActivityChart.tsx`.
    Tests: `apps/web/e2e/relay.spec.ts`, `e2e/data-table.spec.ts`,
    `e2e/chart-frame.spec.ts`.
  - **Relay.** `/api/ai/chat` returns `aiDisabledReason` and `toolRefusal`, and
    the route's own header says collapsing them "would tell at least one person
    something false". The panel typed the response as
    `{answer, aiEnabled, sources}` and dropped both - so a tenant that
    deliberately switched the assistant off was told "AI answers aren't set up
    for this workspace yet", and a principal refused the retrieval tool was told
    "I couldn't find anything about that in your workspace", a false statement
    about their own data. `relayReply` decides the four outcomes, ordering the
    tool refusal BEFORE the zero-sources branch, and the panel calls it. Also
    added: a required `scope` prop naming the tenant (one construction site, so
    it cannot be silently unset), an `AbortController` + Stop button, and two
    permanently-mounted live regions.
  - **Grid.** `grep -rn "DataGrid|DataTable" apps/web/src` returned zero; seven
    hand-rolled `<table>`s shipped instead. The audit log - 200 rows, the
    densest surface in the product - emitted six bare `<th>` with no `scope`, no
    `<caption>`, no `aria-rowcount` and no sort. `DataTable` requires a caption,
    emits `scope="col"` on every header, carries `aria-sort` on sortable ones,
    and has a `redact` hook that blanks a cell the viewer may not read WITHOUT
    dropping the row (an absent row would say the object does not exist). The
    comparator and the sort-cycle live in `data-table-model.ts` so they are
    testable in this repo's `testEnvironment: "node"` jest with no DOM library.
  - **Chart frame.** `grep -rn 'ChartFrame' src/` returned zero, `<table` inside
    `src/components/charts` returned zero, and `csv|download` returned zero.
    `ChartFrame` carries the title, the question, source, freshness, unit and
    filters, plus a disclosure-toggled `<table>` with a `<caption>` and
    `scope="col"` headers built from the SAME `columns`/`rows` the mark is
    handed, plus a CSV export. `csvCell` prefixes `=`, `+`, `-`, `@`, tab and CR
    with an apostrophe (section 12 formula injection).
  - Mutations run: (a) collapsed the `toolRefusal` branch out of `relayReply`
    -> "a refused user is not told the assistant is unconfigured" fails;
    restored -> 6 passed. (b) `const sign = sort.direction === "desc" ? -1 : 1`
    -> `const sign = 1` -> "orders descending by the same column" fails;
    restored -> 12 passed. (c) dropped the apostrophe prefix from `csvCell` ->
    5 of 9 cases fail including `=1+1`; restored -> 9 passed.
  - Honest limit: the owned FORM pattern and the owned WORKFLOW pattern are not
    in this change. They are named here so the PASS is not read as covering
    them.


- [x] **TTES-020-003** — Wrap approved primitives and prevent domain imports of raw vendor APIs.
  - Status: PASS
  - Code: `apps/web/src/components/ui/Menu.tsx` (new — `MenuTrigger`,
    `MenuPopover`, `Menu`, `MenuItem` with the `inline` / `split` row layouts),
    `apps/web/src/components/ui/Tooltip.tsx` (new — `Tooltip`, `TooltipTrigger`
    carrying the owned 250ms/0ms timing, `Focusable`),
    `apps/web/src/components/ui/Overlay.tsx` (`PopoverDialog`),
    `apps/web/src/components/ui/Button.tsx` (`shell` variant, `shell` /
    `shellIcon` sizes; radius and ring-offset moved from the cva base onto the
    variants so a variant can differ without depending on Tailwind's stylesheet
    ordering to break the tie), `apps/web/eslint.config.mjs`
    (`RESTRICTED_VENDOR_IMPORTS`, `OWNED_WRAPPERS`, the
    `tenure/design-tokens-owned-wrappers` config block).
  - Callers rewritten to consume them: `shell/ShellHeader.tsx`,
    `shell/TenantSwitcher.tsx`, `shell/NotificationBell.tsx`,
    `shell/SideNav.tsx`, `CalendarSubscribe.tsx`, `ClubImageEditor.tsx`. Zero
    modules outside `src/components/ui/**` now name `react-aria-components` or
    `class-variance-authority`.
  - What changed: the vendor boundary covered icons only. `lucide-react` and
    `@phosphor-icons/react` were restricted; `react-aria-components` — the
    library that actually carries behaviour — was not, and six modules imported
    it raw. The rule could not be switched on because two of the primitives it
    would forbid had no sanctioned alternative to name: there was no owned
    Menu/Popover and no owned Tooltip. Both exist now, the six modules were
    migrated onto them, and `no-restricted-imports` names them in its message.
    The wrapper-layer carve-out re-states the icon restriction rather than
    turning `no-restricted-imports` off, so `src/components/ui/**` may name
    react-aria and still may not bypass the icon registry — a blanket `"off"`
    would have widened the icon boundary from one file to twenty as a side
    effect.
  - Tests: `npx jest --ci scripts/design-token-lint.test.mjs` → 9 tests, of
    which two are new ("refuses a vendor component library outside the owned
    wrapper layer", "leaves no shipping product module naming a vendor
    primitive"); `npx jest --ci src/components/ui/owned-wrappers.test.tsx` →
    5/5, every assertion read off the DOM a production component rendered.
  - Mutation: removed `react-aria-components` from `VENDOR_COMPONENT_PATHS` →
    the new lint case failed (`Expected substring "Vendor component library in
    a product module", received ""`); restored → passes.
  - Mutation: set `TooltipTrigger`'s owned `delay` to 5000 → the SideNav
    tooltip case failed (`Received: null` after advancing 400ms); restored →
    passes. Proves the production tooltip's timing comes from the wrapper.
  - Mutation: replaced `ui/Tooltip.tsx`'s `TOOLTIP_CLASS` with `"outline-none"`
    → same case failed on the missing `pop-panel`; restored → passes.
  - Mutation: replaced `PopoverDialog`'s panel classes with `"outline-none"` →
    the NotificationBell case failed (`received "outline-none"`); restored →
    passes.
  - Not covered: `npx playwright test e2e/shell.spec.ts` could not be run.
    `node scripts/seed.mjs` fails at `ledgerEntry.create` with "Argument
    `institutionId` is missing" — an in-flight schema change in
    `apps/web/prisma/schema.prisma` (+467 lines, uncommitted, another agent's)
    that `scripts/seed.mjs` has not caught up with. Neither file is in this
    change. Once the seed is fixed:
    `docker run -d -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure -p 5521:5432 postgres:16`,
    `DATABASE_URL=... npx prisma migrate deploy && node scripts/seed.mjs`,
    `npx playwright test e2e/shell.spec.ts e2e/calendar.spec.ts e2e/notifications.spec.ts`.
  - RE-VERIFIED 2026-08-07, re-issued to a later agent as still-open and found
    already satisfied — returned NOT_APPLICABLE rather than rebuilt. Each of the
    six modules the survey named as importing the vendor raw now imports the
    owned wrapper: `ShellHeader.tsx:4-5`, `SideNav.tsx:6`,
    `TenantSwitcher.tsx:4-5`, `NotificationBell.tsx:5,7`,
    `CalendarSubscribe.tsx:4,6`, `ClubImageEditor.tsx:3,5`. The sanctioned
    alternatives the rule message names exist: `src/components/ui/Menu.tsx`
    (`MenuTrigger` re-export :30, `MenuPopover` :61, `Menu` :73, `MenuItem` :83)
    and `src/components/ui/Tooltip.tsx` (`Focusable` re-export :26, `Tooltip`
    :39, `TooltipTrigger` :55). The restriction is live at
    `eslint.config.mjs:310-316` with the wrapper carve-out at :413-422.
  - Commands run in that re-verification, with results:
    `npx jest scripts/design-token-lint.test.mjs` → 9 passed;
    `npx jest src/components/ui/owned-wrappers.test.tsx` → 5 passed;
    `npx next lint --file src/components/ClubImageEditor.tsx` → exit 0, clean.
    Four fresh mutations (A–D) and their exact failure output are recorded under
    TTES-GATE-020 below rather than duplicated here.
  - `npm run type-check` reports 8 errors, and NONE are in this item's files.
    They are `packages/provisioning/src/index.ts` (7, missing `./change-class`
    and five `./execute` exports) and `src/app/(app)/inbox/page.tsx` (1, `Cannot
    find name 'Inbox'`) plus its derived `.next/types/validator.ts` route error
    — all in another agent's in-flight, partly-untracked work. Verified by
    `git diff --name-only` over this item's file list coming back empty against
    HEAD, so none of the failures can be attributable to it.

- [ ] **TTES-020-004** — Provide state/theme/density/locale/viewport stories and visual baselines.
  - Status: BLOCKED_EXTERNAL
  - **Reclassified from FAIL to BLOCKED_EXTERNAL on 2026-08-14. Nothing was built
    and nothing is claimed; the status is corrected, and the correction matters.**
    `FAIL` means "the rest can be built now" and returns the item to
    `tools/loop/next-batch.mjs` every tick, forever. Every remaining step here
    requires a human hand, so an agent takes this row, re-derives the same
    blocker, writes the same paragraph and moves on — which is what the two
    dated updates below already are. The three steps, each with the exact
    command, unchanged from the 2026-08-08 analysis and independently
    re-verified today:
    1. Dispatch `.github/workflows/visual-baselines-refresh.yml`
       (`workflow_dispatch` only, by design — it holds `permissions: contents:
       read` and pushes nothing):
       `gh workflow run visual-baselines-refresh.yml --ref studio-program`
    2. Download and unpack its artifact into the repository:
       `gh run download <run-id> -n visual-baselines -D apps/web/e2e/__screenshots__`
    3. Commit those PNGs together with the "Visual baselines (pinned
       container)" step restored verbatim from `6038a62` into
       `.github/workflows/ci.yml`, where a comment currently stands in its
       place at line 373.
  - Why an agent cannot do step 3 in particular: `.github/workflows/**` is
    shared across every domain running against this tree, and restoring a CI
    step there is precisely the kind of edit that must not be made from a
    parallel run. The file is named and the change is named; a human or the
    orchestrator makes it.
  - Why steps 1–2 cannot be replaced by capturing locally, re-measured today
    rather than taken on trust: the baselines must be captured on Linux (the
    same Inter renders through DirectWrite on Windows and FreeType on Linux and
    the two disagree on nearly every antialiased pixel). From this Windows host
    that needs a container, and `docker version` reports the client only while
    `docker ps` answers `request returned 500 Internal Server Error for API
    route and version .../v1.54/containers/json` — the Docker Desktop daemon is
    unreachable, exactly as recorded on 2026-08-08. `ls apps/web/e2e/__screenshots__`
    → `No such file or directory`; `apps/web/e2e/visual-baselines.spec.ts` and
    `.github/workflows/visual-baselines-refresh.yml` both exist. All four
    measured on 2026-08-14.
  - This row goes to PASS when the comparison runs green in CI against committed
    reference images — not when the workflow exists, and not when an artifact has
    been downloaded. Everything below is the prior analysis, kept in full.
  - Stale prose left deliberately untouched, flagged here rather than silently
    edited: `TTES-GATE-020`'s body says "004 … is FAIL in this file". It is now
    `BLOCKED_EXTERNAL`. That row belongs to the gate, not to this requirement,
    and this pass was scoped to three rows while sixteen other agents held the
    tree; no guard reds on it (`ledger-statuses` 8/8,
    `status-assertions-are-exact` 3/3, `pass-requires-evidence` gate subtests
    green), and the gate's blocker is unchanged either way. Whoever next edits
    the gate should restate it.
  - **Reclassified from PASS on 2026-08-07, and the claim below was false.** This entry
    said "the PNGs in `apps/web/e2e/__screenshots__` were generated in
    `mcr.microsoft.com/playwright:v1.61.1-noble`". They were not. That directory has
    never contained a file. The suite therefore failed 37/37 in CI on its first run —
    36 cells with "A snapshot doesn't exist, writing actual", plus a floor assertion
    demanding more than 60 catalogue entries which read 41 off an error page it had
    failed to sign in to. The refuter that would have caught this died on the session
    limit, so nothing independent ever looked at the claim.
  - Built, and NOT withdrawn: `apps/web/src/components/ui/gallery-catalog.ts` derives the
    catalogue from `STATES`, `BUTTON_VARIANTS` × `BUTTON_SIZES` and
    `BADGE_VARIANT_STYLES` rather than re-listing them — 90 entries — and
    `apps/web/src/app/(app)/gallery/page.tsx` renders it behind a fail-closed
    `TENURE_UI_GALLERY` gate. Both are real and proved by
    `apps/web/src/components/ui/gallery-catalog.test.ts`, 5 cases, still green.
  - Withdrawn: `apps/web/e2e/visual-baselines.spec.ts`. Its design is sound and it is
    preserved in commit `db95980`; what it lacks is reference images, and a screenshot
    suite with no baselines cannot pass anywhere. Shipping it red would have left CI red
    permanently, which is how a visual suite gets deleted for real.
  - UPDATE (2026-08-08). The spec is back in the tree — a later run restored it and
    added the CI step that runs it properly — and the reference images still do not
    exist, so the step failed 4/4 on every push. What changed today is narrow and it is
    NOT a status change: the SPEC and its `visual` project stay, the blocking CI step
    is withdrawn, and the route to producing the images is now a workflow instead of a
    paragraph.
    * Kept, unchanged: `apps/web/e2e/visual-baselines.spec.ts`, its `visual` project in
      `playwright.config.ts`, and `pinnedImageMismatch()` — the fingerprint (linux +
      `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` + an `/etc/os-release` saying noble)
      that makes the spec skip anywhere the baselines would measure the host font
      stack rather than the page.
    * Withdrawn from `.github/workflows/ci.yml`: the step "Visual baselines (pinned
      container)", and only that step. Its body was correct — it started the app,
      asserted the `/api/health` wait had SUCCEEDED rather than merely run out, and ran
      `mcr.microsoft.com/playwright:v1.61.1-noble` with `--network host` against it —
      and it is unchanged in history at `6038a62`, to be restored verbatim in the same
      change that lands the PNGs. A comment in its place says so.
    * Added: `.github/workflows/visual-baselines-refresh.yml` — `workflow_dispatch`
      only, the same image and project and server configuration as the withdrawn step
      plus `--update-snapshots`, uploading `apps/web/e2e/__screenshots__/` as an
      artifact with `if-no-files-found: error` so a run that captured nothing fails
      instead of shipping an empty zip somebody commits as "the baselines". It holds
      `permissions: contents: read` and pushes nothing: a human downloads the artifact
      and commits the images through review. Baselines a workflow regenerated for
      itself are references nothing can fail against, which is the same shape as the
      empty directory.
    * What was NOT done, deliberately: making the spec skip when `__screenshots__` is
      empty. A screenshot suite that passes with no reference images is a disabled
      guard wearing a green tick, and this repository has been burned by that pattern
      repeatedly. FAIL with a button next to it is the honest state.
  - BLOCKER, measured rather than assumed. The baselines must be captured on Linux —
    the same Inter renders through DirectWrite on Windows and FreeType on Linux and the
    two disagree on nearly every antialiased pixel. From this Windows host that means a
    container reaching the app on the host's loopback, and three routes were tried and
    all three fail: `--network host` binds Docker Desktop's Linux VM, not Windows, so
    `localhost:3000` is refused; `--add-host=localhost:host-gateway` resolves ahead of
    the IPv6 loopback entry and is also refused; and `host.docker.internal` reaches the
    app but the post-login redirect returns the absolute `NEXTAUTH_URL`, which
    `src/lib/env.ts:176` requires to be https or loopback. That guard is correct — the
    risk it names is a session cookie crossing a wire in clear, and Docker's virtual
    network is a wire — so it was not weakened to produce test fixtures.
  - To unblock, either: run the command in `db95980`'s spec header from a Linux host
    with the app served on `:3000`, commit `apps/web/e2e/__screenshots__/*.png` and
    restore the spec; or add a CI job on `ubuntu-latest` that runs
    `npx playwright test --project=visual --update-snapshots` and uploads the PNGs as an
    artifact for a human to commit. The second needs no new hardware and is the smaller
    change.
  - The second of those is now BUILT (2026-08-08) rather than proposed:
    `.github/workflows/visual-baselines-refresh.yml`. Three steps remain and all three
    need a human: dispatch it, unzip `visual-baselines` into
    `apps/web/e2e/__screenshots__/`, and commit those PNGs together with the restored
    "Visual baselines (pinned container)" step from `6038a62`. This row goes to PASS
    when the comparison runs green in CI against committed references — not when the
    workflow exists, and not when an artifact has been downloaded.
  - Also to fix on restore: the floor `expect(ids.length).toBeGreaterThan(60)` is wrong.
    `GALLERY_ENTRIES` is 90 today, measured; 60 was a guess that happens to sit between
    the real count and the 41 an error page produces, so it fails for the right reason
    by accident rather than by design.
    * DONE in the restored spec, and verified by reading it: the count is derived, not
      guessed — `expect(idsWith("surface-")).toHaveLength(ALL_STATES.length * 2)`, with
      every other catalogue group asserted non-empty and four named anchors. Neither
      number can go stale, and a fifteenth `SurfaceState` fails on the count as well as
      on the missing baseline.
  - Before this: `find apps/web/src -name '*.stories.*'` returned nothing, there was no
    `.storybook`, and `grep -rl 'toHaveScreenshot' apps/web/e2e` was empty. The raw
    material was there and unused — `apps/web/src/components/ui/states.ts` enumerates
    fourteen `SurfaceState`s and `StateSurface.tsx` renders every one of them from that
    table — but each is reached only when a production caller happens to be in it, so no
    state had ever been rendered in dark, high-contrast, compact, RTL or at 320px on any
    run. `states.test.ts` asserts on the semantics table and on the component's SOURCE
    TEXT, which is a different thing from looking at it.
  - `apps/web/src/components/ui/gallery-catalog.ts` is the catalogue, and every entry is
    DERIVED rather than transcribed: surfaces from `ALL_STATES`, buttons from
    `BUTTON_VARIANTS` × `BUTTON_SIZES`, badges from `BADGE_VARIANT_STYLES`. Those three
    maps were extracted into named exports for exactly this reason — `cva` does not
    expose its configuration at runtime, so `Button`'s variants had to become consts
    before anything could read them. A catalogue that re-listed the fourteen states
    would keep rendering fourteen after somebody added a fifteenth, every baseline would
    still match, and the suite would report green over a state nobody had looked at.
    `fields` is the one hand-written group and the module header says so: TextField and
    Select have no variant map, their axes are boolean props.
  - `apps/web/src/app/(app)/gallery/page.tsx` renders it. Gated on
    `TENURE_UI_GALLERY === "true"`, fail-closed (any other value is `notFound()`), inside
    the authenticated `(app)` group, and `dynamic = "force-dynamic"` so the gate is read
    per request rather than baked in at build. The pilot's task definition does not set
    the variable; `playwright.config.ts` does, for a test run.
  - `apps/web/e2e/visual-baselines.spec.ts` walks
    light/dark/high-contrast × comfortable/compact × ltr/rtl × 320/768/1440 — 36 cells —
    plus one screenshot per catalogue entry in a canonical cell. Theme and density go
    through `localStorage` and a reload, so the matrix drives the real pre-hydration
    script in `src/app/layout.tsx` rather than a test-only path, and each cell asserts
    the document actually took the preference before photographing it: 36 identical
    screenshots that all pass is the obvious way for this to be worthless.
  - Baselines are pinned to one platform, and that pinning is why this is FAIL rather
    than PASS. Font rasterisation is a property of the OS — the same self-hosted Inter
    goes through DirectWrite on Windows and FreeType on Linux — so the spec was given
    its own `visual` project with no `{platform}` segment in `snapshotPathTemplate` and
    a skip off-linux. The design is right. The PNGs were never produced; see the
    BLOCKER above for the three routes tried and why each fails from this host.
  - Tests: `apps/web/src/components/ui/gallery-catalog.test.ts` (the derivation, 5
    cases) — green, and the only half of this requirement that is actually proved.
    There is no pixel coverage until the baselines exist.
  - Mutations run: none. This is not "recorded below once executed" — it was never
    executed, and saying so is the point of reclassifying the row.

- [ ] **TTES-030-001** - Implement role-aware shell, home, command/search, inbox and record anatomy.
  - Status: FAIL
  - Code: `apps/web/src/components/shell/SearchCommand.tsx`,
    `apps/web/src/components/shell/ShellHeader.tsx`,
    `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/ui/PageHeader.tsx`,
    `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx`.
    Test: `apps/web/e2e/shell.spec.ts` - the two command-palette cases.
  - **Built and proven:** the palette half. There was no Cmd-K anywhere in the
    tenant product - the only key handler in the whole shell was an `onKeyDown`
    on the search input, so the palette could not be reached from the keyboard
    from any route, while the OPERATOR console has had one since GE-022-007. A
    document-level keydown now opens and focuses it on Cmd/Ctrl-K. The widget
    has real combobox semantics (`role="combobox"`, `aria-expanded`,
    `aria-controls`, `aria-autocomplete`, `aria-activedescendant`; the `<ul>` is
    a `listbox` and each `<li>` an `option` with `aria-selected`) - before, the
    `active` index moved a background colour and a screen-reader user was told
    nothing. Permission-aware ACTIONS come from `sections`, the SAME
    `navigationForSystem(slug, capabilities)` result the layout already computes
    and hands to `SideNav`, threaded through a REQUIRED `sections` prop on both
    `ShellHeader` and `SearchCommand` - an optional prop would have compiled at
    the one construction site and shipped an action-less palette. Recent objects
    are kept in `sessionStorage` (title/href/kind/context only - no credential,
    gone when the tab closes).
  - **Why FAIL rather than PASS:** section 5.3 record anatomy is started, not
    finished. `PageHeader` gained a `status` slot (identity -> state -> primary
    actions) and ONE record page adopted it (`orgs/[slug]/handoff`). The other
    five club surfaces - members, finance, documents, memory, impact - still
    hand-roll an `<h1>` each and are outside this change's file allowlist; and
    section 5.1's inbox is untouched. The remaining work is buildable now, so
    this is FAIL rather than BLOCKED_EXTERNAL.
  - Mutation run: deleted the document-level `keydown` listener from
    `SearchCommand` -> "Ctrl-K opens the command palette from any route" fails at
    `expect(combobox).toBeFocused()`; restored -> passes. Second mutation:
    removed `aria-activedescendant` from the input -> the same test fails at
    `toHaveAttribute("aria-activedescendant", "shell-search-opt-0")`.


- [x] **TTES-030-002** - Implement responsive desktop/tablet/mobile and bounded offline patterns.
  - Status: PASS
  - Code: `apps/web/src/components/shell/OfflineBoundary.tsx`,
    `apps/web/src/app/(app)/layout.tsx` (mounts it, line 88),
    `apps/web/src/app/globals.css` (`html[data-offline]` block).
    Test: `apps/web/e2e/offline.spec.ts`.
  - **CORRECTION 2026-08-17 — this row cited three files that do not exist, and
    had done since the day after it was written.** The `Code:` line above used to
    end "and three route boundaries - `(app)/admin/audit/loading.tsx`,
    `(app)/resources/loading.tsx`, `(app)/orgs/loading.tsx`". All three were
    deleted in `a8ceb8b`, whose message explains why: on those three subtrees a
    `loading.tsx` aborts the App Router's RSC fetch mid-flight, so `<Link>`
    clicks do not navigate and server actions never settle — it took the
    `apps/web` Playwright suite to 157/175 and cost 12 failures and 3.4 minutes
    of runtime. `find apps/web/src/app -name loading.tsx` returns **0 files**
    again, exactly as this row's own prose says it did before the work.
  - The PASS stands and the reason is the requirement's own sentence:
    "responsive desktop/tablet/mobile and bounded offline patterns". The
    responsive half (`NavDrawerToggle`, the 700px off-canvas rules,
    `layout.spec.ts` at 1280/1024/768, `a11y.spec.ts` at 320) and the bounded
    offline half (`OfflineBoundary` mounted in the shell layout, `data-offline`
    stopping every submit, `StateSurface` supplying the role and politeness) are
    both intact and both proven. Route-level *loading* boundaries are §16's
    list, not this requirement's, and §16 is `TTES-GATE-020`'s territory.
  - Consequence worth recording rather than hiding, because it is what made the
    stale citation findable: with those three files went the only callers of
    `Skeleton`. `docs/architecture/ttes-governance-dashboard.md` §1 counts
    **0** product modules importing it, and no product module passes `geometry`
    to `StateSurface` (`grep -rn geometry apps/web/src/app apps/web/src/components
    --include=*.tsx` returns one hit, a comment inside `BarChart.tsx`), so
    `skeletonHeight`'s tested arithmetic currently reaches nothing that renders.
    That is an adoption gap on the dashboard, not a false claim here — this row
    no longer claims it.
  - Found by `tests/architecture/tenant-experience-architecture.test.mjs` — "the
    tenant experience's own record cites files that exist" — added under
    `TTES-GATE-000`. Nothing had ever checked that a ledger row's `Code:` line
    names files that exist, and this row is the reason it now does.
  - The responsive half was already real (`NavDrawerToggle` + the 700px
    off-canvas rules; `layout.spec.ts` at 1280/1024/768 and `a11y.spec.ts` at
    320). The offline half did not exist at all: `states.ts` declared an
    `offline` state with role/politeness/copy and NOTHING rendered it,
    `navigator.onLine` appeared nowhere, no `online`/`offline` listener existed,
    and `manifest.ts` ships `display: "standalone"` - an installed PWA with no
    service worker and no offline surface shows the browser's error page.
  - `OfflineBoundary` subscribes to both events plus an initial
    `navigator.onLine` read (a page loaded from cache while already offline
    fires no event, which is the load where the banner matters most) and renders
    `<StateSurface state="offline" />`, so the role, the politeness and the copy
    come from `STATE_SEMANTICS`/`DEFAULT_COPY` rather than from the call site.
    The BOUND is enforced rather than promised: `data-offline` on `<html>` makes
    `globals.css` stop the pointer on every `form button[type=submit]`, and the
    component sets `aria-disabled` on the same controls so the rule is reported
    to assistive technology too. `pointer-events` rather than the `disabled`
    attribute deliberately - a disabled control leaves the tab order, so a
    keyboard user would lose their place the moment a train enters a tunnel.
  - `find src/app -name loading.tsx` returned 0 files across 37 pages, so three
    heavy list routes now reserve their real geometry through `Skeleton`'s
    tested `skeletonHeight` arithmetic - which, like `StateSurface`, had a test
    and no caller.
  - Mutations run: (a) deleted the `window.addEventListener("offline", ...)`
    line -> `offline.spec.ts` fails at `expect(banner).toBeVisible()`; restored
    -> passes. (b) flipped `STATE_SEMANTICS.offline.live` from `"polite"` to
    `"off"` -> the same spec fails at `toHaveAttribute("aria-live", "polite")`
    (`StateSurface` omits the attribute entirely for `off`); restored -> passes.


- [x] **TTES-030-003** - Implement contextual Relay and memory continuity.
  - Status: PASS
  - Code: `apps/web/src/components/ai/AIProvider.tsx` (`AIScope`,
    `AIScopeAnchor`), `apps/web/src/components/ai/TenureAIPanel.tsx`,
    `apps/web/src/app/api/ai/chat/route.ts` (`parseScope`, `biasToScope`,
    `scopeApplied`), `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx` (the
    first record page to declare itself). Test: `apps/web/e2e/relay.spec.ts`.
  - Relay was a chat window pasted over the product, which section 10 forbids by
    name: the whole shared context value was
    `{open, openPanel, closePanel, toggle}`, so "ask from any record" had no
    mechanism, and the POST body was `{question, history}` - context-free, so
    the route ranked the whole corpus identically whichever page you asked from.
  - The scope is now derived from `usePathname()` and overridden by any
    `AIScopeAnchor` a record page mounts; it is RENDERED in the header
    ("Asking within: University of Rochester - Simon Consulting Club") and SENT
    with the question. The route parses it, applies it as a ranking BIAS - it
    reorders what `loadSearchCorpus(actorId)` already authorised and can never
    widen that set, because a filter would answer "nothing found" for a question
    whose answer lives on another club's page - and echoes back `scopeApplied`,
    so the panel shows what Relay was allowed to favour rather than a claim. An
    `AbortController` plus a Stop button gives the cancellation section 10
    requires.
  - Mutation run at the PRODUCER: dropped `scope` from the panel's POST body ->
    "asking from a club record scopes the question to THAT record" fails at
    `expect(body.scope).toBeTruthy()`; restored -> passes. The assertion reads
    the request the panel actually emits, so a test that called a scope helper
    directly would not have caught it.
  - Honest limit: conversation persistence across a reload is still absent -
    the thread lives in `useState`. The requirement's own smallest-change note
    scopes this entry to anchoring and showing the scope, which is done and
    proven; thread persistence needs a store and belongs with the memory work.


- [ ] **TTES-030-004** — Prove all thirteen journeys across materially different tenants/personas.
  - Status: FAIL
  - Reason: imported from `Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **TTES-030-005** - Implement and prove the `WRK-*` Connection Center, missing-connection cards, resource selection, reauth/admin request, external-action preview/receipt and thirteenth proving journey.
  - Status: BLOCKED_EXTERNAL
  - Code shipped: `apps/web/src/lib/connections/capability-resolution.ts`
    (+ test), `apps/web/src/components/connections/MissingConnectionCard.tsx`,
    with two real production callers -
    `apps/web/src/components/ai/TenureAIPanel.tsx` (replacing the bare
    "AI answers aren't set up for this workspace yet" line) and a Connections
    section on `apps/web/src/app/(app)/settings/page.tsx`.
    Tests: `apps/web/src/lib/connections/capability-resolution.test.ts` and the
    "an unconnected model produces the owned card" case in `e2e/relay.spec.ts`.
  - **Built:** the half with real state behind it. `resolveCapability` maps a
    capability's observable state to exactly one of CONNECTED /
    NEEDS_USER_CONNECT / NEEDS_ADMIN / NOT_CERTIFIED / UNAVAILABLE and to the
    one path each earns, with the WRK-030-005 rule enforced first and
    unconditionally: a non-certified capability can never yield a connect
    action. The card carries plain-language access, who owns it, one path, and
    the question preserved for resumption. The settings section lists the three
    connections that genuinely exist, each reading its status from the same
    function the feature gates on - `aiConfigured()`, `storageConfigured()`, the
    per-user ICS feed - so it cannot say "connected" about something the feature
    would refuse.
  - **Blocked:** the provider half. `Connection`, `ConnectionOpportunity`,
    `PendingActionIntent` and `ConnectionLaunchToken` (WRK-010-001 /
    WRK-030-002) exist in no package and no migration, and
    `apps/web/prisma/schema.prisma` is owned by another cluster run. External
    action preview/receipt and the thirteenth proving journey both require those
    rows; anything shipped without them would be a canned value claiming a
    certified provider connection. To unblock:
    create `packages/work-graph` with the four models, then
    `npm exec --workspace apps/web -- prisma migrate dev --name work_graph_connections`,
    then re-run this item.
  - Mutation run: made the `NOT_CERTIFIED` branch return
    `{ kind: "connect", ... }` -> "a non-certified capability never yields a
    connect action" fails at `expect(resolved.action.kind).toBe("none")`;
    restored -> 5 passed.


- [x] **TTES-040-001** - Pass WCAG 2.2 AA automated/manual/assistive-technology tests.
  - Status: PASS
  - Code: `apps/web/src/components/ai/TenureAIPanel.tsx` (4.1.3 status region),
    `apps/web/src/components/CalendarTimeGrid.tsx` +
    `apps/web/src/components/calendar/EventInspector.tsx` (2.5.7 resize paths).
    Tests: `apps/web/e2e/a11y.spec.ts` - "4.1.3 Status Messages" and
    "2.5.7 Dragging Movements".
  - The two Level-AA criteria the spec neither covered nor named, both genuinely
    failed. **4.1.3 Status Messages:** the assistant answer went into a plain
    `<div>` and the "thinking" indicator into another, and `grep -rn aria-live
    src/components` had no hit anywhere under `components/ai` - so nothing was
    announced when an answer arrived on a panel mounted into every route by
    `(app)/layout.tsx`. There are now two permanently-mounted live regions: a
    `role="status" aria-live="polite" aria-atomic="true"` line whose text is
    derived from the same `loading`/`messages` state the visible UI renders
    ("Tenure AI is thinking" / "Answer ready, N sources"), and the transcript
    itself as `aria-live="polite" aria-atomic="false"`. Mounted even when empty,
    because a region that appears together with its content is not announced.
  - **2.5.7 Dragging Movements:** an event's DURATION could only be set by
    dragging a 6px `aria-hidden` handle. `nudge()` handled ArrowUp/Down/Left/
    Right for MOVE only. Two alternatives now exist and both commit through the
    same `commit()` the drag uses: a single-pointer path (click the chip, press
    "15 min longer" in the inspector - no drag anywhere in it, which is what the
    criterion literally asks for) and a keyboard path (Alt+ArrowUp/Down on the
    focused chip). **Alt, not Shift:** `e2e/calendar.spec.ts:211` asserts
    Shift+ArrowDown MOVES an event by an hour, so taking Shift for resize would
    have reddened an existing test rather than made the product accessible. The
    chip's accessible name now advertises both, and the two handles carry
    accessible names instead of `aria-hidden`.
  - Mutations run: (a) removed `aria-live` from the panel's status node ->
    "4.1.3 Status Messages" fails at the `toHaveAttribute("aria-live",
    "polite")` assertion; restored -> passes. (b) removed the `ev.altKey` resize
    branch from `nudge()` -> "2.5.7 Dragging Movements" fails at the persisted
    `1:00 PM to 3:15 PM` assertion after reload; restored -> passes.


- [x] **TTES-040-002** - Pass UI security/privacy/export/session/forbidden-state tests.
  - Status: PASS
  - Code: `apps/web/src/app/(app)/admin/overrides/page.tsx`,
    `apps/web/src/app/(app)/admin/audit/page.tsx`,
    `apps/web/src/components/documents/DocumentViewerOverlay.tsx`.
    Test: `apps/web/e2e/admin-console.spec.ts` - "a capability refusal inside
    the console is refused, not hidden".
  - **Forbidden state.** `StateSurface` was a complete 150-line component with
    ZERO production callers: repo-wide it was imported only by its own test.
    Meanwhile two console routes called `notFound()` for a CAPABILITY refusal on
    a surface the viewer had legitimately reached - an administrator, already
    past `admin/layout.tsx`'s `if (!isAdmin(ctx)) notFound()`, told a page does
    not exist one click after the console's own nav rendered the link to it.
    Both now `return <StateSurface state="permission-denied" />`. Every
    OBJECT-level `notFound()` is untouched (`orgs/[slug]/documents/page.tsx:42`,
    `calendar/[id]`, `messages/[id]`): existence-hiding is for objects a person
    should not know about, and no object is named here.
  - **Session.** `SaveStatus` gained `session-expired`. A 401 from the autosave
    used to fall into `error`, which sets `dirtyRef.current = true` - so the
    debounce re-fired into a signed-out session, forever, until the reader
    navigated away and lost what they had typed. The new branch latches
    `expiredRef`, stops both `doSave` and `scheduleSave`, keeps the draft in
    component state, and renders `StateSurface state="permission-denied"` with a
    re-authenticate link. Nothing is persisted anywhere - no token, no
    localStorage, no sessionStorage - so
    `tests/security/no-tokens-in-browser-storage.test.mjs` stays satisfied.
  - **Export.** The clause was vacuous (no CSV/download path existed at all in
    `apps/web`). `ChartFrame` + `chart-table.ts` now ship one, and its
    `csvCell` enforces the section 12 formula-injection rule under unit test.
  - Mutations run: (a) put `admin/overrides/page.tsx` back to `notFound()` ->
    the console test fails at `expect(refusal).toBeVisible()`; restored ->
    passes. (b) deleted `role={semantics.role}` from `StateSurface.tsx` -> the
    same test fails at `toHaveAttribute("role", "alert")`; restored -> passes.


- [ ] **TTES-040-003** — Meet route/component/bundle/RUM performance budgets.
  - Status: FAIL
  - Re-checked 2026-08-17 and still empty on every one of the four legs the
    requirement names. This row previously said only "imported …; not yet
    implemented", which reads identically for a requirement nobody has opened and
    one somebody has measured as absent. It is the second.
    * **Route** — no budget file of any kind:

      ```
      ls tools/perf-budget.mjs   # absent on 2026-08-17
      ```

      (`tests/architecture/pass-requires-evidence.test.mjs` re-runs that line, so
      the day somebody adds the file this row has to be re-decided rather than
      quietly outliving its subject.)
    * **Component** — nothing measures a component's render cost. `grep -rn
      "performance.mark\|performance.measure" apps/web/src` is empty.
    * **Bundle** — `grep -rln budget apps/web/next.config.* apps/web/package.json
      .github/workflows/*.yml` returns nothing, so §17's "bundle ownership and
      regression budgets enforced in CI" has no enforcement point.
    * **RUM** — `grep -rl "web-vitals\|reportWebVitals\|onLCP\|onINP"
      apps/web/src` is empty. There is no real-user monitoring to partition by
      route, device or tenant tier.
  - Why it is FAIL and not BLOCKED_EXTERNAL: nothing external is missing. What it
    needs is a production build to measure against, which `npm run build` provides
    (exit 0 as of 2026-08-07, recorded under `TTES-050-001`), and a place to put
    the numbers. It was not attempted in this batch for the stated reason that
    eleven agents were holding the tree and `npm run studio:build` takes ~350s —
    a wave where everyone builds is a wave where nobody finishes. That is a
    scheduling decision, not a blocker, and it is recorded so the next batch does
    not re-survey the same four greps.
  - Nearest thing that does exist, so it is not rebuilt: `apps/web/e2e/support/
    journey-metrics.ts` counts what a task costs a persona in clicks, key presses
    and route commits (`TTES-050-001`). That is interaction cost, not load or
    render performance, and it needs a served application.

- [ ] **TTES-040-004** — Pass localization/RTL/zoom/high-contrast/reduced-motion tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **TTES-040-005** — Pass long-session and frontline usability tests.
  - Status: FAIL
  - Re-checked 2026-08-17. `grep -rln "frontline\|long.session" apps/web/e2e`
    returns nothing, and every journey the metrics harness measures is a
    single-task path (`J01`…`J08` in `apps/web/e2e/journeys.spec.ts`): none holds
    a session open across an idle period, a token refresh or a device sleep, which
    is what §18's "perceived workload/comfort in representative long sessions"
    asks about. The previous text — "imported …; not yet implemented" — was true
    and said nothing a reader could act on.
  - What would close it, so the next batch starts from here: a spec that keeps one
    authenticated session alive across several tasks and asserts the two things a
    long session actually breaks — that autosave does not re-fire into an expired
    session (the `session-expired` latch recorded under `TTES-040-002`) and that
    accumulated client state does not degrade the surface — plus a frontline
    scenario on the scanner/mobile path §19's journey 6 names. Both need a served
    application and a seeded Postgres, so neither is provable in a build-free
    batch; `apps/web/e2e/support/journey-metrics.ts` is the harness they would
    reuse rather than replace.
  - FAIL rather than BLOCKED_EXTERNAL: Postgres and Playwright are both available
    to a batch that runs them (`docker compose up -d`, then `prisma migrate deploy`
    and `node apps/web/scripts/seed.mjs`, which runs clean since 2026-08-07).
    Nothing external is missing.

- [ ] **TTES-050-001** — Establish task scorecard baselines/targets by persona.
  - Status: FAIL
  - Reason: the measurement half now exists and runs; the baselines it is supposed to
    establish do not. `apps/web/e2e/support/journey-metrics.ts` counts what a journey
    costs a persona — trusted clicks, trusted key presses, route commits including
    `pushState`, distinct pathnames — and holds each journey to the row it has in
    `docs/architecture/ux-task-scorecard.md`. Four persona journeys in
    `apps/web/e2e/journeys.spec.ts` call it. Their rows are declared and their budgets
    are still `—`. This stays FAIL rather than BLOCKED_EXTERNAL because nothing
    external is missing.
  - **The seed blocker this entry recorded is gone, and was already gone when it was
    still written down here.** It said `node apps/web/scripts/seed.mjs` aborted with
    "Argument `institutionId` is missing"; `apps/web/scripts/seed.mjs:476` now sets it
    and the whole setup runs clean —
    `DATABASE_URL=postgresql://tenure:tenure@localhost:5462/tenure npm exec --workspace
    apps/web -- prisma migrate deploy` then `node apps/web/scripts/seed.mjs` →
    "Seed complete — 26 clubs, 235 seats, 172 directory people, 259 seat holdings,
    34 deliverables, 15 board resources", and `npm run type-check` → 0 errors.
    A stale blocker is the most expensive kind of stale sentence in a ledger, because
    the loop skips the item for exactly as long as it stands. That observation is what
    `tests/architecture/pass-requires-evidence.test.mjs` — "an entry that says a file is
    absent is still right about it" — now exists to prevent for the claims a machine can
    re-check.
  - **The build blocker this entry recorded is gone as well, and it went the same way as
    the seed one.** It said the four rows could not be filled in because `npm run build`
    reported `Failed to compile` on `src/app/(app)/orgs/[slug]/finance/page.tsx:153`
    (`'OrgRecordHeader' is not defined`) and `src/components/ClubImageEditor.tsx:3`
    (restricted `react-aria-components` import), both another slice's work caught
    half-applied, with `J01` and `J03` ending on those pages. That slice has landed.
    Re-run from the repository root on 2026-08-07: `npm run build` → **exit 0**,
    `✓ Compiled successfully`, `✓ Generating static pages (10/10)`, warnings only.
    Corrected here by the batch holding `TTES-050-002`, whose own blocker names this
    item's budgets as a precondition — two blockers written into this row and its
    scorecard section have now each become false with nothing watching, which is the
    pattern rather than the pair of incidents.
  - What remains between here and four recorded numbers is therefore neither of the two
    sentences above: it is that `npm run e2e` needs a Postgres to seed, and the two
    Playwright suites need the app served against it. `apps/web/e2e/journeys.spec.ts`
    drives eight journeys (`J01`…`J08`), not four — the connection paths added for
    `WRK-110-005` are measured by the same harness — so eight rows are waiting, not four.
    The commands are in `docs/architecture/ux-task-scorecard.md`; read the observed rows
    before pasting them in, because a harness that writes its own baseline records
    whatever regression it just measured and calls it the new normal.
  - Code: `apps/web/e2e/support/journey-metrics.ts`, `apps/web/e2e/journeys.spec.ts`,
    `docs/architecture/ux-task-scorecard.md`
  - Tests: `apps/web/e2e/support/journey-metrics.spec.ts` (5 cases against a real
    Chromium and a fixture site served by request interception, so the harness stays
    verifiable while the app cannot be seeded),
    `tests/architecture/ux-task-scorecard.test.mjs` (6 cases)

- [ ] **TTES-050-002** — Run lawful competitor workflow comparisons without copied trade dress.
  - Status: BLOCKED_EXTERNAL
  - Reason: the requirement's substance is a measured comparison — the same job, done in
    a competitor product, timed. Two things it needs are not in this repository and
    cannot be written into it: **lawful licensed access** to the products §18 names
    (Granola, Vercel, Brex, Monarch, Perplexity, ChatGPT, Intuit Enterprise Suite, SAP,
    Workday, Oracle, Rippling — several are enterprise suites whose terms govern
    benchmarking and publication), and a **human-subjects protocol** with enough
    participants for the difference to mean anything. Neither is code, and neither is a
    decision an agent may make. A number produced without them would be
    indistinguishable to every reader and to every test here from a measured one, which
    is what the requirement's "lawful" and "without copied trade dress" wording exists
    to prevent — so this is recorded blocked rather than passed.
  - What would unblock it: a human decision written as **`ADR-0009-competitive-benchmarking.md`**
    under `docs/decisions/` (0009 is the next free number; 0008 is taken twice), naming
    (a) which products Tenure holds licences to benchmark and what those licences permit
    measuring and publishing, and (b) an approved human-subjects protocol and
    participant pool. Nothing in this repository can produce either. Until that file
    exists this item is not startable:

    ```
    ls docs/decisions/ADR-0009-competitive-benchmarking.md   # absent on 2026-08-07
    ```

    With it, the right-hand columns go into `docs/architecture/ux-task-scorecard.md`
    beside the left-hand ones, and `TTES-050-001`'s budgets have to be recorded first —
    a comparison against an unmeasured baseline compares one number to nothing.
  - **That `ls` line is now run, not just written.** `tests/architecture/pass-requires-evidence.test.mjs`
    — "an entry that says a file is absent is still right about it" — parses
    `ls <path>   # absent on <date>` out of every ledger entry and asserts the path is
    still missing, failing with "re-decide the item rather than leaving it blocked" the
    day the ADR lands. A blocked item is one `tools/loop/next-batch.mjs` stops offering,
    so a blocker nobody re-checks is how a requirement disappears; this session found
    exactly that on the sibling item, where `TTES-050-001` and the scorecard both still
    recorded a seed failure that had since been fixed. Proven by creating the ADR path:
    the case failed naming `TTES-050-002`; removed, it passes.
  - Code: the half that could be built now was: `apps/web/e2e/support/journey-metrics.ts`
    and `docs/architecture/ux-task-scorecard.md` give the comparison a measured
    left-hand side, so the day access exists there is something true to compare against.
  - Tests: `tests/architecture/ux-task-scorecard.test.mjs` — "no competitor task time
    has been written down that nobody measured" fails on any table row that names one of
    those products beside a number. Proven by adding
    `| Workday | Manager | Approve an expense | 9 | 0 | 4 | 3 |`: 1 of 6 failed;
    removed, 6 of 6 pass. That guard is the enforcement of this blocker — it is what
    stops the next agent closing this item with plausible numbers.
  - **Re-verified 2026-08-07** by a later batch handed this item as still open on the
    grounds that "grep across docs/ and apps/ finds no competitor comparison artefact, no
    task-time measurement harness, and no scorecard". All three exist:
    `docs/architecture/ux-task-scorecard.md`, `apps/web/e2e/support/journey-metrics.ts`
    and its 5-case self-check, and the guard above. Nothing was taken on trust — every
    claim in this entry was re-run:
    1. `ls docs/decisions/ADR-0009-competitive-benchmarking.md` → still absent, and
       `ls docs/decisions/` confirms 0009 is still the next free number (0001–0007, then
       0008 twice). The blocker stands.
    2. The absence guard re-proved by creating that path → "an entry that says a file is
       absent is still right about it" reds naming this item; removed → green.
    3. The competitor guard re-proved by the `Workday` row above → 1 of 6 red; removed →
       6 of 6.
    4. `npx playwright test e2e/support/journey-metrics.spec.ts` (with
       `PLAYWRIGHT_BASE_URL` set so the fixture spec needs no application server) →
       **5 passed**. The left-hand side's harness is not merely present, it runs.
  - **The one thing that changed, and it is the sibling row's blocker, not this one's.**
    This entry says `TTES-050-001`'s budgets have to be recorded before a comparison
    means anything, and that item recorded `npm run build` as what stopped them. That is
    now false — `npm run build` exits 0 — and the sentence is corrected in place on
    `TTES-050-001` above. It does not move this item: the build was never this item's
    blocker. Licensed access and a human-subjects protocol are, they are still absent,
    and no amount of work inside this repository produces either.
  - Not done, deliberately, and it is the whole point of the "lawful" wording: no
    competitor number was written anywhere, and none was derived from any model's
    recollection of those products' interfaces. The status stays BLOCKED_EXTERNAL rather
    than FAIL because what is missing is not buildable here — it is a licence and an
    ethics approval, both of which are decisions only a human may make.

- [x] **TTES-050-003** - Implement design-system versioning, release notes, migration and deprecation.
  - Status: PASS
  - Code: `apps/web/src/components/ui/design-system.ts`,
    `apps/web/src/components/ui/design-system.test.ts`,
    `apps/web/eslint.config.mjs` (`deprecatedNamesFrom`,
    `deprecationImportRules`).
  - None of the four existed. `grep -rn "@deprecated" src packages` returned
    nothing repo-wide; there was no CHANGELOG outside `node_modules`; and
    `packages/releases` versions a TENANT SYSTEM (blueprint + modules +
    configuration + topology, frozen and hashed), not the token or component
    layer. So the `#1c8c5a -> #198052` contrast fix reached every tenant with no
    version, no note and no migration - recorded only as a comment in
    `packages/platform-config/src/branding.ts`.
  - The mechanism, not the numbers, is the deliverable. `tokenHashNow()` hashes
    every token in all four themes as `readThemes()` resolves them from the REAL
    `globals.css` - the same reader the contrast audit uses - and the jest test
    asserts it equals `VERSIONS.at(-1).tokenHash`. `notes` and `migration` are
    REQUIRED fields, so an entry cannot be added empty to make CI green; a
    separate case asserts both are non-trivial. `DEPRECATIONS` is read
    textually by `eslint.config.mjs`, which builds a `no-restricted-imports`
    entry naming the replacement and the `removeIn` version. The register is
    empty today and that is a true statement, not an unfinished one - nothing
    has been deprecated yet, and the enforcement is what this item is for.
  - Mutations run: (a) `--tenure-forest-700: #198052 -> #198053` in
    `globals.css` -> the hash test reds with
    `Expected "cf8b53db5945ffcde7be76eb5b882fe8" / Received
    "6e54391cf603fc60cce227d0d0b5af09"`; restored -> 5 passed. (b) added a
    throwaway `ThrowawayForMutationProof` entry to `DEPRECATIONS` and imported
    it from `EmptyState.tsx`; `npx next lint --file src/components/ui/EmptyState.tsx`
    reported `'ThrowawayForMutationProof' import from '@/components/ui/design-system'
    is restricted ... no-restricted-imports`; both removed -> "No ESLint warnings
    or errors".
  - CAVEAT, stated so nobody is surprised by it: this is a ratchet, and it is
    supposed to bite. Any change to any `--token` in `globals.css` by anybody
    reds `design-system.test.ts` until a `VERSIONS` entry with notes and a
    migration is added. That is the requirement working, not a flaky test.


- [x] **TTES-050-004** — Publish adoption/exception/visual-debt dashboards and ownership.
  - Status: PASS
  - Code: `tools/ttes-governance-dashboard.mjs` — `DEBT_CLASSES`, `DEBT_BUDGETS`,
    `debtMeasurements`, `ownerOfFile`, `designTokenExceptions`, `adoption`,
    `ownedWrappers`, `productModules`, `render`, and a `--check` mode.
    Output, committed: `docs/architecture/ttes-governance-dashboard.md`.
  - Caller: `tests/architecture/ttes-governance-dashboard.test.mjs` (7 subtests),
    which `npm run test:platform` discovers via `tools/run-platform-tests.mjs`
    (`tests/**/*.test.mjs`) and CI runs at `.github/workflows/ci.yml:88`. The
    generator's own `--check` branch is the second caller, and
    `tools/superiority-claims.mjs` is a third the other way round — §5 of the
    dashboard reads the claim gate from it, so `TTES-050-005`'s rule appears on
    the dashboard rather than only in a test.
  - **This requirement was already named as this requirement, by the code.**
    `apps/web/eslint.config.mjs`'s "WHAT IS NOT ENFORCED, and why not" section
    says of arbitrary spacing and type utilities: "a rule here is a cleanup
    project across the whole product rather than a boundary, so it is the
    debt-ratchet item (TTES-050-004)". The debt was therefore recorded — as a
    number in a comment, "243 occurrences across 59 files as of 2026-08-07",
    itself a correction of an earlier "237 across 58" that had drifted — with a
    one-line re-measurement script beside it that nobody runs.
  - **Re-measured on the first run of the generator: 275 across 66.** The debt
    grew by 32 occurrences and 7 files in ten days while the only record of it
    was a comment. That is the whole argument for this item, and it is why the
    budgets below are asserted rather than printed.
  - Three separate questions, three tables, because they fail differently:
    * **Adoption** (§1) — one row per module in `apps/web/src/components/ui/`,
      read from the directory so a wrapper added tomorrow appears with zero
      importers rather than not at all, with the count of product modules that
      import it. Findings: `Card` 39, `Badge` 28, `icons` 61 — and **three owned
      wrappers with no product importer at all**: `IconFrame`, `Skeleton`,
      `Tabs`. `Skeleton`'s is a regression with a cause, recorded under
      `TTES-030-002` above: its only three callers were the `loading.tsx` route
      boundaries deleted in `a8ceb8b`.
    * **Exceptions** (§2) — read out of `DESIGN_TOKEN_EXCEPTIONS`, so an
      exception cannot be granted in the config and stay off the dashboard. Four
      today, each naming files, the rule keys it suspends, a reason and an
      expiry. Read as text, not imported, and the reason is measured rather than
      assumed: `import('./apps/web/eslint.config.mjs')` throws `Cannot read
      config file … Failed to patch ESLint because the calling module was not
      recognized`, because the config loads `eslint-config-next` through
      `FlatCompat`. That file already reads `design-system.ts` with a regex for
      the same class of reason and says so in its own header.
    * **Visual debt** (§3) — six classes, and a class is only on the list if the
      sanctioned alternative ALREADY EXISTS. That qualification is the line
      between debt and an unmade decision: easing keywords are debt because
      `--ease-entry` exists, and a class with no owned replacement would be a ban
      rather than debt. `raw-text-input-element` deliberately excludes checkbox,
      radio, file and hidden inputs for exactly that reason — `TextField` does
      not wrap them.
  - **Ownership** (§4) — every debt occurrence carries the domain
    `tools/ownership-map.mjs` assigns its file, inverted per file out of
    `classify()` rather than re-derived from `DOMAINS`, so this table cannot
    disagree with the ownership ratchet. `erp-modules` carries 176 occurrences
    across 18 files; 79 across 31 files sit on `shared`, which is not a domain
    and therefore has nobody to pay them.
  - **The budgets are the deliverable, not the tables.** A dashboard that only
    reports is a number that goes up — that is precisely what the comment in
    `eslint.config.mjs` was. `DEBT_BUDGETS` is asserted in BOTH directions: over
    budget is a regression, and UNDER budget is a budget nobody lowered after
    paying debt down, with the message naming the number to lower it to. So the
    ratchet cannot acquire slack for the next regression to hide in.
  - Determinism: sorted directory reads, POSIX paths, CRLF collapsed before
    anything is counted, two in-process renders byte-compared, and **no clock** —
    there is deliberately no "days until expiry" column, and the guard asserts
    the only dates in the document are the exception expiries themselves. A
    document that goes stale by sitting still teaches every reader to ignore its
    staleness check.
  - Kept out of the document graph on purpose: `tools/document-graph.mjs`
    classifies any `.md` whose first 4,000 characters contain a bare authority
    word as an authority document, so the dashboard cites the TTES authority by
    filename (`_Bible_` has no word boundary). Asserted by the sibling guard —
    see `TTES-GATE-000`, mutation 2 there.
  - Tests: `tests/architecture/ttes-governance-dashboard.test.mjs` → **7/7**.
    Mutation proof — 6 mutations, 6 caught, each restored and re-run 7/7 green:
    1. **The one this item exists for.** One arbitrary-spacing utility added to
       real product source (`<span className="p-[7px]">` in
       `apps/web/src/app/(app)/inbox/page.tsx`) → `not ok 1` (staleness: `275 |
       66` against `276 | 67`) AND `not ok 7` with
       `arbitrary-spacing-type: 276 occurrences against a budget of 275`.
       Restored → 7/7. Two independent detections of one added line.
    2. The other direction: `easing-keyword` budget raised 9 → 12, simulating
       debt paid down with the budget left where it was → `not ok 7`, "Debt was
       paid down and the budget was not lowered with it", naming
       `easing-keyword: 9 occurrences against a budget of 12 — lower it to 9`.
    3. The occurrence counter disarmed (`const hits = null`, the
       guard-that-cannot-fail shape) → `not ok 1` and `not ok 7`. A detector that
       counts nothing publishes a clean product.
    4. The exception reader made to return an empty table (`if (true) return out`)
       → `not ok 4` with `Only 0 exceptions parsed; the config's table has been
       reformatted.` The floor, not the finding, is what catches this.
    5. An expiry moved into the past in the REAL `apps/web/eslint.config.mjs`
       (`2027-08-06` → `2026-01-15`) → `not ok 5`, "A design-token exception has
       expired", plus `not ok 1` and `not ok 2` because the date is in the
       committed document. Restored; `git diff --name-only apps/web/eslint.config.mjs`
       empty.
    6. The adoption importer matcher blinded (`return []`) → `not ok 4` with
       `Card reports 0 importers; the import matcher has stopped matching.`
  - Commands: `node tools/ttes-governance-dashboard.mjs` (writes),
    `node tools/ttes-governance-dashboard.mjs --check` (exit 0),
    `node --test tests/architecture/ttes-governance-dashboard.test.mjs` → 7/7 in
    ~3s. No build, no browser, no database.
  - Honest limits, all in §6 of the document itself: an import is not a render;
    the budget is a ratchet on a total and not a verdict on any one line; design
    quality — rhythm, hierarchy, tone — is a judgement and nothing here measures
    it; and the console's debt is out of scope because it is a separate
    experience. Also stated because it will red somebody's build: any change to
    the tenant product's debt counts reds the staleness check until the document
    is regenerated, exactly as `ownership.md` and `entry-points.md` already do.
    That is the ratchet working.

- [ ] **TTES-050-005** — Block “best” claims until measured release gates pass.
  - Status: FAIL
  - Overturned on review: The seven claimed mutations all reproduce (I ran each: hard tier at the producer -> 'apps/web/src/app/signin/page.tsx:79 [hard] world-class'; soft tier in the interpolated footer -> ':207 [soft] Better than'; claimsIn blinded -> not ok 1; gateState accepting BLOCKED_EXTERNAL -> not ok 3 'TTES-050-002 is BLOCKED_EXTERNAL and the gate disagrees about whether it blocks'; line-comment handling removed -> not ok 2 + not ok 5 (packages/authorization/src/role-templates.ts:59); block-comment handling removed -> not ok 2 + not ok 5; shippedFiles -> [] -> not ok 4 and not ok 5). But my own producer mutation SURVIVED: I added `The best student operations platform in higher education.` to the sign-in page's subtitle - shipped tenant copy, on the one page every user sees, with the gate CLOSED (TTES-050-001=FAIL, TTES-050-002=BLOCKED_EXTERNAL) - and the suite stayed 5/5 with `node tools/superiority-claims.mjs` reporting nothing. Confirmed at the unit level: claimsIn returns [] for 'The best student operations platform.', 'We are the best.', 'Simply the best software for clubs.' and 'The fastest way to close your books.', and non-empty only for 'Tenure is the best.' The soft tier fires only when CLAIM_SUBJECT (Tenure|Relay|this platform|our product) appears in the SAME copy string, and marketing copy on a product's own surface almost never names the product - so the requirement's own word, 'best', is unblocked in its most common form. That is a partial closure of 'Block "best" claims until measured release gates pass', not a full one, and it is not disclosed: the ledger's 'Honest limits' bullet lists database copy, screenshots and CI-vs-editor and omits this. The gap is cheaply closeable (a ranking shape such as /\bthe best\b/ or 'simply the best' belongs in HARD_CLAIMS next to the existing /\bthe #\s?1\b/, and BENIGN already strips best match/available/fit/guess/effort/practice), which is why it reads as an untested hole rather than an intrinsic limit. Everything else about the item is sound - it is reached (tests/architecture/no-unmeasured-superiority-claims.test.mjs via run-platform-tests, plus section 5 of the governance dashboard), it is real, and its floors report an empty read as a failure rather than as a clean product.
  - Code: `tools/superiority-claims.mjs` — `PUBLISHED_SURFACES`, `HARD_CLAIMS`,
    `SOFT_CLAIMS`, `CLAIM_SUBJECT`, `claimsIn`, `copyStringsIn`,
    `copyStringsInProse`, `shippedFiles`, `claimsFound`,
    `MEASUREMENT_REQUIREMENTS`, `gateState`, plus a CLI that prints the findings
    and the gate's state and writes nothing.
  - Caller: `tests/architecture/no-unmeasured-superiority-claims.test.mjs`
    (5 subtests), discovered by `tools/run-platform-tests.mjs` and run in CI at
    `.github/workflows/ci.yml:88`; and `tools/ttes-governance-dashboard.mjs`,
    which renders the gate and the claim count as §5 of
    `docs/architecture/ttes-governance-dashboard.md` — so the rule is published on
    the governance dashboard rather than living only inside a test.
  - **Nothing looked before this.** `grep -rn` for the marketing vocabulary
    across `apps/web/src` returns an identifier (`let best = -1` in a scoring
    loop), an engineering qualifier ("generation is best-effort") and real user
    advice ("best practice is to cc the club advisor") — and not one superiority
    claim. That is why a grep was never going to be the check, and why nobody had
    written one: a findings list that has to be triaged is how the one real
    finding gets ignored.
  - **A gate, not a ban, and the condition is read rather than written.**
    `gateState` takes the ledger's own statuses for `MEASUREMENT_REQUIREMENTS` —
    `TTES-050-001` (measured per-persona baselines, §18) and `TTES-050-002` (a
    lawful competitor comparison, §18) — and lifts the block only when every one
    is PASS. `BLOCKED_EXTERNAL` is not a pass. Today the gate is CLOSED, blocked
    by those two, so the honest number of superiority claims Tenure may ship is
    zero — and the day both are recorded PASS this stops objecting on its own,
    the same shape `tests/architecture/no-overstated-connectors.test.mjs` uses
    where the catalog's lifecycle decides.
  - **Two tiers, because "best" has an innocent reading and "best-in-class" does
    not.** HARD phrases (`best-in-class`, `world-class`, `industry-leading`,
    `state-of-the-art`, `most advanced`, `the #1`, …) have no non-claim reading in
    shipped copy. SOFT phrases (`best`, `modern`, `faster than`, `superior`,
    `powerful`, …) are claims only when the same copy string also names the
    subject — Tenure, Relay, "this platform" — so "the fastest refresh window on
    a surface is the smallest one declared" is a fact about a cadence and
    "Tenure is faster than the tools you use today" is the thing §22 forbids.
    Benign spans (`best-effort`, `best practice`, `at best`, `best match`,
    `modern browser`) are removed before either tier is matched, each with the
    real occurrence that justifies it.
  - **A false positive it produced on its first run, recorded rather than quietly
    fixed:** `README.md:14` reads "Simon OSE (tenant #1)", meaning the first
    tenant. A bare `#1` is an ordinal at least as often as a boast, so the claim
    shape is now the ranking one — `the #1`, or `#1 in/for` — and a bare `#1` is
    left alone.
  - **Comments are stripped, which is the OPPOSITE of what
    `no-overstated-connectors.test.mjs` does, deliberately.** That check exists
    because a doc comment asserting a caller that does not exist misleads the next
    engineer. This one is about what a USER is told: "the fastest way to leak a
    provider's token" in a route comment is engineering prose and is a claim to
    nobody. Measured: with line-comment handling removed, the tree scan reports a
    finding out of `packages/authorization/src/role-templates.ts:59` that no user
    will ever see.
  - **A defect in this item's own reader, found by mutation and fixed.** The
    copy reader first matched JSX text against a SHORTENED copy of the source
    (comments and literals removed rather than blanked), so a claim planted on
    line 79 of the real sign-in page was reported on **line 46**. A finding with
    the wrong line is a finding the next reader cannot confirm. The mask is now
    length-preserving (`new Array(n).fill(" ")`, newlines kept) and the guard pins
    the line number of both a string literal and a JSX text run.
  - **A second defect, same run: interpolated copy was invisible.** A
    `>`-to-`<` reader sees nothing in `© {new Date().getFullYear()} Tenure. Better
    than …` — the run begins after an interpolation — and interpolated copy is the
    normal case in this product. Text runs are now delimited by `>` or `}` on the
    left and `<` or `{` on the right. It over-reads in one direction on purpose
    (a run between two adjacent code blocks is collected too), which costs
    nothing: `world-class` is not an identifier, and a soft claim needs the
    product named in the same run.
  - Current state of the product, measured rather than asserted: **0 claims**
    across 437 shipped files and 33,992 copy strings (both counts rise as other
    domains add files — the claim count is the number that matters and the guard's
    floor is 5,000 strings, so the assertion does not depend on either figure) —
    `apps/web/src` (the tenant
    product), `packages`, `modules` and `README.md`, each in
    `PUBLISHED_SURFACES` with the reason it is in scope. The Bibles and the
    ledgers are deliberately NOT scanned: the one governing this requirement uses
    "world-class" itself while telling you not to ship it, and a checker that
    failed on its own authority document would be switched off within a week.
  - Tests: `tests/architecture/no-unmeasured-superiority-claims.test.mjs` →
    **5/5** in 0.6s. Mutation proof — 7 mutations, 7 caught, each restored and
    re-run 5/5 green:
    1. HARD tier at the PRODUCER: `<h1 …>Tenure</h1>` in
       `apps/web/src/app/signin/page.tsx` changed to `Tenure — the world-class
       student operations platform` → `not ok 5` naming
       `apps/web/src/app/signin/page.tsx:79 [hard] world-class`.
    2. SOFT tier at the PRODUCER: the same file's footer changed to `© {…} Tenure.
       Better than the software your office runs today.` → `not ok 5` naming
       `apps/web/src/app/signin/page.tsx:207 [soft] Better than`. This is the
       mutation that was NOT caught before the interpolation fix above, which is
       why both tiers are proven on the real tree and not only on literals.
    3. `claimsIn` blinded (`if (true) return found`) → `not ok 1`, the
       detector-exercise case. The tree scan alone would have stayed green.
    4. `gateState` taught to treat `BLOCKED_EXTERNAL` as a pass → `not ok 3`, "a
       blocked measurement was treated as a measurement".
    5. Line-comment handling removed → `not ok 2` ("a line comment's quoted
       superlative was read as copy") and `not ok 5`.
    6. Block-comment handling removed → `not ok 2` (the block-comment half) and
       `not ok 5`. Both halves are pinned separately because only one of them was
       broken at a time.
    7. `shippedFiles` returning `[]` → `not ok 4` (`Only 0 shipped files were
       read; the surface list has collapsed`) and `not ok 5` (`Only 0 copy strings
       … the reader has gone quiet`). Every finding here is an absence, so the
       floors are what stop an empty read reporting a clean product.
  - Commands: `node tools/superiority-claims.mjs` → "Read 33992 copy strings
    across 437 shipped files. Gate CLOSED by TTES-050-001=FAIL,
    TTES-050-002=BLOCKED_EXTERNAL.", exit 0.
    `node --test tests/architecture/no-unmeasured-superiority-claims.test.mjs` →
    5/5. No build, no browser, no database.
  - Honest limits: copy that arrives from the database is not in the repository
    and is not checked — this reads the copy anyone can review; a claim written
    in an image or a screenshot is invisible to it, which §22's "from screenshots
    alone" wording is itself about; and the enforcement point is CI rather than
    the editor. An ESLint rule would object as somebody types, and it was left
    out on purpose this pass: the lint suite takes ~290s to run, and the same
    boundary in `npm run test:platform` costs 0.6s.

- [x] **TTES-GATE-000** — Tenant experience has a distinct documented architecture.
  - Status: PASS
  - Children: 4 of 4 decided — `TTES-000-001` PASS (routes, components and tokens
    inventoried across both experiences), `TTES-000-002` PASS (separate shells,
    leakage prevented by 8 guards), `TTES-000-003` PASS (every `TTES-*` id
    imported, with a check over the import), `TTES-000-004` PASS (the current
    product audited across personas, themes, viewports and static
    accessibility). A gate is proven by its children; the ratchet below is what
    stops the gate's own named property — *distinct* and *documented* — decaying
    afterwards, which is the same shape `TTES-GATE-010` takes.
  - Code: `tools/tenant-experience-architecture.mjs` — `render`,
    `tenantLayouts`, `tokenTiers`, `controlPlaneRoutes`, `NAVIGATION_AUTHORITY`,
    and a `--check` mode. Output, committed:
    `docs/architecture/tenant-experience-architecture.md`.
  - Caller: `tests/architecture/tenant-experience-architecture.test.mjs`
    (6 subtests), discovered by `tools/run-platform-tests.mjs` and run in CI at
    `.github/workflows/ci.yml:88`, plus the generator's own `--check` branch.
  - **The gap was findable in one `ls`, and nothing had looked.** The OPERATOR
    experience has a documented architecture —
    `docs/architecture/studio-information-architecture.md` and
    `docs/architecture/studio-design-system.md`. The tenant experience, the one
    this authority governs and the one a student and a director actually sign
    into, had neither. What it had was three generated inventories that each
    answer a narrower question: `entry-points.md` (what is exposed),
    `ownership.md` (which domain owns a file), `ttes-experience-audit.md` (what
    the current product measures). None of them says what the experience IS, and
    "distinct documented architecture" is a claim about a document.
  - **Derived, not written, and that is the opposite choice from the console's.**
    The console's document is a hand-written normative spec, which is right for a
    thing being built. This one describes a product that exists, and a
    hand-written description of an existing product has exactly one failure
    mode — "was right once" — which reads identically to "is right". So §1 comes
    from `EXPERIENCES`, §3's route map from `collect()` (40 pages, 26 API routes,
    65 server actions with the guards each names), §5's token tiers from the
    generated catalog `apps/web/src/lib/a11y/tokens.ts` (155 primitive, 42
    semantic, 29 component), §6's ownership from `classify()` restricted to files
    the map places in the tenant experience, and §2's shell from the directories
    themselves (3 layouts, 10 shell modules).
  - **One thing is deliberately NOT re-derived: the navigation catalog.** Three
    readers of `modules/index.ts` already exist under `tests/architecture/`, and a
    fourth parser of one file is the defect this repository has already paid for
    once — "which is what having two parsers costs", as `tools/document-graph.mjs`
    puts it about the graph and `next-batch.mjs`. §4 therefore CITES the catalog
    and the two guards that constrain it, by file and by identifier, and the
    guard greps each file for each identifier so the citation cannot rot into a
    pointer at a decision that has moved.
  - **Distinctness is asserted, not asserted about.** The control-plane prefixes
    a tenant route may never sit under are derived from the `control-plane` domain
    of `tools/ownership-map.mjs` — which is how `apps/web/src/app/api/platform/`,
    an operator surface served by the customer application, is covered without
    anybody listing it — and the guard fails if any route in the tenant map falls
    under one.
  - **A real defect found by the new guard, in this family's own record.** "The
    tenant experience's own record cites files that exist" reads the `Code:` and
    `Tests:` bullets of every row in this ledger and resolves each path. On its
    first run it reported three, all from `TTES-030-002`, which is PASS: its
    `Code:` line named `(app)/admin/audit/loading.tsx`,
    `(app)/resources/loading.tsx` and `(app)/orgs/loading.tsx`, all three deleted
    in `a8ceb8b` because a `loading.tsx` on those subtrees aborts the App Router's
    RSC fetch mid-flight and cost the Playwright suite 12 failures. Nothing had
    ever checked that a row's cited code exists. Corrected in place above, with
    the reason the PASS still stands and the adoption consequence (`Skeleton` now
    has no product caller) recorded rather than dropped.
  - That check is scoped to the `Code:`/`Tests:` bullets on purpose, and the
    scoping is measured rather than argued: over the whole file it reports seven
    paths, of which four are *supposed* to be absent — two mutations created and
    removed (`packages/platform-config/src/ShellChrome.tsx`,
    `packages/mutant-surface/src/app/page.tsx`) and two blockers' own `ls … #
    absent` claims. Scoped to the evidence bullets, and skipping any path this
    ledger claims absent so the two guards cannot contradict each other, it
    reports three of three real. A findings list that has to be triaged is how a
    real finding gets ignored.
  - Kept out of the document graph on purpose, and this was caught before it
    shipped: `tools/document-graph.mjs` classifies any `.md` whose first 4,000
    characters contain a bare authority word as an authority document, and the
    first render said "Bible §1" in §1 and WAS so classified — which would have
    moved the registry's denominators because somebody wrote a paragraph. §1 now
    cites the authority by filename (`_Bible_` has no word boundary, `_` being a
    word character), and the guard asserts both this document and the governance
    dashboard stay out of `classify()`.
  - Tests: `tests/architecture/tenant-experience-architecture.test.mjs` →
    **6/6** in ~2s. Mutation proof — 6 mutations, 6 caught, each restored and
    re-run 6/6 green:
    1. The committed document edited by hand ("10 shell modules" → "11") →
       `not ok 1`, `docs/architecture/tenant-experience-architecture.md is stale`.
    2. The authority word put back inside the first 4,000 characters
       ("TTES-GATE-000. Generated by" → "TTES-GATE-000, a Bible for the tenant
       experience. Generated by") → `not ok 2`, "is being classified as a platform
       authority document". This is the trap the first render fell into.
    3. **The distinctness mutation, at the producer:**
       `apps/web/src/app/api/platform/fleet-cost/page.tsx` created — a
       control-plane surface under the tenant app root → `not ok 4`, "A
       control-plane route appears in the tenant route map: prefixes
       /api/platform". Removed → 6/6.
    4. `MAX_ENTRIES_PER_SECTION` renamed in `NAVIGATION_AUTHORITY` → `not ok 5`,
       "tests/architecture/nav-hrefs-are-served.test.mjs no longer declares
       MAX_ENTRIES_PER_SECTION_V2". The citation is checked, which is the only
       thing that makes citing better than copying.
    5. `tokenTiers` frozen to `[["primitive", 1]]` → `not ok 1` and the tier
       floor in `not ok 3`.
    6. The ledger path reader blinded (`return []`) → `not ok 6`, `Only 0 path
       claims parsed out of the ledger; the reader has gone quiet.` The floor,
       not the finding.
  - Commands: `node tools/tenant-experience-architecture.mjs` (writes),
    `node tools/tenant-experience-architecture.mjs --check` (exit 0),
    `node --test tests/architecture/tenant-experience-architecture.test.mjs` →
    6/6. No build, no browser, no database.
  - What this gate does NOT now claim, stated because a gate is the easiest place
    to over-read: the document is DESCRIPTIVE, not normative — it says what the
    tenant experience is, and the requirements that change it are the rows in this
    file. Nothing in it is rendered; the rendered half of the experience is
    `TTES-040-*` work and is listed as NOT ESTABLISHED in §7 of the document and
    in §7 of `docs/architecture/ttes-experience-audit.md`.

- [x] **TTES-GATE-010** — Visual foundations are original, consistent and accessible.
  - Status: PASS
  - Children: 5 of 5 decided — `TTES-010-001` (token pipeline + type generation),
    `TTES-010-002` (themes, contrast and gamut), `TTES-010-003` (typography, spacing,
    density, shape, elevation, motion, z-layer), `TTES-010-004` (safe tenant-brand
    overrides), `TTES-010-005` (no raw style values outside the exception table). Every
    one PASS, each carrying its own evidence. A gate is proven by its children; the
    ratchet below is what stops the accessibility leg of it decaying afterwards.
  - Originality and consistency already had a real boundary (`apps/web/eslint.config.mjs`,
    driven by the real ESLint binary in `apps/web/scripts/design-token-lint.test.mjs`).
    Accessibility did not: `contrast.test.ts`'s `PAIRINGS` was a literal array a human
    maintained, and its own header called it "not a convenient subset, which would be
    theatre" while nothing enforced that. `--text-3` was the standing proof — declared,
    bound to `text-text-3`, used 294 times, in no pairing.
  - **THE RATCHET**, three assertions, each derived from a real file:
    - Every foreground the stylesheet declares appears as `fg` in at least one row.
      Foregrounds are matched by an ANCHORED pattern, not a prefix: the survey's
      `/^--(…|primary|…)/` would have demanded a pairing for `--primary-light`, which is
      a background. Unpaired tokens are listed BY NAME in the failure.
    - Every exemption is still true. Two exist: `--text-disabled` (WCAG 1.4.3 exempts
      text in an inactive component — holding it to 4.5:1 would make a disabled control
      indistinguishable from an active one) and `--text-inverse` (declared but rendered
      nowhere). The second is VERIFIED, not asserted: the test walks every `.ts/.tsx/.css`
      outside `src/lib/a11y`, strips declaration lines, and fails if anything names the
      token — so the exemption converts into a required pairing the moment somebody uses
      it. An exemption nobody re-verifies is how a subset calls itself complete.
    - Every token bound to a colour utility in `tailwind.config.ts` resolves in all four
      themes.
  - It bit on its first run, which is the evidence it is not decorative: it named
    `--accent`, declared and rendered as text at `admin/clubs/page.tsx:105` and in no
    row. That row is now in `PAIRINGS`.
  - This is also what keeps TTES-010-002's palette fix from decaying: adding a token, or
    a new foreground, is no longer invisible to the gate.
  - Tests: `apps/web/src/lib/a11y/contrast.test.ts`, describe block
    "TTES-GATE-010 — the pairing list is complete, not convenient".
  - Mutations run:
    - Deleted the `--text-2 on --bg-subtle` row → 26 passed, correctly: `--text-2` still
      has two other rows and the ratchet asserts "at least one". The survey's suggested
      mutation does not bite and is recorded here as not biting. Deleting ALL THREE
      `--text-2` rows → "every foreground the stylesheet declares appears in a pairing"
      failed with `["--text-2"]`; restored → 26 passed.
    - Deleted `--border-strong` from the base `:root` → "every token a colour utility is
      bound to resolves in all four themes" failed with `light: --border-strong`;
      restored → 58 passed. Deleting it from `html.dark` instead does NOT fail, and
      correctly so — the cascade falls back to `:root`, so the survey's suggested
      mutation there would have proven nothing.
  - Commands: `npx jest src/lib/a11y/contrast.test.ts`.
  - **HARDENING (2026-08-07) — the ratchet had the same hole it was built to close.**
    `FOREGROUND_TOKEN` matched the two ramps by their SHIPPING INDEX RANGE,
    `text-[123]` and `chart-[1-8]`. That put the ratchet's blind spot inside the very
    pattern whose job is to find blind spots: a fourth rung of the ink scale is a
    foreground by construction, and nothing in the ramp is closed-ended. Verified as a
    live hole, not a theoretical one — adding `--text-4: var(--tenure-slate-350)`
    (`#9ca3af`, 2.6:1 on the light card, a real AA failure) to `:root` left
    `contrast.test.ts` **26/26 green** with the token declared and in no pairing, which
    is verbatim the sentence this gate exists to make false. Both ranges widened to
    `\d+`. No token changes hands today — there is no `--text-4` or `--chart-9` — so the
    fix is a no-op against the current stylesheet and a ratchet against the next one.
    - Discriminating mutations, each run against BOTH patterns, which is what shows the
      widening is load-bearing rather than cosmetic:
      1. `--text-4` declared in `:root` → OLD pattern **26/26 passed** (the hole);
         NEW pattern reds with `["--text-4"]`. Removed → 26 passed.
      2. `--chart-9` declared in `:root` → OLD pattern **26/26 passed** (the hole);
         NEW pattern reds with `["--chart-9"]`. Removed → 26 passed.
    - `globals.css` and `tokens.ts` were restored to byte-identical (`git diff --stat`
      empty) after each; the only surviving change is the pattern and its comment.

- **RE-VERIFICATION (2026-08-07)** of `TTES-010-001`, `TTES-010-002`, `TTES-010-004`
  and `TTES-GATE-010`, re-surveyed as open and found already built. Every clause was
  re-checked against the real files and every test independently mutation-proven rather
  than trusted, since a green suite is the thing all four of these items are about:
  - `TTES-010-004` — 4 mutations, 4 caught: the surface floor in `assessBrand` set to
    `0` → "rejects a low-contrast accent" and "whatever it accepts, clears both floors"
    red; `[data-focus-visible]` returned to `var(--primary)` → the globals scan reds
    naming `[data-focus-visible] { … --primary }`; `layout.tsx` unwired to
    `brandingCss(brandingFor(...))` → "is what the production path emits into the
    document" reds; `<BrandPreview>` unmounted from `settings/page.tsx` → "the preview
    is mounted where a user can reach it" reds. All restored → 19/19.
  - `TTES-010-001` — 3 mutations, 3 caught: `--text-1` renamed in all four blocks →
    the staleness case reds first, and after `node scripts/generate-design-tokens.mjs`
    the tailwind-reconciliation case reds naming `--text-1`; `--primary` given the
    literal `#198052` → both layering cases red naming it, **while the contrast suite
    stayed green** — which is the re-layering safety proof, identical resolved colour;
    `--chart-8` deleted from the catalog → `tsc` fails at
    `src/components/charts/palette.ts(46,10)`, the rendering call site, confirming the
    compile-time coupling is real and not decorative. All restored → 13/13.
  - `TTES-010-002` — 2 mutations, 2 caught: light `--text-3` reverted to `#868b92` →
    the light theme reds with exactly the three surveyed ratios, `3.29 / 2.98 / 2.84`
    against the 4.5:1 floor; `--probe: color(display-p3 1 0 0)` added to `:root` → the
    gamut check reds in all four themes naming `--probe`. Both restored → 26/26.
  - `TTES-GATE-010` — the pre-existing mutations re-run and confirmed, plus the two new
    ramp mutations above that found and closed a genuine hole.
  - Commands: `npx jest src/lib/a11y src/components/charts scripts/design-token-lint`
    → 8 suites, **111 passed**. `npm run type-check` → no error in this area; the only
    errors in the tree are `packages/provisioning/src/index.ts` (`ExecutionEnvelope`,
    `ManifestSignature`, `SecretRefResolution`, `SigningKey`, `StepExecution`,
    `./change-class`), an uncommitted mid-edit by a concurrent run — that file is `M`
    in `git status` and is not in this item's file set.

- [ ] **TTES-GATE-020** — Domain teams build from stable Tenure-owned patterns.
  - Status: FAIL
  - Why not PASS: a gate is proven by its children, and ONE of the four
    TTES-020 requirements is still unbuilt — 004 (state / theme / density /
    locale / viewport stories and visual baselines) is FAIL in this file.
    001, 002 and 003 are all PASS. The vendor-primitive boundary this gate's own
    description asks for — "ESLint/codemods preventing raw colors, spacing,
    z-index, vendor components and ad hoc modal/toast patterns" (§16) and
    "Domain apps cannot import raw third-party components" (§7) — is the part
    that landed, and it landed in full; it is recorded below so the next agent
    does not rebuild it.
  - CORRECTION (2026-08-07): the paragraph above previously read "three of the
    four … are unbuilt — 001, 002 and 004". That went stale the moment 001 and
    002 were decided, exactly as the note it replaced predicted a hand-written
    ratio would. It is restated rather than deleted so the next reader knows the
    gate's blocker narrowed rather than that someone quietly relaxed it. The
    single remaining blocker is TTES-020-004; nothing in this gate's own file
    area (`eslint.config.mjs`, the wrapper layer, the six migrated call sites)
    can advance it, because 004 is a visual-baseline/story requirement.
  - Landed under this item, and complete: the vendor-component half of §16.
    Everything from here down is the evidence for that half only.
  - Code: `apps/web/eslint.config.mjs` — `OWNED_WRAPPERS`,
    `VENDOR_COMPONENT_MESSAGE`, `VENDOR_COMPONENT_PATHS`,
    `VENDOR_COMPONENT_PATTERNS`, `RESTRICTED_VENDOR_IMPORTS`,
    `RESTRICTED_ICON_IMPORTS` and the `tenure/design-tokens-owned-wrappers`
    block in `designTokenConfigs`; the wrappers and call sites listed under
    TTES-020-003.
  - What changed: Bible §7 ends "Domain apps cannot import raw third-party
    components" and §16 asks for a rule preventing vendor components. What
    existed banned vendor ICON packages and nothing else, and the drift it was
    written to stop had already happened: `CalendarSubscribe.tsx` and
    `ClubImageEditor.tsx` both imported `Button as AriaButton` from
    `react-aria-components` and hand-wrote the secondary-button class string
    `ui/Button.tsx` already owns — and the two copies had already diverged
    (`h-10` vs `h-9`, `border-border-strong` with no `data-[pressed]` state).
    Both now render `<Button variant="secondary" size="md">`; the four shell
    modules render the owned Menu / Tooltip / PopoverDialog. The rule is
    `error` for `src/app/**` and `src/components/**`, carved out structurally
    (no expiry, nothing to clean up) for `src/components/ui/**`.
  - Tests: `apps/web/scripts/design-token-lint.test.mjs` drives the real ESLint
    CLI over the real config: the same react-aria import linted as
    `src/components/CalendarSubscribe.tsx` and `src/components/shell/ShellHeader.tsx`
    reports the vendor message, as `src/components/ui/Menu.tsx` reports
    nothing, and `lucide-react` inside `src/components/ui/Menu.tsx` still
    reports — the carve-out is for vendor components only. A second case walks
    the real `src/` tree (166 shipping modules at the time of writing) and
    asserts none of them names a vendor primitive, so the rule cannot pass with
    grandfathered violations. The walk asserts its own count is over 100 first,
    because an empty list would make the real assertion vacuously true.
  - Mutation: deleted the `react-aria-components` entry from
    `VENDOR_COMPONENT_PATHS` → the new lint case failed; restored → passes.
  - Mutation: re-added `import { Button as AriaButton } from "react-aria-components"`
    to `ClubImageEditor.tsx` → `npx eslint src/components/ClubImageEditor.tsx`
    reported `1 error … no-restricted-imports` and the tree-walk case failed
    with `["src/components/ClubImageEditor.tsx"]`; restored → both clean.
  - Mutation: changed `CalendarSubscribe`'s trigger from `variant="secondary"`
    to `variant="ghost"` → `owned-wrappers.test.tsx` failed on the missing
    `data-[hovered]:border-[--text-3]`; restored → passes. The assertion reads
    the class string the production component emits, not `Button()`'s return.
  - Mutation: replaced `MenuPopover`'s `POPOVER_CLASS` with `"outline-none"` →
    the TenantSwitcher menu case failed with
    `received "outline-none min-w-64"`, which also shows the split: panel
    chrome from the wrapper, width from the caller. Restored → passes.
  - RE-VERIFIED 2026-08-07 by a later agent that was re-issued this item as
    still-open work. It is not: the survey's "open because" claims were each
    checked against the tree and each is now false —
    `CalendarSubscribe.tsx:31` renders `<Button variant="secondary" size="md">`,
    `ClubImageEditor.tsx:29-33` the same, `src/components/ui/Menu.tsx` and
    `src/components/ui/Tooltip.tsx` both exist, the four shell modules import
    from them (`ShellHeader.tsx:5`, `TenantSwitcher.tsx:5`, `SideNav.tsx:6`,
    `NotificationBell.tsx:7`), and `eslint.config.mjs:301-322` carries
    `VENDOR_COMPONENT_PATHS` / `VENDOR_COMPONENT_PATTERNS` /
    `RESTRICTED_VENDOR_IMPORTS`. Nothing was rebuilt. What was added is
    independent proof that the boundary still bites:
    - `npx jest scripts/design-token-lint.test.mjs` → 9 passed (291 s).
    - `npx jest src/components/ui/owned-wrappers.test.tsx` → 5 passed.
    - Mutation A: deleted the `react-aria-components` entry from
      `VENDOR_COMPONENT_PATHS` → "refuses a vendor component library outside the
      owned wrapper layer" failed with `Expected substring: "Vendor component
      library in a product module" / Received string: ""`; restored → passes.
    - Mutation B: re-added `import { Button as AriaButton } from
      "react-aria-components"` to `ClubImageEditor.tsx` → `npx next lint --file
      src/components/ClubImageEditor.tsx` exited 1 reporting
      `'react-aria-components' import is restricted … no-restricted-imports`,
      AND the tree-walk case failed with `["src/components/ClubImageEditor.tsx"]`;
      restored → both clean.
    - Mutation C (at the PRODUCER, not the helper): reverted
      `CalendarSubscribe`'s trigger to the hand-rolled
      `h-10 … border-border-strong … hover:bg-base` string this gate exists to
      stop → `owned-wrappers.test.tsx` failed with `Received string:
      "inline-flex h-10 … border-border-strong …"` against the expected
      `data-[pressed]:bg-[--bg-subtle]`; restored → passes.
    - Mutation D: changed `ui/Tooltip.tsx`'s owned `placement` default from
      `"right"` to `"top"` → the collapsed-side-nav case reds. Worth recording
      precisely because it did NOT red where expected: it failed earlier, at
      `expect(tip).not.toBeNull()`, rather than on the `data-placement`
      assertion. Restored → passes.
  - Coverage check done at the same time, so "vendor components are banned" is
    not read wider than it is true: the only UI-component vendors in
    `apps/web/package.json` are `react-aria-components`,
    `class-variance-authority`, `lucide-react` and `@phosphor-icons/react`, and
    all four are in the restricted list. The remaining deps (`jszip`,
    `mammoth`, `xlsx`, `zod`, the AWS SDKs) are not component libraries. So
    there is no fifth vendor silently outside the boundary today — but the list
    is hand-maintained, and adding a component dependency will not red anything
    until someone adds it here too.

- [ ] **TTES-GATE-030** — Users complete work without module/navigation clutter.
  - Status: FAIL
  - Children: 2 of 5 decided — `TTES-030-001` FAIL, `TTES-030-002` PASS,
    `TTES-030-003` PASS, `TTES-030-004` FAIL, `TTES-030-005` BLOCKED_EXTERNAL.
    A gate is proven by its children and by nothing else, so nothing written in
    this row can make it PASS.
  - **The PASS is withdrawn, and this is the record of it.** A run set this row
    to `- [x]` / PASS with no `Children:` line while three of its five children
    were undecided. `git show
    HEAD:docs/implementation/tenant-experience-execution-ledger.md` still has it
    as `- [ ]` / FAIL, so the PASS existed only in an uncommitted working tree,
    and the run that wrote it was killed before anybody reviewed it. The batch
    note under TTES-GATE-040 saw the same thing from the other side and recorded
    it as two failures of `tests/architecture/pass-requires-evidence.test.mjs`
    it deliberately would not fix in another agent's row — "a gate is PASS while
    requirements it gates are not", and "PASS cites nothing checkable", both
    naming this id. The verification below is real work and is kept in full; what
    it proves is the two children already counted above, and two of five is not a
    gate.
  - **Verified, not newly written.** The two halves this gate needs
    already shipped in `db95980` and the ledger had never been updated to say so;
    the queue was still carrying it as "not yet implemented". Nothing was written
    for it in this pass. What this pass did is the part that had never been done:
    prove both halves fail when the behaviour they claim is removed. An
    unexercised assertion and a missing one are worth the same, and until a
    mutation had been run against these two nobody could tell which they were.
  - The scoping half is `apps/web/e2e/shell.spec.ts:279`, "the side nav offers
    privileged entries to the director and not to a member". It reads the
    RENDERED nav — what `(app)/layout.tsx:66` emits after
    `navigationCapabilitiesFor` has filtered `navigationForSystem` — for two
    seeded personas against one database in one case: Dana Whitfield (OSE_DIRECTOR)
    must see `Admin Console` and `Reports`; Maya Johnson (club seat, no
    institution membership) must see neither, while `Calendar` and `Messages`
    stay visible so that "correctly scoped" cannot be confused with "the nav
    failed to render".
  - The clutter half is `tests/architecture/nav-hrefs-are-served.test.mjs:177`
    and `:201`. The catalog vocabulary is closed to five sections
    (`SECTIONS`, `:116`) and no section may carry more than five entries
    (`MAX_ENTRIES_PER_SECTION`, `:119`). The shipped catalog measures 10 entries
    across Community 3 / Operations 2 / Knowledge 2 / Overview 2 /
    Administration 1, so a sixth section or a sixth entry has to be an argued
    change rather than one more line in a manifest.
  - Mutations run — the first two are the ones that matter, because they are
    mutations of the PRODUCER and the assertion is on what the production path
    emits, not on what a helper returns:
    - `navigationCapabilitiesFor` frozen to
      `return new Set(Object.values(NAV_CAPABILITIES))` (the survey's own
      mutation), rebuilt, spec re-run →
      `expect(getByRole('navigation', {name:'Primary navigation'})
      .getByRole('link', {name:'Admin Console'})).toHaveCount(0)` failed with
      `Expected: 0 / Received: 1` at the member half. Restored → 1 passed.
    - `(app)/layout.tsx` changed to `navigationForSystem(institution.slug, null)`
      — the layout-level hole the spec's own header claims to be proven against,
      and the one that leaves the whole unit suite green — rebuilt, spec re-run →
      the same member assertion failed `Expected: 0 / Received: 1`. Restored →
      2 passed. The header's claim is now a checked claim.
    - `resources.library`'s `section` changed to `"Insights"` →
      "every nav entry is placed in one of the five declared sections" reds;
      restored → 5 passed.
    - Every `Operations` and `Knowledge` entry moved into `Community` (7 in one
      section) → "no navigation section carries more than five entries" reds
      with the clutter-budget message; restored → 5 passed.
  - Run against a production build (`next start`, `NEXT_DIST_DIR=.next-nav030`)
    on its own Postgres, which is what CI does. A `next dev` server was tried
    first and is not usable for this: it drops the tenant-scope AsyncLocalStorage
    intermittently and renders the error boundary, so the nav is absent for a
    reason that has nothing to do with capabilities. Recorded because the next
    person will otherwise lose the same hour.
  - Limit worth stating: the budget is over `modules/index.ts`, the catalog that
    ships. `SideNav.tsx:211` also pins a `Settings` entry that no manifest
    contributes, and a tenant pack authored outside this repository answers for
    its own information architecture — `validateManifest` deliberately does not
    carry this rule.

- [ ] **TTES-GATE-040** — Experience is fast, secure, inclusive and low-fatigue.
  - Status: FAIL
  - Children: 2 of 5 decided — `TTES-040-001` PASS, `TTES-040-002` PASS,
    `TTES-040-003` FAIL, `TTES-040-004` FAIL, `TTES-040-005` FAIL. A gate is
    proven by its children and by nothing else, so this row cannot become PASS by
    anything done to this row. It is written out because "imported …; not yet
    implemented" read identically for a gate blocked on five separate slices and for one
    nobody had opened, and the difference is the whole of what a reader needs.
  - **Each child is now named with its status rather than summarised as `003`…`005`,
    because the ratio alone does not hold this row to the ledger.** A ratio is a count,
    and a count survives the one edit this repository actually makes to a decided
    requirement: a PASS being withdrawn. Two were withdrawn in a single session
    (`PACK-GATE-000`, `PACK-GATE-020`). If `TTES-040-003` lands and `TTES-040-001` is
    taken back, "2 of 5" still adds up, the ratio-truth assertion still passes, and both
    sentences a reader actually reads are wrong. The new case in
    `tests/architecture/pass-requires-evidence.test.mjs` — "an entry that states another
    requirement's status states the true one" — reads the five names above and the five
    below and holds every one of them to the child's own `Status:` line.
  - Reason, child by child — what is actually there, and what is missing:
    - `TTES-040-001` PASS — WCAG 2.2 AA: real coverage exists and is not a rollup.
      `apps/web/e2e/a11y.spec.ts` names nine criteria by number (2.4.1, 1.4.10, 2.5.8,
      2.4.11, 2.4.7, 2.1.2, 1.3.1, 1.4.4, 2.3.3) and `apps/web/src/lib/a11y/contrast.ts`
      proves 1.4.3 by arithmetic across all four themes. WCAG 2.2 AA is dozens of
      criteria and nobody has walked the list, and the requirement also says
      "assistive-technology", of which there is none — no screen reader has been run
      against this product. The fix belongs in `apps/web/e2e/a11y.spec.ts` plus a
      criterion-by-criterion table naming which are covered, which are not applicable
      and which are open.
    - `TTES-040-002` PASS — UI security/privacy/export/session/forbidden-state: **decided
      since this row was written, and this line said "nothing" for as long as it took
      somebody to re-read it.** The evidence is real — two console routes that answered
      a capability refusal with `notFound()` now render `StateSurface
      state="permission-denied"`, autosave latches a `session-expired` branch instead of
      re-firing into a signed-out session forever, and `csvCell` enforces the
      formula-injection rule — covered by `apps/web/e2e/admin-console.spec.ts` ("a
      capability refusal inside the console is refused, not hidden"). The grep this line
      cited (`session expir|step-up|forbidden state|redact` across `apps/web/e2e`) still
      returns nothing, which is why it read as unbuilt: the coverage is spelled
      `permission-denied`, and a gate row that greps for one vocabulary reports the
      absence of the vocabulary, not of the work.
    - `TTES-040-003` FAIL — performance budgets: no measurement of any kind. There is no
      route/bundle budget file, and `grep -rl "web-vitals\|reportWebVitals"
      apps/web/src` is empty, so the RUM half the requirement names does not exist
      either. This is the "fast" leg of the gate and it is the emptiest of the five.
      Re-checked on 2026-08-07 and still true; the file half of it is now re-checked by
      a machine on every CI run rather than by whoever next reads this paragraph, in the
      shape `tests/architecture/pass-requires-evidence.test.mjs` parses:

      ```
      ls tools/perf-budget.mjs   # absent on 2026-08-07
      ```

      The day somebody adds it, "an entry that says a file is absent is still right
      about it" reds naming `TTES-GATE-040`, and this paragraph has to be re-decided
      instead of quietly outliving its subject — which is exactly how the seed blocker
      on `TTES-050-001` survived being fixed.
    - `TTES-040-004` FAIL — localization/RTL/zoom/high-contrast/reduced-motion: partly real.
      `apps/web/e2e/localization.spec.ts` drives RTL through the real cookie and checks
      the frame moves, not only the text; `a11y.spec.ts` covers zoom (1.4.4) and
      reduced motion; `apps/web/src/lib/a11y/theme-tokens.ts` reads all four themes
      including high-contrast out of the real `globals.css`. Nothing has been rolled up
      against the requirement's own list, and no locale other than en-US/en-GB/ar-AE
      fixture is exercised.
    - `TTES-040-005` FAIL — long-session and frontline usability: nothing.
      `apps/web/e2e/support/journey-metrics.ts` (added for TTES-050-001) is the nearest
      thing — it can count what a task costs — but no long-session or frontline scenario
      uses it. Re-checked on 2026-08-07: eight journeys now call it and all eight are
      single-task paths (`J01`…`J08` in `apps/web/e2e/journeys.spec.ts`); none holds a
      session open, and "frontline" appears nowhere under `apps/web/e2e`.
  - Do not mark this PASS from a child's evidence.
    `tests/architecture/pass-requires-evidence.test.mjs` checks the ratio above against
    the five children's actual statuses and refuses PASS while any of them is undecided.
  - **That refusal was conditional on this row's good manners until now, and the
    condition was invisible.** The check derived a gate's children only when the gate
    stated a ratio — so deleting the `Children:` line was one edit that made a false
    PASS both unfalsifiable and unchecked, and the guard would have reported a clean
    ledger. Two gates were already through it, in another ledger, unnoticed:
    `PACK-GATE-000` was PASS over `PACK-000-001` (the inventory) and `PACK-000-003` (the
    requirement import), both FAIL; `PACK-GATE-020` was PASS while `PACK-020-001` — the
    archetype axes it is named for — was FAIL. Neither stated a ratio. Both PASSes are
    withdrawn in `docs/implementation/erp-pack-factory-execution-ledger.md`, and the
    check now derives children from the ids whether or not a ratio is written, refuses a
    PASS gate that states none, and reads the prose spelling `**N of M children
    decided**` as well as the keyed one — which caught four more stale ratios
    (`PACK-GATE-010` 2→1 of 4, `PACK-GATE-030` 3→2 of 5, `PACK-GATE-060` 0→1 of 4,
    `PACK-GATE-080` 0→3 of 5), every one of them a number a reader would have believed.
  - Tests: `tests/architecture/pass-requires-evidence.test.mjs` — 10 cases, up from 8:
    "a gate that states its child ratio states the true one", "a gate is not PASS while
    a child it gates is undecided", "a gate that talks about a child ratio states it
    where a checker can read it", and "an entry that says a file is absent is still
    right about it". 6 mutations, 6 caught, each restored and re-run green:
    1. this row's ratio edited to `3 of 5` → the truth case reds naming
       `TTES-GATE-040: says 3 of 5, ledger says 2 of 5`.
    2. `PACK-GATE-020` returned to `PASS`/`- [x]` with its `Children:` line renamed →
       the PASS case reds naming `PACK-020-001=FAIL`. **The discriminating half:** with
       the old `statedChildRatio(entry.body) && gateChildren(…)` derivation restored the
       same ledger reports `[]`, and with the new one it reports
       `["PACK-GATE-020: PACK-020-001"]`. That pair is the proof the widening is
       load-bearing rather than cosmetic.
    3. `PACK-GATE-010`'s ratio put back to the prose spelling `**2 of 4 children
       decided.**` → the truth case reds, proving the second spelling is parsed and not
       merely tolerated.
    4. `PACK-GATE-060` returned to "and 0 of 4 are complete" with no keyed line → the
       unreadable-ratio case reds naming it.
    5. `TTES-GATE-010`'s `Children:` line reworded to prose without a ratio → the PASS
       case reds with `TTES-GATE-010: PASS with 5 children and no stated ratio`, which
       is the branch that closes the delete-the-line escape.
    6. `docs/decisions/ADR-0009-competitive-benchmarking.md` created → the absence case
       reds naming `TTES-050-002`; removed → green.
  - **Re-verified and strengthened 2026-08-07** by a later batch handed this row as still
    open. The ratio was re-derived and is unchanged at 2 of 5, and every claim the row
    makes about its children was re-run rather than believed: `ls tools/perf-budget.mjs`
    → absent, `grep -rl "web-vitals\|reportWebVitals" apps/web/src` → empty (so
    `TTES-040-003` really is the emptiest leg), `grep -c "measureJourney" apps/web/e2e`
    → 8 single-task journeys and no long session (so `TTES-040-005` really is nothing).
    The row stays FAIL: a gate is proven by its children, three are undecided, and two of
    the three sit outside this batch's file set.
  - What the re-verification changed, because the row had a hole the ratio could not see.
    A ratio is a COUNT. The one edit this repository actually makes to a decided
    requirement is a PASS being withdrawn — it has done it twice in one session — and a
    withdrawal paired with a landing leaves the count untouched while both names go
    stale. `003` landing and `001` being taken back would still read "2 of 5", the
    ratio-truth assertion would still pass, and the two sentences a reader reads would
    both be wrong. So the `Children:` line now names all five with their statuses, each
    per-child paragraph repeats its own, and a new case holds every one of them to the
    child's `Status:` line.
  - Tests: `tests/architecture/pass-requires-evidence.test.mjs` — 11 cases, up from 10.
    New: **"an entry that states another requirement's status states the true one"**,
    over `statedChildStatuses()`, applied to every entry in every ledger (a stale status
    claim is not a gate-only failure) with a floor of 5 parsed claims so a parser that
    stopped matching could not report a clean repository. 4 further mutations, 4 caught,
    each restored and re-run green:
    7. this row's first child claim edited from PASS to FAIL → the new case reds naming
       `TTES-GATE-040`, the child, the claimed status and the ledger's. (The message is
       described rather than quoted: the canonical shape is a claim wherever it appears,
       including inside a quoted failure message, and pasting one here would make this
       paragraph assert it. That is a real constraint on evidence prose, found by pasting
       it.) **The discriminating half:** in the same run "a gate states its child ratio
       states the true one"
       stays GREEN, because 2 of 5 is still arithmetically true. That pair is the proof
       the new case is not the ratio check in disguise.
    8. the other direction — `TTES-040-004`'s own `Status:` changed `FAIL` →
       `BLOCKED_EXTERNAL`, which is still undecided so the ratio does not move and the
       checkbox still agrees → cases 4 and 6 stay green and the new case alone reds,
       naming that child, the status this row claims for it and the status its own entry
       now declares. Both sides of the comparison are therefore live. (De-quoted for the
       reason in 7.)
    9. `statedChildStatuses` blinded to `return out` → the new case reds on its floor
       (`Only 0 per-requirement status claims parsed`) rather than passing over an empty
       list, and the detector-exercise case reds too.
    10. `tools/perf-budget.mjs` created → "an entry that says a file is absent is still
       right about it" reds naming `TTES-GATE-040`, which is the `TTES-040-003` paragraph
       above being held to its own claim; removed → green.
  - Command: `node --test tests/architecture/pass-requires-evidence.test.mjs` → **9 of 11
    pass**. The two failures are not this row's and are not in this batch's files: a
    concurrent agent has set `TTES-GATE-030` to PASS in this same ledger over three
    children still undecided as this ran (`TTES-030-001`, `TTES-030-004`,
    `TTES-030-005`) and with no `Children:` line, and `WRK-GATE-050` the same over its
    three in `docs/implementation/universal-work-graph-execution-ledger.md`. Their
    statuses are deliberately NOT pinned in the canonical `` `ID` STATUS `` shape here —
    that row is somebody else's work in flight, and a checked claim about it would red
    their build for finishing it. `git show
    HEAD:docs/implementation/tenant-experience-execution-ledger.md` has `TTES-GATE-030`
    as `- [ ]` / FAIL, so that PASS arrived in the working tree during this batch. Both
    findings are the existing cases 3 and 8 working exactly as intended, on somebody
    else's row.

- [ ] **TTES-GATE-050** — Tenant UX superiority is evidence-backed and continuously governed.
  - Status: FAIL
  - Children: 2 of 5 decided — `TTES-050-001` FAIL (the harness exists; the
    per-persona budgets it holds journeys to are still `—`), `TTES-050-002`
    BLOCKED_EXTERNAL (licensed benchmarking access and a human-subjects protocol,
    neither of which any code here produces), `TTES-050-003` PASS (design-system
    versioning, notes, migration and enforced deprecation), `TTES-050-004` PASS
    (the adoption / exception / visual-debt dashboard with an owner per row and
    budgets asserted in both directions), and `TTES-050-005` FAIL — the claim gate
    that blocks a superiority claim until its measurement is PASS was built and its
    mutations all reproduce, but the row was OVERTURNED on review; its own entry
    carries the refuter's reasoning. A gate is proven by its children, so nothing
    written in this row can make it PASS.
  - Written out rather than left as "imported …; not yet implemented", because that
    sentence reads identically for a gate blocked on two named things and for one
    nobody has opened. This one is the first: **the governance half of the gate
    landed and the evidence half did not.** "Continuously governed" now has real
    machinery — a dashboard nobody can quietly let drift and a claim gate that
    reads the ledger rather than a list of banned words. "Evidence-backed" is
    exactly what is missing: `TTES-050-001` has a measurement harness and no
    recorded numbers, and `TTES-050-002` cannot have any until a human decides
    what Tenure may lawfully benchmark and how.
  - The two blockers, unchanged by this batch and not this batch's to move: eight
    journey budgets need a served application on a seeded Postgres
    (`TTES-050-001`), and the competitor comparison needs
    `docs/decisions/ADR-0009-competitive-benchmarking.md`, whose absence
    `tests/architecture/pass-requires-evidence.test.mjs` re-checks on every CI run
    from `TTES-050-002`'s own row.
