/**
 * @tenure/contracts — the shapes every module agrees on.
 *
 * GE-020-003. Fifteen contracts, and the thing that makes them contracts
 * rather than documentation is that each one **refuses**. A TypeScript
 * interface is erased at build time and constrains nothing at a module
 * boundary; a value crossing from a connector, a queue, a job runner or a
 * browser has never been type-checked by the compiler that believed it.
 *
 * So every contract here is a runtime gate. `parseX` returns the value or
 * throws a `ContractViolation` naming the field and what was wrong — never
 * echoing the value, because these carry tenant data and a rejection lands in
 * a log.
 *
 * ── What "shared" has to mean to be worth anything ──────────────────────────
 *
 * These are deliberately free of Prisma, AWS, Next and React. A contract that
 * imports the database is not a contract between modules, it is the database
 * with extra steps — and `tests/architecture/forbidden-clients.test.mjs`
 * already governs who may import what. Keeping this package dependency-free is
 * what lets a job runner, an HTTP handler and a queue consumer all speak it.
 */

export class ContractViolation extends Error {
  constructor(
    readonly contract: string,
    readonly field: string,
    readonly problem: string,
  ) {
    // Never interpolates the offending value. These carry tenant data, and a
    // violation is written to a log that outlives the request.
    super(`${contract}.${field}: ${problem}`)
    this.name = "ContractViolation"
  }
}

function fail(contract: string, field: string, problem: string): never {
  throw new ContractViolation(contract, field, problem)
}

/** A non-empty string, or a refusal naming the field. */
function str(contract: string, field: string, value: unknown, max = 512): string {
  if (typeof value !== "string") fail(contract, field, `expected a string, got ${typeof value}`)
  const v = (value as string).trim()
  if (v.length === 0) fail(contract, field, "must not be empty")
  if (v.length > max) fail(contract, field, `longer than ${max} characters`)
  return v
}

/** An ISO-8601 instant. Not a Date: these cross process boundaries as text. */
function instant(contract: string, field: string, value: unknown): string {
  const v = str(contract, field, value, 40)
  if (Number.isNaN(Date.parse(v))) fail(contract, field, "is not an ISO-8601 instant")
  return v
}

const ID = /^[A-Za-z0-9][\w.:-]{0,127}$/

function id(contract: string, field: string, value: unknown): string {
  const v = str(contract, field, value, 128)
  if (!ID.test(v)) fail(contract, field, "is not a valid identifier")
  return v
}

// ── 1. Tenant context ───────────────────────────────────────────────────────

/**
 * Which money-mode an operation is happening in. **One spelling, platform-wide.**
 *
 * `test` and `live` are not deployment environments. A single production
 * deployment serves both: a tenant still onboarding runs its whole system in
 * `test` while the tenant next to it moves real money in `live`, and the same
 * container, the same database and the same request path serve them. So this
 * cannot be derived from `NODE_ENV`, which is a fact about the process rather
 * than about the tenant.
 *
 * It lives here rather than in the configuration engine or the app because
 * every one of those needs the same two words, and two spellings of a
 * money-mode is how a value that reads `"testing"` in one module compares
 * unequal to `"test"` in another and silently takes the live branch.
 *
 * The default, everywhere one is taken, is `test`. A mode that cannot be
 * established is not evidence that real money may move.
 */
export type PaymentMode = "test" | "live"

export const PAYMENT_MODES: readonly PaymentMode[] = ["test", "live"]

export function isPaymentMode(value: unknown): value is PaymentMode {
  return value === "test" || value === "live"
}

/**
 * The configuration key the platform's payment mode is published under.
 *
 * Named here, in the package both the configuration engine and the application
 * already depend on, so the engine that refuses a publication and the request
 * path that reads the resolved value cannot disagree about the string.
 */
export const PAYMENT_MODE_CONFIG_KEY = "platform.payments.mode"

/**
 * The configuration key naming the legal entity a tenant's money moves under.
 *
 * The producer of `TenantContext.legalEntityId`. Empty means "the tenant
 * itself", which resolves to `null` on the context.
 */
export const LEGAL_ENTITY_CONFIG_KEY = "platform.payments.legalEntityId"

/**
 * Who is acting, in which tenant, with what assurance.
 *
 * `actorKind` is not decoration. `system` and `support` are both
 * non-interactive, and an audit trail that cannot tell them apart cannot answer
 * "why did this happen to my data" — one has a person who can be asked, the
 * other does not.
 */
export type ActorKind = "user" | "service" | "system" | "support"

export interface TenantContext {
  tenantId: string
  actorId: string
  actorKind: ActorKind
  /** Where the request entered. A command from a webhook is not a command from a browser. */
  channel: string
  correlationId: string
  /** The configuration revision this request was decided against. */
  configRevision: string
  /**
   * Test or live money-mode. **Required, and deliberately not optional.**
   *
   * Without it a command raised while a tenant is still being set up and one
   * raised against real money are byte-identical values, so nothing downstream
   * — an audit row, a command bus, a provider adapter — can tell them apart,
   * and "we ran the migration against live by mistake" has no field to have
   * prevented it.
   *
   * Optional would be worse than absent. The call site that omits it is the one
   * written under time pressure, and an omitted mode has to default to
   * something; whichever default is chosen is wrong for half the callers and
   * silent for all of them.
   */
  environment: PaymentMode
  /**
   * The legal entity inside the tenant this acts for, or `null` for the tenant
   * itself.
   *
   * `legalEntity` is already a configuration scope — the level where
   * jurisdiction lives (`@tenure/configuration`'s `CONFIG_SCOPES`) — and until
   * this field existed nothing crossing a module boundary could name one, so a
   * layer set for a specific legal entity could be resolved but never
   * requested. Explicitly `null` rather than absent, for the same reason
   * `Command.expectedVersion` is: "this is the tenant's own entity" is a
   * statement, and a missing field is not.
   */
  legalEntityId: string | null
  at: string
}

const ACTOR_KINDS: readonly ActorKind[] = ["user", "service", "system", "support"]

export function parseTenantContext(input: unknown): TenantContext {
  const C = "TenantContext"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const actorKind = str(C, "actorKind", o.actorKind, 16) as ActorKind
  if (!ACTOR_KINDS.includes(actorKind)) {
    fail(C, "actorKind", `must be one of ${ACTOR_KINDS.join(", ")}`)
  }

  // No default. A context that does not say which mode it is in is refused,
  // because the alternative — defaulting to one — is a value nobody chose being
  // recorded as though somebody had.
  if (!isPaymentMode(o.environment)) {
    fail(
      C,
      "environment",
      `is required and must be one of ${PAYMENT_MODES.join(", ")}; a context that cannot say whether it is moving real money is not one anything downstream can act on`,
    )
  }

  if (!("legalEntityId" in o)) {
    fail(C, "legalEntityId", "is required; use null to mean 'the tenant's own legal entity'")
  }

  return {
    tenantId: id(C, "tenantId", o.tenantId),
    actorId: id(C, "actorId", o.actorId),
    actorKind,
    channel: str(C, "channel", o.channel, 64),
    correlationId: id(C, "correlationId", o.correlationId),
    configRevision: str(C, "configRevision", o.configRevision, 128),
    environment: o.environment as PaymentMode,
    legalEntityId:
      o.legalEntityId === null || o.legalEntityId === undefined
        ? null
        : id(C, "legalEntityId", o.legalEntityId),
    at: instant(C, "at", o.at),
  }
}

// ── 2. Commands ─────────────────────────────────────────────────────────────

