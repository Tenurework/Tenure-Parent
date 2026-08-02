/**
 * GE-011-006 — the key report may not put key ids in a public build log.
 *
 * An access key ID is not a secret; it is the public half of the pair, and the
 * report needs it to say which key. But this repository is public, build logs
 * are archived and indexed, and a list of every key in the account is a map of
 * what to go after. So the ids live in a short-retention artifact and the
 * summary carries counts.
 *
 * That distinction is one line away from being lost — a future edit that prints
 * the report instead of the summary would look like an improvement.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REPORT = 'docs/architecture/key-last-use.json'
const SUMMARY_TOOL = 'tools/key-summary.mjs'

/** A report shaped exactly as `key-last-use.mjs` writes one. */
const FIXTURE = {
  takenAt: '2026-08-02T05:00:00.000Z',
  attentionDays: 90,
  users: 2,
  keys: [
    {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      user: 'ci-deployer',
      status: 'Active',
      createdAt: '2025-01-01T00:00:00.000Z',
      ageDays: 578,
      lastUsedAt: null,
      lastUsedDaysAgo: null,
      lastUsedService: null,
      lastUsedRegion: null,
    },
  ],
  summary: { total: 3, active: 2, noRecordedUse: 1, unusedBeyondAttention: 1 },
}

function withFixture(fn) {
  const existed = fs.existsSync(REPORT)
  const backup = existed ? fs.readFileSync(REPORT, 'utf8') : null
  fs.writeFileSync(REPORT, JSON.stringify(FIXTURE))
  try {
    return fn()
  } finally {
    if (backup === null) fs.rmSync(REPORT, { force: true })
    else fs.writeFileSync(REPORT, backup)
  }
}

test('the summary carries counts and never a key id or a user name', () => {
  const { stdout, summary } = withFixture(() => {
    const summaryFile = path.join(os.tmpdir(), `key-summary-${process.pid}.md`)
    fs.writeFileSync(summaryFile, '')
    const stdout = execFileSync('node', [SUMMARY_TOOL], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
    })
    const summary = fs.readFileSync(summaryFile, 'utf8')
    fs.rmSync(summaryFile, { force: true })
    return { stdout, summary }
  })

  for (const [where, text] of [['stdout', stdout], ['step summary', summary]]) {
    assert.ok(text.includes('3 key(s)'), `${where} lost the counts`)
    assert.ok(
      !text.includes('AKIAIOSFODNN7EXAMPLE'),
      `${where} contains a key id — this reaches a public, archived build log`,
    )
    assert.ok(
      !text.includes('ci-deployer'),
      `${where} contains an IAM user name, which names what to go after just as well as the id does`,
    )
  }
})

test('a missing report fails loudly rather than reporting nothing', () => {
  // The reassuring failure. A summary that quietly says nothing when the read
  // step did not run — or when the role lost a permission — reads as "no keys",
  // which is the most comfortable possible way to be wrong about credentials.
  const existed = fs.existsSync(REPORT)
  const backup = existed ? fs.readFileSync(REPORT, 'utf8') : null
  fs.rmSync(REPORT, { force: true })

  let exitCode = 0
  let stderr = ''
  try {
    execFileSync('node', [SUMMARY_TOOL], { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    exitCode = err.status
    stderr = String(err.stderr ?? '')
  } finally {
    if (backup !== null) fs.writeFileSync(REPORT, backup)
  }

  assert.equal(exitCode, 1, 'a missing report must fail the step')
  assert.match(stderr, /did not run/)
})

test('the report is never committed', () => {
  // A public repository. The artifact has three-day retention on purpose; a
  // committed copy has none.
  const tracked = execFileSync('git', ['ls-files', REPORT], { encoding: 'utf8' }).trim()
  assert.equal(tracked, '', `${REPORT} is tracked — it lists every key id in the account`)

  const ignored = fs.readFileSync('.gitignore', 'utf8')
  assert.ok(ignored.includes('key-last-use.json'), 'the report must be gitignored')
})
