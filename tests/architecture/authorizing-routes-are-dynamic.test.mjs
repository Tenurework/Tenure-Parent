import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * A route that decides a permission must decide it per request.
 *
 * ## What happened
 *
 * `/platform/diagnostics` shipped without `export const dynamic = "force-dynamic"`.
 * Next therefore prerendered it at BUILD time, in a container holding no
 * `PLATFORM_OPERATORS` and no `AWS_ACCOUNT_ID`, so `operatorConfigProblems()`
 * returned problems and the "Not configured" branch was rendered into static
 * HTML. CloudFront then served that HTML to every visitor. The deployed console
 * answered `200` with "The Studio refuses to serve until its access control is
 * set up", while every sibling route answered `307` to the sign-in form.
 *
 * The visible half is a broken page. The quiet half is the one this guard is
 * for: a prerendered route runs no code at request time, so the
 * `authorizeCommand(...)` call beneath it never executed in production. An
 * authorization check on a static route is dead code shaped exactly like a
 * guard — it reads correct in review, in `tsc`, and in every unit test.
 *
 * ## Why nothing else caught it
 *
 * `tsc --noEmit` reported zero errors. The 599 platform guards passed. 7,149
 * unit tests passed. `npm run build` SUCCEEDED — it printed `○ /platform/diagnostics`
 * beside `ƒ` for every sibling, which is the whole story in one character, and
 * nothing was reading it. Driving the deployed URL is what found it.
 *
 * So this reads the same fact from the source rather than from build output: a
 * build log is not committed, and a guard that needs one cannot run before the
 * build it is meant to gate.
 *
 * ## The rule
 *
 * Every route under the Studio's `app/` that reaches an authorization or
 * configuration decision — `authorizeCommand`, `isOperator`, `auth()`, or
 * `operatorConfigProblems` — must declare `force-dynamic`. Routes that decide
 * nothing are free to be static, and `signin` is deliberately among them.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const APP = "apps/system-studio/src/app"

/** Calls that only mean something at request time. */
const DECIDES = [/\bauthorizeCommand\s*\(/, /\bisOperator\s*\(/, /\bauth\s*\(\s*\)/, /\boperatorConfigProblems\s*\(/]

const DYNAMIC = /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/

/** Source with comments stripped: prose about a call is not a call. */
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function routeFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", APP], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\/page\.tsx$/.test(f))
}

test("the survey finds the console's routes", () => {
  // Every assertion here is an absence, and an absence over an empty list is
  // not a finding. The console served 17 routes when this was written.
  const files = routeFiles()
  assert.ok(files.length >= 10, `found ${files.length} route files under ${APP} — the listing is broken, not the code`)

  const deciding = files.filter((f) => DECIDES.some((re) => re.test(code(f))))
  assert.ok(
    deciding.length >= 8,
    `only ${deciding.length} routes appear to decide anything — the detector has stopped matching`,
  )
})

test("the detector reads a real call and not a mention", () => {
  // Both halves, because a detector that matched everything and one that
  // matched nothing would each make the test below vacuous in its own way.
  assert.equal(
    DECIDES.some((re) => re.test('const decision = authorizeCommand("platform.read", { principalId })')),
    true,
  )
  assert.equal(DECIDES.some((re) => re.test("a page that calls nothing at all")), false)
  assert.equal(DYNAMIC.test('export const dynamic = "force-dynamic"'), true)
  assert.equal(DYNAMIC.test('export const dynamic = "auto"'), false)
})

test("every route that decides a permission is rendered per request", () => {
  const offenders = []

  for (const file of routeFiles()) {
    const source = code(file)
    if (!DECIDES.some((re) => re.test(source))) continue
    if (!DYNAMIC.test(source)) offenders.push(file)
  }

  assert.deepEqual(
    offenders,
    [],
    "These routes decide a permission and do not declare `export const dynamic = \"force-dynamic\"`:\n  " +
      offenders.join("\n  ") +
      "\nNext will prerender them at build time, in a container with no operator " +
      "environment. The decision then never runs in production and whatever the " +
      "build container happened to render is served to everybody. That is how " +
      "/platform/diagnostics shipped a baked \"Not configured\" page with a dead " +
      "authorization check underneath it.",
  )
})
