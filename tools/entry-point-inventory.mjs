#!/usr/bin/env node
/**
 * GE-000-004 / TTES-000-001 — enumerate every way a request can enter the
 * platform, in either experience, and every design token each one renders with.
 *
 * Generated from the filesystem rather than written from memory, for the same
 * reason `repository-map.md` is: a hand-maintained list of entry points is
 * wrong within a week, and a wrong list of entry points is worse than none —
 * it is the thing a reviewer trusts when asking "what is exposed?".
 *
 * ── Two experiences, one inventory (TTES-000-001) ───────────────────────────
 *
 * This walked `apps/web` alone. `apps/system-studio` — the console from which
 * Tenure staff compose, provision and advance every tenant, holding the highest
 * privilege in the estate — was inventoried by nothing at all: not its eight
 * pages, not its NextAuth route, not its two server-action modules. The doc's
 * headline read "22 API routes · 36 pages" and was quietly counting half the
 * platform.
 *
 * So the roots are a list, each tagged with the EXPERIENCE it belongs to:
 *
 *   * `tenant`   — what a customer signs into. Scoped to one institution.
 *   * `deployer` — what Tenure staff operate the estate from. Scoped to none.
 *
 * The distinction is not cosmetic and is not the same question `ownership.md`
 * answers. That map says which platform DOMAIN a file belongs to (a Studio page
 * and a tenant page can both be `configuration`); this says which AUDIENCE can
 * reach it. A guard that is right for one is wrong for the other, and until
 * both are in one table nothing could compare them.
 *
 * What this can and cannot tell you:
 *
 *   * It reports the guards a handler *mentions*. That is a strong signal and a
 *     weak proof. `tests/security/entry-points.test.mjs` turns the important
 *     half into a proof by failing when a new handler appears with no guard at
 *     all, so an unguarded route cannot be added silently.
 *   * A guard named in a route's own file is not the only way a route can be
 *     protected — Next.js layouts guard everything nested under them. The
 *     classifier therefore walks up the directory tree and attributes an
 *     ancestor layout's guard to the page, which is why every `(app)` page
 *     reports `session` even though most page files never call `auth()`.
 *
 * Usage:  node tools/entry-point-inventory.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { paletteOf, resolveToken, tokenNamesIn } from '../apps/web/src/lib/a11y/css-declarations.mjs'

const OUT = 'docs/architecture/entry-points.md'

/**
 * The two experiences, and where each one's surface lives.
 *
 * `key` is what the Experience column prints and what every id below is
 * prefixed with. Prefixing is not decoration: both apps serve `/signin` and
 * both serve `/api/auth/[...nextauth]`, so an unprefixed route is ambiguous —
 * allowlisting "`/signin` is public" would silently allowlist the operator
 * console's sign-in page too.
 */
export const EXPERIENCES = [
  {
    key: 'tenant',
    app: 'apps/web',
    appRoot: 'apps/web/src/app',
    globals: 'apps/web/src/app/globals.css',
    what: 'What a customer signs into. Everything it serves is scoped to one institution.',
  },
  {
    key: 'deployer',
    app: 'apps/system-studio',
    appRoot: 'apps/system-studio/src/app',
    globals: 'apps/system-studio/src/app/globals.css',
    what:
      'What Tenure staff operate the estate from. It shows every tenant, so it is scoped to none — ' +
      'which is why it is a separate origin (PD-007) and why its guards are operator-shaped.',
  },
]

/**
 * A guard is a mechanism that can refuse a request, keyed by what it proves.
 * Order matters only for display.
 */
