#!/usr/bin/env node
/**
 * GE-012-003 — review an infrastructure change set before anybody applies it.
 *
 * The item asks for "IaC plan/change-set generation, destructive/replacement/
 * public-access/privilege-expansion detectors, policy scans, cost estimate, and
 * immutable evidence". `.github/workflows/platform-plan.yml` generates the
 * change set; this is everything that reads it.
 *
 * The input is `terraform show -json <planfile>` — the machine-readable form of
 * a plan, not the human text. The text form is what a reviewer skims and misses
 * things in: a `-/+` marker four hundred lines down is exactly as loud as an
 * in-place tag edit, and the two are not the same event at all.
 *
 * ── The rule that shapes every detector ─────────────────────────────────────
 *
 * A plan does not know everything. Terraform records computed values in
 * `after_unknown`, and an attribute that is unknown at plan time is genuinely
 * unknown — the apply decides it. So there are THREE answers here, never two:
 *
 *   determined + offending    we looked and it is open to the internet
 *   determined + clean        we looked and it is not
 *   UNDETERMINED              we could not look; the apply decides
 *
 * Collapsing the third into the second is how a plan review passes a security
 * group whose `cidr_blocks` come from a variable nobody has read. Every detector
 * here goes through `readAfter`, which returns `{ known: false }` rather than
 * `undefined`, and an undetermined attribute produces a finding of its own.
 *
 * ── Values are never printed ────────────────────────────────────────────────
 *
 * `after_sensitive` marks attributes the provider considers secret. Findings
 * carry the ADDRESS and the ATTRIBUTE PATH, never the value, and `renderMarkdown`
 * has no path that can reach one. A review artifact is uploaded to Actions and
 * read by people who are not the operator; a database password quoted in a
 * finding would be a secret published by the thing whose job is to prevent that.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * `estimateCost` returns billable-dimension deltas and attaches money only
 * against a rate card the caller supplies. No price table is checked into this
 * repository. `apps/system-studio/src/lib/cost-source.ts` already settled this
 * for the FinOps Center — "fake cost" is a named prohibited shortcut, and a
 * plausible dollar figure on the page somebody approves spending from is worse
 * than no figure — and a plan review is the same problem one step earlier.
 * `NOT_PRICED` says what is missing; it does not say zero.
 *
 * ── Evidence ────────────────────────────────────────────────────────────────
 *
 * `sealReview` digests the plan bytes, then digests the findings *together with*
 * the plan digest. The seal therefore cannot be moved onto a different plan: a
 * reviewer re-running `sealReview` on the artifact pair either reproduces both
 * digests or has been handed a mismatched pair. Nothing in the seal comes from
 * the clock or the machine, so two reviewers of one plan get one seal.
 *
 * Usage:
 *   node tools/iac-plan-review.mjs plan.json [--rates rates.json] [--markdown]
 *     [--regions us-east-1,us-west-2] [--json]
 *
 * Exit codes: 0 clean or review-only, 1 blocking findings, 2 unusable input.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/** `terraform show -json` has been format version 1.x since Terraform 0.12. */
export const SUPPORTED_PLAN_FORMAT_MAJOR = 1

export const SEVERITY = {
  BLOCKING: 'blocking',
  REVIEW: 'review',
  NOTE: 'note',
}

/**
 * Resource types whose deletion or replacement destroys data.
 *
 * Not "resources that cost money" and not "resources that are important" — the
 * question each entry answers is: if this is deleted and recreated, is anything
 * gone that cannot be recreated from the repository? A security group is not
 * here because it is a rule; an RDS instance is, because it is the pilot.
 */
export const STATEFUL_TYPES = new Set([
  'aws_db_instance',
  'aws_rds_cluster',
  'aws_rds_cluster_instance',
  'aws_db_snapshot',
  'aws_s3_bucket',
  'aws_dynamodb_table',
  'aws_ebs_volume',
  'aws_efs_file_system',
  'aws_elasticache_cluster',
  'aws_elasticache_replication_group',
  'aws_ecr_repository',
  'aws_cloudwatch_log_group',
  'aws_secretsmanager_secret',
  'aws_kms_key',
  'aws_backup_vault',
  'aws_cognito_user_pool',
  'aws_sqs_queue',
])

/**
 * Types whose entire purpose is to prevent exposure.
 *
 * Deleting one of these is a public-access event even though nothing in the
 * change set becomes "public" — the plan shows a deletion and the estate loses
 * a guard. A detector that only reads `after` cannot see this, because there is
 * no after.
 */
export const PROTECTIVE_TYPES = new Set([
  'aws_s3_bucket_public_access_block',
  'aws_s3_account_public_access_block',
  'aws_wafv2_web_acl_association',
  'aws_ebs_encryption_by_default',
  'aws_guardduty_detector',
  'aws_cloudtrail',
  'aws_config_configuration_recorder',
])

/** Managed policies whose attachment is, by itself, an escalation. */
export const ADMIN_POLICY_ARNS = [
  'arn:aws:iam::aws:policy/AdministratorAccess',
  'arn:aws:iam::aws:policy/PowerUserAccess',
  'arn:aws:iam::aws:policy/IAMFullAccess',
]

/** Attributes that hold an IAM policy document, by resource type. */
const POLICY_DOCUMENT_ATTRIBUTES = new Map([
  ['aws_iam_policy', 'policy'],
  ['aws_iam_role_policy', 'policy'],
  ['aws_iam_user_policy', 'policy'],
  ['aws_iam_group_policy', 'policy'],
])

/** Attributes that hold a RESOURCE policy — the kind that can name `*` as principal. */
const RESOURCE_POLICY_ATTRIBUTES = new Map([
  ['aws_s3_bucket_policy', 'policy'],
  ['aws_sqs_queue_policy', 'policy'],
  ['aws_sns_topic_policy', 'policy'],
  ['aws_kms_key', 'policy'],
  ['aws_ecr_repository_policy', 'policy'],
  ['aws_secretsmanager_secret_policy', 'policy'],
  ['aws_efs_file_system_policy', 'policy'],
  ['aws_iam_role', 'assume_role_policy'],
])

