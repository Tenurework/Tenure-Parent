import { ALL_STATES, type TenantState } from "@tenure/provisioning"

import type { TenantHealth } from "./fleet-health"

/**
 * GE-103-001 — the eleven fleet views an operator is entitled to ask for.
 *
 * > "Build operator fleet views/filters for active, idle, suspended,
 * > hibernated, reactivating, offboarding, legal hold, purge pending, purged,
 * > failed, and drifted tenants."
 *
 * `fleet-filter.ts` already gives `?state=` — a free-text box an operator types
 * a lifecycle state into. That is a filter and it is not these views, for two
 * reasons the requirement's own list makes plain:
 *
 *   1. **Eight of the eleven names are not one state.** "suspended" is
 *      `SUSPENDING` and `SUSPENDED_LOGICAL`; "hibernated" is `HIBERNATING` and
 *      `HIBERNATED_ZERO_RUNTIME`; "failed" is `FAILED` and `ROLLING_BACK`. An
 *      operator who types `SUSPENDED_LOGICAL` misses the tenant that is halfway
 *      through suspending — which is the one most likely to need them, because
 *      a suspension that stopped moving is a suspension that did not finish.
 *      Every view therefore names the states it covers, and `viewStates` is the
 *      list rather than a sentence about it.
 *
 *   2. **"drifted" is not a lifecycle state at all.** `?state=DRIFTED` matches
 *      nothing, and a filter that matches nothing renders exactly like a fleet
 *      in which nothing has drifted. Drift is an *observation* of the estate —
 *      `OBSERVATION_SOURCES` carries `drift` — so this view is decided by what
 *      was seen, and it is the only one that can answer `unknown`.
 *
 * ## Why a verdict and not a boolean
 *
 * `viewVerdict` returns `in | out | unknown`, and the third value is the whole
 * reason this module is not two lines. A drift observation that was never taken,
 * or that came back `unknown` because the read was refused, is **not** a tenant
 * that has not drifted. Collapsing the two prints "0 drifted" over an estate
 * nobody looked at, which is the false green this console is built to refuse —
 * the same argument `fleet-health.ts` makes about `ObservationStatus` and
 * `cost-source.ts` makes about `$0.00`.
 *
 * Ten of the eleven views read a lifecycle state the registry owns, so they can
 * never answer `unknown`: the state is either in the set or it is not.
 *
 * ## Why this module is pure
 *
 * Same reason as `fleet-filter.ts`: `/tenants` is an async server component
 * that reads DynamoDB and calls AWS, and the CSV export route applies the same
 * selection. A view proven only by rendering the page is a view nobody tests,
 * and two implementations of "which tenants are hibernated" is an export that
 * carries rows the screen said were hidden.
 */

/** The eleven names the requirement lists, in the order it lists them. */
export type FleetViewId =
  | "active"
  | "idle"
  | "suspended"
  | "hibernated"
  | "reactivating"
  | "offboarding"
  | "legal-hold"
  | "purge-pending"
  | "purged"
  | "failed"
  | "drifted"

/** In the view, out of it, or not knowable from what was observed. */
export type ViewVerdict = "in" | "out" | "unknown"

export interface FleetView {
  id: FleetViewId
  /** What the chip says. */
  label: string
  /**
   * The lifecycle states this view covers.
   *
   * Empty for `drifted`, which is decided by an observation. A view with no
   * states and `observed: false` would be a view that matches nothing, and
   * `FLEET_VIEWS` is checked against that below.
   */
  states: readonly TenantState[]
  /** Whether membership needs a health reading rather than a registry field. */
  observed: boolean
  /** Why these states, in the words an operator would use to argue with it. */
  because: string
}

export const FLEET_VIEWS: readonly FleetView[] = [
  {
    id: "active",
    label: "Active",
    states: ["ACTIVE"],
    observed: false,
    because: "Serving requests. The only state in which a real user can reach this tenant.",
  },
  {
    id: "idle",
    label: "Idle",
    states: ["IDLE"],
    observed: false,
    because:
      "Still routed and still billing, and nobody has used it. Separate from Active because the bill is the same and the value is not.",
  },
  {
    id: "suspended",
    label: "Suspended",
    states: ["SUSPENDING", "SUSPENDED_LOGICAL"],
    observed: false,
    because:
      "Both halves, deliberately. A tenant stuck in SUSPENDING is the one an operator most needs to see, and a view spelled SUSPENDED_LOGICAL alone would hide it.",
  },
  {
    id: "hibernated",
    label: "Hibernated",
    states: ["HIBERNATING", "HIBERNATED_ZERO_RUNTIME"],
    observed: false,
    because:
      "Zero runtime is the destination; HIBERNATING is the tenant on the way there, still holding whatever has not been torn down yet.",
  },
  {
    id: "reactivating",
    label: "Reactivating",
    states: ["REACTIVATING"],
    observed: false,
    because: "Coming back. One state, and it is the one the lifecycle names.",
  },
  {
    id: "offboarding",
    label: "Offboarding",
    states: ["OFFBOARDING"],
    observed: false,
    because:
      "Leaving, and not yet committed to deletion — OFFBOARDING can still go to LEGAL_HOLD or back out through EXPORTING.",
  },
  {
    id: "legal-hold",
    label: "Legal hold",
    states: ["LEGAL_HOLD"],
    observed: false,
    because: "Nothing may be deleted. Its own view because it outranks every other plan for the tenant.",
  },
  {
    id: "purge-pending",
    label: "Purge pending",
    states: ["PURGE_PENDING", "PURGING"],
    observed: false,
    because:
      "A purge in flight is still pending completion. Splitting PURGING out would make a tenant vanish from this view before it appears in Purged, and an operator watching a deletion would lose it in between.",
  },
  {
    id: "purged",
    label: "Purged",
    states: ["PURGED_ZERO_INCREMENTAL_COST"],
    observed: false,
    because:
      "Done, and terminal. PURGING is not here: a purge that has started has not finished, and reading it as purged is how a half-deleted tenant stops being chased.",
  },
  {
    id: "failed",
    label: "Failed",
    states: ["FAILED", "ROLLING_BACK"],
    observed: false,
    because:
      "ROLLING_BACK is reachable only from a failure, so a tenant in it has failed and is being handled. An operator asking what is broken must see both.",
  },
  {
    id: "drifted",
    label: "Drifted",
    states: [],
    observed: true,
    because:
      "The estate no longer matches what was declared. Not a lifecycle state — a drift observation, so a tenant nobody could read reports unknown rather than clean.",
  },
]

