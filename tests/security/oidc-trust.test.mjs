/**
 * GE-011-002. Negative tests on the OIDC trust policies.
 *
 * A trust policy is the entire security boundary of OIDC deployment identity.
 * Everything else — least-privilege permissions, short sessions, protected
 * environments — assumes the token came from the repository it claims. If the
 * `sub` condition is loosened, none of the rest matters: a workflow in any
 * repository can mint credentials in this account.
 *
 * The failure mode is quiet and plausible. `StringEquals` → `StringLike`, or
 * `repo:Tenurework/Tenure-Parent:ref:refs/heads/main` → `repo:Tenurework/*`, both
 * read like a small generalisation, both apply cleanly, and neither produces a
 * symptom until it is used against you. So the tests below are written as
 * refusals rather than as descriptions.
 *
 * These are static checks on the Terraform. They cannot prove AWS enforces what
 * the file says — for that see `.github/workflows/oidc-verify.yml`, which
 * attempts a real assume-role from a subject that must be refused.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const ROLES = 'infrastructure/oidc/roles.tf'
const MAIN = 'infrastructure/oidc/main.tf'

const roles = fs.readFileSync(ROLES, 'utf8')
const main = fs.readFileSync(MAIN, 'utf8')

/** Comments stripped. A wildcard discussed in prose is not a wildcard granted. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(#|\/\/|\*)/.test(l))
    .join('\n')

const rolesCode = code(roles)

/** Every `condition { ... }` block, as text. */
function conditionBlocks(text) {
  const out = []
  const re = /condition\s*\{/g
  let m
  while ((m = re.exec(text))) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) {
        out.push(text.slice(m.index, i + 1))
        break
      }
    }
  }
  return out
}

const conditions = conditionBlocks(rolesCode)

/**
 * `local.*` values, resolved from main.tf.
 *
 * The subject lists are written as `repo:${local.engine_repo}:ref:...`, so a
 * check that reads them literally would see no repository name at all and pass
 * on anything. Resolving means the wildcard check applies to what AWS will
 * actually receive — including a wildcard smuggled into the local itself.
 */
const LOCALS = Object.fromEntries(
  [...code(main).matchAll(/^\s*(\w+)\s*=\s*"([^"]*)"$/gm)].map((m) => [m[1], m[2]])
)

function resolve(value) {
  return value.replace(/\$\{local\.(\w+)\}/g, (whole, name) => {
    if (!(name in LOCALS)) {
      throw new Error(
        `subject references local.${name}, which is not a literal string in main.tf. ` +
          `A computed subject cannot be checked here — keep it literal.`
      )
    }
    return LOCALS[name]
  })
}

const subConditions = conditions.filter((c) => c.includes(':sub'))
const audConditions = conditions.filter((c) => c.includes(':aud'))

test('every trust policy constrains the subject claim', () => {
  // Three roles, each with exactly one sub condition. A role whose trust omits
  // `sub` trusts every repository on GitHub.
  assert.equal(subConditions.length, 3, 'expected one sub condition per role (read, plan, deploy)')
})

test('subject conditions use StringEquals, never a pattern match', () => {
  for (const block of subConditions) {
    const testLine = block.match(/test\s*=\s*"([^"]+)"/)?.[1]
    assert.equal(
      testLine,
      'StringEquals',
      `a sub condition uses ${testLine}. StringLike/StringNotEquals/ArnLike here turn an exact ` +
        `repository binding into a pattern, which is the whole control:\n${block}`
    )
  }
})

test('no subject value contains a wildcard', () => {
  // `repo:Tenurework/*` trusts any repository someone can create under that
  // owner. `repo:*/Tenure-Parent` trusts every fork. Both are one character.
  const subjectLists = [...rolesCode.matchAll(/^\s*(\w*_subjects)\s*=\s*\[([\s\S]*?)\]/gm)]
  assert.ok(subjectLists.length >= 3, 'could not find the subject lists')

  // GitHub signs this repository's subject with immutable numeric ids appended
  // to the owner and repo — `Tenurework@312546530/Tenure-Parent@1316219596`. The
  // ids are stripped before comparison so the check reads the same either way,
  // and a wildcard is still rejected above regardless of form.
  const ALLOWED_REPOS = ['Tenurework/Tenure-Parent', 'Tenurework/Tenure']
  const withoutIds = (repo) => repo.replace(/@\d+/g, '')

  for (const [, name, body] of subjectLists) {
    for (const raw of [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1])) {
      const value = resolve(raw)
      assert.ok(!value.includes('*'), `${name} contains a wildcard subject: ${value}`)

      const repo = value.match(/^repo:([^:]+\/[^:]+):/)?.[1]
      assert.ok(repo, `${name} contains a subject with no repository: ${value}`)
      assert.ok(
        ALLOWED_REPOS.includes(withoutIds(repo)),
        `${name} trusts ${repo}, which is not a Tenure repository (subject: ${value})`
      )
    }
  }
})

