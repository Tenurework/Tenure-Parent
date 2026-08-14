/**
 * STUDIO-080-006 — desired against actual, with the one rule that makes it
 * honest.
 *
 * **When the actual read is not `ok`, the item is severity `unknown` and NO
 * remediation is offered.** "We were not allowed to look" must never produce a
 * plan to recreate a resource that already exists — that plan is how a denied
 * `ecs:DescribeServices` becomes a second load balancer and a doubled bill, or
 * worse, a `CreateDBInstance` beside a live database.
 *
 * The function is pure. It takes the `AwsRead` union directly rather than a
 * plain array, so a denied read is a value it can see rather than an absence it
 * infers, and it can be tested against every arm without an AWS account.
 */

import {
  CONTROL_PLANE_SCHEMA_VERSIONS,
  parseChangeDiff,
  parseDriftFinding,
  type ChangeDiff,
  type ChangeDiffEntry,
  type DriftFinding as PublishedDriftFinding,
} from "@tenure/contracts"

import type { RequiredResourceTag } from "@tenure/provisioning"

import { assessPlanCost, estimateMonthlyMinor, type PlanCostAssessment } from "../cost-report"
import type { S3Readings } from "./buckets"
import type { CognitoReadings } from "./cognito"
import type { DynamoDbReadings } from "./dynamodb-tables"
import type { EstateResource } from "./inventory"
import type { NetworkReadings, SecurityGroupRule } from "./network"
import { isUnknown, type AwsRead } from "./read"

/* --------------------------------------------------------------- desired -- */

export interface DesiredResource {
  /** Stable across reads. `<type>/<name>`, never an ARN — an ARN is an outcome. */
  resourceKey: string
  resourceType: string
  /** The named seat that answers for it. A role, never a person who can leave. */
  owner: string
  /** What its absence costs, which is what decides severity. */
  severityIfMissing: Exclude<DriftSeverity, "unknown">
  detail: string
}

export type DriftSeverity =
  /** Users cannot be served without it. */
  | "serving"
  /** It bills, or its absence bills. Money, not availability. */
  | "costly"
  /** Neither. A tag, a name, a description. */
  | "cosmetic"
  /** The actual side could not be read. Not a severity so much as a refusal to guess. */
  | "unknown"

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  unknown: 0,
  serving: 1,
  costly: 2,
  cosmetic: 3,
}

/**
 * What a published deployment implies should exist in AWS.
 *
 * Derived from the artifact the registry already holds — `DeploymentManifest`
 * says whether the tenant is serving and which modules it runs — rather than
 * from a second list maintained by hand. A hand-maintained expectation is one
 * that disagrees with the artifact the first time somebody edits one of them.
 */
export function desiredFromDeployment(input: {
  slug: string
  serving: boolean
  isolation: string
  ownerSeat: string
}): readonly DesiredResource[] {
  const desired: DesiredResource[] = []

  if (input.serving) {
    desired.push({
      resourceKey: `ecs:service/${input.slug}`,
      resourceType: "ecs:service",
      owner: input.ownerSeat,
      severityIfMissing: "serving",
      detail: "The artifact says this tenant serves traffic, which requires a running service.",
    })
  }

  if (input.isolation !== "pooled") {
    desired.push({
      resourceKey: `rds:db/${input.slug}`,
      resourceType: "rds:db",
      owner: input.ownerSeat,
      severityIfMissing: "serving",
      detail: "A non-pooled tenant has its own database; the artifact was published against one.",
    })
    desired.push({
      resourceKey: `cloudfront:distribution/${input.slug}`,
      resourceType: "cloudfront:distribution",
      owner: input.ownerSeat,
      severityIfMissing: "costly",
      detail: "A dedicated tenant has its own edge distribution, which bills whether or not it serves.",
    })
  }

  return desired
}

/* ----------------------------------------------------------------- drift -- */

export type Remediation =
  | { safe: true; describe: string }
  | { safe: false; refusedBecause: string; awsCliCommand: string }

export interface DriftItem {
  resourceKey: string
  severity: DriftSeverity
  owner: string
  desired: DesiredResource
  actual: EstateResource | { unknown: true; because: string }
  /** Absent for `unknown`. The type does not permit a plan built on a blind read. */
  remediation?: Remediation
  firstSeenAt: string
  occurrences: number
}

export interface DriftReport {
  items: readonly DriftItem[]
  /** Whether any input arrived unknown, so the page can say the report is partial. */
  partial: boolean
  asOf: string
}

/** Where recurrence counts and ignores are read from, so drift knows it repeats. */
export interface DriftHistory {
  /** resourceKey → { firstSeenAt, occurrences } */
  seen: ReadonlyMap<string, { firstSeenAt: string; occurrences: number }>
  /** resourceKey → the unexpired ignore, if one exists. */
  ignored: ReadonlyMap<string, DriftIgnore>
}

export const EMPTY_HISTORY: DriftHistory = { seen: new Map(), ignored: new Map() }

/**
 * Compare what should exist against what was read.
 *
 * `actual` is the whole set of readings, one per surface. A surface that came
 * back DENIED / THROTTLED / ERROR makes every desired resource of that type
 * `unknown`, which is the rule the module exists for.
 */
