/**
 * The cell must not depend on the engine.
 *
 * `apps/web` is a cell: it serves one tenant's users. `packages/provisioning` is
 * the engine's control plane, which composes and signs artifacts for every
 * tenant. A cell that imported it would be a cell that could, in principle,
 * mint its own deployment manifests — and the separation those two halves rely
 * on would be a convention rather than a boundary.
 *
 * The one permitted import is the cross-check test, which exists precisely to
 * prove the two independent digest implementations agree. That import is why
 * the path mapping exists at all, and this is what stops the mapping becoming a
 * doorway.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const ENGINE_ONLY = ['@tenure/provisioning']

/** Files that may import an engine-only package, with the reason. */
const ALLOWED = new Map([
  [
    'apps/web/src/lib/provisioning/reconcile.itest.ts',
    'cross-checks that the engine-signed digest verifies with the cell\'s own implementation',
  ],
])

test('no runtime file in the cell imports an engine-only package', () => {
  const files = execFileSync('git', ['ls-files', 'apps/web/src', 'apps/web/scripts'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

  const offenders = []
  for (const file of files) {
    if (ALLOWED.has(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const pkg of ENGINE_ONLY) {
      // An actual import, not the package name appearing in prose. reconcile.ts
      // names it in a comment explaining that its own interface is structurally
      // identical — which is documentation, not a dependency.
      const imported = new RegExp(
        String.raw`(^|
)\s*import[^;
]*from\s*['"]` + pkg + String.raw`['"]|` +
          String.raw`import\s*\(\s*['"]` + pkg + String.raw`['"]|` +
          String.raw`require\s*\(\s*['"]` + pkg + String.raw`['"]`,
      )
      if (imported.test(text)) offenders.push(`${file} imports ${pkg}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `the cell reaches into the engine's control plane:\n  ${offenders.join('\n  ')}\n\n` +
      `A cell serves one tenant. The engine composes and signs for all of them.`,
  )
})

test('the allowlist is one test file, and it is a test file', () => {
  for (const [file, why] of ALLOWED) {
    assert.match(file, /\.(itest|test|spec)\.tsx?$/, `${file} is not a test but is allowlisted`)
    assert.ok(fs.existsSync(file), `${file} is allowlisted but does not exist`)
    assert.ok(why.length > 20, `${file} is allowlisted without a real reason`)
  }
  assert.equal(ALLOWED.size, 1, 'the engine-import allowlist grew')
})