const GUARDS = [
  // `requireAdminContext` is the admin console's front door and it opens with
  // `await auth()`, redirecting to /signin when there is no session
  // (`apps/web/src/lib/admin/guard.ts:19-20`) before it checks anything else. It
  // already matched `capability` through the `requireAdmin` substring, so an
  // action using it reported "authorized but not signed in" — a state that
  // cannot exist, and one that reads as debt on a path which is in fact gated
  // harder than most. Named here rather than by making every action call
  // `auth()` a second time, which would duplicate the gate to satisfy a parser.
  {
    key: 'session',
    label: 'signed in',
    pattern: /\bauth\(\)|requireSession|getServerSession|requireAdminContext/,
  },
  // `isOperator` is the System Studio's own name for this check, and it is the
  // ONLY name it uses — `apps/system-studio/src/lib/operators.ts`. While the
  // inventory walked `apps/web` alone the omission cost nothing; the moment the
  // deployer experience joined the table, every operator-gated console page
  // would have reported `session` and no more, which reads as "signed in is all
  // it takes to compose a tenant". The name appears nowhere in `apps/web`, so
  // this cannot promote a tenant-side handler.
  // STUDIO-020-005/006 replaced the boolean with a decision. `isOperator` is
  // now the AUTHENTICATION half only; every page and every server action calls
  // `authorizeCommand` / `authorizedOperator`, which decide a named
  // resource/action against the caller's role family and the account, region
  // and environment the request targets. A detector keyed on the old spelling
  // would have reported nine paths that got strictly STRONGER as paths that had
  // lost their guard — the same regression `decideFinanceAction` caused below,
  // and the reason the comment there exists.
  {
    key: 'operator',
    label: 'platform operator',
    pattern:
      /isPlatformOperator|requireOperator|\bisOperator\(|authorizeCommand|authorizedOperator|authorizeOperator/,
  },
  // `decideFromSeats` is GE-051-005's shape: the authorization engine answering
  // from the bundle a seat carries. It belongs in this row because it makes the
  // same claim the others do — that something beyond "signed in" was checked —
  // and leaving it out would report a converted path as unauthorized debt.
  // `decideFinanceAction` resolves a `PermissionKey` through
  // `decideAcrossInstitution` — the authorization engine — and additionally
  // refuses an archived club and an unentitled tier. It replaced
  // `canManageFinance(ctx, org)` in the finance actions, and because the old
  // name matched `\bcan[A-Z]\w*\(` and the new one matches nothing, a path that
  // got STRICTER read to this inventory as one that had lost its guard
  // altogether. A detector keyed on spelling reports a rename as a regression.
  { key: 'capability', label: 'capability', pattern: /requireCapability|assertCapability|\bcan[A-Z]\w*\(|guardAdmin|requireAdmin|decideFromSeats|decideFinanceAction/ },
  { key: 'tenant', label: 'tenant scope', pattern: /withTenant|resolveTenantScope|forEachInstitution|tenantScope/ },
  // Any bearer-secret comparison, not two names someone thought of once. The
  // reconcile endpoint was correctly guarded by PLATFORM_RECONCILE_SECRET and
  // reported as unguarded, because the pattern was a list rather than a shape.
  {
    key: 'shared-secret',
    label: 'shared secret',
    pattern: /process\.env\.[A-Z0-9_]*SECRET|JOB_SECRET|CRON_SECRET/,
  },
  { key: 'url-token', label: 'unguessable URL token', pattern: /params.*token|\btoken\b.*findUnique/s },
]

/**
 * Tracked AND untracked-but-not-ignored.
 *
 * Plain `git ls-files` lists only tracked files, which made this blind to the
 * one file that matters most: a brand-new route. It could not be seen until the
 * commit that introduced it had already passed the guard, so the check ran
 * against every entry point except the one being added. A security check that
 * only inspects code it has seen before is not a security check.
 */
const listFiles = (glob) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', glob], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    // `--cached` is the index, and the index still lists a file that has been
    // deleted or renamed in the worktree and not yet staged. Such a file is not
    // an entry point — nothing serves it — and reading it throws ENOENT, which
    // took down the whole inventory rather than removing one row. Both halves
    // matter: `tests/architecture/nav-hrefs-are-served.test.mjs` asks this
    // function which routes the app serves, and answering "the ones git
    // remembers" would let a module keep advertising a page somebody deleted.
    .filter((f) => fs.existsSync(f))

const read = (f) => fs.readFileSync(f, 'utf8')

/** Strip comments — a guard named in prose is not a guard. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

/**
 * Guards that apply to a file, including those inherited from ancestor layouts.
 * This is what makes the table honest about Next.js: `(app)/orgs/[slug]/page.tsx`
 * calls no guard of its own and is nonetheless behind a session.
 */
function guardsFor(file, appRoot) {
  const found = new Set()
  const sources = [file]

  // `path.dirname` returns platform separators on Windows while the git paths
  // are POSIX, so the walk is done on the POSIX string and compared to a POSIX
  // root. Getting this wrong stops the ancestor walk on the first iteration and
  // reports every page as unguarded — loudly, which is the safe direction, but
  // it would still be a false alarm rather than a finding.
  let dir = path.posix.dirname(file)
  while (dir === appRoot || dir.startsWith(`${appRoot}/`)) {
    const layout = path.posix.join(dir, 'layout.tsx')
    if (layout !== file && fs.existsSync(layout)) sources.push(layout)
    dir = path.posix.dirname(dir)
  }

  for (const src of sources) {
    const text = code(read(src))
    for (const g of GUARDS) if (g.pattern.test(text)) found.add(g.key)
  }
  return [...found]
}

const routeOf = (file, appRoot) =>
  file
    .replace(`${appRoot}`, '')
    .replace(/\/(page|route)\.tsx?$/, '')
    .replace(/^$/, '/') || '/'

const verbsOf = (file) =>
  [...read(file).matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)]
    .map((m) => m[1])

/**
 * Each exported async function in a "use server" module, with the guards its
 * own body reaches — directly, or through a helper defined in the same module.
 *
 * The body is taken by brace-matching from the opening `{`. That is not a
 * parser and would not survive a brace inside a string or regex literal in
 * these files; it survives the ones that are here, and the test that consumes
 * this fails loudly rather than silently under-reporting if it ever stops
 * matching (an unbalanced body yields the rest of the file, which over-reports
 * guards — so the failure direction is a false *pass* on this function alone,
 * caught by the module-level guard assertion that runs alongside it).
 */
function exportedActionsOf(file) {
  const text = code(read(file))
  const out = []

  // Helpers defined in the module, and the guards each reaches. An action that
  // calls `requireOfficer(...)` is guarded by whatever that helper checks.
  const helpers = new Map()
  for (const m of text.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)) {
    const body = braceBody(text, m.index)
    helpers.set(m[1], GUARDS.filter((g) => g.pattern.test(body)).map((g) => g.key))
  }

  for (const m of text.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
    const body = braceBody(text, m.index)
    const guards = new Set(GUARDS.filter((g) => g.pattern.test(body)).map((g) => g.key))
    for (const [name, keys] of helpers) {
      if (name !== m[1] && new RegExp(`\\b${name}\\s*\\(`).test(body)) keys.forEach((k) => guards.add(k))
    }
    out.push({ name: m[1], guards: [...guards] })
  }
  return out
}

