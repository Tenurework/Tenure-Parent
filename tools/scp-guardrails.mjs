#!/usr/bin/env node
/**
 * GE-010-005 — the Organization's guardrails, and the evaluator that proves they
 * are safe to attach.
 *
 * The item asks for SCPs covering region restrictions, public resource
 * prevention, disabling security services, leaving the organization, root use,
 * unapproved IAM escalation and required evidence — "tested for operational
 * safety". The policies live in `infrastructure/organization/scp/*.json`, one
 * file per guardrail, each carrying what it is for, where its decision came from
 * and — the part that matters most — what it CANNOT express.
 *
 * ── Why this is not blocked on the Organization ─────────────────────────────
 *
 * There is no AWS Organization yet, and creating one waits on four operator
 * decisions ADR-0007 names: which account becomes the management account, the
 * consolidated-billing arrangement, root emails and tax details, and what
 * happens to the account running the live pilot. None of those four appears in
 * any guardrail here, and none is needed to write or to test one. Attaching
 * these is GE-010-004's account-vending baseline and is still blocked; DEFINING
 * them, which is what this item asks for, is not.
 *
 * ── Operational safety is the hard half ─────────────────────────────────────
 *
 * The dangerous SCP is not the one that misses an attack. It is the one that
 * locks the estate out of its own deployment at 2am, because an SCP denial
 * cannot be overridden by any IAM policy and the account that would fix it is
 * the account that is denied. So `OPERATIONAL_ACTIONS` lists what this estate
 * genuinely does — each entry naming the file that proves the estate does it —
 * and the test asserts the guardrail set denies none of them.
 *
 * That is why `iam:CreateRole` is not denied and `s3:PutBucketPublicAccessBlock`
 * is not denied: the first is how the engine's deploy role creates its own task
 * roles, the second is how a bucket is created private. Both appear in guardrail
 * sets written from a template, and both would break this estate.
 *
 * ── An SCP with an Allow in it is a trap ────────────────────────────────────
 *
 * An SCP does not grant. Attaching one that contains an `Allow` REPLACES the
 * permitted set inherited from `FullAWSAccess` with exactly that list, which is
 * the standard way an account is accidentally reduced to nothing. Every file
 * here is deny-only, and `deniesOnly` is asserted rather than assumed.
 *
 * Usage:
 *   node tools/scp-guardrails.mjs                        list the guardrails
 *   node tools/scp-guardrails.mjs --check <action> [region] [principalArn]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

export const SCP_DIR = path.join(ROOT, 'infrastructure', 'organization', 'scp')

/**
 * The seven concerns GE-010-005 names, as ids.
 *
 * Kept as a list so "a guardrail exists for every concern the item names" is a
 * test rather than a reading of the directory. A directory can only tell you
 * what somebody wrote; this says what was asked for.
 */
export const REQUIRED_GUARDRAILS = [
  'region-restriction',
  'prevent-public-resources',
  'protect-security-services',
  'prevent-leaving-organization',
  'prevent-root-use',
  'prevent-iam-escalation',
  'require-evidence',
]

export function loadGuardrails(dir = SCP_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return files.map((file) => {
    const guardrail = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const key of ['id', 'title', 'why', 'sourced_from', 'limits', 'policy']) {
      if (guardrail[key] === undefined) {
        throw new Error(`${file} has no ${key}. A guardrail without one is a rule nobody can review.`)
      }
    }
    if (guardrail.id !== path.basename(file, '.json')) {
      throw new Error(`${file} declares id "${guardrail.id}"; the file name is the id an operator attaches by`)
    }
    return { ...guardrail, file }
  })
}

export const statementsOf = (guardrail) => {
  const raw = guardrail.policy?.Statement
  return Array.isArray(raw) ? raw : raw ? [raw] : []
}

/** True when a guardrail only ever denies — see the header. */
export const deniesOnly = (guardrail) =>
  statementsOf(guardrail).length > 0 && statementsOf(guardrail).every((s) => s.Effect === 'Deny')

// ── Evaluation ──────────────────────────────────────────────────────────────

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

/** IAM wildcard matching: `*` any run, `?` one character. Case-insensitive, as IAM is. */
export function globMatch(pattern, value) {
  if (typeof pattern !== 'string' || typeof value !== 'string') return false
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const expression = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  return new RegExp(expression, 'i').test(value)
}

/**
 * The condition operators these guardrails use, and only those.
 *
 * An operator that is not implemented THROWS. The alternative — treating an
 * unrecognised condition as not-matching — silently turns a guardrail into a
 * no-op, which is the same failure as deleting it and looks like a pass.
 */
