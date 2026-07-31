import { decideScope, type ScopeInput } from "./scope-args"
import { TenantContextError, type TenantScope } from "./context"

const TENANT_A: TenantScope = {
  institutionId: "inst_a",
  actor: { principalId: "user_1", principalType: "user" },
}

function decide(overrides: Partial<ScopeInput> = {}) {
  return decideScope({
    model: "Organization",
    operation: "findMany",
    args: {},
    scope: TENANT_A,
    unscopedGrant: undefined,
    enforce: true,
    ...overrides,
  })
}

/** The `where` a decision produces, for assertions. */
function whereOf(decision: ReturnType<typeof decideScope>) {
  if (decision.action !== "scoped") throw new Error(`expected scoped, got pass-through: ${decision.reason}`)
  return decision.args.where as Record<string, unknown>
}

describe("reads are filtered to the active tenant", () => {
  it.each(["findMany", "findFirst", "count", "aggregate", "groupBy"])("scopes %s", (operation) => {
    expect(whereOf(decide({ operation }))).toEqual({ institutionId: "inst_a" })
  })

  it("preserves the caller's own filter", () => {
    const where = whereOf(decide({ args: { where: { status: "ACTIVE" } } }))

    expect(where.status).toBe("ACTIVE")
    expect(where.AND).toEqual([{ institutionId: "inst_a" }])
  })

  // The attack this is built for: a caller-supplied institutionId must not be
  // able to displace the real one. A naive `{...where, institutionId}` spread
  // would be fine here but the reverse spread would not, so the ordering is
  // pinned by a test rather than by care.
  it("cannot be overridden by a caller-supplied institutionId", () => {
    const where = whereOf(decide({ args: { where: { institutionId: "inst_b" } } }))

    // Both predicates are present and ANDed, so the row must match each —
    // which no row can, across two different tenants.
    expect(where.institutionId).toBe("inst_b")
    expect(where.AND).toEqual([{ institutionId: "inst_a" }])
  })

  it("preserves an existing AND clause instead of replacing it", () => {
    const where = whereOf(decide({ args: { where: { AND: [{ status: "ACTIVE" }] } } }))

    expect(where.AND).toEqual([{ status: "ACTIVE" }, { institutionId: "inst_a" }])
  })

  it("handles a non-array AND", () => {
    const where = whereOf(decide({ args: { where: { AND: { status: "ACTIVE" } } } }))

    expect(where.AND).toEqual([{ status: "ACTIVE" }, { institutionId: "inst_a" }])
  })
})

describe("by-unique-key reads are filtered too", () => {
  // The insecure-direct-object-reference case: without a tenant predicate,
  // `findUnique({ where: { id } })` returns any tenant's row to anyone holding
  // the id. Prisma 6 accepts a non-unique predicate alongside the unique key
  // and returns null when it does not match (verified against the real client).
  it.each(["findUnique", "findUniqueOrThrow"])("scopes %s", (operation) => {
    const decision = decide({ operation, args: { where: { id: "org_1" } } })

    expect(decision.action).toBe("scoped")
    if (decision.action !== "scoped") return
    expect(decision.args.where).toEqual({ id: "org_1", AND: [{ institutionId: "inst_a" }] })
  })
})

describe("writes are stamped with the active tenant", () => {
  it("stamps create", () => {
    const decision = decide({ operation: "create", args: { data: { name: "Chess Club" } } })

    expect(decision.action).toBe("scoped")
    if (decision.action !== "scoped") return
    expect(decision.args.data).toEqual({ name: "Chess Club", institutionId: "inst_a" })
  })

  it("stamps every row of a createMany", () => {
    const decision = decide({
      operation: "createMany",
      args: { data: [{ name: "A" }, { name: "B" }] },
    })

    expect(decision.action).toBe("scoped")
    if (decision.action !== "scoped") return
    expect(decision.args.data).toEqual([
      { name: "A", institutionId: "inst_a" },
      { name: "B", institutionId: "inst_a" },
    ])
  })

  // Refused, not quietly corrected. Overriding looks safe — the row lands in
  // the acting tenant either way — but every create site here passes
  // `institutionId: org.institutionId`, so overriding would write
  // institutionId=<acting> beside organizationId -> <other tenant's org>. Eight
  // models carry institutionId with no foreign key behind it, so nothing
  // downstream would ever catch a row whose two halves disagree.
  it("refuses a create that names another tenant", () => {
    expect(() =>
      decide({ operation: "create", args: { data: { name: "Trojan", institutionId: "inst_b" } } }),
    ).toThrow(TenantContextError)
    expect(() =>
      decide({ operation: "create", args: { data: { name: "Trojan", institutionId: "inst_b" } } }),
    ).toThrow(/named institution inst_b while acting in inst_a/)
  })

  it("accepts a create that names the acting tenant redundantly", () => {
    const decision = decide({
      operation: "create",
      args: { data: { name: "Fine", institutionId: "inst_a" } },
    })

    expect(decision.action).toBe("scoped")
    if (decision.action !== "scoped") return
    expect((decision.args.data as Record<string, unknown>).institutionId).toBe("inst_a")
  })

  it("refuses a batch where any one row names another tenant", () => {
    expect(() =>
      decide({
        operation: "createMany",
        args: { data: [{ name: "A" }, { name: "B", institutionId: "inst_b" }] },
      }),
    ).toThrow(TenantContextError)
  })

  it.each(["update", "updateMany", "delete", "deleteMany"])("filters %s by tenant", (operation) => {
    const where = whereOf(decide({ operation, args: { where: { id: "org_1" } } }))

    expect(where.AND).toEqual([{ institutionId: "inst_a" }])
  })

  it("scopes both branches of an upsert", () => {
    const decision = decide({
      operation: "upsert",
      args: { where: { id: "org_1" }, create: { name: "New" }, update: { name: "Updated" } },
    })

    expect(decision.action).toBe("scoped")
    if (decision.action !== "scoped") return
    // The update branch is filtered...
    expect((decision.args.where as Record<string, unknown>).AND).toEqual([{ institutionId: "inst_a" }])
    // ...and the insert branch is stamped, or a missed upsert would create
    // a row belonging to nobody.
    expect(decision.args.create).toEqual({ name: "New", institutionId: "inst_a" })
  })
})