// ── Reading a plan ──────────────────────────────────────────────────────────

/**
 * Parse and structurally validate `terraform show -json` output.
 *
 * Throws rather than returning a half-usable object. A review that silently
 * treats an unreadable plan as "no findings" is the worst possible output: it
 * is indistinguishable from a clean plan, and it is the output you get from a
 * truncated artifact.
 */
export function parsePlan(text) {
  let plan
  try {
    plan = JSON.parse(text)
  } catch (error) {
    throw new Error(`plan is not JSON: ${error.message}`)
  }
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('plan is not an object')
  }
  const version = plan.format_version
  if (typeof version !== 'string') {
    throw new Error(
      'plan has no format_version. This is the human `terraform plan` output, not ' +
        '`terraform show -json <planfile>`.',
    )
  }
  const major = Number(version.split('.')[0])
  if (major !== SUPPORTED_PLAN_FORMAT_MAJOR) {
    throw new Error(
      `plan format_version ${version} is not supported (this reads ${SUPPORTED_PLAN_FORMAT_MAJOR}.x). ` +
        'Terraform changed the shape; the detectors have to be re-read against it rather than guessed at.',
    )
  }
  if (!Array.isArray(plan.resource_changes)) {
    // Terraform omits the key entirely when there is nothing to do. That is a
    // real answer — "no changes" — and is not the same as a malformed plan.
    plan.resource_changes = []
  }
  return plan
}

/** create | update | delete | replace | no-op | read */
export function changeKind(actions) {
  if (!Array.isArray(actions)) return 'unknown'
  const a = actions.join(',')
  if (a === 'create,delete' || a === 'delete,create') return 'replace'
  if (a === 'no-op') return 'no-op'
  if (a === 'read') return 'read'
  if (a === 'create') return 'create'
  if (a === 'update') return 'update'
  if (a === 'delete') return 'delete'
  return 'unknown'
}

/** Managed resource changes that actually do something. */
export function actionableChanges(plan) {
  return (plan.resource_changes ?? []).filter((rc) => {
    if (rc?.mode === 'data') return false
    const kind = changeKind(rc?.change?.actions)
    return kind !== 'no-op' && kind !== 'read'
  })
}

/**
 * Read an attribute of the planned end state, with "unknown" as a first-class
 * answer rather than an absence.
 *
 * Returns `{ known: false }` when terraform marked the attribute (or any parent
 * of it) computed. Returns `{ known: true, value }` otherwise, with `value`
 * `undefined` when the attribute is genuinely not set.
 */
export function readAfter(change, attributePath) {
  const segments = Array.isArray(attributePath) ? attributePath : [attributePath]
  let value = change?.after
  let unknown = change?.after_unknown

  for (const segment of segments) {
    if (unknown === true) return { known: false }
    value = value === null || value === undefined ? undefined : value[segment]
    unknown =
      unknown !== null && typeof unknown === 'object' ? unknown[segment] : undefined
  }
  if (unknown === true) return { known: false }
  return { known: true, value }
}

/** Whether the provider marked this attribute sensitive; used to refuse to render it. */
export function isSensitive(change, attributePath) {
  const segments = Array.isArray(attributePath) ? attributePath : [attributePath]
  let node = change?.after_sensitive
  for (const segment of segments) {
    if (node === true) return true
    node = node !== null && typeof node === 'object' ? node[segment] : undefined
  }
  return node === true
}

/**
 * The one way a plan value may reach a finding.
 *
 * Three of the detectors are only useful if they quote what they found — an ACL
 * of `public-read`, the ARN of the managed policy being attached, the region a
 * resource landed in. None of those is a secret; a provider that has marked the
 * attribute sensitive is nevertheless saying otherwise, and its word wins. This
 * is the only interpolation of plan data in the module, so "no value reaches the
 * artifact unless it passed through here" is a property of one function rather
 * than of every future detector somebody adds.
 */
export function describeValue(change, attributePath, value) {
  if (isSensitive(change, attributePath)) return '«withheld: the provider marks this attribute sensitive»'
  return String(value)
}

const finding = (detector, severity, rc, detail, extra = {}) => ({
  detector,
  severity,
  address: rc.address,
  type: rc.type,
  action: changeKind(rc.change?.actions),
  detail,
  determinacy: extra.determinacy ?? 'determined',
  ...extra,
})

// ── Detector: destructive ───────────────────────────────────────────────────

/**
 * Deletions, with the data-bearing ones separated from the rest.
 *
 * `action_reason` is carried through because terraform already knows WHY, and
 * `delete_because_no_resource_config` (somebody removed the block) reads very
 * differently from `delete_because_count_index` (somebody changed a count).
 */
export function destructiveFindings(plan) {
  const out = []
  for (const rc of actionableChanges(plan)) {
    if (changeKind(rc.change.actions) !== 'delete') continue
    const stateful = STATEFUL_TYPES.has(rc.type)
    out.push(
      finding(
        'destructive',
        stateful ? SEVERITY.BLOCKING : SEVERITY.REVIEW,
        rc,
        stateful
          ? `${rc.type} is deleted. This type holds data that the repository cannot recreate.`
          : `${rc.type} is deleted.`,
        { reason: rc.action_reason ?? null, stateful },
      ),
    )
  }
  return out
}

// ── Detector: replacement ───────────────────────────────────────────────────

/**
 * Replacements, and the attribute that forced each one.
 *
 * `replace_paths` is the load-bearing part. "This RDS instance will be replaced"
 * is alarming and unactionable; "this RDS instance will be replaced because
 * `identifier` changed" is a one-line fix.
 */