export function compareDesiredToActual(
  desired: readonly DesiredResource[],
  actual: readonly AwsRead<readonly EstateResource[]>[],
  options: { now: Date; slug: string; history?: DriftHistory },
): DriftReport {
  const history = options.history ?? EMPTY_HISTORY
  const asOf = options.now.toISOString()

  // Index the resources that WERE read, and remember which surfaces were not.
  const found = new Map<string, EstateResource>()
  const blindTypes = new Map<string, string>()
  let partial = false

  for (const reading of actual) {
    if (isUnknown(reading)) {
      partial = true
      const because = unreadableBecause(reading)
      // The capability names the surface; every desired resource whose type is
      // served by it is unreadable.
      blindTypes.set(surfaceTypeFor(reading.capability), because)
      continue
    }
    // Narrowed on the presence of `value` rather than on `state !== "EMPTY"`.
    // `isUnknown` returns a boolean rather than a type predicate, so the four
    // unknown arms are still in the union here as far as the compiler is
    // concerned, and EMPTY is not the only arm that carries no resources.
    if (!("value" in reading)) continue
    for (const resource of reading.value) {
      found.set(`${resource.resourceType}/${nameKeyOf(resource)}`, resource)
      found.set(resource.arn, resource)
    }
  }

  const items: DriftItem[] = []
  for (const want of desired) {
    if (history.ignored.has(want.resourceKey)) continue

    const previous = history.seen.get(want.resourceKey)
    const firstSeenAt = previous?.firstSeenAt ?? asOf
    const occurrences = (previous?.occurrences ?? 0) + 1

    const blind = blindTypes.get(want.resourceType)
    if (blind) {
      items.push({
        resourceKey: want.resourceKey,
        severity: "unknown",
        owner: want.owner,
        desired: want,
        actual: { unknown: true, because: blind },
        // No remediation. Deliberately absent, not `{safe:false}` — even the
        // refusal text would imply we know the resource is missing.
        firstSeenAt,
        occurrences,
      })
      continue
    }

    const match = found.get(want.resourceKey)
    if (match) continue

    items.push({
      resourceKey: want.resourceKey,
      severity: want.severityIfMissing,
      owner: want.owner,
      desired: want,
      actual: { unknown: false, because: "" } as never,
      remediation:
        want.severityIfMissing === "serving"
          ? {
              safe: false,
              refusedBecause:
                "Recreating a serving resource from the console would deploy outside the lifecycle, with no approval and no evidence row.",
              awsCliCommand: cliFor(want),
            }
          : { safe: true, describe: `Re-run the CONFIGURING step for ${options.slug} — it publishes the artifact that declares ${want.resourceKey}.` },
      firstSeenAt,
      occurrences,
    })
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return { items, partial, asOf }
}

/**
 * Why a reading could not be used, in the operator's words.
 *
 * One function rather than a ternary at each site: `compareDesiredToActual`
 * above and `estateDrift` below both have to turn a refused read into a
 * sentence, and two spellings of the same refusal is how one surface ends up
 * saying "unavailable" where the other says which action was denied. The
 * DENIED arm names the IAM action and the error code, because that is the pair
 * an operator needs to write the statement that fixes it.
 *
 * Takes the whole union rather than the four unknown arms, because `isUnknown`
 * returns a boolean rather than a type predicate — the readable arms are still
 * in the union as far as the compiler is concerned at every call site.
 */
export function unreadableBecause(read: AwsRead<unknown>): string {
  switch (read.state) {
    case "DENIED":
      return `${read.action} was refused (${read.errorCode})`
    case "THROTTLED":
      return `AWS rate-limited ${read.capability}`
    case "UNCONFIGURED":
      return read.why
    case "ERROR":
      return `${read.capability} failed`
    default:
      return `${read.capability} was read, so there is no reason to give`
  }
}

/** The name half of a resource key, for matching a live resource to a desired one. */
function nameKeyOf(resource: EstateResource): string {
  const slug = resource.attribution.kind === "tenant" ? resource.attribution.tenantSlug : ""
  return slug || resource.name
}

/** Which resource type a capability's reading covers. */
function surfaceTypeFor(capability: string): string {
  if (capability.startsWith("ecs:")) return "ecs:service"
  if (capability.startsWith("rds:")) return "rds:db"
  if (capability.startsWith("cloudfront:")) return "cloudfront:distribution"
  if (capability.startsWith("acm:")) return "acm:certificate"
  return capability
}

function cliFor(want: DesiredResource): string {
  switch (want.resourceType) {
    case "ecs:service":
      return `aws ecs create-service --cluster <cluster> --service-name ${want.resourceKey.split("/")[1]} --task-definition <task-def>`
    case "rds:db":
      return `aws rds create-db-instance --db-instance-identifier ${want.resourceKey.split("/")[1]} --db-instance-class <class> --engine postgres`
    default:
      return `aws ${want.resourceType.split(":")[0]} help`
  }
}

/* --------------------------------------- the machine-readable AWS arm -- */

/**
 * STUDIO-060-003 — the estate half of a change diff, as a document rather than
 * a sentence.
 *
 * `compareDesiredToActual` above answers "what is wrong". This answers "what
 * would reconciling it DO", which is a different question and the one an
 * operator is being asked to approve. Two facts have to survive the trip and
 * neither is derivable by whoever renders the result:
 *
 *   * `effect` — a desired resource that is absent becomes a `create`; a live
 *     resource nothing manages becomes a `delete`.
 *   * `reversible` — set from what the resource IS. `EstateResource.contract.
 *     stateful` is decided in `inventory.ts`, at the only point that knows the
 *     resource type it just mapped. Deleting an ECS service and putting it back
 *     is a deployment. Deleting an RDS instance and putting it back is a new,
 *     empty database with the same name, and a confirmation surface that cannot
 *     tell those apart either blocks everything or blocks nothing.
 *
 * ## `unknown` items are not entries
 *
 * A drift item whose actual side could not be read is DELIBERATELY omitted. The
 * whole rule this module was written for is that "we were not allowed to look"
 * must not become a plan to recreate a resource that already exists — and an
 * entry in a diff is exactly such a plan, one step further along than the
 * remediation text that is already withheld. The count is reported instead, so
 * the omission is visible rather than silent.
 */
export interface ResourceChangeDiff {
  diff: ChangeDiff
  /** The plan's assessed cost and the approval band it lands in. */
  cost: PlanCostAssessment
  /** Desired resources whose actual state could not be read, and so are not in the diff. */
  unreadable: number
}

/**
 * The tag that says something manages a resource.
 *
 * Typed as `RequiredResourceTag` rather than as a string, so renaming the key in
 * the twelve-key contract stops this file compiling instead of quietly making
 * every resource in the estate read as unmanaged — which would be a diff
 * proposing to delete the entire fleet.
 */
const MANAGED_BY_TAG: RequiredResourceTag = "tenure:managed-by"

export function resourceChangeDiff(input: {
  /** Everything the estate read returned, already narrowed to ACTUAL surfaces. */
  live: readonly EstateResource[]
  /** Desired-but-absent resources, from `compareDesiredToActual`. Optional. */
  missing?: DriftReport
  now: Date
  /** What the plan is called, for the cost figure's key. */
  reference: string
}): ResourceChangeDiff {
  const entries: ChangeDiffEntry[] = []
  const priced: { change: string; monthlyMinor: number | null }[] = []

  // A live resource that nothing claims. Reconciling it means deleting it, and
  // whether that is recoverable is a property of the resource, not of the plan.
  for (const resource of input.live) {
    if ((resource.tags[MANAGED_BY_TAG] ?? "").trim()) continue
    const monthlyMinor = estimateMonthlyMinor(resource.resourceType)
    const delta = monthlyMinor === null ? null : -monthlyMinor
    entries.push({
      domain: "aws-resource",
      path: resource.arn,
      before: resource.resourceType,
      after: null,
      effect: "delete",
      reversible: !resource.contract.stateful,
      monthlyCostDeltaMinor: delta,
    })
    priced.push({ change: `delete ${resource.resourceType} ${resource.name}`, monthlyMinor: delta })
  }

  let unreadable = 0
  for (const item of input.missing?.items ?? []) {
    if (item.severity === "unknown") {
      unreadable += 1
      continue
    }
    const monthlyMinor = estimateMonthlyMinor(item.desired.resourceType)
    entries.push({
      domain: "aws-resource",
      path: item.resourceKey,
      before: null,
      after: item.desired.resourceType,
      effect: "create",
      // Creating a resource is undone by removing it, whatever it is: nothing
      // existed before, so nothing is lost by going back.
      reversible: true,
      monthlyCostDeltaMinor: monthlyMinor,
    })
    priced.push({ change: `create ${item.resourceKey}`, monthlyMinor })
  }

  const cost = assessPlanCost({ changes: priced, now: input.now, reference: input.reference })

  // The cost arm, as its own entry rather than a footnote. `previewPlanCost`
  // assesses the plan's TOTAL as well as each change in it — ten changes at $60
  // a month is $600 a month, and approving them one at a time is how a fleet's
  // bill grows with no single decision to grow it.
  if (entries.length > 0) {
    entries.push({
      domain: "cost",
      path: `${input.reference} in total`,
      before: null,
      after: cost.level,
      effect: "create",
      reversible: true,
      monthlyCostDeltaMinor: cost.totalMinor,
    })
  }

  return {
    // Parsed, not asserted: the document a surface renders is the document the
    // contract admitted, so a producer that starts emitting a domain nothing
    // computes is refused here rather than rendered as an empty section.
    diff: parseChangeDiff({ schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ChangeDiff, entries }),
    cost,
    unreadable,
  }
}

/**
 * The entries a confirmation surface must refuse to carry out unattended.
 *
 * A deletion that cannot be undone is not "a change with a warning on it". The
 * estate page renders these as refusals and offers no reconcile action for
 * them; `mutate.ts` is the only path that could execute one, and it requires a
 * typed target and an approval.
 */
export function irreversibleEntries(diff: ChangeDiff): readonly ChangeDiffEntry[] {
  return diff.entries.filter((entry) => entry.effect === "delete" && !entry.reversible)
}

/* ---------------------------------------------------------------- ignore -- */

export interface DriftIgnore {
  resourceKey: string
  justification: string
  /** Required. An ignore with no expiry is a deleted finding. */
  expiresAt: string
  actor: string
  createdAt: string
}

export class IgnoreWithoutExpiry extends Error {
  constructor(resourceKey: string) {
    super(
      `An ignore for ${resourceKey} must carry expiresAt. A permanent ignore is a deleted finding: ` +
        `the drift stops being reported and nobody ever decides again whether it matters.`,
    )
    this.name = "IgnoreWithoutExpiry"
  }
}

/**
 * Build an ignore record, refusing one with no expiry.
 *
 * Thrown at CONSTRUCTION rather than validated at write time, so there is no
 * shape of this object anywhere in the process that lacks an expiry.
 */
export function driftIgnore(input: {
  resourceKey: string
  justification: string
  expiresAt?: string
  actor: string
  now: Date
}): DriftIgnore {
  if (!input.expiresAt || !input.expiresAt.trim()) throw new IgnoreWithoutExpiry(input.resourceKey)
  if (Number.isNaN(Date.parse(input.expiresAt))) throw new IgnoreWithoutExpiry(input.resourceKey)
  if (Date.parse(input.expiresAt) <= input.now.getTime()) {
    throw new IgnoreWithoutExpiry(input.resourceKey)
  }
  if (!input.justification.trim()) {
    throw new Error(`An ignore for ${input.resourceKey} must carry a justification.`)
  }
  return {
    resourceKey: input.resourceKey,
    justification: input.justification,
    expiresAt: input.expiresAt,
    actor: input.actor,
    createdAt: input.now.toISOString(),
  }
}

/** The registry row an ignore is stored as. `sk` keeps it under the tenant's partition. */
export function ignoreItem(slug: string, ignore: DriftIgnore): Record<string, unknown> {
  return {
    pk: `TENANT#${slug}`,
    sk: `DRIFT#IGNORE#${ignore.resourceKey}`,
    slug,
    ignore,
    expiresAt: ignore.expiresAt,
  }
}

/** Ignores that have not expired, from what the registry returned. */
export function activeIgnores(
  rows: readonly Record<string, unknown>[],
  now: Date,
): ReadonlyMap<string, DriftIgnore> {
  const out = new Map<string, DriftIgnore>()
  for (const row of rows) {
    const ignore = row.ignore as DriftIgnore | undefined
    if (!ignore?.expiresAt) continue
    if (Date.parse(ignore.expiresAt) <= now.getTime()) continue
    out.set(ignore.resourceKey, ignore)
  }
  return out
}

/* ==========================================================================
 * DECLARED VERSUS OBSERVED — STUDIO-000-009
 * ========================================================================== */

/**
 * Terraform declares the estate; the readers observe it. This is where the two
 * meet, and it models THREE kinds of disagreement because they mean three
 * different things and call for three different responses:
 *
 *   * **absent** — declared, and nothing answering to that name was read. The
 *     apply did not take, or something deleted it.
 *   * **undeclared** — read, and no declaration names it. Somebody made it in
 *     the console. This is the finding STUDIO-000-009 asks for and it is the
 *     more dangerous of the two: nothing will ever reconcile it, nobody
 *     reviewed it, and it bills.
 *   * **divergent** — declared AND present, with a setting that does not match.
 *     The one that matters most, because it is the posture Terraform sets and
 *     nothing reads back: a bucket's public-access block, a bucket's
 *     encryption, a security group's ingress, a user pool's MFA.
 *
 * ── Why the declared side is parsed from `.tf` and not from state ──────────
 *
 * The state file is not in this repository and must not be fetched: it holds
 * every attribute Terraform ever wrote, including ones marked sensitive. The
 * source is what a reviewer reads and what a pull request changes, so the
 * source is what this compares against.
 *
 * ── What a source-derived expectation CANNOT see, and why that is a value ──
 *
 * A source parser cannot resolve `count`, `for_each`, `var.*`, `local.*` or a
 * `${…}` interpolation. `aws_s3_bucket.documents` declares
 * `"${local.name_prefix}-documents-${local.account_id}"`, and the name AWS
 * actually gave it depends on two values that only exist after an apply.
 *
 * Counting that as *absent* would put a fabricated deletion on the page every
 * single render. So it is reported as UN-COMPARABLE — its own list, never a
 * finding — and it also suppresses the *undeclared* verdict for live resources
 * of the same type, because a resource this parser cannot match may well be the
 * very one the unresolvable declaration made. An un-comparable declaration
 * counted as drift is noise, and noise is how a drift report gets ignored.
 *
 * The one thing a `${…}` name CAN yield honestly is its literal segments.
 * `"${local.name_prefix}-documents-${local.account_id}"` must render to
 * something containing `-documents-`, whatever the variables hold. So an
 * interpolated name becomes a PATTERN, and a pattern that matches exactly one
 * live resource is a match. Two matches is an ambiguity and is reported as
 * un-comparable; zero matches is un-comparable too, and emphatically NOT
 * absence — the variables could render to a name none of these carry.
 *
 * ── The rule inherited from the top of this file ──────────────────────────
 *
 * When the observed side could not be read, nothing is absent. A refused
 * `s3:ListAllMyBuckets` produces a blind surface, not an estate with no
 * buckets. The same rule, one layer up.
 */

/* --------------------------------------------- the declared side: parsing -- */

/** One `.tf` file, as read. Structurally what `declared-estate.ts` collects. */
export interface TerraformSource {
  /** Repository-relative, so a report can name what it read. */
  path: string
  text: string
}

/**
 * The name AWS would know a declared resource by.
 *
 * Three arms and no fourth, because there are exactly three things a source
 * parser can honestly say about a name: it is this string; it is some string
 * shaped like this; or this parser cannot say.
 */
export type DeclaredName =
  /** A quoted literal with no interpolation. The only arm that can prove absence. */
  | { kind: "literal"; value: string }
  /**
   * Interpolated, with enough literal text to recognise. `expression` is the
   * source verbatim; `pattern` is a regular expression source built from the
   * literal segments, with `.*` where the interpolations are.
   */
  | { kind: "pattern"; expression: string; pattern: string; segments: readonly string[] }
  /** No name attribute, an unquoted reference, or too little literal text. */
  | { kind: "unresolvable"; expression: string; why: string }

/** Whether the block declares one instance or a variable number of them. */
export type DeclaredMultiplicity =
  | { kind: "single" }
  /** `count` or `for_each`: between zero and many, and the source cannot say which. */
  | { kind: "meta"; meta: "count" | "for_each"; expression: string }

/** A nested block inside a resource, one level of the same shape. */
export interface DeclaredBlock {
  type: string
  attributes: ReadonlyMap<string, string>
  blocks: readonly DeclaredBlock[]
}

export interface TerraformDeclaration {
  /** The file it was declared in. */
  file: string
  /** 1-indexed line of the `resource` keyword, so a report can cite it. */
  line: number
  /** `aws_s3_bucket`. */
  terraformType: string
  /** The Terraform label — always a literal, always present. */
  label: string
  /** `aws_s3_bucket.documents`. The address is resolvable even when the name is not. */
  address: string
  /** The estate resource type (`s3:bucket`), or null when this build maps none. */
  resourceType: string | null
  name: DeclaredName
  multiplicity: DeclaredMultiplicity
  /** Top-level attributes, raw source text on the right-hand side. */
  attributes: ReadonlyMap<string, string>
  blocks: readonly DeclaredBlock[]
  /**
   * The settings this declaration asserts, keyed exactly as an observed
   * resource keys them. Includes settings contributed by SIDECAR resources —
   * `aws_s3_bucket_public_access_block` configures a bucket it does not own.
   */
  expected: ReadonlyMap<string, string>
}

export interface TerraformEstate {
  /**
   * Whether any Terraform was readable at all.
   *
   * False is the normal case in the deployed container, which ships the
   * application and not the infrastructure. It must render as "this cannot be
   * compared here" and never as "nothing is declared" — the latter reports the
   * whole account as undeclared drift, which is the loudest false finding this
   * comparison could produce.
   */
  known: boolean
  resources: readonly TerraformDeclaration[]
  files: readonly string[]
  /** `aws_*` types this build maps to no estate resource type. Reported, never dropped. */
  unmappedTypes: readonly string[]
  /**
   * Declarations that configure a resource this parser could not find — a
   * `bucket = aws_s3_bucket.x.id` whose target is in a file that was not read.
   */
  danglingSidecars: readonly { address: string; file: string; targetRef: string }[]
  /** Why nothing is known, when nothing is. Empty when `known`. */
  because: string
}

/**
 * Terraform type → the estate resource type this console's readers produce.
 *
 * Every entry here is a type at least one reader in this directory can observe,
 * or one an inventory section already names. A type absent from this table is
 * still parsed and still counted in `unmappedTypes`; it simply takes no part in
 * the comparison, which is the honest outcome for a declaration nothing looks
 * for.
 */
const TERRAFORM_TO_ESTATE: Readonly<Record<string, string>> = {
  aws_s3_bucket: "s3:bucket",
  aws_security_group: "ec2:security-group",
  aws_cognito_user_pool: "cognito-idp:userpool",
  aws_dynamodb_table: "dynamodb:table",
  aws_ecs_service: "ecs:service",
  aws_ecs_cluster: "ecs:cluster",
  aws_db_instance: "rds:db",
  aws_cloudfront_distribution: "cloudfront:distribution",
  aws_acm_certificate: "acm:certificate",
  aws_ecr_repository: "ecr:repository",
  aws_sqs_queue: "sqs:queue",
  aws_kms_key: "kms:key",
  aws_secretsmanager_secret: "secretsmanager:secret",
  aws_cloudwatch_log_group: "logs:log-group",
  aws_elasticache_replication_group: "elasticache:replication-group",
  aws_lb: "elasticloadbalancing:loadbalancer",
  aws_cloudtrail: "cloudtrail:trail",
  aws_route53_zone: "route53:hostedzone",
  aws_lambda_function: "lambda:function",
  aws_wafv2_web_acl: "wafv2:webacl",
  aws_vpc: "ec2:vpc",
  aws_subnet: "ec2:subnet",
}

/**
 * Which attribute carries the name AWS will know the resource by.
 *
 * Null means the resource has no declarable name — CloudFront allocates a
 * distribution id, a VPC gets a vpc-…, and there is nothing in the source to
 * compare. That is `unresolvable`, which is un-comparable, which is right: the
 * alternative is comparing the Terraform label against an AWS-allocated id and
 * reporting every distribution in the account as both absent and undeclared.
 */
const TERRAFORM_NAME_ATTRIBUTE: Readonly<Record<string, string | null>> = {
  aws_s3_bucket: "bucket",
  aws_security_group: "name",
  aws_cognito_user_pool: "name",
  aws_dynamodb_table: "name",
  aws_ecs_service: "name",
  aws_ecs_cluster: "name",
  aws_db_instance: "identifier",
  aws_cloudfront_distribution: null,
  aws_acm_certificate: "domain_name",
  aws_ecr_repository: "name",
  aws_sqs_queue: "name",
  aws_kms_key: null,
  aws_secretsmanager_secret: "name",
  aws_cloudwatch_log_group: "name",
  aws_elasticache_replication_group: "replication_group_id",
  aws_lb: "name",
  aws_cloudtrail: "name",
  aws_route53_zone: "name",
  aws_lambda_function: "function_name",
  aws_wafv2_web_acl: "name",
  aws_vpc: null,
  aws_subnet: null,
}

/** Non-AWS providers. Skipped, and not counted as unmappable. */
const NON_AWS_PREFIXES = ["random_", "null_", "tls_", "local_", "time_", "archive_", "external_"]

/**
 * Setting keys, spelled once.
 *
 * The declared side and the observed side must agree on these strings or a
 * divergence silently becomes "this build reads no such setting". Exported so a
 * surface can label a finding without re-typing the key, and so the test can
 * assert on the constant rather than on a string it copied.
 */
export const DRIFT_SETTINGS = {
  blockPublicAcls: "public-access-block.block_public_acls",
  ignorePublicAcls: "public-access-block.ignore_public_acls",
  blockPublicPolicy: "public-access-block.block_public_policy",
  restrictPublicBuckets: "public-access-block.restrict_public_buckets",
  bucketEncryption: "encryption.sse_algorithm",
  bucketVersioning: "versioning.status",
  mfaConfiguration: "mfa_configuration",
  softwareTokenMfa: "software_token_mfa_configuration.enabled",
  adminCreateUserOnly: "admin_create_user_config.allow_admin_create_user_only",
  tableEncryption: "server_side_encryption.enabled",
  tablePointInTimeRecovery: "point_in_time_recovery.enabled",
  tableDeletionProtection: "deletion_protection_enabled",
  tableBillingMode: "billing_mode",
} as const

/**
 * The key one security-group ingress rule is compared under.
 *
 * Protocol and port range, because that is the pair that decides what can be
 * reached. The VALUE under the key is the set of sources, which is what decides
 * who can reach it — so a rule whose source changed from the CloudFront prefix
 * list to `0.0.0.0/0` keeps its key and changes its value, and reads as a
 * divergence rather than as one absent rule beside one undeclared rule.
 */
export function ingressSettingKey(
  protocol: string,
  fromPort: number | null,
  toPort: number | null,
): string {
  const ports = fromPort === null && toPort === null ? "any" : `${fromPort ?? "any"}-${toPort ?? "any"}`
  return `ingress[${protocol}/${ports}]`
}

/* --------------------------------------------------- the HCL-enough parser -- */

/**
 * Comments removed, string bodies kept.
 *
 * `#` and `//` only start a comment OUTSIDE a string — `"https://x"` is not a
 * comment, and a parser that thinks it is loses the second half of every URL in
 * the file.
 */
function stripComments(line: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        if (i + 1 < line.length) out += line[i + 1]
        i += 1
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "#") break
    if (ch === "/" && line[i + 1] === "/") break
    out += ch
  }
  return out
}

