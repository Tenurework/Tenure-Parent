/**
 * Every workspace package is in `package-lock.json`.
 *
 * `npm ci` — which is what CI, the Dockerfile and the Studio deploy all run —
 * refuses to install at all when the lock file does not name a workspace that
 * `package.json` globs in:
 *
 *     npm error `npm ci` can only install packages when your package.json and
 *     package-lock.json are in sync.
 *     npm error Missing: @tenure/payments@0.1.0 from lock file
 *
 * That is not a warning and not a slow build; it is the first step of every job
 * failing before a single test runs. On 2026-08-07 a cluster agent created
 * `packages/payments`, and because `npm install` had already linked it into the
 * local `node_modules`, the full local matrix passed — type-check, lint, 4110
 * unit tests, 308 platform tests, both builds, and both Playwright suites, 175
 * and 208. Every one of them green, and CI plus Deploy Studio both red on the
 * install step, because the local checks never run `npm ci`.
 *
 * A new package is exactly what this programme produces, so the gap is
 * structural rather than an accident. This closes it in the suite that runs
 * before a push instead of the pipeline that runs after one.
 *
 * Deliberately NOT a run of `npm ci --dry-run`: that needs a network and takes
 * seconds, and this suite has to stay runnable offline. The property is a
 * comparison of two files on disk, so it is checked as one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..')

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** Directories `package.json`'s `workspaces` globs actually resolve to. */
function workspaceDirs() {
  const { workspaces = [] } = read('package.json')
  const dirs = []
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) {
      if (fs.existsSync(path.join(ROOT, pattern, 'package.json'))) dirs.push(pattern)
      continue
    }
    const parent = pattern.slice(0, -2)
    const full = path.join(ROOT, parent)
    if (!fs.existsSync(full)) continue
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const rel = `${parent}/${entry.name}`
      if (fs.existsSync(path.join(ROOT, rel, 'package.json'))) dirs.push(rel)
    }
  }
  return dirs.sort()
}

test('the workspace globs still resolve, so a clean result means something', () => {
  // Every assertion below is "nothing is missing", which an empty list also
  // satisfies. This is what separates the two.
  const dirs = workspaceDirs()
  assert.ok(
    dirs.length >= 10,
    `Resolved ${dirs.length} workspaces, expected at least 10. The globs in package.json ` +
      `stopped matching and "no missing packages" would be vacuous.`,
  )
  assert.ok(
    dirs.includes('apps/web') && dirs.includes('apps/system-studio'),
    `The two applications are not among the resolved workspaces: ${dirs.join(', ')}`,
  )
})

test('package-lock.json names every workspace, so npm ci can install', () => {
  const lock = read('package-lock.json')
  const locked = lock.packages ?? {}

  const missing = workspaceDirs().filter((dir) => !(dir in locked))

  assert.deepEqual(
    missing,
    [],
    `package-lock.json does not name ${missing.length} workspace(s):\n  ${missing.join('\n  ')}\n` +
      `\`npm ci\` will refuse to install anything at all, so CI, the container build and the ` +
      `Studio deploy all fail on their first step — with every local check green, because ` +
      `none of them runs \`npm ci\`.\n` +
      `Fix: npm install --package-lock-only   (then commit package-lock.json)`,
  )
})

test('every workspace the lock names still exists', () => {
  // The other direction. A package that was deleted while its lock entry stayed
  // does not break `npm ci`, but it does mean the lock describes a repository
  // nobody has — and the next person to read it is misled about what ships.
  const lock = read('package-lock.json')
  const locked = Object.keys(lock.packages ?? {}).filter(
    (k) => k && !k.startsWith('node_modules/'),
  )

  const vanished = locked.filter((dir) => !fs.existsSync(path.join(ROOT, dir, 'package.json')))

  assert.deepEqual(
    vanished,
    [],
    `package-lock.json names ${vanished.length} workspace(s) that no longer exist:\n  ` +
      `${vanished.join('\n  ')}\nRun npm install --package-lock-only and commit the result.`,
  )
})
