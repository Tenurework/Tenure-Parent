/**
 * STUDIO-GATE-010 — the Studio's task role stays a READER.
 *
 * `tests/security/oidc-trust.test.mjs` does exactly this job for the three
 * deployment roles and has no counterpart for the ECS task role — the role that
 * the estate reads have just widened from six DynamoDB actions to twenty-six
 * verbs across twelve services. Widening it once was a considered act; widening
 * it again by accident is what this exists to stop.
 *
 * Four assertions, each about a different way the role gets dangerous:
 *
 *   1. No Allow whose action is `*`, or ends `:*`. `ecs:*` is not "the ECS
 *      reads"; it is UpdateService, DeleteService and RunTask.
 *   2. No managed-policy attachment named AdministratorAccess, PowerUserAccess
 *      or IAMFullAccess. The task role must not be able to grant itself more.
 *   3. Every Allow action is a read verb — `List*`, `Describe*`, `Get*` —
 *      EXCEPT the six DynamoDB registry actions, which are named here
 *      explicitly. Adding a seventh mutation means editing this list, in a file
 *      called `studio-task-role-is-narrow`, which is a conversation rather than
 *      a diff nobody reads.
 *   4. Every action the code says it needs is actually granted. A guard that
 *      only checks for excess passes an empty policy, and an empty policy is how
 *      the whole estate reads UNKNOWN in production while every test is green.
 *
 * Terraform is parsed with regexes rather than HCL: the policies here are all
 * `jsonencode({...})` literals with a predictable shape, and adding an HCL
 * parser dependency to a security guard is a supply-chain decision this does not
 * need to make. The parse is asserted non-empty, so a shape change fails loudly
 * instead of finding nothing and reporting success.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const STUDIO = 'infrastructure/studio'

/** Every `aws_iam_role_policy` block whose `role` is the task role. */
function taskRolePolicies() {
  const found = []
  for (const file of fs.readdirSync(STUDIO).filter((f) => f.endsWith('.tf'))) {
    const text = fs.readFileSync(path.join(STUDIO, file), 'utf8')
    const blocks = text.split(/resource\s+"aws_iam_role_policy"\s+"/).slice(1)
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf('"'))
      if (!/role\s*=\s*aws_iam_role\.task\.id/.test(block)) continue
      found.push({ file, name, text: block })
    }
  }
  return found
}

/**
 * Statements in one policy block, as `{ effect, actions }`.
 *
 * The blocks are `jsonencode({ Version = ..., Statement = [ {...}, ... ] })`
 * with HCL `=` rather than JSON `:`, so this reads the Effect/Action pairs
 * directly instead of trying to JSON.parse HCL.
 */
