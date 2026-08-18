/**
 * GE-010-005 — the guardrails bite what they are for, and bite nothing the
 * estate needs.
 *
 * Two lists, deliberately paired. `PROHIBITED_ACTIONS` proves each guardrail
 * stops the thing it names; `OPERATIONAL_ACTIONS` proves the set does not stop
 * this estate deploying, reading its own secrets, requesting a certificate or
 * rolling a service. Either list alone is half a test, and the half everyone
 * writes is the first one — which is how a guardrail set gets attached and
 * locks the account out of its own pipeline.
 *
 * An SCP denial cannot be overridden by any IAM policy, and the account that
 * would fix it is the account that is denied. That asymmetry is why the
 * operational half is the one that matters.
 *
 * Run: npm run test:platform
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  OPERATIONAL_ACTIONS,
  attachCommands,
  PROHIBITED_ACTIONS,
  REQUIRED_GUARDRAILS,
  SCP_DIR,
  deniesOnly,
  evaluate,
  globMatch,
  loadGuardrails,
  statementsOf,
} from '../../tools/scp-guardrails.mjs'

const guardrails = loadGuardrails()
const byId = new Map(guardrails.map((g) => [g.id, g]))

test('a guardrail exists for every concern GE-010-005 names', () => {
  // Read from the required list rather than from the directory: a directory can
  // only say what somebody wrote, not what was asked for.
  assert.deepEqual(
    REQUIRED_GUARDRAILS.filter((id) => !byId.has(id)),
    [],
    'a concern the requirement names has no guardrail',
  )
  assert.equal(guardrails.length, REQUIRED_GUARDRAILS.length)
})

test('every guardrail says where its decision came from and what it cannot do', () => {
  for (const g of guardrails) {
    assert.ok(g.sourced_from.length > 0, `${g.id} cites nothing`)
    assert.ok(
      g.limits.length > 0,
      `${g.id} declares no limits. Every control has a boundary; one that claims none is one ` +
        `whose boundary nobody has looked for.`,
    )
    for (const source of g.sourced_from) {
      const file = source.split(' — ')[0].trim()
      if (!file.includes('/')) continue
      assert.ok(fs.existsSync(path.join(SCP_DIR, '..', '..', '..', file)), `${g.id} cites ${file}, which does not exist`)
    }
  }
})

test('no guardrail contains an Allow, because an SCP with one replaces the permitted set', () => {
  // This is the classic way an account is reduced to nothing: attach an SCP that
  // allows three actions, and the account inherits exactly three actions.
  for (const g of guardrails) {
    assert.ok(deniesOnly(g), `${g.id} contains a non-Deny statement`)
  }
})

test('every guardrail declares where it attaches', () => {
  for (const g of guardrails) {
    assert.ok(Array.isArray(g.attach_to) && g.attach_to.length > 0, `${g.id} attaches nowhere`)
  }
})

// ── The boundary bites ──────────────────────────────────────────────────────

test('every prohibited action is denied, by the guardrail that claims it', () => {
  assert.ok(PROHIBITED_ACTIONS.length >= REQUIRED_GUARDRAILS.length)
  for (const item of PROHIBITED_ACTIONS) {
    const result = evaluate(guardrails, item.request)
    assert.equal(result.decision, 'DENY', `${item.what} was ALLOWED`)
    assert.ok(
      result.by.some((b) => b.startsWith(`${item.guardrail}:`)),
      `${item.what} was denied by ${result.by.join(', ')}, not by ${item.guardrail}`,
    )
  }
})

test('every guardrail is exercised by at least one prohibited action', () => {
  // A guardrail nothing tests is a guardrail whose next edit is unreviewed.
  const exercised = new Set(PROHIBITED_ACTIONS.map((p) => p.guardrail))
  assert.deepEqual(REQUIRED_GUARDRAILS.filter((id) => !exercised.has(id)), [])
})

// ── Operational safety ──────────────────────────────────────────────────────

test('the guardrail set denies nothing this estate has to keep doing', () => {
  const broken = []
  for (const item of OPERATIONAL_ACTIONS) {
    const result = evaluate(guardrails, item.request)
    if (result.decision === 'DENY') broken.push(`${item.what} — denied by ${result.by.join(', ')} (${item.evidence})`)
  }
  assert.deepEqual(
    broken,
    [],
    `attaching these guardrails would break the estate:\n  ${broken.join('\n  ')}`,
  )
})

test('every operational action names the file that proves the estate performs it', () => {
  for (const item of OPERATIONAL_ACTIONS) {
    const file = item.evidence.split(' — ')[0].split(';')[0].trim()
    assert.ok(
      fs.existsSync(path.join(SCP_DIR, '..', '..', '..', file)),
      `${item.what} cites ${file}, which does not exist — the list is imagination, not the estate`,
    )
  }
})

test('the two named exceptions are exceptions, not holes', () => {
  // The security administrator may administer detection; nobody else may.
  const admin = 'arn:aws:iam::000000000000:role/tenure-security-admin'
  const other = 'arn:aws:iam::000000000000:role/tenure-gha-deploy-engine'
  assert.equal(
    evaluate(guardrails, { action: 'guardduty:DeleteDetector', 'aws:PrincipalArn': admin }).decision,
    'ALLOW',
  )
  assert.equal(
    evaluate(guardrails, { action: 'guardduty:DeleteDetector', 'aws:PrincipalArn': other }).decision,
    'DENY',
  )

  // The bootstrap role may rewrite the deployment identities; nobody else may.
  const bootstrap = 'arn:aws:iam::000000000000:role/tenure-oidc-bootstrap'
  const target = 'arn:aws:iam::000000000000:role/tenure-gha-deploy-engine'
  assert.equal(
    evaluate(guardrails, { action: 'iam:PutRolePolicy', resource: target, 'aws:PrincipalArn': bootstrap }).decision,
    'ALLOW',
  )
  assert.equal(
    evaluate(guardrails, { action: 'iam:PutRolePolicy', resource: target, 'aws:PrincipalArn': other }).decision,
    'DENY',
  )
})

// ── The region rule, which is the one that drifts ───────────────────────────

test('the declared region allowlist and the condition it compiles to cannot disagree', () => {
  const region = byId.get('region-restriction')
  const condition = statementsOf(region)[0].Condition.StringNotEquals['aws:RequestedRegion']
  assert.deepEqual(
    [...condition].sort(),
    [...region.allowed_regions].sort(),
    'allowed_regions and the SCP condition have drifted; one of them is not what is enforced',
  )
})

test('a global service is reachable from the allowed region and is not region-denied', () => {
  const inRegion = { action: 'ec2:RunInstances', 'aws:RequestedRegion': 'us-east-1' }
  assert.equal(evaluate([byId.get('region-restriction')], inRegion).decision, 'ALLOW')

  // IAM and STS are global. A region rule that denies them denies signing in.
  for (const action of ['iam:GetRole', 'sts:GetCallerIdentity', 'cloudfront:GetDistribution']) {
    assert.equal(
      evaluate([byId.get('region-restriction')], { action, 'aws:RequestedRegion': 'eu-west-1' }).decision,
      'ALLOW',
      `${action} is global and must not be caught by the region rule`,
    )
  }
})

// ── The evaluator itself ────────────────────────────────────────────────────

test('a condition operator nobody implemented throws rather than evaluating to nothing', () => {
  // A guardrail whose condition is silently ignored is a guardrail that denies
  // everything or nothing, and both look like a pass.
  const invented = {
    id: 'x',
    policy: {
      Statement: [
        {
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
          Condition: { NumericLessThan: { 'aws:MultiFactorAuthAge': 300 } },
        },
      ],
    },
  }
  assert.throws(() => evaluate([invented], { action: 's3:GetObject' }), /not implemented/)
})

test('wildcards match the way IAM matches them', () => {
  assert.equal(globMatch('iam:Create*', 'iam:CreateUser'), true)
  assert.equal(globMatch('iam:Create*', 'iam:DeleteUser'), false)
  assert.equal(globMatch('arn:aws:iam::*:role/tenure-gha-*', 'arn:aws:iam::1:role/tenure-gha-plan'), true)
  assert.equal(globMatch('arn:aws:iam::*:role/tenure-gha-*', 'arn:aws:iam::1:role/tenure-studio-task'), false)
  // Case-insensitive, as IAM action matching is.
  assert.equal(globMatch('s3:getobject', 's3:GetObject'), true)
  // A dot is a literal, not "any character" — or `s3:Get.bject` would match.
  assert.equal(globMatch('s3:Get.bject', 's3:GetObject'), false)
})

test('a missing context key does not quietly satisfy a condition', () => {
  const region = byId.get('region-restriction')
  // No aws:RequestedRegion in the request at all: the StringNotEquals cannot be
  // evaluated, so the Deny must not fire. Firing would deny every request whose
  // context this evaluator does not model.
  assert.equal(evaluate([region], { action: 'ec2:RunInstances' }).decision, 'ALLOW')
})

test('NotAction denies everything outside its list, not everything inside it', () => {
  const guardrail = {
    id: 'x',
    policy: { Statement: [{ Effect: 'Deny', NotAction: ['s3:GetObject'], Resource: '*' }] },
  }
  assert.equal(evaluate([guardrail], { action: 's3:GetObject' }).decision, 'ALLOW')
  assert.equal(evaluate([guardrail], { action: 's3:PutObject' }).decision, 'DENY')
})

test('a resource-scoped deny does not reach a resource outside its scope', () => {
  const evidence = byId.get('require-evidence')
  const archive = { action: 's3:DeleteBucket', resource: 'arn:aws:s3:::tenure-log-archive-000000000000' }
  const documents = { action: 's3:DeleteBucket', resource: 'arn:aws:s3:::tenure-pilot-documents-000000000000' }
  assert.equal(evaluate([evidence], archive).decision, 'DENY')
  assert.equal(evaluate([evidence], documents).decision, 'ALLOW')
})

// ── The operator's half ─────────────────────────────────────────────────────

test('the attach commands hand AWS the policy document, not the file that wraps it', () => {
  // The file carries `why`, `limits` and `sourced_from` around the policy, so a
  // reviewer can read the rule. `aws organizations create-policy --content` takes
  // the document alone and rejects the wrapper — a failure that would land on an
  // operator mid-attach rather than here.
  for (const g of guardrails) {
    const [create, ...attach] = attachCommands(g)
    assert.match(create, /--type SERVICE_CONTROL_POLICY/)
    assert.match(create, /jq -c \.policy/, `${g.id}'s create command would send the wrapper`)
    assert.ok(create.includes(g.file))
    assert.equal(attach.length, g.attach_to.length)
    for (const command of attach) assert.match(command, /organizations attach-policy/)
  }
})

test('the commands are emitted, never run', () => {
  // GE-001-007: nothing writes to AWS before the account, region, role and
  // rollback path are known. `attachCommands` returns strings; nothing in this
  // module executes one.
  const source = fs.readFileSync(path.join(SCP_DIR, '..', '..', '..', 'tools', 'scp-guardrails.mjs'), 'utf8')
  for (const runner of ['execSync', 'execFileSync', 'spawnSync', 'child_process']) {
    assert.ok(!source.includes(runner), `scp-guardrails.mjs can execute a command (${runner})`)
  }
})

// ── What this does NOT claim ────────────────────────────────────────────────

test('the guardrails are recorded as attached to nothing, because nothing exists to attach them to', () => {
  // The honest half. These are defined and tested; they are not in effect.
  // If this ever stops being true, it is because an operator created the
  // Organization and attached them — which is GE-010-004, and which will make
  // this assertion the thing that has to be updated deliberately.
  const inventory = JSON.parse(
    fs.readFileSync(path.join(SCP_DIR, '..', '..', '..', 'docs', 'architecture', 'aws-inventory.json'), 'utf8'),
  )
  assert.equal(
    inventory.organization.inUse,
    false,
    'an Organization now exists — attach these guardrails and record it here',
  )
})
