/**
 * GE-000-004. The entry-point inventory is a document; these are its teeth.
 *
 * A generated document that nothing checks is a snapshot of the day it was
 * generated. Three properties are asserted instead:
 *
 *   1. the committed copy matches what the generator produces now,
 *   2. no route or page is reachable without a guard unless it is allowlisted,
 *   3. no server action is reachable without a guard unless it is allowlisted.
 *
 * (3) is the one that earns its place. Server actions do not appear in
 * `next build` output, a Next.js layout does not protect them, and each is a
 * POST endpoint. Adding an unguarded one is a single missing line in a file
 * where twenty neighbours have it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

import { collect, INTENTIONALLY_PUBLIC, PUBLIC_ACTIONS } from '../../tools/entry-point-inventory.mjs'

const DOC = 'docs/architecture/entry-points.md'

test('the committed entry-point inventory is not stale', () => {
  const result = execFileSync('node', ['tools/entry-point-inventory.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(result, /up to date/)
})

test('no API route or page is reachable without a guard, unless allowlisted', () => {
  const { apiRoutes, pages } = collect()

  const unguarded = [...apiRoutes, ...pages]
    .filter((e) => e.guards.length === 0)
    .map((e) => e.route)
    .filter((r) => !INTENTIONALLY_PUBLIC.has(r))

  assert.deepEqual(
    unguarded,
    [],
    `unguarded entry points. Add a guard, or add to INTENTIONALLY_PUBLIC with the reason:\n  ${unguarded.join('\n  ')}`
  )
})

test('no server action is reachable without a guard, unless allowlisted', () => {
  const { actions } = collect()

  const unguarded = actions
    .flatMap((a) => a.exported.map((fn) => ({ ...fn, module: a.route })))
    .filter((fn) => fn.guards.length === 0)
    .map((fn) => `${fn.module} → ${fn.name}`)
    .filter((id) => !PUBLIC_ACTIONS.has(id))

  assert.deepEqual(
    unguarded,
    [],
    `server actions anyone can POST to. A layout guard does NOT cover these:\n  ${unguarded.join('\n  ')}`
  )
})

test('every mutating server action proves a session, not merely a tenant', () => {
  // A tenant scope resolved from a user id is not authentication: it answers
  // "which tenant is this user in", having already assumed a user. An action
  // that reaches `withTenant` but never `auth()` would be scoped to whatever
  // principal it was handed.
  const { actions } = collect()

  const scopedButAnonymous = actions
    .flatMap((a) => a.exported.map((fn) => ({ ...fn, module: a.route })))
    .filter((fn) => fn.guards.includes('tenant') && !fn.guards.includes('session'))
    .map((fn) => `${fn.module} → ${fn.name}`)

  assert.deepEqual(scopedButAnonymous, [], 'tenant-scoped actions with no session check')
})

test('the allowlists have not grown silently', () => {
  // A guard removed from a route is a code review question. A route added to the
  // allowlist is the same question, asked where it is easier to miss.
  assert.equal(INTENTIONALLY_PUBLIC.size, 3, 'a new public entry point was allowlisted')
  assert.equal(PUBLIC_ACTIONS.size, 1, 'a new unguarded server action was allowlisted')
})

test('the document exists and names every API route', () => {
  const doc = fs.readFileSync(DOC, 'utf8')
  const { apiRoutes } = collect()
  for (const r of apiRoutes) {
    assert.ok(doc.includes(`\`${r.route}\``), `${DOC} does not mention ${r.route}`)
  }
})

test('the Studio ships the platform truth it renders, and it is current', () => {
  // The Studio's container ships apps/system-studio, not docs/. The page
  // therefore imports a generated JSON rather than reading the ledger from
  // disk — which would work locally and 500 in production.
  //
  // The cost of generating is that it can go stale, so the build fails when it
  // has. Without this the console would keep showing whatever was true on the
  // day someone last remembered to run the generator, which is worse than
  // showing nothing.
  const result = execFileSync('node', ['tools/platform-truth.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(result, /up to date/)
})