/**
 * A business write.
 *
 * `expectedVersion` and `idempotencyKey` are required rather than optional, and
 * that is the decision this contract exists to make. Optional concurrency
 * control is concurrency control nobody uses: it is omitted at the call site
 * that needs it most, under time pressure, and the lost update is discovered
 * by a customer. `expectedVersion: null` is how a caller says "this is a
 * create" — explicitly, rather than by leaving a field out.
 */
export interface Command<P = unknown> {
  commandId: string
  context: TenantContext
  /** Semantic action, not an HTTP verb: `Approval.Decide`, not `POST`. */
  action: string
  resourceType: string
  resourceId: string | null
  expectedVersion: number | null
  idempotencyKey: string
  effectiveAt: string
  payload: P
}

export function parseCommand<P = unknown>(input: unknown): Command<P> {
  const C = "Command"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const action = str(C, "action", o.action, 128)
  if (!/^[A-Z][\w]*\.[A-Z][\w]*$/.test(action)) {
    fail(C, "action", "must be a semantic `Resource.Action`, such as Approval.Decide")
  }

  if (!("expectedVersion" in o)) {
    fail(C, "expectedVersion", "is required; use null to mean 'this is a create'")
  }
  const ev = o.expectedVersion
  if (ev !== null && (typeof ev !== "number" || !Number.isInteger(ev) || ev < 0)) {
    fail(C, "expectedVersion", "must be a non-negative integer or null")
  }

  return {
    commandId: id(C, "commandId", o.commandId),
    context: parseTenantContext(o.context),
    action,
    resourceType: id(C, "resourceType", o.resourceType),
    resourceId: o.resourceId === null ? null : id(C, "resourceId", o.resourceId),
    expectedVersion: ev as number | null,
    idempotencyKey: id(C, "idempotencyKey", o.idempotencyKey),
    effectiveAt: instant(C, "effectiveAt", o.effectiveAt),
    payload: o.payload as P,
  }
}

// ── 3. Queries ──────────────────────────────────────────────────────────────

/**
 * A read, with pagination that cannot silently return everything.
 *
 * Cursor rather than offset: offset pagination over a table that is being
 * written to skips and repeats rows, and the caller cannot tell. `limit` is
 * capped here rather than at each call site, because the call site that
 * forgets is the one that pages a million rows into memory.
 */
export const MAX_PAGE = 200

export interface Query {
  context: TenantContext
  resourceType: string
  cursor: string | null
  limit: number
  /** Deterministic ordering. Without it a cursor means nothing. */
  sort: string
}

export function parseQuery(input: unknown): Query {
  const C = "Query"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const limit = o.limit
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    fail(C, "limit", "must be a positive integer")
  }
  if ((limit as number) > MAX_PAGE) fail(C, "limit", `must not exceed ${MAX_PAGE}`)

  return {
    context: parseTenantContext(o.context),
    resourceType: id(C, "resourceType", o.resourceType),
    cursor: o.cursor === null || o.cursor === undefined ? null : str(C, "cursor", o.cursor, 256),
    limit: limit as number,
    sort: str(C, "sort", o.sort, 64),
  }
}

// ── 4. Domain events ────────────────────────────────────────────────────────

/**
 * Something that happened, past tense, versioned.
 *
 * `schemaVersion` is required because a consumer reading an event it does not
 * understand must be able to say so rather than guess. The Bible is explicit
 * that consumers "cannot interpret an event as permission to access arbitrary
 * tenant data" — so events carry references, and a sensitive consumer rereads
 * and reauthorizes.
 */
/**
 * Who wrote the payload.
 *
 * `provider` means the body came from outside the platform — a webhook, a
 * bank file, a processor callback — and has not been through anything of ours.
 * Nothing could previously tell such a body apart from one this platform built,
 * which is why nothing could refuse to log it: a sink that receives opaque JSON
 * has no basis on which to say no.
 *
 * Required rather than defaulted to `"tenure"`. A default is the answer given
 * when the caller did not think about it, and the caller who did not think
 * about it is precisely the one forwarding a processor's payload.
 */
export type EventOrigin = "tenure" | "provider"

export const EVENT_ORIGINS: readonly EventOrigin[] = ["tenure", "provider"]

export interface DomainEvent<P = unknown> {
  eventId: string
  tenantId: string
  /** Past tense: `ApprovalDecided`, not `DecideApproval`. */
  type: string
  schemaVersion: number
  resourceType: string
  resourceId: string
  occurredAt: string
  correlationId: string
  /** The command that caused it, when there was one. */
  causationId: string | null
  /** Whether this platform authored the payload, or an external provider did. */
  origin: EventOrigin
  payload: P
}

/**
 * The event-type spelling rule, in one place.
 *
 * Exported because a process chain names event types it never carries — a
 * declaration of "this module emits ApprovalDecided" has to be held to the same
 * spelling as the event that eventually arrives, or the declaration and the
 * runtime value can disagree about which event a step is even talking about.
 * Two copies of this regex is how that drift starts.
 */
const EVENT_TYPE =
  /^[A-Z][A-Za-z0-9]*(ed|Ed)$|^[A-Z][A-Za-z0-9]*(Created|Updated|Deleted|Decided|Published|Reconciled|Failed|Completed|Started|Cancelled)$/

export function isEventType(type: string): boolean {
  return EVENT_TYPE.test(type)
}

export function parseDomainEvent<P = unknown>(input: unknown): DomainEvent<P> {
  const C = "DomainEvent"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const type = str(C, "type", o.type, 128)
  if (!isEventType(type)) {
    fail(C, "type", "must be past tense, such as ApprovalDecided or TenantReconciled")
  }

  const v = o.schemaVersion
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    fail(C, "schemaVersion", "must be a positive integer; a consumer that cannot tell which shape it received cannot refuse one it does not understand")
  }

  const origin = o.origin
  if (origin !== "tenure" && origin !== "provider") {
    fail(
      C,
      "origin",
      `must be one of ${EVENT_ORIGINS.join(", ")} — a payload nothing can classify as provider-sourced is a payload nothing can keep out of a log`,
    )
  }

  return {
    eventId: id(C, "eventId", o.eventId),
    tenantId: id(C, "tenantId", o.tenantId),
    type,
    schemaVersion: v as number,
    resourceType: id(C, "resourceType", o.resourceType),
    resourceId: id(C, "resourceId", o.resourceId),
    occurredAt: instant(C, "occurredAt", o.occurredAt),
    correlationId: id(C, "correlationId", o.correlationId),
    causationId: o.causationId === null || o.causationId === undefined ? null : id(C, "causationId", o.causationId),
    origin: origin as EventOrigin,
    payload: o.payload as P,
  }
}

// ── 5. Outbox ───────────────────────────────────────────────────────────────

export type OutboxState = "pending" | "dispatching" | "dispatched" | "dead"

/**
 * An event written in the same transaction as the change that caused it.
 *
 * The whole point is that "the row changed" and "the event exists" cannot
 * disagree. `attempts` and `deadLetteredAt` are on the record rather than in a
 * queue's private state, so "why was this never delivered" is answerable from
 * the database that holds the change.
 */
export interface OutboxRecord {
  outboxId: string
  event: DomainEvent
  state: OutboxState
  attempts: number
  lastError: string | null
  availableAt: string
  deadLetteredAt: string | null
}

const OUTBOX_STATES: readonly OutboxState[] = ["pending", "dispatching", "dispatched", "dead"]

