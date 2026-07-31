import {
  runInTenantScope,
  runUnscoped,
  currentScope,
  currentUnscopedGrant,
  hasNoContext,
  requireTenantScope,
  TenantContextError,
  type TenantScope,
} from "./context"

const TENANT_A: TenantScope = {
  institutionId: "inst_a",
  actor: { principalId: "user_1", principalType: "user" },
}
const TENANT_B: TenantScope = {
  institutionId: "inst_b",
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
