/**
 * The command bus, tested on the paths where writes go wrong.
 *
 * Every interesting case is a race or a stale assumption: two retries arriving
 * together, a seat revoked between render and click, a version that moved while
 * someone was typing. Those are unreachable through a fixture and trivial
 * through injected ports, which is why the ports exist.
 */
import { describe, expect, it, jest } from "@jest/globals"

import type { Command, IdempotencyRecord, TenantContext } from "@tenure/contracts"

import { dispatch, type CommandPorts, type Handler } from "./bus"

const AT = "2026-08-01T12:00:00.000Z"

const context: TenantContext = {
  tenantId: "t-roch",
  actorId: "user-1",
  actorKind: "user",
  channel: "web",
  correlationId: "corr-1",
  configRevision: "cfg-7",
  at: AT,
}

const command = (over: Partial<Command> = {}) => ({
  commandId: "cmd-1",
  context,
  action: "Approval.Decide",
  resourceType: "ApprovalRequest",
  resourceId: "ar-9",
  expectedVersion: 3,
  idempotencyKey: "idem-1",
  effectiveAt: AT,
  payload: { decision: "APPROVE" },
  ...over,
})

const record = (over: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
  key: "idem-1",
  tenantId: "t-roch",
  requestDigest: "digest-a",
  status: "succeeded",
  resultRef: "approval:ar-9",
  expiresAt: AT,
  ...over,
})

function ports(over: Partial<CommandPorts> = {}): CommandPorts {
  return {
    claimIdempotency: async () => ({ claimed: true }),
    completeIdempotency: async () => {},
    releaseIdempotency: async () => {},
    authorize: async () => ({ allowed: true, reason: null }),
    currentVersion: async () => 3,
    ...over,
  }
}

const handler: Handler<string> = async () => ({ result: "decided", resultRef: "approval:ar-9" })

describe("the happy path", () => {
  it("parses, authorizes, checks the version, and runs the handler", async () => {
    const out = await dispatch(command(), handler, ports(), { requestDigest: "digest-a" })
    expect(out).toEqual({ ok: true, result: "decided", resultRef: "approval:ar-9", replayed: false })
  })
})

