import type { HealthSignal, TenantHealth } from "./fleet-health"

/**
 * STUDIO-100-002 — fleet search and filtering, held in the URL.
 *
 * ## Why the URL is the store
 *
 * The item asks for saved filters. A saved filter is a thing an operator sends
 * to a colleague during an incident, reopens tomorrow, and bookmarks — and a
 * filter kept in component state is none of those. So the filter IS the query
 * string, `?q=&signal=&state=`, and "saving" one is saving a link. That needs no
 * new storage, no migration and no per-operator table, and it makes every filter
 * shareable by construction.
 *
 * ## Why this module is pure
 *
 * The page is a server component that reads DynamoDB; a filter that could only
 * be exercised by rendering it would be a filter nobody tests. Everything here
 * is a function of its arguments, so `fleet-filter-logic.spec.ts` runs it
 * without a browser and without a table — and the page and the CSV export route
 * apply the SAME function, which is what stops an export carrying rows the
 * screen said were filtered out.
 */

export interface FleetFilter {
  /** Free text, matched against slug, display name, owner, plan and cell. */
  q: string
  /** A health signal the tenant must carry, or null for any. */
  signal: HealthSignal | null
  /** A lifecycle state, or null for any. */
  state: string | null
}

export const EMPTY_FILTER: FleetFilter = { q: "", signal: null, state: null }

const SIGNALS: readonly string[] = [
  "serving",
  "resting",
  "stalled",
  "failed",
  "terminal",
  "never-deployed",
  "dependency-failing",
  "unobserved",
  "config-behind",
]

/**
 * Read a filter out of `searchParams`.
 *
 * An unrecognised signal becomes `null` rather than a filter that matches
 * nothing: a typed URL that silently returns an empty fleet reads exactly like
 * a fleet that is empty, which is the confusion `EmptyState` exists to prevent.
 * `describeFilter` below is what tells the operator which of the two they are
 * looking at.
 */
export function parseFleetFilter(
  params: Record<string, string | string[] | undefined>,
): FleetFilter {
  const one = (key: string): string => {
    const raw = params[key]
    return (Array.isArray(raw) ? raw[0] : raw ?? "").trim()
  }

  const signal = one("signal")
  const state = one("state").toUpperCase()

  return {
    q: one("q").toLowerCase(),
    signal: SIGNALS.includes(signal) ? (signal as HealthSignal) : null,
    state: state === "" ? null : state,
  }
}

/** Whether a filter constrains anything at all. */
export function isFiltered(filter: FleetFilter): boolean {
  return filter.q !== "" || filter.signal !== null || filter.state !== null
}

/** The filter in words, so a truncated or empty table can say why. */
export function describeFilter(filter: FleetFilter): string {
  const parts: string[] = []
  if (filter.q) parts.push(`matching "${filter.q}"`)
  if (filter.signal) parts.push(`with the ${filter.signal.replace(/-/g, " ")} signal`)
  if (filter.state) parts.push(`in ${filter.state}`)
  return parts.join(", ")
}

/**
 * What the filter is applied to.
 *
 * Structural rather than a concrete row type, so the page (which has
 * `FleetRow`) and the export route (which has the same rows) share one
 * predicate without this module importing `server-only` code.
 */
export interface FilterableTenant {
  slug: string
  displayName: string
  state: string
  owner: string | null
  planId: string | null
  cellId: string | null
}

export function matchesFilter(
  tenant: FilterableTenant,
  filter: FleetFilter,
  /**
   * The health this tenant was found to have.
   *
   * Required rather than optional. `?signal=stalled` over an argument a caller
   * forgot to pass would match every tenant, which is the direction a filtering
   * mistake must never go — an operator narrowing to "what is broken" and
   * getting the whole fleet back has been told something false.
   */
  health: TenantHealth | undefined,
): boolean {
  if (filter.state && tenant.state.toUpperCase() !== filter.state) return false

  if (filter.signal) {
    if (!health) return false
    if (!health.signals.includes(filter.signal)) return false
  }

  if (filter.q) {
    const haystack = [tenant.slug, tenant.displayName, tenant.owner, tenant.planId, tenant.cellId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    if (!haystack.includes(filter.q)) return false
  }

  return true
}
