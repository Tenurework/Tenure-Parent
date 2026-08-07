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
 *   archetype    what this system's position on the archetype axes compiles to.
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
 *
 * ## Why `archetype` sits between `blueprint` and `tenant`
 *
 * A blueprint supplies a DEFAULT position on the archetype axes and a tenant's
 * binding may move one of them (`TenantBinding.archetype`). So a value compiled
 * from the axes is more specific than the blueprint it came from — it reflects
 * an edit the blueprint does not know about — and less specific than what the
 * customer set by hand. Putting it below `blueprint` would let a blueprint pin a
 * word that the tenant's own axis selection had already changed.
 *
 * The consequence is a rule, enforced by `modules.test.ts`: a key
 * `compileArchetype` writes must not also be set in a blueprint's `values`, or
 * the blueprint's value is dead and nothing says so.
 */
export const CONFIG_SCOPES = [
  "platform",
  "module",
  "blueprint",
  "archetype",
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
