/**
 * The layers a configuration value can be set at, in precedence order.
 *
 * Lowest first. A value set at a later scope overrides — or, depending on the
 * definition's merge strategy, narrows — one set at an earlier scope.
 *
 * The order is not arbitrary and is not a preference:
 *
 *   platform     what Tenure ships. The floor; always present.
 *   module       what a module declares for itself when enabled.
 *   blueprint    what a reusable system definition sets for the systems built from it.
 *   tenant       what one customer sets for their whole system.
 *   legalEntity  a legal boundary inside a tenant — the level where jurisdiction lives.
 *   orgUnit      a node in the organization hierarchy. Several may apply at once;
 *                see `layers` in resolve.ts, which orders ancestors before descendants.
 *   workspace    a working area inside an org unit.
 *   user         a personal preference. Never a security decision.
 *
 * `user` sits highest deliberately, and is exactly why `allowedScopes` exists on
 * every definition: a preference must not be able to reach a key that decides
 * authority. A definition that matters for security simply does not list `user`.
 */
export const CONFIG_SCOPES = [
  "platform",
  "module",
  "blueprint",
  "tenant",
  "legalEntity",
  "orgUnit",
  "workspace",
  "user",
] as const

export type ConfigScope = (typeof CONFIG_SCOPES)[number]

const RANK: ReadonlyMap<ConfigScope, number> = new Map(CONFIG_SCOPES.map((s, i) => [s, i]))

/** Position in the precedence order. Higher wins. */
export function scopeRank(scope: ConfigScope): number {
  const rank = RANK.get(scope)
  if (rank === undefined) {
    // Not reachable through the type system, but reachable from JSON — a scope
    // read off a database row or an API body is a string until something checks.
    throw new RangeError(`Unknown configuration scope: ${JSON.stringify(scope)}`)
  }
  return rank
}

export function isConfigScope(value: unknown): value is ConfigScope {
  return typeof value === "string" && RANK.has(value as ConfigScope)
}