export function parseOutboxRecord(input: unknown): OutboxRecord {
  const C = "OutboxRecord"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const state = str(C, "state", o.state, 16) as OutboxState
  if (!OUTBOX_STATES.includes(state)) fail(C, "state", `must be one of ${OUTBOX_STATES.join(", ")}`)

  const attempts = o.attempts
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) {
    fail(C, "attempts", "must be a non-negative integer")
  }

  if (state === "dead" && !o.deadLetteredAt) {
    fail(C, "deadLetteredAt", "a dead record must say when it died")
  }

  return {
    outboxId: id(C, "outboxId", o.outboxId),
    event: parseDomainEvent(o.event),
    state,
    attempts: attempts as number,
    lastError: o.lastError === null || o.lastError === undefined ? null : str(C, "lastError", o.lastError, 1024),
    availableAt: instant(C, "availableAt", o.availableAt),
    deadLetteredAt: o.deadLetteredAt ? instant(C, "deadLetteredAt", o.deadLetteredAt) : null,
  }
}

// ── 6. Errors ───────────────────────────────────────────────────────────────

/**
 * A failure a caller can act on.
 *
 * `retryable` is required: the single most useful thing a caller needs is
 * whether trying again could possibly help, and leaving it optional means
 * every caller guesses. `safeDetail` is named to make the reviewer notice —
 * it is rendered to a user and must not carry another tenant's data or an
 * internal identifier.
 */
export type ErrorKind =
  | "validation"
  | "not-found"
  | "forbidden"
  | "conflict"
  | "precondition"
  | "rate-limited"
  | "unavailable"
  | "internal"

export interface ContractError {
  kind: ErrorKind
  code: string
  safeDetail: string
  retryable: boolean
  correlationId: string
}

const ERROR_KINDS: readonly ErrorKind[] = [
  "validation", "not-found", "forbidden", "conflict",
  "precondition", "rate-limited", "unavailable", "internal",
]

/** Kinds where retrying the identical request can never help. */
const NEVER_RETRYABLE: readonly ErrorKind[] = ["validation", "not-found", "forbidden", "precondition"]

export function parseContractError(input: unknown): ContractError {
  const C = "ContractError"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const kind = str(C, "kind", o.kind, 24) as ErrorKind
  if (!ERROR_KINDS.includes(kind)) fail(C, "kind", `must be one of ${ERROR_KINDS.join(", ")}`)

  if (typeof o.retryable !== "boolean") {
    fail(C, "retryable", "is required; a caller that has to guess will guess wrong")
  }
  // A contradiction here sends clients into a retry loop that can never succeed.
  if (o.retryable === true && NEVER_RETRYABLE.includes(kind)) {
    fail(C, "retryable", `a ${kind} error cannot become correct by being retried`)
  }

  return {
    kind,
    code: id(C, "code", o.code),
    safeDetail: str(C, "safeDetail", o.safeDetail, 512),
    retryable: o.retryable,
    correlationId: id(C, "correlationId", o.correlationId),
  }
}

// ── 7. Jobs ─────────────────────────────────────────────────────────────────

/**
 * Work that happens without a request behind it.
 *
 * `tenantId` is nullable because some jobs legitimately span tenants — the
 * reminder sweep runs once per institution and something has to schedule it.
 * That is the one case, and making it explicit here beats every job carrying a
 * fake tenant id.
 */
export interface JobRequest<P = unknown> {
  jobId: string
  name: string
  tenantId: string | null
  idempotencyKey: string
  scheduledFor: string
  attempt: number
  maxAttempts: number
  payload: P
}

export function parseJobRequest<P = unknown>(input: unknown): JobRequest<P> {
  const C = "JobRequest"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const attempt = o.attempt
  const maxAttempts = o.maxAttempts
  for (const [field, v] of [["attempt", attempt], ["maxAttempts", maxAttempts]] as const) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      fail(C, field, "must be a positive integer")
    }
  }
  if ((attempt as number) > (maxAttempts as number)) {
    fail(C, "attempt", "exceeds maxAttempts; this job should already be dead")
  }

  return {
    jobId: id(C, "jobId", o.jobId),
    name: str(C, "name", o.name, 128),
    tenantId: o.tenantId === null || o.tenantId === undefined ? null : id(C, "tenantId", o.tenantId),
    idempotencyKey: id(C, "idempotencyKey", o.idempotencyKey),
    scheduledFor: instant(C, "scheduledFor", o.scheduledFor),
    attempt: attempt as number,
    maxAttempts: maxAttempts as number,
    payload: o.payload as P,
  }
}

// ── 8. Idempotency ──────────────────────────────────────────────────────────

/**
 * The record that says "this already happened, here is what it returned".
 *
 * `requestDigest` is what makes the key safe. Without it, a client reusing a
 * key for a *different* request receives the first request's result and
 * believes the second succeeded. Comparing digests turns that from silent
 * corruption into a conflict.
 */
export interface IdempotencyRecord {
  key: string
  tenantId: string
  requestDigest: string
  status: "in-flight" | "succeeded" | "failed"
  resultRef: string | null
  expiresAt: string
}

export function parseIdempotencyRecord(input: unknown): IdempotencyRecord {
  const C = "IdempotencyRecord"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const status = str(C, "status", o.status, 16)
  if (!["in-flight", "succeeded", "failed"].includes(status)) {
    fail(C, "status", "must be in-flight, succeeded or failed")
  }
  if (status === "succeeded" && !o.resultRef) {
    fail(C, "resultRef", "a succeeded record must reference what it produced")
  }

  return {
    key: id(C, "key", o.key),
    tenantId: id(C, "tenantId", o.tenantId),
    requestDigest: str(C, "requestDigest", o.requestDigest, 128),
    status: status as IdempotencyRecord["status"],
    resultRef: o.resultRef ? str(C, "resultRef", o.resultRef, 256) : null,
    expiresAt: instant(C, "expiresAt", o.expiresAt),
  }
}

/**
 * Whether a replay may return the stored result.
 *
 * Same key and same request → yes. Same key, different request → a conflict,
 * never the old result.
 */
export function replayable(record: IdempotencyRecord, requestDigest: string): boolean {
  if (record.requestDigest !== requestDigest) {
    throw new ContractViolation(
      "IdempotencyRecord",
      "requestDigest",
      "this key was used for a different request; returning the earlier result would tell the caller something untrue",
    )
  }
  return record.status === "succeeded"
}

// ── 9. Permissions ──────────────────────────────────────────────────────────

/**
 * A permission check, and its answer.
 *
 * A denial must carry a reason. "Denied" with no reason cannot answer the only
 * question anyone ever asks about one.
 */
export interface PermissionCheck {
  context: TenantContext
  /** `<module>.<action>` — module-namespaced so a disabled module denies outright. */
  permission: string
  resourceType: string
  resourceId: string | null
}

/**
 * A namespaced permission key: at least one dot, and every segment named.
 *
 * It used to be exactly two segments, and that made the contract unusable
 * against the permission catalog this platform actually ships — `search.index.
 * query`, `finance.budget.read` and `approvals.request.decide` are all three,
 * and every one of them was refused. That is not a hypothetical: it is why
 * nothing produced a `PermissionCheck`. A rule that no real value can satisfy
 * is not a strict rule, it is an unused one.
 *
 * The property the rule exists for is unchanged and is still enforced: a
 * permission must carry a namespace, so `viewReports` — a bare word that would
 * belong to no module and skip module gating entirely — is still refused.
 * Which module a key belongs to is the catalog's answer, not the spelling's
 * (`packages/module-runtime/src/manifest.ts` explains why at length: the
 * platform's own finance keys break prefix-matching).
 */
const PERMISSION_KEY = /^[a-z][\w-]*(\.[a-z][\w-]*)+$/i

export interface PermissionDecision {
  allowed: boolean
  reason: string | null
  /** The policy revision that decided it, so a past decision stays explainable. */
  policyRevision: string
}