/**
 * The body of the function declared at `from`, by brace matching.
 *
 * The opening brace is found by SKIPPING THE PARAMETER LIST first, which is the
 * whole reason this is not `text.indexOf('{', from)`. It was, and a parameter
 * with an object default swallowed the function whole:
 *
 *   async function authorizedOperator(
 *     command: StudioCommand,
 *     scope: Omit<CommandScope, "principalId"> = {},   ← first `{` in the file
 *   ): Promise<string> {
 *
 * `indexOf` landed on the `{}` of `= {}` and returned it as the body, so the
 * System Studio's actual authentication helper — the one that calls `auth()` and
 * `authorizeCommand` — was recorded as reaching no guard at all. Every action
 * that inherits its guard through it lost the `session` attribution, and the
 * inventory reported `composeTenant`, `advanceState` and `adoptTenantAction` as
 * `operator` alone: "anyone the console considers an operator, signed in or
 * not", which is not a state that exists. Seven helpers across both apps were
 * being read this way, so the helper-inheritance map that `exportedActionsOf`
 * exists to build was empty for all of them.
 *
 * Under-reporting is the safe direction for `tests/security/entry-points.test.mjs`
 * — a guard it cannot see reads as missing, which fails loudly — but it is the
 * WRONG direction for this document, whose entire job under TTES-000-001 is to
 * say truthfully what protects the deployer experience.
 *
 * The parameter list is matched by parens rather than assumed, so a default
 * value containing its own parens or braces is skipped with it. Of the 113
 * function declarations in the repository's `"use server"` modules, none has a
 * brace inside a generic parameter and none annotates an object-literal return
 * type — the two shapes that would put a brace between the `)` and the body —
 * so "the first `{` after the matching `)`" is exact here rather than merely
 * close, and an unbalanced parameter list yields '' rather than the rest of the
 * file, which under-reports instead of silently over-reporting guards.
 */
