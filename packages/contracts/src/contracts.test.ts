/**
 * The contracts, tested for what they REFUSE.
 *
 * A contract that only accepts valid input is a type annotation with extra
 * steps. Every test below removes or corrupts one field and asserts the
 * refusal, because the whole reason these exist at runtime is that values
 * cross module boundaries the compiler never saw.
 *
 * Two properties are asserted across all fourteen at the end: every parser
 * rejects a non-object, and no refusal message ever contains the value it
 * rejected. The second matters more than it looks — a violation is written to
 * a log, and these carry tenant data.
 */
import { describe, expect, it } from "@jest/globals"

import {
  CONTRACTS,
  ContractViolation,
  MAX_PAGE,
  parseAuditEntry,
  parseCommand,
  parseConfigSnapshot,
  parseContractError,
  parseDomainEvent,
  parseFileRef,
  parseIdempotencyRecord,
  parseJobRequest,
  parseOutboxRecord,
  parsePermissionCheck,
  parsePermissionDecision,
  parseProcessChain,
  parseQuery,
  parseTenantContext,
  parseToolRegistration,
  replayable,
} from "./index"

const AT = "2026-08-01T12:00:00.000Z"

const context = (over: Record<string, unknown> = {}) => ({
  tenantId: "rochester",
  actorId: "user-123",
  actorKind: "user",
  channel: "web",
  correlationId: "corr-abc",
  configRevision: "cfg-7",
  at: AT,
  ...over,
})

describe("TenantContext", () => {
  it("accepts a well-formed context", () => {
    expect(parseTenantContext(context()).tenantId).toBe("rochester")
  })

  it("refuses an actor kind it does not know", () => {
    // `system` and `support` are both non-interactive and deliberately
    // distinct: one has a person who can be asked why.
    expect(() => parseTenantContext(context({ actorKind: "robot" }))).toThrow(ContractViolation)
    expect(parseTenantContext(context({ actorKind: "support" })).actorKind).toBe("support")
  })

  it("refuses a missing tenant, actor or timestamp", () => {
    for (const field of ["tenantId", "actorId", "at", "correlationId"]) {
      expect(() => parseTenantContext(context({ [field]: undefined }))).toThrow(
        new RegExp(`TenantContext\\.${field}`),
      )
    }
  })

  it("refuses a timestamp that is not an instant", () => {
    expect(() => parseTenantContext(context({ at: "yesterday" }))).toThrow(/is not an ISO-8601/)
  })
})

const command = (over: Record<string, unknown> = {}) => ({
  commandId: "cmd-1",
  context: context(),
  action: "Approval.Decide",
  resourceType: "ApprovalRequest",
  resourceId: "ar-9",
  expectedVersion: 3,
  idempotencyKey: "idem-1",
  effectiveAt: AT,
  payload: { decision: "APPROVE" },
  ...over,
})

describe("Command", () => {
  it("accepts a well-formed command", () => {
    expect(parseCommand(command()).action).toBe("Approval.Decide")
  })

  it("requires expectedVersion to be present, even when it is null", () => {
    // The decision this contract exists to make. Optional concurrency control
    // is concurrency control nobody uses.
    const { expectedVersion, ...without } = command()
    expect(() => parseCommand(without)).toThrow(/use null to mean 'this is a create'/)
    expect(parseCommand(command({ expectedVersion: null })).expectedVersion).toBeNull()
  })

  it("refuses an HTTP verb where a semantic action belongs", () => {
    expect(() => parseCommand(command({ action: "POST" }))).toThrow(/semantic/)
    expect(() => parseCommand(command({ action: "approve" }))).toThrow(/semantic/)
  })

  it("refuses a missing idempotency key", () => {
    expect(() => parseCommand(command({ idempotencyKey: "" }))).toThrow(/idempotencyKey/)
  })

  it("refuses a negative or fractional version", () => {
    expect(() => parseCommand(command({ expectedVersion: -1 }))).toThrow(/non-negative/)
    expect(() => parseCommand(command({ expectedVersion: 1.5 }))).toThrow(/non-negative/)
  })
})

describe("Query", () => {
  const query = (over: Record<string, unknown> = {}) => ({
    context: context(),
    resourceType: "Organization",
    cursor: null,
    limit: 50,
    sort: "createdAt:desc",
    ...over,
  })

  it("caps the page size centrally", () => {
    // The call site that forgets is the one that pages a million rows into
    // memory, so the cap lives here rather than at each one.
    expect(parseQuery(query({ limit: MAX_PAGE })).limit).toBe(MAX_PAGE)
    expect(() => parseQuery(query({ limit: MAX_PAGE + 1 }))).toThrow(/must not exceed/)
    expect(() => parseQuery(query({ limit: 0 }))).toThrow(/positive integer/)
  })

  it("requires a deterministic sort, because a cursor without one means nothing", () => {
    expect(() => parseQuery(query({ sort: "" }))).toThrow(/sort/)
  })
})