export function parsePermissionCheck(input: unknown): PermissionCheck {
  const C = "PermissionCheck"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const permission = str(C, "permission", o.permission, 128)
  if (!PERMISSION_KEY.test(permission)) {
    fail(C, "permission", "must be `<module>.<action>`, so a permission belonging to a disabled module is denied outright")
  }

  return {
    context: parseTenantContext(o.context),
    permission,
    resourceType: id(C, "resourceType", o.resourceType),
    resourceId: o.resourceId === null || o.resourceId === undefined ? null : id(C, "resourceId", o.resourceId),
  }
}

export function parsePermissionDecision(input: unknown): PermissionDecision {
  const C = "PermissionDecision"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  if (typeof o.allowed !== "boolean") fail(C, "allowed", "must be a boolean")
  if (o.allowed === false && !o.reason) {
    fail(C, "reason", "a denial must say why; 'denied' alone cannot answer the only question anyone asks about one")
  }

  return {
    allowed: o.allowed,
    reason: o.reason ? str(C, "reason", o.reason, 512) : null,
    policyRevision: str(C, "policyRevision", o.policyRevision, 128),
  }
}

// ── 10. Files ───────────────────────────────────────────────────────────────

/**
 * A stored object, by reference.
 *
 * Never the bytes. A contract that carried content would put a document in
 * every log line that serialised it.
 */
export interface FileRef {
  fileId: string
  tenantId: string
  objectKey: string
  mimeType: string
  sizeBytes: number
  checksum: string
}

export function parseFileRef(input: unknown): FileRef {
  const C = "FileRef"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const size = o.sizeBytes
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    fail(C, "sizeBytes", "must be a non-negative integer")
  }

  const objectKey = str(C, "objectKey", o.objectKey, 1024)
  const tenantId = id(C, "tenantId", o.tenantId)
  // A key that does not start with the tenant is a key that can address another
  // tenant's object, which is the whole failure mode of shared storage.
  if (!objectKey.startsWith(`${tenantId}/`)) {
    fail(C, "objectKey", "must begin with the tenant id; a key that does not is a key that can address another tenant's object")
  }

  return {
    fileId: id(C, "fileId", o.fileId),
    tenantId,
    objectKey,
    mimeType: str(C, "mimeType", o.mimeType, 128),
    sizeBytes: size as number,
    checksum: str(C, "checksum", o.checksum, 128),
  }
}

// ── 11. Configuration ───────────────────────────────────────────────────────

/**
 * A resolved configuration, and where each value came from.
 *
 * The revision is what makes a past decision explainable: "why was this
 * approved" is unanswerable without knowing which configuration was live.
 */
export interface ConfigSnapshot {
  tenantId: string
  revision: string
  checksum: string
  /**
   * The money-mode these values were resolved for.
   *
   * A revision alone cannot answer "was this decided under test or live". Both
   * modes resolve through the same engine in the same process, so two snapshots
   * for two modes would otherwise be indistinguishable — and a command raised
   * in `test` deciding against a revision resolved in `live` is exactly the
   * confusion nothing could previously detect. `dispatch` compares this against
   * the command's own `context.environment` and refuses a mismatch.
   */
  environment: PaymentMode
  values: Readonly<Record<string, unknown>>
}

export function parseConfigSnapshot(input: unknown): ConfigSnapshot {
  const C = "ConfigSnapshot"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  if (!o.values || typeof o.values !== "object" || Array.isArray(o.values)) {
    fail(C, "values", "expected an object")
  }

  if (!isPaymentMode(o.environment)) {
    fail(
      C,
      "environment",
      `is required and must be one of ${PAYMENT_MODES.join(", ")}; a snapshot that cannot say which mode it resolved for cannot be matched against the command deciding against it`,
    )
  }

  return {
    tenantId: id(C, "tenantId", o.tenantId),
    revision: str(C, "revision", o.revision, 128),
    checksum: str(C, "checksum", o.checksum, 128),
    environment: o.environment as PaymentMode,
    values: o.values as Record<string, unknown>,
  }
}

// ── 12. Audit ───────────────────────────────────────────────────────────────

/**
 * The evidence record, in the shape every module must produce.
 *
 * `@tenure/audit` builds and redacts these; this is the boundary shape a
 * consumer can rely on receiving.
 */
export interface AuditEntry {
  tenantId: string
  actorId: string
  action: string
  resourceType: string
  resourceId: string | null
  outcome: "ALLOW" | "DENY"
  reason: string | null
  occurredAt: string
  correlationId: string
}

export function parseAuditEntry(input: unknown): AuditEntry {
  const C = "AuditEntry"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const outcome = str(C, "outcome", o.outcome, 8)
  if (outcome !== "ALLOW" && outcome !== "DENY") fail(C, "outcome", "must be ALLOW or DENY")
  if (outcome === "DENY" && !o.reason) {
    fail(C, "reason", "a DENY needs a reason; without one the row cannot answer why six months later")
  }

  return {
    tenantId: id(C, "tenantId", o.tenantId),
    actorId: id(C, "actorId", o.actorId),
    action: str(C, "action", o.action, 128),
    resourceType: id(C, "resourceType", o.resourceType),
    resourceId: o.resourceId === null || o.resourceId === undefined ? null : id(C, "resourceId", o.resourceId),
    outcome,
    reason: o.reason ? str(C, "reason", o.reason, 512) : null,
    occurredAt: instant(C, "occurredAt", o.occurredAt),
    correlationId: id(C, "correlationId", o.correlationId),
  }
}

// ── 13. Tool registration ───────────────────────────────────────────────────

/**
 * A capability Relay may invoke.
 *
 * `requiredPermission` is not optional, and that is the entire point. A tool
 * registered without one is a tool an assistant can call on any tenant's data
 * with no check — which is how a retrieval system becomes an exfiltration
 * system. `readOnly` is separate because a tool that only reads still needs a
 * permission; the two answer different questions.
 */
export interface ToolRegistration {
  toolKey: string
  module: string
  description: string
  requiredPermission: string
  readOnly: boolean
  /** Whether the caller's own permissions are re-checked per invocation. */
  reauthorizesPerCall: boolean
}

export function parseToolRegistration(input: unknown): ToolRegistration {
  const C = "ToolRegistration"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  const requiredPermission = str(C, "requiredPermission", o.requiredPermission, 128)
  if (!PERMISSION_KEY.test(requiredPermission)) {
    fail(C, "requiredPermission", "must be `<module>.<action>`")
  }

  if (typeof o.readOnly !== "boolean") fail(C, "readOnly", "must be a boolean")
  if (typeof o.reauthorizesPerCall !== "boolean") {
    fail(C, "reauthorizesPerCall", "must be a boolean")
  }
  // A writing tool that does not recheck is a writing tool operating on a
  // permission that may have been revoked since the session began.
  if (o.readOnly === false && o.reauthorizesPerCall === false) {
    fail(C, "reauthorizesPerCall", "a tool that writes must reauthorize per call; the permission may have been revoked since the session began")
  }

  const description = str(C, "description", o.description, 512)
  if (description.length < 20) {
    fail(C, "description", "must actually describe the tool; an assistant chooses tools by their descriptions")
  }

  return {
    toolKey: id(C, "toolKey", o.toolKey),
    module: id(C, "module", o.module),
    description,
    requiredPermission,
    readOnly: o.readOnly,
    reauthorizesPerCall: o.reauthorizesPerCall,
  }
}

// ── 15. Process chains ──────────────────────────────────────────────────────