export function replacementFindings(plan) {
  const out = []
  for (const rc of actionableChanges(plan)) {
    if (changeKind(rc.change.actions) !== 'replace') continue
    const stateful = STATEFUL_TYPES.has(rc.type)
    const forcedBy = (rc.change.replace_paths ?? []).map((p) =>
      Array.isArray(p) ? p.join('.') : String(p),
    )
    out.push(
      finding(
        'replacement',
        stateful ? SEVERITY.BLOCKING : SEVERITY.REVIEW,
        rc,
        stateful
          ? `${rc.type} is replaced, which destroys and recreates it. This type holds data.`
          : `${rc.type} is replaced.`,
        {
          stateful,
          forcedBy,
          reason: rc.action_reason ?? null,
          createBeforeDestroy: rc.change.actions[0] === 'create',
        },
      ),
    )
  }
  return out
}

// ── Detector: public access ─────────────────────────────────────────────────

const OPEN_V4 = '0.0.0.0/0'
const OPEN_V6 = '::/0'

function cidrFinding(rc, attributePath, out) {
  const read = readAfter(rc.change, attributePath)
  if (!read.known) {
    out.push(
      finding(
        'public-access',
        SEVERITY.REVIEW,
        rc,
        `${attributePath.join('.')} is not known at plan time, so whether this opens to the ` +
          `internet is decided by the apply.`,
        { determinacy: 'undetermined', attribute: attributePath.join('.') },
      ),
    )
    return
  }
  const list = Array.isArray(read.value) ? read.value : []
  if (list.includes(OPEN_V4) || list.includes(OPEN_V6)) {
    out.push(
      finding(
        'public-access',
        SEVERITY.BLOCKING,
        rc,
        `${attributePath.join('.')} allows the whole internet.`,
        { attribute: attributePath.join('.') },
      ),
    )
  }
}

function booleanFinding(rc, attributePath, offendingValue, detail, out, severity = SEVERITY.BLOCKING) {
  const read = readAfter(rc.change, attributePath)
  const label = attributePath.join('.')
  if (!read.known) {
    out.push(
      finding('public-access', SEVERITY.REVIEW, rc, `${label} is not known at plan time.`, {
        determinacy: 'undetermined',
        attribute: label,
      })
    )
    return
  }
  if (read.value === offendingValue) {
    out.push(finding('public-access', severity, rc, detail, { attribute: label }))
  }
}

/**
 * Statements in a resource policy that grant to everyone.
 *
 * A `Condition` is not treated as automatically saving it — `Principal: "*"`
 * with a condition is narrowed, so it is reported at review severity rather
 * than blocking, and a human reads the condition. Treating any condition as
 * sufficient would pass `aws:PrincipalAccount: "*"`.
 */
export function wildcardPrincipalStatements(document) {
  const statements = normaliseStatements(document)
  const out = []
  for (const [index, statement] of statements.entries()) {
    if (statement?.Effect !== 'Allow') continue
    const principal = statement.Principal
    const wildcard =
      principal === '*' ||
      (principal &&
        typeof principal === 'object' &&
        Object.values(principal).some((v) =>
          Array.isArray(v) ? v.includes('*') : v === '*',
        ))
    if (!wildcard) continue
    out.push({ index, conditioned: statement.Condition !== undefined })
  }
  return out
}

