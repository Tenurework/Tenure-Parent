/**
 * The command bus, tested on the paths where writes go wrong.
 *
 * Every interesting case is a race or a stale assumption: two retries arriving
 * together, a seat revoked between render and click, a version that moved while
 * someone was typing. Those are unreachable through a fixture and trivial
 * through injected ports, which is why the ports exist.
 */
import { describe, expect, it, jest } from "@jest/globals"

import type {
  Command,
  ConfigSnapshot,
  IdempotencyRecord,
  PaymentMode,
  TenantContext,
} from "@tenure/contracts"

import { dispatch, type CommandPorts, type Handler } from "./bus"

const AT = "2026-08-01T12:00:00.000Z"

const context: TenantContext = {
  tenantId: "t-roch",
  actorId: "user-1",
  actorKind: "user",
  channel: "web",
  correlationId: "corr-1",
  configRevision: "cfg-7",
  environment: "test",
  legalEntityId: null,
  at: AT,
}

/** The same context in the other money-mode, naming that mode's own revision. */
const liveContext: TenantContext = {
  ...context,
  environment: "live",
  configRevision: "cfg-live-7",
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

/**
 * The two configurations this tenant has, one per money-mode.
 *
 * Behaves like the real resolver rather than echoing whatever the command
 * claims: `configSnapshotForInstitution` resolves ONE configuration for a
 * tenant, stamped with the mode that tenant's `platform.payments.mode`
 * published. A stand-in that returned `{ environment: context.environment }`
 * would agree with every command by construction and prove nothing — it would
 * be the fake test the mismatch check exists to make impossible.
 *
 * So this tenant is genuinely in ONE mode at a time, and the port answers with
 * that mode's snapshot whatever the command says.
 */
const SNAPSHOTS: Record<PaymentMode, ConfigSnapshot> = {
  test: {
    tenantId: "t-roch",
    revision: "cfg-7",
    checksum: "sha256:test-mode",
    environment: "test",
    values: {},
  },
  live: {
    tenantId: "t-roch",
    revision: "cfg-live-7",
    checksum: "sha256:live-mode",
    environment: "live",
    values: {},
  },
}

/** Which mode the tenant the ports stand in for is actually in. */
function portsForTenantIn(mode: PaymentMode, over: Partial<CommandPorts> = {}): CommandPorts {
  return {
    claimIdempotency: async () => ({ claimed: true }),
    completeIdempotency: async () => {},
    releaseIdempotency: async () => {},
    configuration: async () => SNAPSHOTS[mode],
    authorize: async () => ({ allowed: true, reason: null }),
    currentVersion: async () => 3,
    ...over,
  }
}

function ports(over: Partial<CommandPorts> = {}): CommandPorts {
  return portsForTenantIn("test", over)
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

/**
 * PAY-020-003 / PAY-000-007 — test and live are separated by something.
 *
 * The tenant these ports stand in for is in exactly one mode at a time and its
 * configuration says so. A command declaring the other mode is refused before
 * anything happens, which is the whole of the separation: without it both
 * commands are well-formed, both parse, both authorize, and the only difference
 * between "approved a $40,000 spend in a sandbox" and "approved it for real" is
 * a word nothing compares.
 */
describe("money-mode separation", () => {
  it("refuses a test-mode command against a tenant whose configuration is live", async () => {
    const out = await dispatch(
      command(),
      handler,
      portsForTenantIn("live"),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("config.mode-mismatch")
    expect(!out.ok && out.error.kind).toBe("precondition")
    expect(!out.ok && out.error.retryable).toBe(false)
  })

  it("refuses a live-mode command against a tenant whose configuration is test", async () => {
    // The direction that matters most: a live command must not execute against
    // a tenant that is not live.
    const out = await dispatch(
      command({ context: liveContext }),
      handler,
      portsForTenantIn("test"),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("config.mode-mismatch")
  })

  it("does not run the handler, and does not burn the key, on a mismatch", async () => {
    // Not a request that happened: it is a refusal the caller can fix and
    // resend, so claiming the idempotency key would make the corrected command
    // a duplicate of one that never ran.
    const spy = jest.fn(handler)
    const claim = jest.fn(async () => ({ claimed: true as const }))
    await dispatch(
      command(),
      spy as Handler<string>,
      portsForTenantIn("live", {
        claimIdempotency: claim as unknown as CommandPorts["claimIdempotency"],
      }),
      { requestDigest: "digest-a" },
    )
    expect(spy).not.toHaveBeenCalled()
    expect(claim).not.toHaveBeenCalled()
  })

  it("lets a live command through when the tenant really is live", async () => {
    const out = await dispatch(
      command({ context: liveContext }),
      handler,
      portsForTenantIn("live"),
      { requestDigest: "digest-a" },
    )
    expect(out).toEqual({ ok: true, result: "decided", resultRef: "approval:ar-9", replayed: false })
  })

  it("refuses a command naming a configuration revision that is no longer live", async () => {
    // Same mode, stale revision: the configuration moved between the page being
    // prepared and the button being pressed, so the thresholds the request was
    // composed against are not the ones it would be decided against.
    const out = await dispatch(
      command({ context: { ...context, configRevision: "cfg-6" } }),
      handler,
      ports(),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("config.revision-stale")
  })

  it("refuses a command for a tenant with no resolvable configuration", async () => {
    const out = await dispatch(
      command(),
      handler,
      ports({ configuration: async () => null }),
      { requestDigest: "digest-a" },
    )
    expect(!out.ok && out.error.code).toBe("config.unresolved")
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

/**
 * WRK-040-005 — the log sink.
 *
 * This is the widest one in the application: an arbitrary handler failure over a
 * caller-supplied payload, so `err.message` is whatever the thrown thing chose
 * to say about data this process did not author. A provider client that throws
 * `Invalid API key: sk_live_…`, or a driver echoing a row containing a webhook
 * signing secret somebody pasted into a note field, puts a reusable credential
 * into CloudWatch — retained, widely readable, and outside every control the
 * vault exists to impose.
 *
 * Asserted on what `dispatch` EMITS, never by calling the scanner directly: a
 * test that proved the property against `redactSecretValues` would stay green
 * the day the bus stopped using it, which is the exact failure being guarded.
 */
describe("a handler's error text is scanned before it reaches the log", () => {
  const SIGNING_SECRET = "whsec_aaaaaaaaaa"
  const LIVE_KEY = "sk_live_aaaaaaaaaaaaaaaa"

  /** Every `console.error` the dispatch produced, flattened to one string. */
  async function logsFrom(thrown: unknown): Promise<string> {
    const lines: string[] = []
    const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
    })
    try {
      await dispatch(
        command(),
        async () => {
          throw thrown
        },
        ports(),
        { requestDigest: "digest-a" },
      )
    } finally {
      spy.mockRestore()
    }
    return lines.join("\n")
  }

  it("does not log a provider key an exception carried", async () => {
    const line = await logsFrom(new Error(`Invalid API key provided: ${LIVE_KEY}`))

    expect(line).not.toContain(LIVE_KEY)
    expect(line).toContain("[redacted: this text carried a reusable credential]")
    // Still says WHICH command failed. A redaction that took the action with it
    // would trade one incident for another.
    expect(line).toContain("Approval.Decide")
  })

  it("does not log a webhook signing secret echoed out of a payload", async () => {
    const line = await logsFrom(
      new Error(`column "endpoint" = ${SIGNING_SECRET} violates check constraint`),
    )
    expect(line).not.toContain(SIGNING_SECRET)
  })

  it("still logs an ordinary failure in full, so the redaction is not blanket", async () => {
    // The guard's value depends on it never firing on the ninety-nine ordinary
    // failures. A log that says nothing is a log nobody reads.
    const line = await logsFrom(new Error("database is on fire"))
    expect(line).toContain("database is on fire")
    expect(line).not.toContain("[redacted")
  })

  it("survives a thrown value that is not an Error at all", async () => {
    // `throw "…"` and `throw { … }` are both legal and both reach this branch.
    // An `Error`'s `message` is not an own enumerable property, so a redactor
    // that walked the object instead of flattening it first would print `{}`
    // here and lose every failure this platform has.
    expect(await logsFrom(`bare string with ${LIVE_KEY} in it`)).not.toContain(LIVE_KEY)
    expect(await logsFrom({ detail: `object field with ${SIGNING_SECRET}` })).not.toContain(
      SIGNING_SECRET,
    )
  })
})
