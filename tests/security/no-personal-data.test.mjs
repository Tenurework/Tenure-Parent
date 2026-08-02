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
 * Scope: everything git would carry — tracked files and untracked ones that are
 * not ignored. The real roster still exists on an operator's machine and is
 * gitignored; that is the intended end state, and it is why this reads
 * `git ls-files --exclude-standard` rather than walking the filesystem.
 *
 * It was tracked-only until it let a plausible address reach a pushed commit
 * (see `tracked()` below). A check that runs after the thing it prevents has
 * already happened is a report, not a control.
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

/**
 * Files permitted to name a real person, with the reason and the item that
 * removes the permission.
 *
 * `lib/policies.ts` names three OSE staff as the approvers for purchases and
 * swag. That is operational content: editing the names would change who a
 * student is told to seek approval from, which is a product decision and not a
 * cleanup. The defect is not the names — it is that one tenant's governing
 * content is compiled into the global engine at all, which the platform
 * directive forbids. This entry disappears when GE-060 moves the file into
 * tenant configuration, and until then it is one line rather than a silent
 * exception.
 */
const NAMES_ALLOWED_IN = new Set(['apps/web/src/lib/policies.ts'])

/**
 * Tracked AND untracked-but-not-ignored.
 *
 * Plain `git ls-files` lists only tracked files, which makes this check blind
 * to a file that has not been staged yet — so a new file with an address in it
 * passes locally and fails in CI, after the address is already in a pushed
 * commit. That is the wrong order for a check whose entire purpose is to stop
 * data reaching a public repository, and it happened: GE-030-003's test fixture
 * used a plausible address at a real domain and only CI saw it.
 *
 * `--exclude-standard` keeps the gitignored real roster out, which is the
 * scoping this check has always wanted.
 */
const tracked = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

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

/**
 * Names, not just addresses.
 *
 * The address check passed while two e2e specs asserted on real students by
 * name — `getByRole("button", { name: /Remove <real person>/ })`. An address is
 * the obvious shape of personal data and not the only one.
 *
 * This can only run where the real roster is present: on an operator's machine,
 * which is exactly where a name would be copied from. In CI the roster is
 * absent by design, so the check reports that it did not run rather than
 * passing vacuously — a skipped check that looks green is worse than no check.
 */
test('no tracked file names a person from the real roster', async (t) => {
  const REAL_ROSTER = 'apps/web/scripts/roster-data.mjs'
  if (!fs.existsSync(REAL_ROSTER)) {
    t.diagnostic(`${REAL_ROSTER} is absent — name check NOT RUN. It runs where the roster is.`)
    return
  }

  const [real, sample] = await Promise.all([
    import(`file://${process.cwd()}/${REAL_ROSTER}`),
    import(`file://${process.cwd()}/apps/web/scripts/roster-data.sample.mjs`),
  ])

  const namesOf = (m) => {
    const out = new Set()
    for (const club of m.ROSTER) {
      for (const seat of club.seats ?? []) {
        if (seat.holder?.name) out.add(seat.holder.name.trim())
        if (seat.predecessor?.name) out.add(seat.predecessor.name.trim())
      }
    }
    for (const a of m.ADVISORS ?? []) if (a.name) out.add(a.name.trim())
    return out
  }

  // A name the anonymiser also invented is not evidence of a leak — the
  // surname pool it draws from can collide with a real one.
  const synthetic = namesOf(sample)
  const realNames = [...namesOf(real)].filter((n) => !synthetic.has(n) && n.includes(' '))

  const offenders = new Map()
  for (const file of tracked()) {
    if (file === REAL_ROSTER) continue
    if (NAMES_ALLOWED_IN.has(file)) continue
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const found = realNames.filter((n) => text.includes(n))
    if (found.length) offenders.set(file, found.length)
  }

  const report = [...offenders].map(([f, n]) => `  ${f}: ${n} name(s)`).join('\n')
  assert.equal(
    offenders.size,
    0,
    `tracked files name real people. Derive them from scripts/roster-source.mjs instead, as\n` +
      `apps/web/e2e/support/roster.ts does — a test that asserts on a person breaks when the\n` +
      `person changes, which is the wrong thing for it to be coupled to:\n${report}`
  )
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