function braceBody(text, from) {
  const lparen = text.indexOf('(', from)
  if (lparen === -1) return ''

  // The matching `)`, so a default like `= f(1)` or `= {}` cannot end it early.
  let parens = 0
  let rparen = -1
  for (let i = lparen; i < text.length; i++) {
    if (text[i] === '(') parens++
    else if (text[i] === ')' && --parens === 0) {
      rparen = i
      break
    }
  }
  if (rparen === -1) return ''

  const open = text.indexOf('{', rparen)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return text.slice(open)
}

/**
 * Everything one experience exposes.
 *
 * Every entry carries `experience` and an `id` that is prefixed with it. The
 * prefix is what makes the allowlists below unambiguous now that two apps serve
 * `/signin`.
 */
function collectExperience({ key, app, appRoot }) {
  // The whole subtree once, filtered here. It used to be three git pathspecs
  // of the form `<root>/**/page.tsx`, and git's `**/` requires at least one
  // intervening directory — so `apps/web/src/app/page.tsx` matched NOTHING and
  // the app's own root route has never appeared in this inventory. A page that
  // no inventory lists is the exact defect TTES-000-001 is about, and it was
  // sitting inside the tool meant to prevent it.
  const files = listFiles(appRoot)

  const pageOrRoute = (file, kind, verbs) => ({
    kind,
    experience: key,
    app,
    file,
    route: routeOf(file, appRoot),
    id: `${key}:${routeOf(file, appRoot)}`,
    verbs,
    guards: guardsFor(file, appRoot),
  })

  const apiRoutes = files
    .filter((f) => /(^|\/)route\.ts$/.test(f))
    .sort()
    .map((file) => pageOrRoute(file, 'api', verbsOf(file)))

  const pages = files
    .filter((f) => /(^|\/)page\.tsx$/.test(f))
    .sort()
    .map((file) => pageOrRoute(file, 'page', ['GET']))

  const actionFiles = files
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /^\s*["']use server["']/m.test(read(f)))
    .sort()

  // Every exported async function in a "use server" file is a POST endpoint
  // reachable by anyone who can guess its action id. They are enumerated one at
  // a time, not per file: a module where one of twenty-one actions checks a
  // capability would otherwise report "capability" for all twenty-one, which is
  // precisely the mistake this inventory exists to prevent.
  const actions = actionFiles.map((file) => ({
    kind: 'action',
    experience: key,
    app,
    file,
    route: file.replace(`${appRoot}/`, ''),
    id: `${key}:${file.replace(`${appRoot}/`, '')}`,
    exported: exportedActionsOf(file).map((fn) => ({
      ...fn,
      id: `${key}:${file.replace(`${appRoot}/`, '')} → ${fn.name}`,
    })),
    guards: guardsFor(file, appRoot),
  }))

  return { apiRoutes, pages, actions }
}

/**
 * Both experiences, in one set of lists.
 *
 * Consumers that genuinely mean one experience filter on `.experience` —
 * `tests/architecture/nav-hrefs-are-served.test.mjs` does, because a module nav
 * href pointing at a Studio-only route is a broken href, not a served one.
 */
export function collect(experiences = EXPERIENCES) {
  const per = experiences.map(collectExperience)
  return {
    apiRoutes: per.flatMap((p) => p.apiRoutes),
    pages: per.flatMap((p) => p.pages),
    actions: per.flatMap((p) => p.actions),
  }
}

/**
 * Entry points reachable with no proof of anything. Deliberately explicit.
 *
 * Keyed by `experience:route`, not by route. Both apps serve `/signin` and both
 * serve `/api/auth/[...nextauth]`; an unprefixed `/signin` here would have
 * allowlisted the operator console's sign-in page as a side effect of
 * allowlisting the tenant one, which is exactly the class of accident this file
 * exists to make impossible.
 */
export const INTENTIONALLY_PUBLIC = new Set([
  'tenant:/api/auth/[...nextauth]', // NextAuth's own handler — sign-in cannot require sign-in
  'tenant:/api/health', // ALB target-group probe, pre-authentication by necessity
  // The sign-in page. It reports `session` today because it calls `auth()` to
  // bounce a visitor who is already signed in, so this line filters nothing at
  // the moment; it stays because the page IS public, and a refactor that drops
  // that call should not turn a public page into a finding.
  'tenant:/signin',
  // The Studio's NextAuth handler, for the same reason as the tenant app's: it
  // IS the sign-in mechanism. It was reachable before this list mentioned it —
  // the inventory simply did not walk `apps/system-studio` — so this line adds
  // a record of an existing hole rather than opening one.
  'deployer:/api/auth/[...nextauth]',
  // `apps/web/src/app/page.tsx`, whose entire body is `redirect("/dashboard")`.
  // It takes no input, reads nothing and sends the visitor at a page that is
  // guarded. It is on this list because it was on NO list: git's `**/` pathspec
  // never matched an app-root page, so the tenant app's own front door has been
  // outside every count this document has ever printed.
  'tenant:/',
])

/**
 * Server actions that legitimately guard nothing.
 *
 * Sign-out is the only one, and it is safe for the reason that generalises: it
 * takes no argument, reads no tenant row, and its effect on someone with no
 * session is to leave them with no session. An action qualifies here only if
 * calling it anonymously is indistinguishable from not calling it.
 */
export const PUBLIC_ACTIONS = new Set(['tenant:(app)/actions.ts → signOutAction'])

/* ── Design tokens (TTES-000-001) ──────────────────────────────────────────
 *
 * The two experiences render from two stylesheets that share nine token names
 * and agree on five of them. `--accent` is `#26364a` in the tenant app and
 * `#7a6440` in the Studio; `--border`, `--border-strong` and `--space-6` differ
 * too. None of that was written down anywhere, so one token name meant two
 * things and nothing could tell a deliberate divergence from a copy-paste that
 * drifted.
 *
 * The table below is the record. It is not documentation — the test fails when
 * a name diverges without an entry AND when an entry describes a divergence
 * that no longer exists, so it cannot rot in either direction.
 */

/**
 * Token names declared by both experiences with DIFFERENT resolved values.
 *
 * `status` is the honest half. `deliberate` means someone decided the two
 * experiences should differ here and the entry says why. `unreconciled` means
 * they differ and nobody has decided — a real state that a table offering only
 * "deliberate" would launder into a justification. The test caps how many may
 * be `unreconciled`, so the next unowned divergence reds CI rather than joining
 * a growing list of shrugs.
 *
 * A name may appear here only WHILE it actually diverges: the test also fails on
 * an entry whose token now agrees, so "we unified these" deletes the entry
 * instead of leaving a claim behind.
 */
export const SHARED_TOKENS = new Map([
  [
    '--accent',
    {
      status: 'deliberate',
      why:
        'The console is meant to be unmistakable at a glance — ' +
        'apps/system-studio/src/app/globals.css says so in its opening comment: an internal ' +
        'surface that looks like the customer application is one someone screenshots into a ' +
        'customer conversation by accident. Tenure navy against desaturated ochre is that ' +
        'difference, and it is the whole reason the console has its own stylesheet.',
    },
  ],
  [
    '--border',
    {
      status: 'deliberate',
      why:
        'Downstream of --accent. The console is warm off-white paper where the product is ' +
        'cooler, so a hairline tuned against one surface reads wrong on the other. Both were ' +
        'measured against their own background rather than copied across.',
    },
  ],
  [
    '--border-strong',
    {
      status: 'deliberate',
      why:
        'The same hairline one step darker, and it has to sit on the same surface it was ' +
        'measured against — so it diverges for exactly the reason --border does.',
    },
  ],
  [
    '--space-6',
    {
      status: 'deliberate',
      why:
        'Both scales are 4px-based and agree at steps 1–5; step 6 is where they part. 24px ' +
        "continues the product's 4/8/12/16/20/24/32 ramp toward its dense table chrome; 28px " +
        'gives the console the looser top-of-section gap its long-form key/value pages read ' +
        'better with. A scale decision rather than a palette one, and the only reason it is ' +
        'visible at all is this table — the survey that opened TTES-000-001 missed it.',
    },
  ],
  [
    '--ease-entry',
    {
      status: 'unreconciled',
      why:
        'Nobody decided this. The console has carried cubic-bezier(0, 0, 0.2, 1) — the ' +
        'Material decelerate curve — since it got a motion scale; the product declared ' +
        'cubic-bezier(0.16, 1, 0.3, 1), a stronger ease-out, when its own motion layer landed. ' +
        'Both satisfy the same rule (Bible §26.3.7, decelerating on entry) and both apps agree ' +
        'on the DURATIONS either side of it (--motion-fast 120ms, --motion-base 180ms), which ' +
        'is what makes the curve look like drift rather than a choice. Recorded, not excused: ' +
        'the entry exists so the difference is visible and owned, and the test refuses a ' +
        'second one.',
    },
  ],
])

/** How many divergences may sit in `unreconciled` at once. This may only fall. */
export const UNRECONCILED_TOKEN_BUDGET = 1

/**
 * The token inventory: every custom property either stylesheet declares, and
 * which experience declares it.
 *
 * Values come from the default palette — every `:root` block not inside an
 * `@media` — because that is what a browser resolves before any preference is
 * expressed, and comparing theme overrides would compare two different
 * questions. The parser is `apps/web/src/lib/a11y/css-declarations.mjs`, the
 * same one the contrast audit reads the product's palette with; a second parser
 * here would be free to disagree with it.
 */
export function collectTokens(experiences = EXPERIENCES) {
  const perApp = experiences.map((e) => {
    const css = fs.readFileSync(e.globals, 'utf8')
    return { ...e, palette: paletteOf(css), names: tokenNamesIn(css) }
  })

  const names = [...new Set(perApp.flatMap((a) => a.names))].sort()

  /**
   * The value a browser would compute, alias followed.
   *
   * A `var()` that points at a name the default palette does not declare cannot
   * be resolved, and the raw declaration is returned with `unresolved` set
   * rather than throwing. Throwing would take the whole inventory down over one
   * token; reporting it keeps every other row and makes the broken one visible.
   */
  const valueOf = (palette, name) => {
    try {
      return { value: resolveToken(palette, name), raw: palette[name], unresolved: false }
    } catch {
      return { value: palette[name], raw: palette[name], unresolved: true }
    }
  }

  const tokens = names.map((name) => {
    const declaring = perApp.filter((a) => name in a.palette)
    const resolvedPer = declaring.map((a) => [a.key, valueOf(a.palette, name)])
    const values = resolvedPer.map(([, v]) => v.value)
    const shared = declaring.length > 1
    // Resolved values, not raw declarations: `--accent: var(--tenure-navy-700)`
    // and `--accent: #26364a` are the same colour spelled two ways, and a
    // ratchet that reported them as divergent would be crying wolf.
    const agree = shared && values.every((v) => v === values[0])
    const record = shared && !agree ? (SHARED_TOKENS.get(name) ?? null) : null
    return {
      name,
      experiences: declaring.map((a) => a.key),
      values: Object.fromEntries(resolvedPer.map(([k, v]) => [k, v.value])),
      raw: Object.fromEntries(resolvedPer.map(([k, v]) => [k, v.raw])),
      unresolved: resolvedPer.filter(([, v]) => v.unresolved).map(([k]) => k),
      shared,
      agree,
      // A divergence with no record is what the test fails on; the record is
      // carried here so the document prints it beside the values.
      status: record?.status ?? null,
      reason: record?.why ?? null,
    }
  })

  return { perApp, tokens }
}

function render({ apiRoutes, pages, actions }, { perApp, tokens }) {
  const row = (e) =>
    `| \`${e.route}\` | ${e.experience} | ${e.verbs?.join(', ') ?? 'POST'} | ${e.guards.length ? e.guards.map((g) => `\`${g}\``).join(' + ') : '**none**'} |`

  const unguarded = [...apiRoutes, ...pages].filter((e) => e.guards.length === 0)
  const totalActions = actions.reduce((n, a) => n + a.exported.length, 0)
  const countIn = (list, key) => list.filter((e) => e.experience === key).length

  // An action reachable by anyone who can guess its id. Layout guards do NOT
  // apply to server actions: a POST to an action id never renders the layout.
  const unguardedActions = actions.flatMap((a) =>
    a.exported.filter((fn) => fn.guards.length === 0).map((fn) => ({ module: a.route, name: fn.name, experience: a.experience }))
  )

  const sharedTokens = tokens.filter((t) => t.shared)
  const divergent = sharedTokens.filter((t) => !t.agree)

  return `<!-- Generated by tools/entry-point-inventory.mjs. Do not edit by hand. -->
