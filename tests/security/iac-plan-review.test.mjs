/**
 * GE-012-003 — the change-set review, proven against the shapes a plan actually
 * has.
 *
 * Every fixture below is `terraform show -json` output: `format_version`,
 * `resource_changes[].change.{actions,before,after,after_unknown,replace_paths}`,
 * `action_reason`. Nothing is a simplified stand-in, because the two things this
 * review has to get right — a computed attribute and a removed Deny — only exist
 * in that shape.
 *
 * The assertion this file cares most about is the negative one: an attribute
 * terraform has not decided yet must produce an UNDETERMINED finding, never
 * silence. A reviewer who reads "no findings" on a plan whose security-group
 * CIDRs come from a variable has been told something false.
 *
 * Run: npm run test:platform
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  ADMIN_POLICY_ARNS,
  HOURS_PER_MONTH,
  SEVERITY,
  actionableChanges,
  canonicalJson,
  changeKind,
  denyPairs,
  destructiveFindings,
  estimateCost,
  parsePlan,
  policyScanFindings,
  privilegeExpansionFindings,
  publicAccessFindings,
  readAfter,
  renderMarkdown,
  replacementFindings,
  requiredTagKeys,
  reviewPlan,
  sealReview,
  unboundedAllowStatements,
  wildcardPrincipalStatements,
} from '../../tools/iac-plan-review.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

/** A plan with the given resource changes, in the real envelope. */
const planOf = (...changes) => ({
  format_version: '1.2',
  terraform_version: '1.9.5',
  resource_changes: changes,
})

const change = (address, type, actions, { before = null, after = null, unknown = {}, ...rest } = {}) => ({
  address,
  mode: 'managed',
  type,
  name: address.split('.').pop(),
  provider_name: 'registry.terraform.io/hashicorp/aws',
  change: { actions, before, after, after_unknown: unknown, ...rest },
})

const of = (findings, detector) => findings.filter((f) => f.detector === detector)
const bySeverity = (findings, severity) => findings.filter((f) => f.severity === severity)

// ── Reading the plan ────────────────────────────────────────────────────────

test('refuses the human plan output rather than reviewing nothing', () => {
  // The text `terraform plan` prints. Parsing this as "no changes" is the worst
  // possible failure: it is indistinguishable from a clean plan.
  assert.throws(
    () => parsePlan('Terraform will perform the following actions:\n  # aws_db_instance.pilot'),
    /not JSON/,
  )
  assert.throws(() => parsePlan(JSON.stringify({ resource_changes: [] })), /no format_version/)
})

test('refuses a plan format it has not been read against', () => {
  assert.throws(
    () => parsePlan(JSON.stringify({ format_version: '2.0', resource_changes: [] })),
    /not supported/,
  )
})

test('a plan with nothing to do is a real answer, not a malformed one', () => {
  const plan = parsePlan(JSON.stringify({ format_version: '1.2', terraform_version: '1.9.5' }))
  assert.deepEqual(plan.resource_changes, [])
  assert.equal(reviewPlan(plan, { tagKeys: [], allowedRegions: ['us-east-1'] }).verdict, 'CLEAN')
})

test('"nothing wrong" and "nothing checked" are different verdicts', () => {
  const empty = parsePlan(JSON.stringify({ format_version: '1.2', terraform_version: '1.9.5' }))
  const unchecked = reviewPlan(empty, {})
  assert.equal(unchecked.verdict, 'CLEAN_UNCHECKED')
  assert.deepEqual(unchecked.uncheckedRules.sort(), ['region-allowlist', 'required-tags'])
  assert.equal(reviewPlan(empty, { tagKeys: [], allowedRegions: ['us-east-1'] }).verdict, 'CLEAN')
})

test('classifies the six actions a change set can carry', () => {
  assert.equal(changeKind(['create']), 'create')
  assert.equal(changeKind(['update']), 'update')
  assert.equal(changeKind(['delete']), 'delete')
  assert.equal(changeKind(['delete', 'create']), 'replace')
  assert.equal(changeKind(['create', 'delete']), 'replace') // create_before_destroy
  assert.equal(changeKind(['no-op']), 'no-op')
})

