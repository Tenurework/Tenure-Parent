/**
 * The request context, tested for immutability and for what it refuses.
 *
 * The failure this exists to prevent is quiet: some middle layer "corrects" a
 * revision or a locale, and the audit row then records a decision against a
 * revision the decision did not use. Nothing detects it, and the incident
 * review reaches the wrong conclusion. So most of what follows is an attempt
 * to mutate a live context.
 */
import { describe, expect, it } from "@jest/globals"

import {
  RequestContextError,
  createRequestContext,
  currentContext,
  requireContext,
  runWithContext,
  withElevation,
  type RequestContext,
} from "./request-context"

const base = (over: Partial<RequestContext> = {}): RequestContext =>
  ({
    tenant: { tenantId: "t-roch", slug: "rochester", via: "path", cell: "us-east-1a" },
    actor: { principalId: "user-1", principalType: "user", assurance: "federated" },
    memberships: ["t-roch"],
    assignments: ["org-1:PRESIDENT"],
    configRevision: "cfg-7",
    policyRevision: "pol-3",
    correlationId: "corr-1",
    traceId: "trace-1",
    locale: "en-US",
    timeZone: "America/New_York",
    handles: { cell: "us-east-1a", database: "cell-a", objectPrefix: "t-roch/" },
    at: "2026-08-01T00:00:00.000Z",
    ...over,
  }) as RequestContext

describe("immutability", () => {
  it("refuses a top-level write", () => {
    const ctx = createRequestContext(base())
    expect(() => {
      // @ts-expect-error deliberately violating the type to test the runtime
      ctx.configRevision = "cfg-999"
    }).toThrow()
    expect(ctx.configRevision).toBe("cfg-7")
  })

  it("refuses a NESTED write", () => {
    // The one that matters. Object.freeze is shallow, so a top-level freeze
    // leaves actor.assurance and handles.database writable — exactly where a
    // "helpful" mutation lands, because nobody reassigns the whole context.
    const ctx = createRequestContext(base())

    expect(() => {
      // @ts-expect-error deliberately violating the type
      ctx.actor.assurance = "mfa"
    }).toThrow()
    expect(ctx.actor.assurance).toBe("federated")

    expect(() => {
      // @ts-expect-error deliberately violating the type
      ctx.handles.database = "someone-elses-cell"
    }).toThrow()
    expect(ctx.handles.database).toBe("cell-a")

    expect(() => {
      // @ts-expect-error deliberately violating the type
      ctx.tenant.tenantId = "t-other"
    }).toThrow()
    expect(ctx.tenant.tenantId).toBe("t-roch")
  })

  it("refuses a push onto memberships or assignments", () => {
    const ctx = createRequestContext(base())
    expect(() => (ctx.memberships as string[]).push("t-other")).toThrow()
    expect(() => (ctx.assignments as string[]).push("org-2:TREASURER")).toThrow()
    expect(ctx.memberships).toEqual(["t-roch"])
  })

  it("copies the arrays it was given, so the caller cannot mutate them afterwards", () => {
    // Freezing the array we were handed would freeze the caller's array too,
    // and not freezing it leaves a live reference into the context.
    const memberships = ["t-roch"]
    const ctx = createRequestContext(base({ memberships }))
    memberships.push("t-smuggled")
    expect(ctx.memberships).toEqual(["t-roch"])
  })
})

describe("refusing to be built wrong", () => {
  it("requires every field that makes a decision explainable", () => {
    for (const field of [
      "configRevision", "policyRevision", "correlationId", "traceId", "locale", "timeZone", "at",
    ] as const) {
      expect(() => createRequestContext(base({ [field]: "" } as never))).toThrow(
        new RegExp(`RequestContext\\.${field} is required`),
      )
    }
  })

  it("refuses a tenant the principal does not belong to", () => {
    // The resolver already proved this. Asserting it again means a context
    // built by any other path cannot skip the proof.
    expect(() => createRequestContext(base({ memberships: ["t-other"] }))).toThrow(
      /never proved/,
    )
  })

  it("refuses an object prefix that could address another tenant", () => {
    expect(() =>
      createRequestContext(
        base({ handles: { cell: "c", database: "d", objectPrefix: "t-other/" } }),
      ),
    ).toThrow(/must begin with the tenant id/)
  })
})