export const FLEET_VIEW_IDS: readonly FleetViewId[] = FLEET_VIEWS.map((v) => v.id)

/**
 * Lifecycle states no named view covers.
 *
 * Derived, and exported so the page can say it out loud. The requirement names
 * eleven views; the machine has twenty-five states, so a fleet page offering
 * only these eleven would silently omit every tenant that is being built. That
 * is a true statement about the requirement rather than a defect in it — but a
 * console that did not say so would be claiming the eleven chips are the whole
 * fleet, and `?state=` is what reaches the rest.
 */
export const STATES_IN_NO_NAMED_VIEW: readonly TenantState[] = ALL_STATES.filter(
  (state) => !FLEET_VIEWS.some((view) => view.states.includes(state)),
)

/** The view by id, or null. */
export function fleetView(id: string | null | undefined): FleetView | null {
  return FLEET_VIEWS.find((v) => v.id === id) ?? null
}

/**
 * Read `?view=` out of `searchParams`.
 *
 * An unrecognised value becomes `null` — no view — rather than a view that
 * matches nothing, for the reason `parseFleetFilter` gives about `?signal=`: a
 * mistyped URL that returns an empty fleet reads exactly like an empty fleet.
 */
export function parseFleetView(
  params: Record<string, string | string[] | undefined>,
): FleetViewId | null {
  const raw = params.view
  const one = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase()
  return FLEET_VIEW_IDS.includes(one as FleetViewId) ? (one as FleetViewId) : null
}

/** What a view is applied to. Structural, so the page and the export route share it. */
export interface ViewableTenant {
  slug: string
  state: string
}

/**
 * Is this tenant in that view?
 *
 * `health` is required rather than optional, and `undefined` is a legal value
 * meaning "no reading was taken". The distinction is the point: for a state
 * view the reading is irrelevant and the answer is definite either way; for
 * `drifted` an absent reading is `unknown`, never `out`.
 */
export function viewVerdict(
  view: FleetView,
  tenant: ViewableTenant,
  health: TenantHealth | undefined,
): ViewVerdict {
  if (!view.observed) {
    return view.states.includes(tenant.state.toUpperCase() as TenantState) ? "in" : "out"
  }

  // The drift view. Three ways to not know, and none of them is "clean".
  if (!health) return "unknown"
  const observation = health.observations.find((o) => o.source === "drift")
  if (!observation) return "unknown"
  if (observation.status === "unknown") return "unknown"
  return observation.status === "ok" ? "out" : "in"
}

export interface ViewCount {
  /** Tenants this view definitely contains. */
  matched: number
  /**
   * Tenants it could not decide about.
   *
   * Always 0 for a state view, and that is a property rather than a coincidence:
   * `viewVerdict` cannot return `unknown` for one.
   */
  undecided: number
}

/** Every view's count in one pass, for the chip row. */
export function viewCounts(
  tenants: readonly ViewableTenant[],
  healthBySlug: ReadonlyMap<string, TenantHealth>,
): Record<FleetViewId, ViewCount> {
  const counts = {} as Record<FleetViewId, ViewCount>
  for (const view of FLEET_VIEWS) {
    let matched = 0
    let undecided = 0
    for (const tenant of tenants) {
      const verdict = viewVerdict(view, tenant, healthBySlug.get(tenant.slug))
      if (verdict === "in") matched += 1
      else if (verdict === "unknown") undecided += 1
    }
    counts[view.id] = { matched, undecided }
  }
  return counts
}

/**
 * What a view's count means, in a sentence a chip can carry as its title.
 *
 * The undecided half is never dropped. "4 drifted" beside 9 tenants nobody
 * could read is a different fact from "4 drifted" out of 4 that were all read,
 * and only one of them is a reason to relax.
 */
export function describeViewCount(view: FleetView, count: ViewCount): string {
  const base = `${count.matched} ${count.matched === 1 ? "tenant" : "tenants"} in ${view.label}.`
  if (count.undecided === 0) return `${base} ${view.because}`
  return (
    `${base} ${count.undecided} could not be decided — no usable drift reading was taken for them, ` +
    `so they are neither counted here nor reported clean. ${view.because}`
  )
}