test('no-op, read and data changes are not changes', () => {
  const plan = planOf(
    change('aws_s3_bucket.a', 'aws_s3_bucket', ['no-op']),
    change('data.aws_caller_identity.me', 'aws_caller_identity', ['read']),
    change('aws_s3_bucket.b', 'aws_s3_bucket', ['create'], { after: {} }),
  )
  plan.resource_changes[1].mode = 'data'
  assert.deepEqual(
    actionableChanges(plan).map((c) => c.address),
    ['aws_s3_bucket.b'],
  )
})

test('an attribute terraform has not decided reads as unknown, not as absent', () => {
  const c = {
    after: { ingress: [{ cidr_blocks: null }] },
    after_unknown: { ingress: [{ cidr_blocks: true }] },
  }
  assert.deepEqual(readAfter(c, ['ingress', 0, 'cidr_blocks']), { known: false })
  // Genuinely unset is a different answer from unknown.
  assert.deepEqual(readAfter({ after: { acl: undefined }, after_unknown: {} }, ['acl']), {
    known: true,
    value: undefined,
  })
})

// ── Destructive ─────────────────────────────────────────────────────────────

test('deleting a data-bearing resource blocks; deleting a rule does not', () => {
  const plan = planOf(
    change('aws_db_instance.pilot', 'aws_db_instance', ['delete'], {
      before: { identifier: 'tenure-pilot-db' },
      ...{ action_reason: 'delete_because_no_resource_config' },
    }),
    change('aws_security_group_rule.old', 'aws_security_group_rule', ['delete'], {
      before: { type: 'ingress' },
    }),
  )
  plan.resource_changes[0].action_reason = 'delete_because_no_resource_config'

  const findings = destructiveFindings(plan)
  assert.equal(findings.length, 2)

  const db = findings.find((f) => f.type === 'aws_db_instance')
  assert.equal(db.severity, SEVERITY.BLOCKING)
  assert.equal(db.stateful, true)
  assert.equal(db.reason, 'delete_because_no_resource_config')

  const rule = findings.find((f) => f.type === 'aws_security_group_rule')
  assert.equal(rule.severity, SEVERITY.REVIEW)
  assert.equal(rule.stateful, false)
})

// ── Replacement ─────────────────────────────────────────────────────────────

test('a replacement names the attribute that forced it', () => {
  const plan = planOf(
    change('aws_db_instance.pilot', 'aws_db_instance', ['delete', 'create'], {
      before: { identifier: 'tenure-pilot-db' },
      after: { identifier: 'tenure-pilot-database' },
      replace_paths: [['identifier']],
    }),
  )
  const [f] = replacementFindings(plan)
  assert.equal(f.severity, SEVERITY.BLOCKING)
  assert.deepEqual(f.forcedBy, ['identifier'])
  assert.equal(f.createBeforeDestroy, false)
  assert.match(f.detail, /destroys and recreates/)
})

test('create_before_destroy is recorded as such', () => {
  const plan = planOf(
    change('aws_lb.studio', 'aws_lb', ['create', 'delete'], {
      before: { name: 'a' },
      after: { name: 'b' },
      replace_paths: [['name']],
    }),
  )
  const [f] = replacementFindings(plan)
  assert.equal(f.createBeforeDestroy, true)
  assert.equal(f.severity, SEVERITY.REVIEW)
})

// ── Public access ───────────────────────────────────────────────────────────

test('a security group open to the internet blocks', () => {
  const plan = planOf(
    change('aws_security_group.alb', 'aws_security_group', ['create'], {
      after: { ingress: [{ cidr_blocks: ['0.0.0.0/0'], ipv6_cidr_blocks: [] }] },
      unknown: { ingress: [{}] },
    }),
  )
  const findings = publicAccessFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
  assert.equal(findings[0].attribute, 'ingress.0.cidr_blocks')
})