export function publicAccessFindings(plan) {
  const out = []
  for (const rc of actionableChanges(plan)) {
    const kind = changeKind(rc.change.actions)

    if (kind === 'delete' && PROTECTIVE_TYPES.has(rc.type)) {
      out.push(
        finding(
          'public-access',
          SEVERITY.BLOCKING,
          rc,
          `${rc.type} is deleted. This resource exists to prevent exposure; removing it is the ` +
            `exposure, and nothing in the plan's end state shows it.`,
        ),
      )
      continue
    }
    if (kind === 'delete') continue

    switch (rc.type) {
      case 'aws_security_group': {
        const ingress = readAfter(rc.change, ['ingress'])
        if (!ingress.known) {
          out.push(
            finding('public-access', SEVERITY.REVIEW, rc, 'ingress is not known at plan time.', {
              determinacy: 'undetermined',
              attribute: 'ingress',
            }),
          )
          break
        }
        for (const [i] of (ingress.value ?? []).entries()) {
          cidrFinding(rc, ['ingress', i, 'cidr_blocks'], out)
          cidrFinding(rc, ['ingress', i, 'ipv6_cidr_blocks'], out)
        }
        break
      }
      case 'aws_security_group_rule': {
        const type = readAfter(rc.change, ['type'])
        if (type.known && type.value !== 'ingress') break
        cidrFinding(rc, ['cidr_blocks'], out)
        cidrFinding(rc, ['ipv6_cidr_blocks'], out)
        break
      }
      case 'aws_vpc_security_group_ingress_rule': {
        for (const attribute of ['cidr_ipv4', 'cidr_ipv6']) {
          const read = readAfter(rc.change, [attribute])
          if (!read.known) {
            out.push(
              finding('public-access', SEVERITY.REVIEW, rc, `${attribute} is not known at plan time.`, {
                determinacy: 'undetermined',
                attribute,
              }),
            )
            continue
          }
          if (read.value === OPEN_V4 || read.value === OPEN_V6) {
            out.push(
              finding('public-access', SEVERITY.BLOCKING, rc, `${attribute} allows the whole internet.`, {
                attribute,
              }),
            )
          }
        }
        break
      }
      case 'aws_s3_bucket_public_access_block': {
        for (const attribute of [
          'block_public_acls',
          'block_public_policy',
          'ignore_public_acls',
          'restrict_public_buckets',
        ]) {
          booleanFinding(
            rc,
            [attribute],
            false,
            `${attribute} is false, so the bucket may be made public by an ACL or a policy.`,
            out,
          )
        }
        break
      }
      case 'aws_s3_bucket_acl': {
        const acl = readAfter(rc.change, ['acl'])
        if (!acl.known) {
          out.push(
            finding('public-access', SEVERITY.REVIEW, rc, 'acl is not known at plan time.', {
              determinacy: 'undetermined',
              attribute: 'acl',
            }),
          )
          break
        }
        if (typeof acl.value === 'string' && acl.value.startsWith('public-')) {
          out.push(
            finding(
              'public-access',
              SEVERITY.BLOCKING,
              rc,
              `acl is "${describeValue(rc.change, ['acl'], acl.value)}".`,
              { attribute: 'acl' },
            ),
          )
        }
        break
      }
      case 'aws_db_instance':
      case 'aws_rds_cluster_instance': {
        booleanFinding(
          rc,
          ['publicly_accessible'],
          true,
          'publicly_accessible is true — the database gets a public endpoint.',
          out,
        )
        break
      }
      case 'aws_instance': {
        booleanFinding(
          rc,
          ['associate_public_ip_address'],
          true,
          'associate_public_ip_address is true.',
          out,
          SEVERITY.REVIEW,
        )
        break
      }
      case 'aws_ecs_service': {
        const nc = readAfter(rc.change, ['network_configuration'])
        if (nc.known && Array.isArray(nc.value)) {
          for (const [i] of nc.value.entries()) {
            booleanFinding(
              rc,
              ['network_configuration', i, 'assign_public_ip'],
              true,
              'assign_public_ip is true — tasks get public addresses.',
              out,
              SEVERITY.REVIEW,
            )
          }
        }
        break
      }
      case 'aws_lambda_function_url': {
        const auth = readAfter(rc.change, ['authorization_type'])
        if (auth.known && auth.value === 'NONE') {
          out.push(
            finding(
              'public-access',
              SEVERITY.BLOCKING,
              rc,
              'authorization_type is NONE — the function URL is callable by anyone.',
              { attribute: 'authorization_type' },
            ),
          )
        }
        break
      }
      case 'aws_lb': {
        const internal = readAfter(rc.change, ['internal'])
        if (internal.known && internal.value === false) {
          out.push(
            finding(
              'public-access',
              SEVERITY.REVIEW,
              rc,
              'the load balancer is internet-facing. Deliberate for a public application; ' +
                'reported so a new one is a decision rather than a default.',
              { attribute: 'internal' },
            ),
          )
        }
        break
      }
      default:
        break
    }

    const policyAttribute = RESOURCE_POLICY_ATTRIBUTES.get(rc.type)
    if (policyAttribute) {
      const read = readAfter(rc.change, [policyAttribute])
      if (!read.known) {
        out.push(
          finding(
            'public-access',
            SEVERITY.REVIEW,
            rc,
            `${policyAttribute} is not known at plan time, so who it grants to is decided by the apply.`,
            { determinacy: 'undetermined', attribute: policyAttribute },
          ),
        )
      } else if (typeof read.value === 'string') {
        const document = parseJsonDocument(read.value)
        if (document === null) {
          out.push(
            finding(
              'public-access',
              SEVERITY.REVIEW,
              rc,
              `${policyAttribute} could not be parsed as a policy document, so it was not checked.`,
              { determinacy: 'undetermined', attribute: policyAttribute },
            ),
          )
        } else {
          for (const hit of wildcardPrincipalStatements(document)) {
            out.push(
              finding(
                'public-access',
                hit.conditioned ? SEVERITY.REVIEW : SEVERITY.BLOCKING,
                rc,
                hit.conditioned
                  ? `${policyAttribute} statement ${hit.index} allows principal "*" narrowed by a ` +
                    `Condition. Read the condition — a condition is not automatically a boundary.`
                  : `${policyAttribute} statement ${hit.index} allows principal "*" with no Condition.`,
                { attribute: `${policyAttribute}[${hit.index}]` },
              ),
            )
          }
        }
      }
    }
  }
  return out
}

// ── Detector: privilege expansion ───────────────────────────────────────────

function parseJsonDocument(value) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function normaliseStatements(document) {
  const raw = document?.Statement
  if (Array.isArray(raw)) return raw.filter((s) => s && typeof s === 'object')
  if (raw && typeof raw === 'object') return [raw]
  return []
}

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

/**
 * Every `Deny` this document carries, as `action|resource` pairs.
 *
 * Used to detect a deny being REMOVED. `infrastructure/oidc/roles.tf` leans on
 * explicit denies precisely because "an explicit Deny cannot be overridden by
 * any Allow, including one added later by mistake" — so quietly dropping one is
 * an escalation that no Allow in the diff shows.
 */
export function denyPairs(document) {
  const pairs = new Set()
  for (const statement of normaliseStatements(document)) {
    if (statement.Effect !== 'Deny') continue
    for (const action of asList(statement.Action).concat(asList(statement.NotAction))) {
      for (const resource of asList(statement.Resource).concat(asList(statement.NotResource))) {
        pairs.add(`${action}|${resource}`)
      }
    }
  }
  return pairs
}

/** Allow statements that are unbounded in action or in resource. */
export function unboundedAllowStatements(document) {
  const out = []
  for (const [index, statement] of normaliseStatements(document).entries()) {
    if (statement.Effect !== 'Allow') continue
    const actions = asList(statement.Action)
    const resources = asList(statement.Resource)
    const problems = []

    if (statement.NotAction !== undefined) {
      problems.push('uses NotAction, which allows everything except a list')
    }
    if (statement.NotResource !== undefined) {
      problems.push('uses NotResource, which allows every resource except a list')
    }
    if (actions.includes('*')) problems.push('allows every action')
    if (actions.some((a) => typeof a === 'string' && /^iam:(\*|Create|Put|Attach|Pass)/.test(a)) &&
        resources.includes('*')) {
      problems.push('grants IAM write on every resource, which can mint an administrator')
    }
    if (
      actions.some((a) => typeof a === 'string' && a.toLowerCase() === 'iam:passrole') &&
      resources.includes('*')
    ) {
      problems.push('allows iam:PassRole on every role')
    }
    if (actions.includes('*') && resources.includes('*')) {
      problems.push('is administrator access written out')
    }
    if (problems.length > 0) out.push({ index, problems })
  }
  return out
}

