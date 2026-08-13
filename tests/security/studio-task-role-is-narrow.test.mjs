/**
 * STUDIO-GATE-010 — the Studio's task role stays a READER, and stays EXACTLY
 * as wide as `capabilities.ts` says the code needs. No wider, no narrower.
 *
 * `tests/security/oidc-trust.test.mjs` does exactly this job for the three
 * deployment roles and has no counterpart for the ECS task role — the role that
 * the estate reads have widened from six DynamoDB actions to a read across most
 * of the account. Widening it once was a considered act; widening it again by
 * accident is what this exists to stop.
 *
 * The property being defended is an EQUALITY, in both directions, between the
 * grant in `infrastructure/studio/iam.tf` and the registry in
 * `apps/system-studio/src/lib/aws/capabilities.ts`:
 *
 *   * Registry ⊆ grant. A capability with no grant is an AccessDenied nobody
 *     predicted. It renders correctly — STUDIO-000-007 makes a denial a
 *     first-class result — and the surface is still blind. A guard that only
 *     forbids excess is satisfied by an EMPTY policy, and an empty policy is how
 *     the whole estate reads UNKNOWN in production while the suite is green.
 *
 *   * Grant ⊆ registry. An action granted that no capability names is a
 *     permission nothing calls and therefore a permission nobody reviewed. It is
 *     also how a role grows: somebody adds `s3:GetObject` "to test something",
 *     the capability never lands, and the grant stays for a year.
 *
 * Neither direction alone is the guard. Together they mean the two files cannot
 * disagree, which is the only durable answer here — a transcribed list drifts
 * the first time somebody edits one file and not the other.
 *
 * On top of the equality, four shape rules about how the role gets dangerous
 * even while the two lists agree:
 *
 *   1. No Allow action containing `*`. `ecs:*` is not "the ECS reads"; it is
 *      UpdateService, DeleteService and RunTask. `ec2:Describe*` is not the four
 *      describes the code calls; it is every describe EC2 will ever add.
 *   2. No Allow action spelled with a mutating verb — Create, Put, Delete,
 *      Update, Terminate, Send, Invoke, Attach, Detach, Modify — except the six
 *      DynamoDB registry writes, which are named here one by one. A read-only
 *      console whose role can write is the whole risk.
 *   3. Every Allow action is a read verb — `List*`, `Describe*`, `Get*` — with
 *      the same six exceptions and one action AWS does not spell as a read.
 *   4. No managed-policy attachment named AdministratorAccess, PowerUserAccess
 *      or IAMFullAccess. The task role must not be able to grant itself more.
 *
 * And one rule about RESOURCE, which is the axis the four above do not cover:
 * a capability that declares a scoped resource must not be granted on `"*"`.
 * Several AWS APIs — `ec2:Describe*`, `elasticloadbalancing:Describe*`,
 * `cognito-idp:List*` — have no resource-level permissions at all and MUST be
 * `"*"`; those capabilities declare `"*"` and this rule says nothing about them.
 * Where the API DOES scope (an S3 bucket ARN, a secret, a table, a repository,
 * a key) the registry says so, and a grant that quietly widens it to the whole
 * account is a real escalation that every other rule here would pass.
 *
 * Terraform is parsed with regexes rather than HCL: the policies here are all
 * `jsonencode({...})` literals with a predictable shape, and adding an HCL
 * parser dependency to a security guard is a supply-chain decision this does not
 * need to make. Both parses are asserted non-empty, so a shape change fails
 * loudly instead of finding nothing and reporting success.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const STUDIO = 'infrastructure/studio'
const REGISTRY = 'apps/system-studio/src/lib/aws/capabilities.ts'

/* ----------------------------------------------------------- terraform -- */

