import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-033-001 — the operator plane is a separate application, and stays one.
 *
 * Bible §4.2: "The operator plane is a separate privileged surface for Tenure
 * staff… It is **not a hidden 'super admin' route in the customer
 * application**."
 *
 * The separation exists — `apps/system-studio` is its own app, own origin, own
 * deploy — and it had one hole. `/api/platform/export/[slug]` authenticated
 * with `auth()` plus `isPlatformOperator(session.user.email)`: a browser
 * session on the TENANT origin that could dump any tenant in the fleet.
 *
 * Nothing about that route was careless. It returned 404 rather than 403, it
 * ran the export inside the tenant's own scope, and its comments reasoned about
 * leaks. It was simply on the wrong side of a boundary, which is the kind of
 * thing review does not catch and a grep does.
 *
 * ## What this guard actually asserts
 *
 * Not "no privileged code in apps/web" — the cell holds the tenant's data and
 * some of what it does is privileged. The rule is narrower and checkable:
 * **no route in the customer application decides authority from an operator
 * identity.** A cell endpoint that the control plane calls authenticates the
 * CALLER as a service; one that reads `isPlatformOperator` off a session has
 * put a fleet-wide power behind a customer's login.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

function grep(pattern, ...paths) {
  try {
    return execFileSync("git", ["grep", "-lE", "--untracked", pattern, "--", ...paths], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !/\.(test|itest|spec)\.[cm]?[jt]sx?$/.test(f))
  } catch (err) {
    if (err.status !== 1) throw err
    return []
  }
}

test("no route in the customer application gates on an operator identity", () => {
  // The whole rule. `isPlatformOperator` is the only function that answers
  // "is this person Tenure staff" inside apps/web, so a route consulting it is
  // a route deciding fleet authority from a tenant session.
  //
  // Matches USE, not mention: an import from the operator module, or a call.
  // The first version matched the bare name and fired on the export route's own
  // comment explaining what it used to do — and a guard that fires on
  // documentation is one people satisfy by deleting the explanation.
  const routes = grep(
    '(from "@/lib/platform/operator"|isPlatformOperator\\()',
    "apps/web/src/app/*",
  )

  assert.deepEqual(
    routes,
    [],
    `these decide authority from an operator identity inside the customer application:\n` +
      routes.map((f) => `  ${f}`).join("\n") +
      `\n\nBible §4.2 forbids a hidden super-admin route in the customer app. A cell endpoint ` +
      `the control plane needs should authenticate the CALLER as a service — see ` +
      `api/platform/reconcile and api/platform/export for the pattern — so that no browser ` +
      `session, however privileged its owner, can reach a fleet-wide power.`,
  )
})

test("every platform route authenticates a caller, not a session", () => {
  // `/api/platform/*` is the control-plane-to-cell surface. Each must read a
  // shared secret; none may call `auth()`.
  const dir = path.join(ROOT, "apps/web/src/app/api/platform")
  const routes = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") routes.push(full)
    }
  }
  walk(dir)

  assert.ok(routes.length >= 2, "expected at least the reconcile and export routes")

  for (const route of routes) {
    const source = fs.readFileSync(route, "utf8")
    const relative = path.relative(ROOT, route).replace(/\\/g, "/")

    assert.ok(
      /process\.env\.PLATFORM_\w+_SECRET/.test(source),
      `${relative} does not read a PLATFORM_*_SECRET. A control-plane endpoint authenticates the ` +
        `caller as a service; anything else puts a fleet power behind somebody's login.`,
    )
    assert.ok(
      !/\bawait auth\(\)/.test(source),
      `${relative} calls auth(). A platform route must not depend on a customer-app session — ` +
        `that is what made the export route a hidden super-admin route.`,
    )
  }
})

test("secrets are compared in constant time, and not by ===", () => {
  // A plain `===` on a secret leaks its length and its prefix through timing.
  // Both platform routes hash to a fixed width first, because `timingSafeEqual`
  // throws on a length mismatch and the throw would leak the length itself.
  const dir = path.join(ROOT, "apps/web/src/app/api/platform")
  const routes = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") routes.push(full)
    }
  }
  walk(dir)

  for (const route of routes) {
    const source = fs.readFileSync(route, "utf8")
    const relative = path.relative(ROOT, route).replace(/\\/g, "/")
    // A CALL, not the import. Replacing the comparison body with `===` while
    // leaving the import in place passed the first version of this test — the
    // import line alone satisfied the match.
    assert.ok(
      /timingSafeEqual\(/.test(source),
      `${relative} imports or mentions timingSafeEqual but never calls it. A plain \`===\` on a ` +
        `secret leaks its length and its prefix through timing.`,
    )
  }
})

test("the operator console is a different application", () => {
  // The structural half. If these ever became one app, everything above would
  // still pass while the boundary had gone.
  for (const marker of ["apps/system-studio/package.json", "apps/web/package.json"]) {
    assert.ok(fs.existsSync(path.join(ROOT, marker)), `${marker} is missing`)
  }
  const studio = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/system-studio/package.json"), "utf8"))
  const web = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8"))
  assert.notEqual(studio.name, web.name, "the console and the customer app share a package name")
})