export function privilegeExpansionFindings(plan) {
  const out = []
  for (const rc of actionableChanges(plan)) {
    const kind = changeKind(rc.change.actions)

    if (kind !== 'delete' && (rc.type === 'aws_iam_user' || rc.type === 'aws_iam_access_key')) {
      out.push(
        finding(
          'privilege-expansion',
          SEVERITY.BLOCKING,
          rc,
          `${rc.type} creates a long-lived credential. The estate authenticates deployments through ` +
            `OIDC (GE-011); a user or access key is a key somebody has to rotate and nobody will.`,
        ),
      )
    }

    if (kind !== 'delete' && rc.type.endsWith('_policy_attachment')) {
      const arn = readAfter(rc.change, ['policy_arn'])
      if (!arn.known) {
        out.push(
          finding(
            'privilege-expansion',
            SEVERITY.REVIEW,
            rc,
            'policy_arn is not known at plan time, so what is being attached is decided by the apply.',
            { determinacy: 'undetermined', attribute: 'policy_arn' },
          ),
        )
      } else if (ADMIN_POLICY_ARNS.includes(arn.value)) {
        out.push(
          finding(
            'privilege-expansion',
            SEVERITY.BLOCKING,
            rc,
            `attaches ${describeValue(rc.change, ['policy_arn'], arn.value)}.`,
            { attribute: 'policy_arn' },
          ),
        )
      }
    }

    if (kind === 'update' || kind === 'replace') {
      const before = rc.change.before ?? {}
      const boundaryAfter = readAfter(rc.change, ['permissions_boundary'])
      if (
        typeof before.permissions_boundary === 'string' &&
        before.permissions_boundary !== '' &&
        boundaryAfter.known &&
        (boundaryAfter.value === undefined ||
          boundaryAfter.value === null ||
          boundaryAfter.value === '')
      ) {
        out.push(
          finding(
            'privilege-expansion',
            SEVERITY.BLOCKING,
            rc,
            'the permissions boundary is removed. Everything the attached policies allow now applies.',
            { attribute: 'permissions_boundary' },
          ),
        )
      }
    }

    const documentAttribute =
      POLICY_DOCUMENT_ATTRIBUTES.get(rc.type) ??
      (rc.type === 'aws_iam_role' ? 'assume_role_policy' : undefined)
    if (!documentAttribute || kind === 'delete') continue

    const read = readAfter(rc.change, [documentAttribute])
    if (!read.known) {
      out.push(
        finding(
          'privilege-expansion',
          SEVERITY.REVIEW,
          rc,
          `${documentAttribute} is not known at plan time, so what it grants is decided by the apply.`,
          { determinacy: 'undetermined', attribute: documentAttribute },
        ),
      )
      continue
    }
    const after = parseJsonDocument(read.value)
    if (after === null) {
      out.push(
        finding(
          'privilege-expansion',
          SEVERITY.REVIEW,
          rc,
          `${documentAttribute} could not be parsed as a policy document, so it was not checked.`,
          { determinacy: 'undetermined', attribute: documentAttribute },
        ),
      )
      continue
    }

    for (const hit of unboundedAllowStatements(after)) {
      out.push(
        finding(
          'privilege-expansion',
          SEVERITY.BLOCKING,
          rc,
          `${documentAttribute} statement ${hit.index} ${hit.problems.join('; ')}.`,
          { attribute: `${documentAttribute}[${hit.index}]` },
        ),
      )
    }

    const beforeDocument = parseJsonDocument(rc.change.before?.[documentAttribute])
    if (beforeDocument !== null) {
      const kept = denyPairs(after)
      const dropped = [...denyPairs(beforeDocument)].filter((p) => !kept.has(p))
      if (dropped.length > 0) {
        out.push(
          finding(
            'privilege-expansion',
            SEVERITY.BLOCKING,
            rc,
            `${dropped.length} explicit Deny statement(s) are removed from ${documentAttribute}: ` +
              `${dropped.join(', ')}. An explicit Deny is the only grant a later Allow cannot override.`,
            { attribute: documentAttribute, dropped },
          ),
        )
      }
    }
  }
  return out
}

// ── Policy scans ────────────────────────────────────────────────────────────

/**
 * The twelve required tag keys, READ OUT of the declaration rather than
 * repeated here.
 *
 * Same technique as `tests/architecture/resource-tags.test.mjs`, and for the
 * same reason: a second copy of the list is a copy that can disagree with the
 * contract while every test still passes. The values are NOT re-validated here
 * — `tagProblems` in that module owns the vocabularies, and a second validator
 * would be a second opinion about what `student-record` means.
 */
export function requiredTagKeys(
  sourcePath = path.join(ROOT, 'packages', 'provisioning', 'src', 'resource-tags.ts'),
) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const block = source.match(/export const REQUIRED_RESOURCE_TAGS = \[([\s\S]*?)\] as const/)
  if (!block) {
    throw new Error(`REQUIRED_RESOURCE_TAGS is not declared in ${sourcePath}`)
  }
  return [...block[1].matchAll(/"(tenure:[a-z-]+)"/g)].map((m) => m[1])
}

/**
 * Scans that are repository policy rather than a security property of the change.
 *
 * `allowedRegions` is deliberately not defaulted. A default allowlist would make
 * every plan pass the region rule on a machine that happens to agree with it, and
 * an estate rule this repository has not written down should report itself
 * unchecked rather than silently satisfied.
 */