# Entry points

GE-000-004 / TTES-000-001. Every way a request can enter the platform, in either
experience, what refuses it, and the design tokens each experience renders with.

Generated from the filesystem. \`npm run test:platform\` regenerates this and
fails if the committed copy is stale, so it cannot quietly go out of date, and
fails if a handler appears with no guard and no entry on the public allowlist.

**${apiRoutes.length} API routes · ${pages.length} pages · ${actions.length} server-action modules exporting ${totalActions} actions.**

## The two experiences

Every row below is attributed to one of these. Ownership (\`ownership.md\`) says
which platform *domain* a file belongs to; this says which *audience* can reach
it. They are different questions and a file can answer them differently — a
Studio configuration page and a tenant settings page are both \`configuration\`,
and only one of them may be reached by a customer.

| Experience | App | Surface | What it is |
|---|---|---:|---|
${EXPERIENCES.map(
  (e) =>
    `| \`${e.key}\` | \`${e.app}\` | ${countIn(apiRoutes, e.key)} routes · ${countIn(pages, e.key)} pages · ${countIn(actions, e.key)} action modules | ${e.what} |`,
).join('\n')}

## What a guard means here

| Guard | Proves |
|---|---|
${GUARDS.map((g) => `| \`${g.key}\` | ${g.label} |`).join('\n')}