function statementsIn(blockText) {
  const statements = []
  // Split on `Effect` so each chunk holds one statement's Action list.
  const chunks = blockText.split(/Effect\s*=\s*/).slice(1)
  for (const chunk of chunks) {
    const effect = /^"(\w+)"/.exec(chunk.trim())?.[1]
    if (!effect) continue
    const actionMatch = /Action\s*=\s*\[([\s\S]*?)\]/.exec(chunk)
    const actions = actionMatch
      ? [...actionMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : []
    statements.push({ effect, actions })
  }
  return statements
}

/**
 * The six DynamoDB writes the tenant registry genuinely performs.
 *
 * Named one by one. `dynamodb:*` would be six actions and forty others.
 */
const ALLOWED_MUTATIONS = new Set([
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:Query',
  'dynamodb:Scan',
  'dynamodb:TransactWriteItems',
])

const READ_VERB = /^[a-z0-9-]+:(List|Describe|Get|BatchGet|Search|Lookup|Select|Query|Scan)/

test('the studio task role holds at least one policy, and this guard can see it', () => {
  // A parse that finds nothing reports "no violations", which is the failure
  // mode every survey-shaped guard has. It fails instead.
  const policies = taskRolePolicies()
  assert.ok(
    policies.length >= 2,
    `only ${policies.length} task-role policies parsed out of ${STUDIO} — the parse is broken, not the Terraform`,
  )
  for (const policy of policies) {
    assert.ok(
      statementsIn(policy.text).length > 0,
      `${policy.file}: policy "${policy.name}" parsed to zero statements`,
    )
  }
})

test('no Allow on the studio task role uses a wildcard action', () => {
  const offenders = []
  for (const policy of taskRolePolicies()) {
    for (const statement of statementsIn(policy.text)) {
      if (statement.effect !== 'Allow') continue
      for (const action of statement.actions) {
        if (action === '*' || action.endsWith(':*')) {
          offenders.push(`${policy.file} "${policy.name}" — Allow ${action}`)
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a wildcard Allow on the ECS task role:\n  ${offenders.join('\n  ')}\n\n` +
      `"ecs:*" is not "the ECS reads" — it is UpdateService, DeleteService and RunTask. ` +
      `Name the actions the code calls; capabilities.ts already lists them.`,
  )
})

test('every Allow on the studio task role is a read verb, or one of the six registry writes', () => {
  const offenders = []
  for (const policy of taskRolePolicies()) {
    for (const statement of statementsIn(policy.text)) {
      if (statement.effect !== 'Allow') continue
      for (const action of statement.actions) {
        if (ALLOWED_MUTATIONS.has(action)) continue
        if (READ_VERB.test(action)) continue
        offenders.push(`${policy.file} "${policy.name}" — Allow ${action}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a non-read action on the ECS task role:\n  ${offenders.join('\n  ')}\n\n` +
      `The Studio reads the estate and writes only the tenant registry. If a mutation is ` +
      `genuinely required, add it to ALLOWED_MUTATIONS in this file with a reason — that edit ` +
      `is the review this guard exists to force.`,
  )
})

test('no managed administrator policy is attached to the studio task role', () => {
  const forbidden = /AdministratorAccess|PowerUserAccess|IAMFullAccess|ReadOnlyAccess/
  const offenders = []

  for (const file of fs.readdirSync(STUDIO).filter((f) => f.endsWith('.tf'))) {
    const text = fs.readFileSync(path.join(STUDIO, file), 'utf8')
    const blocks = text.split(/resource\s+"aws_iam_role_policy_attachment"\s+"/).slice(1)
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf('"'))
      if (!/role\s*=\s*aws_iam_role\.task\./.test(block)) continue
      const arn = /policy_arn\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? ''
      if (forbidden.test(arn)) offenders.push(`${file} "${name}" — ${arn}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a managed administrator policy on the ECS task role:\n  ${offenders.join('\n  ')}\n\n` +
      `Even ReadOnlyAccess is wrong here: it grants s3:GetObject over every bucket in the account, ` +
      `which is every tenant's documents.`,
  )
})

test('every capability the code declares is actually granted to the task role', () => {
  // The other direction. A guard that only forbids excess is satisfied by an
  // empty policy — and an empty policy is how every estate surface renders
  // UNKNOWN in production while the suite stays green.
  const source = fs.readFileSync('apps/system-studio/src/lib/aws/capabilities.ts', 'utf8')
  const declared = new Set()
  for (const match of source.matchAll(/iamActions:\s*\[([^\]]*)\]/g)) {
    for (const raw of match[1].split(',')) {
      const action = raw.trim().replace(/["']/g, '')
      if (action) declared.add(action)
    }
  }
  assert.ok(declared.size > 10, `only ${declared.size} IAM actions parsed out of capabilities.ts`)

  const granted = new Set()
  for (const policy of taskRolePolicies()) {
    for (const statement of statementsIn(policy.text)) {
      if (statement.effect !== 'Allow') continue
      for (const action of statement.actions) granted.add(action)
    }
  }

  const ungranted = [...declared].filter((a) => !granted.has(a)).sort()
  assert.deepEqual(
    ungranted,
    [],
    `capabilities.ts declares AWS actions the task role is not granted:\n  ${ungranted.join('\n  ')}\n\n` +
      `Each of these renders as "unknown — this role was refused …" on a live console. ` +
      `That rendering is correct and the grant is still missing: add the action to ` +
      `infrastructure/studio/iam.tf's estate-read policy, or drop the capability.`,
  )
})