/**
 * One step of a business process that crosses module boundaries.
 *
 * `consumes` and `emits` are event *type names*, not events: a step declares
 * which `DomainEvent.type` hands work to it and which one it hands on. Held to
 * `isEventType` for exactly the same spelling as the event itself, so a chain
 * cannot declare a step waiting on `DecideApproval` while the emitter publishes
 * `ApprovalDecided` and neither side notices.
 */
export interface ProcessChainStep {
  /** The module that owns this step. Must be enabled for the chain to run. */
  module: string
  /** The event type that starts this step. Null only for the first step. */
  consumes: string | null
  /** The event type this step hands on. Null only for the last step. */
  emits: string | null
}

/**
 * A named business process, as data.
 *
 * The reason this is a contract rather than prose: a process that spans modules
 * has no owner, so nothing refuses when a system is composed with a step
 * missing. `request → approval → memory` runs across three modules; disable the
 * middle one and the first still accepts work it can never finish, which is
 * worse than the module being off, because the failure surfaces to whoever
 * raised the request rather than to whoever composed the system.
 *
 * The gap check below is the whole point. A chain whose steps do not join —
 * step 2 waiting on an event step 1 never emits — is a process that stops
 * halfway with no error anywhere, and it is spelled identically to one that
 * works.
 */
export interface ProcessChain {
  chainId: string
  name: string
  /** Ordered. Step n consumes exactly what step n-1 emits. */
  steps: readonly ProcessChainStep[]
}

export function parseProcessChain(input: unknown): ProcessChain {
  const C = "ProcessChain"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  if (!Array.isArray(o.steps)) fail(C, "steps", "expected an array")
  const raw = o.steps as unknown[]
  if (raw.length < 2) {
    fail(C, "steps", "a chain needs at least two steps; one step is a module doing its own work, and needs no chain to say so")
  }

  const steps: ProcessChainStep[] = raw.map((s, i) => {
    if (!s || typeof s !== "object") fail(C, `steps[${i}]`, "expected an object")
    const step = s as Record<string, unknown>

    const eventName = (field: "consumes" | "emits"): string | null => {
      const v = step[field]
      if (v === null || v === undefined) return null
      const name = str(C, `steps[${i}].${field}`, v, 128)
      if (!isEventType(name)) {
        fail(C, `steps[${i}].${field}`, "must be a past-tense event type, the same spelling DomainEvent.type requires")
      }
      return name
    }

    return {
      module: id(C, `steps[${i}].module`, step.module),
      consumes: eventName("consumes"),
      emits: eventName("emits"),
    }
  })

  // The first step is what starts the chain, so it waits on nothing. A first
  // step that consumed something would mean the chain has a step before its
  // first one, which is a chain declared from the middle.
  if (steps[0].consumes !== null) {
    fail(C, "steps[0].consumes", "the first step starts the chain and consumes nothing; a chain declared from its middle cannot be checked for the step in front of it")
  }

  for (let i = 1; i < steps.length; i++) {
    if (steps[i - 1].emits === null) {
      fail(C, `steps[${i - 1}].emits`, "only the last step may emit nothing; a step in the middle that hands nothing on ends the process without saying so")
    }
    if (steps[i].consumes !== steps[i - 1].emits) {
      // Named by position, never by value: an event type is not tenant data,
      // but the rule that violations do not echo their input holds uniformly
      // and an exception is how the next field's exception gets written.
      fail(C, `steps[${i}].consumes`, `does not match what step ${i - 1} emits; the chain does not join here`)
    }
  }

  return {
    chainId: id(C, "chainId", o.chainId),
    name: str(C, "name", o.name, 128),
    steps,
  }
}

// ── 16. The control-plane read plane ────────────────────────────────────────

/**
 * STUDIO-130-001 — versioned contracts for what the live read plane emits.
 *
 * The fifteen above describe the application's own traffic. These four describe
 * the *control plane*: a resource observed in AWS, a cost figure, a drift
 * finding, and the change diff that a plan or a revision comparison produces.
 * They exist here rather than as TypeScript interfaces inside the Studio for
 * the reason this package's header already gives — an interface is erased at
 * build time, and every one of these crosses a process boundary the moment a
 * service adapter maps an SDK response into it or an operator reads one over
 * HTTP.
 *
 * ── Why these four and not the other seven ──────────────────────────────────
 *
 * The requirement names eleven shapes (tenants, manifests, plans, approvals,
 * executions, resources, releases, lifecycle, evidence, cost, drift). Four are
 * published here because four have a producer today. A contract nothing emits
 * is documentation with a parser attached: it cannot refuse anything, because
 * nothing offers it anything, and it drifts from the shape that eventually
 * arrives with no test able to notice. The seven are deliberately absent rather
 * than declared empty — see the `ChangeDomain` note below, which is the same
 * argument for the same reason.
 *
 * ── Versioning, and what a MAJOR actually means ─────────────────────────────
 *
 * Every shape carries `schemaVersion` as `MAJOR.MINOR`, and every parser
 * refuses an unrecognised MAJOR while accepting an unrecognised MINOR.
 *
 * That asymmetry is the whole point. A minor is additive: a producer one minor
 * ahead sends a field this build does not read, and dropping it loses nothing a
 * consumer was relying on. A major removes a field or changes what one MEANS,
 * and a consumer that keeps reading is not degraded, it is wrong — it will read
 * `amountMinor` as cents when the producer switched to micro-units and report a
 * bill ten thousand times too small, with no error anywhere. Refusing is the
 * only safe answer, and it has to happen at the boundary, because by the time
 * the value reaches a page nothing remembers where it came from.
 */

const SCHEMA_VERSION = /^(\d+)\.(\d+)$/

/**
 * The version this build implements for each control-plane shape.
 *
 * One table rather than a literal in each parser: the generator that writes
 * `docs/contracts/*.schema.json` stamps these into `$id`, so a version bumped
 * in one place and not the other changes the generated file and reds
 * `tests/architecture/contracts-schemas-match-parsers.test.mjs`.
 */
export const CONTROL_PLANE_SCHEMA_VERSIONS = {
  EstateResource: "1.0",
  CostFigure: "1.0",
  DriftFinding: "1.0",
  ChangeDiff: "1.0",
  ApiEnvelope: "1.0",
} as const

export type ControlPlaneContract = keyof typeof CONTROL_PLANE_SCHEMA_VERSIONS

/**
 * Accept a compatible version, refuse an incompatible one.
 *
 * Never names the version it received. The rule that a violation does not echo
 * its input holds uniformly, and a version string is the first place an
 * exception would look harmless.
 */
function contractVersion(contract: ControlPlaneContract, value: unknown): string {
  const supported = CONTROL_PLANE_SCHEMA_VERSIONS[contract]
  const v = str(contract, "schemaVersion", value, 16)
  const got = SCHEMA_VERSION.exec(v)
  if (!got) fail(contract, "schemaVersion", "must be MAJOR.MINOR, such as 1.0")
  if (got![1] !== SCHEMA_VERSION.exec(supported)![1]) {
    fail(
      contract,
      "schemaVersion",
      `declares a major version this build does not implement (it implements ${supported}). ` +
        `A minor ahead is forward-compatible and accepted; a major removes or reinterprets a field, ` +
        `so continuing would not degrade the reading, it would make it wrong`,
    )
  }
  return v
}

/**
 * The subset of JSON Schema these contracts are expressed in.
 *
 * Deliberately small. A validator that implements all of JSON Schema is a
 * dependency; one that implements the eleven keywords actually used is eighty
 * lines and can be read in full by whoever is deciding whether to trust it.
 */
