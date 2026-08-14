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

/**
 * STUDIO-120-003 — where an observation of a *running* system can come from.
 *
 * Six, and the list is closed. Each names a read the control plane can actually
 * perform from outside the tenant: a certificate's expiry, an alarm's state, the
 * age of the oldest queued work, when a backup was last verified, whether spend
 * moved anomalously, whether the estate has drifted from what was declared. None
 * of them requires a row from the tenant's database, which is the constraint
 * `tests/security/operator-plane-content.test.mjs` holds this module to — so
 * "error rates" and "database" arrive as CloudWatch metrics or not at all.
 */
export const OBSERVATION_SOURCES = [
  "tls",
  "alarm",
  "queue-age",
  "backup",
  "cost-anomaly",
  "drift",
] as const

/**
 * The type IS the array, deliberately.
 *
 * A surface that has to draw one row per source when it has no readings needs to
 * enumerate them, and a hand-written second list of six strings is a list that
 * drifts from the union the day a seventh source is added. Deriving the type from
 * the array makes them one declaration: `observationsFor`'s promise of "six
 * observations, always" is then checkable against something, rather than against
 * a count somebody remembered.
 */
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number]

/**
 * What an observation found.
 *
 * `unknown` is mandatory and is the whole reason this is a four-state union
 * rather than a boolean. STUDIO-000-007: a call that was refused, never made, or
 * timed out is **not** a healthy answer. Collapsing it into `ok` is how a page
 * renders four reassuring chips over an account nobody has permission to read;
 * collapsing it into `failing` sends an operator to fix an outage that is an IAM
 * statement. It is a third state because it is a third fact.
 */
export type ObservationStatus = "ok" | "degraded" | "failing" | "unknown"

export interface HealthObservation {
  source: ObservationSource
  status: ObservationStatus
  /** When this was true. An observation with no as-of is a rumour. */
  asOf: string
  /** What was seen, in the words an operator would act on. */
  detail: string
}

export type HealthSignal =
  | "serving"
  | "resting"
  | "stalled"
  | "failed"
  | "terminal"
  | "never-deployed"
  /** Something this tenant depends on was observed to be broken. */
  | "dependency-failing"
  /** It is serving, and not one source could say anything definite about it. */
  | "unobserved"
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
  /**
   * Every observation that went into the signals above, carried through rather
   * than reduced to a badge.
   *
   * A tenant page that said `dependency-failing` and nothing else would send an
   * operator hunting for which dependency; the detail lines are the answer, and
   * the `unknown` ones are the list of things nobody is watching.
   */
  observations: readonly HealthObservation[]
}

export interface FleetInput {
  slug: string
  state: TenantState
  updatedAt: string
  /** Whether a signed deployment manifest exists for it. */
  hasDeployment: boolean
  /**
   * What was actually observed of the running system, from `lib/aws/health.ts`.
   *
   * Required, not optional. Every other field here is a fact the control plane
   * already owns; this is the only one that comes from looking. An optional
   * field would compile at a caller that never looks, and that caller would
   * report a fleet as healthy on the strength of having asked nothing — which is
   * precisely the defect this exists to close. Pass `[]` and the tenant is
   * reported `unobserved`, which is true.
   */
  observations: readonly HealthObservation[]
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
 *
 * `dependency-failing` sits second because it is the only entry describing
 * something broken *right now* in a system that is otherwise serving: an expired
 * certificate is a tenant nobody can reach, and the lifecycle row will say
 * ACTIVE the whole time.
 *
 * `unobserved` sits below the findings and above `config-behind`. It is not an
 * outage — it is the admission that this console cannot tell whether there is
 * one, which is worth an operator's attention and worth less of it than a fact.
 * Ranking it top would bury every real finding on the day a role loses a
 * permission.
 */
const ATTENTION_ORDER: readonly HealthSignal[] = [
  "failed",
  "dependency-failing",
  "stalled",
  "never-deployed",
  "unobserved",
  "config-behind",
]

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

  // Something the tenant needs was looked at and found broken. Independent of
  // lifecycle state on purpose: the row says ACTIVE while the certificate in
  // front of it has expired, and the lifecycle will never notice.
  if (input.observations.some((o) => o.status === "failing")) signals.push("dependency-failing")

  // Nothing definite came back about a system that is supposed to be serving.
  //
  // Scoped to SERVING states because a DRAFT tenant has no running system to
  // observe and flagging it would make the signal noise. `degraded` counts as
  // definite — it is an answer. Only `unknown` does not, and a tenant whose
  // every source is `unknown` is one this console is guessing about.
  if (SERVING.has(input.state) && !input.observations.some((o) => o.status !== "unknown")) {
    signals.push("unobserved")
  }

  return {
    slug: input.slug,
    state: input.state,
    signals,
    attention: ATTENTION_ORDER.find((s) => signals.includes(s)) ?? null,
    hoursSinceChange,
    residualCost: RESIDUAL_COST[input.state] ?? null,
    observations: input.observations,
  }
}

/**
 * The sentence a fleet row prints under its attention badge.
 *
 * A badge reading `dependency-failing` tells an operator that something is
 * broken and not which thing, which is a page they have to leave to act on. The
 * detail lines are already carried on the health record; this picks the one that
 * explains the badge.
 *
 * Returns null for the signals derived from the lifecycle row, where the state
 * and the hours column beside it already say everything there is to say.
 */
export function explainAttention(health: TenantHealth): string | null {
  if (health.attention === "dependency-failing") {
    const broken = health.observations.filter((o) => o.status === "failing")
    return broken.map((o) => `${o.source}: ${o.detail}`).join(" ") || null
  }
  if (health.attention === "unobserved") {
    const sources = health.observations.map((o) => o.source)
    return sources.length === 0
      ? "nothing was observed of this tenant at all."
      : `nothing definite came back from ${sources.join(", ")}.`
  }
  return null
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
    "dependency-failing": 0,
    unobserved: 0,
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
