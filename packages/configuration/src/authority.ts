import { domainOf } from "./domains"
import type { VersionedLayer } from "./layer-schema"
import { refusedByDomain } from "./domains"

/**
 * GE-032-002 — the five things a tenant administrator may never alter.
 *
 * Bible §7.3: tenant administrators configure "inside non-bypassable
 * guardrails". The item names the five: physical placement, operator access,
 * audit integrity, core schemas, and unrestricted code execution.
 *
 * ## The hole this closes
 *
 * `domains.ts` already refused a `tenantOverlay` writing the `deployment`
 * domain — at RESOLUTION, by stripping the value and reporting it. That is the
 * right behaviour for a value that reaches the resolver, and it is the wrong
 * behaviour for one being published: `planPublication` did not look at
 * `domainRefused`, so a change carrying `platform.deployment.region` produced a
 * plan with no blockers, published cleanly, and then quietly did nothing.
 *
 * An operator who submits a residency change, sees it accepted, and gets no
 * error has been told their data moved. It did not. Silently discarding half a
 * submission is worse than refusing all of it, and this is the refusal.
 *
 * ## Named, not inferred
 *
 * Each invariant maps to a concrete check. The mapping is data so that "which
 * of the five did I just violate" has an answer in the error, and so that
 * adding a sixth is an entry here rather than a condition somewhere.
 */

export type Invariant =
  | "physical-placement"
  | "operator-access"
  | "audit-integrity"
  | "core-schemas"
  | "unrestricted-code-execution"

/**
 * Which domain carries each invariant.
 *
 * `deployment` is placement, `identity` is who counts as an operator,
 * `observability` is whether the audit trail survives long enough to read.
 * `recovery` and `cost` are withheld for their own reasons and are covered by
 * the catch-all below rather than by a named invariant — the item names five,
 * and inventing a sixth to tidy the table would misreport what the requirement
 * says.
 */
export const INVARIANT_DOMAINS: Readonly<Record<string, Invariant>> = {
  deployment: "physical-placement",
  identity: "operator-access",
  observability: "audit-integrity",
}

export interface AuthorityViolation {
  invariant: Invariant | "entitlement" | "withheld-domain"
  key?: string
  layerId: string
  detail: string
}

/** Values that carry an expression, at any depth. Shared with the rejection scan. */
function hasExpression(value: unknown): boolean {
  if (typeof value === "string") return /\$\{[^}]*\}/.test(value)
  if (Array.isArray(value)) return value.some(hasExpression)
  if (value && typeof value === "object") return Object.values(value).some(hasExpression)
  return false
}

export interface AuthorityInput {
  layers: readonly VersionedLayer[]
  /** Keys the registry knows. A key outside it would define new schema. */
  knownKeys: ReadonlySet<string>
  /** Modules the configuration enables, and what the plan actually grants. */
  enabledModules?: readonly string[]
  entitlements?: readonly string[]
  moduleEntitlements?: Readonly<Record<string, string | undefined>>
}

/**
 * Everything a tenant-authored layer is not allowed to do.
 *
 * Returned rather than thrown, so one publication reports every violation
 * instead of stopping at the first — an operator who fixes one, resubmits, and
 * is told about the next has lost a cycle to a list that was already known.
 */
export function authorityViolations(input: AuthorityInput): readonly AuthorityViolation[] {
  const { layers, knownKeys, enabledModules = [], entitlements = [], moduleEntitlements = {} } = input
  const violations: AuthorityViolation[] = []

  // 1-3. Withheld domains, named by the invariant they carry.
  //
  // Reuses `refusedByDomain`, which decides authority by layer KIND rather than
  // by who is typing — a tenant overlay is tenant-scoped configuration whoever
  // authored it, and an operator hand-writing one must be refused the same way.
  for (const refusal of refusedByDomain(layers)) {
    const invariant = INVARIANT_DOMAINS[refusal.domain]
    violations.push({
      invariant: invariant ?? "withheld-domain",
      key: refusal.key,
      layerId: refusal.id,
      detail: invariant
        ? `"${refusal.key}" is ${invariant.replace(/-/g, " ")}. ${refusal.reason}`
        : refusal.reason,
    })
  }

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values)) {
      // 4. Core schemas. A key with no definition would introduce one, and a
      // tenant that can define a configuration key can define its own meaning
      // for a value the platform later reads.
      if (!knownKeys.has(key)) {
        violations.push({
          invariant: "core-schemas",
          key,
          layerId: layer.id,
          detail:
            `"${key}" is not a declared configuration key. Configuration cannot introduce schema — ` +
            `a key nothing declares is a key nothing validates.`,
        })
      }

      // 5. Unrestricted code execution. The expression language exists
      // (GE-031-005) and is deliberately not reachable from tenant values: a
      // value that evaluates is a value that runs, and nothing here has decided
      // what it may read.
      if (hasExpression(value)) {
        violations.push({
          invariant: "unrestricted-code-execution",
          key,
          layerId: layer.id,
          detail:
            `"${key}" contains an expression. Tenant configuration is data, not code — ` +
            `an evaluated value is one nobody has bounded.`,
        })
      }
    }
  }

  // Entitlements. Not an invariant in the item's list, and refused for a
  // different reason: enabling a module the contract does not cover produces a
  // console that shows a feature while every request for it is denied.
  const held = new Set(entitlements)
  for (const module of enabledModules) {
    const required = moduleEntitlements[module]
    if (required && !held.has(required)) {
      violations.push({
        invariant: "entitlement",
        layerId: module,
        detail: `"${module}" needs entitlement "${required}", which this tenant's plan does not grant.`,
      })
    }
  }

  return violations
}

/**
 * Whether a key is one a tenant administrator may set at all.
 *
 * Exported for a UI that wants to grey a field rather than accept it and refuse
 * later. It is a courtesy, not the control: `authorityViolations` is the
 * control, and it runs whatever the form showed.
 */
export function tenantAdminMayWrite(key: string): boolean {
  return domainOf(key)?.tenantAdminMayWrite === true
}