describe("failing closed", () => {
  it("refuses a scoped model with no context", () => {
    expect(() => decide({ scope: undefined })).toThrow(TenantContextError)
    expect(() => decide({ scope: undefined })).toThrow(/no tenant context/)
  })

  it("refuses an unclassified model", () => {
    expect(() => decide({ model: "SomeNewModel" })).toThrow(/not classified in the tenancy registry/)
  })

  it("refuses an operation it does not know how to scope", () => {
    expect(() => decide({ operation: "someFutureOperation" })).toThrow(/not a recognised operation/)
  })

  it("names the model and operation so the failure is actionable", () => {
    expect(() => decide({ model: "Document", operation: "findMany", scope: undefined })).toThrow(
      /findMany on Document/,
    )
  })
})

describe("observe mode reports instead of refusing", () => {
  // While call sites are being migrated, throwing would take the app down.
  // Observe mode still refuses nothing, which is exactly why it is temporary.
  it("passes through a missing context", () => {
    const decision = decide({ scope: undefined, enforce: false })

    expect(decision.action).toBe("pass-through")
    if (decision.action !== "pass-through") return
    expect(decision.reason).toMatch(/observe mode/)
  })

  it("still scopes normally when a context is present", () => {
    expect(whereOf(decide({ enforce: false }))).toEqual({ institutionId: "inst_a" })
  })
})

describe("models the query layer does not filter", () => {
  it("lets platform-global models through", () => {
    const decision = decide({ model: "User", scope: undefined })

    expect(decision.action).toBe("pass-through")
    if (decision.action !== "pass-through") return
    expect(decision.reason).toMatch(/global by design/)
  })

  it("lets models with no tenant column through, and says so", () => {
    const decision = decide({ model: "DirectoryPerson", scope: undefined })

    expect(decision.action).toBe("pass-through")
    if (decision.action !== "pass-through") return
    expect(decision.reason).toMatch(/no tenant column/)
  })

  it("lets raw queries through", () => {
    const decision = decide({ model: undefined, operation: "$queryRaw" })

    expect(decision.action).toBe("pass-through")
  })
})

describe("explicit unscoped grants", () => {
  // Without this, resolving which institutions a user belongs to would itself
  // require a tenant — and nobody could authenticate.
  it("allows the auth bootstrap to read a scoped model", () => {
    const decision = decide({
      model: "InstitutionMembership",
      scope: undefined,
      unscopedGrant: { reason: "auth-bootstrap", detail: "getUserContext" },
    })

    expect(decision.action).toBe("pass-through")
    if (decision.action !== "pass-through") return
    expect(decision.reason).toMatch(/auth-bootstrap/)
    expect(decision.reason).toMatch(/getUserContext/)
  })

  it("records which grant was used, so an audit reads as named operations", () => {
    const decision = decide({
      scope: undefined,
      unscopedGrant: { reason: "control-plane", detail: "provisionTenant" },
    })

    expect(decision.action).toBe("pass-through")
    if (decision.action !== "pass-through") return
    expect(decision.reason).toContain("provisionTenant")
  })

  it("prefers the tenant scope when both are somehow present", () => {
    // A grant must not widen an operation that already has a tenant.
    // AsyncLocalStorage holds one store so the real API cannot produce both,
    // but the safe ordering should not depend on that staying true.
    const decision = decide({
      scope: TENANT_A,
      unscopedGrant: { reason: "migration", detail: "backfill" },
    })

    expect(decision.action).toBe("scoped")
    expect(whereOf(decision)).toEqual({ institutionId: "inst_a" })
  })
})