export const CONDITION_OPERATORS = {
  StringEquals: (context, expected) => asList(expected).some((e) => context === e),
  StringNotEquals: (context, expected) => !asList(expected).some((e) => context === e),
  StringLike: (context, expected) => asList(expected).some((e) => globMatch(e, context)),
  StringNotLike: (context, expected) => !asList(expected).some((e) => globMatch(e, context)),
  ArnLike: (context, expected) => asList(expected).some((e) => globMatch(e, context)),
  ArnNotLike: (context, expected) => !asList(expected).some((e) => globMatch(e, context)),
  Bool: (context, expected) => asList(expected).some((e) => String(context) === String(e)),
}

function conditionHolds(condition, request) {
  if (condition === undefined) return true
  for (const [rawOperator, tests] of Object.entries(condition)) {
    const ifExists = rawOperator.endsWith('IfExists')
    const operator = ifExists ? rawOperator.slice(0, -'IfExists'.length) : rawOperator
    const evaluate = CONDITION_OPERATORS[operator]
    if (!evaluate) {
      throw new Error(
        `condition operator "${rawOperator}" is not implemented. A guardrail using it would be ` +
          `evaluated as if the condition were absent, which silently changes what it denies.`,
      )
    }
    for (const [key, expected] of Object.entries(tests)) {
      const value = request[key]
      if (value === undefined) {
        // Missing key: IfExists passes, a plain operator does not match.
        if (ifExists) continue
        return false
      }
      if (!evaluate(value, expected)) return false
    }
  }
  return true
}

function statementMatches(statement, request) {
  const action = request['aws:Action'] ?? request.action
  const resource = request['aws:Resource'] ?? request.resource ?? '*'

  const actions = asList(statement.Action)
  const notActions = asList(statement.NotAction)
  const actionMatches =
    notActions.length > 0
      ? !notActions.some((p) => globMatch(p, action))
      : actions.some((p) => globMatch(p, action))
  if (!actionMatches) return false

  const resources = asList(statement.Resource)
  const notResources = asList(statement.NotResource)
  const resourceMatches =
    notResources.length > 0
      ? !notResources.some((p) => globMatch(p, resource))
      : resources.length === 0 || resources.some((p) => globMatch(p, resource))
  if (!resourceMatches) return false

  return conditionHolds(statement.Condition, request)
}

/**
 * What the guardrail set does to one request.
 *
 * These files are deny-only and are attached alongside `FullAWSAccess`, so the
 * permitted set is everything the IAM policies allow minus what matches a Deny
 * here. Modelling the FullAWSAccess allow explicitly would add a term that is
 * true in every evaluation; `deniesOnly` is asserted instead, so the assumption
 * this rests on is checked rather than embedded.
 */
export function evaluate(guardrails, request) {
  const by = []
  for (const guardrail of guardrails) {
    for (const statement of statementsOf(guardrail)) {
      if (statement.Effect !== 'Deny') continue
      if (statementMatches(statement, request)) {
        by.push(`${guardrail.id}:${statement.Sid ?? '(unnamed)'}`)
      }
    }
  }
  return { decision: by.length > 0 ? 'DENY' : 'ALLOW', by }
}

// ── Operational safety ──────────────────────────────────────────────────────

/**
 * A placeholder account number, and deliberately not a real one.
 *
 * The inventory masks the live account (`aws-inventory.json` records `1549…97`)
 * and an SCP is account-agnostic — every ARN pattern in these guardrails uses
 * `::*:`. Writing a plausible twelve-digit number here would put a fact about
 * the estate into a test fixture where a reader cannot tell whether it is the
 * real one.
 */
const ACCOUNT = '000000000000'

const ENGINE_DEPLOY = `arn:aws:iam::${ACCOUNT}:role/tenure-gha-deploy-engine`
const ENGINE_PLAN = `arn:aws:iam::${ACCOUNT}:role/tenure-gha-plan`
const ENGINE_READ = `arn:aws:iam::${ACCOUNT}:role/tenure-gha-read`
const PILOT_TASK = `arn:aws:iam::${ACCOUNT}:role/tenure-pilot-ecs-task`

/**
 * What this estate actually does, and must keep doing.
 *
 * Every entry names the file that proves the estate does it. A list assembled
 * from imagination would pass this test and still lock the account out, because
 * the action it forgot is the one nobody thought of.
 */