/** Comments AND string bodies removed, so braces inside strings do not count. */
function skeletonOf(line: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inString) {
      if (ch === "\\") {
        i += 1
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "#") break
    if (ch === "/" && line[i + 1] === "/") break
    out += ch
  }
  return out
}

/** Net bracket depth a line contributes, counted on its skeleton. */
function bracketDelta(skeleton: string): number {
  let delta = 0
  for (const ch of skeleton) {
    if (ch === "{" || ch === "[" || ch === "(") delta += 1
    else if (ch === "}" || ch === "]" || ch === ")") delta -= 1
  }
  return delta
}

/** The heredoc terminator a line opens, or null. `<<EOT` and `<<-"EOT"` both. */
function heredocOpenedBy(line: string): string | null {
  const match = /<<[-~]?\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*$/.exec(stripComments(line).trimEnd())
  return match ? match[1] : null
}

interface ParsedBody {
  attributes: Map<string, string>
  blocks: DeclaredBlock[]
}

/**
 * Parse the inside of a block: attributes and nested blocks.
 *
 * Brace-counting rather than the "a line that is exactly `}`" rule, because
 * every IAM policy in `infrastructure/studio/iam.tf` is a `jsonencode({…})`
 * whose braces are real and whose inner `name = "…"` lines would otherwise be
 * read as attributes of the resource. A multi-line value is consumed WHOLE, so
 * what is inside a `jsonencode` stays inside it.
 *
 * Heredocs are skipped entirely: their contents are text, and text containing a
 * brace is not a block.
 */