test('every trust policy pins the audience to AWS STS', () => {
  assert.equal(audConditions.length, 3, 'expected one aud condition per role')

  for (const block of audConditions) {
    assert.equal(block.match(/test\s*=\s*"([^"]+)"/)?.[1], 'StringEquals', 'aud must be an exact match')
    const values = [...block.matchAll(/"(sts\.amazonaws\.com)"/g)].map((m) => m[1])
    assert.deepEqual(
      values,
      ['sts.amazonaws.com'],
      `an aud condition does not pin sts.amazonaws.com. Without it, a token minted for a ` +
        `different service that also accepts GitHub OIDC could be replayed here:\n${block}`
    )
  }
})

test('trust is granted to the OIDC provider, never to a bare account or wildcard principal', () => {
  const principals = [...rolesCode.matchAll(/principals\s*\{([\s\S]*?)\}/g)].map((m) => m[1])
  assert.ok(principals.length >= 3, 'could not find the principal blocks')

  for (const block of principals) {
    assert.match(block.trim(), /type\s*=\s*"Federated"/, 'a trust principal is not Federated')
    assert.match(
      block,
      /aws_iam_openid_connect_provider\.github\.arn/,
      `a trust principal does not reference the OIDC provider:\n${block}`
    )
    assert.ok(!/"\*"/.test(block), `a trust principal is a wildcard:\n${block}`)
  }
})

test('the deploy role is bound to a protected environment, not merely to a branch', () => {
  // A branch condition is satisfied by anyone who can push the branch. An
  // environment condition additionally carries whatever reviewers and wait
  // timers that environment has — which is where GE-011-005's human approval
  // actually lives.
  const block = rolesCode.match(/deploy_engine_subjects\s*=\s*\[([\s\S]*?)\]/)?.[1]
  assert.ok(block, 'deploy_engine_subjects not found')

  const values = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1])
  assert.ok(values.length > 0, 'the deploy role trusts no subject at all')

  for (const v of values) {
    assert.match(
      v,
      /:environment:/,
      `the deploy role trusts "${v}", which is not an environment subject. A branch-bound ` +
        `deploy role has no human approval in front of it.`
    )
  }
})

test('the read role cannot read the inside of anything', () => {
  // The inventory writes to a PUBLIC repository. ReadOnlyAccess would let it
  // read secret values and object bodies; ViewOnlyAccess lists and describes.
  // The explicit Deny is what survives someone later attaching a broader policy.
  assert.match(rolesCode, /job-function\/ViewOnlyAccess/, 'the read role is not on ViewOnlyAccess')
  assert.ok(
    !/read_\w*\s*[\s\S]{0,400}?arn:aws:iam::aws:policy\/ReadOnlyAccess/.test(rolesCode),
    'the read role has been widened to ReadOnlyAccess, which can read secret values'
  )

  for (const action of [
    'secretsmanager:GetSecretValue',
    's3:GetObject',
    'kms:Decrypt',
    'dynamodb:Scan',
  ]) {
    assert.ok(rolesCode.includes(`"${action}"`), `the read role's Deny no longer lists ${action}`)
  }
})

test('the deploy role cannot reach the pilot database or its state', () => {
  assert.match(rolesCode, /"rds:\*"/, 'the deploy role no longer denies RDS')
  assert.match(rolesCode, /pilot\/\*/, 'the deploy role no longer denies the pilot state prefix')
  assert.match(rolesCode, /"organizations:\*"/, 'the deploy role no longer denies Organizations')

  // Creating a user or an access key is how a short-lived role becomes a
  // permanent one. That is the escalation OIDC exists to remove.
  for (const action of ['iam:CreateUser', 'iam:CreateAccessKey']) {
    assert.ok(rolesCode.includes(`"${action}"`), `the deploy role's Deny no longer lists ${action}`)
  }
})

test('the deploy role can only manage IAM roles it owns, by name prefix', () => {
  const iamStatement = rolesCode.match(/"iam:CreateRole"[\s\S]{0,900}?Resource\s*=\s*"([^"]+)"/)?.[1]
  assert.ok(iamStatement, 'could not find the deploy role IAM statement')
  assert.ok(
    !iamStatement.endsWith(':role/*') && iamStatement.includes('studio-'),
    `the deploy role can manage IAM roles matching ${iamStatement}. Unprefixed, a compromised ` +
      `deploy can mint an administrator.`
  )
})

test('exactly one OIDC provider is declared, for GitHub, audience sts', () => {
  const mainCode = code(main)
  const providers = [...mainCode.matchAll(/resource\s+"aws_iam_openid_connect_provider"/g)]
  assert.equal(providers.length, 1, 'an account may hold only one provider per URL')

  assert.match(mainCode, /url\s*=\s*"https:\/\/token\.actions\.githubusercontent\.com"/)
  assert.match(mainCode, /client_id_list\s*=\s*\["sts\.amazonaws\.com"\]/)
})

test('sessions are short', () => {
  const durations = [...rolesCode.matchAll(/max_session_duration\s*=\s*(\d+)/g)].map((m) => Number(m[1]))
  assert.equal(durations.length, 3, 'a role does not set max_session_duration')
  for (const d of durations) {
    assert.ok(d <= 3600, `a role allows a ${d}s session; the point of OIDC is that it expires`)
  }
})

