import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-040-005 — access stops when the decision is made, not at the next login.
 *
 * Five triggers: membership suspension, identity connection disable, session
 * revoke, assignment end, authorization revision change. Only one is a clock
 * event; the rest are somebody deciding something, and every one of them makes
 * a session's snapshot of authority wrong while the token stays valid.
 *
 * `packages/identity/src/invalidation.ts` decides all five and is unit-tested.
 * What makes it *immediate* in the running application is something no unit
 * test can see: that authority is recomputed on every request rather than held
 * anywhere between them.
 *
 * `getUserContext` uses React's `cache()`, which is scoped to a single render
 * pass — deliberately, and this file is why it stays that way. The tempting
 * change is a module-level `Map` keyed by user id, because `getUserContext`
 * runs several times per request and caching it looks free. It is not free: it
 * converts every one of the five triggers from immediate into "immediate, once
 * the cache expires", and the window in which it has not expired is exactly the
 * window somebody suspended is trying to use.
 *
 * A revocation list has the same flaw for the same reason — it has to be
 * published to be true, and whatever publishes it is a job, a queue, or a TTL.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Modules that resolve or hold authority. */
const AUTHORITY_MODULES = ["apps/web/src/lib/rbac.ts", "apps/web/src/lib/identity", "packages/identity/src"]

function authorityFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...AUTHORITY_MODULES],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|itest)\.tsx?$/.test(file))

  assert.ok(listed.length > 0, "the authority module list matched no files — it has drifted")
  return listed
}