Guards are attributed from the handler **and every ancestor layout**, because a
Next.js layout guards everything nested beneath it. Most \`(app)\` pages contain
no guard of their own; they are behind \`(app)/layout.tsx\`.

## API routes

| Route | Experience | Verbs | Guards |
|---|---|---|---|
${apiRoutes.map(row).join('\n')}

## Pages

| Route | Experience | Verbs | Guards |
|---|---|---|---|
${pages.map(row).join('\n')}

## Server actions

Each exported async function in a \`"use server"\` module is a POST endpoint.
They do not appear in \`next build\` output and are easy to forget when reasoning
about exposure, which is why they are counted here.

**A layout guard does not protect a server action.** A POST to an action id
never renders the layout, so unlike the pages above, each action carries its own
guard or carries none. They are therefore listed individually rather than by
module — a module where one of twenty-one actions checks a capability would
otherwise report \`capability\` for all twenty-one.

${actions
  .filter((a) => a.exported.length)
  .map(
    (a) => `### \`${a.route}\` — ${a.experience}

| Action | Guards |
|---|---|
${a.exported.map((fn) => `| \`${fn.name}\` | ${fn.guards.length ? fn.guards.map((g) => `\`${g}\``).join(' + ') : '**none**'} |`).join('\n')}`
  )
  .join('\n\n')}

