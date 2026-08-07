/**
 * PACK-070-001 / PACK-000-004 — a module's UI contribution points at a route
 * the application actually serves.
 *
 * ## What was here before, and why it proved nothing
 *
 * `packages/platform-config/src/modules.test.ts` carried a case called "keeps
 * every href pointing at a route the app actually serves". It read:
 *
 *     const served = new Set(["/dashboard", "/orgs", "/feed", ...])
 *     for (const item of section.items) expect(served.has(item.href)).toBe(true)
 *
 * The set was written by hand, in the test, beside the manifests it was checking.
 * Deleting `apps/web/src/app/(app)/calendar/page.tsx` left it green, because the
 * literal still contained `/calendar`. It asserted that two lists somebody wrote
 * on the same afternoon agreed with each other, which is a thing that cannot be
 * wrong — and `modules/index.ts` cited it in a doc comment as the reason the
 * catalog's twelve `lifecycle: "available"` claims were falsifiable.
 *
 * ## What this does instead
 *
 * The served routes come from `tools/entry-point-inventory.mjs`, which lists
 * page files out of git (tracked AND untracked-but-not-ignored, so a route added
 * in this commit counts). Nothing in this file names a route. Delete a page and
 * the module claiming it fails here, by id and href.
 *
 * It lives under `tests/` rather than beside the package because a package test
 * runs inside `apps/web`'s jest, where reading the repository is out of scope by
 * design — these are the monorepo-level tests, which assert properties of the
 * repository itself.
 *
 * The manifests are TypeScript and this runner is plain node, so the hrefs are
 * read out of `modules/index.ts` as text. That is weaker than importing them,
 * and the floor assertions below are what keep a broken reader from reporting
 * "no violations": a parse that finds fewer than eight nav entries, or fewer
 * than twenty served pages, fails instead of passing emptily.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { collect } from '../../tools/entry-point-inventory.mjs'

const MANIFESTS = 'modules/index.ts'

/**
 * Routes `apps/web` serves, derived from the filesystem.
 *
 * `collect()` reports a page's route with its Next.js route groups still in it —
 * `/(app)/calendar` — because that is the on-disk path. A route group is
 * organisational and contributes nothing to the URL, so it is stripped here; a
 * nav entry says `/calendar` and that is what a browser asks for.
 */
function servedRoutes() {
  const routes = new Set()
  for (const page of collect().pages) {
    routes.add(page.route.replace(/\/\([^)]+\)/g, '') || '/')
  }
  return routes
}

/**
 * Every nav entry in the module catalog, as `{ id, href, action, riskClass }`.
 *
 * A nav entry is an object literal with no nested braces, so it can be taken
 * whole by matching innermost `{...}` blocks that declare an `id`. Taking the
 * whole body rather than scanning forward from `id:` is what stops a match
 * running past the end of one entry and reading the next entry's fields.
 *
 * A nav entry whose shape stops matching disappears from the survey rather than
 * failing it, which is what the count floor below is for.
 */
function declaredNavEntries() {
  const text = fs.readFileSync(MANIFESTS, 'utf8')
  const field = (body, name) => body.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`))?.[1]

  return [...text.matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1])
    .filter((body) => /\bid:\s*"[\w.]+"/.test(body) && /\bhref:\s*"/.test(body))
    .map((body) => ({
      id: field(body, 'id'),
      href: field(body, 'href'),
      action: field(body, 'action'),
      riskClass: field(body, 'riskClass'),
    }))
}

test('the reader finds the module catalog and the app routes', () => {
  const entries = declaredNavEntries()
  const served = servedRoutes()

  assert.ok(
    entries.length >= 8,
    `Parsed ${entries.length} nav entries out of ${MANIFESTS}; expected at least 8. The reader is ` +
      `broken, not the manifests — and a broken reader reports every href as fine.`
  )
  assert.ok(
    served.size >= 20,
    `Found ${served.size} served pages; expected at least 20. An empty route set would fail every ` +
      `href below, which would be a result about this function rather than about the manifests.`
  )
  // The route the whole check is named after, present before anything relies on it.
  assert.ok(served.has('/calendar'), 'The app no longer serves /calendar, or the reader is wrong.')
})

test('every module nav entry points at a page the app serves', () => {
  const served = servedRoutes()
  const broken = declaredNavEntries().filter((e) => !served.has(e.href))

  assert.deepEqual(
    broken.map((e) => `${e.id} -> ${e.href}`),
    [],
    'A module claims a surface the application does not serve. Either the page was removed and the ' +
      'manifest still advertises it, or the manifest was written ahead of the code — which is the ' +
      'false `Available` claim PACK-000-004 forbids.'
  )
})

/**
 * PACK-070-001 — a menu entry that ACTS declares what acting can do.
 *
 * Enforced in `validateManifest` too, so this is not the only guard; it is here
 * as well because that test builds its own fixtures, and this reads the twelve
 * manifests that actually ship.
 */
test('every command entry in the shipped catalog declares a risk class', () => {
  const commands = declaredNavEntries().filter((e) => e.action)

  assert.ok(
    commands.length >= 1,
    'No command entries found in the catalog, so this test asserts nothing. If the last one was ' +
      'removed, delete this test with it rather than leaving it green over nothing.'
  )

  assert.deepEqual(
    commands
      .filter((e) => !['read', 'write', 'irreversible'].includes(e.riskClass))
      .map((e) => `${e.id} (${e.action}) -> ${e.riskClass ?? 'none'}`),
    [],
    'A menu entry fires a command without saying whether acting reads, writes or cannot be undone.'
  )
})
