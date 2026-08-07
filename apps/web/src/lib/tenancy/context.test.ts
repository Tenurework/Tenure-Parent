import {
  isNextControlFlowError,
  isNextNavigationThrow,
  isTenantPurpose,
  runInTenantScope,
  runUnscoped,
  currentEnvironment,
  currentScope,
  currentUnscopedGrant,
  hasNoContext,
  requireTenantScope,
  TENANT_PURPOSES,
  TenantContextError,
  type TenantScope,
} from "./context"

/**
 * A `redirect()` throw, fabricated.
 *
 * Next.js is not running here and does not need to be: `redirect()`'s entire
 * contract with anything outside the framework is an Error carrying a `digest`
 * beginning `NEXT_REDIRECT` (`next/dist/client/components/redirect-error.js`,
 * `REDIRECT_ERROR_CODE`). Building one directly is what makes the guard
 * provable in a unit run — a test that needed a live request would only ever
 * run in e2e, which is exactly where this defect was invisible.
 */
function nextRedirect(to = "/messages/abc"): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;replace;${to};307;`,
  })
}

const TENANT_A: TenantScope = {
  institutionId: "inst_a",
  environment: "live",
  purpose: "interactive",
  actor: { principalId: "user_1", principalType: "user" },
}
const TENANT_B: TenantScope = {
  institutionId: "inst_b",
  environment: "test",
  purpose: "interactive",
  actor: { principalId: "user_2", principalType: "user" },
}

describe("tenant scope", () => {
  it("is absent by default", () => {
    expect(currentScope()).toBeUndefined()
    expect(hasNoContext()).toBe(true)
  })

  it("is visible inside the block", () => {
    runInTenantScope(TENANT_A, () => {
      expect(currentScope()?.institutionId).toBe("inst_a")
      expect(hasNoContext()).toBe(false)
    })
  })

  it("does not leak out of the block", () => {
    runInTenantScope(TENANT_A, () => currentScope())
    expect(currentScope()).toBeUndefined()
  })

  it("refuses an empty institutionId", () => {
    // Otherwise the query layer would build `where: { institutionId: "" }`,
    // which matches nothing and reads as a working filter.
    expect(() => runInTenantScope({ ...TENANT_A, institutionId: "" }, () => null)).toThrow(
      TenantContextError,
    )
  })

  // PAY-020-003. The mode is checked at runtime rather than trusted from the
  // type: a scope is assembled from values that crossed a boundary — a resolved
  // configuration, a job envelope — and `tsc` cannot see a field that arrived
  // missing. Defaulting here would mean a block of work running in a mode
  // nobody published, with every audit row it writes saying so.
  it("refuses a scope with no money-mode, or one it does not recognise", () => {
    for (const bad of [undefined, null, "", "prod", "production", "TEST", true]) {
      expect(() =>
        runInTenantScope(
          { ...TENANT_A, environment: bad as never },
          () => null,
        ),
      ).toThrow(TenantContextError)
    }
    // Named in the message, so whoever wired the caller knows which field.
    expect(() =>
      runInTenantScope({ ...TENANT_A, environment: undefined as never }, () => null),
    ).toThrow(/environment/)
  })

  it("carries the money-mode into the block", () => {
    expect(runInTenantScope(TENANT_A, () => currentScope()?.environment)).toBe("live")
    expect(runInTenantScope(TENANT_B, () => currentScope()?.environment)).toBe("test")
    expect(runInTenantScope(TENANT_A, () => currentEnvironment())).toBe("live")
    expect(currentEnvironment()).toBeUndefined()
  })

  it("nests, with the inner scope winning", () => {
    runInTenantScope(TENANT_A, () => {
      runInTenantScope(TENANT_B, () => {
        expect(currentScope()?.institutionId).toBe("inst_b")
      })
      expect(currentScope()?.institutionId).toBe("inst_a")
    })
  })

  // The property the whole design rests on: two operations running
  // concurrently must not see each other's tenant.
  it("keeps concurrent operations separate", async () => {
    const seen: string[] = []

    const work = (scope: TenantScope, delayMs: number) =>
      runInTenantScope(scope, async () => {
        await new Promise((r) => setTimeout(r, delayMs))
        seen.push(`${scope.institutionId}:${currentScope()?.institutionId}`)
      })

    // B finishes first despite starting second — if the context were shared
    // state rather than per-async-chain, A would report B's tenant.
    await Promise.all([work(TENANT_A, 20), work(TENANT_B, 1)])

    expect(seen.sort()).toEqual(["inst_a:inst_a", "inst_b:inst_b"])
  })

  it("survives an await inside the block", async () => {
    await runInTenantScope(TENANT_A, async () => {
      await new Promise((r) => setTimeout(r, 5))
      expect(currentScope()?.institutionId).toBe("inst_a")
    })
  })

  it("carries the actor", () => {
    runInTenantScope(TENANT_A, () => {
      expect(currentScope()?.actor).toEqual({ principalId: "user_1", principalType: "user" })
    })
  })

  it("carries the purpose", () => {
    runInTenantScope({ ...TENANT_A, purpose: "model-exposure" }, () => {
      expect(currentScope()?.purpose).toBe("model-exposure")
    })
  })
})

// ── WRK-070-002: the scope states what it is for ─────────────────────────────

describe("purpose", () => {
  it("refuses a scope with no purpose", () => {
    // Required on the type, and checked anyway: `tsc` cannot see a field that
    // arrived missing across a boundary — a job envelope, a resolved
    // configuration. The cast is the subject of the test, not a shortcut in it.
    const noPurpose = { ...TENANT_A } as { purpose?: unknown }
    delete noPurpose.purpose

    expect(() => runInTenantScope(noPurpose as TenantScope, () => null)).toThrow(TenantContextError)
    expect(() => runInTenantScope(noPurpose as TenantScope, () => null)).toThrow(/without a purpose/)
  })

  it("refuses a purpose outside the closed set", () => {
    for (const bad of ["analytics", "", "Interactive", 7, null]) {
      expect(() =>
        runInTenantScope({ ...TENANT_A, purpose: bad as never }, () => null),
      ).toThrow(TenantContextError)
    }
  })

  it("names every legal purpose in the refusal, so the fix is in the message", () => {
    for (const p of TENANT_PURPOSES) {
      expect(() =>
        runInTenantScope({ ...TENANT_A, purpose: "analytics" as never }, () => null),
      ).toThrow(new RegExp(p))
    }
  })

  it("narrows an unvalidated value", () => {
    expect(isTenantPurpose("model-exposure")).toBe(true)
    expect(isTenantPurpose("analytics")).toBe(false)
    expect(isTenantPurpose(undefined)).toBe(false)
  })
})

// ── WRK-P1-16: a redirect must not escape a tenant scope ─────────────────────

describe("a redirect escaping the scope", () => {
  it("recognises the digest Next.js throws", () => {
    expect(isNextControlFlowError(nextRedirect())).toBe(true)
    expect(isNextControlFlowError(new Error("boom"))).toBe(false)
    expect(isNextControlFlowError({ digest: 12345 })).toBe(false)
    expect(isNextControlFlowError(null)).toBe(false)
    // notFound() is deliberately allowed through: it throws too, but only from
    // page reads with no write in flight, and rejecting it would turn a 404
    // into a 500.
    expect(
      isNextControlFlowError(
        Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK"), {
          digest: "NEXT_HTTP_ERROR_FALLBACK;404",
        }),
      ),
    ).toBe(false)
  })

  it("is refused when the body throws it synchronously", () => {
    expect(() =>
      runInTenantScope(TENANT_A, () => {
        throw nextRedirect()
      }),
    ).toThrow(TenantContextError)
  })

  it("is refused when an async body rejects with it", async () => {
    // The case that matters. Every server action in this application is async,
    // so a guard that caught only the synchronous throw would catch none of
    // them.
    await expect(
      runInTenantScope(TENANT_A, async () => {
        await new Promise((r) => setTimeout(r, 1))
        throw nextRedirect("/calendar/evt_1")
      }),
    ).rejects.toThrow(TenantContextError)
  })

  it("names the tenant and purpose, and says what to do instead", async () => {
    await expect(
      runInTenantScope({ ...TENANT_A, purpose: "job" }, async () => {
        throw nextRedirect()
      }),
    ).rejects.toThrow(/inst_a \(purpose: job\)/)
    await expect(
      runInTenantScope(TENANT_A, async () => {
        throw nextRedirect()
      }),
    ).rejects.toThrow(/Return from the scope and redirect after it/)
  })

  it("leaves every other error exactly as it was", async () => {
    // The guard must not swallow or reshape a real failure — a rewritten stack
    // is a debugging session nobody can finish.
    const boom = new Error("the database is on fire")
    await expect(
      runInTenantScope(TENANT_A, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(() =>
      runInTenantScope(TENANT_A, () => {
        throw boom
      }),
    ).toThrow(boom)
  })

  it("passes a successful value through untouched", async () => {
    // Guards the guard. Wrapping the body in a rejection handler must not change
    // what a body that does not throw returns, or every assertion above would be
    // about a code path nothing reaches.
    expect(runInTenantScope(TENANT_A, () => 42)).toBe(42)
    await expect(runInTenantScope(TENANT_A, async () => "ok")).resolves.toBe("ok")
    // And the scope is still live at the moment a lazy thenable settles, which
    // is what `settleInsideContext` exists for.
    await expect(
      runInTenantScope(TENANT_A, () => ({
        then: (resolve: (v: string) => void) => resolve(currentScope()?.institutionId ?? "none"),
      })) as unknown as Promise<string>,
    ).resolves.toBe("inst_a")
  })

  it("still lets a redirect thrown OUTSIDE the scope reach Next.js", async () => {
    // The whole point of the rule is that this shape works: the scope returns
    // the id, the action redirects after it, and the error arrives at the
    // framework with its digest intact.
    const id = await runInTenantScope(TENANT_A, async () => "convo_1")
    let caught: unknown
    try {
      throw nextRedirect(`/messages/${id}`)
    } catch (err) {
      caught = err
    }
    expect(isNextControlFlowError(caught)).toBe(true)
    expect((caught as { digest: string }).digest).toBe(
      "NEXT_REDIRECT;replace;/messages/convo_1;307;",
    )
  })
})

/**
 * The transaction boundary is stricter than the scope boundary, on purpose.
 *
 * These two predicates disagree about exactly one input — `notFound()` — and
 * that disagreement is the whole design: a page read may raise a 404 inside a
 * tenant scope with nothing in flight, and the same throw inside
 * `db.$transaction` rolls the callback back and then renders the 404 over the
 * rows it just destroyed.
 *
 * Pinned here because the two functions sit next to each other and read as
 * duplicates, so the obvious tidy-up is to delete one — and whichever one goes,
 * a boundary silently gets the wrong answer. Note what this is NOT: it is not
 * the proof that the transaction guard works. That is
 * `isolation.itest.ts`, against a real database, through `db.$transaction`.
 */
describe("the two navigation classifiers", () => {
  const withDigest = (digest: string) =>
    Object.assign(new Error("next"), { digest })

  it("agree that a redirect is a control-flow throw", () => {
    expect(isNextControlFlowError(nextRedirect())).toBe(true)
    expect(isNextNavigationThrow(nextRedirect())).toBe(true)
  })

  it("disagree about notFound(), which is the reason both exist", () => {
    for (const digest of ["NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
      // The scope lets it through: a 404 from a page render must stay a 404.
      expect(isNextControlFlowError(withDigest(digest))).toBe(false)
      // The transaction does not: the callback has already been rolled back.
      expect(isNextNavigationThrow(withDigest(digest))).toBe(true)
    }
  })

  it("agree that an ordinary failure is not a navigation", () => {
    // Otherwise the transaction guard becomes a catch-all that renames every
    // Prisma error, and a unique-constraint violation arrives as a lecture.
    for (const notNavigation of [
      new Error("the database is on fire"),
      { digest: 12345 },
      { digest: "SOMETHING_ELSE" },
      null,
      undefined,
      "NEXT_REDIRECT",
    ]) {
      expect(isNextControlFlowError(notNavigation)).toBe(false)
      expect(isNextNavigationThrow(notNavigation)).toBe(false)
    }
  })
})

describe("unscoped grants", () => {
  it("reports the reason and detail", () => {
    runUnscoped("auth-bootstrap", "getUserContext", () => {
      expect(currentUnscopedGrant()).toEqual({ reason: "auth-bootstrap", detail: "getUserContext" })
    })
  })

  it("is not a tenant scope", () => {
    runUnscoped("migration", "backfill", () => {
      expect(currentScope()).toBeUndefined()
      // But it is a context — the query layer must distinguish "explicitly
      // allowed to span tenants" from "nobody set anything".
      expect(hasNoContext()).toBe(false)
    })
  })

  it("can be narrowed by opening a tenant scope inside it", () => {
    runUnscoped("control-plane", "provisionTenant", () => {
      runInTenantScope(TENANT_A, () => {
        expect(currentScope()?.institutionId).toBe("inst_a")
        expect(currentUnscopedGrant()).toBeUndefined()
      })
      expect(currentUnscopedGrant()?.reason).toBe("control-plane")
    })
  })
})

describe("requireTenantScope", () => {
  it("returns the scope when there is one", () => {
    runInTenantScope(TENANT_A, () => {
      expect(requireTenantScope("reading documents").institutionId).toBe("inst_a")
    })
  })

  it("throws rather than returning null when there is none", () => {
    // A null return would be read as "no filter", which is the failure this
    // whole module exists to prevent.
    expect(() => requireTenantScope("reading documents")).toThrow(TenantContextError)
    expect(() => requireTenantScope("reading documents")).toThrow(/reading documents/)
  })

  it("explains itself when called inside an unscoped grant", () => {
    runUnscoped("seed", "seedReferenceData", () => {
      expect(() => requireTenantScope("creating an organization")).toThrow(/unscoped "seed" block/)
      expect(() => requireTenantScope("creating an organization")).toThrow(/seedReferenceData/)
    })
  })

  it("suggests the fix in its message", () => {
    expect(() => requireTenantScope("x")).toThrow(/runInTenantScope|runUnscoped/)
  })
})