export const OPERATIONAL_ACTIONS = [
  {
    what: 'the engine deploy role rolls the Studio service',
    request: { action: 'ecs:UpdateService', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
    evidence: 'infrastructure/oidc/roles.tf — deploy_engine allows ecs:*',
  },
  {
    what: 'the engine deploy role pushes an image',
    request: { action: 'ecr:PutImage', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
    evidence: 'infrastructure/oidc/roles.tf — deploy_engine allows ecr:*',
  },
  {
    what: 'the engine deploy role creates its own task role under the studio prefix',
    request: {
      action: 'iam:CreateRole',
      resource: `arn:aws:iam::${ACCOUNT}:role/tenure-studio-task`,
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
    evidence: 'infrastructure/oidc/roles.tf — iam:CreateRole confined to role/tenure-studio-*',
  },
  {
    what: 'the engine deploy role passes that task role to ECS',
    request: {
      action: 'iam:PassRole',
      resource: `arn:aws:iam::${ACCOUNT}:role/tenure-studio-task`,
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
    evidence: 'infrastructure/oidc/roles.tf — iam:PassRole on the same prefix',
  },
  {
    what: 'the plan role reads and locks Terraform state',
    request: {
      action: 's3:PutObject',
      resource: `arn:aws:s3:::tenure-tfstate-${ACCOUNT}-us-east-1/pilot/terraform.tfstate`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': ENGINE_PLAN,
    },
    evidence: 'infrastructure/oidc/roles.tf — plan role writes the state lock; .github/workflows/platform-plan.yml',
  },
  {
    what: 'a stack creates a bucket that is private from the first second',
    request: {
      action: 's3:PutBucketPublicAccessBlock',
      resource: `arn:aws:s3:::tenure-pilot-documents-${ACCOUNT}`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
    evidence: 'docs/architecture/aws-inventory.json — three S3 buckets, none public',
  },
  {
    what: 'the pilot task reads its own secret',
    request: {
      action: 'secretsmanager:GetSecretValue',
      resource: `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:tenure-pilot/app`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': PILOT_TASK,
    },
    evidence: 'docs/architecture/aws-inventory.json — keysAndSecrets.secrets includes tenure-pilot/app',
  },
  {
    what: 'application logging keeps working, and its retention stays a cost decision',
    request: {
      action: 'logs:PutRetentionPolicy',
      resource: `arn:aws:logs:us-east-1:${ACCOUNT}:log-group:/ecs/tenure-pilot:*`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
    evidence: 'docs/architecture/aws-inventory.json — observability.logGroups /ecs/tenure-pilot, retentionDays 30',
  },
  {
    what: 'the read-only inventory proves who it is',
    request: { action: 'sts:GetCallerIdentity', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_READ },
    evidence: 'tools/aws-inventory.mjs; .github/workflows/aws-inventory.yml',
  },
  {
    what: 'the read-only inventory describes the estate',
    request: { action: 'rds:DescribeDBInstances', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_READ },
    evidence: 'infrastructure/oidc/roles.tf — read role is ViewOnlyAccess',
  },
  {
    what: 'a CloudFront certificate is requested, which must happen in us-east-1',
    request: { action: 'acm:RequestCertificate', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
    evidence: 'docs/architecture/aws-inventory.json — edge.certificates for platform.tenurework.com',
  },
  {
    what: 'the security administrator can still administer the detection services',
    request: {
      action: 'guardduty:UpdateDetector',
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': `arn:aws:iam::${ACCOUNT}:role/tenure-security-admin`,
    },
    evidence: 'docs/decisions/ADR-0007-tenure-owned-aws-organization.md — Security OU is the delegated administrator',
  },
]

/**
 * What each guardrail must stop, as the request that would do it.
 *
 * The pair with `OPERATIONAL_ACTIONS`: one list proves the boundary bites, the
 * other proves it bites nothing the estate needs. Either alone is half a test.
 */
export const PROHIBITED_ACTIONS = [
  {
    guardrail: 'region-restriction',
    what: 'starting an instance in a region the estate does not use',
    request: { action: 'ec2:RunInstances', 'aws:RequestedRegion': 'eu-west-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'prevent-public-resources',
    what: 'removing the account-wide public access block',
    request: { action: 's3:DeleteAccountPublicAccessBlock', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'prevent-public-resources',
    what: 'sharing a database snapshot with every AWS account',
    request: { action: 'rds:ModifyDBSnapshotAttribute', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'protect-security-services',
    what: 'a deployment role deleting the GuardDuty detector',
    request: { action: 'guardduty:DeleteDetector', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'protect-security-services',
    what: 'stopping the Config recorder',
    request: { action: 'config:StopConfigurationRecorder', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'prevent-leaving-organization',
    what: 'an account removing itself from the Organization',
    request: { action: 'organizations:LeaveOrganization', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'prevent-root-use',
    what: 'root doing anything at all',
    request: { action: 's3:ListAllMyBuckets', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': `arn:aws:iam::${ACCOUNT}:root` },
  },
  {
    guardrail: 'prevent-iam-escalation',
    what: 'minting a long-lived access key',
    request: { action: 'iam:CreateAccessKey', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'prevent-iam-escalation',
    what: 'a deployment role widening its own policy',
    request: {
      action: 'iam:PutRolePolicy',
      resource: `arn:aws:iam::${ACCOUNT}:role/tenure-gha-deploy-engine`,
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
  },
  {
    guardrail: 'prevent-iam-escalation',
    what: 'repointing the OIDC provider at another repository',
    request: {
      action: 'iam:UpdateOpenIDConnectProviderThumbprint',
      resource: `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`,
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
  },
  {
    guardrail: 'require-evidence',
    what: 'stopping the organization trail',
    request: { action: 'cloudtrail:StopLogging', 'aws:RequestedRegion': 'us-east-1', 'aws:PrincipalArn': ENGINE_DEPLOY },
  },
  {
    guardrail: 'require-evidence',
    what: 'expiring the log archive',
    request: {
      action: 's3:PutLifecycleConfiguration',
      resource: `arn:aws:s3:::tenure-log-archive-${ACCOUNT}`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
  },
  {
    guardrail: 'require-evidence',
    what: 'deleting the trail log group',
    request: {
      action: 'logs:DeleteLogGroup',
      resource: `arn:aws:logs:us-east-1:${ACCOUNT}:log-group:/aws/cloudtrail/tenure-org:*`,
      'aws:RequestedRegion': 'us-east-1',
      'aws:PrincipalArn': ENGINE_DEPLOY,
    },
  },
]

/**
 * The exact commands that put a guardrail into effect.
 *
 * Emitted rather than run. Creating and attaching a policy is an Organizations
 * write against an Organization that does not exist, and GE-001-007 is explicit
 * that nothing writes to AWS before the account, region, role and rollback path
 * are known. A definition an operator cannot act on is half a deliverable, and
 * a definition this process acts on itself is the thing that item forbids.
 */
export function attachCommands(guardrail) {
  return [
    // `--content` takes the POLICY DOCUMENT, not this file. The file wraps the
    // document in the things a reviewer needs — why it exists, what it cannot
    // do, where its decision came from — and handing the wrapper to AWS fails
    // with a schema error at the worst possible moment. `jq .policy` is the
    // difference, and the test asserts it rather than trusting this comment.
    `aws organizations create-policy --type SERVICE_CONTROL_POLICY` +
      ` --name ${guardrail.id} --description ${JSON.stringify(guardrail.title)}` +
      ` --content "$(jq -c .policy infrastructure/organization/scp/${guardrail.file})"`,
    ...(guardrail.attach_to ?? []).map(
      (target) =>
        `aws organizations attach-policy --policy-id <id-from-the-previous-command> ` +
        `--target-id <${target.toLowerCase().replace(/\s+/g, '-')}-ou-or-root-id>`,
    ),
  ]
}

if (process.argv[1]?.endsWith('scp-guardrails.mjs')) {
  const guardrails = loadGuardrails()
  const flag = process.argv[2]

  if (flag === '--check') {
    const [, , , action, region, principalArn] = process.argv
    const result = evaluate(guardrails, {
      action,
      'aws:RequestedRegion': region,
      'aws:PrincipalArn': principalArn,
    })
    console.log(`${action} → ${result.decision}${result.by.length ? ` by ${result.by.join(', ')}` : ''}`)
    process.exit(result.decision === 'DENY' ? 1 : 0)
  }

  console.log(`${guardrails.length} guardrail(s) in ${path.relative(ROOT, SCP_DIR)}:`)
  for (const g of guardrails) {
    console.log(`\n  ${g.id} — ${g.title}`)
    console.log(`    attach to: ${(g.attach_to ?? []).join(', ') || '(undeclared)'}`)
    for (const limit of g.limits) console.log(`    limit: ${limit}`)
    for (const command of attachCommands(g)) console.log(`    $ ${command}`)
  }
  console.log(
    `\nNot attached to anything: no AWS Organization exists (docs/architecture/aws-inventory.json).\n` +
      `Attaching them is GE-010-004. Defining and testing them is this item.`,
  )
}
