/**
 * No real personal data in a public repository.
 *
 * This exists because it already happened. `apps/web/scripts/roster-data.mjs`
 * carried 328 real `@*.rochester.edu` addresses — 172 named students and
 * advisors — and was served by `raw.githubusercontent.com` with HTTP 200 for
 * the whole time this repository was public. The escape hatch to remove it
 * (`scripts/roster-source.mjs`, which falls through to a synthetic fixture) had
 * been built and never used, because nothing failed while the file sat there.
 *
 * A control that only exists in a person's memory is not a control. This is the
 * thing that fails.
 *
 * Scope: tracked files only. The real roster still exists on an operator's
 * machine and is gitignored; that is the intended end state, and it is why the
 * check reads `git ls-files` rather than walking the filesystem.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * Domains belonging to real people. Not a general email regex: matching every
 * address would drown the signal in `user@example.com` placeholders, and a
 * check that reports fifty false positives is a check that gets deleted.
 */
const REAL_DOMAINS = [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*\brochester\.edu\b/gi]

/**
 * Addresses at a real domain that are nonetheless safe: role mailboxes already
 * published by the institution, and obvious placeholders that happen to use the
 * pilot's domain in UI copy.
 *
 * Each needs a reason. "It looked fine" is how the roster got here.
 */
const ALLOWED = new Map([
  ['studentengagment@simon.rochester.edu', 'published OSE office mailbox — an institutional address, not a person'],
  ['student@rochester.edu', 'placeholder in UI copy and e2e fixtures; no such account'],
  ['staff@rochester.edu', 'placeholder in UI copy'],
  ['successor@rochester.edu', 'placeholder in the role-transfer panel'],
  ['jlee@rochester.edu', 'placeholder in an admin table example row'],

  // A named administrator's work address, in `lib/policies.ts`, alongside 37
  // other pilot-specific strings. It is allowlisted rather than edited because
  // silently redirecting a real support contact is a product change, and
  // because deleting the address would leave the actual defect in place: that
  // file is one tenant's policy content compiled into the global engine, which
  // the platform directive forbids outright. Removing this entry is a
  // consequence of GE-060 moving it into tenant configuration, not a
  // prerequisite for it.
  ['dsipp@simon.rochester.edu', 'named staff contact in lib/policies.ts — see GE-060; tenant content in engine source'],
])

/** Files whose entire purpose is the real roster, and which are not committed. */
const UNTRACKED_BY_DESIGN = ['apps/web/scripts/roster-data.mjs']

const tracked = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)

function findAddresses() {
  const hits = []
  for (const file of tracked()) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue // binary or unreadable
    }
    for (const pattern of REAL_DOMAINS) {
      for (const m of text.matchAll(pattern)) {
        const address = m[0].toLowerCase()
        if (ALLOWED.has(address)) continue
        hits.push({ file, address })
      }
    }
  }
  return hits
}

test('no tracked file carries a real personal email address', () => {
  const hits = findAddresses()

  // Report by file with a count, never the addresses themselves — a test
  // failure is printed into CI logs, which on a public repository is the same
  // exposure this test exists to prevent.
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)

  const report = [...byFile].map(([f, n]) => `  ${f}: ${n} address(es)`).join('\n')

  assert.equal(
    hits.length,
    0,
    `real personal addresses in tracked files. Do NOT paste them into a commit message or a\n` +
      `test output. Move the data behind scripts/roster-source.mjs, or add a reasoned entry to\n` +
      `ALLOWED if the address is genuinely public:\n${report}`
  )
})

test('the real roster is untracked and ignored', () => {
  for (const file of UNTRACKED_BY_DESIGN) {
    assert.ok(!tracked().includes(file), `${file} is tracked again — it carries 172 named people`)

    // Ignored, not merely absent: absent-and-unignored means the next
    // `git add -A` on an operator's machine re-commits it.
    const ignored = execFileSync('git', ['check-ignore', file], { encoding: 'utf8', stdio: 'pipe' })
    assert.match(ignored.trim(), new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('the synthetic fixture contains no real address, and is complete enough to replace the roster', () => {
  const sample = 'apps/web/scripts/roster-data.sample.mjs'
  const text = fs.readFileSync(sample, 'utf8')

  for (const pattern of REAL_DOMAINS) {
    assert.equal([...text.matchAll(pattern)].length, 0, `${sample} carries a real address`)
  }

  // RFC 2606 reserves .invalid so nothing can be delivered to one. A fixture
  // using a deliverable domain can mail a stranger during a test.
  const addresses = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g)].map((m) => m[0])
  assert.ok(addresses.length > 0, 'the fixture has no addresses at all')
  const deliverable = addresses.filter((a) => !a.endsWith('.invalid'))
  assert.deepEqual(deliverable, [], 'fixture addresses must end in a reserved .invalid domain')
})
