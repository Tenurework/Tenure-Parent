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
  type ChangeDiff,
  type ChangeDiffEntry,
} from "@tenure/contracts"

import type { RequiredResourceTag } from "@tenure/provisioning"

import { assessPlanCost, estimateMonthlyMinor, type PlanCostAssessment } from "../cost-report"
import type { EstateResource } from "./inventory"
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
      const because =
        reading.state === "DENIED"
          ? `${reading.action} was refused (${reading.errorCode})`
          : reading.state === "THROTTLED"
            ? `AWS rate-limited ${reading.capability}`
            : reading.state === "UNCONFIGURED"
              ? reading.why
              : `${reading.capability} failed`
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
