import { AsyncLocalStorage } from "node:async_hooks"

/**
 * The active tenant, carried implicitly through an operation.
 *
 * Passing an institutionId down every call chain is the alternative, and it
 * fails in the direction that matters: the one function that forgets to thread
 * it through still compiles, still runs, and returns another tenant's rows.
 * AsyncLocalStorage makes the context ambient so the query layer can demand it
 * rather than trust each caller to supply it.
 */

export type TenantScope = {
  institutionId: string
  /**
   * Who the work is being done for. Carried into audit records.
   *
   * `support` is Tenure staff acting inside a customer's tenant — a tenant
   * export, a diagnostic read. It is deliberately distinct from `system`: both
   * are non-interactive, but one has a person behind it who can be asked why,
   * and an audit trail that cannot tell them apart cannot answer the question
   * that gets asked after an incident.
   */
  actor: {
    principalId: string
    principalType: "user" | "service" | "support" | "system"
  }
}

/**
 * Why a block of work is allowed to run without a tenant.
 *
 * Deliberately a closed set. The first of these is not a loophole but a
 * necessity: resolving which institutions a user belongs to is *how* a tenant
 * is determined, so that query cannot itself require one. A specification that
 * omits this primitive deadlocks — nobody can authenticate, because
 * authenticating requires reading a scoped table.
 */
export type UnscopedReason =
  /** Resolving identity and membership, before a tenant is known. */
  | "auth-bootstrap"
  /** Platform-level work that legitimately spans tenants (provisioning, ops). */
  | "control-plane"
  /** Schema and data migrations. */
  | "migration"
  /** Reference-data seeding. */
  | "seed"

type Store =
  | { kind: "scoped"; scope: TenantScope }
  | { kind: "unscoped"; reason: UnscopedReason; detail: string }

const storage = new AsyncLocalStorage<Store>()

/**
 * Start a lazy thenable before the context closes.
 *
 * A Prisma query is not a running promise. `db.application.findMany()` builds a
 * thenable and does nothing; the query — and with it the extension that applies
 * the tenant filter — runs when somebody calls `.then`. Written as
 *
 *     runInTenantScope(scope, () => db.application.findMany())
 *
 * that `.then` is called by the *caller's* `await`, after `storage.run` has
 * already returned. The extension then finds no scope and, in observe mode,
 * returns every tenant's rows: the exact leak this module exists to prevent,
 * produced by a call shape that reads as obviously correct and type-checks.
 *
 * `Promise.resolve` on the result schedules that `.then` here, while the store
 * is still active. A non-thenable is passed through untouched so a synchronous
 * callback keeps returning synchronously.
 *
 * The alternative — requiring every caller to write `async () => await ...` —
 * makes safety depend on remembering an idiom whose necessity is invisible, and
 * the one call site that forgets is silently unfiltered.
 */
function settleInsideContext<T>(result: T): T {
  const thenable = result as { then?: unknown } | null | undefined
  if (typeof thenable?.then !== "function") return result
  return Promise.resolve(result) as T
}

/** Run `fn` with an active tenant. Nested calls may narrow but not widen. */
export function runInTenantScope<T>(scope: TenantScope, fn: () => T): T {
  if (!scope.institutionId) {
    throw new TenantContextError("Refusing to open a tenant scope with an empty institutionId.")
  }
  return storage.run({ kind: "scoped", scope }, () => settleInsideContext(fn()))
}

/**
 * Run `fn` with no tenant, for one of the reasons above.
 *
 * `detail` is required and should name the caller, so an audit of what runs
 * unscoped reads as a list of specific operations rather than a count.
 */
export function runUnscoped<T>(reason: UnscopedReason, detail: string, fn: () => T): T {
  return storage.run({ kind: "unscoped", reason, detail }, () => settleInsideContext(fn()))
}

/** The active tenant, or undefined when there is none. */
export function currentScope(): TenantScope | undefined {
  const store = storage.getStore()
  return store?.kind === "scoped" ? store.scope : undefined
}

/** The active unscoped grant, if this operation is running inside one. */
export function currentUnscopedGrant(): { reason: UnscopedReason; detail: string } | undefined {
  const store = storage.getStore()
  return store?.kind === "unscoped" ? { reason: store.reason, detail: store.detail } : undefined
}

/** True when neither a tenant nor an explicit unscoped grant is active. */
export function hasNoContext(): boolean {
  return storage.getStore() === undefined
}

/**
 * The active tenant, or a failure.
 *
 * Named so the failure is not something a caller can accidentally ignore: it
 * throws rather than returning null, because the null path would be "no tenant
 * filter", which is the whole problem.
 */
export function requireTenantScope(operationDescription: string): TenantScope {
  const scope = currentScope()
  if (scope) return scope

  const grant = currentUnscopedGrant()
  if (grant) {
    throw new TenantContextError(
      `${operationDescription} needs a tenant, but it is running inside an unscoped ` +
        `"${grant.reason}" block (${grant.detail}). Open a tenant scope for the part that needs one.`,
    )
  }

  throw new TenantContextError(
    `${operationDescription} ran with no tenant context. Wrap it in runInTenantScope(), or — if it ` +
      `genuinely spans tenants — in runUnscoped() with a stated reason.`,
  )
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TenantContextError"
  }
}