export interface JsonSchema {
  type?: string | readonly string[]
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  additionalProperties?: boolean | JsonSchema
  propertyNames?: { pattern?: string; maxLength?: number }
  items?: JsonSchema
  enum?: readonly (string | number | boolean | null)[]
  pattern?: string
  format?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  title?: string
  description?: string
}

function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (Number.isInteger(value)) return "integer"
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "integer") return typeof value === "number" && Number.isInteger(value)
  return typeOf(value) === type
}

/**
 * Check a value against one of the schemas above, failing with a
 * `ContractViolation` that names the path and never the value.
 *
 * This is what makes "the committed schema admits exactly what the parser
 * admits" a structural fact rather than a hope: the parsers below do not
 * restate the shape, they run it. A schema hand-written beside a parser is the
 * artefact that drifts, so there is only one.
 */
export function validateAgainstSchema(
  contract: string,
  schema: JsonSchema,
  value: unknown,
  path = "(root)",
): void {
  if (schema.type !== undefined) {
    const types = typeof schema.type === "string" ? [schema.type] : schema.type
    if (!types.some((t) => matchesType(value, t))) {
      fail(contract, path, `expected ${types.join(" or ")}, got ${typeOf(value)}`)
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value as never)) {
    fail(contract, path, `must be one of ${schema.enum.map((e) => String(e)).join(", ")}`)
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(contract, path, `must be at least ${schema.minLength} characters`)
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail(contract, path, `longer than ${schema.maxLength} characters`)
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      fail(contract, path, `does not match ${schema.pattern}`)
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      fail(contract, path, "is not an ISO-8601 instant")
    }
  }

  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    fail(contract, path, `must be at least ${schema.minimum}`)
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateAgainstSchema(contract, schema.items!, item, `${path}[${i}]`))
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in o)) fail(contract, path === "(root)" ? key : `${path}.${key}`, "is required")
    }
    for (const [key, raw] of Object.entries(o)) {
      const at = path === "(root)" ? key : `${path}.${key}`
      if (schema.propertyNames?.pattern && !new RegExp(schema.propertyNames.pattern).test(key)) {
        fail(contract, path, "carries a key that is not a permitted name")
      }
      if (schema.propertyNames?.maxLength && key.length > schema.propertyNames.maxLength) {
        fail(contract, path, "carries a key longer than the permitted length")
      }
      const child = schema.properties?.[key]
      if (child) {
        validateAgainstSchema(contract, child, raw, at)
        continue
      }
      if (schema.additionalProperties === false) {
        // Refused rather than dropped. A field nothing here knows about is a
        // producer this build has not been reconciled with, and silently
        // ignoring it is how a renamed field reads as an absent one.
        //
        // Names the PERMITTED fields rather than the offending key. The key
        // came from the input, and this package's rule is that a violation —
        // which lands in a log that outlives the request — never carries input.
        fail(
          contract,
          path,
          `carries a field this contract does not define; it has exactly ${Object.keys(schema.properties ?? {}).join(", ")}`,
        )
      }
      if (typeof schema.additionalProperties === "object") {
        validateAgainstSchema(contract, schema.additionalProperties, raw, at)
      }
    }
  }
}

/* control-plane-schemas:begin — extracted verbatim by tools/contract-schemas.mjs.
   Must stay valid JSON between the braces: double-quoted keys, no trailing
   commas, no comments. The generator JSON.parses this text, and the committed
   docs/contracts/*.schema.json are its output. */
export const CONTROL_PLANE_SCHEMAS: Readonly<Record<ControlPlaneContract, JsonSchema>> = {
  "EstateResource": {
    "title": "EstateResource",
    "description": "One resource observed in AWS by the Studio's read plane, sanitized for an operator surface.",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "arn", "service", "resourceType", "name", "accountId", "region", "partition", "tenantId", "cell", "environment", "stateful", "tags", "observedAt"],
    "properties": {
      "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
      "arn": { "type": "string", "minLength": 8, "maxLength": 2048, "pattern": "^arn:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:.+$" },
      "service": { "type": "string", "pattern": "^[a-z0-9-]{2,32}$" },
      "resourceType": { "type": "string", "pattern": "^[a-z0-9-]{2,64}$" },
      "name": { "type": "string", "minLength": 1, "maxLength": 512 },
      "accountId": { "type": "string", "pattern": "^[0-9]{12}$" },
      "region": { "type": "string", "pattern": "^(global|[a-z]{2}(-[a-z]+)+-[0-9])$" },
      "partition": { "type": "string", "enum": ["aws", "aws-cn", "aws-us-gov"] },
      "tenantId": { "type": ["string", "null"], "maxLength": 128 },
      "cell": { "type": ["string", "null"], "maxLength": 128 },
      "environment": { "type": ["string", "null"], "maxLength": 32 },
      "stateful": { "type": "boolean" },
      "tags": { "type": "object", "propertyNames": { "pattern": "^[^\\u0000-\\u001f]{1,128}$", "maxLength": 128 }, "additionalProperties": { "type": "string", "maxLength": 256 } },
      "observedAt": { "type": "string", "format": "date-time", "maxLength": 40 }
    }
  },
  "CostFigure": {
    "title": "CostFigure",
    "description": "One money figure the control plane publishes, with the period and the system it came from.",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "dimension", "key", "kind", "amountMinor", "currency", "periodStart", "periodEnd", "sourceSystem", "sourceReference", "retrievedAt"],
    "properties": {
      "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
      "dimension": { "type": "string", "enum": ["tenant", "service", "account", "plan"] },
      "key": { "type": "string", "minLength": 1, "maxLength": 256 },
      "kind": { "type": "string", "enum": ["ACTUAL", "AMORTIZED", "FORECAST", "BUDGET"] },
      "amountMinor": { "type": "integer" },
      "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
      "periodStart": { "type": "string", "format": "date-time", "maxLength": 40 },
      "periodEnd": { "type": "string", "format": "date-time", "maxLength": 40 },
      "sourceSystem": { "type": "string", "minLength": 1, "maxLength": 64 },
      "sourceReference": { "type": "string", "minLength": 1, "maxLength": 512 },
      "retrievedAt": { "type": "string", "format": "date-time", "maxLength": 40 }
    }
  },
  "DriftFinding": {
    "title": "DriftFinding",
    "description": "One difference between the estate as observed and the estate as declared.",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "arn", "kind", "field", "severity", "reversible", "detail", "detectedAt"],
    "properties": {
      "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
      "arn": { "type": "string", "minLength": 8, "maxLength": 2048, "pattern": "^arn:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:.+$" },
      "kind": { "type": "string", "enum": ["unmanaged", "missing", "modified"] },
      "field": { "type": ["string", "null"], "maxLength": 128 },
      "severity": { "type": "string", "enum": ["info", "warning", "critical"] },
      "reversible": { "type": "boolean" },
      "detail": { "type": "string", "minLength": 1, "maxLength": 512 },
      "detectedAt": { "type": "string", "format": "date-time", "maxLength": 40 }
    }
  },
  "ChangeDiff": {
    "title": "ChangeDiff",
    "description": "What a change does, in every domain the control plane can actually compute one for.",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "entries"],
    "properties": {
      "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
      "entries": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["domain", "path", "before", "after", "effect", "reversible", "monthlyCostDeltaMinor"],
          "properties": {
            "domain": { "type": "string", "enum": ["app-config", "relay", "aws-resource", "cost", "rollback"] },
            "path": { "type": "string", "minLength": 1, "maxLength": 512 },
            "before": {},
            "after": {},
            "effect": { "type": "string", "enum": ["create", "update", "delete", "replace"] },
            "reversible": { "type": "boolean" },
            "monthlyCostDeltaMinor": { "type": ["integer", "null"] }
          }
        }
      }
    }
  },
  "ApiEnvelope": {
    "title": "ApiEnvelope",
    "description": "The 2xx body every control-plane read endpoint returns. Non-2xx is RFC 7807 problem+json, never this.",
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "items", "nextCursor", "asOf", "correlationId"],
    "properties": {
      "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
      "items": { "type": "array" },
      "nextCursor": { "type": ["string", "null"], "minLength": 1, "maxLength": 8192 },
      "asOf": { "type": "string", "format": "date-time", "maxLength": 40 },
      "correlationId": { "type": "string", "minLength": 1, "maxLength": 128 }
    }
  }
}
/* control-plane-schemas:end */