test('a security group whose CIDRs are computed reports UNDETERMINED, not clean', () => {
  const plan = planOf(
    change('aws_security_group.alb', 'aws_security_group', ['create'], {
      after: { ingress: [{ cidr_blocks: null, ipv6_cidr_blocks: [] }] },
      unknown: { ingress: [{ cidr_blocks: true }] },
    }),
  )
  const findings = publicAccessFindings(plan)
  const undetermined = findings.filter((f) => f.determinacy === 'undetermined')
  assert.equal(undetermined.length, 1)
  assert.equal(undetermined[0].severity, SEVERITY.REVIEW)
  assert.match(undetermined[0].detail, /decided by the apply/)
  // And the review as a whole is not CLEAN, which is the point.
  assert.equal(reviewPlan(plan, { tagKeys: [], allowedRegions: ['us-east-1'] }).verdict, 'REVIEW')
})

test('turning off a public-access block is an exposure', () => {
  const plan = planOf(
    change('aws_s3_bucket_public_access_block.docs', 'aws_s3_bucket_public_access_block', ['update'], {
      before: { block_public_acls: true, block_public_policy: true, ignore_public_acls: true, restrict_public_buckets: true },
      after: { block_public_acls: false, block_public_policy: true, ignore_public_acls: true, restrict_public_buckets: true },
    }),
  )
  const findings = publicAccessFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
  assert.match(findings[0].detail, /block_public_acls is false/)
})

test('DELETING the guard is an exposure the end state cannot show', () => {
  // There is no `after` here at all. A detector that only reads the planned end
  // state sees nothing, and the estate loses its public-access block.
  const plan = planOf(
    change('aws_s3_bucket_public_access_block.docs', 'aws_s3_bucket_public_access_block', ['delete'], {
      before: { block_public_acls: true },
    }),
  )
  const findings = of(publicAccessFindings(plan), 'public-access')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
  assert.match(findings[0].detail, /exists to prevent exposure/)
})

