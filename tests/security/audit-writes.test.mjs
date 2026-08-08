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
// 34 -> 32 on 2026-08-07. `apps/web/src/lib/calendar-write.ts` now builds its
// two conflict records through `buildAuditRecord`, so the file counts as
// via-package and its writes leave the raw tally. Lowered, never raised: two
// NEW conflict-audit writes had pushed the real count to 36, and widening the
// ceiling to admit them would have been weakening the guard to make the build
// pass — the writes were converted instead.
const RAW_WRITE_CEILING = 32

/**
 * STUDIO-110-005 widened this to the Studio.
 *
 * It used to scan `apps/web` only, so every act of the operator console — a
 * tenant composed, a lifecycle advanced, a configuration published, and every
 * refusal of those — sat outside audit coverage entirely and this ratchet had
 * nothing to say about it. The Studio now writes a chained audit row through
 * `@tenure/audit`, and the ceiling stays where it is because the Studio adds
 * ZERO raw writes: it has no Prisma client to write one with.
 */
const SOURCE_GLOBS = [
  'apps/web/src/**/*.ts',
  'apps/web/src/**/*.tsx',
  'apps/system-studio/src/**/*.ts',
  'apps/system-studio/src/**/*.tsx',
]

/**
 * Tracked files AND untracked-but-not-ignored ones.
 *
 * `git ls-files` alone sees only what has been added, so a new module with a
 * raw write passes locally right up until the commit that puts it in CI's
 * reach. Every other tree-scanning guard in this repository learned the same
 * lesson (`forbidden-clients`, `platform-truth`).
 */
const listFiles = () =>
  SOURCE_GLOBS.flatMap((g) =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', g], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  ).filter((f) => !/\.(test|itest|spec)\.tsx?$/.test(f))

/** Comments stripped: a call named in prose is not a call. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

/**
 * How an audit row is written in each plane.
 *
 * `auditEvent.create` is the cell's Prisma write. `putAuditRow` is the Studio's
 * DynamoDB write, and the Studio CANNOT use the first: the operator plane is
 * forbidden a Prisma client (`tests/security/operator-plane-content.test.mjs`).
 * Both are counted, so "the console grew its own audit write that skips the
 * package" is caught the same way the cell's is.
 */
const WRITE_PATTERNS = [/\bauditEvent\.create\b/g, /\bputAuditRow\s*\(/g]

/**
 * The two modules that MAY write a row without importing the package.
 *
 * `registry.ts` is the storage primitive — it holds the only DynamoDB client
 * this app has (`forbidden-clients`), so the write has to live there — and
 * `audit-ledger.ts` is the one caller of it, which does import the package and
 * builds every record through `buildAuditRecord`. A third file calling
 * `putAuditRow` would be a row with no hash, no chain and no redaction.
 */
const STORAGE_OWNERS = new Set([
  'apps/system-studio/src/lib/registry.ts',
  'apps/system-studio/src/lib/audit-ledger.ts',
])

function auditWrites() {
  let viaPackage = 0
  let raw = 0
  const rawFiles = []

  for (const file of listFiles()) {
    if (STORAGE_OWNERS.has(file)) continue
    const text = code(fs.readFileSync(file, 'utf8'))
    const writes = WRITE_PATTERNS.reduce((n, re) => n + (text.match(re) ?? []).length, 0)
    if (writes === 0) continue

    if (/@tenure\/audit/.test(text)) {
      viaPackage += writes
    } else {
      raw += writes
      rawFiles.push(`${file.replace(/^apps\/(web|system-studio)\/src\//, '')} (${writes})`)
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

test('the operator plane writes its audit rows through @tenure/audit', () => {
  // The positive half, and the one the Studio's requirement turns on. An
  // assertion that only counts BYPASSES passes trivially in an app that writes
  // no audit row at all — which is exactly what the Studio did before
  // STUDIO-110-005, and exactly why it needed a requirement.
  const ledger = fs.readFileSync('apps/system-studio/src/lib/audit-ledger.ts', 'utf8')
  assert.match(
    ledger,
    /from ["']@tenure\/audit["']/,
    'the Studio ledger no longer builds its records through the package'
  )
  assert.match(
    ledger,
    /\bbuildAuditRecord\s*\(/,
    'the Studio ledger no longer builds records through buildAuditRecord, so nothing validates ' +
      'the required fields, refuses a DENY with no reason, or hashes the record'
  )

  // And a caller. A ledger nothing calls is the gap this closed, not the fix.
  const callers = execFileSync(
    'git',
    [
      'grep',
      '-lE',
      '--untracked',
      'from "@/lib/audit-ledger"',
      '--',
      'apps/system-studio/src/app',
    ],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
  assert.ok(
    callers.length >= 2,
    `only ${callers.length} page(s) or action module(s) reach the audit ledger. A writer with no ` +
      `caller records nothing.`
  )
})

test('an audit row cannot be rewritten by the role that wrote it', () => {
  // The storage half of STUDIO-110-005. The hash chain makes an edit
  // DETECTABLE; this is what makes it impossible. The policy previously granted
  // this role PutItem AND UpdateItem over every item and denied only deletion,
  // so a row could be rewritten in place by the process that wrote it.
  const tf = fs.readFileSync('infrastructure/studio/dynamodb.tf', 'utf8')

  const denyBlocks = tf.split(/Effect\s*=\s*"Deny"/).slice(1)
  assert.ok(denyBlocks.length >= 2, 'the registry policy has fewer Deny statements than it did')

  const auditDeny = denyBlocks.find((b) => b.includes('AUDIT#*'))
  assert.ok(
    auditDeny,
    'no Deny statement is scoped to the AUDIT#* partitions, so an audit row is as rewritable as ' +
      'any other item in the table'
  )
  for (const action of ['dynamodb:UpdateItem', 'dynamodb:DeleteItem']) {
    assert.ok(
      auditDeny.includes(action),
      `the AUDIT#* Deny does not cover ${action}`
    )
  }
  assert.ok(
    auditDeny.includes('ForAnyValue:StringLike'),
    'the AUDIT#* Deny does not use ForAnyValue — ForAllValues is vacuously true when the ' +
      'condition key is absent, which in a Deny refuses requests that name no key at all'
  )
  assert.ok(
    auditDeny.includes('dynamodb:LeadingKeys'),
    'the AUDIT#* Deny is not scoped by leading key, so it does not describe items at all'
  )
})

test('subsystem-paths.md reports the same numbers this test measures', () => {
  const doc = fs.readFileSync('docs/architecture/subsystem-paths.md', 'utf8')
  const { raw, viaPackage } = auditWrites()

  assert.ok(
    doc.includes(`${raw} of ${raw + viaPackage} audit writes bypass`),
    `the document's audit counts disagree with the code (${raw} raw, ${viaPackage} via package)`
  )
})