describe("parsing", () => {
  it("refuses a command that does not parse, without a correlation id it does not have", async () => {
    const out = await dispatch({ nonsense: true }, handler, ports(), { requestDigest: "d" })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error.kind).toBe("validation")
    expect(!out.ok && out.error.correlationId).toBe("unknown")
  })

  it("does not run the handler for an unparseable command", async () => {
    const spy = jest.fn(handler)
    await dispatch({ nonsense: true }, spy as Handler<string>, ports(), { requestDigest: "d" })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("idempotency", () => {
  it("claims the key BEFORE running the handler", async () => {
    // Claiming after the work means two concurrent retries both do the work and
    // one loses the race to record it — the work having already happened twice.
    const order: string[] = []
    const spy: Handler<string> = async () => {
      order.push("handler")
      return { result: "x", resultRef: "r" }
    }
    await dispatch(
      command(),
      spy,
      ports({
        claimIdempotency: async () => {
          order.push("claim")
          return { claimed: true }
        },
      }),
      { requestDigest: "digest-a" },
    )
    expect(order).toEqual(["claim", "handler"])
  })

  it("replays the stored result instead of running again", async () => {
    const spy = jest.fn(handler)
    const out = await dispatch(
      command(),
      spy as Handler<string>,
      ports({ claimIdempotency: async () => ({ claimed: false, existing: record() }) }),
      { requestDigest: "digest-a" },
    )
    expect(out).toMatchObject({ ok: true, resultRef: "approval:ar-9", replayed: true })
    expect(spy).not.toHaveBeenCalled()
  })

  it("refuses a key reused for a different request", async () => {
    // Returning the earlier result would tell the caller something untrue about
    // a request that never ran.
    const out = await dispatch(
      command(),
      handler,
      ports({ claimIdempotency: async () => ({ claimed: false, existing: record() }) }),
      { requestDigest: "digest-DIFFERENT" },
    )
    expect(!out.ok && out.error.code).toBe("idempotency.key-reused")
    expect(!out.ok && out.error.kind).toBe("conflict")
  })

  it("reports an in-flight duplicate as retryable", async () => {
    // The in-flight one will finish and the replay will then succeed, so
    // retrying is exactly the right advice.
    const out = await dispatch(
      command(),
      handler,
      ports({
        claimIdempotency: async () => ({
          claimed: false,
          existing: record({ status: "in-flight", resultRef: null }),
        }),
      }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("idempotency.in-flight")
    expect(!out.ok && out.error.retryable).toBe(true)
  })

  it("releases the key when the handler throws", async () => {
    // A key stuck in-flight makes the operation permanently unretryable, which
    // is worse than the original failure.
    const release = jest.fn(async () => {})
    const out = await dispatch(
      command(),
      async () => {
        throw new Error("database is on fire")
      },
      ports({ releaseIdempotency: release as CommandPorts["releaseIdempotency"] }),
      { requestDigest: "digest-a" },
    )
    expect(release).toHaveBeenCalledWith("idem-1", "t-roch")
    expect(!out.ok && out.error.kind).toBe("internal")
  })

  it("does not leak the handler's error message to the caller", async () => {
    // It may name a row, a column or another tenant, and this string is
    // rendered to a user.
    const out = await dispatch(
      command(),
      async () => {
        throw new Error("column tenant_secret does not exist on midtown_arts")
      },
      ports(),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.safeDetail).not.toContain("midtown_arts")
    expect(!out.ok && out.error.safeDetail).not.toContain("tenant_secret")
  })
})

describe("authorization at execution time", () => {
  it("rechecks and refuses, releasing the key", async () => {
    // A page rendered a minute ago; the seat may be gone. Checking at render
    // answers a question that was true then.
    const release = jest.fn(async () => {})
    const out = await dispatch(
      command(),
      handler,
      ports({
        authorize: async () => ({ allowed: false, reason: "seat revoked" }),
        releaseIdempotency: release as CommandPorts["releaseIdempotency"],
      }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.kind).toBe("forbidden")
    expect(!out.ok && out.error.safeDetail).toBe("seat revoked")
    expect(release).toHaveBeenCalled()
  })

  it("authorizes before touching the version", async () => {
    // Someone who may not act on a resource should not learn whether it exists.
    const order: string[] = []
    await dispatch(
      command(),
      handler,
      ports({
        authorize: async () => {
          order.push("authorize")
          return { allowed: false, reason: "no" }
        },
        currentVersion: async () => {
          order.push("version")
          return 3
        },
      }),
      { requestDigest: "digest-a" },
    )
    expect(order).toEqual(["authorize"])
  })

  it("does not run the handler when denied", async () => {
    const spy = jest.fn(handler)
    await dispatch(
      command(),
      spy as Handler<string>,
      ports({ authorize: async () => ({ allowed: false, reason: "no" }) }),
      { requestDigest: "digest-a" },
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("optimistic concurrency", () => {
  it("refuses a stale version with advice a person can act on", async () => {
    const out = await dispatch(
      command({ expectedVersion: 3 }),
      handler,
      ports({ currentVersion: async () => 5 }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("concurrency.version-mismatch")
    expect(!out.ok && out.error.safeDetail).toMatch(/Reload and try again/)
  })

  it("refuses a create when the target already exists", async () => {
    // Otherwise two people creating the same thing both succeed and one
    // silently overwrites.
    const out = await dispatch(
      command({ expectedVersion: null }),
      handler,
      ports({ currentVersion: async () => 1 }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("concurrency.already-exists")
  })

  it("allows a create when the target does not exist", async () => {
    const out = await dispatch(
      command({ expectedVersion: null }),
      handler,
      ports({ currentVersion: async () => null }),
      { requestDigest: "digest-a" },
    )
    expect(out.ok).toBe(true)
  })

  it("refuses an update to something that no longer exists", async () => {
    const out = await dispatch(
      command({ expectedVersion: 3 }),
      handler,
      ports({ currentVersion: async () => null }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.kind).toBe("not-found")
  })

  it("records the result only after the handler succeeds", async () => {
    const complete = jest.fn(async () => {})
    await dispatch(
      command(),
      handler,
      ports({ completeIdempotency: complete as CommandPorts["completeIdempotency"] }),
      { requestDigest: "digest-a" },
    )
    expect(complete).toHaveBeenCalledWith("idem-1", "t-roch", "approval:ar-9")

    complete.mockClear()
    await dispatch(
      command(),
      async () => {
        throw new Error("no")
      },
      ports({ completeIdempotency: complete as CommandPorts["completeIdempotency"] }),
      { requestDigest: "digest-a" },
    )
    expect(complete).not.toHaveBeenCalled()
  })
})
