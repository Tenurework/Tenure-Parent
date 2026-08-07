import {
  CurrencyMismatchError,
  allocateByWeight,
  add,
  isZero,
  money,
  sum,
  zero,
  type Money,
} from "./money"

/**
 * STUDIO-120-008 — allocate cost to tenants, and be honest about what cannot be.
 *
 * > Ingest CUR/Data Exports and cost allocation into FinOps Center; allocate
 * > shared resources using a documented driver and show unallocated cost
 * > honestly.
 *
 * Three clauses, and the third is the one that decides whether any of this is
 * worth reading. Every cost model reaches a pile of spend that belongs to no
 * single tenant — the NAT gateway, the shared cluster, the organization trail,
 * the support plan. There are three things to do with it:
 *
 *   1. spread it silently across tenants, so every number looks attributed;
 *   2. drop it, so the tenant columns add up to less than the bill;
 *   3. allocate what a stated driver justifies, and report the rest as
 *      unallocated with its reason.
 *
 * The first is the common one and it is a lie with a total that reconciles. The
 * second is a lie whose total does not. This module does the third, and
 * `reconciles()` exists so the property is checked rather than asserted in a
 * comment: **direct + allocated + unallocated is exactly the ingested total,
 * to the unit.**
 *
 * ## A driver is a record, not a calculation
 *
 * Every allocated amount carries the `AllocationDriver` that produced it — its
 * id, what it measures, and the weights used. An operator asked "why is this
 * tenant paying $412 of the NAT gateway" gets the driver and the measurements,
 * not a number. A split whose justification lives in a code comment is one
 * nobody can dispute, which is the same as one nobody can trust.
 */

/** A cost line as it arrives from Cost and Usage Reports or Cost Explorer. */
export interface CostLine {
  /** The line's own identity, so ingest is idempotent. */
  id: string
  /** e.g. "AmazonEC2", "AWSLambda". */
  service: string
  /** The AWS account it was billed to. */
  accountId: string
  region: string
  /** Resource ARN or id, when the line has one. Shared lines often do not. */
  resourceId: string | null
  /**
   * Resource tags as billed.
   *
   * The tenant tag is the primary allocation signal, which is why
   * STUDIO-070-002 requires it on every resource. A line without it is not an
   * error — plenty of legitimate spend is genuinely shared — but it is spend
   * that has to be allocated by a driver or reported unallocated.
   */
  tags: Readonly<Record<string, string>>
  /** What was actually billed for the period. */
  unblendedCost: Money
  /**
   * Reserved-instance and Savings-Plan cost spread over the commitment.
   *
   * Kept separate because they answer different questions: unblended is what
   * the invoice says this month, amortized is what this month's usage really
   * cost. Presenting one as the other is how a team celebrates a saving in the
   * month they prepaid and panics in the month they did not.
   */
  amortizedCost: Money
  /** The usage period this line covers. */
  periodStart: string
  periodEnd: string
}

/** The tag whose value names the tenant a resource belongs to. */
export const TENANT_TAG = "tenure:tenant"

/**
 * How a shared cost is split.
 *
 * `measure` is prose an operator reads in the UI. It is required, and it is
 * required to be specific: "usage" is not a driver, "share of NAT gateway bytes
 * processed, from VPC flow logs" is.
 */
export interface AllocationDriver {
  id: string
  measure: string
  /** Tenant id → its measurement. Absent tenants get nothing from this driver. */
  weights: Readonly<Record<string, number>>
}

/** What a driver decided, kept alongside the money so the split can be explained. */
export interface DriverAttribution {
  driverId: string
  measure: string
  weight: number
  totalWeight: number
}

export interface TenantCost {
  tenantId: string
  /** Lines tagged with this tenant. No judgement involved. */
  direct: Money
  /** Shared lines this tenant's share of, by driver. */
  allocated: Money
  /** Every driver decision that contributed, so the figure can be defended. */
  attributions: readonly DriverAttribution[]
  /** direct + allocated. */
  total: Money
  amortizedTotal: Money
}

/** Cost that reached no tenant, with the reason it did not. */
export interface UnallocatedCost {
  amount: Money
  amortized: Money
  /** Why, in the words an operator needs. Grouped by cause, not by line. */
  reason: string
  /** The lines it came from, so it can be chased down and tagged. */
  lineIds: readonly string[]
  service: string
}