const event = (over: Record<string, unknown> = {}) => ({
  eventId: "evt-1",
  tenantId: "rochester",
  type: "ApprovalDecided",
  schemaVersion: 1,
  resourceType: "ApprovalRequest",
  resourceId: "ar-9",
  occurredAt: AT,
  correlationId: "corr-abc",
  causationId: "cmd-1",
  payload: {},
  ...over,
})

describe("DomainEvent", () => {
  it("insists the type is past tense", () => {
    expect(parseDomainEvent(event()).type).toBe("ApprovalDecided")
    expect(parseDomainEvent(event({ type: "TenantReconciled" })).type).toBe("TenantReconciled")
    expect(() => parseDomainEvent(event({ type: "DecideApproval" }))).toThrow(/past tense/)
  })

  it("requires a schema version", () => {
    // A consumer that cannot tell which shape it received cannot refuse one it
    // does not understand.
    expect(() => parseDomainEvent(event({ schemaVersion: 0 }))).toThrow(/positive integer/)
    const { schemaVersion, ...without } = event()
    expect(() => parseDomainEvent(without)).toThrow(/schemaVersion/)
  })

  it("allows a null causation for an event no command caused", () => {
    expect(parseDomainEvent(event({ causationId: null })).causationId).toBeNull()
  })
})

describe("OutboxRecord", () => {
  const record = (over: Record<string, unknown> = {}) => ({
    outboxId: "ob-1",
    event: event(),
    state: "pending",
    attempts: 0,
    lastError: null,
    availableAt: AT,
    deadLetteredAt: null,
    ...over,
  })

  it("refuses a dead record that does not say when it died", () => {
    expect(() => parseOutboxRecord(record({ state: "dead" }))).toThrow(/must say when it died/)
    expect(parseOutboxRecord(record({ state: "dead", deadLetteredAt: AT })).state).toBe("dead")
  })

  it("refuses an unknown state and a negative attempt count", () => {
    expect(() => parseOutboxRecord(record({ state: "maybe" }))).toThrow(/must be one of/)
    expect(() => parseOutboxRecord(record({ attempts: -1 }))).toThrow(/non-negative/)
  })

  it("validates the event it carries", () => {
    expect(() => parseOutboxRecord(record({ event: event({ type: "DoThing" }) }))).toThrow(/past tense/)
  })
})

describe("ContractError", () => {
  const err = (over: Record<string, unknown> = {}) => ({
    kind: "conflict",
    code: "version-mismatch",
    safeDetail: "This record changed while you were editing it.",
    retryable: false,
    correlationId: "corr-abc",
    ...over,
  })

  it("requires retryable rather than letting a caller guess", () => {
    const { retryable, ...without } = err()
    expect(() => parseContractError(without)).toThrow(/will guess wrong/)
  })

  it("refuses to mark a permanent failure retryable", () => {
    // A client told to retry a validation error retries forever.
    for (const kind of ["validation", "not-found", "forbidden", "precondition"]) {
      expect(() => parseContractError(err({ kind, retryable: true }))).toThrow(
        /cannot become correct by being retried/,
      )
    }
    expect(parseContractError(err({ kind: "unavailable", retryable: true })).retryable).toBe(true)
  })
})

describe("JobRequest", () => {
  const job = (over: Record<string, unknown> = {}) => ({
    jobId: "job-1",
    name: "deliverable-reminders",
    tenantId: null,
    idempotencyKey: "idem-job-1",
    scheduledFor: AT,
    attempt: 1,
    maxAttempts: 3,
    payload: {},
    ...over,
  })

  it("allows a null tenant for work that legitimately spans them", () => {
    // The reminder sweep runs once per institution; something has to schedule
    // it. Making that explicit beats every job carrying a fake tenant id.
    expect(parseJobRequest(job()).tenantId).toBeNull()
  })

  it("refuses an attempt beyond its own limit", () => {
    expect(() => parseJobRequest(job({ attempt: 4, maxAttempts: 3 }))).toThrow(/already be dead/)
  })
})

describe("IdempotencyRecord", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    key: "idem-1",
    tenantId: "rochester",
    requestDigest: "sha-aaa",
    status: "succeeded",
    resultRef: "approval:ar-9",
    expiresAt: AT,
    ...over,
  })

  it("refuses a succeeded record with nothing to point at", () => {
    expect(() => parseIdempotencyRecord(rec({ resultRef: null }))).toThrow(/must reference what it produced/)
  })

  it("refuses to replay a key that was used for a different request", () => {
    // Without this, a client reusing a key for a DIFFERENT request receives the
    // first request's result and believes the second succeeded.
    const parsed = parseIdempotencyRecord(rec())
    expect(replayable(parsed, "sha-aaa")).toBe(true)
    expect(() => replayable(parsed, "sha-bbb")).toThrow(/something untrue/)
  })

  it("does not replay a record that has not succeeded", () => {
    const inFlight = parseIdempotencyRecord(rec({ status: "in-flight", resultRef: null }))
    expect(replayable(inFlight, "sha-aaa")).toBe(false)
  })
})

