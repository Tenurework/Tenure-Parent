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
 * ## The three properties
 *
 *   1. No file under one application's `src` imports anything under another's,
 *      by relative path or by workspace package name.
 *   2. No component reachable from an application's own layouts imports a
 *      first-party module outside that application. This is the one that stops
 *      the two navigations converging on a single file: a shared `packages/ui`
 *      shell would satisfy (1) and defeat the separation entirely.
 *   3. Every destination in the tenant menu is a route `apps/web` serves and is
 *      not a control-plane destination; and symmetrically, every destination in
 *      the operator console's navigation is a route the console serves and is
 *      not a tenant-only route.
 *
 * ## Floors
 *
 * Every assertion here is an absence, and an absence passes trivially when the
 * survey finds nothing. `the survey reaches both applications` fails when fewer
 * than two application source roots are found, when either app's shell graph
 * collapses, when fewer than eight nav entries parse out of the module catalog,
 * or when the route inventories come back empty — so a broken reader reds
 * instead of reporting a clean repository.
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
 * Destinations a shell component hard-codes.
 *
 * The catalog is not the only thing that puts a link in the tenant menu:
 * `SideNav` pins Settings at the bottom itself. A destination written into the
 * shell is subject to the same rule as one a manifest contributes.
 */
function hardcodedDestinations(app) {
  const found = []
  for (const file of SHELLS.get(app.name).modules) {
    for (const match of code(file).matchAll(/\bhref:\s*"(\/[^"]*)"/g)) found.push({ file, href: match[1] })
  }
  return found
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

// ── (3) neither menu names the other plane's destinations ───────────────────

test("every tenant menu destination is a route the tenant application serves", () => {
  const served = ROUTES.get(TENANT)
  const hardcoded = hardcodedDestinations(APPS.find((a) => a.name === TENANT))
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
  for (const { file, href } of hardcodedDestinations(APPS.find((a) => a.name === TENANT))) {
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

  const entries = hardcodedDestinations(APPS.find((a) => a.name === OPERATOR))
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