export interface AllocationResult {
  currency: string
  /** Everything ingested. The figure the AWS bill should agree with. */
  ingested: Money
  ingestedAmortized: Money
  tenants: readonly TenantCost[]
  unallocated: readonly UnallocatedCost[]
  /** Sum of `unallocated`, for the headline the bible insists is shown. */
  unallocatedTotal: Money
  /** Lines that were read. Reported so a partial ingest cannot look complete. */
  lineCount: number
}

export interface AllocationInput {
  lines: readonly CostLine[]
  /**
   * Drivers for untagged spend, by service.
   *
   * Keyed by service rather than by line because a driver is a policy decision
   * about a kind of shared resource, and a per-line driver would be a hand
   * adjustment wearing a policy's clothes.
   */
  drivers: Readonly<Record<string, AllocationDriver>>
  /** Tenants in scope. A driver may not allocate to a tenant outside this set. */
  tenantIds: readonly string[]
}

/**
 * Attribute every line, allocate what a driver covers, report the rest.
 *
 * Refuses mixed currencies rather than coercing them: a fleet spanning a
 * euro-billed account and a dollar-billed one has two totals, and one number
 * covering both is wrong in a way that looks right.
 */
export function allocate(input: AllocationInput): AllocationResult {
  const { lines, drivers, tenantIds } = input

  if (lines.length === 0) {
    return {
      currency: "USD",
      ingested: zero("USD"),
      ingestedAmortized: zero("USD"),
      tenants: tenantIds.map((tenantId) => emptyTenant(tenantId, "USD")),
      unallocated: [],
      unallocatedTotal: zero("USD"),
      lineCount: 0,
    }
  }

  const currency = lines[0].unblendedCost.currency
  for (const line of lines) {
    if (line.unblendedCost.currency !== currency) {
      throw new CurrencyMismatchError(currency, line.unblendedCost.currency)
    }
    if (line.amortizedCost.currency !== currency) {
      throw new CurrencyMismatchError(currency, line.amortizedCost.currency)
    }
  }

  const known = new Set(tenantIds)
  const direct = new Map<string, Money>(tenantIds.map((id) => [id, zero(currency)]))
  const directAmortized = new Map<string, Money>(tenantIds.map((id) => [id, zero(currency)]))
  const allocated = new Map<string, Money>(tenantIds.map((id) => [id, zero(currency)]))
  const allocatedAmortized = new Map<string, Money>(tenantIds.map((id) => [id, zero(currency)]))
  const attributions = new Map<string, DriverAttribution[]>(tenantIds.map((id) => [id, []]))

  const shared: CostLine[] = []
  const orphaned: CostLine[] = []

  for (const line of lines) {
    const tagged = line.tags[TENANT_TAG]
    if (!tagged) {
      shared.push(line)
    } else if (!known.has(tagged)) {
      // Tagged for a tenant that is not in scope. Not shared — misattributed,
      // and a driver must not be allowed to quietly redistribute it, because
      // the honest answer is that a resource is labelled for something the
      // fleet does not know about.
      orphaned.push(line)
    } else {
      direct.set(tagged, add(direct.get(tagged)!, line.unblendedCost))
      directAmortized.set(tagged, add(directAmortized.get(tagged)!, line.amortizedCost))
    }
  }

  const unallocated: UnallocatedCost[] = []

  // ── Shared lines, grouped by service so one driver covers one kind of thing ──
  const byService = new Map<string, CostLine[]>()
  for (const line of shared) {
    const group = byService.get(line.service) ?? []
    group.push(line)
    byService.set(line.service, group)
  }

  for (const [service, group] of byService) {
    const driver = drivers[service]
    const groupTotal = sum(group.map((l) => l.unblendedCost), currency)
    const groupAmortized = sum(group.map((l) => l.amortizedCost), currency)

    const targets = driver ? tenantIds.filter((id) => (driver.weights[id] ?? 0) > 0) : []
    const totalWeight = targets.reduce((running, id) => running + driver!.weights[id]!, 0)

    if (!driver || targets.length === 0 || totalWeight === 0) {
      unallocated.push({
        amount: groupTotal,
        amortized: groupAmortized,
        service,
        reason: !driver
          ? `No allocation driver is defined for ${service}, and ${group.length} line(s) carry no ${TENANT_TAG} tag. ` +
            `Tag the resources, or define a driver that says what share means here.`
          : `The driver "${driver.id}" (${driver.measure}) measured zero for every tenant in scope, so there is ` +
            `no defensible split. Spreading it evenly would be a driver nobody chose.`,
        lineIds: group.map((l) => l.id),
      })
      continue
    }

    // Largest-remainder, so the parts add back to exactly the shared total.
    const weights = targets.map((id) => driver.weights[id]!)
    const shares = allocateByWeight(groupTotal, weights)
    const amortizedShares = allocateByWeight(groupAmortized, weights)

    targets.forEach((tenantId, index) => {
      allocated.set(tenantId, add(allocated.get(tenantId)!, shares[index]))
      allocatedAmortized.set(tenantId, add(allocatedAmortized.get(tenantId)!, amortizedShares[index]))
      attributions.get(tenantId)!.push({
        driverId: driver.id,
        measure: driver.measure,
        weight: driver.weights[tenantId]!,
        totalWeight,
      })
    })
  }

  if (orphaned.length > 0) {
    const byTag = new Map<string, CostLine[]>()
    for (const line of orphaned) {
      const tag = line.tags[TENANT_TAG]!
      const group = byTag.get(tag) ?? []
      group.push(line)
      byTag.set(tag, group)
    }
    for (const [tag, group] of byTag) {
      unallocated.push({
        amount: sum(group.map((l) => l.unblendedCost), currency),
        amortized: sum(group.map((l) => l.amortizedCost), currency),
        service: group[0].service,
        reason:
          `${group.length} line(s) are tagged ${TENANT_TAG}="${tag}", which is not a tenant this fleet knows. ` +
          `Either the tenant was removed while its resources were not, or the tag is wrong. ` +
          `This is not shared cost and must not be redistributed.`,
        lineIds: group.map((l) => l.id),
      })
    }
  }

  const tenants: TenantCost[] = tenantIds.map((tenantId) => ({
    tenantId,
    direct: direct.get(tenantId)!,
    allocated: allocated.get(tenantId)!,
    attributions: attributions.get(tenantId)!,
    total: add(direct.get(tenantId)!, allocated.get(tenantId)!),
    amortizedTotal: add(directAmortized.get(tenantId)!, allocatedAmortized.get(tenantId)!),
  }))

  return {
    currency,
    ingested: sum(lines.map((l) => l.unblendedCost), currency),
    ingestedAmortized: sum(lines.map((l) => l.amortizedCost), currency),
    tenants,
    unallocated,
    unallocatedTotal: sum(unallocated.map((u) => u.amount), currency),
    lineCount: lines.length,
  }
}

function emptyTenant(tenantId: string, currency: string): TenantCost {
  return {
    tenantId,
    direct: zero(currency),
    allocated: zero(currency),
    attributions: [],
    total: zero(currency),
    amortizedTotal: zero(currency),
  }
}

export interface Reconciliation {
  reconciles: boolean
  ingested: Money
  attributed: Money
  unallocated: Money
  /** Non-zero when something was lost or invented. Reported, never hidden. */
  discrepancy: Money
}

/**
 * Whether the parts add back to the whole, to the unit.
 *
 * This is the property that makes the page worth reading, so it is computed
 * rather than trusted. A discrepancy means a rounding bug or a dropped line,
 * and the FinOps Center shows it rather than balancing the books by adjusting
 * the largest tenant — which is what an implementation that hides this ends up
 * doing.
 */
export function reconcile(result: AllocationResult): Reconciliation {
  const attributed = sum(result.tenants.map((t) => t.total), result.currency)
  const accountedFor = add(attributed, result.unallocatedTotal)
  const discrepancy = money(result.ingested.units - accountedFor.units, result.currency)
  return {
    reconciles: isZero(discrepancy),
    ingested: result.ingested,
    attributed,
    unallocated: result.unallocatedTotal,
    discrepancy,
  }
}
