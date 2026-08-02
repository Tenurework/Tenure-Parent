/**
 * GE-011-007 — drift detection for what a workflow is allowed to be.
 *
 * The item asks for drift detection across OIDC trust, IAM policies, action
 * pinning, workflow permissions and environment protections. Three of those
 * five are facts about THIS REPOSITORY and can be checked here, on every push,
 * with no credentials and no network:
 *
 *   * which actions are pinned, and how
 *   * what permissions a workflow grants itself
 *   * that nothing grants `write-all`
 *
 * The other two — deployed IAM policy, and whether the environments exist — are
 * facts about GitHub and AWS. They are checked by `tools/verify-environments.mjs`
 * and the inventory workflow, because a test that needs a token is a test that
 * does not run when somebody clones the repository.
 *
 * ## Ratchets, not flag days
 *
 * Forty-two action references are still on tags today, and nine workflows
 * inherit the repository permission default. Failing the build on all of that would mean
 * one enormous change nobody can review, and the realistic outcome is the rule
 * being deleted rather than the debt being paid. So the counts are ratchets:
 * they may shrink and may never grow. The rules that are absolute are the ones
 * where a single instance is the whole risk.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const DIR = '.github/workflows'

const workflows = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(DIR, f), 'utf8') }))

/** Every `uses:` reference, with where it came from. */
function usesReferences() {
  const refs = []
  for (const { file, text } of workflows) {
    text.split('\n').forEach((line, i) => {
      const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/.exec(line)
      if (!m) return
      const ref = m[1].replace(/^['"]|['"]$/g, '')
      // A local action (`./.github/...`) is this repository's own code and is
      // already reviewed by the same process as everything else here.
      if (ref.startsWith('./')) return
      const [name, version = ''] = ref.split('@')
      refs.push({ file, line: i + 1, ref, publisher: name.split('/')[0], name, version })
    })
  }
  return refs
}

/**
 * Publishers whose tags are treated as trustworthy.
 *
 * GitHub's own, AWS's own, Docker's own, HashiCorp's own. Not a statement that
 * they cannot be compromised — a statement that a tag move by one of them is a
 * different kind of event from a tag move by an account somebody registered
 * last week, and that the second is what SHA pinning is actually defending
 * against.
 *
 * Anything outside this set must be pinned to a commit, with no ratchet and no
 * grace: the first unpinned third-party action is the whole risk, so there is
 * nothing to phase in.
 */
const TAG_TRUSTED_PUBLISHERS = new Set(['actions', 'aws-actions', 'docker', 'hashicorp'])

const SHA = /^[0-9a-f]{40}$/

test('every third-party action is pinned to a commit', () => {
  const loose = usesReferences()
    .filter((r) => !TAG_TRUSTED_PUBLISHERS.has(r.publisher))
    .filter((r) => !SHA.test(r.version))
    .map((r) => `${r.file}:${r.line} ${r.ref}`)

  assert.deepEqual(
    loose,
    [],
    `An action from outside the trusted publishers is pinned to a tag, which the publisher can move:\n` +
      `  ${loose.join('\n  ')}\n` +
      `Pin it to a 40-character commit SHA. There is no ratchet here — the first one is the whole risk.`,
  )
})

/**
 * How many trusted-publisher references are still on tags.
 *
 * MAY ONLY SHRINK. Raising it to make a build pass is the failure this number
 * exists to prevent, and the assertion says so in both directions.
 */
const UNPINNED_TRUSTED = 42

test('the unpinned-action count only shrinks', () => {
  const unpinned = usesReferences()
    .filter((r) => TAG_TRUSTED_PUBLISHERS.has(r.publisher))
    .filter((r) => !SHA.test(r.version))

  assert.ok(
    unpinned.length <= UNPINNED_TRUSTED,
    `${unpinned.length} trusted-publisher actions are on tags, up from ${UNPINNED_TRUSTED}. ` +
      `This ratchet may only shrink — pin the new one rather than raising the number.`,
  )

  assert.equal(
    unpinned.length,
    UNPINNED_TRUSTED,
    `${unpinned.length} unpinned, and the ratchet says ${UNPINNED_TRUSTED}. ` +
      `Lower UNPINNED_TRUSTED to ${unpinned.length} — a ratchet that is not tightened when the debt is paid stops meaning anything.`,
  )
})

test('no workflow grants itself write-all', () => {
  // The one permission setting that makes every other one irrelevant.
  const offenders = []
  for (const { file, text } of workflows) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*permissions:\s*write-all\s*$/.test(line)) offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `write-all defeats every other permission in the file:\n  ${offenders.join('\n  ')}`)
})

test('no workflow grants contents: write without saying why', () => {
  // `contents: write` lets a job push to the repository, which means a
  // compromised action in that job can rewrite the code that runs next time.
  // Allowed, but not silently: a comment on the line or the one above it is
  // the difference between a considered grant and a copied one.
  const unexplained = []
  for (const { file, text } of workflows) {
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (!/^\s*contents:\s*write\s*$/.test(line)) return
      const hasReason = /#/.test(line) || (i > 0 && /^\s*#/.test(lines[i - 1]))
      if (!hasReason) unexplained.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(
    unexplained,
    [],
    `contents: write with no comment explaining why:\n  ${unexplained.join('\n  ')}\n` +
      `A job with this can rewrite the code that runs next time.`,
  )
})

/**
 * Workflows with no `permissions:` block at any level.
 *
 * They inherit the repository default, which is `read` today — asserted against
 * the API by `tools/verify-workflow-permissions.mjs`, because a default is a
 * setting somebody can change in a web form and no file here would record it.
 *
 * MAY ONLY SHRINK.
 */
const WORKFLOWS_WITHOUT_PERMISSIONS = 9

test('the count of workflows relying on the repository default only shrinks', () => {
  const relying = workflows
    .filter(({ text }) => !/^\s*permissions:/m.test(text))
    .map((w) => w.file)

  assert.ok(
    relying.length <= WORKFLOWS_WITHOUT_PERMISSIONS,
    `${relying.length} workflows declare no permissions, up from ${WORKFLOWS_WITHOUT_PERMISSIONS}:\n` +
      `  ${relying.join('\n  ')}\n` +
      `Declare them in the new workflow rather than raising the number.`,
  )

  assert.equal(
    relying.length,
    WORKFLOWS_WITHOUT_PERMISSIONS,
    `${relying.length} rely on the default and the ratchet says ${WORKFLOWS_WITHOUT_PERMISSIONS}. ` +
      `Lower it to ${relying.length}.`,
  )
})

test('every workflow that requests an OIDC token declares id-token: write', () => {
  // Without it the token is not issued and the job fails at assume-role — a
  // confusing failure that reads as a trust-policy problem. And declaring it
  // where it is NOT needed hands an unnecessary capability to every step.
  for (const { file, text } of workflows) {
    const usesOidc = /role-to-assume:/.test(text)
    const declares = /id-token:\s*write/.test(text)
    if (usesOidc) {
      assert.ok(declares, `${file} assumes a role by OIDC but never declares id-token: write`)
    } else {
      assert.ok(
        !declares,
        `${file} declares id-token: write and assumes no role — that is a capability with no use`,
      )
    }
  }
})