test('a bucket policy granting everyone blocks; the same policy with a condition is read by a human', () => {
  const open = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' }],
  }
  const conditioned = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: '*' },
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::b/*',
        Condition: { StringEquals: { 'aws:SourceVpce': 'vpce-1' } },
      },
    ],
  }
  assert.deepEqual(wildcardPrincipalStatements(open), [{ index: 0, conditioned: false }])
  assert.deepEqual(wildcardPrincipalStatements(conditioned), [{ index: 0, conditioned: true }])

  const plan = planOf(
    change('aws_s3_bucket_policy.open', 'aws_s3_bucket_policy', ['create'], {
      after: { policy: JSON.stringify(open) },
    }),
    change('aws_s3_bucket_policy.vpce', 'aws_s3_bucket_policy', ['create'], {
      after: { policy: JSON.stringify(conditioned) },
    }),
  )
  const findings = publicAccessFindings(plan)
  assert.equal(bySeverity(findings, SEVERITY.BLOCKING).length, 1)
  assert.equal(bySeverity(findings, SEVERITY.REVIEW).length, 1)
})

test('a publicly addressable database blocks', () => {
  const plan = planOf(
    change('aws_db_instance.pilot', 'aws_db_instance', ['update'], {
      before: { publicly_accessible: false },
      after: { publicly_accessible: true },
    }),
  )
  const findings = publicAccessFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
})

// ── Privilege expansion ─────────────────────────────────────────────────────

test('recognises the four shapes of an unbounded Allow', () => {
  const admin = { Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] }
  const notAction = { Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] }
  const passRole = { Statement: [{ Effect: 'Allow', Action: ['iam:PassRole'], Resource: '*' }] }
  const scoped = {
    Statement: [{ Effect: 'Allow', Action: ['s3:GetObject'], Resource: 'arn:aws:s3:::b/*' }],
  }

  assert.equal(unboundedAllowStatements(admin).length, 1)
  assert.ok(unboundedAllowStatements(admin)[0].problems.includes('allows every action'))
  assert.equal(unboundedAllowStatements(notAction).length, 1)
  assert.equal(unboundedAllowStatements(passRole).length, 1)
  assert.deepEqual(unboundedAllowStatements(scoped), [])
})

test('a removed explicit Deny is an escalation nothing in the diff shows as an Allow', () => {
  // The exact pattern infrastructure/oidc/roles.tf depends on: the deploy role
  // is denied rds:* and the pilot state prefix, and an explicit Deny is the only
  // grant a later Allow cannot override. Dropping it grants without adding one.
  const before = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ecs:*'], Resource: '*' },
      { Effect: 'Deny', Action: ['rds:*'], Resource: '*' },
      { Effect: 'Deny', Action: ['s3:*'], Resource: 'arn:aws:s3:::state/pilot/*' },
    ],
  }
  const after = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ecs:*'], Resource: '*' },
      { Effect: 'Deny', Action: ['rds:*'], Resource: '*' },
    ],
  }
  assert.equal(denyPairs(before).size, 2)
  assert.equal(denyPairs(after).size, 1)

  const plan = planOf(
    change('aws_iam_role_policy.deploy', 'aws_iam_role_policy', ['update'], {
      before: { policy: JSON.stringify(before) },
      after: { policy: JSON.stringify(after) },
    }),
  )
  const findings = privilegeExpansionFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
  assert.deepEqual(findings[0].dropped, ['s3:*|arn:aws:s3:::state/pilot/*'])
})

test('attaching AdministratorAccess blocks; attaching a scoped policy does not', () => {
  const plan = planOf(
    change('aws_iam_role_policy_attachment.admin', 'aws_iam_role_policy_attachment', ['create'], {
      after: { policy_arn: ADMIN_POLICY_ARNS[0] },
    }),
    change('aws_iam_role_policy_attachment.ro', 'aws_iam_role_policy_attachment', ['create'], {
      after: { policy_arn: 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess' },
    }),
  )
  const findings = privilegeExpansionFindings(plan)
  assert.equal(findings.length, 1)
  assert.match(findings[0].detail, /AdministratorAccess/)
})

test('removing a permissions boundary blocks', () => {
  const plan = planOf(
    change('aws_iam_role.task', 'aws_iam_role', ['update'], {
      before: { permissions_boundary: 'arn:aws:iam::1:policy/b', assume_role_policy: '{}' },
      after: { permissions_boundary: '', assume_role_policy: '{}' },
    }),
  )
  const findings = privilegeExpansionFindings(plan)
  assert.equal(findings.filter((f) => f.attribute === 'permissions_boundary').length, 1)
})

test('a long-lived credential blocks, because OIDC is how this estate deploys', () => {
  const plan = planOf(change('aws_iam_access_key.ci', 'aws_iam_access_key', ['create'], { after: {} }))
  const findings = privilegeExpansionFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, SEVERITY.BLOCKING)
})

test('a policy document computed at apply time is UNDETERMINED, not approved', () => {
  const plan = planOf(
    change('aws_iam_policy.generated', 'aws_iam_policy', ['create'], {
      after: { policy: null },
      unknown: { policy: true },
    }),
  )
  const findings = privilegeExpansionFindings(plan)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].determinacy, 'undetermined')
  assert.equal(findings[0].severity, SEVERITY.REVIEW)
})

// ── Policy scans ────────────────────────────────────────────────────────────

test('the required tag vocabulary is read from the declaration, not restated', () => {
  const keys = requiredTagKeys()
  const declared = fs.readFileSync(
    path.join(ROOT, 'packages', 'provisioning', 'src', 'resource-tags.ts'),
    'utf8',
  )
  assert.ok(keys.length > 0)
  for (const key of keys) assert.ok(declared.includes(`"${key}"`), `${key} is not declared`)
  assert.ok(keys.includes('tenure:tenant'))
})

test('a resource missing required tags is reported by the keys it is missing', () => {
  const keys = ['tenure:tenant', 'tenure:cost-center']
  const plan = planOf(
    change('aws_sqs_queue.jobs', 'aws_sqs_queue', ['create'], {
      after: { tags_all: { 'tenure:tenant': 'tenure:shared' } },
    }),
  )
  const findings = of(policyScanFindings(plan, { tagKeys: keys, allowedRegions: ['us-east-1'] }), 'policy-scan')
  const tagFinding = findings.find((f) => f.rule === 'required-tags')
  assert.deepEqual(tagFinding.missing, ['tenure:cost-center'])
})

test('a resource that takes no tags is not accused of being untagged', () => {
  const plan = planOf(
    change('aws_iam_role_policy_attachment.x', 'aws_iam_role_policy_attachment', ['create'], {
      after: { policy_arn: 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess' },
    }),
  )
  const findings = policyScanFindings(plan, { tagKeys: ['tenure:tenant'], allowedRegions: ['us-east-1'] })
  assert.deepEqual(findings.filter((f) => f.rule === 'required-tags'), [])
})

test('no region allowlist reports itself unchecked instead of passing', () => {
  const plan = planOf(
    change('aws_sqs_queue.jobs', 'aws_sqs_queue', ['create'], {
      after: { arn: 'arn:aws:sqs:eu-west-1:1:jobs', tags_all: {} },
    }),
  )
  const unchecked = policyScanFindings(plan, { tagKeys: [] }).find((f) => f.rule === 'region-allowlist')
  assert.equal(unchecked.determinacy, 'unchecked')
  assert.equal(unchecked.severity, SEVERITY.NOTE)

  const checked = policyScanFindings(plan, { tagKeys: [], allowedRegions: ['us-east-1'] })
  const violation = checked.find((f) => f.rule === 'region-allowlist')
  assert.equal(violation.severity, SEVERITY.BLOCKING)
  assert.equal(violation.region, 'eu-west-1')
})

test('a log group with no retention, an unencrypted volume and a disabled deletion guard are all caught', () => {
  const plan = planOf(
    change('aws_cloudwatch_log_group.app', 'aws_cloudwatch_log_group', ['create'], {
      after: { name: '/ecs/x', tags_all: {} },
    }),
    change('aws_ebs_volume.data', 'aws_ebs_volume', ['create'], {
      after: { encrypted: false, size: 100, type: 'gp3', tags_all: {} },
    }),
    change('aws_db_instance.pilot', 'aws_db_instance', ['update'], {
      before: { deletion_protection: true },
      after: { deletion_protection: false, tags_all: {} },
    }),
  )
  const rules = policyScanFindings(plan, { tagKeys: [], allowedRegions: ['us-east-1'] }).map((f) => f.rule)
  assert.ok(rules.includes('log-retention'))
  assert.ok(rules.includes('encryption-at-rest'))
  assert.ok(rules.includes('deletion-protection'))
})

// ── Cost ────────────────────────────────────────────────────────────────────

const twoNats = planOf(
  change('aws_nat_gateway.a', 'aws_nat_gateway', ['create'], { after: {} }),
  change('aws_nat_gateway.b', 'aws_nat_gateway', ['create'], { after: {} }),
)

test('with no rate card the estimate reports units and says why there is no money', () => {
  const cost = estimateCost(twoNats, null)
  assert.equal(cost.state, 'NOT_PRICED')
  assert.deepEqual(cost.missing, ['rate card'])
  assert.deepEqual(cost.dimensions, [
    { dimension: 'nat-gateway-hours', units: 2 * HOURS_PER_MONTH },
  ])
  assert.match(cost.why, /no price table is checked into this repository/i)
})

test('a rate card that covers every dimension produces a total that is arithmetic', () => {
  const cost = estimateCost(twoNats, {
    currency: 'USD',
    source: 'operator quote 2026-08',
    rates: { 'nat-gateway-hours': 0.045 },
  })
  assert.equal(cost.state, 'PRICED')
  // 2 gateways x 730 h x 0.045 = 65.70. Arithmetic over the fixture, not a
  // number measured on this machine.
  assert.equal(cost.monthlyDelta, 65.7)
  assert.equal(cost.complete, true)
})

test('a rate card with a hole says which dimension, and refuses to total the rest', () => {
  const plan = planOf(
    change('aws_nat_gateway.a', 'aws_nat_gateway', ['create'], { after: {} }),
    change('aws_db_instance.pilot', 'aws_db_instance', ['create'], {
      after: { instance_class: 'db.t3.micro', allocated_storage: 20, storage_type: 'gp3' },
    }),
  )
  const cost = estimateCost(plan, { currency: 'USD', source: 'partial', rates: { 'nat-gateway-hours': 0.045 } })
  assert.equal(cost.state, 'NOT_PRICED')
  assert.deepEqual(cost.missing.sort(), [
    'rds-instance-hours:db.t3.micro',
    'rds-storage-gb-month:gp3',
  ])
  assert.equal(cost.monthlyDelta, undefined)
})

test('removing a resource is a negative delta, and a resized one is the difference', () => {
  const plan = planOf(
    change('aws_nat_gateway.a', 'aws_nat_gateway', ['delete'], { before: {} }),
    change('aws_ebs_volume.data', 'aws_ebs_volume', ['update'], {
      before: { size: 100, type: 'gp3' },
      after: { size: 250, type: 'gp3' },
    }),
  )
  const cost = estimateCost(plan, null)
  const byDimension = Object.fromEntries(cost.dimensions.map((d) => [d.dimension, d.units]))
  assert.equal(byDimension['nat-gateway-hours'], -HOURS_PER_MONTH)
  assert.equal(byDimension['ebs-gb-month:gp3'], 150)
})

test('a usage-priced resource is named, not counted as free', () => {
  const plan = planOf(
    change('aws_cloudfront_distribution.cdn', 'aws_cloudfront_distribution', ['create'], { after: {} }),
    change('aws_wafv2_web_acl.x', 'aws_wafv2_web_acl', ['create'], { after: {} }),
  )
  const cost = estimateCost(plan, { currency: 'USD', source: 's', rates: {} })
  assert.equal(cost.state, 'PRICED')
  assert.equal(cost.monthlyDelta, 0)
  assert.equal(cost.complete, false, 'a zero total with unpriced resources must not read as complete')
  assert.deepEqual(cost.usagePriced.map((u) => u.address), ['aws_cloudfront_distribution.cdn'])
  assert.deepEqual(cost.unmodelled.map((u) => u.type), ['aws_wafv2_web_acl'])
})

test('a price-deciding attribute that is computed makes the estimate incomplete', () => {
  const plan = planOf(
    change('aws_db_instance.pilot', 'aws_db_instance', ['create'], {
      after: { instance_class: null, allocated_storage: 20, storage_type: 'gp3' },
      unknown: { instance_class: true },
    }),
  )
  const cost = estimateCost(plan, null)
  assert.equal(cost.undetermined.length, 1)
  assert.deepEqual(cost.undetermined[0].attributes, ['instance_class'])
  assert.match(cost.undetermined[0].why, /computed at apply time/)
})

test('an unknown that does not decide a price does not make the estimate incomplete', () => {
  // Terraform marks `id` unknown on every create. A list that flags every
  // resource is a list nobody reads.
  const plan = planOf(
    change('aws_nat_gateway.a', 'aws_nat_gateway', ['create'], {
      after: { tags_all: {} },
      unknown: { id: true, network_interface_id: true },
    }),
  )
  assert.deepEqual(estimateCost(plan, null).undetermined, [])
})

// ── Verdict, evidence, rendering ────────────────────────────────────────────

test('the verdict is BLOCK on a blocking finding and REVIEW on anything else', () => {
  const clean = reviewPlan(planOf(), { tagKeys: [], allowedRegions: ['us-east-1'] })
  assert.equal(clean.verdict, 'CLEAN')

  const reviewOnly = reviewPlan(
    planOf(change('aws_lb.pub', 'aws_lb', ['create'], { after: { internal: false, tags_all: {} } })),
    { tagKeys: [], allowedRegions: ['us-east-1'] },
  )
  assert.equal(reviewOnly.verdict, 'REVIEW')

  const blocked = reviewPlan(
    planOf(change('aws_db_instance.pilot', 'aws_db_instance', ['delete'], { before: {} })),
    { tagKeys: [], allowedRegions: ['us-east-1'] },
  )
  assert.equal(blocked.verdict, 'BLOCK')
  assert.equal(blocked.counts.blocking, 1)
})

test('the seal is deterministic and binds the review to the exact plan bytes', () => {
  const text = JSON.stringify(
    planOf(change('aws_db_instance.pilot', 'aws_db_instance', ['delete'], { before: {} })),
  )
  const review = reviewPlan(parsePlan(text), { tagKeys: [], allowedRegions: ['us-east-1'] })

  const a = sealReview(text, review)
  const b = sealReview(text, review)
  assert.deepEqual(a, b, 'two reviewers of one plan must produce one seal')
  assert.match(a.planSha256, /^[0-9a-f]{64}$/)

  // The same review presented against different bytes does not verify.
  const other = sealReview(`${text} `, review)
  assert.notEqual(other.planSha256, a.planSha256)
  assert.notEqual(
    other.reviewSha256,
    a.reviewSha256,
    'the review digest must cover the plan digest, or a seal can be moved between plans',
  )
})

test('canonical JSON does not depend on key order', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }))
})

test('a value the provider marked sensitive is withheld even where quoting it would help', () => {
  // The ACL detector quotes what it found, because "acl is public-read" is the
  // whole finding. `describeValue` is the single door that quoting goes through,
  // so a provider that marks the attribute sensitive is obeyed once rather than
  // in every detector.
  const plan = planOf(
    change('aws_s3_bucket_acl.docs', 'aws_s3_bucket_acl', ['create'], {
      after: { acl: 'public-read-secret-name' },
      after_sensitive: { acl: true },
    }),
  )
  const [f] = publicAccessFindings(plan)
  assert.equal(f.severity, SEVERITY.BLOCKING, 'it is still a finding')
  assert.ok(!f.detail.includes('public-read-secret-name'), 'a sensitive value was quoted')
  assert.match(f.detail, /withheld/)

  // And when the provider does not mark it, the value is reported — otherwise
  // the finding says nothing an operator can act on.
  const plain = planOf(
    change('aws_s3_bucket_acl.docs', 'aws_s3_bucket_acl', ['create'], { after: { acl: 'public-read' } }),
  )
  assert.match(publicAccessFindings(plain)[0].detail, /public-read/)
})

test('the rendered report never contains a value from the plan', () => {
  const SECRET = 'pilot-db-password-do-not-print'
  const plan = planOf(
    change('aws_db_instance.pilot', 'aws_db_instance', ['update'], {
      before: { password: SECRET, publicly_accessible: false },
      after: { password: SECRET, publicly_accessible: true, tags_all: {} },
      after_sensitive: { password: true },
    }),
  )
  const review = reviewPlan(plan, { tagKeys: [], allowedRegions: ['us-east-1'] })
  const markdown = renderMarkdown(review, sealReview(JSON.stringify(plan), review))

  assert.ok(markdown.includes('aws_db_instance.pilot'), 'the address must be reported')
  assert.ok(!markdown.includes(SECRET), 'a plan value reached the artifact')
  assert.match(markdown, /BLOCK/)
})

// ── The caller ──────────────────────────────────────────────────────────────

test('the plan workflow generates machine-readable output and runs this review over it', () => {
  // A detector nothing runs is a detector that does not exist. This is the wiring:
  // platform-plan.yml must save the plan, convert it with `terraform show -json`,
  // and hand it to this module.
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'platform-plan.yml'), 'utf8')
  assert.match(workflow, /terraform show -json/, 'the plan is never converted to the reviewable form')
  assert.match(workflow, /tools\/iac-plan-review\.mjs/, 'nothing runs the review')
  assert.match(workflow, /plan\.json/, 'the review has no input')
  // And the evidence has to leave the runner, or "immutable evidence" is a log line.
  assert.match(workflow, /upload-artifact/)
  assert.match(workflow, /change-set-review\.md/)
})

// That the plan workflow is still read-only after gaining `-out` and
// `terraform show` is NOT re-asserted here. `tests/security/production-workflows-disarmed.test.mjs`
// already owns that property — platform-plan.yml:plan is on its read-only
// allowlist and is checked against its MUTATING patterns. A second, weaker copy
// of that rule in this file would be a rule that can disagree with the one that
// matters, and the first version of it did: it matched the words "terraform
// apply" inside the workflow's own comment explaining that it never runs one.