/**
 * A resource the Studio has actually observed in AWS.
 *
 * `stateful` is not decoration and is not derivable by a reader: it is what
 * makes a deletion reversible or not. Removing an ECS service and putting it
 * back is a deployment; removing an RDS instance and putting it back is a new
 * empty database with the same name. The read plane decides this from the
 * resource type it just mapped, which is the only place that knows.
 *
 * `tenantId`, `cell` and `environment` are explicitly nullable rather than
 * absent, because "this resource carries no tenant tag" is the finding that
 * matters — untagged spend is reported unallocated, and a missing field would
 * be indistinguishable from an adapter that forgot to map one.
 */
export interface EstateResource {
  schemaVersion: string
  arn: string
  service: string
  resourceType: string
  name: string
  accountId: string
  region: string
  partition: string
  tenantId: string | null
  cell: string | null
  environment: string | null
  stateful: boolean
  tags: Readonly<Record<string, string>>
  observedAt: string
}

export function parseEstateResource(input: unknown): EstateResource {
  const C = "EstateResource"
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  contractVersion(C, o.schemaVersion)
  validateAgainstSchema(C, CONTROL_PLANE_SCHEMAS.EstateResource, o)

  // Cross-field, which no schema keyword can express: an ARN is the handle
  // every later action uses, so one that disagrees with the partition, service,
  // region or account it was reported under is a resource an operator would act
  // on in the wrong place. `arn:partition:service:region:account:resource`, with
  // region and account legitimately empty on global and bucket ARNs.
  const parts = (o.arn as string).split(":")
  const disagreement =
    parts[1] !== o.partition
      ? "partition"
      : parts[2] !== o.service
        ? "service"
        : parts[3] !== "" && parts[3] !== o.region && !(o.region === "global" && parts[3] === "")
          ? "region"
          : parts[4] !== "" && parts[4] !== o.accountId
            ? "account"
            : null
  if (disagreement) {
    fail(C, "arn", `names a different ${disagreement} than the resource was reported under`)
  }

  return {
    schemaVersion: o.schemaVersion as string,
    arn: o.arn as string,
    service: o.service as string,
    resourceType: o.resourceType as string,
    name: o.name as string,
    accountId: o.accountId as string,
    region: o.region as string,
    partition: o.partition as string,
    tenantId: (o.tenantId as string | null) ?? null,
    cell: (o.cell as string | null) ?? null,
    environment: (o.environment as string | null) ?? null,
    stateful: o.stateful as boolean,
    tags: o.tags as Record<string, string>,
    observedAt: o.observedAt as string,
  }
}

/**
 * One money figure, with the period it covers and the system it came from.
 *
 * `amountMinor` is whole minor units — cents, not the six-extra-digit scale
 * `@tenure/finops` allocates in. A figure crossing a boundary is a figure
 * somebody is going to render or compare, and the scale that exists so a
 * millionth of a cent survives a million-line ingest is exactly the scale a
 * consumer will misread by six orders of magnitude.
 */
export interface CostFigure {
  schemaVersion: string
  dimension: "tenant" | "service" | "account" | "plan"
  key: string
  kind: "ACTUAL" | "AMORTIZED" | "FORECAST" | "BUDGET"
  amountMinor: number
  currency: string
  periodStart: string
  periodEnd: string
  sourceSystem: string
  sourceReference: string
  retrievedAt: string
}

export function parseCostFigure(input: unknown): CostFigure {
  const C = "CostFigure"
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  contractVersion(C, o.schemaVersion)
  validateAgainstSchema(C, CONTROL_PLANE_SCHEMAS.CostFigure, o)

  // A period that ends before it starts is how a month's spend gets reported
  // against a window nothing was billed in, and every keyword above passes it.
  if (Date.parse(o.periodEnd as string) <= Date.parse(o.periodStart as string)) {
    fail(C, "periodEnd", "must be after periodStart; a figure covering no time covers nothing")
  }

  return {
    schemaVersion: o.schemaVersion as string,
    dimension: o.dimension as CostFigure["dimension"],
    key: o.key as string,
    kind: o.kind as CostFigure["kind"],
    amountMinor: o.amountMinor as number,
    currency: o.currency as string,
    periodStart: o.periodStart as string,
    periodEnd: o.periodEnd as string,
    sourceSystem: o.sourceSystem as string,
    sourceReference: o.sourceReference as string,
    retrievedAt: o.retrievedAt as string,
  }
}

/**
 * One difference between the estate as observed and the estate as declared.
 *
 * `reversible` travels with the finding rather than being decided by whoever
 * renders it, for the same reason `stateful` does: the surface that offers to
 * reconcile drift is the surface that must refuse to do it silently, and it
 * cannot know that deleting this particular ARN destroys data.
 */
export interface DriftFinding {
  schemaVersion: string
  arn: string
  kind: "unmanaged" | "missing" | "modified"
  field: string | null
  severity: "info" | "warning" | "critical"
  reversible: boolean
  detail: string
  detectedAt: string
}

export function parseDriftFinding(input: unknown): DriftFinding {
  const C = "DriftFinding"
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  contractVersion(C, o.schemaVersion)
  validateAgainstSchema(C, CONTROL_PLANE_SCHEMAS.DriftFinding, o)

  // A `modified` finding is about one attribute and is meaningless without
  // naming it; the other two are about the whole resource and naming a field
  // would say the resource exists and does not at the same time.
  if (o.kind === "modified" && o.field === null) {
    fail(C, "field", "a modified finding must name the attribute that differs")
  }
  if (o.kind !== "modified" && o.field !== null) {
    fail(C, "field", "only a modified finding names an attribute; a whole-resource finding that names one cannot be acted on")
  }

  return {
    schemaVersion: o.schemaVersion as string,
    arn: o.arn as string,
    kind: o.kind as DriftFinding["kind"],
    field: (o.field as string | null) ?? null,
    severity: o.severity as DriftFinding["severity"],
    reversible: o.reversible as boolean,
    detail: o.detail as string,
    detectedAt: o.detectedAt as string,
  }
}

// ── 17. Change diffs ────────────────────────────────────────────────────────

