import { AsyncLocalStorage } from "node:async_hooks"

import type { ResolvedTenant } from "./resolver"

/**
 * GE-021-002 — everything a request decided about itself, frozen.
 *
 * `TenantScope` (context.ts) already carries the tenant and actor, because the
 * query layer needs those to refuse an unscoped read. This is the wider thing:
 * the memberships and assignments authorization will consult, the policy and
 * configuration revisions a decision was made against, the correlation id that
 * ties log lines together, the locale every rendered date depends on, and the
 * cell handles that say where this tenant's data actually lives.
 *
 * ── Why immutable, and enforced rather than documented ──────────────────────
 *
 * The failure this prevents is specific. A request resolves a tenant, some
 * middle layer helpfully "corrects" the locale or swaps in a fresher config
 * revision, and the audit row then records a decision against a revision that
 * was not the one the decision used. The record becomes subtly wrong in a way
 * nothing detects, and the incident review reaches the wrong conclusion.
 *
 * So the context is deep-frozen at creation and there is no setter. Deriving a
 * *new* context is possible and explicit — `withElevation` — because that is a
 * different context, not an edit to this one.
 */

export interface RequestContext {
  readonly tenant: ResolvedTenant

  readonly actor: {
    readonly principalId: string
    readonly principalType: "user" | "service" | "support" | "system"
    /**
     * How strongly the identity is established.
     *
     * `password` and `federated` are not the same assurance, and an action
     * that should require re-authentication cannot ask for it without knowing
     * which one it got.
     */
    readonly assurance: "anonymous" | "password" | "federated" | "mfa"
  }

  /** Tenants this principal belongs to. Plural: switching tenants must not need a new session. */
  readonly memberships: readonly string[]
  /** Seats held, as `organizationId:scope`. What authorization consults. */
  readonly assignments: readonly string[]

  /** The revisions this request's decisions were made against. */
  readonly configRevision: string
  readonly policyRevision: string

  readonly correlationId: string
  /** Distinct from correlationId: one trace can span several correlated requests. */
  readonly traceId: string

  readonly locale: string
  readonly timeZone: string

  /** Where this tenant's data lives. Names, never credentials. */
  readonly handles: {
    readonly cell: string
    readonly database: string
    readonly objectPrefix: string
  }

  readonly at: string
}

export class RequestContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RequestContextError"
  }
}

/**
 * Freeze every level, not just the top.
 *
 * `Object.freeze` is shallow, so a top-level freeze leaves `actor.assurance`
 * and `handles.database` writable — which is exactly where a "helpful"
 * mutation would land, since nobody reassigns the whole context.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

const storage = new AsyncLocalStorage<RequestContext>()

/**
 * Build a context. Validates rather than trusting, because most of these
 * arrive from separate subsystems and a missing one is silent otherwise.
 */
export function createRequestContext(input: RequestContext): RequestContext {
  const required: Array<[string, unknown]> = [
    ["tenant.tenantId", input.tenant?.tenantId],
    ["actor.principalId", input.actor?.principalId],
    ["configRevision", input.configRevision],
    ["policyRevision", input.policyRevision],
    ["correlationId", input.correlationId],
    ["traceId", input.traceId],
    ["locale", input.locale],
    ["timeZone", input.timeZone],
    ["handles.cell", input.handles?.cell],
    ["handles.database", input.handles?.database],
    ["at", input.at],
  ]

  for (const [field, value] of required) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new RequestContextError(
        `RequestContext.${field} is required. A decision recorded without it cannot be explained later.`,
      )
    }
  }

  // The tenant must be one the principal belongs to. The resolver already
  // proved this; asserting it again costs nothing and means a context built by
  // any other path cannot skip the proof.
  if (!input.memberships.includes(input.tenant.tenantId)) {
    throw new RequestContextError(
      "RequestContext.memberships does not include the resolved tenant. A context is not a place to assert a relationship that was never proved.",
    )
  }

  // An object prefix that does not start with the tenant can address another
  // tenant's storage — the same failure the FileRef contract refuses.
  if (!input.handles.objectPrefix.startsWith(`${input.tenant.tenantId}/`)) {
    throw new RequestContextError(
      "RequestContext.handles.objectPrefix must begin with the tenant id.",
    )
  }

  return deepFreeze({
    ...input,
    memberships: Object.freeze([...input.memberships]),
    assignments: Object.freeze([...input.assignments]),
  })
}

/** Run `fn` with this context ambient. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/** The active context, or undefined outside a request. */
export function currentContext(): RequestContext | undefined {
  return storage.getStore()
}

/**
 * The active context, or throw.
 *
 * For code that cannot do anything sensible without one. Throwing beats
 * returning undefined and letting a caller default: a default here is a
 * decision recorded against a revision nobody chose.
 */
export function requireContext(): RequestContext {
  const context = storage.getStore()
  if (!context) {
    throw new RequestContextError(
      "No request context. This code path ran outside a request, or the context was never established for it.",
    )
  }
  return context
}

/**
 * Derive a new context with support elevation.
 *
 * A *new* context, deliberately — Tenure staff acting inside a customer tenant
 * is a different actor doing different work, and mutating the existing one
 * would make the audit trail unable to say when the elevation began.
 */
export function withElevation(
  base: RequestContext,
  elevation: { principalId: string; reason: string; at: string },
): RequestContext {
  if (!elevation.reason?.trim()) {
    throw new RequestContextError(
      "Support elevation requires a reason. An elevation nobody can explain is the one an audit asks about.",
    )
  }

  return createRequestContext({
    ...base,
    actor: {
      principalId: elevation.principalId,
      principalType: "support",
      // Elevation never raises assurance. Acting as support does not make the
      // support engineer's own sign-in stronger than it was.
      assurance: base.actor.assurance,
    },
    // The elevated actor is not a member; the tenant was resolved for the
    // original principal and the elevation is what permits the access.
    memberships: [...new Set([...base.memberships, base.tenant.tenantId])],
    correlationId: base.correlationId,
    at: elevation.at,
  })
}