/**
 * GE-011-004/006. Which workflows still hold a long-lived key.
 *
 * A ratchet, not a rule: the keys cannot all go at once, because GE-011-006
 * asks for last-use metadata and a separately approved disable checklist first
 * — surprise-revoking a credential breaks whatever was quietly depending on it.
 * So the list below may only shrink. Moving a workflow to OIDC means deleting
 * its entry in the same commit, which is the moment to notice progress.
 */
test('no workflow uses a long-lived key unless it is still on the list', () => {
  const dir = '.github/workflows'
  const STILL_ON_KEYS = new Set([
    'bootstrap-oidc.yml', // by design — it CREATES the roles; GE-011-003
    'deploy-studio.yml',
    'deploy.yml',
    'platform-plan.yml',
    'custom-domain.yml',
    'db-recovery.yml',
    'debug-logs.yml',
    'force-redeploy.yml',
    'ops-status.yml',
    'probe-debug.yml',
    'replace-acm-cert.yml',
    'rotate-auth-secret.yml',
    'seed-reference-data.yml',
    'verify-reminders.yml',
  ])

  const offenders = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.yml')) continue
    const text = fs.readFileSync(`${dir}/${file}`, 'utf8')
    if (!/secrets\.(ACCESSKEYID|SECRETACCESSKEY)/.test(text)) continue
    if (!STILL_ON_KEYS.has(file)) offenders.push(file)
  }

  assert.deepEqual(
    offenders,
    [],
    `these use a long-lived AWS key and are not on the list. Move them to OIDC, or add them with ` +
      `a reason:\n  ${offenders.join('\n  ')}`,
  )

  // The list may only shrink. aws-inventory.yml came off it when GE-011-004
  // switched it to a short-lived role.
  assert.ok(
    !STILL_ON_KEYS.has('aws-inventory.yml'),
    'aws-inventory.yml is back on long-lived keys — that is a regression, not a fix',
  )
  assert.ok(STILL_ON_KEYS.size <= 14, 'the long-lived-key list grew; it may only shrink')
})

test('every workflow that assumes a role can actually mint a token', () => {
  // `id-token: write` is not optional and its absence fails confusingly: the
  // token is never requested, and the error reads "Credentials could not be
  // loaded" as if the role were wrong.
  const dir = '.github/workflows'
  const missing = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.yml')) continue
    const text = fs.readFileSync(`${dir}/${file}`, 'utf8')
    if (!/role-to-assume:/.test(text)) continue
    if (!/id-token:\s*write/.test(text)) missing.push(file)
  }
  assert.deepEqual(missing, [], 'assume a role without id-token: write')
})

/**
 * GE-011-005 — the environments a trust policy names must exist.
 *
 * A role whose trust condition names `environment:engine-production` when no
 * such environment exists is a role nothing can assume. Nothing errors at
 * apply time; the failure surfaces as a permissions error at the moment of a
 * deploy, which is the worst moment to discover it and the furthest point from
 * the mistake.
 *
 * Two halves, because only one of them can be checked without a token:
 *
 *   * here — that `environments.json` and `roles.tf` name the same set, so the
 *     declared list cannot drift from the policy that depends on it
 *   * `ops-status.yml` — that each declared environment actually exists on
 *     GitHub, which needs the API
 */
const ENVIRONMENTS = 'infrastructure/oidc/environments.json'

test('every environment a trust policy names is declared', () => {
  const declared = new Set(
    JSON.parse(fs.readFileSync(ENVIRONMENTS, 'utf8')).environments.map((e) => e.name),
  )

  // Every `repo:<owner>/<repo>:environment:<name>` subject in the roles file.
  const named = new Set(
    [...roles.matchAll(/:environment:([A-Za-z0-9._-]+)"/g)].map((m) => m[1]),
  )

  assert.ok(named.size > 0, 'no environment subject found in roles.tf — the pattern changed')

  const undeclared = [...named].filter((n) => !declared.has(n))
  assert.deepEqual(
    undeclared,
    [],
    `roles.tf trusts environments that ${ENVIRONMENTS} does not declare: ${undeclared.join(', ')}.\n` +
      `Nothing can assume a role whose environment does not exist, and the failure shows up at deploy time.`,
  )

  const unused = [...declared].filter((d) => !named.has(d))
  assert.deepEqual(
    unused,
    [],
    `${ENVIRONMENTS} declares environments no trust policy names: ${unused.join(', ')}.\n` +
      `A declared-but-unused environment is one nobody will notice going missing.`,
  )
})

test('the deploy environment is declared as requiring reviewers', () => {
  // The whole point of binding deployment to an environment rather than a
  // branch. A branch condition is satisfied by anyone who can push; an
  // environment condition is only as protective as the environment's rules, so
  // an environment with no reviewers is a branch condition wearing a hat.
  const declared = JSON.parse(fs.readFileSync(ENVIRONMENTS, 'utf8')).environments
  const deploy = declared.find((e) => e.name === 'engine-production')
  assert.ok(deploy, 'engine-production is not declared')
  assert.equal(
    deploy.requiresReviewers,
    true,
    'engine-production must require reviewers, or binding the deploy role to it protects nothing',
  )
})