function parseBody(lines: readonly string[], from: number, to: number): ParsedBody {
  const attributes = new Map<string, string>()
  const blocks: DeclaredBlock[] = []
  let heredoc: string | null = null

  for (let i = from; i <= to; i += 1) {
    const raw = lines[i]
    if (heredoc !== null) {
      if (raw.trim() === heredoc) heredoc = null
      continue
    }

    const commented = stripComments(raw)
    const trimmed = commented.trim()
    if (trimmed === "") continue

    const attribute = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(trimmed)
    if (attribute) {
      const opener = heredocOpenedBy(raw)
      if (opener !== null) {
        heredoc = opener
        attributes.set(attribute[1], "<<heredoc")
        continue
      }
      let value = attribute[2].trim()
      let depth = bracketDelta(skeletonOf(raw))
      while (depth > 0 && i < to) {
        i += 1
        const more = lines[i]
        const moreHeredoc = heredocOpenedBy(more)
        if (moreHeredoc !== null) {
          // A heredoc inside a multi-line value. Skip to its terminator and
          // keep counting brackets from after it.
          while (i < to && lines[i + 1]?.trim() !== moreHeredoc) i += 1
          i += 1
          continue
        }
        value += ` ${stripComments(more).trim()}`
        depth += bracketDelta(skeletonOf(more))
      }
      attributes.set(attribute[1], value.trim())
      continue
    }

    const blockOpen = /^([A-Za-z0-9_-]+)\s*\{(.*)$/.exec(trimmed)
    if (!blockOpen) continue

    if (bracketDelta(skeletonOf(raw)) === 0) {
      // A one-line block: `filter { prefix = "tmp/" }`.
      const inner = trimmed.slice(trimmed.indexOf("{") + 1, trimmed.lastIndexOf("}"))
      const oneLine = new Map<string, string>()
      for (const pair of inner.matchAll(/([A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^,}]+)/g)) {
        oneLine.set(pair[1], pair[2].trim())
      }
      blocks.push({ type: blockOpen[1], attributes: oneLine, blocks: [] })
      continue
    }

    let depth = bracketDelta(skeletonOf(raw))
    let end = i
    let innerHeredoc: string | null = heredocOpenedBy(raw)
    while (depth > 0 && end < to) {
      end += 1
      if (innerHeredoc !== null) {
        if (lines[end].trim() === innerHeredoc) innerHeredoc = null
        continue
      }
      innerHeredoc = heredocOpenedBy(lines[end])
      if (innerHeredoc !== null) continue
      depth += bracketDelta(skeletonOf(lines[end]))
    }
    const nested = parseBody(lines, i + 1, end - 1)
    blocks.push({ type: blockOpen[1], attributes: nested.attributes, blocks: nested.blocks })
    i = end
  }

  return { attributes, blocks }
}

/** The value with its surrounding quotes removed, when it has a matched pair. */
function unquote(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return null
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** How much literal text a pattern needs before it is worth matching on. */
export const MIN_PATTERN_LITERAL = 3

/**
 * What the source says the resource will be called.
 *
 * The `pattern` arm is the interesting one. `"${local.name_prefix}-tenants"`
 * cannot be resolved, but it CANNOT render to anything that does not end in
 * `-tenants` — that is a fact about the string, not a guess about the
 * variables. Below `MIN_PATTERN_LITERAL` characters of literal text the pattern
 * matches half the account, so it is refused rather than used.
 */
export function declaredNameOf(raw: string | undefined, why: string): DeclaredName {
  if (raw === undefined) return { kind: "unresolvable", expression: "", why }
  const inner = unquote(raw)
  if (inner === null) {
    return {
      kind: "unresolvable",
      expression: raw.trim(),
      why: "the name is an unquoted expression, so its value exists only after an apply",
    }
  }
  if (!inner.includes("${")) return { kind: "literal", value: inner }

  const segments = inner.split(/\$\{[^{}]*\}/g)
  if (segments.some((segment) => segment.includes("${") || segment.includes("}"))) {
    return {
      kind: "unresolvable",
      expression: raw.trim(),
      why: "the name interpolates a nested expression this parser does not resolve",
    }
  }
  const literal = segments.join("")
  if (literal.length < MIN_PATTERN_LITERAL) {
    return {
      kind: "unresolvable",
      expression: raw.trim(),
      why:
        `the name is almost entirely interpolated (${literal.length} literal character(s)), ` +
        `so any pattern built from it would match unrelated resources`,
    }
  }
  return {
    kind: "pattern",
    expression: raw.trim(),
    pattern: `^${segments.map(escapeRegex).join(".*")}$`,
    segments: segments.filter((segment) => segment !== ""),
  }
}

/** `aws_s3_bucket.documents.id` → `aws_s3_bucket.documents`. Null when not a reference. */
export function referencedAddress(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const match = /^(aws_[A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)/.exec(raw.trim())
  return match ? `${match[1]}.${match[2]}` : null
}

/** Quoted strings inside a list literal, or null when the list holds references. */
function listElements(raw: string | undefined): { quoted: readonly string[]; count: number } {
  if (raw === undefined) return { quoted: [], count: 0 }
  const quoted = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim()
  const count = inner === "" ? 0 : inner.split(",").filter((part) => part.trim() !== "").length
  return { quoted, count }
}

/**
 * Parse every `resource` block out of a set of `.tf` files.
 *
 * Pure: it takes the file text, never the filesystem, so the whole declared
 * side is testable without a repository checkout and the module stays free of
 * `node:fs` — which is what lets a route, a test and a script all use it.
 */
export function parseTerraformEstate(files: readonly TerraformSource[]): TerraformEstate {
  if (files.length === 0) {
    return {
      known: false,
      resources: [],
      files: [],
      unmappedTypes: [],
      danglingSidecars: [],
      because:
        "No Terraform source was readable from this process, so what is running cannot be compared " +
        "against what was declared. This is the normal case in the deployed container, which ships " +
        "the application and not the infrastructure that provisions it — it is not a statement that " +
        "nothing is declared.",
    }
  }

  const resources: MutableTerraformDeclaration[] = []
  const unmapped = new Set<string>()

  for (const file of files) {
    const lines = file.text.split(/\r?\n/)
    let heredoc: string | null = null

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i]
      if (heredoc !== null) {
        if (raw.trim() === heredoc) heredoc = null
        continue
      }
      const opener = heredocOpenedBy(raw)
      const declared = /^resource\s+"([A-Za-z0-9_]+)"\s+"([^"]+)"\s*\{/.exec(stripComments(raw))
      if (!declared) {
        if (opener !== null) heredoc = opener
        continue
      }

      // Find the matching close before deciding anything about the block.
      let depth = bracketDelta(skeletonOf(raw))
      let end = i
      let inner: string | null = opener
      while (depth > 0 && end < lines.length - 1) {
        end += 1
        if (inner !== null) {
          if (lines[end].trim() === inner) inner = null
          continue
        }
        inner = heredocOpenedBy(lines[end])
        if (inner !== null) continue
        depth += bracketDelta(skeletonOf(lines[end]))
      }

      const terraformType = declared[1]
      const label = declared[2]
      if (NON_AWS_PREFIXES.some((prefix) => terraformType.startsWith(prefix))) {
        i = end
        continue
      }

      const body = parseBody(lines, i + 1, end - 1)
      const resourceType = TERRAFORM_TO_ESTATE[terraformType] ?? null
      if (resourceType === null && terraformType.startsWith("aws_")) unmapped.add(terraformType)

      const nameAttribute = TERRAFORM_NAME_ATTRIBUTE[terraformType]
      const name =
        nameAttribute === null
          ? {
              kind: "unresolvable" as const,
              expression: "",
              why:
                `AWS allocates the identifier for ${terraformType}; the source declares no name, ` +
                "so there is nothing to compare a live resource's identifier against",
            }
          : declaredNameOf(
              nameAttribute === undefined ? undefined : body.attributes.get(nameAttribute),
              nameAttribute === undefined
                ? `this build does not know which attribute names a ${terraformType}`
                : `${terraformType} declares no ${nameAttribute}`,
            )

      const countExpression = body.attributes.get("count")
      const forEachExpression = body.attributes.get("for_each")
      const multiplicity: DeclaredMultiplicity =
        countExpression !== undefined
          ? { kind: "meta", meta: "count", expression: countExpression }
          : forEachExpression !== undefined
            ? { kind: "meta", meta: "for_each", expression: forEachExpression }
            : { kind: "single" }

      resources.push({
        file: file.path,
        line: i + 1,
        terraformType,
        label,
        address: `${terraformType}.${label}`,
        resourceType,
        name,
        multiplicity,
        attributes: body.attributes,
        blocks: body.blocks,
        expected: new Map<string, string>(),
      })
      i = end
    }
  }

  const dangling = attachExpectations(resources)

  return {
    known: true,
    resources,
    files: files.map((file) => file.path),
    unmappedTypes: [...unmapped].sort(),
    danglingSidecars: dangling,
    because: "",
  }
}