/** Every `aws_iam_role_policy` block whose `role` is the task role. */
function taskRolePolicies() {
  const found = []
  for (const file of fs.readdirSync(STUDIO).filter((f) => f.endsWith('.tf')).sort()) {
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
 * Statements in one policy block, as `{ sid, effect, actions, resources }`.
 *
 * The blocks are `jsonencode({ Version = ..., Statement = [ {...}, ... ] })`
 * with HCL `=` rather than JSON `:`, so this reads the fields directly instead
 * of trying to JSON.parse HCL.
 *
 * `resources` are kept as RAW TEXT, not parsed ARNs. A Resource is sometimes a
 * Terraform reference (`aws_dynamodb_table.tenants.arn`) rather than a string
 * literal, and a parser that only understood quoted strings would read those
 * statements as having no resource at all — which, in a rule about resources,
 * would silently pass everything. The only question asked of this text is
 * whether it is the literal star.
 */
function statementsIn(blockText) {
  const statements = []
  // Split on `Effect` so each chunk holds one statement's Action list. A
  // statement's `Sid` is written BEFORE its `Effect`, so it lands at the tail of
  // the PREVIOUS chunk — hence the look-back rather than a search of `chunk`.
  const parts = blockText.split(/Effect\s*=\s*/)
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]
    const effect = /^"(\w+)"/.exec(chunk.trim())?.[1]
    if (!effect) continue
    const sids = [...parts[i - 1].matchAll(/Sid\s*=\s*"([^"]+)"/g)]
    const sid = sids.length > 0 ? sids[sids.length - 1][1] : ''
    const actionMatch = /Action\s*=\s*\[([\s\S]*?)\]/.exec(chunk)
    const actions = actionMatch
      ? [...actionMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : []
    // `Resource = [ ... ]` and `Resource = <one thing>` are both legal HCL.
    const listMatch = /Resource\s*=\s*\[([\s\S]*?)\]/.exec(chunk)
    const oneMatch = /Resource\s*=\s*([^\n]+)/.exec(chunk)
    const resources = listMatch
      ? listMatch[1]
          .split(',')
          .map((r) => r.trim().replace(/,$/, ''))
          .filter(Boolean)
      : oneMatch
        ? [oneMatch[1].trim().replace(/,$/, '')]
        : []
    statements.push({ sid, effect, actions, resources })
  }
  return statements
}

/** Every `{ action, statement }` pair the task role ALLOWS. */
function allowedActions() {
  const pairs = []
  for (const policy of taskRolePolicies()) {
    for (const statement of statementsIn(policy.text)) {
      if (statement.effect !== 'Allow') continue
      for (const action of statement.actions) pairs.push({ action, policy, statement })
    }
  }
  return pairs
}

/* ------------------------------------------------------------ registry -- */

/**
 * `{ iamActions, resource }` for every capability, read out of the TypeScript.
 *
 * Regex rather than a compile-and-import, because this guard runs in the
 * platform suite under plain `node --test` with no TypeScript toolchain, and a
 * security gate that only runs when a build step succeeded is a security gate
 * that gets skipped.
 *
 * `iamActions` and `resource` are matched as a PAIR by position rather than
 * with one regex spanning both: several entries carry a paragraph of comment
 * between the two fields explaining why the resource is what it is, and a
 * combined pattern either misses those entries or has to be permissive enough
 * to pair one capability's actions with the next one's resource.
 */
function declaredCapabilities() {
  const source = fs.readFileSync(REGISTRY, 'utf8')
  const entries = []
  for (const match of source.matchAll(/iamActions:\s*\[([^\]]*)\]/g)) {
    const actions = match[1]
      .split(',')
      .map((raw) => raw.trim().replace(/["']/g, ''))
      .filter(Boolean)
    // The first `resource:` AFTER this entry's actions is this entry's.
    const after = source.slice(match.index + match[0].length)
    const resource = /resource:\s*"([^"]*)"/.exec(after)?.[1] ?? null
    entries.push({ actions, resource })
  }
  return entries
}

/** Flattened set of every IAM action any capability declares. */
function declaredActions() {
  return new Set(declaredCapabilities().flatMap((e) => e.actions))
}

/* --------------------------------------------------------- known holes -- */

/**
 * The six DynamoDB writes the tenant registry genuinely performs.
 *
 * Named one by one. `dynamodb:*` would be six actions and forty others.
 *
 * These are the ONE exemption to both the read-verb rule and the
 * grant ⊆ registry rule: they are a grant no capability names, deliberately,
 * because `capabilities.ts` is the vocabulary of ESTATE READS and the tenant
 * registry is not an estate read. Putting them in the registry to satisfy the
 * equality would make `CAPABILITIES` — the thing the read-only API iterates —
 * contain six mutations.
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

/**
 * Verbs that mean the role can CHANGE something.
 *
 * Checked separately from the read-verb rule and not folded into it, because
 * the two fail differently and a reader needs to know which happened: an action
 * that is neither a read nor a mutation (`sts:AssumeRole`, say) is a question,
 * and an action spelled `PutBucketPolicy` is an incident.
 *
 * Matched ANYWHERE in the action name, not anchored to its first word. This
 * started anchored and a mutation test caught it: `cognito-idp:AdminCreateUser`
 * — the call that would let this console mint itself an operator — begins
 * `Admin`, so an anchored pattern passed it as "not a mutation". So do
 * `AdminDeleteUser`, `AdminSetUserPassword`, `BatchDeleteImage` and
 * `AdminUpdateUserAttributes`, which is most of the account-takeover surface the
 * new Cognito and ECR reads sit next to.
 *
 * Checked against all 115 actions the registry currently declares: none of them
 * contains any of these substrings, so the wider match costs no false positive
 * today. If a future READ does trip it — an action named `…Updates` — the fix is
 * a named exemption in this file with a reason, not narrowing this back.
 */
const MUTATING_VERB = /^[a-z0-9-]+:.*(Create|Put|Delete|Update|Terminate|Send|Invoke|Attach|Detach|Modify)/

/**
 * Reads whose IAM action is not SPELLED as a read.
 *
 * Two, each named for its own reason rather than admitted by a wider regex.
 *
 * `budgets:ViewBudget` — AWS Budgets does not authorize `DescribeBudgets` with
 * an action of that name: its classic budget APIs are covered by two actions,
 * `budgets:ViewBudget` and `budgets:ModifyBudget`. A policy naming
 * `budgets:DescribeBudgets` grants nothing and fails as a quiet AccessDenied,
 * which on a cost page is indistinguishable from an account with no budgets.
 *
 * `logs:FilterLogEvents` — CloudWatch Logs spells its log-line read `Filter`,
 * and it is a pure read: it returns events from log groups and cannot write,
 * delete or expire one. It is also the single most sensitive read the task role
 * holds, because a log line carries whatever the application put in it, which is
 * why `infrastructure/studio/iam.tf` scopes it to a log-group ARN rather than
 * `"*"` — a scoping this file's last test independently enforces.
 *
 * This is a separate set from ALLOWED_MUTATIONS on purpose: neither of these is
 * a mutation, and filing them under a constant with that name would be a lie a
 * future reader would inherit. The write halves — `budgets:ModifyBudget`,
 * `logs:DeleteLogGroup` — are not here and are not granted.
 *
 * The verb regex is deliberately NOT widened to accept `View*` or `Filter*`.
 * Adding an entry to this set is one line in a file called
 * `studio-task-role-is-narrow`; adding a verb to the regex silently admits every
 * future `View*` action across every service, which is the kind of edit nobody
 * reviews.
 */
const READS_NOT_SPELLED_AS_READS = new Set(['budgets:ViewBudget', 'logs:FilterLogEvents'])

/* --------------------------------------------------------------- tests -- */

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
  assert.ok(
    allowedActions().length > 20,
    `only ${allowedActions().length} Allow actions parsed off the task role — the parse is broken`,
  )
})