describe("ambient access", () => {
  it("is undefined outside a request and present inside one", () => {
    expect(currentContext()).toBeUndefined()
    const ctx = createRequestContext(base())
    runWithContext(ctx, () => {
      expect(currentContext()?.tenant.tenantId).toBe("t-roch")
    })
    expect(currentContext()).toBeUndefined()
  })

  it("survives an await boundary", async () => {
    // The property AsyncLocalStorage exists for, and the one a plain module
    // variable would silently lose under concurrency.
    const ctx = createRequestContext(base())
    await runWithContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(requireContext().correlationId).toBe("corr-1")
    })
  })

  it("keeps two concurrent requests apart", async () => {
    const a = createRequestContext(base({ correlationId: "corr-a" }))
    const b = createRequestContext(
      base({ correlationId: "corr-b", tenant: { tenantId: "t-mid", slug: "midtown", via: "path", cell: "c" }, memberships: ["t-mid"], handles: { cell: "c", database: "d", objectPrefix: "t-mid/" } }),
    )

    const seen: string[] = []
    await Promise.all([
      runWithContext(a, async () => {
        await new Promise((r) => setTimeout(r, 5))
        seen.push(requireContext().correlationId)
      }),
      runWithContext(b, async () => {
        seen.push(requireContext().correlationId)
      }),
    ])

    expect(seen.sort()).toEqual(["corr-a", "corr-b"])
  })

  it("throws rather than defaulting when there is no context", () => {
    // A default here is a decision recorded against a revision nobody chose.
    expect(() => requireContext()).toThrow(RequestContextError)
  })
})

describe("elevation", () => {
  it("produces a NEW context rather than editing the old one", () => {
    // Mutating would leave the audit trail unable to say when elevation began.
    const original = createRequestContext(base())
    const elevated = withElevation(original, {
      principalId: "staff-9",
      reason: "customer-reported export discrepancy",
      at: "2026-08-01T01:00:00.000Z",
    })

    expect(elevated).not.toBe(original)
    expect(original.actor.principalId).toBe("user-1")
    expect(original.actor.principalType).toBe("user")
    expect(elevated.actor.principalId).toBe("staff-9")
    expect(elevated.actor.principalType).toBe("support")
  })

  it("requires a reason", () => {
    const original = createRequestContext(base())
    expect(() =>
      withElevation(original, { principalId: "staff-9", reason: "  ", at: "2026-08-01T01:00:00.000Z" }),
    ).toThrow(/An elevation nobody can explain/)
  })

  it("does not raise assurance", () => {
    // Acting as support does not make the engineer's own sign-in stronger.
    const original = createRequestContext(base({ actor: { principalId: "u", principalType: "user", assurance: "password" } }))
    const elevated = withElevation(original, {
      principalId: "staff-9",
      reason: "diagnostic read",
      at: "2026-08-01T01:00:00.000Z",
    })
    expect(elevated.actor.assurance).toBe("password")
  })

  it("keeps the correlation id, so the elevation is on the same thread", () => {
    const original = createRequestContext(base())
    const elevated = withElevation(original, {
      principalId: "staff-9",
      reason: "diagnostic read",
      at: "2026-08-01T01:00:00.000Z",
    })
    expect(elevated.correlationId).toBe(original.correlationId)
  })

  it("is itself immutable", () => {
    const elevated = withElevation(createRequestContext(base()), {
      principalId: "staff-9",
      reason: "diagnostic read",
      at: "2026-08-01T01:00:00.000Z",
    })
    expect(() => {
      // @ts-expect-error deliberately violating the type
      elevated.actor.principalType = "user"
    }).toThrow()
  })
})
