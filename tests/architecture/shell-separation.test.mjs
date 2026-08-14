import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * TTES-000-002 — the tenant shell and the deployer shell are two shells, and
 * neither one's navigation or patterns may leak into the other.
 *
 * ## What already held, and what nothing was holding
 *
 * The first half of the requirement is real and was built: `apps/system-studio`
 * is its own Next application with its own `app/layout.tsx`, its own
 * `globals.css` and its own components; `apps/web` has an entirely separate
 * shell under `components/shell/`; no package ships a `.tsx`; and neither app
 * imports the other. All of that is true today.
 *
 * It was true by convention. The two guards that existed are narrower than this
 * requirement and deliberately so — `tests/security/operator-boundary.test.mjs`
 * asserts that no `apps/web` route gates on `isPlatformOperator`, and
 * `tests/security/operator-plane-content.test.mjs` asserts that the Studio
 * imports no Prisma client. Neither says anything about UI. Nothing forbade one
 * app importing the other's components, nothing forbade a shared shell
 * component that both navigations render through, and nothing forbade the
 * tenant menu naming a control-plane destination. The first shared `SideNav`
 * would have been caught by review, or not at all.
 *
 * That last one is not hypothetical: control-plane code lives inside the
 * customer application by design. `tools/ownership-map.mjs` gives the
 * control-plane domain `apps/web/src/app/api/platform/` — a control-plane
 * surface served by the tenant app. A menu entry pointing at one is a thing
 * somebody could add without noticing they had.
 *
 * ## The four properties
 *
 *   1. No file under one application's `src` imports anything under another's,
 *      by relative path or by workspace package name.
 *   2. No component reachable from an application's own layouts imports a
 *      first-party module outside that application.
 *   3. Every destination in the tenant menu is a route `apps/web` serves and is
 *      not a control-plane destination; and symmetrically, every destination in
 *      the operator console's navigation is a route the console serves and is
 *      not a tenant-only route. "The menu" is the module catalog *plus* every
 *      literal destination the shell writes itself, in either syntax and in the
 *      layout as well as the components — see `HREF_LITERAL`, and the leak that
 *      was green before it read both.
 *   4. No first-party workspace outside `apps/` defines a component, and no
 *      shell file — layout included — reaches one. This is the one that stops
 *      the two navigations converging on a single file.
 *   5. The console's navigation and the routes it serves are the same set, in
 *      both directions. (3) only ever read one way — every destination must be
 *      a route — which is the half that catches a dead link and misses the
 *      opposite and more expensive defect: a route in the tree that appears in
 *      no navigation at all. Five operator surfaces landed in one programme
 *      (`/platform/network`, `/platform/compute`, `/platform/data`,
 *      `/platform/messaging`, `/platform/identity`) and every guard here stayed
 *      green while none of them was reachable. So the second direction is
 *      asserted too: every route the console serves is either a navigation
 *      destination or is named, with a reason, in the `UNLINKED` table on
 *      `/platform/diagnostics`. See "The information architecture" below.
 *
 * ## Why (4) exists, when (2) was written to do that job
 *
 * (2) was originally documented as the check that stopped convergence: "a shared
 * `packages/ui` shell would satisfy (1) and defeat the separation entirely". It
 * did not do that job, and the gap was demonstrated rather than argued. Adding
 *
 *     packages/platform-config/src/ShellChrome.tsx
 *
 * and importing it from BOTH `apps/web/src/app/(app)/layout.tsx` and
 * `apps/system-studio/src/app/layout.tsx` left all six guards green. The two
 * shells rendered through one file and nothing said a word.
 *
 * The reason is structural: `shellGraph` walks *out of* the layouts but only
 * follows modules under the app's own `components/`, and the layouts themselves
 * are not in the resulting set — so (2) sees what `SideNav` imports and never
 * sees what the layout rendering `SideNav` imports. That is not an edge: the
 * layout is where both navigations are mounted today (`<SideNav/>` at
 * `apps/web/src/app/(app)/layout.tsx`, `<Nav/>` at
 * `apps/system-studio/src/app/layout.tsx`), so the layout is the single most
 * likely place for a shared chrome import to land.
 *
 * (2) cannot simply be widened to include layouts: a layout legitimately imports
 * `@tenure/platform-config`, which is pure data and is the whole point of having
 * shared packages. The distinction that matters is not *outside the app*, it is
 * *outside the app and renders*. So (4) is two clauses:
 *
 *   a. no file in any first-party workspace outside `apps/` is a component —
 *      no `.tsx`, no `"use client"`, no react/next import, no `createElement`.
 *      A shared shell cannot be *defined*, so it cannot be imported from a
 *      layout, a page, a server action or anywhere else, by any of the twelve
 *      apps that do not exist yet either.
 *   b. every first-party module a shell file imports resolves either inside its
 *      own application or inside one of those surveyed workspaces — which is
 *      what stops the same component being parked in a directory (a) does not
 *      cover, e.g. a relative import out of `src/` into a top-level `shared/`.
 *
 * The ledger entry for this item already claimed "no package ships a .tsx today;
 * this is what keeps that true". Nothing was keeping it true. (4a) is.
 *
 * ## Floors
 *
 * Every assertion here is an absence, and an absence passes trivially when the
 * survey finds nothing. `the survey reaches both applications` fails when fewer
 * than two application source roots are found, when either app's shell graph
 * collapses, when fewer than eight nav entries parse out of the module catalog,
 * when the route inventories come back empty, when the component detector fails
 * to recognise the two navigations it exists to keep apart, when the shell scan
 * stops covering the layouts, or when either href syntax stops being read — so
 * a broken reader reds instead of reporting a clean repository.
 *
 * ## Why the ownership map is read as text
 *
 * `tools/ownership-map.mjs` writes `docs/architecture/ownership.md` at import
 * time — its CLI branch is module-level, not guarded on being the entry point.
 * `tests/architecture/guards-do-not-write-into-the-tree.test.mjs` documents what
 * that costs: guards run in parallel, and for as long as a guard has modified
 * the tree, every other tree-scanning guard is looking at a repository that is
 * not the committed one. So this reads the file rather than importing it, and
 * the floor below is what stops a reader that has stopped reading from reporting
 * every menu entry as fine.
 *
 * ## The information architecture, and why three files have to agree
 *
 * (5) needs three declarations, and none of them can be imported: `Nav.tsx`
 * carries `"use client"` and this runner is plain `node --test` with no
 * TypeScript at all. All three are therefore read as source, with a
 * string-aware scanner rather than a naive brace match — one of the declared
 * routes is literally `/tenants/[slug]`, and a bracket counter that does not
 * know it is inside a string ends the table there.
 *
 *   · `apps/system-studio/src/components/Nav.tsx` — `GROUPS`. Group names are
 *     the Bible section 7.2 left-navigation domains, so the Bible is parsed too
 *     and the groups are checked against that list AND against its order. That
 *     turns "the Bible decides the group names, not anybody's taste" from a
 *     claim in a document into something a commit can fail.
 *   · `apps/system-studio/src/app/platform/diagnostics/page.tsx` — `UNLINKED`,
 *     `QUARANTINED` and `PLATFORM_PANELS`. The register an operator reads is
 *     the same data the guard reads; a register that is prose is a register
 *     that is wrong within a month.
 *   · `apps/system-studio/src/app/platform/page.tsx` — its `<Card>` headlines.
 *     `PLATFORM_PANELS` claims what each panel on that page is and what now
 *     supersedes it, and a claim about thirteen panels that nothing checks is a
 *     claim that survives the panels being renamed.
 *
 * The direction of each check matters and both directions are asserted, because
 * each one alone fails open: a register that lists nothing satisfies "everything
 * listed exists", and a navigation that links everything twice satisfies
 * "everything reachable is listed".
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const abs = (repoPath) => path.join(ROOT, repoPath)