export function policyScanFindings(plan, options = {}) {
  const { tagKeys = null, allowedRegions = null } = options
  const out = []

  if (allowedRegions === null) {
    out.push({
      detector: 'policy-scan',
      severity: SEVERITY.NOTE,
      address: null,
      type: null,
      action: null,
      determinacy: 'unchecked',
      rule: 'region-allowlist',
      detail:
        'No region allowlist was supplied, so region placement was not checked. This is reported ' +
        'rather than passed: "no allowlist" and "every region is allowed" are different facts.',
    })
  }
  if (tagKeys === null) {
    out.push({
      detector: 'policy-scan',
      severity: SEVERITY.NOTE,
      address: null,
      type: null,
      action: null,
      determinacy: 'unchecked',
      rule: 'required-tags',
      detail: 'No required-tag vocabulary was supplied, so tagging was not checked.',
    })
  }

  for (const rc of actionableChanges(plan)) {
    const kind = changeKind(rc.change.actions)
    if (kind === 'delete') continue

    if (tagKeys !== null) {
      // `tags_all` is what the AWS provider computes for every TAGGABLE resource,
      // so its presence is how the plan itself says "this resource takes tags" —
      // better than a hand-kept list of types that goes stale the day a new
      // service is used.
      const tagsAll = readAfter(rc.change, ['tags_all'])
      const hasTagSupport = tagsAll.known ? tagsAll.value !== undefined : true
      if (hasTagSupport) {
        if (!tagsAll.known) {
          out.push(
            finding('policy-scan', SEVERITY.REVIEW, rc, 'tags_all is not known at plan time.', {
              determinacy: 'undetermined',
              rule: 'required-tags',
            }),
          )
        } else {
          const present = tagsAll.value ?? {}
          const missing = tagKeys.filter(
            (key) => present[key] === undefined || String(present[key]).trim() === '',
          )
          if (missing.length > 0) {
            out.push(
              finding(
                'policy-scan',
                SEVERITY.REVIEW,
                rc,
                `missing required tag(s): ${missing.join(', ')}. An untagged resource is ` +
                  `unattributable, which is not the same as shared.`,
                { rule: 'required-tags', missing },
              ),
            )
          }
        }
      }
    }

    if (allowedRegions !== null) {
      const region = regionOf(rc)
      if (region.known && region.value !== null && !allowedRegions.includes(region.value)) {
        out.push(
          finding(
            'policy-scan',
            SEVERITY.BLOCKING,
            rc,
            `is placed in ${region.value}, which is not in the allowed regions ` +
              `(${allowedRegions.join(', ')}).`,
            { rule: 'region-allowlist', region: region.value },
          ),
        )
      }
    }

    if (rc.type === 'aws_cloudwatch_log_group') {
      const retention = readAfter(rc.change, ['retention_in_days'])
      if (retention.known && (retention.value === undefined || retention.value === 0)) {
        out.push(
          finding(
            'policy-scan',
            SEVERITY.REVIEW,
            rc,
            'retention_in_days is unset, so the group keeps logs forever and the retention tag ' +
              'describes something that is not true.',
            { rule: 'log-retention' },
          ),
        )
      }
    }

    for (const [type, attribute, expected] of ENCRYPTION_ATTRIBUTES) {
      if (rc.type !== type) continue
      const read = readAfter(rc.change, [attribute])
      if (read.known && read.value !== undefined && read.value !== expected) {
        out.push(
          finding('policy-scan', SEVERITY.BLOCKING, rc, `${attribute} is not ${expected}.`, {
            rule: 'encryption-at-rest',
            attribute,
          }),
        )
      }
    }

    if (kind === 'update' || kind === 'replace') {
      const before = rc.change.before ?? {}
      const after = readAfter(rc.change, ['deletion_protection'])
      if (before.deletion_protection === true && after.known && after.value === false) {
        out.push(
          finding('policy-scan', SEVERITY.BLOCKING, rc, 'deletion_protection is turned off.', {
            rule: 'deletion-protection',
          }),
        )
      }
    }
  }
  return out
}

const ENCRYPTION_ATTRIBUTES = [
  ['aws_db_instance', 'storage_encrypted', true],
  ['aws_rds_cluster', 'storage_encrypted', true],
  ['aws_ebs_volume', 'encrypted', true],
  ['aws_efs_file_system', 'encrypted', true],
]

/** The region a change lands in, from an explicit attribute or an ARN. */
export function regionOf(rc) {
  const explicit = readAfter(rc.change, ['region'])
  if (!explicit.known) return { known: false, value: null }
  if (typeof explicit.value === 'string' && explicit.value !== '') {
    return { known: true, value: explicit.value }
  }
  const arn = readAfter(rc.change, ['arn'])
  if (!arn.known) return { known: false, value: null }
  if (typeof arn.value === 'string') {
    const parts = arn.value.split(':')
    if (parts.length > 3 && parts[3] !== '') return { known: true, value: parts[3] }
  }
  const az = readAfter(rc.change, ['availability_zone'])
  if (az.known && typeof az.value === 'string' && /^[a-z]{2}-[a-z]+-\d[a-z]$/.test(az.value)) {
    return { known: true, value: az.value.slice(0, -1) }
  }
  return { known: true, value: null }
}

// ── Cost ────────────────────────────────────────────────────────────────────

/** Hours in a 730-hour billing month, the figure AWS itself uses for monthly examples. */
export const HOURS_PER_MONTH = 730

/**
 * What each modelled type bills on.
 *
 * A dimension is a UNIT, never a price. `unitsFor` returns how many of that unit
 * the planned end state consumes per month; the rate card, if there is one,
 * turns units into money.
 *
 * `usage` types are the honest hole: a CloudFront distribution or an S3 bucket
 * bills on traffic and stored bytes, and a plan cannot know either. They are
 * listed so the estimate can say "this change adds a usage-priced resource"
 * rather than adding nothing and reading as free.
 */
const BILLABLE = new Map([
  ['aws_nat_gateway', (a) => [{ dimension: 'nat-gateway-hours', units: HOURS_PER_MONTH }]],
  [
    'aws_db_instance',
    (a) => [
      { dimension: `rds-instance-hours:${a.instance_class ?? 'unknown'}`, units: HOURS_PER_MONTH },
      {
        dimension: `rds-storage-gb-month:${a.storage_type ?? 'default'}`,
        units: Number(a.allocated_storage ?? 0),
      },
    ],
  ],
  [
    'aws_instance',
    (a) => [{ dimension: `ec2-instance-hours:${a.instance_type ?? 'unknown'}`, units: HOURS_PER_MONTH }],
  ],
  [
    'aws_ebs_volume',
    (a) => [{ dimension: `ebs-gb-month:${a.type ?? 'gp3'}`, units: Number(a.size ?? 0) }],
  ],
  [
    'aws_elasticache_cluster',
    (a) => [
      {
        dimension: `elasticache-node-hours:${a.node_type ?? 'unknown'}`,
        units: HOURS_PER_MONTH * Number(a.num_cache_nodes ?? 1),
      },
    ],
  ],
  ['aws_lb', (a) => [{ dimension: `lb-hours:${a.load_balancer_type ?? 'application'}`, units: HOURS_PER_MONTH }]],
  [
    'aws_ecs_service',
    (a) => [{ dimension: 'fargate-task-hours', units: HOURS_PER_MONTH * Number(a.desired_count ?? 0) }],
  ],
])