interface MutableTerraformDeclaration extends Omit<TerraformDeclaration, "expected"> {
  expected: Map<string, string>
}

/**
 * Fill in each declaration's expected settings, including the ones a SIDECAR
 * resource contributes.
 *
 * `aws_s3_bucket_public_access_block.documents` is where the public-access
 * posture of `aws_s3_bucket.documents` is declared — a separate resource
 * pointing at the first through `bucket = aws_s3_bucket.documents.id`. Reading
 * it as its own row would compare it against nothing, because no reader
 * observes "a public access block" as a resource; it is observed as four flags
 * ON A BUCKET. So the expectation is attached to the bucket.
 *
 * A sidecar whose target is not among the parsed resources is returned rather
 * than dropped: it means a file was not read, and a posture expectation that
 * silently vanished is a posture nothing checks.
 */
function attachExpectations(
  resources: readonly MutableTerraformDeclaration[],
): readonly { address: string; file: string; targetRef: string }[] {
  const byAddress = new Map<string, MutableTerraformDeclaration>()
  for (const resource of resources) byAddress.set(resource.address, resource)
  const dangling: { address: string; file: string; targetRef: string }[] = []

  const targetOf = (resource: MutableTerraformDeclaration, attribute: string) => {
    const raw = resource.attributes.get(attribute)
    const address = referencedAddress(raw)
    const target = address === null ? undefined : byAddress.get(address)
    if (!target) {
      dangling.push({
        address: resource.address,
        file: resource.file,
        targetRef: raw ?? `<no ${attribute}>`,
      })
      return null
    }
    return target
  }

  for (const resource of resources) {
    switch (resource.terraformType) {
      case "aws_s3_bucket_public_access_block": {
        const target = targetOf(resource, "bucket")
        if (!target) break
        target.expected.set(
          DRIFT_SETTINGS.blockPublicAcls,
          booleanOf(resource.attributes.get("block_public_acls")),
        )
        target.expected.set(
          DRIFT_SETTINGS.ignorePublicAcls,
          booleanOf(resource.attributes.get("ignore_public_acls")),
        )
        target.expected.set(
          DRIFT_SETTINGS.blockPublicPolicy,
          booleanOf(resource.attributes.get("block_public_policy")),
        )
        target.expected.set(
          DRIFT_SETTINGS.restrictPublicBuckets,
          booleanOf(resource.attributes.get("restrict_public_buckets")),
        )
        break
      }
      case "aws_s3_bucket_server_side_encryption_configuration": {
        const target = targetOf(resource, "bucket")
        if (!target) break
        const rule = resource.blocks.find((block) => block.type === "rule")
        const applied = rule?.blocks.find(
          (block) => block.type === "apply_server_side_encryption_by_default",
        )
        const algorithm = unquote(applied?.attributes.get("sse_algorithm"))
        if (algorithm !== null) target.expected.set(DRIFT_SETTINGS.bucketEncryption, algorithm)
        break
      }
      case "aws_s3_bucket_versioning": {
        const target = targetOf(resource, "bucket")
        if (!target) break
        const configuration = resource.blocks.find(
          (block) => block.type === "versioning_configuration",
        )
        const status = unquote(configuration?.attributes.get("status"))
        if (status !== null) target.expected.set(DRIFT_SETTINGS.bucketVersioning, status)
        break
      }
      case "aws_cognito_user_pool": {
        const mfa = unquote(resource.attributes.get("mfa_configuration"))
        if (mfa !== null) resource.expected.set(DRIFT_SETTINGS.mfaConfiguration, mfa)
        const software = resource.blocks.find(
          (block) => block.type === "software_token_mfa_configuration",
        )
        if (software) {
          resource.expected.set(
            DRIFT_SETTINGS.softwareTokenMfa,
            booleanOf(software.attributes.get("enabled")),
          )
        }
        const adminCreate = resource.blocks.find(
          (block) => block.type === "admin_create_user_config",
        )
        if (adminCreate) {
          resource.expected.set(
            DRIFT_SETTINGS.adminCreateUserOnly,
            booleanOf(adminCreate.attributes.get("allow_admin_create_user_only")),
          )
        }
        break
      }
      case "aws_dynamodb_table": {
        const encryption = resource.blocks.find(
          (block) => block.type === "server_side_encryption",
        )
        if (encryption) {
          resource.expected.set(
            DRIFT_SETTINGS.tableEncryption,
            booleanOf(encryption.attributes.get("enabled")),
          )
        }
        const pitr = resource.blocks.find((block) => block.type === "point_in_time_recovery")
        if (pitr) {
          resource.expected.set(
            DRIFT_SETTINGS.tablePointInTimeRecovery,
            booleanOf(pitr.attributes.get("enabled")),
          )
        }
        const protection = resource.attributes.get("deletion_protection_enabled")
        if (protection !== undefined) {
          resource.expected.set(DRIFT_SETTINGS.tableDeletionProtection, booleanOf(protection))
        }
        const billing = unquote(resource.attributes.get("billing_mode"))
        if (billing !== null) resource.expected.set(DRIFT_SETTINGS.tableBillingMode, billing)
        break
      }
      case "aws_security_group": {
        for (const block of resource.blocks) {
          if (block.type !== "ingress") continue
          const protocol = unquote(block.attributes.get("protocol")) ?? "unresolved"
          const from = numberOf(block.attributes.get("from_port"))
          const to = numberOf(block.attributes.get("to_port"))
          if (protocol === "unresolved" || from === null || to === null) {
            // A rule whose ports come from a variable. Left out rather than
            // compared under a made-up key; the un-comparable list says so.
            resource.expected.set(
              `ingress[unresolved#${resource.expected.size}]`,
              UNRESOLVED_INGRESS,
            )
            continue
          }
          resource.expected.set(ingressSettingKey(protocol, from, to), declaredSourcesOf(block))
        }
        break
      }
      default:
        break
    }
  }

  return dangling
}

/** The marker value for an ingress rule the source could not resolve. */
export const UNRESOLVED_INGRESS = "<unresolved>"

function booleanOf(raw: string | undefined): string {
  if (raw === undefined) return "false"
  const trimmed = raw.trim()
  if (trimmed === "true" || trimmed === "false") return trimmed
  return UNRESOLVED_INGRESS
}

function numberOf(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : null
}

/**
 * The sources one declared ingress rule admits, canonicalised.
 *
 * A literal CIDR compares exactly, because that is the fact that matters: a
 * rule that said `0.0.0.0/0` and now says something else, or the reverse, is
 * the finding. A reference — `prefix_list_ids = [data.…id]`,
 * `security_groups = [aws_security_group.alb.id]` — compares by KIND only,
 * because the id it renders to exists after an apply and comparing an
 * unresolved reference against a real `sg-…` would report every rule in the
 * estate as divergent.
 */
function declaredSourcesOf(block: DeclaredBlock): string {
  const sources: string[] = []
  for (const attribute of ["cidr_blocks", "ipv6_cidr_blocks"]) {
    const list = listElements(block.attributes.get(attribute))
    for (const cidr of list.quoted) sources.push(`cidr:${cidr}`)
    if (list.count > list.quoted.length) sources.push("cidr:<unresolved>")
  }
  const prefixLists = listElements(block.attributes.get("prefix_list_ids"))
  for (let i = 0; i < prefixLists.count; i += 1) sources.push("prefix-list")
  const groups = listElements(block.attributes.get("security_groups"))
  for (let i = 0; i < groups.count; i += 1) sources.push("security-group")
  if (block.attributes.get("self")?.trim() === "true") sources.push("self")
  return canonicalSources(sources)
}

function canonicalSources(sources: readonly string[]): string {
  return [...new Set(sources)].sort().join(",")
}

/* --------------------------------------------- the observed side: readers -- */

/** One observed configuration fact, or the reason there is none. */
export type ObservedSetting =
  | { kind: "value"; value: string }
  /** The sub-read that would have answered did not. Never a default, never `false`. */
  | { kind: "unreadable"; why: string }

/**
 * Whether anything claims to manage a live resource.
 *
 * Three arms, and `unread` is the one that earns its keep: a resource whose
 * tags were never read must not be reported as unmanaged, because "nobody
 * manages this" is the sentence that turns into a deletion.
 */
export type ManagedByFact =
  | { kind: "declared"; by: string }
  | { kind: "none" }
  | { kind: "unread"; why: string }

export interface ObservedResource {
  /** `s3:bucket`. Matches `TerraformDeclaration.resourceType`. */
  resourceType: string
  /** The name AWS knows it by — what a declared name is compared against. */
  name: string
  /**
   * False when the reader could not obtain a name. Such a resource is
   * un-comparable, never undeclared: an unnamed live resource matches no
   * declaration by construction, and reporting it as console-created would be a
   * finding manufactured by our own blind spot.
   */
  nameKnown: boolean
  arn: string | null
  managedBy: ManagedByFact
  settings: ReadonlyMap<string, ObservedSetting>
}

/**
 * Everything read of one resource type, or the reason nothing was.
 *
 * `complete` is separate from `kind: "read"` because a truncated listing is a
 * successful read that cannot prove an absence. A declared bucket missing from
 * page one of twenty is not a deleted bucket.
 */
export type ObservedSurface =
  | {
      kind: "read"
      resourceType: string
      resources: readonly ObservedResource[]
      complete: boolean
      /** Why the listing is partial. Empty when complete. */
      incompleteWhy: string
    }
  | { kind: "blind"; resourceType: string; because: string }

const READABLE_STATES: ReadonlySet<string> = new Set(["ACTUAL", "STALE"])

/** The value of a read, or null for every arm that carries none. */
function valueOf<T>(read: AwsRead<T>): T | null {
  return READABLE_STATES.has(read.state) ? (read as { value: T }).value : null
}

/** A setting from a sub-read: the mapped value, or the refusal, never a default. */
function settingFrom<T>(read: AwsRead<T>, map: (value: T) => string): ObservedSetting {
  const value = valueOf(read)
  if (value === null) {
    return {
      kind: "unreadable",
      why: isUnknown(read) ? unreadableBecause(read) : `${read.capability} returned nothing`,
    }
  }
  return { kind: "value", value: map(value) }
}

