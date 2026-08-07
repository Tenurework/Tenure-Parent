/**
 * PAY-120-001. A posted ledger entry is never destroyed.
 *
 * `deleteLedgerEntry` used to be the whole correction path:
 *
 *     await tx.ledgerEntry.delete({ where: { id: entry.id } })
 *
 * followed by recomputing the budget line's actual from whatever survived. A
 * transaction the institution had recognised simply stopped existing — no
 * opposite entry, no reason, no approval, and nothing for a bank statement to
 * reconcile against. The number on the dashboard looked right and the history
 * was gone.
 *
 * It is now `reverseLedgerEntry`, which POSTS a REVERSAL carrying the reason,
 * the poster and `reversesId`. This asserts that the deletion cannot come back
 * — a correctness property of the accounting record that no unit test can hold,
 * because the failure is somebody adding a second, quieter delete path
 * somewhere else in the tree.
 *
 * Deliberately an absolute zero rather than a ratchet like
 * `audit-writes.test.mjs`. There is no legitimate delete of a posted entry to
 * grandfather: the schema's `onDelete: Restrict` on every link into
 * `LedgerEntry` says the same thing, and this is the application half of it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const SOURCE_GLOBS = ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx']

/**
 * Application code only — the thing this rule is named after.
 *
 * An integration test that posts entries has to remove them again between runs:
 * every link into `LedgerEntry` is `onDelete: Restrict`, so there is no cascade
 * to lean on, and a suite that left its fixtures behind would fail its own next
 * run. That cleanup is not a correction path a tenant can reach, does not ship,
 * and cannot destroy anybody's accounting record.
 *
 * Narrow enough to matter: only the `.test.ts(x)` / `.itest.ts(x)` suffixes are
 * dropped, and `scannedFiles` below refuses to run if that leaves an
 * implausibly small set — an exclusion that quietly swallowed `src/lib` would
 * otherwise turn this whole file green and mean nothing.
 */
const IS_TEST_FILE = /\.i?test\.tsx?$/

const listFiles = () =>
  SOURCE_GLOBS.flatMap((g) =>
    execFileSync('git', ['ls-files', g], { encoding: 'utf8' }).split('\n').filter(Boolean)
  ).filter((f) => !IS_TEST_FILE.test(f))

/** Comments stripped: a call named in prose — as this file's own header does — is not a call. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

/** `tx.ledgerEntry.delete(`, `db.ledgerEntry.deleteMany(`, and every alias of them. */
const DESTROYS_A_POSTING = /\bledgerEntry\s*\.\s*delete(Many)?\s*\(/

function deletionSites() {
  const found = []
  for (const file of listFiles()) {
    const text = code(fs.readFileSync(file, 'utf8'))
    for (const [i, line] of text.split('\n').entries()) {
      if (DESTROYS_A_POSTING.test(line)) found.push(`${file}:${i + 1} ${line.trim()}`)
    }
  }
  return found
}

test('the scan still reaches the application, so a clean result means something', () => {
  // Every assertion below is an absence, and an absence over an empty file list
  // is indistinguishable from an absence over the real one. This is the floor
  // that tells them apart.
  const files = listFiles()
  // 267 today, of 363 including the test files this scan drops. A floor rather
  // than an equality: application files are added constantly and pinning the
  // count would red on every new route, while a collapse to a handful is the
  // only movement that would make the assertion below meaningless.
  assert.ok(
    files.length >= 200,
    `Scanned ${files.length} application files, expected at least 200. The glob or the ` +
      `test-file exclusion has stopped matching, and "no deletions found" would be a lie.`
  )
  assert.ok(
    files.some((f) => f.includes('finance/actions.ts')),
    'The finance actions file is not in the scanned set — that is the file this rule exists for.'
  )
})

test('no application code deletes a posted ledger entry', () => {
  const sites = deletionSites()
  assert.deepEqual(
    sites,
    [],
    'A posted transaction is corrected by a REVERSAL entry (reverseLedgerEntry), never removed. ' +
      'Deleting one destroys the accounting record: no opposite entry, no reason, and no way to ' +
      'answer what changed.\n  ' +
      sites.join('\n  ')
  )
})

test('the reversal path that replaced it is still there', () => {
  // Guards against "fixing" the assertion above by deleting the correction
  // path altogether, which would pass while leaving no way to correct anything.
  const actions = fs.readFileSync(
    'apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts',
    'utf8'
  )
  assert.match(
    actions,
    /export async function reverseLedgerEntry\b/,
    'reverseLedgerEntry is the correction path; without it the ledger has none'
  )
  assert.match(
    code(actions),
    /kind:\s*"REVERSAL"/,
    'the correction must post a REVERSAL entry, not merely refuse the delete'
  )
  assert.match(
    code(actions),
    /reversesId:\s*entry\.id/,
    'a reversal that does not name the entry it answers is an unattributed movement'
  )
})
