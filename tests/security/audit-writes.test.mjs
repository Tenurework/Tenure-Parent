/**
 * GE-000-003 §3. The audit trail's own integrity, as a ratchet.
 *
 * 35 places write an `AuditEvent`. One of them builds the record through
 * `@tenure/audit`, which validates the required fields, refuses a DENY with no
 * reason, and redacts sensitive metadata. The other 34 hand-build the payload
 * and skip all of it.
 *
 * A document saying "34" is true on the day it is written. This asserts it,
 * with a ceiling that can only be lowered: adding a 35th raw write fails, and
 * converting one to the package requires lowering RAW_WRITE_CEILING in the same
 * commit — which is exactly the moment to notice progress, or its absence.
 *
 * The direction matters. This is not a test that the code is correct; the code
 * is not correct. It is a test that it does not get worse while GE-120 is open.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/** Lower this as writes move to `@tenure/audit`. Never raise it. */
const RAW_WRITE_CEILING = 34

const SOURCE_GLOBS = ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx']

const listFiles = () =>
  SOURCE_GLOBS.flatMap((g) =>
    execFileSync('git', ['ls-files', g], { encoding: 'utf8' }).split('\n').filter(Boolean)
  ).filter((f) => !/\.(test|itest|spec)\.tsx?$/.test(f))

/** Comments stripped: a call named in prose is not a call. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

function auditWrites() {
  let viaPackage = 0
  let raw = 0
  const rawFiles = []

  for (const file of listFiles()) {
    const text = code(fs.readFileSync(file, 'utf8'))
    const writes = (text.match(/\bauditEvent\.create\b/g) ?? []).length
    if (writes === 0) continue

    if (/@tenure\/audit/.test(text)) {
      viaPackage += writes
    } else {
      raw += writes
      rawFiles.push(`${file.replace('apps/web/src/', '')} (${writes})`)
    }
  }
  return { viaPackage, raw, rawFiles }
}

test('no new audit write bypasses @tenure/audit', () => {
  const { raw, rawFiles } = auditWrites()

  assert.ok(
    raw <= RAW_WRITE_CEILING,
    `${raw} audit writes bypass @tenure/audit, ceiling is ${RAW_WRITE_CEILING}. ` +
      `A hand-built AuditEvent skips field validation, DENY-needs-a-reason, and metadata redaction.\n  ` +
      rawFiles.join('\n  ')
  )
})

test('the ceiling is not set above the real count', () => {
  // A ceiling that drifts above reality stops being a ratchet: it would permit
  // new raw writes up to the slack. Lowering it is the point.
  const { raw } = auditWrites()
  assert.equal(
    RAW_WRITE_CEILING,
    raw,
    `RAW_WRITE_CEILING is ${RAW_WRITE_CEILING} but there are ${raw} raw writes. ` +
      `If writes were converted, lower the ceiling to ${raw} in this commit.`
  )
})

test('at least one write still proves the package is wired into the runtime', () => {
  // Guards against "fixing" this by deleting the import everywhere.
  const { viaPackage } = auditWrites()
  assert.ok(viaPackage >= 1, '@tenure/audit is no longer reached by any audit write')
})

test('subsystem-paths.md reports the same numbers this test measures', () => {
  const doc = fs.readFileSync('docs/architecture/subsystem-paths.md', 'utf8')
  const { raw, viaPackage } = auditWrites()

  assert.ok(
    doc.includes(`${raw} of ${raw + viaPackage} audit writes bypass`),
    `the document's audit counts disagree with the code (${raw} raw, ${viaPackage} via package)`
  )
})