/**
 * S3 as the drift comparison sees it.
 *
 * The four public-access flags, the encryption algorithm and the versioning
 * status — the three postures `s3.tf` declares and the three an operator with
 * console access can change in about fifteen seconds.
 */
export function observedBuckets(readings: S3Readings): ObservedSurface {
  if (isUnknown(readings.buckets)) {
    return {
      kind: "blind",
      resourceType: "s3:bucket",
      because: unreadableBecause(readings.buckets),
    }
  }
  const buckets = valueOf(readings.buckets) ?? []
  const resources: ObservedResource[] = buckets.map((bucket) => {
    const settings = new Map<string, ObservedSetting>()
    const block = settingFrom(bucket.publicAccessBlock, (fact) =>
      fact.kind === "absent" ? "absent" : "configured",
    )
    const flags = valueOf(bucket.publicAccessBlock)
    for (const [key, pick] of [
      [DRIFT_SETTINGS.blockPublicAcls, "blockPublicAcls"],
      [DRIFT_SETTINGS.ignorePublicAcls, "ignorePublicAcls"],
      [DRIFT_SETTINGS.blockPublicPolicy, "blockPublicPolicy"],
      [DRIFT_SETTINGS.restrictPublicBuckets, "restrictPublicBuckets"],
    ] as const) {
      if (flags === null) {
        settings.set(key, block)
        continue
      }
      // No block at all is the same posture as four flags off, and S3 answers
      // it with an error rather than with four falses. Saying "false" here is
      // not a default: `kind: "absent"` IS the observation.
      const value = flags.kind === "absent" ? false : flags.flags[pick]
      settings.set(key, { kind: "value", value: value ? "true" : "false" })
    }
    settings.set(
      DRIFT_SETTINGS.bucketEncryption,
      settingFrom(bucket.encryption, (fact) => {
        switch (fact.kind) {
          case "sse-kms":
            return "aws:kms"
          case "dsse-kms":
            return "aws:kms:dsse"
          case "sse-s3":
            return "AES256"
          case "none":
            return "none"
          default:
            return fact.algorithm
        }
      }),
    )
    settings.set(
      DRIFT_SETTINGS.bucketVersioning,
      settingFrom(bucket.versioning, (fact) =>
        fact.status === "never-enabled" ? "Disabled" : fact.status,
      ),
    )

    const tags = valueOf(bucket.tags)
    const managedBy: ManagedByFact =
      tags === null
        ? { kind: "unread", why: unreadableBecause(bucket.tags) }
        : tags.kind === "none"
          ? { kind: "none" }
          : managedByOf(tags.tags)

    return {
      resourceType: "s3:bucket",
      name: bucket.name,
      nameKnown: bucket.name.trim() !== "",
      arn: bucket.arn,
      managedBy,
      settings,
    }
  })

  const listing = readings.listing
  return {
    kind: "read",
    resourceType: "s3:bucket",
    resources,
    complete: listing.kind === "complete",
    incompleteWhy: listing.kind === "complete" ? "" : listing.why,
  }
}

/** Security groups as the drift comparison sees them: ingress, by port and source. */
export function observedSecurityGroups(readings: NetworkReadings): ObservedSurface {
  if (isUnknown(readings.securityGroups)) {
    return {
      kind: "blind",
      resourceType: "ec2:security-group",
      because: unreadableBecause(readings.securityGroups),
    }
  }
  const page = valueOf(readings.securityGroups)
  const groups = page?.items ?? []
  const resources: ObservedResource[] = groups.map((group) => {
    const settings = new Map<string, ObservedSetting>()
    const byKey = new Map<string, string[]>()
    for (const rule of group.ingress) {
      const key = ingressSettingKey(rule.protocol, rule.fromPort, rule.toPort)
      const sources = byKey.get(key) ?? []
      sources.push(observedSourceOf(rule))
      byKey.set(key, sources)
    }
    for (const [key, sources] of byKey) {
      settings.set(key, { kind: "value", value: canonicalSources(sources) })
    }
    return {
      resourceType: "ec2:security-group",
      name: group.groupName ?? group.groupId,
      nameKnown: group.groupName !== null && group.groupName.trim() !== "",
      arn: group.arn,
      managedBy: managedByOf(group.tags),
      settings,
    }
  })

  const truncated = page?.truncated === true
  return {
    kind: "read",
    resourceType: "ec2:security-group",
    resources,
    complete: !truncated,
    incompleteWhy: truncated
      ? `the security-group listing stopped at its ${page?.cap ?? 0}-page bound with more to fetch`
      : "",
  }
}

function observedSourceOf(rule: SecurityGroupRule): string {
  switch (rule.sourceKind) {
    case "ipv4":
    case "ipv6":
      return `cidr:${rule.source}`
    case "prefix-list":
      return "prefix-list"
    default:
      return "security-group"
  }
}

/** User pools as the drift comparison sees them: the MFA configuration, chiefly. */
export function observedUserPools(readings: CognitoReadings): ObservedSurface {
  if (isUnknown(readings.pools)) {
    return {
      kind: "blind",
      resourceType: "cognito-idp:userpool",
      because: unreadableBecause(readings.pools),
    }
  }
  const inventory = valueOf(readings.pools)
  const pools = inventory?.pools ?? []
  const resources: ObservedResource[] = pools.map((pool) => {
    const settings = new Map<string, ObservedSetting>()
    settings.set(
      DRIFT_SETTINGS.mfaConfiguration,
      pool.mfaPosture.kind === "unknown"
        ? { kind: "unreadable", why: pool.mfaPosture.why }
        : {
            kind: "value",
            value:
              pool.mfaPosture.kind === "enforced"
                ? "ON"
                : pool.mfaPosture.kind === "optional"
                  ? "OPTIONAL"
                  : pool.mfaPosture.kind === "off"
                    ? "OFF"
                    : pool.mfaPosture.raw,
          },
    )
    settings.set(
      DRIFT_SETTINGS.softwareTokenMfa,
      settingFrom(pool.mfa, (detail) => (detail.softwareTokenEnabled ? "true" : "false")),
    )
    settings.set(
      DRIFT_SETTINGS.adminCreateUserOnly,
      settingFrom(pool.detail, (detail) =>
        detail.adminCreateUserOnly === null ? UNRESOLVED_INGRESS : String(detail.adminCreateUserOnly),
      ),
    )

    const detail = valueOf(pool.detail)
    const name = detail?.name ?? pool.listedName
    return {
      resourceType: "cognito-idp:userpool",
      name: name ?? pool.poolId,
      nameKnown: name !== null && name.trim() !== "",
      arn: pool.arn,
      managedBy:
        detail === null
          ? { kind: "unread", why: unreadableBecause(pool.detail) }
          : managedByOf(detail.tags),
      settings,
    }
  })

  const completeness = inventory?.completeness
  return {
    kind: "read",
    resourceType: "cognito-idp:userpool",
    resources,
    complete: completeness?.kind === "complete",
    incompleteWhy:
      completeness === undefined
        ? "the pool listing returned no completeness statement"
        : completeness.kind === "truncated"
          ? completeness.why
          : "",
  }
}

/** Tables as the drift comparison sees them: encryption, recovery, deletion protection. */
export function observedTables(readings: DynamoDbReadings): ObservedSurface {
  if (isUnknown(readings.tables)) {
    return {
      kind: "blind",
      resourceType: "dynamodb:table",
      because: unreadableBecause(readings.tables),
    }
  }
  const tables = valueOf(readings.tables) ?? []
  const resources: ObservedResource[] = tables.map((table) => {
    const settings = new Map<string, ObservedSetting>()
    settings.set(
      DRIFT_SETTINGS.tableEncryption,
      settingFrom(table.detail, (detail) =>
        // `server_side_encryption { enabled = true }` in Terraform means a KMS
        // key rather than the AWS-owned default, which is what `kms` is. The
        // AWS-owned default is what a table has when the block is absent.
        detail.encryption.kind === "kms" ? "true" : "false",
      ),
    )
    settings.set(
      DRIFT_SETTINGS.tablePointInTimeRecovery,
      settingFrom(table.backups, (pitr) =>
        pitr.kind === "unstated" ? UNRESOLVED_INGRESS : pitr.kind === "enabled" ? "true" : "false",
      ),
    )
    settings.set(
      DRIFT_SETTINGS.tableDeletionProtection,
      settingFrom(table.detail, (detail) =>
        detail.deletionProtection.kind === "unstated"
          ? UNRESOLVED_INGRESS
          : detail.deletionProtection.kind === "enabled"
            ? "true"
            : "false",
      ),
    )
    settings.set(
      DRIFT_SETTINGS.tableBillingMode,
      settingFrom(table.detail, (detail) =>
        detail.billing.kind === "on-demand"
          ? "PAY_PER_REQUEST"
          : detail.billing.kind === "provisioned"
            ? "PROVISIONED"
            : UNRESOLVED_INGRESS,
      ),
    )
    return {
      resourceType: "dynamodb:table",
      name: table.name,
      nameKnown: table.name.trim() !== "",
      arn: table.arn,
      managedBy: {
        kind: "unread",
        why:
          "this build's DynamoDB reader carries the table's attribution but not its raw tag set, " +
          "so whether Terraform claims it cannot be read here",
      },
      settings,
    }
  })

  const more = readings.more
  return {
    kind: "read",
    resourceType: "dynamodb:table",
    resources,
    complete: more.kind === "complete",
    incompleteWhy: more.kind === "complete" ? "" : more.why,
  }
}

/** What a tag set says manages the resource. `MANAGED_BY_TAG` is the contract's key. */
function managedByOf(tags: Readonly<Record<string, string>>): ManagedByFact {
  const by = (tags[MANAGED_BY_TAG] ?? "").trim()
  return by === "" ? { kind: "none" } : { kind: "declared", by }
}

