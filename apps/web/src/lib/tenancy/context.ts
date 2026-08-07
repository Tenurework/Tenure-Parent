import { AsyncLocalStorage } from "node:async_hooks"

import { isPaymentMode, PAYMENT_MODES, type PaymentMode } from "@tenure/contracts"

/**
 * The active tenant, carried implicitly through an operation.
 *
 * Passing an institutionId down every call chain is the alternative, and it
 * fails in the direction that matters: the one function that forgets to thread
 * it through still compiles, still runs, and returns another tenant's rows.
 * AsyncLocalStorage makes the context ambient so the query layer can demand it
 * rather than trust each caller to supply it.
 */

/**
 * Why a tenant scope was opened.
 *
 * A closed set, and required on every scope. Two of the entries are the reason
 * this field exists at all: a scope opened to render a page for the person
 * sitting in front of it and a scope opened to assemble a corpus for a
 * third-party model are, to the query layer, the same scope — same tenant, same
 * actor, same rows. `docs/architecture/REVIEW-FINDINGS.md:19` records that one
 * of the two competing `withTenant` designs carried a `purpose` and the
 * surviving implementation dropped it; this is that field, put back.
 *
 * It is not decoration. `loadSearchCorpus` (src/lib/search-data.ts) refuses to
 * run unless the open scope says `model-exposure`, so a retrieval that would
 * leave the process for a vendor cannot be reached from a scope somebody opened
 * to draw a calendar.
 */
export const TENANT_PURPOSES = [
  /** A signed-in person is waiting for this. Pages, server actions, the palette. */
  "interactive",
  /** The rows may be handed to a model. Retrieval for the assistant. */
  "model-exposure",
  /** Scheduled or triggered work with no person behind it. */
  "job",
  /** Tenure staff acting inside a customer tenant — a diagnostic read. */
  "support",
  /** Bulk extraction of a tenant's own data, for the tenant. */
  "export",
] as const

export type TenantPurpose = (typeof TENANT_PURPOSES)[number]

/** Narrow an unvalidated value — a job envelope, a resolved config — to a purpose. */
export function isTenantPurpose(value: unknown): value is TenantPurpose {
  return typeof value === "string" && (TENANT_PURPOSES as readonly string[]).includes(value)
}

export type TenantScope = {
  institutionId: string
  /**
   * What this block of work is for. See `TENANT_PURPOSES`.
   *
   * Required, and checked at runtime below, for the same reason `environment`
   * is: a purpose a caller may omit is the purpose that gets omitted, and an
   * audit that cannot distinguish "rendered a page" from "fed a model" cannot
   * answer the only question anybody asks about retrieval.
   */
  purpose: TenantPurpose
  /**
   * Test or live money-mode, for THIS tenant, on this operation.
   *
   * The same spelling the kernel's `TenantContext.environment` uses
   * (`@tenure/contracts`), deliberately — one word for one concept, so a scope
   * opened here and a command envelope built from it cannot disagree about
   * which mode a tenant is in.
   *
   * It is a property of the tenant, not of the deployment: `NODE_ENV` is the
   * same string for every tenant this container serves, and two tenants on one
   * container are routinely in different modes. The value is published as
   * configuration (`platform.payments.mode`) and resolved in
   * `src/lib/config/server.ts`, so changing it is an authorised publication
   * with a diff rather than an environment variable somebody edited.
   *
   * Required, for the reason the contract gives: a mode that a call site may
   * omit is the mode that gets omitted.
   */
  environment: PaymentMode
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

/**
 * A Next.js control-flow throw, recognised without importing Next.
 *
 * `redirect()` does not return: it throws an Error carrying a `digest` of the
 * form `NEXT_REDIRECT;replace;/messages/abc;307;`, which the framework catches
 * at the request boundary and turns into a 307. Everything between the throw
 * and that boundary sees an exception — including `db.$transaction`, which
 * rolls back.
 *
 * Matched on the prefix rather than by calling Next's own `isRedirectError`,
 * deliberately: this module is imported by unit tests and by scripts that have
 * no Next runtime, and a guard that cannot run outside a request is a guard the
 * tests cannot prove. The prefix is the stable half of the contract
 * (`next/dist/client/components/redirect-error.js`, `REDIRECT_ERROR_CODE`); the
 * destination and status that follow it are not inspected here.
 *
 * `notFound()` is deliberately NOT matched. It throws too, but it is reached
 * only from page reads that have no write in flight, and turning it into an
 * error would replace a 404 with a 500.
 */
export function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

/**
 * The same question asked at the transaction boundary, where the answer differs.
 *
 * A tenant scope may legitimately contain a `notFound()`: a page read raises one
 * the moment a row turns up missing, there is nothing in flight, and refusing it
 * would replace a 404 with a 500. That is why `isNextControlFlowError` above
 * stops at `NEXT_REDIRECT`.
 *
 * An open transaction has no such latitude. Every Next control-flow throw aborts
 * it identically — `notFound()` inside `db.$transaction` rolls the whole callback
 * back and then renders a 404, so the user is told the row does not exist by the
 * very request that deleted it. So this predicate is the strict one, and it is
 * why the two are separate functions rather than one with a flag: they are asked
 * at two boundaries with two different right answers, and collapsing them would
 * force one of the boundaries to be wrong.
 *
 * `NEXT_HTTP_ERROR_FALLBACK` is the digest prefix Next uses for `notFound()` and
 * `forbidden()` / `unauthorized()` in the App Router; `NEXT_NOT_FOUND` is the
 * older spelling, still thrown by the version pinned here. Both are matched, so
 * this keeps working across the upgrade rather than silently stopping.
 *
 * Used by `guardedTransaction` in `src/lib/db.ts`, which is attached to the one
 * client every query goes through. The lexical half is
 * `tests/architecture/navigation-outside-tenant-scope.test.mjs`.
 */
export function isNextNavigationThrow(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  if (typeof digest !== "string") return false
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  )
}

