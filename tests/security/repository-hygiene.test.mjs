/**
 * Things that must never be committed, asserted rather than remembered.
 *
 * This exists because `git add -A` staged a 674 MB Terraform provider binary.
 * The ignore rule for it was already present and had been written thoughtfully
 * — it was just anchored to `infrastructure/terraform/`, and the binary was in
 * `infrastructure/oidc/`, a stack that did not exist when the rule was written.
 *
 * GitHub's 100 MB limit caught that one at the remote, which is luck rather
 * than a control: a 40 MB binary would have gone in silently and stayed in the
 * history forever. Both checks below are cheap and neither depends on anyone
 * noticing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const tracked = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)

/**
 * Generated directories that are per-stack, so a new stack inherits the rule
 * instead of needing someone to remember it.
 */
const NEVER_TRACKED = [
  { pattern: /(^|\/)\.terraform\//, why: 'Terraform provider plugins — hundreds of MB, re-downloadable' },
  { pattern: /(^|\/)\.terraform\.lock\.hcl$/, why: 'a lock written by a local CLI silently changes what production resolves' },
  { pattern: /\.tfstate(\.|$)/, why: 'Terraform state contains resource attributes and sometimes secrets' },
  { pattern: /(^|\/)node_modules\//, why: 'installed dependencies' },
  // `.env` and `.env.local` carry credentials. `.env.example` is the opposite:
  // its purpose is to document which variables exist without their values, and
  // it belongs in the repository. The test below asserts it stays that way.
  {
    pattern: /(^|\/)\.env(\.local|\.production|\.development)?$/,
    why: 'environment files carry credentials',
  },
]

test('no generated or secret-bearing path is tracked', () => {
  const offenders = []
  for (const file of tracked()) {
    for (const { pattern, why } of NEVER_TRACKED) {
      if (pattern.test(file)) offenders.push(`${file}  (${why})`)
    }
  }
  assert.deepEqual(offenders, [], `tracked files that must not be:\n  ${offenders.join('\n  ')}`)
})

test('committed .env examples document variables without carrying values', () => {
  // The reason `.env.example` is allowed is that it holds names, not values.
  // The moment someone pastes a working value in "so it runs", that reason is
  // gone and nothing would say so.
  const examples = tracked().filter((f) => /(^|\/)\.env\.(example|sample|template)$/.test(f))
  assert.ok(examples.length > 0, 'expected at least one .env example to exist')

  const populated = []
  for (const file of examples) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(#|$)/.test(line)) continue
      const [, key, rawValue] = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/) ?? []
      if (!key) continue

      // Only variables whose NAME says they hold a credential. A region, a URL
      // or a feature flag belongs in an example WITH its value — that is what
      // makes the file useful — and flagging them would produce noise that
      // trains people to ignore this check.
      const isSecretName =
        /(SECRET|PASSWORD|PASSPHRASE|TOKEN|CREDENTIAL|PRIVATE_KEY|_KEY|APIKEY|DSN)$/.test(key) ||
        /(^|_)(AWS_SECRET|CLIENT_SECRET)/.test(key)
      if (!isSecretName) continue

      const value = rawValue.trim().replace(/^["']|["']$/g, '')
      if (value === '') continue

      // Placeholders are the point of the file: empty, or obviously a stand-in.
      //
      // The `local-`/`dev-`/`test-`/`ci-` prefixes are allowed because a value
      // that announces its own scope cannot be mistaken for a production one,
      // and the alternative — leaving them blank — makes a fresh checkout fail
      // to boot for no security gain. A value must SAY it is local; being
      // short, or looking unimportant, is not enough.
      const isPlaceholder =
        /^(change[-_ ]?me|your[-_ ].*|<.*>|\.\.\.|xxx+|placeholder|example|todo|replace)/i.test(value) ||
        /^(local|dev|test|ci|sample|fake|dummy)[-_]/i.test(value) ||
        /^(true|false|\d+)$/.test(value) ||
        /example\.(com|invalid)|localhost|127\.0\.0\.1/.test(value)

      if (!isPlaceholder) populated.push(`${file}: ${key}`)
    }
  }

  assert.deepEqual(
    populated,
    [],
    `an .env example assigns what looks like a real value. Names belong here; values do not.\n` +
      `Variable names only are reported — printing the values would publish them into CI logs:\n  ` +
      populated.join('\n  ')
  )
})

/**
 * A source repository has no legitimate multi-megabyte file. The largest thing
 * here is a lockfile.
 *
 * Raise this only for a file you can name and justify — the threshold existing
 * is the point, and a binary that "just needs a slightly bigger limit" is the
 * exact case it is meant to stop.
 */
const MAX_TRACKED_BYTES = 3 * 1024 * 1024

test('no tracked file is unreasonably large', () => {
  const large = []
  for (const file of tracked()) {
    let size
    try {
      size = fs.statSync(file).size
    } catch {
      continue // deleted in the working tree but still in the index
    }
    if (size > MAX_TRACKED_BYTES) {
      large.push(`${file}  ${(size / 1024 / 1024).toFixed(1)} MB`)
    }
  }

  assert.deepEqual(
    large,
    [],
    `tracked files over ${MAX_TRACKED_BYTES / 1024 / 1024} MB. GitHub rejects at 100 MB, which is\n` +
      `not a control — a 40 MB binary would land silently and stay in the history forever:\n  ` +
      large.join('\n  ')
  )
})

test('every Terraform stack is covered by the ignore rules, including ones added later', () => {
  // The original rule was correct and anchored. Anchoring is what failed, so
  // this asserts the unanchored form still covers a stack that does not exist
  // yet rather than asserting the current stacks are covered.
  const hypothetical = 'infrastructure/a-stack-added-next-week/.terraform/providers/plugin'

  const ignored = execFileSync('git', ['check-ignore', '-q', hypothetical], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
    .toString()
    .trim()

  // check-ignore exits 0 when ignored; execFileSync throws on non-zero, so
  // reaching here at all is the assertion. Kept explicit so the intent survives.
  assert.equal(ignored, '', 'check-ignore printed unexpected output')
})