const USAGE_PRICED = new Map([
  ['aws_cloudfront_distribution', 'billed on requests and bytes served, which a plan cannot know'],
  ['aws_s3_bucket', 'billed on bytes stored and requests, which a plan cannot know'],
  ['aws_sqs_queue', 'billed per request, which a plan cannot know'],
  ['aws_dynamodb_table', 'billed on capacity or per request, depending on mode and traffic'],
  ['aws_cloudwatch_log_group', 'billed on bytes ingested and stored, which a plan cannot know'],
  ['aws_secretsmanager_secret', 'billed per secret-month and per API call'],
  ['aws_kms_key', 'billed per key-month and per request'],
])

const unitsOf = (type, attributes) => {
  const model = BILLABLE.get(type)
  return model ? model(attributes ?? {}) : null
}

/**
 * The attributes that decide a resource's price, by type.
 *
 * Only these make an estimate incomplete when they are computed. Terraform marks
 * `id`, `arn` and a dozen other things unknown on every create, and treating any
 * unknown as "the price is undetermined" would put every resource in the
 * incomplete list — which is the same as putting none of them there, because
 * nobody reads a list that is always full.
 */
const PRICE_ATTRIBUTES = new Map([
  ['aws_db_instance', ['instance_class', 'allocated_storage', 'storage_type']],
  ['aws_instance', ['instance_type']],
  ['aws_ebs_volume', ['size', 'type']],
  ['aws_elasticache_cluster', ['node_type', 'num_cache_nodes']],
  ['aws_lb', ['load_balancer_type']],
  ['aws_ecs_service', ['desired_count']],
  ['aws_nat_gateway', []],
])

/**
 * The monthly billable-dimension delta of a change set, priced only where a rate
 * card covers it.
 *
 * Returns a discriminated result, deliberately the same shape decision as
 * `costSource()` in the Studio: `PRICED` carries a total, `NOT_PRICED` carries
 * what is missing. There is no arm that returns a number with holes in it.
 */
export function estimateCost(plan, rateCard = null) {
  const deltas = new Map()
  const usage = []
  const unmodelled = []
  const undetermined = []

  for (const rc of actionableChanges(plan)) {
    const kind = changeKind(rc.change.actions)
    const before = kind === 'create' ? null : rc.change.before
    const after = kind === 'delete' ? null : rc.change.after
    const undecided = (PRICE_ATTRIBUTES.get(rc.type) ?? []).filter(
      (attribute) => !readAfter(rc.change, [attribute]).known,
    )

    if (USAGE_PRICED.has(rc.type)) {
      usage.push({ address: rc.address, type: rc.type, why: USAGE_PRICED.get(rc.type) })
      continue
    }
    if (!BILLABLE.has(rc.type)) {
      unmodelled.push({ address: rc.address, type: rc.type })
      continue
    }
    if (undecided.length > 0 && after !== null) {
      undetermined.push({
        address: rc.address,
        type: rc.type,
        attributes: undecided,
        why: `${undecided.join(', ')} decide(s) the price and is computed at apply time`,
      })
    }

    for (const [sign, attributes] of [
      [-1, before],
      [1, after],
    ]) {
      if (!attributes) continue
      for (const { dimension, units } of unitsOf(rc.type, attributes) ?? []) {
        if (!Number.isFinite(units)) continue
        deltas.set(dimension, (deltas.get(dimension) ?? 0) + sign * units)
      }
    }
  }

  const dimensions = [...deltas.entries()]
    .filter(([, units]) => units !== 0)
    .map(([dimension, units]) => ({ dimension, units }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension))

  if (rateCard === null || rateCard === undefined) {
    return {
      state: 'NOT_PRICED',
      why:
        'No rate card was supplied, so the change set is reported in billable units and not in money. ' +
        'No price table is checked into this repository: a plausible figure on the artifact somebody ' +
        'approves an apply from is worse than no figure.',
      missing: ['rate card'],
      dimensions,
      usagePriced: usage,
      unmodelled,
      undetermined,
    }
  }

  const rates = rateCard.rates ?? {}
  const unpriced = dimensions.filter((d) => !Number.isFinite(Number(rates[d.dimension])))
  if (unpriced.length > 0) {
    return {
      state: 'NOT_PRICED',
      why:
        `The rate card (${rateCard.source ?? 'unnamed'}) has no rate for ` +
        `${unpriced.length} of the ${dimensions.length} dimension(s) this change moves. A total over ` +
        `the rest would understate the change by exactly the part nobody priced.`,
      missing: unpriced.map((d) => d.dimension),
      dimensions,
      usagePriced: usage,
      unmodelled,
      undetermined,
    }
  }

  const lines = dimensions.map((d) => ({
    ...d,
    rate: Number(rates[d.dimension]),
    amount: round2(d.units * Number(rates[d.dimension])),
  }))

  return {
    state: 'PRICED',
    currency: rateCard.currency ?? null,
    source: rateCard.source ?? null,
    monthlyDelta: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    lines,
    dimensions,
    usagePriced: usage,
    unmodelled,
    undetermined,
    // The total covers the modelled, priced dimensions and nothing else. A
    // reader who ignores this and quotes `monthlyDelta` as "the cost of this
    // change" is wrong by whatever is in these three lists, which is why they
    // travel with the number rather than beside it.
    complete: usage.length === 0 && unmodelled.length === 0 && undetermined.length === 0,
  }
}

