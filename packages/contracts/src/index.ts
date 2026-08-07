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

  return {
    tenantId: id(C, "tenantId", o.tenantId),
    actorId: id(C, "actorId", o.actorId),
    actorKind,
    channel: str(C, "channel", o.channel, 64),
    correlationId: id(C, "correlationId", o.correlationId),
    configRevision: str(C, "configRevision", o.configRevision, 128),
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
  values: Readonly<Record<string, unknown>>
}

export function parseConfigSnapshot(input: unknown): ConfigSnapshot {
  const C = "ConfigSnapshot"
  if (!input || typeof input !== "object") fail(C, "(root)", "expected an object")
  const o = input as Record<string, unknown>

  if (!o.values || typeof o.values !== "object" || Array.isArray(o.values)) {
    fail(C, "values", "expected an object")
  }

  return {
    tenantId: id(C, "tenantId", o.tenantId),
    revision: str(C, "revision", o.revision, 128),
    checksum: str(C, "checksum", o.checksum, 128),
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
] as const