/**
 * Source with comments stripped, so prose about a thing is not a use of it.
 *
 * Returns "" for a file that has vanished. `git ls-files --others` lists
 * untracked files, and an untracked file can disappear between the listing and
 * the read — an editor, a build, or another guard in this same parallel run.
 * `tests/security/operator-plane-content.test.mjs` used to write a probe file
 * into the Studio's source tree to prove its own grep matched something, and
 * every guard that enumerates and then reads raced it — an ENOENT that looks
 * exactly like a real guard failure, and cost three separate debugging
 * sessions. That probe is gone and
 * `tests/architecture/guards-do-not-write-into-the-tree.test.mjs` keeps it
 * gone. The tolerance stays: the race was never only about that one file.
 *
 * A file that is gone has no content to check, so skipping it is correct as
 * well as convenient.
 */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const MODULE_LEVEL_STORE = /^(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*new\s+(?:Map|Set|WeakMap)\s*[(<]/gm
const TTL_CACHE = /\b(ttl|maxAge|expiresIn|revalidate)\s*[:=]\s*\d/i

/**
 * Module-level stores this file writes to, which makes them caches.
 *
 * The mutation is the whole test. `const CONNECTION_LIVE = new Set(["ACTIVE"])`
 * is an immutable lookup table and is fine; a `Map` something calls `.set()` on
 * is a cache whatever it is named. The first version of this guard flagged both
 * and would have been argued with rather than obeyed — which is how a guard
 * acquires an exemption list instead of a fix.
 *
 * Deliberately not a ban on the word "cache": React's `cache()` is the correct
 * tool and is what `rbac.ts` already uses.
 */
function mutableStores(text) {
  const found = []
  for (const match of text.matchAll(MODULE_LEVEL_STORE)) {
    const name = match[1]
    if (new RegExp(`\\b${name}\\s*\\.\\s*(set|add|delete|clear)\\s*\\(`).test(text)) found.push(name)
  }
  return found
}

test("no authority module keeps a store that outlives a request", () => {
  const offenders = []

  for (const file of authorityFiles()) {
    const text = code(file)
    for (const name of mutableStores(text)) {
      offenders.push(`${file} — module-level \`${name}\` is written to after construction`)
    }
    if (TTL_CACHE.test(text)) offenders.push(`${file} — time-based cache`)
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules resolve authority and hold state between requests:\n  ${offenders.join("\n  ")}\n` +
      `Every one of GE-040-005's five triggers becomes "immediate, once the cache expires", and that ` +
      `window is exactly the one a suspended person is trying to use. Use React's cache(), which is ` +
      `scoped to one render pass.`,
  )
})

test("the store detector can tell a lookup table from a cache", () => {
  // Asserted on the detector itself, because its failure mode is silence: a
  // regex that matches nothing reports every file as clean. The first version
  // had the opposite failure and flagged two immutable constants.
  assert.deepEqual(mutableStores('const LIVE = new Set(["ACTIVE"])'), [], "an immutable lookup table is not a cache")
  assert.deepEqual(
    mutableStores("const byUser = new Map()\nfunction f() { byUser.set(1, 2) }"),
    ["byUser"],
    "a module-level Map that is written to is a cache",
  )
})

test("getUserContext is memoised per request, not per process", () => {
  // The specific regression: swapping React's `cache()` for a module-level Map
  // keyed by user id. It looks free — `getUserContext` runs several times per
  // request — and it silently converts every trigger into a delayed one.
  const text = code("apps/web/src/lib/rbac.ts")

  assert.match(
    text,
    /import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/,
    "rbac.ts no longer imports React's cache — authority may now outlive a request",
  )
  assert.match(
    text,
    /export const getUserContext = cache\(/,
    "getUserContext is no longer wrapped in React's per-request cache",
  )
})

test("membership and seat reads resolve against the clock, not a stored flag", () => {
  // The other half of "immediate": even with no caching, a stored `isActive`
  // column would need a job to flip it, and the window before the job runs is
  // the same window. Both engines compute from the instant they are given.
  for (const name of ["effective-state.ts", "seats.ts"]) {
    const text = code(`packages/identity/src/${name}`)
    assert.match(text, /at:\s*Date/, `${name} no longer takes an instant — liveness cannot be computed from the clock`)
    assert.ok(
      !/\bisActive\b/.test(text),
      `${name} has an isActive flag, which is a second source of truth a missed job leaves wrong`,
    )
  }
})

test("every authority module path still exists", () => {
  for (const target of AUTHORITY_MODULES) {
    assert.ok(fs.existsSync(path.join(ROOT, target)), `${target} is guarded but does not exist`)
  }
})

/**
 * The other half of "a cache() memo does not outlive what it is about".
 *
 * The tests above are about TIME: authority must not survive the request it was
 * computed in. This one is about TENANT, and it is the same mistake made against
 * a different axis — `docs/architecture/REVIEW-FINDINGS.md:54`. A `React.cache()`
 * memo lives for the whole request; a tenant scope lives for a block; a request
 * may legitimately open two scopes. `viewerTimeZone` was keyed on `userId` alone
 * and read a TENANT_SCOPED `Organization`, so the first scope opened in a request
 * answered for every later one, and a two-institution staffer who switched
 * tenants saw their other campus's clock on every calendar surface.
 *
 * `tests/architecture/cache-does-not-cross-tenant-scopes.test.mjs` guards the
 * SIGNATURE — that a tenant-reading `cache()`d loader declares an institution.
 * That is not enough on its own and this is the gap it leaves: a caller can
 * satisfy the signature and still hand it the wrong institution.
 * `viewerTimeZone(userId, ctx.institutionRoles[0].institutionId)` type-checks,
 * passes that guard, and is the original defect verbatim. What has to be true is
 * that the argument comes from the OPEN SCOPE.
 */
const TENANT_KEYED_LOADERS = ["viewerTimeZone"]

/** Sources of an institution that are the acting tenant rather than a guess. */
const FROM_OPEN_SCOPE =
  /^(?:scope|tenantScope|s)\.institutionId$|^requireTenantScope\([^)]*\)\.institutionId$|^currentScope\(\)[!?]?\.institutionId$/

function callsInApp(loader) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps/web/src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|itest)\.tsx?$/.test(file))

  const calls = []
  for (const file of listed) {
    const text = code(file)
    // `import { viewerTimeZone }` is not a call; a `(` right after the name is.
    for (const match of text.matchAll(new RegExp(`\\b${loader}\\(`, "g"))) {
      const open = match.index + match[0].length - 1
      const args = splitArguments(text, open)
      if (args) calls.push({ file, args })
    }
  }
  return calls
}