describe("Permissions", () => {
  const check = (over: Record<string, unknown> = {}) => ({
    context: context(),
    permission: "budgeting.viewReports",
    resourceType: "Organization",
    resourceId: "org-1",
    ...over,
  })

  it("requires module-namespaced permissions", () => {
    // `<module>.<action>` is what makes module gating real: a permission
    // belonging to a disabled module is denied outright.
    expect(parsePermissionCheck(check()).permission).toBe("budgeting.viewReports")
    expect(() => parsePermissionCheck(check({ permission: "viewReports" }))).toThrow(/<module>\.<action>/)
  })

  it("accepts the three-segment keys the permission catalog actually ships", () => {
    // The rule was two segments exactly, and every key this platform defines
    // has three — `search.index.query`, `finance.budget.read`. A contract no
    // real value can satisfy is not strict, it is unused, and that is precisely
    // why nothing produced a PermissionCheck until PACK-010-001.
    for (const permission of [
      "search.index.query",
      "finance.budget.read",
      "approvals.request.decide",
    ]) {
      expect(parsePermissionCheck(check({ permission })).permission).toBe(permission)
    }
    // Still refused: a trailing dot names no action, and a bare word names no
    // module, which is the property the rule exists for.
    expect(() => parsePermissionCheck(check({ permission: "finance." }))).toThrow(/<module>\.<action>/)
  })

  it("refuses a denial with no reason", () => {
    expect(() =>
      parsePermissionDecision({ allowed: false, reason: null, policyRevision: "p-1" }),
    ).toThrow(/must say why/)
    expect(
      parsePermissionDecision({ allowed: false, reason: "no active seat", policyRevision: "p-1" }).reason,
    ).toBe("no active seat")
  })

  it("allows an allow with no reason", () => {
    expect(parsePermissionDecision({ allowed: true, reason: null, policyRevision: "p-1" }).allowed).toBe(true)
  })
})

describe("FileRef", () => {
  const file = (over: Record<string, unknown> = {}) => ({
    fileId: "file-1",
    tenantId: "rochester",
    objectKey: "rochester/org-1/deck.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    checksum: "sha256:abc",
    ...over,
  })

  it("refuses a key that could address another tenant's object", () => {
    // The whole failure mode of shared storage.
    expect(() => parseFileRef(file({ objectKey: "other-tenant/secret.pdf" }))).toThrow(
      /must begin with the tenant id/,
    )
    expect(parseFileRef(file()).objectKey).toBe("rochester/org-1/deck.pdf")
  })
})

describe("AuditEntry", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    tenantId: "rochester",
    actorId: "user-123",
    action: "Approval.Decide",
    resourceType: "ApprovalRequest",
    resourceId: "ar-9",
    outcome: "ALLOW",
    reason: null,
    occurredAt: AT,
    correlationId: "corr-abc",
    ...over,
  })

  it("refuses a DENY with no reason", () => {
    expect(() => parseAuditEntry(entry({ outcome: "DENY" }))).toThrow(/cannot answer why/)
    expect(parseAuditEntry(entry({ outcome: "DENY", reason: "capability not held" })).outcome).toBe("DENY")
  })
})

describe("ToolRegistration", () => {
  const tool = (over: Record<string, unknown> = {}) => ({
    toolKey: "search.documents",
    module: "search",
    description: "Search documents the requesting principal can already see.",
    requiredPermission: "search.query",
    readOnly: true,
    reauthorizesPerCall: false,
    ...over,
  })

  it("requires a permission, because a tool without one is an exfiltration path", () => {
    expect(() => parseToolRegistration(tool({ requiredPermission: "" }))).toThrow(/requiredPermission/)
    expect(() => parseToolRegistration(tool({ requiredPermission: "anything" }))).toThrow(/<module>\.<action>/)
  })

  it("refuses a writing tool that does not recheck per call", () => {
    // The permission may have been revoked since the session began.
    expect(() =>
      parseToolRegistration(tool({ readOnly: false, reauthorizesPerCall: false })),
    ).toThrow(/may have been revoked/)
    expect(
      parseToolRegistration(tool({ readOnly: false, reauthorizesPerCall: true })).readOnly,
    ).toBe(false)
  })

  it("refuses a description too thin to choose by", () => {
    // An assistant selects tools by reading their descriptions.
    expect(() => parseToolRegistration(tool({ description: "searches" }))).toThrow(/actually describe/)
  })
})