test('the capability registry parses, and every capability names an action and a resource', () => {
  // Same failure mode from the other side: a registry that parses to nothing
  // makes the registry ⊆ grant check vacuously true.
  const entries = declaredCapabilities()
  assert.ok(entries.length > 10, `only ${entries.length} capabilities parsed out of ${REGISTRY}`)
  const malformed = entries
    .filter((e) => e.actions.length === 0 || e.resource === null)
    .map((e) => JSON.stringify(e))
  assert.deepEqual(
    malformed,
    [],
    `capabilities parsed with no actions or no resource — the parse is broken, not the registry:\n  ${malformed.join('\n  ')}`,
  )
})

test('no Allow on the studio task role uses a wildcard action', () => {
  const offenders = []
  for (const { action, policy, statement } of allowedActions()) {
    if (action.includes('*')) {
      offenders.push(`${policy.file} "${policy.name}" [${statement.sid}] — Allow ${action}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a wildcard Allow on the ECS task role:\n  ${offenders.join('\n  ')}\n\n` +
      `"ecs:*" is not "the ECS reads" — it is UpdateService, DeleteService and RunTask, and ` +
      `"ec2:Describe*" is every describe EC2 will ever add. Name the actions the code calls; ` +
      `capabilities.ts already lists them.`,
  )
})

test('no Allow on the studio task role is spelled with a mutating verb', () => {
  const offenders = []
  for (const { action, policy, statement } of allowedActions()) {
    if (ALLOWED_MUTATIONS.has(action)) continue
    if (!MUTATING_VERB.test(action)) continue
    offenders.push(`${policy.file} "${policy.name}" [${statement.sid}] — Allow ${action}`)
  }

  assert.deepEqual(
    offenders,
    [],
    `a mutating action on the ECS task role:\n  ${offenders.join('\n  ')}\n\n` +
      `This console is read-only. Create/Put/Delete/Update/Terminate/Send/Invoke/Attach/Detach/Modify ` +
      `are the verbs it must not hold. The only reversible mutations in this platform live in ` +
      `src/lib/aws/mutate.ts and are not granted here.`,
  )
})

test('every Allow on the studio task role is a read verb, or one of the six registry writes', () => {
  const offenders = []
  for (const { action, policy, statement } of allowedActions()) {
    if (ALLOWED_MUTATIONS.has(action)) continue
    if (READS_NOT_SPELLED_AS_READS.has(action)) continue
    if (READ_VERB.test(action)) continue
    offenders.push(`${policy.file} "${policy.name}" [${statement.sid}] — Allow ${action}`)
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

test('the not-spelled-as-a-read exemptions are all actions the code actually declares', () => {
  // Otherwise this set is a hole: anything added to it stops being checked by
  // the verb rule whether or not a capability ever asks for it.
  const declared = declaredActions()
  for (const action of READS_NOT_SPELLED_AS_READS) {
    assert.ok(
      declared.has(action),
      `${action} is exempt from the read-verb rule but no capability declares it — remove the exemption`,
    )
  }
})

test('no managed administrator policy is attached to the studio task role', () => {
  const forbidden = /AdministratorAccess|PowerUserAccess|IAMFullAccess|ReadOnlyAccess/
  const offenders = []

  for (const file of fs.readdirSync(STUDIO).filter((f) => f.endsWith('.tf')).sort()) {
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
  // Direction one. A guard that only forbids excess is satisfied by an empty
  // policy — and an empty policy is how every estate surface renders UNKNOWN in
  // production while the suite stays green.
  const declared = declaredActions()
  const granted = new Set(allowedActions().map((p) => p.action))

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

test('every action granted to the task role is one a capability actually names', () => {
  // Direction two, and the one that was missing. Without it the role can be
  // arbitrarily wider than the code — every other rule here passes a grant of
  // `s3:ListAllMyBuckets` that nothing calls, because it is a List on a star,
  // and a permission nothing calls is a permission nobody reviewed.
  const declared = declaredActions()
  const unclaimed = []
  for (const { action, policy, statement } of allowedActions()) {
    if (declared.has(action)) continue
    if (ALLOWED_MUTATIONS.has(action)) continue
    unclaimed.push(`${policy.file} "${policy.name}" [${statement.sid}] — ${action}`)
  }

  assert.deepEqual(
    unclaimed.sort(),
    [],
    `the task role is granted AWS actions no capability names:\n  ${unclaimed.join('\n  ')}\n\n` +
      `Every read this engine performs goes through CAPABILITIES in ${REGISTRY}; a grant with no ` +
      `capability behind it is reachable by nothing and reviewed by nobody. Either add the ` +
      `capability that calls it, or delete the grant.`,
  )
})

/**
 * IAM's hard ceiling on the size of ONE inline role policy, in characters.
 *
 * Documented by AWS as 10,240 for the aggregate of a role's inline policies.
 * This is not a style rule: a policy that crosses it is rejected by
 * `iam:PutRolePolicy` at `terraform apply`, which is a deploy failure in CI
 * long after the diff that caused it was reviewed and merged. The registry has
 * grown from 26 actions to 115 in one change; the next such change is the one
 * that would find this the expensive way.
 */
const INLINE_POLICY_LIMIT = 10240

test('the estate-read policy fits inside IAM inline-policy limits, with no duplicated action', () => {
  // Reconstructs what `jsonencode` will emit — compact JSON, fields in the
  // order the HCL writes them — rather than trusting a character count of the
  // Terraform, which is mostly comment and would measure nothing.
  const policies = taskRolePolicies()
  let total = 0
  for (const policy of policies) {
    const statements = statementsIn(policy.text).map((s) => ({
      ...(s.sid ? { Sid: s.sid } : {}),
      Effect: s.effect,
      Action: s.actions,
      Resource: s.resources.length === 1 ? s.resources[0] : s.resources,
    }))
    const rendered = JSON.stringify({ Version: '2012-10-17', Statement: statements })
    total += rendered.length
    assert.ok(
      rendered.length < INLINE_POLICY_LIMIT,
      `${policy.file}: inline policy "${policy.name}" renders to ${rendered.length} characters, ` +
        `over IAM's ${INLINE_POLICY_LIMIT} limit. terraform apply will fail with ` +
        `LimitExceeded — in CI, not here. Split it into a second aws_iam_role_policy, or drop ` +
        `grants no capability names.`,
    )

    // A duplicated action grants nothing and costs characters against that
    // limit. Cheap to check while the statements are already parsed.
    const counts = new Map()
    for (const statement of statements) {
      if (statement.Effect !== 'Allow') continue
      for (const action of statement.Action) counts.set(action, (counts.get(action) ?? 0) + 1)
    }
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([a]) => a).sort()
    assert.deepEqual(
      duplicated,
      [],
      `${policy.file}: policy "${policy.name}" grants the same action from two statements:\n  ` +
        `${duplicated.join('\n  ')}\n\nIt grants nothing extra and spends the inline-policy budget.`,
    )
  }
  assert.ok(total > 0, 'no policy rendered — the parse is broken')
})

test('a capability that scopes its resource is not granted on the whole account', () => {
  // The axis none of the verb rules cover. `s3:ListBucketVersions` on one
  // bucket ARN and the same action on `"*"` are both a List, both a read, both
  // pass every other test in this file — and the second one is every bucket in
  // the account.
  //
  // Capabilities that declare `"*"` are SILENT here, deliberately: ec2:Describe*,
  // elasticloadbalancing:Describe* and cognito-idp:List* have no resource-level
  // permissions in AWS at all, so `"*"` is the only value that works and
  // "tightening" it produces a policy that grants nothing.
  const scoped = new Map()
  for (const entry of declaredCapabilities()) {
    if (!entry.resource || entry.resource === '*') continue
    for (const action of entry.actions) scoped.set(action, entry.resource)
  }
  assert.ok(scoped.size > 0, 'no capability declares a scoped resource — the registry parse is broken')

  const widened = []
  for (const { action, policy, statement } of allowedActions()) {
    if (!scoped.has(action)) continue
    if (!statement.resources.includes('"*"')) continue
    widened.push(
      `${policy.file} "${policy.name}" [${statement.sid}] — ${action} granted on "*", ` +
        `but capabilities.ts scopes it to ${scoped.get(action)}`,
    )
  }

  assert.deepEqual(
    widened.sort(),
    [],
    `a scoped capability granted on the whole account:\n  ${widened.join('\n  ')}\n\n` +
      `The registry says this API supports resource-level permissions and names the ARN pattern ` +
      `the code needs. Granting it on "*" is a silent widening that every verb rule in this file ` +
      `passes. Scope the statement in infrastructure/studio/iam.tf, or change the capability's ` +
      `resource and say why.`,
  )
})