/**
 * The arguments of a call whose `(` is at `open`, split on top-level commas.
 *
 * Scanned rather than matched with `[^)]*`, because an argument may itself
 * contain parentheses — `requireTenantScope('viewerTimeZone').institutionId` is
 * the shape the loader's own docblock offers to a caller with no `scope` in
 * hand, and a lazy regex truncates it to `requireTenantScope('viewerTimeZone'`,
 * which then fails the check for a reason that has nothing to do with the code.
 */
function splitArguments(text, open) {
  let depth = 0
  const args = []
  let current = ""
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if ("([{".includes(ch)) {
      depth += 1
      if (depth === 1) continue
    } else if (")]}".includes(ch)) {
      depth -= 1
      if (depth === 0) {
        args.push(current)
        return args.map((a) => a.trim()).filter((a, idx) => a !== "" || idx > 0)
      }
    }
    if (ch === "," && depth === 1) {
      args.push(current)
      current = ""
    } else current += ch
  }
  return null
}

test("every caller of a tenant-keyed loader takes the tenant from the open scope", () => {
  const offenders = []
  let total = 0

  for (const loader of TENANT_KEYED_LOADERS) {
    const calls = callsInApp(loader)
    assert.ok(
      calls.length > 0,
      `${loader} has no call sites in apps/web/src — either it was renamed and this guard now ` +
        `asserts nothing, or the production callers were deleted`,
    )
    total += calls.length

    for (const call of calls) {
      const institution = call.args[1]
      if (institution === undefined) {
        offenders.push(`${call.file} — ${loader}(${call.args.join(", ")}) names no institution at all`)
      } else if (!FROM_OPEN_SCOPE.test(institution)) {
        offenders.push(
          `${call.file} — ${loader}(..., ${institution}) does not take the institution from the open scope`,
        )
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these call sites pass a loader an institution they chose themselves:\n  ${offenders.join("\n  ")}\n` +
      `The acting tenant is the one \`withTenantScope\` resolved and validated against live ` +
      `membership — take it from the \`scope\` the callback is handed, or from ` +
      `\`requireTenantScope(...)\`. Deriving one from the viewer instead (\`institutionRoles[0]\`) ` +
      `is the defect REVIEW-FINDINGS.md:54 names: it ignores which tenant the user actually ` +
      `switched to, and it puts a value in the memo key that does not change when the scope does.`,
  )

  // Not a vacuous pass: the calendar, the new-event form and the feed all call
  // viewerTimeZone, so anything below three means call sites went missing rather
  // than the rule being satisfied everywhere.
  assert.ok(total >= 3, `only ${total} call site(s) checked across ${TENANT_KEYED_LOADERS.join(", ")}`)
})

test("a caller inside a tenant scope is what makes `scope.institutionId` available", () => {
  // `scope.institutionId` is only the acting tenant if `scope` is the argument
  // `withTenantScope` handed the callback. A file that passes `scope.institutionId`
  // while opening no scope has a local variable named `scope` and a guard that
  // believed it.
  const offenders = []

  for (const loader of TENANT_KEYED_LOADERS) {
    for (const call of callsInApp(loader)) {
      if (!/^(?:scope|tenantScope|s)\.institutionId$/.test(call.args[1] ?? "")) continue
      const text = code(call.file)
      if (!/withTenantScope\(/.test(text) && !/withSystemTenantScope\(/.test(text)) {
        offenders.push(`${call.file} — passes scope.institutionId but opens no tenant scope`)
      }
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n  "))
})