### Actions with no guard of their own

${
  unguardedActions.length === 0
    ? '_None._'
    : unguardedActions.map((a) => `- ${a.experience} · \`${a.module}\` → \`${a.name}\``).join('\n')
}

## Reachable without authentication

${unguarded.length === 0 ? '_None beyond the allowlist below._' : unguarded.map((e) => `- \`${e.id}\``).join('\n')}

Allowlisted as necessarily public:

${[...INTENTIONALLY_PUBLIC].map((r) => `- \`${r}\``).join('\n')}

## Design tokens

TTES-000-001. The two experiences render from two stylesheets, and nothing
compared them until now. \`${perApp[0].globals}\` declares
${perApp[0].names.length} token names; \`${perApp[1].globals}\` declares
${perApp[1].names.length}; ${sharedTokens.length} names are declared by both and
${divergent.length} of those carry different values — so one token name means two
colours across the platform, which is fine when it is a decision and is a defect
when it is drift.

Values are the default palette: every \`:root\` block outside an \`@media\`, which
is what a browser resolves before any preference is expressed. Read with
\`apps/web/src/lib/a11y/css-declarations.mjs\`, the same parser the contrast audit
uses, so this table and that audit cannot disagree about what the stylesheets say.

### Declared by both, with different values

\`tests/architecture/experience-separation.test.mjs\` fails when a name appears
here without an entry in \`SHARED_TOKENS\`, and fails when \`SHARED_TOKENS\`
carries an entry for a name that no longer diverges. That is what makes this a
ratchet rather than a snapshot.

| Token | ${EXPERIENCES.map((e) => e.key).join(' | ')} | Status | Record |
|---|${EXPERIENCES.map(() => '---|').join('')}---|---|
${
  divergent.length === 0
    ? `| _none_ |${EXPERIENCES.map(() => ' |').join('')} | |`
    : divergent
        .map(
          (t) =>
            `| \`${t.name}\` | ${EXPERIENCES.map((e) => `\`${t.values[e.key] ?? '—'}\``).join(' | ')} | ${t.status ?? '**undeclared**'} | ${t.reason ?? '**No entry in `SHARED_TOKENS`. This is drift until someone says otherwise.**'} |`,
        )
        .join('\n')
}

Values above are resolved: \`--accent\` is declared as \`var(--tenure-navy-700)\` in
the tenant app and as a literal in the console, and comparing the declarations
rather than the colours would report a match as a divergence and a divergence as
a match. \`deliberate\` means someone decided the two experiences should differ.
\`unreconciled\` means they differ and nobody has — recorded rather than
justified, and capped at ${UNRECONCILED_TOKEN_BUDGET} so the next one fails the build.

### Declared by both, agreeing

${
  sharedTokens.filter((t) => t.agree).length === 0
    ? '_None._'
    : sharedTokens
        .filter((t) => t.agree)
        .map((t) => `- \`${t.name}\` = \`${t.values[EXPERIENCES[0].key]}\``)
        .join('\n')
}