/**
 * Source with comments removed.
 *
 * The repository's stated lesson, from `operator-plane-content.test.mjs`: every
 * lexical guard here has at some point fired on the comment explaining the rule
 * it enforces, and a guard that cannot tell code from an explanation punishes
 * explaining. `apps/system-studio/src/components/Nav.tsx` opens with a
 * paragraph naming `/tenants` and `/platform` in prose, which is exactly the
 * shape this file scans for.
 */
function code(repoPath) {
  return fs
    .readFileSync(abs(repoPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** Tracked AND untracked-but-not-ignored, so a file added in this commit counts. */
function gitFiles(...pathspecs) {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...pathspecs], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
  } catch (err) {
    if (err.status !== 1) throw err
    return []
  }
}

// ── the applications ────────────────────────────────────────────────────────

/**
 * Every application in the workspace, discovered rather than listed.
 *
 * Named here and the separation would only ever hold between the two somebody
 * thought of. A third app added under `apps/` is governed by all three
 * properties the moment it exists.
 */
const APPS = fs
  .readdirSync(abs("apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(abs(`apps/${name}/src`)) && fs.existsSync(abs(`apps/${name}/package.json`)))
  .sort()
  .map((name) => ({
    name,
    root: `apps/${name}/src`,
    pkg: JSON.parse(fs.readFileSync(abs(`apps/${name}/package.json`), "utf8")).name,
  }))

/**
 * Workspace package name → directory, for resolving a bare specifier.
 *
 * `apps/web` publishes itself as `tenure` and the console as
 * `@tenure/system-studio`, so a cross-app import does not have to be a relative
 * path to be one.
 */
const WORKSPACE = (() => {
  const roots = ["apps", "packages"]
  const dirs = roots.flatMap((root) =>
    fs
      .readdirSync(abs(root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${root}/${entry.name}`),
  )
  dirs.push("modules", "blueprints")

  const map = new Map()
  for (const dir of dirs) {
    const manifest = abs(`${dir}/package.json`)
    if (!fs.existsSync(manifest)) continue
    const { name } = JSON.parse(fs.readFileSync(manifest, "utf8"))
    if (name) map.set(name, dir)
  }
  // Longest first: `@tenure/platform-config/money` must not resolve through
  // `@tenure/platform-config` and lose its subpath.
  return [...map.entries()].sort((left, right) => right[0].length - left[0].length)
})()

const SOURCE = /\.(ts|tsx|mjs|js|jsx)$/

/**
 * Every module specifier a file imports.
 *
 * `from "x"`, a bare side-effect `import "x"`, `import("x")` and `require("x")`.
 * Run over comment-stripped source, so a specifier named in an explanation is
 * not a dependency.
 */
function specifiers(repoPath) {
  const text = code(repoPath)
  const found = []
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g
  for (const match of text.matchAll(pattern)) found.push(match[1])
  return found
}

/**
 * A specifier as a repository path, or `null` when it is third-party.
 *
 * `@/x` is each app's own alias for its own `src` (both tsconfigs map it to
 * `./src/*`), which is why resolution needs to know which app is asking.
 */
function resolveSpecifier(fromFile, spec, appRoot) {
  if (spec.startsWith(".")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  }
  if (spec.startsWith("@/")) return `${appRoot}/${spec.slice(2)}`
  for (const [name, dir] of WORKSPACE) {
    if (spec === name) return dir
    if (spec.startsWith(`${name}/`)) return `${dir}${spec.slice(name.length)}`
  }
  return null
}

/** The file a resolved path actually names, trying the extensions a bundler would. */
function moduleFile(resolved) {
  const candidates = [
    resolved,
    `${resolved}.tsx`,
    `${resolved}.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.ts`,
  ]
  return candidates.find((candidate) => fs.existsSync(abs(candidate)) && fs.statSync(abs(candidate)).isFile())
}

// ── the shells ──────────────────────────────────────────────────────────────

/**
 * The components an application's own layouts render, transitively.
 *
 * Derived, not named: the shell is whatever `app/**\/layout.tsx` reaches inside
 * `src/components/`. `apps/web`'s `(app)/layout.tsx` reaches `SideNav`; the
 * console's root layout reaches `Nav`. Naming the two directories would have
 * made the property hold for the two directories somebody knew about.
 *
 * The walk follows only modules under the app's own `components/`, which is what
 * keeps this about the shell rather than about everything a page can reach —
 * both apps legitimately share pure data packages, and a closure over `lib/`
 * would report that as convergence.
 */
function shellGraph(app) {
  const layouts = gitFiles(`${app.root}/app`).filter((file) => /\/layout\.tsx$/.test(file))
  const componentsRoot = `${app.root}/components/`
  const seen = new Set()
  const queue = []

  const enqueue = (file, spec) => {
    const resolved = resolveSpecifier(file, spec, app.root)
    if (!resolved || !resolved.startsWith(componentsRoot)) return
    const target = moduleFile(resolved)
    if (!target || seen.has(target)) return
    seen.add(target)
    queue.push(target)
  }

  for (const layout of layouts) for (const spec of specifiers(layout)) enqueue(layout, spec)
  while (queue.length > 0) {
    const file = queue.pop()
    for (const spec of specifiers(file)) enqueue(file, spec)
  }
  return { layouts, modules: [...seen].sort() }
}

const SHELLS = new Map(APPS.map((app) => [app.name, shellGraph(app)]))

/**
 * Every file that participates in an application's shell, layouts included.
 *
 * `shellGraph` deliberately excludes the layouts from `modules` — the walk is
 * about which components the shell is made of. This is the other question: which
 * files decide what the shell renders. The layout is one of them, and it is the
 * file both navigations are mounted in, so it is the file a shared chrome import
 * would land in.
 */
const shellFiles = (app) => [...SHELLS.get(app.name).layouts, ...SHELLS.get(app.name).modules]

// ── where components are allowed to be defined ──────────────────────────────

/**
 * First-party workspace roots that are not applications.
 *
 * Derived from the workspace map, not listed: `packages/*` plus `modules` and
 * `blueprints`, and whatever else `package.json`'s `workspaces` grows. A
 * fifteenth package is governed by (4a) the day it is created.
 */
const SHARED_ROOTS = [...new Set(WORKSPACE.map(([, dir]) => dir))]
  .filter((dir) => !dir.startsWith("apps/"))
  .sort()

const inside = (repoPath, root) => repoPath === root || repoPath.startsWith(`${root}/`)

/**
 * Why a module is a component, or `null` when it is not one.
 *
 * Four markers, any one of which is enough, all read off comment-stripped
 * source so that a file *explaining* the rule is not caught by it:
 *
 *   · a `.tsx`/`.jsx` extension — the ordinary case;
 *   · a `"use client"` or `"use server"` directive, which only means anything
 *     to a React framework;
 *   · an import of `react`, `react-dom` or `next` — a module that renders needs
 *     at least one of them, if only for its prop types;
 *   · a `createElement(` call, which is what a `.ts` file writing JSX by hand
 *     would use to stay a `.ts` file.
 *
 * A reason rather than a boolean because the failure message has to be actionable:
 * "packages/x/src/y.ts imports react" tells someone what to delete.
 */
function uiEvidence(repoPath) {
  if (/\.(tsx|jsx)$/.test(repoPath)) return "is a .tsx/.jsx"
  const text = code(repoPath)
  if (/^\s*["']use (client|server)["']/m.test(text)) return 'carries a "use client"/"use server" directive'
  const framework = /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["'](react|react-dom|next)(?:["']|\/)/.exec(
    text,
  )
  if (framework) return `imports ${framework[1]}`
  if (/\bcreateElement\s*\(/.test(text)) return "calls createElement"
  return null
}

// ── the routes each application serves ──────────────────────────────────────

/**
 * Routes an app serves, from its filesystem.
 *
 * Route groups contribute nothing to a URL, so `(app)/calendar` is `/calendar` —
 * the same normalisation `nav-hrefs-are-served.test.mjs` applies, for the same
 * reason: a nav entry says `/calendar` and that is what a browser asks for.
 */
function routesOf(app) {
  const routes = new Set()
  for (const file of gitFiles(`${app.root}/app`)) {
    if (!/\/page\.tsx$/.test(file)) continue
    const route = file
      .slice(`${app.root}/app`.length)
      .replace(/\/page\.tsx$/, "")
      .replace(/\/\([^)]+\)/g, "")
    routes.add(route || "/")
  }
  return routes
}

const ROUTES = new Map(APPS.map((app) => [app.name, routesOf(app)]))
const TENANT = "web"
const OPERATOR = "system-studio"

/** `/platform/cost` → `/platform`. A menu is separated at the top of the tree. */
function topSegment(route) {
  const [first] = route.split("/").filter(Boolean)
  return first ? `/${first}` : "/"
}

/**
 * Destinations that belong to the control plane.
 *
 * Two sources, both derived. The console's own top-level route segments, minus
 * any the tenant app also serves — both apps have a `/signin`, and a page both
 * serve is not an operator destination. And the paths `tools/ownership-map.mjs`
 * assigns to the `control-plane` domain that are routes inside `apps/web`, which
 * today is `apps/web/src/app/api/platform/`: control-plane surfaces served by
 * the customer application, which is precisely the case a hand-written list of
 * "operator paths" would miss.
 */
function controlPlaneDestinations() {
  const tenantRoutes = ROUTES.get(TENANT)
  const consoleOnly = [...ROUTES.get(OPERATOR)]
    .map(topSegment)
    .filter((segment) => segment !== "/" && !tenantRoutes.has(segment))

  const WEB_APP = "apps/web/src/app/"
  const source = code("tools/ownership-map.mjs")
  const block = /key:\s*['"]control-plane['"][\s\S]*?owns:\s*\[([^\]]*)\]/.exec(source)
  const owned = block ? [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : []
  const owns = owned
    .filter((prefix) => prefix.startsWith(WEB_APP))
    .map((prefix) => `/${prefix.slice(WEB_APP.length).replace(/\/$/, "")}`)
    .map((route) => route.replace(/\/\([^)]+\)/g, ""))

  return { owned, destinations: [...new Set([...consoleOnly, ...owns])].sort() }
}

const CONTROL_PLANE = controlPlaneDestinations()

const under = (href, prefix) => href === prefix || href.startsWith(`${prefix}/`)

// ── the menus ───────────────────────────────────────────────────────────────

const MANIFESTS = "modules/index.ts"

/**
 * Every nav entry in the module catalog, as `{ id, href }`.
 *
 * The same parse `tests/architecture/nav-hrefs-are-served.test.mjs` performs,
 * repeated rather than imported: importing a sibling test file would register
 * its tests in this process as well. A nav entry is an object literal with no
 * nested braces, so it can be taken whole by matching innermost `{...}` blocks
 * that declare both an `id` and an `href`.
 */
function tenantMenu() {
  const text = fs.readFileSync(abs(MANIFESTS), "utf8")
  return [...text.matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1])
    .filter((body) => /\bid:\s*"[\w.]+"/.test(body) && /\bhref:\s*"/.test(body))
    .map((body) => ({
      id: body.match(/\bid:\s*"([^"]*)"/)?.[1],
      href: body.match(/\bhref:\s*"([^"]*)"/)?.[1],
    }))
}

/**
 * A literal destination, in either syntax a shell writes one in.
 *
 * `href: "/settings"` is an object property — how `SideNav` pins Settings and
 * how the console's `ENTRIES` table is written. `href="/dashboard"` is a JSX
 * attribute — how `ShellHeader` links the wordmark and the work inbox, and how
 * anybody adding a single link to the chrome would write it.
 *
 * Only the first was matched, and the gap was demonstrated rather than argued:
 * adding `<Link href="/platform/cost">Fleet cost</Link>` to `ShellHeader.tsx`
 * left all eight guards green. The tenant product offered a link into the
 * operator console from its own masthead and nothing said a word — which is
 * precisely "the first operator nav entry would be caught by review, or not at
 * all", the thing this file exists to stop.
 *
 * `href={expr}` is deliberately not matched: `NotificationBell` and
 * `SearchCommand` route to whatever a notification or a search hit names, and
 * that destination is data, not a decision the shell made.
 */
const HREF_LITERAL = /\bhref\s*(:|=)\s*"(\/[^"]*)"/g

/**
 * Destinations a shell hard-codes, and the files that were read for them.
 *
 * The catalog is not the only thing that puts a link in the tenant menu, and a
 * destination written into the chrome is subject to the same rule as one a
 * manifest contributes.
 *
 * Read over `shellFiles`, not `SHELLS.modules`: the layout is a shell file too.
 * `apps/web/src/app/(app)/layout.tsx` renders `<SideNav/>` and the console's
 * root layout renders `<Nav/>`, so the layout is where a link added "to the
 * shell" most plausibly lands, and scanning only the components it mounts would
 * not look there. `scanned` is returned so the floor can assert that.
 */
function hardcodedDestinations(app) {
  const scanned = shellFiles(app)
  const destinations = []
  for (const file of scanned) {
    for (const match of code(file).matchAll(HREF_LITERAL)) {
      destinations.push({ file, href: match[2], syntax: match[1] === ":" ? "property" : "attribute" })
    }
  }
  return { scanned, destinations }
}

// ── floors ──────────────────────────────────────────────────────────────────

test("the survey reaches both applications, their shells, their routes and the menus", () => {
  assert.ok(
    APPS.length >= 2,
    `Found ${APPS.length} application source root(s) under apps/, expected at least 2. Every ` +
      `assertion below is an absence, and one application cannot leak into itself — a survey that ` +
      `finds one app reports a perfectly separated repository.`,
  )
  assert.deepEqual(
    APPS.map((a) => a.name).sort(),
    [OPERATOR, TENANT],
    "the tenant application and the operator console are not the two apps this file names",
  )

  for (const app of APPS) {
    const files = gitFiles(app.root).filter((f) => SOURCE.test(f))
    assert.ok(files.length >= 10, `${app.root} yielded ${files.length} source files — the scan stopped reading it`)

    const shell = SHELLS.get(app.name)
    assert.ok(shell.layouts.length >= 1, `${app.name} has no layout, so its shell graph is empty`)
    assert.ok(
      shell.modules.length >= 3,
      `${app.name}'s shell graph is ${shell.modules.length} module(s). A collapsed graph makes the ` +
        `convergence check below vacuous.`,
    )
  }

  // The two navigations the requirement is about, each inside its own app's
  // shell. If either stops being reachable from its layout, the property still
  // holds for whatever is left, which is not the property.
  assert.ok(
    SHELLS.get(TENANT).modules.includes("apps/web/src/components/shell/SideNav.tsx"),
    "the tenant navigation is not reachable from apps/web's layouts",
  )
  assert.ok(
    SHELLS.get(OPERATOR).modules.includes("apps/system-studio/src/components/Nav.tsx"),
    "the operator navigation is not reachable from apps/system-studio's layout",
  )

  // (4) surveys directories and classifies files, and both halves fail open:
  // no surveyed root means nothing is scanned, and a detector that recognises
  // nothing reports every file as pure data. So the roots are counted, and the
  // detector is made to classify the two navigations this whole file is about
  // — plus one file it must NOT flag, because a detector that answers "yes" to
  // everything would satisfy the first two assertions and refuse the repository.
  assert.ok(
    SHARED_ROOTS.length >= 8,
    `${SHARED_ROOTS.length} first-party workspace(s) outside apps/ found, expected at least 8 — ` +
      `the workspace map is not being read, and an empty survey clears (4a) by default`,
  )
  for (const root of SHARED_ROOTS) {
    assert.ok(!root.startsWith("apps/"), `${root} is an application and must not be surveyed as a shared workspace`)
  }
  for (const component of ["apps/web/src/components/shell/SideNav.tsx", "apps/system-studio/src/components/Nav.tsx"]) {
    assert.ok(uiEvidence(component), `the component detector does not recognise ${component} as a component`)
  }
  assert.equal(
    uiEvidence(MANIFESTS),
    null,
    `the component detector flags ${MANIFESTS}, which is pure data — a detector that says yes to ` +
      `everything refuses the repository instead of guarding it`,
  )

  assert.ok(ROUTES.get(TENANT).size >= 20, `${ROUTES.get(TENANT).size} tenant routes found, expected at least 20`)
  assert.ok(ROUTES.get(OPERATOR).size >= 4, `${ROUTES.get(OPERATOR).size} console routes found, expected at least 4`)

  const menu = tenantMenu()
  assert.ok(
    menu.length >= 8,
    `Parsed ${menu.length} nav entries out of ${MANIFESTS}, expected at least 8. The reader is ` +
      `broken, not the manifests — and a broken reader reports every destination as fine.`,
  )
  assert.ok(
    menu.every((entry) => entry.id && entry.href),
    "a parsed nav entry is missing its id or its href",
  )

  // The catalog is only half of (3). The other half reads destinations out of
  // the shells themselves, and it fails open twice over: a regex that stops
  // matching one of the two syntaxes silently drops every link written that
  // way, and a file set that omits the layouts never looks where a link added
  // "to the shell" most plausibly lands. Both are asserted against files that
  // exist, so the reader cannot go quiet without reddening.
  const tenantShell = hardcodedDestinations(APPS.find((a) => a.name === TENANT))
  for (const layout of SHELLS.get(TENANT).layouts) {
    assert.ok(
      tenantShell.scanned.includes(layout),
      `${layout} is not among the files scanned for hard-coded destinations. The layout is where ` +
        `<SideNav/> is mounted, so it is where a link added to the chrome lands.`,
    )
  }
  for (const syntax of ["property", "attribute"]) {
    const example = tenantShell.destinations.find((d) => d.syntax === syntax)
    assert.ok(
      example,
      `no ${syntax}-syntax destination was read out of the tenant shell. SideNav pins ` +
        `\`href: "/settings"\` and ShellHeader links \`href="/dashboard"\` and \`href="/inbox"\` — ` +
        `one of the two forms has stopped being matched, and links written that way are now ` +
        `invisible to both checks below.`,
    )
  }

  // The ownership map is read as text (see the header). A reader that stopped
  // reading would return no control-plane paths and clear property 3 by default.
  assert.ok(
    CONTROL_PLANE.owned.length >= 5,
    `the control-plane domain parsed out of tools/ownership-map.mjs owns ${CONTROL_PLANE.owned.length} ` +
      `path(s), expected at least 5 — the reader has stopped reading it`,
  )
  for (const expected of ["/platform", "/tenants", "/api/platform"]) {
    assert.ok(
      CONTROL_PLANE.destinations.includes(expected),
      `${expected} is not among the derived control-plane destinations ` +
        `(${CONTROL_PLANE.destinations.join(", ")}). The requirement names it explicitly.`,
    )
  }
})

// ── (1) the two applications do not import each other ───────────────────────

test("no file in one application imports another application", () => {
  const rootOf = new Map(APPS.map((app) => [app.root, app]))
  const violations = []

  for (const app of APPS) {
    for (const file of gitFiles(app.root).filter((f) => SOURCE.test(f))) {
      for (const spec of specifiers(file)) {
        const resolved = resolveSpecifier(file, spec, app.root)
        if (!resolved) continue
        for (const [root, other] of rootOf) {
          if (other.name === app.name) continue
          if (resolved.startsWith(`${root}/`) || resolved === root) {
            violations.push(`${file} imports ${spec} (${other.name})`)
          }
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `one application reaches into another:\n  ${violations.join("\n  ")}\n\n` +
      `The tenant product and the deployer console are separate shells (TTES-000-002). A shared ` +
      `import is how they stop being separate — by a relative path out of src/, or by the other ` +
      `app's workspace name.`,
  )
})

// ── (2) the two shells cannot converge on one file ──────────────────────────

test("no shell component imports a first-party module outside its own application", () => {
  const violations = []

  for (const app of APPS) {
    for (const file of SHELLS.get(app.name).modules) {
      for (const spec of specifiers(file)) {
        const resolved = resolveSpecifier(file, spec, app.root)
        if (resolved === null) continue // third-party: react, next, react-aria-components
        if (resolved.startsWith(`${app.root}/`)) continue
        violations.push(`${file} imports ${spec} → ${resolved}`)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `a shell component depends on a module outside its own application:\n  ${violations.join("\n  ")}\n\n` +
      `This is the leak the app-to-app check above cannot see. A shell primitive published from ` +
      `packages/ would let the tenant navigation and the operator navigation render through one ` +
      `file, and from there a single edit changes both — which is exactly the pattern leakage ` +
      `TTES-000-002 forbids. No package ships a .tsx today; this is what keeps that true.`,
  )
})

// ── (4) a component cannot be defined where both shells could reach it ──────

test("no first-party workspace outside the applications defines a component", () => {
  const offenders = []
  let scanned = 0

  for (const root of SHARED_ROOTS) {
    for (const file of gitFiles(root).filter((f) => SOURCE.test(f))) {
      scanned += 1
      const why = uiEvidence(file)
      if (why) offenders.push(`${file} ${why}`)
    }
  }

  assert.ok(
    scanned >= 100,
    `scanned ${scanned} file(s) across ${SHARED_ROOTS.length} shared workspace(s), expected at ` +
      `least 100 — git is not listing them, and nothing scanned is nothing refused`,
  )

  assert.deepEqual(
    offenders,
    [],
    `a workspace outside the applications defines a component:\n  ${offenders.join("\n  ")}\n\n` +
      `Surveyed: ${SHARED_ROOTS.join(", ")}. Shared packages carry data, types and rules; the ` +
      `moment one carries chrome, the tenant product and the deployer console can render through ` +
      `the same file and a single edit changes both — the pattern leakage TTES-000-002 forbids. ` +
      `This is what the app-to-app check cannot see: a shared shell is nobody's app.`,
  )
})

test("no application shell reaches a component defined outside its application", () => {
  const violations = []

  for (const app of APPS) {
    for (const file of shellFiles(app)) {
      for (const spec of specifiers(file)) {
        const resolved = resolveSpecifier(file, spec, app.root)
        if (resolved === null) continue // third-party: react, next, react-aria-components
        if (inside(resolved, app.root)) continue // its own application

        // Outside the app and outside every workspace (4a) surveys: a component
        // parked here would be invisible to the check above. `tools/`, a
        // top-level `shared/`, a relative path out of `src/` — all land here.
        if (!SHARED_ROOTS.some((root) => inside(resolved, root)) && !resolved.startsWith("apps/")) {
          violations.push(`${file} imports ${spec} → ${resolved}, which no survey covers`)
          continue
        }

        const target = moduleFile(resolved)
        const why = target && uiEvidence(target)
        if (why) violations.push(`${file} imports ${spec} → ${target}, which ${why}`)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `a shell file renders through a module defined outside its own application:\n  ` +
      `${violations.join("\n  ")}\n\n` +
      `Shell files are each app's layouts plus every component reachable from them. The layout is ` +
      `where both navigations are mounted — <SideNav/> in apps/web, <Nav/> in the console — so it ` +
      `is where a shared chrome import lands, and the component walk above it does not look there.`,
  )
})

// ── (3) neither menu names the other plane's destinations ───────────────────

test("every tenant menu destination is a route the tenant application serves", () => {
  const served = ROUTES.get(TENANT)
  const { destinations: hardcoded } = hardcodedDestinations(APPS.find((a) => a.name === TENANT))
  assert.ok(
    hardcoded.length >= 1,
    "the tenant shell hard-codes no destination at all, so half of this check reads nothing — " +
      "SideNav pins Settings itself, outside the catalog",
  )

  const broken = [
    ...tenantMenu()
      .filter((entry) => !served.has(entry.href))
      .map((entry) => `${entry.id} -> ${entry.href}`),
    ...hardcoded.filter(({ href }) => !served.has(href)).map(({ file, href }) => `${file} -> ${href}`),
  ]

  assert.deepEqual(
    broken,
    [],
    `the tenant menu points somewhere apps/web does not serve:\n  ${broken.join("\n  ")}\n\n` +
      `A destination the tenant shell cannot render is either a page that was removed or a page ` +
      `that lives in the other application.`,
  )
})

test("no tenant menu destination is a control-plane destination", () => {
  const offenders = []
  for (const entry of tenantMenu()) {
    for (const prefix of CONTROL_PLANE.destinations) {
      if (under(entry.href, prefix)) offenders.push(`${entry.id} -> ${entry.href} (under ${prefix})`)
    }
  }
  for (const { file, href } of hardcodedDestinations(APPS.find((a) => a.name === TENANT)).destinations) {
    for (const prefix of CONTROL_PLANE.destinations) {
      if (under(href, prefix)) offenders.push(`${file} hard-codes ${href} (under ${prefix})`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `the tenant menu offers an operator destination:\n  ${offenders.join("\n  ")}\n\n` +
      `Control-plane destinations here are ${CONTROL_PLANE.destinations.join(", ")} — the console's ` +
      `own route segments, plus the paths tools/ownership-map.mjs gives the control-plane domain ` +
      `inside apps/web. Bible §4.2 forbids a hidden super-admin route in the customer application; ` +
      `an entry in the customer's own menu is that route with a signpost.`,
  )
})

test("every operator console destination belongs to the console", () => {
  const consoleRoutes = ROUTES.get(OPERATOR)
  const tenantOnly = new Set(
    [...ROUTES.get(TENANT)].map(topSegment).filter((segment) => segment !== "/" && !consoleRoutes.has(segment)),
  )
  assert.ok(
    tenantOnly.has("/dashboard") && tenantOnly.has("/orgs"),
    `tenant-only segments came back as {${[...tenantOnly].join(", ")}} — without them this check ` +
      `has nothing to refuse`,
  )

  const { destinations: entries } = hardcodedDestinations(APPS.find((a) => a.name === OPERATOR))
  assert.ok(
    entries.length >= 3,
    `parsed ${entries.length} destination(s) out of the console's shell, expected at least 3`,
  )

  const offenders = []
  for (const { file, href } of entries) {
    if (!consoleRoutes.has(href)) offenders.push(`${file}: ${href} is not a route the console serves`)
    if (tenantOnly.has(topSegment(href))) offenders.push(`${file}: ${href} is a tenant destination`)
  }

  assert.deepEqual(
    offenders,
    [],
    `the operator console's navigation leaves the control plane:\n  ${offenders.join("\n  ")}\n\n` +
      `The console and the tenant product are separate origins as well as separate shells (PD-007). ` +
      `A console menu entry pointing into the customer application is a link nobody can follow and ` +
      `a pattern that invites merging the two.`,
  )
})

// ── (5) the navigation and the routes are the same set, both ways ───────────

const NAV = "apps/system-studio/src/components/Nav.tsx"
const REGISTER = "apps/system-studio/src/app/platform/diagnostics/page.tsx"
const PLATFORM_PAGE = "apps/system-studio/src/app/platform/page.tsx"
const BIBLE = "Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md"

/**
 * Walk `source` from `from`, skipping over string literals.
 *
 * Every scanner below counts brackets or braces, and every one of them is
 * looking at a file that declares the route `/tenants/[slug]`. A counter that
 * does not know it is inside a string closes the table on that row and reports
 * a register with one entry in it — which is a register that passes every
 * "everything listed exists" check by listing almost nothing.
 */
function scan(source, from, onChar) {
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1
        i += 1
      }
      continue
    }
    const stop = onChar(ch, i)
    if (stop !== undefined) return stop
  }
  return null
}

/**
 * The `[ ... ]` body of `export const NAME`, as source text, or `null`.
 *
 * The opening bracket is taken after the `=`, not after the name. Every one of
 * these tables is declared `export const NAME: readonly Row[] = [`, and the
 * first `[` in that line belongs to the TYPE — a scanner that takes it reads a
 * balanced, empty pair and reports a table with no rows, which passes "every
 * row you listed exists" by listing nothing. That is the failure this comment
 * exists because it actually happened.
 */
function tableSource(repoPath, name) {
  const text = code(repoPath)
  const declared = text.indexOf(`export const ${name}`)
  if (declared < 0) return null
  const assigned = text.indexOf("=", declared)
  if (assigned < 0) return null
  const open = text.indexOf("[", assigned)
  if (open < 0) return null

  let depth = 0
  return scan(text, open, (ch, i) => {
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
    return undefined
  })
}

/** The top-level `{ ... }` object literals in a region of source. */
function objectLiterals(source) {
  const out = []
  let depth = 0
  let start = -1
  scan(source, 0, (ch, i) => {
    if (ch === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) out.push(source.slice(start + 1, i))
    }
    return undefined
  })
  return out
}

const field = (body, key) => new RegExp(`\\b${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(body)?.[1] ?? null

function stringList(body, key) {
  const match = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(body)
  if (!match) return null
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])
}

/**
 * The navigation, as `{ domain, tail, entries: [{ href, label }] }`.
 *
 * Read out of the source rather than imported: `Nav.tsx` is a client component
 * written in TypeScript, and this runner is `node --test` with neither a React
 * nor a TypeScript loader.
 */
function navigation() {
  const table = tableSource(NAV, "GROUPS")
  if (!table) return []
  return objectLiterals(table).map((groupBody) => ({
    domain: field(groupBody, "domain"),
    tail: /\btail:\s*true\b/.test(groupBody),
    entries: objectLiterals(groupBody)
      .filter((entryBody) => /\bhref:\s*"/.test(entryBody))
      .map((entryBody) => ({ href: field(entryBody, "href"), label: field(entryBody, "label") })),
  }))
}

const NAV_GROUPS = navigation()
const NAV_ENTRIES = NAV_GROUPS.flatMap((group) => group.entries)

/** The Bible's own left-navigation domain list, in the Bible's own order. */
function bibleDomains() {
  const line = /^-\s*Left navigation:\s*(.+)$/m.exec(fs.readFileSync(abs(BIBLE), "utf8"))
  if (!line) return []
  return line[1]
    .replace(/\.\s*$/, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

const BIBLE_DOMAINS = bibleDomains()

/** A table on the Diagnostics register, as plain objects. */
function register(name, keys) {
  const table = tableSource(REGISTER, name)
  if (!table) return []
  return objectLiterals(table).map((body) => {
    const row = {}
    for (const key of keys) row[key] = key === "covered" ? stringList(body, key) : field(body, key)
    return row
  })
}

const QUARANTINED = register("QUARANTINED", ["route", "what", "unfinished", "covered"])
const UNLINKED = register("UNLINKED", ["route", "reason"])
const PLATFORM_PANELS = register("PLATFORM_PANELS", ["headline", "what", "covered"])

/**
 * The headline of every `<Card>` on `/platform`, in order.
 *
 * Anchored on the element rather than on indentation, because a reformat is not
 * a defect and a guard that reds on one gets deleted. The first `headline="…"`
 * after a `<Card` is that card's own: the `<EmptyState headline="…">` a card
 * renders when it has no rows comes later in the source than the card's opening
 * tag, so it is never the first match.
 */
function cardHeadlines(repoPath) {
  const text = code(repoPath)
  const out = []
  for (const match of text.matchAll(/<Card\b/g)) {
    const headline = /headline=\{?"([^"]*)"/.exec(text.slice(match.index))
    if (headline) out.push(headline[1])
  }
  return out
}

/**
 * The refusal branch, which is a state and not a panel.
 *
 * `/platform` returns a single "Not configured" card instead of the page when
 * `operatorConfigProblems()` is non-empty. Excluded by name rather than by
 * position so that the exclusion is one line somebody can argue with.
 */
const NOT_A_PANEL = new Set(["Not configured"])

test("the information-architecture readers reach every declaration they check", () => {
  assert.ok(
    NAV_GROUPS.length >= 8,
    `parsed ${NAV_GROUPS.length} navigation group(s) out of ${NAV}, expected at least 8 — the ` +
      `reader has stopped reading, and an empty navigation satisfies every check below by default`,
  )
  assert.ok(
    NAV_ENTRIES.length >= 12,
    `parsed ${NAV_ENTRIES.length} navigation entr(ies) out of ${NAV}, expected at least 12`,
  )
  for (const group of NAV_GROUPS) {
    assert.ok(group.domain, `a navigation group parsed with no domain name out of ${NAV}`)
    assert.ok(group.entries.length >= 1, `the ${group.domain} group parsed with no entries`)
    for (const entry of group.entries) {
      assert.ok(entry.href && entry.label, `an entry in the ${group.domain} group is missing its href or label`)
    }
  }

  assert.ok(
    BIBLE_DOMAINS.length >= 15,
    `parsed ${BIBLE_DOMAINS.length} domain(s) out of the Bible's section 7.2 left-navigation line, ` +
      `expected at least 15 — without it the order check below compares against nothing`,
  )
  for (const expected of ["Fleet", "AWS", "Marketplace"]) {
    assert.ok(BIBLE_DOMAINS.includes(expected), `${expected} is not among the parsed Bible domains`)
  }

  assert.ok(QUARANTINED.length >= 1, `parsed ${QUARANTINED.length} quarantined route(s) out of ${REGISTER}`)
  assert.ok(UNLINKED.length >= 1, `parsed ${UNLINKED.length} unlinked route(s) out of ${REGISTER}`)
  assert.ok(
    PLATFORM_PANELS.length >= 10,
    `parsed ${PLATFORM_PANELS.length} panel(s) out of ${REGISTER}, expected at least 10`,
  )
  assert.ok(
    UNLINKED.some((row) => row.route === "/tenants/[slug]"),
    `/tenants/[slug] did not survive the parse of ${REGISTER}. It is the row that proves the scanner ` +
      `is string-aware: a bracket counter that reads it as markup truncates the table there.`,
  )
  for (const row of [...QUARANTINED, ...UNLINKED]) {
    assert.ok(row.route, `a register row parsed with no route out of ${REGISTER}`)
  }
  for (const row of UNLINKED) {
    assert.ok(
      (row.reason ?? "").length >= 40,
      `${row.route} is declared unlinked with a ${(row.reason ?? "").length}-character reason. ` +
        `"n/a" is how this table becomes a way to hide a route rather than a way to declare one.`,
    )
  }
  for (const row of QUARANTINED) {
    assert.ok(
      (row.unfinished ?? "").length >= 40 && Array.isArray(row.covered),
      `${row.route} is quarantined without saying what is unfinished about it, or without a covered list`,
    )
  }
  for (const row of PLATFORM_PANELS) {
    assert.ok(row.headline && (row.what ?? "").length >= 20, `a panel row is missing its headline or its description`)
    assert.ok(Array.isArray(row.covered), `panel "${row.headline}" has no covered list`)
  }

  const headlines = cardHeadlines(PLATFORM_PAGE)
  assert.ok(
    headlines.length >= 10,
    `read ${headlines.length} card headline(s) out of ${PLATFORM_PAGE}, expected at least 10 — ` +
      `nothing read is nothing to disagree with`,
  )
  assert.ok(
    headlines.some((headline) => NOT_A_PANEL.has(headline)),
    `the refusal card is no longer among ${PLATFORM_PAGE}'s headlines, so the exclusion below is ` +
      `hiding something else now`,
  )
})

test("the console's navigation groups are the Bible's domains, in the Bible's order", () => {
  const tails = NAV_GROUPS.filter((group) => group.tail)
  assert.equal(
    tails.length,
    1,
    `${tails.length} navigation group(s) are marked as the tail (${tails.map((g) => g.domain).join(", ")}). ` +
      `Exactly one group is the quarantine, and it is the whole mechanism: everything before it is a ` +
      `finished operator surface.`,
  )
  assert.equal(
    NAV_GROUPS[NAV_GROUPS.length - 1].domain,
    tails[0].domain,
    `the quarantine group "${tails[0].domain}" is not last in the navigation. "Behind the LAST tab" is ` +
      `the requirement; a quarantine in the middle of the row is the construction site again.`,
  )
  assert.ok(
    !BIBLE_DOMAINS.includes(tails[0].domain),
    `"${tails[0].domain}" is one of the Bible's operator domains, so it must not be the quarantine — ` +
      `the last group is named for what it holds, not for a domain this console serves.`,
  )

  const operatorGroups = NAV_GROUPS.filter((group) => !group.tail).map((group) => group.domain)
  const foreign = operatorGroups.filter((domain) => !BIBLE_DOMAINS.includes(domain))
  assert.deepEqual(
    foreign,
    [],
    `navigation group(s) named nothing in the Bible: ${foreign.join(", ")}\n\n` +
      `Section 7.2 names the domains this console is for — ${BIBLE_DOMAINS.join(", ")}. A group named ` +
      `anything else is a taste argument, which is exactly what the flat eight-tab row was.`,
  )

  const positions = operatorGroups.map((domain) => BIBLE_DOMAINS.indexOf(domain))
  const sorted = [...positions].sort((left, right) => left - right)
  assert.deepEqual(
    positions,
    sorted,
    `the navigation's groups are not in the Bible's order.\n  navigation: ${operatorGroups.join(", ")}\n` +
      `  Bible 7.2:  ${BIBLE_DOMAINS.join(", ")}\n\n` +
      `The order is the Bible's, so that the same list read twice is the same list.`,
  )
})

test("every route the console serves is a navigation entry or a declared unlinked route", () => {
  const served = ROUTES.get(OPERATOR)
  const linked = new Set(NAV_ENTRIES.map((entry) => entry.href))
  const unlinked = new Set(UNLINKED.map((row) => row.route))

  assert.ok(served.size >= 12, `${served.size} console routes found, expected at least 12`)
  assert.ok(linked.size >= 12, `${linked.size} navigation destination(s), expected at least 12`)

  const unreachable = [...served].filter((route) => !linked.has(route) && !unlinked.has(route)).sort()
  assert.deepEqual(
    unreachable,
    [],
    `these routes are served by the console and appear in no navigation:\n  ${unreachable.join("\n  ")}\n\n` +
      `A surface no operator can find is a surface that was not shipped. Either add it to GROUPS in ` +
      `${NAV}, in its Bible domain and in the Bible's order, or declare it in UNLINKED on ` +
      `${REGISTER} with the reason it is reached from somewhere else.`,
  )

  const stale = [...unlinked].filter((route) => !served.has(route)).sort()
  assert.deepEqual(
    stale,
    [],
    `these routes are declared "intentionally unlinked" and the console does not serve them:\n  ` +
      `${stale.join("\n  ")}\n\nA stale row is how the table above stops being a declaration and ` +
      `becomes a wildcard: a route deleted and left declared excuses the next route with the same path.`,
  )

  const both = [...unlinked].filter((route) => linked.has(route)).sort()
  assert.deepEqual(
    both,
    [],
    `these routes are both a navigation entry and declared unlinked:\n  ${both.join("\n  ")}\n\n` +
      `The register says an operator reaches them from somewhere else and the navigation says it links ` +
      `them. One of the two is wrong, and a reader cannot tell which.`,
  )
})

test("the Diagnostics register is exactly what the last navigation group holds", () => {
  const tail = NAV_GROUPS.find((group) => group.tail)
  assert.ok(tail, "no navigation group is marked as the tail")

  const quarantined = [...tail.entries.map((entry) => entry.href)].sort()
  const registered = [...QUARANTINED.map((row) => row.route)].sort()

  assert.deepEqual(
    registered,
    quarantined,
    `the Diagnostics register and the Diagnostics group disagree.\n  navigation: ${quarantined.join(", ")}\n` +
      `  register:   ${registered.join(", ")}\n\n` +
      `The whole mechanism is that unfinished work moves behind the last group. A quarantine that does ` +
      `not say what it is holding is a drawer, and a register naming something the navigation does not ` +
      `quarantine is a page about a console that does not exist.`,
  )

  const served = ROUTES.get(OPERATOR)
  const missing = registered.filter((route) => !served.has(route))
  assert.deepEqual(missing, [], `the register names route(s) the console does not serve: ${missing.join(", ")}`)

  const claims = [...QUARANTINED, ...PLATFORM_PANELS].flatMap((row) =>
    (row.covered ?? []).map((route) => ({ row: row.route ?? row.headline, route })),
  )
  assert.ok(claims.length >= 5, `${claims.length} supersession claim(s) parsed, expected at least 5`)
  const dangling = claims.filter((claim) => !served.has(claim.route)).map((c) => `${c.row} -> ${c.route}`)
  assert.deepEqual(
    dangling,
    [],
    `the register says these are now answered somewhere the console does not serve:\n  ${dangling.join("\n  ")}`,
  )
})

test("the Diagnostics register describes the panels /platform actually renders", () => {
  const rendered = cardHeadlines(PLATFORM_PAGE).filter((headline) => !NOT_A_PANEL.has(headline))
  const described = PLATFORM_PANELS.map((row) => row.headline)

  const undescribed = rendered.filter((headline) => !described.includes(headline)).sort()
  assert.deepEqual(
    undescribed,
    [],
    `these panels are on ${PLATFORM_PAGE} and the register does not say what they are:\n  ` +
      `${undescribed.join("\n  ")}\n\nThe register is what justifies keeping the page behind the last ` +
      `group, panel by panel. A panel nobody classified is a panel nobody decided was diagnostic.`,
  )

  const phantom = described.filter((headline) => !rendered.includes(headline)).sort()
  assert.deepEqual(
    phantom,
    [],
    `the register describes panels ${PLATFORM_PAGE} does not render:\n  ${phantom.join("\n  ")}\n\n` +
      `Renamed or removed. Either way an operator reading the register is reading about a page that is ` +
      `not there — which is how a document that was true once becomes a document nobody trusts.`,
  )
})