/* ------------------------------------------------------------ the compare -- */

/**
 * How much a finding matters.
 *
 * A SEPARATE type from `DriftSeverity` above, deliberately. `DriftSeverity` is
 * consumed by `src/app/console-index/answer.ts`, `src/app/page.tsx` and
 * `src/app/tenants/[slug]/page.tsx`, all of which switch over its four arms;
 * adding a fifth there would either break those switches or — worse — fall
 * through their default arms and render a security finding as "cosmetic".
 * `posture` has no equivalent in that vocabulary, so it gets its own.
 */
export type EstateDriftSeverity =
  /** A control that decides who can reach data. The reason this comparison exists. */
  | "posture"
  /** Users cannot be served without it. */
  | "serving"
  /** It bills, or its absence bills. */
  | "costly"
  /** A name, a tag, a description. */
  | "cosmetic"

const FINDING_ORDER: Record<EstateDriftSeverity, number> = {
  posture: 0,
  serving: 1,
  costly: 2,
  cosmetic: 3,
}

export type EstateDriftKind = "absent" | "undeclared" | "divergent"

export interface EstateDriftFinding {
  kind: EstateDriftKind
  resourceType: string
  severity: EstateDriftSeverity
  /** `aws_s3_bucket.documents` — null for `undeclared`, which has no declaration. */
  declaredAt: string | null
  /** `infrastructure/terraform/s3.tf:2` — null for `undeclared`. */
  declaredIn: string | null
  /** The live resource's name — null for `absent`, which has no live resource. */
  observed: string | null
  observedArn: string | null
  /** The setting that differs. Only ever set on `divergent`. */
  setting: string | null
  declaredValue: string | null
  observedValue: string | null
  detail: string
}

/** A declaration or a live resource this comparison declines to judge, and why. */
export interface UncomparableItem {
  /** The Terraform address, when the un-comparability is on the declared side. */
  declaredAt: string | null
  declaredIn: string | null
  /** The live resource's name, when it is on the observed side. */
  observed: string | null
  resourceType: string | null
  because: string
}

export interface EstateDriftReport {
  /**
   * False when the declared side is not readable at all. Every list is then
   * empty and `because` says why — never "0 findings", which reads as agreement.
   */
  comparable: boolean
  because: string
  findings: readonly EstateDriftFinding[]
  uncomparable: readonly UncomparableItem[]
  /** Resource types whose observed side could not be read. No absence is inferred for these. */
  blind: readonly { resourceType: string; because: string }[]
  /** Declared types nothing in this build observes. Visible, and not a finding. */
  unobserved: readonly { resourceType: string; declared: number }[]
  filesRead: readonly string[]
  asOf: string
}

/** Types whose absence stops users being served, rather than merely costing money. */
const SERVING_TYPES: ReadonlySet<string> = new Set([
  "ecs:service",
  "rds:db",
  "elasticloadbalancing:loadbalancer",
  "cognito-idp:userpool",
])

/**
 * Settings that decide who can reach data, or whether it survives. A divergence
 * here is `posture`.
 *
 * Both halves, and the second is easy to leave out. Deletion protection,
 * point-in-time recovery and bucket versioning do not decide who can read the
 * data — they decide whether it still exists tomorrow, and a console that
 * ranked "somebody turned off the registry's deletion protection" below "a
 * scratch bucket is billing" would have an operator reading the wrong row
 * first. `billing_mode` is the only setting compared here that is genuinely
 * neither, and it is the only one left as `cosmetic`.
 */
const POSTURE_SETTINGS: ReadonlySet<string> = new Set([
  DRIFT_SETTINGS.blockPublicAcls,
  DRIFT_SETTINGS.ignorePublicAcls,
  DRIFT_SETTINGS.blockPublicPolicy,
  DRIFT_SETTINGS.restrictPublicBuckets,
  DRIFT_SETTINGS.bucketEncryption,
  DRIFT_SETTINGS.bucketVersioning,
  DRIFT_SETTINGS.mfaConfiguration,
  DRIFT_SETTINGS.softwareTokenMfa,
  DRIFT_SETTINGS.adminCreateUserOnly,
  DRIFT_SETTINGS.tableEncryption,
  DRIFT_SETTINGS.tablePointInTimeRecovery,
  DRIFT_SETTINGS.tableDeletionProtection,
])

/** Whether the tag naming a manager means Terraform, in any of its spellings. */
function looksTerraformManaged(fact: ManagedByFact): boolean {
  return fact.kind === "declared" && /terraform/i.test(fact.by)
}

/**
 * Compare what Terraform declares against what the readers observed.
 *
 * Pure, and it takes the observed side as `ObservedSurface[]` rather than
 * calling any reader itself, for the reason the top of this file gives: a
 * denied read has to be a VALUE the comparison can see, and every arm has to be
 * testable without an AWS account.
 */
export function estateDrift(input: {
  declared: TerraformEstate
  observed: readonly ObservedSurface[]
  now: Date
}): EstateDriftReport {
  const asOf = input.now.toISOString()
  const blind = input.observed
    .filter((surface): surface is Extract<ObservedSurface, { kind: "blind" }> => surface.kind === "blind")
    .map((surface) => ({ resourceType: surface.resourceType, because: surface.because }))

  if (!input.declared.known) {
    return {
      comparable: false,
      because: input.declared.because,
      findings: [],
      uncomparable: [],
      blind,
      unobserved: [],
      filesRead: [],
      asOf,
    }
  }

  const findings: EstateDriftFinding[] = []
  const uncomparable: UncomparableItem[] = []
  const observedTypes = new Set(input.observed.map((surface) => surface.resourceType))

  for (const sidecar of input.declared.danglingSidecars) {
    uncomparable.push({
      declaredAt: sidecar.address,
      declaredIn: sidecar.file,
      observed: null,
      resourceType: null,
      because:
        `it configures ${sidecar.targetRef}, which is not among the ${input.declared.resources.length} ` +
        "resources parsed — the file declaring it was not read, so the setting it asserts is compared " +
        "against nothing",
    })
  }

  for (const surface of input.observed) {
    if (surface.kind === "blind") continue
    const declared = input.declared.resources.filter(
      (resource) => resource.resourceType === surface.resourceType,
    )
    const matched = new Set<string>()
    const unresolvedDeclarations = declared.filter(
      (resource) => resource.name.kind !== "literal" || resource.multiplicity.kind === "meta",
    )

    for (const live of surface.resources) {
      if (!live.nameKnown) {
        uncomparable.push({
          declaredAt: null,
          declaredIn: null,
          observed: live.arn ?? live.name,
          resourceType: surface.resourceType,
          because:
            "this reader could not obtain a name for it, and a nameless live resource matches no " +
            "declaration by construction — reporting it as console-created would be a finding " +
            "manufactured by our own blind spot",
        })
        continue
      }

      const literal = declared.find(
        (resource) => resource.name.kind === "literal" && resource.name.value === live.name,
      )
      if (literal) {
        matched.add(literal.address)
        compareSettings(literal, live, surface.resourceType, findings, uncomparable)
        continue
      }

      const patterns = declared.filter(
        (resource) =>
          resource.name.kind === "pattern" && new RegExp(resource.name.pattern).test(live.name),
      )
      if (patterns.length === 1) {
        matched.add(patterns[0].address)
        compareSettings(patterns[0], live, surface.resourceType, findings, uncomparable)
        continue
      }
      if (patterns.length > 1) {
        uncomparable.push({
          declaredAt: patterns.map((resource) => resource.address).join(", "),
          declaredIn: patterns[0].file,
          observed: live.name,
          resourceType: surface.resourceType,
          because:
            `${patterns.length} interpolated declarations match its name, so which one it is cannot ` +
            "be decided from the source alone",
        })
        continue
      }

      if (unresolvedDeclarations.length > 0) {
        uncomparable.push({
          declaredAt: null,
          declaredIn: null,
          observed: live.name,
          resourceType: surface.resourceType,
          because:
            `no declaration names it, but ${unresolvedDeclarations.length} declaration(s) of this type ` +
            `(${unresolvedDeclarations.map((resource) => resource.address).join(", ")}) resolve only ` +
            "after an apply — it may be one of them, so it is not reported as console-created",
        })
        continue
      }

      if (looksTerraformManaged(live.managedBy)) {
        uncomparable.push({
          declaredAt: null,
          declaredIn: null,
          observed: live.name,
          resourceType: surface.resourceType,
          because:
            `its ${MANAGED_BY_TAG} tag says "${live.managedBy.kind === "declared" ? live.managedBy.by : ""}" ` +
            `manages it, and none of the ${input.declared.files.length} file(s) read here declares it — ` +
            "another stack almost certainly does",
        })
        continue
      }

      findings.push({
        kind: "undeclared",
        resourceType: surface.resourceType,
        severity: "costly",
        declaredAt: null,
        declaredIn: null,
        observed: live.name,
        observedArn: live.arn,
        setting: null,
        declaredValue: null,
        observedValue: null,
        detail:
          `${live.name} exists in AWS and no resource in ${input.declared.files.join(", ")} declares it. ` +
          "Nothing will reconcile it, no review approved it, and it bills." +
          (live.managedBy.kind === "unread"
            ? ` Its management tag could not be read (${live.managedBy.why}), so this rests on the source alone.`
            : ""),
      })
    }

    for (const want of declared) {
      if (matched.has(want.address)) continue
      if (want.name.kind !== "literal") {
        uncomparable.push({
          declaredAt: want.address,
          declaredIn: `${want.file}:${want.line}`,
          observed: null,
          resourceType: surface.resourceType,
          because:
            want.name.kind === "pattern"
              ? `its name is ${want.name.expression}, which resolves only after an apply; nothing ` +
                `read of this type matches ${want.name.pattern}, and the variables could render it ` +
                "to a name none of them carry — so this is not evidence of absence"
              : want.name.why,
        })
        continue
      }
      if (want.multiplicity.kind === "meta") {
        uncomparable.push({
          declaredAt: want.address,
          declaredIn: `${want.file}:${want.line}`,
          observed: null,
          resourceType: surface.resourceType,
          because:
            `it carries ${want.multiplicity.meta} = ${want.multiplicity.expression}, so the source ` +
            "declares between zero and many of it and absence proves nothing",
        })
        continue
      }
      if (!surface.complete) {
        uncomparable.push({
          declaredAt: want.address,
          declaredIn: `${want.file}:${want.line}`,
          observed: null,
          resourceType: surface.resourceType,
          because: `the listing did not complete (${surface.incompleteWhy}), so it may be on a page that was never fetched`,
        })
        continue
      }
      findings.push({
        kind: "absent",
        resourceType: surface.resourceType,
        severity: SERVING_TYPES.has(surface.resourceType) ? "serving" : "costly",
        declaredAt: want.address,
        declaredIn: `${want.file}:${want.line}`,
        observed: null,
        observedArn: null,
        setting: null,
        declaredValue: want.name.value,
        observedValue: null,
        detail:
          `${want.file}:${want.line} declares ${want.name.value}, the listing completed, and nothing ` +
          "of that name was read. The apply did not take, or something deleted it.",
      })
    }
  }

  // Un-comparable declarations of a type nothing observes are not un-comparable
  // one by one — they are a whole service nobody looked at, which is a different
  // sentence and belongs in its own list.
  const unobserved = new Map<string, number>()
  for (const resource of input.declared.resources) {
    if (resource.resourceType === null) continue
    if (observedTypes.has(resource.resourceType)) continue
    unobserved.set(resource.resourceType, (unobserved.get(resource.resourceType) ?? 0) + 1)
  }

  findings.sort((a, b) => {
    const bySeverity = FINDING_ORDER[a.severity] - FINDING_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    return a.resourceType.localeCompare(b.resourceType)
  })

  return {
    comparable: true,
    because: "",
    findings,
    uncomparable,
    blind,
    unobserved: [...unobserved]
      .map(([resourceType, declared]) => ({ resourceType, declared }))
      .sort((a, b) => a.resourceType.localeCompare(b.resourceType)),
    filesRead: input.declared.files,
    asOf,
  }
}

