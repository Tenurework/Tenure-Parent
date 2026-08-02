import { RESIDUAL_COST, SERVING, nextStates, type TenantState } from "@tenure/provisioning"

/**
 * GE-033-002 — what the operator plane can say about a tenant without looking
 * inside it.
 *
 * The item lists ten fleet views and ends with the clause that shapes all of
 * them: "**without default raw content access**". An operator answering "is
 * this tenant healthy" must not need to read a student's record to do it, and
 * the Studio is built so that it cannot — it holds the registry in DynamoDB and
 * has no connection to any cell's Postgres at all.
 *
 * So every signal here is derived from operational facts the control plane
 * already owns: what state the tenant is in, when it last moved, whether a
 * deployment manifest exists, which configuration revision is live. None of it
 * requires a row from the tenant's database, and
 * `tests/security/operator-plane-content.test.mjs` fails if that ever changes.
 */

/**
 * States the engine expects to leave on its own.
 *
 * Written out rather than derived from a naming convention, because "ends in
 * ING" is a spelling rule and this is a claim about behaviour — `LEGAL_HOLD`
 * ends in neither and is deliberately absent, and a tenant sitting in `DRAFT`
 * for a month is a draft, not a stall.
 *
 * The type annotation is the guard against drift: a state renamed in the
 * lifecycle stops compiling here rather than silently dropping out of the
 * health check.
 */
export const TRANSITIONAL: readonly TenantState[] = [
  "VALIDATING",
  "PROVISIONING",
  "CONFIGURING",
  "MIGRATING",
  "VERIFYING",
  "ACTIVATING",
  "SUSPENDING",
  "HIBERNATING",
  "REACTIVATING",
  "EXPORTING",
  "OFFBOARDING",
  "PURGING",
  "ROLLING_BACK",
]

/** How long a transitional state may last before it is worth looking at. */
export const STALL_HOURS = 6

export type HealthSignal =
  | "serving"
  | "resting"
  | "stalled"
  | "failed"
  | "terminal"
  | "never-deployed"
  | "config-behind"

export interface TenantHealth {
  slug: string
  state: TenantState
  signals: readonly HealthSignal[]
  /** The one an operator should act on first, or null when nothing needs them. */
  attention: HealthSignal | null
  /** Hours since the tenant last moved. Null when the timestamp is unusable. */
  hoursSinceChange: number | null
  /** What this tenant costs while not serving, if anything. */
  residualCost: string | null
}

export interface FleetInput {
  slug: string
  state: TenantState
  updatedAt: string
  /** Whether a signed deployment manifest exists for it. */
  hasDeployment: boolean
  /** The configuration revision the registry believes is live. */
  registryConfigRevision?: number
  /** The newest revision the configuration store actually holds. */
  storeConfigRevision?: number
}

/**
 * Ordered by what an operator should look at first.
 *
 * `failed` before `stalled` because a failure has already happened and a stall
 * might still resolve; both before `config-behind`, which is a discrepancy
 * rather than an outage. A list that surfaced the cheapest signal first would
 * be a list people stop reading top-down.
 */
const ATTENTION_ORDER: readonly HealthSignal[] = ["failed", "stalled", "never-deployed", "config-behind"]

export function healthOf(input: FleetInput, now: Date): TenantHealth {
  const signals: HealthSignal[] = []

  const changed = Date.parse(input.updatedAt)
  const hoursSinceChange = Number.isNaN(changed)
    ? null
    : (now.getTime() - changed) / (1000 * 60 * 60)

  if (input.state === "FAILED") signals.push("failed")

  if (SERVING.has(input.state)) signals.push("serving")
  else if (nextStates(input.state).length === 0) signals.push("terminal")
  else if (!TRANSITIONAL.includes(input.state)) signals.push("resting")

  // Stalled only applies to a state something is supposed to be moving out of.
  // An unusable timestamp is NOT treated as stalled: "we cannot tell how long
  // this has been here" and "this has been here too long" are different facts,
  // and reporting the first as the second sends an operator to investigate a
  // clock.
  if (
    TRANSITIONAL.includes(input.state) &&
    hoursSinceChange !== null &&
    hoursSinceChange >= STALL_HOURS
  ) {
    signals.push("stalled")
  }

  // A tenant past the point where a manifest should exist and without one.
  // Before CONFIGURING there is nothing to have deployed yet, so its absence is
  // the normal case rather than a finding.
  if (!input.hasDeployment && !["DRAFT", "VALIDATING", "PROVISIONING"].includes(input.state)) {
    signals.push("never-deployed")
  }

  // The registry's belief about the live configuration and what the store holds
  // are two records of one fact (GE-020-005's lesson). When they disagree, the
  // console is showing one and the cell is running the other.
  if (
    input.registryConfigRevision !== undefined &&
    input.storeConfigRevision !== undefined &&
    input.registryConfigRevision !== input.storeConfigRevision
  ) {
    signals.push("config-behind")
  }

  return {
    slug: input.slug,
    state: input.state,
    signals,
    attention: ATTENTION_ORDER.find((s) => signals.includes(s)) ?? null,
    hoursSinceChange,
    residualCost: RESIDUAL_COST[input.state] ?? null,
  }
}

export interface FleetSummary {
  total: number
  serving: number
  /** Tenants with something an operator should look at. */
  needingAttention: number
  /** Counted by signal, so a fleet view can say what kind of trouble it is in. */
  bySignal: Readonly<Record<HealthSignal, number>>
}

export function summariseFleet(health: readonly TenantHealth[]): FleetSummary {
  const bySignal = {
    serving: 0,
    resting: 0,
    stalled: 0,
    failed: 0,
    terminal: 0,
    "never-deployed": 0,
    "config-behind": 0,
  } satisfies Record<HealthSignal, number>

  for (const tenant of health) {
    for (const signal of tenant.signals) bySignal[signal]++
  }

  return {
    total: health.length,
    serving: bySignal.serving,
    // Counted from `attention`, not from the signal totals: a tenant that is
    // both failed and never-deployed is one tenant needing attention, and
    // summing signals would report two.
    needingAttention: health.filter((t) => t.attention !== null).length,
    bySignal,
  }
}

/** Worst first, then oldest — so the top of the list is where to start. */
export function byUrgency(health: readonly TenantHealth[]): readonly TenantHealth[] {
  const rank = (t: TenantHealth) =>
    t.attention === null ? ATTENTION_ORDER.length : ATTENTION_ORDER.indexOf(t.attention)
  return [...health].sort((a, b) => {
    const delta = rank(a) - rank(b)
    if (delta !== 0) return delta
    return (b.hoursSinceChange ?? 0) - (a.hoursSinceChange ?? 0)
  })
}
