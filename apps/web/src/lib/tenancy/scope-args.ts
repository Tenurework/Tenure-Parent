import { isTenantScoped, isPlatformGlobal, isUnenforceable } from "./registry"
import { TenantContextError, type TenantScope, type UnscopedReason } from "./context"

/**
 * The rule the query layer applies, as a pure function.
 *
 * Kept separate from the Prisma extension that calls it so the decisions can be
 * asserted directly — including the ones that are hard to provoke through a
 * real client, like a cross-tenant `where` supplied by a caller who believed
 * they were being helpful.
 */

/** Operations that read. A tenant predicate is added to their filter. */
const READ_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
])

/** Operations that write new rows. The tenant is stamped onto the data. */
const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"])

/** Operations that change or remove existing rows. Filtered like a read. */
const MUTATE_OPERATIONS = new Set([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
])

export type ScopeDecision =
  | { action: "pass-through"; reason: string }
  | { action: "scoped"; args: Record<string, unknown> }

export type ScopeInput = {
  model: string | undefined
  operation: string
  args: Record<string, unknown>
  scope: TenantScope | undefined
  unscopedGrant: { reason: UnscopedReason; detail: string } | undefined
  /**
   * When false, a missing tenant context is reported but allowed through.
   * Used while call sites are still being migrated; see db.ts.
   */
  enforce: boolean
}

export function decideScope(input: ScopeInput): ScopeDecision {
  const { model, operation, args, scope, unscopedGrant, enforce } = input

  if (!model) {
    return { action: "pass-through", reason: "raw query or a model-less operation" }
  }

  if (isPlatformGlobal(model)) {
    return { action: "pass-through", reason: `${model} is global by design` }
  }

  if (isUnenforceable(model)) {
    // Named in the registry as tenant-owned with no column to filter on. Not
    // silently ignored — the registry test proves it is accounted for, and the
    // remedy is a schema change, not a filter we cannot write.
    return { action: "pass-through", reason: `${model} has no tenant column to filter on` }
  }

  if (!isTenantScoped(model)) {
    // Unknown to the registry. registry.test.ts makes this unreachable in a
    // passing build; if it is ever reached, refusing is the safe direction.
    if (enforce) {
      throw new TenantContextError(
        `${model} is not classified in the tenancy registry, so the query layer cannot tell ` +
          `whether it is tenant-owned. Add it to src/lib/tenancy/registry.ts.`,
      )
    }
    return { action: "pass-through", reason: `${model} is unclassified` }
  }

  // A tenant scope is checked before an unscoped grant, so that if both are
  // somehow present the narrower one wins. The real API cannot produce both —
  // AsyncLocalStorage holds one store — but the safe ordering should not depend
  // on that remaining true.
  if (!scope) {
    if (unscopedGrant) {
      return {
        action: "pass-through",
        reason: `unscoped grant: ${unscopedGrant.reason} (${unscopedGrant.detail})`,
      }
    }
    if (enforce) {
      throw new TenantContextError(
        `${operation} on ${model} ran with no tenant context. Wrap it in runInTenantScope(), ` +
          `or — if it genuinely spans tenants — in runUnscoped() with a stated reason.`,
      )
    }
    return { action: "pass-through", reason: "no tenant context (observe mode)" }
  }

  const institutionId = scope.institutionId

  // Includes findUnique. Prisma accepts a non-unique predicate alongside the
  // unique key in `where` and returns null when it does not match — verified
  // against Prisma 6 rather than assumed, because the alternative (a by-id read
  // that cannot be filtered) is exactly the shape of an insecure direct object
  // reference, and getting it wrong silently would leave every one of them open.
  if (READ_OPERATIONS.has(operation)) {
    return { action: "scoped", args: { ...args, where: mergeTenantFilter(args.where, institutionId) } }
  }

  if (MUTATE_OPERATIONS.has(operation)) {
    const next: Record<string, unknown> = {
      ...args,
      where: mergeTenantFilter(args.where, institutionId),
    }
    // upsert also inserts, so its create branch needs stamping too.
    if (operation === "upsert" && isPlainObject(args.create)) {
      next.create = { ...args.create, institutionId }
    }
    return { action: "scoped", args: next }
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return { action: "scoped", args: { ...args, data: stampTenant(args.data, institutionId) } }
  }

  // An operation the map does not know (a future Prisma addition). Refuse
  // rather than let it through unfiltered on a tenant-scoped model.
  if (enforce) {
    throw new TenantContextError(
      `${operation} on ${model} is not a recognised operation, so the query layer cannot scope ` +
        `it. Add it to src/lib/tenancy/scope-args.ts.`,
    )
  }
  return { action: "pass-through", reason: `unrecognised operation ${operation}` }
}

/**
 * Add the tenant predicate without letting a caller-supplied filter displace it.
 *
 * `AND` rather than a spread: spreading would let `where: { institutionId: X }`
 * from a caller overwrite the real tenant and turn a helpful-looking argument
 * into a cross-tenant read.
 */
function mergeTenantFilter(where: unknown, institutionId: string): Record<string, unknown> {
  if (!isPlainObject(where)) return { institutionId }

  const existing = Array.isArray(where.AND) ? where.AND : where.AND !== undefined ? [where.AND] : []
  return { ...where, AND: [...existing, { institutionId }] }
}

/** Stamp the tenant onto created rows, single or batched. */
function stampTenant(data: unknown, institutionId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => (isPlainObject(row) ? { ...row, institutionId } : row))
  }
  if (isPlainObject(data)) return { ...data, institutionId }
  return data
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const __testing = { mergeTenantFilter, stampTenant, READ_OPERATIONS, CREATE_OPERATIONS, MUTATE_OPERATIONS }