/**
 * The rule, stated where it is broken.
 *
 * One message rather than a template so a search for any part of it lands on
 * this file, and so the two throw sites below cannot drift apart.
 */
function redirectInsideScopeError(scope: TenantScope): TenantContextError {
  return new TenantContextError(
    `redirect() was called inside the tenant scope for ${scope.institutionId} ` +
      `(purpose: ${scope.purpose}). redirect() is a throw; inside a tenant scope it aborts any ` +
      `open transaction, which rolls back silently while the browser sees a successful ` +
      `navigation. Return from the scope and redirect after it: ` +
      `const id = await withTenantScope(userId, async () => { ...; return x.id }); redirect(\`/x/\${id}\`). ` +
      `The lexical half of this rule is tests/architecture/redirect-lives-outside-tenant-scope.test.mjs.`,
  )
}

/**
 * Run `fn` with an active tenant. Nested calls may narrow but not widen.
 *
 * ## A `React.cache()` memo is per REQUEST; a tenant scope is per BLOCK
 *
 * `docs/architecture/REVIEW-FINDINGS.md:54`. These two lifetimes are not nested,
 * and nothing lines them up. `cache(fn)` memoizes on its arguments for the whole
 * render, so the first caller inside `runInTenantScope(A)` decides the answer
 * that every later caller gets — including one running inside
 * `runInTenantScope(B)` later in the same request. Under `TENANCY_ENFORCE=true`
 * the query inside that memo was filtered to A, so B is served A's rows and no
 * layer below can tell.
 *
 * So a `cache()`d function must satisfy one of these, and its comment must say
 * which:
 *
 *   1. it reads only PLATFORM_GLOBAL models (`./registry.ts`) — `Institution`,
 *      `User` — so no tenant filter applies and the answer cannot vary by scope;
 *   2. every tenant it can read from appears in its argument list, so the memo
 *      key changes when the tenant does (`viewerTimeZone(userId, institutionId)`
 *      in `src/lib/institution-time.ts` is the worked example — it was keyed on
 *      `userId` alone and read a TENANT_SCOPED `Organization`);
 *   3. it runs under an explicit `runUnscoped('auth-bootstrap', ...)` grant and
 *      is *supposed* to span tenants — `getUserContext` in `src/lib/rbac.ts`
 *      returns a person's whole cross-tenant membership set on purpose, which is
 *      how a tenant is chosen in the first place.
 *
 * The reason to write it here rather than in a document is that (2) is
 * invisible: a loader keyed on too little compiles, passes every unit test that
 * builds its own fixture, and is wrong only when two scopes are opened in one
 * request.
 */
export function runInTenantScope<T>(scope: TenantScope, fn: () => T): T {
  if (!scope.institutionId) {
    throw new TenantContextError("Refusing to open a tenant scope with an empty institutionId.")
  }
  // Checked for the same reason `environment` is, one boundary below: a scope is
  // assembled from values that crossed one, and `tsc` cannot see a field that
  // arrived missing. Refusing beats defaulting — defaulting to `interactive`
  // would let a model-exposure path open a scope that reads as a page render.
  if (!isTenantPurpose(scope.purpose)) {
    throw new TenantContextError(
      `Refusing to open a tenant scope for ${scope.institutionId} without a purpose. ` +
        `TenantScope.purpose must be one of ${TENANT_PURPOSES.join(", ")}; the entry points in ` +
        `src/lib/tenant-scope.ts supply it (withTenantScope → interactive unless told otherwise, ` +
        `withSystemTenantScope/forEachInstitution → job).`,
    )
  }
  // Checked here rather than trusted from the type. A scope is assembled from
  // values that crossed a boundary — a resolved configuration, a job envelope —
  // and `tsc` cannot see a field that arrived missing. Refusing beats
  // defaulting: a block of work running in a mode nobody chose is how a live
  // action gets recorded as a test one, and every reader of the audit trail
  // then believes it.
  if (!isPaymentMode(scope.environment)) {
    throw new TenantContextError(
      `Refusing to open a tenant scope for ${scope.institutionId} without a money-mode. ` +
        `TenantScope.environment must be one of ${PAYMENT_MODES.join(", ")}; it is resolved from ` +
        `the tenant's published configuration in src/lib/config/server.ts (paymentModeForInstitution).`,
    )
  }
  return storage.run({ kind: "scoped", scope }, () => {
    // Both halves are needed: a synchronous body throws here, an async one
    // rejects the promise `settleInsideContext` handed back. A guard that
    // covered only the synchronous case would miss every server action, which
    // is all of them.
    let settled: T
    try {
      settled = settleInsideContext(fn())
    } catch (err) {
      throw isNextControlFlowError(err) ? redirectInsideScopeError(scope) : err
    }
    const thenable = settled as { then?: unknown } | null | undefined
    if (typeof thenable?.then !== "function") return settled
    return (settled as unknown as Promise<unknown>).then(undefined, (err: unknown) => {
      throw isNextControlFlowError(err) ? redirectInsideScopeError(scope) : err
    }) as T
  })
}

/**
 * The money-mode of the active tenant scope, or undefined outside one.
 *
 * Read by `recordAuditEvent` so an audit row states the mode the action
 * happened in without every writer having to pass it — the same reason the
 * tenant itself is ambient.
 */
export function currentEnvironment(): PaymentMode | undefined {
  return currentScope()?.environment
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
