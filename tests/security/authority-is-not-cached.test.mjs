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
 * `tests/security/operator-plane-content.test.mjs` writes a probe file into the
 * Studio's source tree to prove its own grep matches something, and deletes it
 * again; every guard that enumerates and then reads has raced it. That produced
 * an ENOENT that looks exactly like a real guard failure and cost three
 * separate debugging sessions.
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