### Every token, and who declares it

| Token | Experience | ${EXPERIENCES.map((e) => e.key).join(' | ')} |
|---|---|${EXPERIENCES.map(() => '---|').join('')}
${tokens
  .map(
    (t) =>
      `| \`${t.name}\` | ${t.shared ? (t.agree ? 'both (agree)' : '**both (differ)**') : t.experiences[0]} | ${EXPERIENCES.map((e) => (e.key in t.values ? `\`${t.values[e.key]}\`` : '—')).join(' | ')} |`,
  )
  .join('\n')}

## Scheduled, and non-HTTP

| Path | Trigger | Auth |
|---|---|---|
| \`POST /api/jobs/reminders\` | EventBridge rule \`tenure-pilot-deliverable-reminders\`, \`cron(0 13 * * ? *)\`, via API destination (\`infrastructure/terraform/scheduler.tf\`) | \`JOB_SECRET\` bearer token |

There are no webhooks, no realtime/WebSocket paths and no queue consumers.
See \`subsystem-paths.md\` for what that last one implies about the five SQS
queues that exist in AWS.

## Import and export

| Path | Direction | Guard |
|---|---|---|
| \`GET /api/platform/export/[slug]\` | export, whole tenant, JSON | \`shared-secret\` (control plane calling the cell, GE-033-001); 404 rather than 403 for everyone else |
| \`GET /api/calendar/ics/[token]\` | export, one calendar, iCal | unguessable per-user token, no session |
| \`GET /api/templates/budget\` | export, CSV template | \`session\` |
| \`apps/web/scripts/seed.mjs\` | import, offline | none — it is a script, not an endpoint |

There is no import endpoint. A tenant's data can leave the product but cannot
be loaded into it over HTTP, which is a gap against the Bible's tenant
provisioning and is owned by GE-060.
`
}

/**
 * Only when run as a command — never on import.
 *
 * `tests/security/entry-points.test.mjs` imports `collect` from this module,
 * and an ESM import executes the whole body. With the write unguarded, that
 * import rewrote `entry-points.md` before the test's own `--check` subprocess
 * compared against it, so the staleness assertion healed the file and then
 * confirmed it was healthy. It passed on every possible input, including a
 * handler whose guard had just been deleted: the guards column would silently
 * update and the test would report the document up to date.
 *
 * Found while adding `/api/me`: `switchTenantAction` lost its `tenant` guard in
 * a deliberate mutation, `npm run test:platform` reported 52/52, and the
 * committed document had quietly changed to agree with the mutation.
 */
const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect(), collectTokens())

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/entry-point-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(OUT, generated)
    console.log(`Wrote ${OUT}`)
  }
}