describe("ProcessChain", () => {
  const chain = (over: Record<string, unknown> = {}) => ({
    chainId: "request-to-approval-to-memory",
    name: "Request → approval → memory",
    steps: [
      { module: "approvals", consumes: null, emits: "ApprovalRequested" },
      { module: "approvals", consumes: "ApprovalRequested", emits: "ApprovalDecided" },
      { module: "memory", consumes: "ApprovalDecided", emits: null },
    ],
    ...over,
  })

  it("accepts a chain whose steps join", () => {
    expect(parseProcessChain(chain()).steps).toHaveLength(3)
  })

  it("refuses a chain that does not join, which is the whole reason it exists", () => {
    // A step waiting on an event the step before it never emits is a process
    // that stops halfway with no error anywhere, and it is spelled identically
    // to one that works.
    expect(() =>
      parseProcessChain(
        chain({
          steps: [
            { module: "approvals", consumes: null, emits: "ApprovalRequested" },
            { module: "memory", consumes: "ApprovalDecided", emits: null },
          ],
        }),
      ),
    ).toThrow(/does not join here/)
  })

  it("refuses a middle step that hands nothing on", () => {
    expect(() =>
      parseProcessChain(
        chain({
          steps: [
            { module: "approvals", consumes: null, emits: null },
            { module: "memory", consumes: null, emits: null },
          ],
        }),
      ),
    ).toThrow(/only the last step may emit nothing/)
  })

  it("refuses a chain declared from its middle", () => {
    expect(() =>
      parseProcessChain(
        chain({
          steps: [
            { module: "approvals", consumes: "SomethingHappened", emits: "ApprovalDecided" },
            { module: "memory", consumes: "ApprovalDecided", emits: null },
          ],
        }),
      ),
    ).toThrow(/consumes nothing/)
  })

  it("holds event names to the same spelling DomainEvent does", () => {
    // Otherwise a chain can declare a step waiting on `DecideApproval` while
    // the emitter publishes `ApprovalDecided`, and neither side notices.
    expect(() =>
      parseProcessChain(
        chain({
          steps: [
            { module: "approvals", consumes: null, emits: "DecideApproval" },
            { module: "memory", consumes: "DecideApproval", emits: null },
          ],
        }),
      ),
    ).toThrow(/past-tense event type/)
  })

  it("refuses a one-step chain", () => {
    expect(() =>
      parseProcessChain(chain({ steps: [{ module: "approvals", consumes: null, emits: null }] })),
    ).toThrow(/at least two steps/)
  })
})

describe("every contract, uniformly", () => {
  const parsers = [
    parseTenantContext, parseCommand, parseQuery, parseDomainEvent, parseOutboxRecord,
    parseContractError, parseJobRequest, parseIdempotencyRecord, parsePermissionCheck,
    parsePermissionDecision, parseFileRef, parseConfigSnapshot, parseAuditEntry,
    parseToolRegistration, parseProcessChain,
  ]

  it("declares one parser per contract", () => {
    expect(parsers).toHaveLength(CONTRACTS.length)
  })

  it("refuses a non-object", () => {
    for (const parse of parsers) {
      for (const junk of [null, undefined, 42, "a string", []]) {
        expect(() => parse(junk as never)).toThrow(ContractViolation)
      }
    }
  })

  it("never echoes the value it rejected", () => {
    // A violation is written to a log that outlives the request, and these
    // carry tenant data. The message names the field and the problem, never
    // the content.
    const SECRET = "sk-live-donotlogthis-9f3b2a"

    const attempts: Array<() => unknown> = [
      () => parseTenantContext(context({ actorKind: SECRET })),
      () => parseCommand(command({ action: SECRET })),
      () => parseFileRef({ fileId: "f", tenantId: "t", objectKey: SECRET, mimeType: "text/plain", sizeBytes: 1, checksum: "c" }),
      // requiredPermission, not description: a 26-character secret is long
      // enough to satisfy the description-length rule, so that attempt never
      // threw and the assertion below passed on an empty message. The leak test
      // caught a flaw in itself, which is the correct outcome for a test whose
      // failure mode is a false pass.
      () => parseToolRegistration({ toolKey: "k", module: "m", description: "A tool that does a thing usefully.", requiredPermission: SECRET, readOnly: true, reauthorizesPerCall: false }),
      () => parseContractError({ kind: SECRET, code: "c", safeDetail: "d", retryable: false, correlationId: "x" }),
    ]

    for (const attempt of attempts) {
      let message = ""
      try {
        attempt()
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }
      expect(message).not.toBe("")
      expect(message).not.toContain(SECRET)
    }
  })
})