const round2 = (n) => Math.round(n * 100) / 100

// ── Review, verdict, evidence ───────────────────────────────────────────────

export function reviewPlan(plan, options = {}) {
  const findings = [
    ...destructiveFindings(plan),
    ...replacementFindings(plan),
    ...publicAccessFindings(plan),
    ...privilegeExpansionFindings(plan),
    ...policyScanFindings(plan, options),
  ]

  const counts = { blocking: 0, review: 0, note: 0, undetermined: 0 }
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1
    if (f.determinacy === 'undetermined') counts.undetermined += 1
  }

  const uncheckedRules = findings.filter((f) => f.determinacy === 'unchecked').map((f) => f.rule)

  // Four verdicts, not three. A change set with nothing wrong in it and a rule
  // nobody ran is not the same as one that was checked against everything and
  // came back clean, and one word for both is the word a reader remembers.
  const verdict =
    counts.blocking > 0
      ? 'BLOCK'
      : counts.review > 0
        ? 'REVIEW'
        : uncheckedRules.length > 0
          ? 'CLEAN_UNCHECKED'
          : 'CLEAN'

  return {
    terraformVersion: plan.terraform_version ?? null,
    formatVersion: plan.format_version ?? null,
    changeCount: actionableChanges(plan).length,
    findings,
    counts,
    uncheckedRules,
    cost: estimateCost(plan, options.rateCard ?? null),
    verdict,
  }
}

/** Deterministic JSON: object keys sorted, so one review has one digest. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Bind a review to the exact bytes it was produced from.
 *
 * `reviewSha256` covers the plan digest as well as the findings, so a seal
 * cannot be lifted off one plan and presented with another: recomputing it
 * against the wrong plan produces a different hash. Nothing here reads the
 * clock, so the same plan reviewed twice — on two machines, a week apart —
 * seals identically, which is what makes a mismatch mean something.
 */
export function sealReview(planText, review) {
  const planSha256 = sha256(planText)
  const body = canonicalJson({ plan: planSha256, review })
  return {
    planSha256,
    reviewSha256: sha256(body),
    algorithm: 'sha256',
    verdict: review.verdict,
    counts: review.counts,
  }
}

export function renderMarkdown(review, seal) {
  const lines = []
  lines.push(`### Change-set review — **${review.verdict}**`)
  lines.push('')
  lines.push(
    `${review.changeCount} resource change(s) · ${review.counts.blocking} blocking · ` +
      `${review.counts.review} to review · ${review.counts.undetermined} undetermined at plan time`,
  )
  lines.push('')

  if (review.findings.length === 0) {
    lines.push('No detector fired.')
  } else {
    lines.push('| severity | detector | address | detail |')
    lines.push('| --- | --- | --- | --- |')
    for (const f of review.findings) {
      // Values are never interpolated — only the address, the attribute path and
      // this module's own sentences reach the table.
      lines.push(
        `| ${f.severity}${f.determinacy === 'undetermined' ? ' (undetermined)' : ''} | ${f.detector} | ` +
          `\`${f.address ?? '—'}\` | ${f.detail} |`,
      )
    }
  }

  lines.push('')
  lines.push('#### Cost')
  if (review.cost.state === 'PRICED') {
    lines.push(
      `Monthly delta **${review.cost.monthlyDelta} ${review.cost.currency ?? ''}** ` +
        `(${review.cost.source ?? 'unnamed rate card'})` +
        (review.cost.complete ? '.' : ' — incomplete; see the unpriced lists below.'),
    )
  } else {
    lines.push(review.cost.why)
    for (const d of review.cost.dimensions) {
      lines.push(`- \`${d.dimension}\` ${d.units > 0 ? '+' : ''}${d.units} unit(s)/month`)
    }
  }
  for (const u of review.cost.usagePriced) {
    lines.push(`- \`${u.address}\` — ${u.why}`)
  }

  if (seal) {
    lines.push('')
    lines.push('#### Evidence')
    lines.push(`- plan \`sha256:${seal.planSha256}\``)
    lines.push(`- review \`sha256:${seal.reviewSha256}\``)
  }
  return lines.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const options = { markdown: false, json: false, rates: null, regions: null, tags: true }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--markdown') options.markdown = true
    else if (arg === '--json') options.json = true
    else if (arg === '--no-tags') options.tags = false
    else if (arg === '--rates') options.rates = argv[++i]
    else if (arg === '--regions') options.regions = argv[++i]?.split(',').filter(Boolean) ?? null
    else positional.push(arg)
  }
  return { options, positional }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('iac-plan-review.mjs')) {
  const { options, positional } = parseArgv(process.argv.slice(2))
  const planPath = positional[0]

  if (!planPath) {
    console.error('usage: node tools/iac-plan-review.mjs <plan.json> [--rates r.json] [--regions a,b] [--markdown|--json]')
    process.exit(2)
  }

  let plan
  let planText
  try {
    planText = fs.readFileSync(planPath, 'utf8')
    plan = parsePlan(planText)
  } catch (error) {
    console.error(`::error::${planPath}: ${error.message}`)
    process.exit(2)
  }

  let rateCard = null
  if (options.rates) {
    try {
      rateCard = JSON.parse(fs.readFileSync(options.rates, 'utf8'))
    } catch (error) {
      console.error(`::error::rate card ${options.rates}: ${error.message}`)
      process.exit(2)
    }
  }

  let tagKeys = null
  if (options.tags) {
    try {
      tagKeys = requiredTagKeys()
    } catch (error) {
      console.error(`::warning::required tags not read (${error.message}); tagging was not checked`)
    }
  }

  const review = reviewPlan(plan, { tagKeys, allowedRegions: options.regions, rateCard })
  const seal = sealReview(planText, review)

  if (options.json) console.log(JSON.stringify({ review, seal }, null, 2))
  else console.log(renderMarkdown(review, seal))

  process.exit(review.verdict === 'BLOCK' ? 1 : 0)
}
