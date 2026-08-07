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
  // Tenant pages only. `collect()` covers both experiences since TTES-000-001,
  // and the Studio serves `/tenants`, `/platform` and `/signin` from a
  // DIFFERENT ORIGIN (PD-007) — a module nav href pointing at one of those is
  // a broken link in the product, not a served route. Counting them here would
  // have quietly widened the set this test refuses against, which is the
  // failure mode the header describes: an assertion that cannot be wrong.
  for (const page of collect().pages.filter((p) => p.experience === 'tenant')) {
    routes.add(page.route.replace(/\/\([^)]+\)/g, '') || '/')
  }
  return routes
}

/**
 * Every nav entry in the module catalog, as
 * `{ id, href, section, action, riskClass }`.
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
      section: field(body, 'section'),
      action: field(body, 'action'),
      riskClass: field(body, 'riskClass'),
    }))
}

/**
 * TTES-GATE-030 — the shape of the menu, not just the reachability of its links.
 *
 * The rest of this file asks whether each nav entry points somewhere real. It
 * cannot ask the question the gate is actually about: whether the menu stays
 * small enough to work in. Nine entries across five sections is navigable; the
 * failure mode is that nobody ever adds a tenth section, they add one entry and
 * one section at a time, each defensible on its own, until the side nav is a
 * directory of the platform.
 *
 * A closed vocabulary makes that an explicit decision. Adding a module to the
 * menu is fine; inventing a sixth place to put it is a product change about
 * information architecture, and it should cost a conversation and an edit here
 * rather than being a line in a manifest nobody reviews as navigation.
 *
 * Kept beside the served-routes check rather than in `validateManifest` on
 * purpose: this is a statement about the catalog that ships, not about what a
 * manifest is allowed to be. A tenant-specific pack authored outside this
 * repository has its own information architecture to answer for.
 */
const SECTIONS = ['Administration', 'Overview', 'Community', 'Operations', 'Knowledge']

/** How many entries one section may carry before it stops being scannable. */
const MAX_ENTRIES_PER_SECTION = 5

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

test('every nav entry is placed in one of the five declared sections', () => {
  const entries = declaredNavEntries()

  // The floor again, restated for this question rather than borrowed from the
  // test above: a reader that stopped finding `section:` would report an empty
  // list of strays and pass, which is the failure this file's header describes.
  const placed = entries.filter((e) => e.section)
  assert.ok(
    placed.length >= 8 && placed.length === entries.length,
    `Parsed ${placed.length} sectioned nav entries out of ${entries.length} total; expected at ` +
      `least 8 and every entry placed. Either an entry omits \`section\` — in which case it lands ` +
      `in an unlabelled block at the top of the menu — or the reader is broken.`
  )

  assert.deepEqual(
    [...new Set(placed.map((e) => e.section))].filter((s) => !SECTIONS.includes(s)).sort(),
    [],
    `A module invented a navigation section outside the declared vocabulary ` +
      `(${SECTIONS.join(', ')}). A new top-level section is a decision about the product's ` +
      `information architecture, not a field in a manifest: put the entry in an existing section, ` +
      `or change SECTIONS here and say why.`
  )
})

test('no navigation section carries more than five entries', () => {
  const counts = new Map()
  for (const entry of declaredNavEntries()) {
    counts.set(entry.section, (counts.get(entry.section) ?? 0) + 1)
  }

  assert.ok(
    counts.size >= 3,
    `Found ${counts.size} navigation sections; expected at least 3. A survey that found almost ` +
      `nothing would satisfy the budget below for the wrong reason.`
  )

  assert.deepEqual(
    [...counts]
      .filter(([, n]) => n > MAX_ENTRIES_PER_SECTION)
      .map(([section, n]) => `${section}: ${n}`)
      .sort(),
    [],
    `A navigation section exceeded ${MAX_ENTRIES_PER_SECTION} entries. This is the clutter budget ` +
      `TTES-GATE-030 is about: a menu grows one defensible entry at a time until it is a directory ` +
      `of the platform. Retire an entry, or move the new one behind the surface it belongs to.`
  )
})