/**
 * The third kind: declared AND present, and different.
 *
 * Every asymmetry here is deliberate. A setting the source does not declare is
 * NOT compared — Terraform declaring nothing about a bucket's versioning is not
 * a claim that versioning is off. A setting the reader could not obtain is
 * un-comparable and carries the refusal's own sentence, so a divergence never
 * quietly becomes "matches". And an ingress key present in AWS and absent from
 * the source is only reported when the source declares SOME ingress on that
 * group — otherwise a group matched by pattern, whose rules live in a file that
 * was not read, would report every rule it has as an addition.
 */
function compareSettings(
  want: TerraformDeclaration,
  live: ObservedResource,
  resourceType: string,
  findings: EstateDriftFinding[],
  uncomparable: UncomparableItem[],
): void {
  const declaresIngress = [...want.expected.keys()].some((key) => key.startsWith("ingress["))

  for (const [setting, declaredValue] of want.expected) {
    if (declaredValue === UNRESOLVED_INGRESS || setting.startsWith("ingress[unresolved#")) {
      uncomparable.push({
        declaredAt: want.address,
        declaredIn: `${want.file}:${want.line}`,
        observed: live.name,
        resourceType,
        because: `${setting} is declared with a value that resolves only after an apply`,
      })
      continue
    }
    const observed = live.settings.get(setting)
    if (observed === undefined) {
      uncomparable.push({
        declaredAt: want.address,
        declaredIn: `${want.file}:${want.line}`,
        observed: live.name,
        resourceType,
        because: `${setting} is declared and no reader in this build observes it`,
      })
      continue
    }
    if (observed.kind === "unreadable") {
      uncomparable.push({
        declaredAt: want.address,
        declaredIn: `${want.file}:${want.line}`,
        observed: live.name,
        resourceType,
        because: `${setting} is declared as ${declaredValue} and could not be read: ${observed.why}`,
      })
      continue
    }
    if (observed.value === declaredValue) continue
    if (observed.value === UNRESOLVED_INGRESS) {
      uncomparable.push({
        declaredAt: want.address,
        declaredIn: `${want.file}:${want.line}`,
        observed: live.name,
        resourceType,
        because: `${setting} is declared as ${declaredValue} and AWS stated no value for it`,
      })
      continue
    }
    findings.push({
      kind: "divergent",
      resourceType,
      severity: POSTURE_SETTINGS.has(setting) || setting.startsWith("ingress[") ? "posture" : "cosmetic",
      declaredAt: want.address,
      declaredIn: `${want.file}:${want.line}`,
      observed: live.name,
      observedArn: live.arn,
      setting,
      declaredValue,
      observedValue: observed.value,
      detail:
        `${want.file}:${want.line} declares ${setting} = ${declaredValue} on ${live.name}; AWS answered ` +
        `${observed.value}. The configuration was changed underneath the declaration.`,
    })
  }

  if (!declaresIngress) return
  for (const [setting, observed] of live.settings) {
    if (!setting.startsWith("ingress[")) continue
    if (want.expected.has(setting)) continue
    if (observed.kind !== "value") continue
    findings.push({
      kind: "divergent",
      resourceType,
      severity: "posture",
      declaredAt: want.address,
      declaredIn: `${want.file}:${want.line}`,
      observed: live.name,
      observedArn: live.arn,
      setting,
      declaredValue: null,
      observedValue: observed.value,
      detail:
        `${live.name} admits ${setting} from ${observed.value}, and ${want.file}:${want.line} declares ` +
        "no such rule. Somebody opened it outside the declaration.",
    })
  }
}

/** The findings of one kind, for a surface that renders the three separately. */
export function findingsOfKind(
  report: EstateDriftReport,
  kind: EstateDriftKind,
): readonly EstateDriftFinding[] {
  return report.findings.filter((finding) => finding.kind === kind)
}

/* ----------------------------------------------- the published, versioned arm -- */

/**
 * The findings in the shape anything outside this process can read.
 *
 * `@tenure/contracts` already models this exact question — `DriftFinding.kind`
 * is `unmanaged | missing | modified`, which is the same three kinds this
 * module computes, under the names the contract chose. Emitting it means the
 * console, the read-only API and anything downstream describe one drift finding
 * one way, and `parseDriftFinding` refuses a malformed one HERE rather than
 * letting a surface render it.
 *
 * ── Why `missing` findings are withheld rather than published ─────────────
 *
 * The contract REQUIRES `arn`, and its pattern requires a real one. A declared
 * resource that does not exist has no ARN — there is nothing in AWS to name.
 * The only ways to satisfy the schema would be to assemble an ARN from the
 * declared name and the resolved identity, which asserts an identifier AWS
 * never issued, or to put the Terraform address in the field, which claims a
 * resource that does not exist. Both are fabrications, and a fabricated ARN in
 * a drift feed is an ARN somebody eventually acts on.
 *
 * So they are WITHHELD, with the reason attached and the count visible. The
 * absent findings stay in `EstateDriftReport.findings`, which is the shape this
 * console renders; only the published projection is short, and it says by how
 * much and why.
 *
 * ── Why `stateful` is a required argument ────────────────────────────────
 *
 * `reversible` on an `unmanaged` finding is about the DELETE that reconciling
 * it implies, and whether a delete is recoverable is a property of the resource
 * type — a fact `inventory.ts` owns (`STATEFUL_RESOURCE_TYPES`), because it is
 * the module that knows what it just mapped. It is a required parameter rather
 * than an import so this module stays pure and free of that graph, and required
 * rather than optional so no caller can silently omit it and publish every
 * database as safe to delete.
 */
export interface WithheldDriftFinding {
  kind: EstateDriftKind
  declaredAt: string | null
  observed: string | null
  because: string
}

export interface PublishedDrift {
  findings: readonly PublishedDriftFinding[]
  /** Findings the contract cannot carry, with the reason. Never silently dropped. */
  withheld: readonly WithheldDriftFinding[]
}

/** Four internal severities onto the contract's three. */
function publishedSeverity(severity: EstateDriftSeverity): PublishedDriftFinding["severity"] {
  switch (severity) {
    case "posture":
    case "serving":
      return "critical"
    case "costly":
      return "warning"
    case "cosmetic":
      return "info"
  }
}

export function publishedDrift(input: {
  report: EstateDriftReport
  /** `STATEFUL_RESOURCE_TYPES` from `inventory.ts`. Required — see the header. */
  stateful: ReadonlySet<string>
}): PublishedDrift {
  const findings: PublishedDriftFinding[] = []
  const withheld: WithheldDriftFinding[] = []

  for (const finding of input.report.findings) {
    if (finding.kind === "absent") {
      withheld.push({
        kind: finding.kind,
        declaredAt: finding.declaredAt,
        observed: null,
        because:
          "the published contract requires an ARN and a declared resource that does not exist has " +
          "none; assembling one would assert an identifier AWS never issued",
      })
      continue
    }
    if (finding.observedArn === null) {
      withheld.push({
        kind: finding.kind,
        declaredAt: finding.declaredAt,
        observed: finding.observed,
        because:
          "the reader returned no ARN for it, and the published contract requires one — this is a " +
          "gap in what was read, not a resource without an identifier",
      })
      continue
    }
    findings.push(
      parseDriftFinding({
        schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.DriftFinding,
        arn: finding.observedArn,
        kind: finding.kind === "undeclared" ? "unmanaged" : "modified",
        // The contract refuses a `modified` finding with no field and refuses a
        // whole-resource finding that names one. Both are true of these by
        // construction: only `divergent` carries a setting.
        field: finding.kind === "divergent" ? finding.setting : null,
        severity: publishedSeverity(finding.severity),
        reversible:
          finding.kind === "undeclared" ? !input.stateful.has(finding.resourceType) : true,
        detail: finding.detail.slice(0, 512),
        detectedAt: input.report.asOf,
      }),
    )
  }

  return { findings, withheld }
}