/**
 * The domains a change diff can actually be computed for — STUDIO-060-003.
 *
 * Five, not ten. The requirement names app config, data/schema, IAM/security,
 * AWS resources, domains, integrations, Relay, cost, operations and rollback;
 * five of those have something in this repository that can produce a diff, and
 * the other five are LEFT OUT OF THE ENUM rather than emitted as empty sections.
 *
 * That is the entire decision. An `integrations: []` section reads as "nothing
 * changed in integrations", which is a statement about the change. "We do not
 * compute this" is a statement about the product, and the two are opposite
 * answers to the question an operator is actually asking before they approve.
 * A domain becomes legal here on the day something emits it.
 *
 * ── What earns a place, and what each of the five is emitted from ────────────
 *
 *   * `app-config` — a configuration revision comparison, over resolved values.
 *   * `relay`      — the same comparison, for keys the configuration engine's
 *                    own domain table assigns to `platform.relay.*`. Not a
 *                    cosmetic re-label: `platform.relay.modelTokenBudgetPerMonth`
 *                    is the tenant's model-spend ceiling and is enforced in
 *                    `apps/web/src/app/api/ai/chat/route.ts`, so an operator
 *                    approving a diff needs to see that a Relay allowance moved
 *                    rather than that "some setting" did.
 *   * `aws-resource` — the live estate against the desired set.
 *   * `cost`       — what the plan commits to per month, priced.
 *   * `rollback`   — what returning to an earlier revision would change. A
 *                    distinct question from `app-config`: that one is "what did
 *                    the last publication do", this one is "what would undoing
 *                    it do", and the second is the one asked under pressure.
 *
 * The five absent — data/schema, IAM/security, domains, integrations and
 * operations — map to configuration domains that are declared and RESERVED
 * (`platform.entities.*`, `platform.permissions.*` / `platform.identity.*`,
 * `platform.deployment.*`, `platform.connectors.*`, `platform.observability.*`),
 * meaning no definition exists to produce a value for one yet. They arrive here
 * on the day a key does, and not before.
 */
export type ChangeDomain = "app-config" | "relay" | "aws-resource" | "cost" | "rollback"

export const CHANGE_DOMAINS: readonly ChangeDomain[] = [
  "app-config",
  "relay",
  "aws-resource",
  "cost",
  "rollback",
]

export interface ChangeDiffEntry {
  domain: ChangeDomain
  /** What changed: a configuration key, an ARN, or the plan a cost belongs to. */
  path: string
  before: unknown
  after: unknown
  effect: "create" | "update" | "delete" | "replace"
  /**
   * Whether undoing this returns the system to where it was.
   *
   * Set from what the thing IS, by whoever produced the entry. Republishing a
   * configuration value is reversible; deleting an RDS instance is not, and a
   * confirmation surface that cannot tell them apart either blocks everything
   * or blocks nothing.
   */
  reversible: boolean
  /**
   * The recurring monthly cost this entry adds or removes, in whole minor
   * units — or `null` for "not computed".
   *
   * `null` and `0` are different answers and both are needed. `0` says the
   * change costs nothing; `null` says nothing priced it, which is what an
   * approval threshold must not silently read as free.
   */
  monthlyCostDeltaMinor: number | null
}

export interface ChangeDiff {
  schemaVersion: string
  entries: readonly ChangeDiffEntry[]
}

export function parseChangeDiff(input: unknown): ChangeDiff {
  const C = "ChangeDiff"
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  contractVersion(C, o.schemaVersion)
  validateAgainstSchema(C, CONTROL_PLANE_SCHEMAS.ChangeDiff, o)

  const entries = o.entries as ChangeDiffEntry[]
  const seen = new Set<string>()
  entries.forEach((entry, i) => {
    if (entry.effect === "create" && entry.before !== null) {
      fail(C, `entries[${i}].before`, "a create has no previous value; use update or replace")
    }
    if (entry.effect === "delete" && entry.after !== null) {
      fail(C, `entries[${i}].after`, "a delete has no resulting value; use update or replace")
    }
    // A cost entry that did not price anything is the empty-section problem
    // wearing a different hat: a `cost` heading appears, an operator reads it as
    // "the cost of this change is known", and the number behind it is "nobody
    // computed one". The domain exists to carry a figure; an entry with no
    // figure belongs to whichever domain actually changed.
    if (entry.domain === "cost" && entry.monthlyCostDeltaMinor === null) {
      fail(C, `entries[${i}].monthlyCostDeltaMinor`, "a cost entry must carry a figure; an unpriced change belongs to the domain that changed, not to cost")
    }
    // A rollback in this product REPUBLISHES an earlier revision forward as a
    // new one — it never rewinds the history — so there is nothing about it
    // that cannot itself be undone. A producer marking one irreversible has
    // confused a rollback with a deletion, and a confirmation surface would
    // then refuse the one action an operator reaches for during an incident.
    if (entry.domain === "rollback" && !entry.reversible) {
      fail(C, `entries[${i}].reversible`, "a rollback republishes forward and is always itself reversible; an irreversible entry here is a deletion mislabelled")
    }
    const key = `${entry.domain}\u0000${entry.path}`
    if (seen.has(key)) {
      // Named by position, never by value. Two entries for one path also
      // double-count `monthlyCostDeltaMinor`, which is the number an approval
      // threshold is assessed on.
      fail(C, `entries[${i}].path`, "appears twice in the same domain; a diff that says a path becomes two things says nothing")
    }
    seen.add(key)
  })

  return { schemaVersion: o.schemaVersion as string, entries }
}

// ── 18. The API envelope ────────────────────────────────────────────────────

/**
 * STUDIO-130-001 / STUDIO-130-002 — the 2xx body every control-plane read
 * endpoint returns.
 *
 * It lives here rather than only in `apps/system-studio/src/lib/api/envelope.ts`
 * for the reason the four above do: it is the shape that actually crosses the
 * process boundary. Every one of the other contracts reaches a caller INSIDE
 * this envelope, so an envelope with no version is a version stamp on the cargo
 * and none on the crate — a poller can tell that a resource it received is one
 * it understands, and cannot tell whether the paging, the freshness marker or
 * the correlation field still mean what its client library thinks.
 *
 * `nextCursor` is nullable rather than absent when there is no next page. A
 * missing field and a null one are the same JSON to a careless reader and
 * opposite facts to a careful one: "there is no more" versus "this producer
 * does not paginate", and a client that treats the second as the first stops
 * reading a fleet halfway through.
 *
 * Which is why it is in the schema's `required` list. It was not, and the
 * paragraph above was therefore an argument the contract did not make: a
 * producer that omitted the field entirely was accepted, and the parser's
 * `?? null` then turned the omission into the very "there is no more" the
 * paragraph says it must never be mistaken for. `docs/contracts/conformance-fixtures.json`
 * has always listed the omission as a rejection — the schema was the half that
 * did not agree.
 *
 * `items` is deliberately unconstrained beyond being an array. What is IN it is
 * the endpoint's own contract — `EstateResource`, a tenant row, an operation —
 * and restating that here would create a second place for it to be wrong.
 */
export interface ApiEnvelope<T = unknown> {
  schemaVersion: string
  items: readonly T[]
  /** Opaque and encrypted. Null when there is nothing after this page. */
  nextCursor: string | null
  /** When the underlying data was current. A list with no as-of is a list with no age. */
  asOf: string
  correlationId: string
}

export function parseApiEnvelope<T = unknown>(input: unknown): ApiEnvelope<T> {
  const C = "ApiEnvelope"
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  contractVersion(C, o.schemaVersion)
  validateAgainstSchema(C, CONTROL_PLANE_SCHEMAS.ApiEnvelope, o)

  return {
    schemaVersion: o.schemaVersion as string,
    items: o.items as readonly T[],
    nextCursor: (o.nextCursor as string | null) ?? null,
    asOf: o.asOf as string,
    correlationId: o.correlationId as string,
  }
}

/** Every contract, for exhaustive testing and for the ownership map. */
export const CONTRACTS = [
  "TenantContext",
  "Command",
  "Query",
  "DomainEvent",
  "OutboxRecord",
  "ContractError",
  "JobRequest",
  "IdempotencyRecord",
  "PermissionCheck",
  "PermissionDecision",
  "FileRef",
  "ConfigSnapshot",
  "AuditEntry",
  "ToolRegistration",
  "ProcessChain",
  "EstateResource",
  "CostFigure",
  "DriftFinding",
  "ChangeDiff",
  "ApiEnvelope",
] as const
