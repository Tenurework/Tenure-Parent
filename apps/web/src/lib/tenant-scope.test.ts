import { currentScope, currentUnscopedGrant, TenantContextError } from "@/lib/tenancy/context"
import type { UserContext } from "@/lib/rbac"

/**
 * These pin the two answers that are easy to get wrong and impossible to notice
 * afterwards: which institution a given user resolves to, and whether a
 * caller-supplied one is believed.
 */

const findManyOrganization = jest.fn()
const findManyInstitution = jest.fn()
const getUserContext = jest.fn()

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: (...args: unknown[]) => findManyOrganization(...args) },
    institution: { findMany: (...args: unknown[]) => findManyInstitution(...args) },
  },
}))

jest.mock("@/lib/rbac", () => ({
  getUserContext: (...args: unknown[]) => getUserContext(...args),
}))

/**
 * The cookie jar, standing in for the one a request carries.
 *
 * `null` means "no request scope" — a scheduled job, a script — which is what
 * `next/headers` throws for, and what the production code has to survive
 * without a tenant resolution turning into a crash.
 */
let mockJar: Map<string, string> | null = null
const mockCookieSet = jest.fn()

jest.mock("next/headers", () => ({
  cookies: async () => {
    if (!mockJar) throw new Error("`cookies` was called outside a request scope.")
    return {
      get: (name: string) =>
        mockJar!.has(name) ? { name, value: mockJar!.get(name)! } : undefined,
      set: (...args: unknown[]) => mockCookieSet(...args),
    }
  },
}))

import {
  ACTING_INSTITUTION_COOKIE,
  actingInstitutions,
  chooseActingInstitution,
  forEachInstitution,
  resolveTenantScope,
  withSystemTenantScope,
  withTenantScope,
} from "./tenant-scope"

const ctx = (overrides: Partial<UserContext> = {}): UserContext => ({
  userId: "user_1",
  institutionRoles: [],
  orgRoles: [],
  ...overrides,
})

const seat = (organizationId: string, status: "SHADOW" | "ACTIVE" | "ALUMNI" = "ACTIVE") => ({
  organizationId,
  roleId: `role_${organizationId}`,
  roleName: "President",
  templateKey: "unit.lead",
  scope: "PRESIDENT" as const,
  status,
})

beforeEach(() => {
  jest.clearAllMocks()
  findManyOrganization.mockResolvedValue([])
  findManyInstitution.mockResolvedValue([])
  mockJar = new Map()
})

describe("resolveTenantScope", () => {
  it("uses the OSE membership when there is one", async () => {
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    const scope = await resolveTenantScope("user_1")

    expect(scope.institutionId).toBe("inst_a")
    expect(scope.actor).toEqual({ principalId: "user_1", principalType: "user" })
    // The membership read decides the tenant, so it must not require one.
    expect(findManyOrganization).not.toHaveBeenCalled()
  })

  it("falls back to the institution behind the user's club seats", async () => {
    getUserContext.mockResolvedValue(ctx({ orgRoles: [seat("org_1")] }))
    findManyOrganization.mockResolvedValue([{ institutionId: "inst_b" }])

    await expect(resolveTenantScope("user_1")).resolves.toMatchObject({
      institutionId: "inst_b",
    })
  })

  it("still resolves for a past officer whose only seat is ALUMNI", async () => {
    // Tenancy is not permission. Dropping ALUMNI here would revoke access that
    // RBAC, not this function, is responsible for.
    getUserContext.mockResolvedValue(ctx({ orgRoles: [seat("org_1", "ALUMNI")] }))
    findManyOrganization.mockResolvedValue([{ institutionId: "inst_b" }])

    await expect(resolveTenantScope("user_1")).resolves.toMatchObject({
      institutionId: "inst_b",
    })
  })

  it("resolves the membership inside an auth-bootstrap grant", async () => {
    getUserContext.mockImplementation(async () => {
      expect(currentUnscopedGrant()?.reason).toBe("auth-bootstrap")
      return ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_STAFF" }] })
    })

    await resolveTenantScope("user_1")
    expect(getUserContext).toHaveBeenCalled()
  })

  it("refuses a user with no institution rather than inventing one", async () => {
    getUserContext.mockResolvedValue(ctx())

    await expect(resolveTenantScope("user_1")).rejects.toThrow(TenantContextError)
  })

  it("refuses an institution the user is not a member of", async () => {
    // Otherwise any signed-in account could name any tenant — the defect the
    // chokepoint exists to close, reintroduced through its own front door.
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    await expect(resolveTenantScope("user_1", "inst_b")).rejects.toThrow(/not a member/)
  })

  it("accepts an institution the user does belong to", async () => {
    getUserContext.mockResolvedValue(
      ctx({
        institutionRoles: [
          { institutionId: "inst_a", role: "OSE_DIRECTOR" },
          { institutionId: "inst_b", role: "OSE_STAFF" },
        ],
      }),
    )

    await expect(resolveTenantScope("user_1", "inst_b")).resolves.toMatchObject({
      institutionId: "inst_b",
    })
  })

  it("defaults to the first of several institutions, deterministically", async () => {
    // The default a user gets before they have chosen. Pinned because moving it
    // silently moves which tenant's rows every unswitched multi-institution
    // user sees.
    getUserContext.mockResolvedValue(
      ctx({
        institutionRoles: [
          { institutionId: "inst_a", role: "OSE_DIRECTOR" },
          { institutionId: "inst_b", role: "OSE_STAFF" },
        ],
      }),
    )
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})

    await expect(resolveTenantScope("multi_user")).resolves.toMatchObject({
      institutionId: "inst_a",
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("multi_user"))

    warn.mockRestore()
  })
})

describe("withTenantScope", () => {
  it("makes the tenant visible for everything the body awaits", async () => {
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    const seen = await withTenantScope("user_1", async () => {
      await new Promise((r) => setTimeout(r, 5))
      return currentScope()?.institutionId
    })

    expect(seen).toBe("inst_a")
    expect(currentScope()).toBeUndefined()
  })

  it("lets the body's error out unchanged", async () => {
    // redirect() and notFound() are thrown, so swallowing here would break
    // every page that uses them.
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    await expect(
      withTenantScope("user_1", async () => {
        throw new Error("NEXT_REDIRECT")
      }),
    ).rejects.toThrow("NEXT_REDIRECT")
  })
})

/**
 * The switcher. Three properties, and the second is the one that matters: the
 * cookie is attacker-controlled, so it must be able to *select* an institution
 * the user already belongs to and must never be able to *reach* one they do
 * not.
 */
describe("the acting institution a user has chosen", () => {
  const twoInstitutions = () =>
    getUserContext.mockResolvedValue(
      ctx({
        institutionRoles: [
          { institutionId: "inst_a", role: "OSE_DIRECTOR" },
          { institutionId: "inst_b", role: "OSE_STAFF" },
        ],
      }),
    )

  it("acts in the institution the cookie names, when it is one of theirs", async () => {
    twoInstitutions()
    mockJar!.set(ACTING_INSTITUTION_COOKIE, "inst_b")

    const seen = await withTenantScope("user_1", async () => currentScope()?.institutionId)

    expect(seen).toBe("inst_b")
  })

  it("ignores a cookie naming an institution the user does not belong to", async () => {
    // The whole point. A cookie is a request, not a fact — believing this one
    // would let any signed-in account read any tenant by editing a string in
    // their own browser.
    twoInstitutions()
    mockJar!.set(ACTING_INSTITUTION_COOKIE, "inst_someone_elses")
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})

    const seen = await withTenantScope("user_1", async () => currentScope()?.institutionId)

    expect(seen).toBe("inst_a")
    expect(seen).not.toBe("inst_someone_elses")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("inst_someone_elses"))
    warn.mockRestore()
  })

  it("still refuses an institution named directly by a caller", async () => {
    // The cookie is ignored because a stale one must stay recoverable. An
    // explicit argument has no such excuse and still throws.
    twoInstitutions()

    await expect(withTenantScope("user_1", async () => null, { institutionId: "inst_c" })).rejects.toThrow(
      /not a member/,
    )
  })

  it("resolves a tenant at all outside a request, where there is no cookie to read", async () => {
    // next/headers throws outside a request scope. A scheduled job resolving a
    // user's tenant must not become a crash because of it.
    mockJar = null
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    await expect(withTenantScope("user_1", async () => currentScope()?.institutionId)).resolves.toBe(
      "inst_a",
    )
  })

  it("offers every institution the user belongs to, with the chosen one active", async () => {
    twoInstitutions()
    findManyInstitution.mockResolvedValue([
      { id: "inst_b", slug: "b", name: "Institution B" },
      { id: "inst_a", slug: "a", name: "Institution A" },
    ])
    mockJar!.set(ACTING_INSTITUTION_COOKIE, "inst_b")

    const { active, options } = await actingInstitutions("user_1")

    expect(active).toEqual({ id: "inst_b", slug: "b", name: "Institution B" })
    // Candidate order, not the order the database returned them in: the first
    // option is the default, so it cannot be whatever the planner felt like.
    expect(options.map((o) => o.id)).toEqual(["inst_a", "inst_b"])
  })

  it("reports no institution rather than throwing for an account with none", async () => {
    // The shell has to render for this user — it is how they reach sign-out.
    getUserContext.mockResolvedValue(ctx())

    await expect(actingInstitutions("user_1")).resolves.toEqual({ active: null, options: [] })
  })

  it("counts a club seat at another institution as somewhere the user may act", async () => {
    // An OSE staffer who also holds a seat at a second institution. Both are
    // real; offering only the first would make the seat unselectable without
    // making it unreachable.
    getUserContext.mockResolvedValue(
      ctx({
        institutionRoles: [{ institutionId: "inst_a", role: "OSE_STAFF" }],
        orgRoles: [seat("org_at_b")],
      }),
    )
    findManyOrganization.mockResolvedValue([{ institutionId: "inst_b" }])
    findManyInstitution.mockResolvedValue([
      { id: "inst_a", slug: "a", name: "Institution A" },
      { id: "inst_b", slug: "b", name: "Institution B" },
    ])

    const { active, options } = await actingInstitutions("user_1")

    expect(options.map((o) => o.id)).toEqual(["inst_a", "inst_b"])
    // Memberships still come first, so the default is unmoved.
    expect(active?.id).toBe("inst_a")
  })
})

describe("recording a switch", () => {
  it("persists the choice as a scoped, non-scriptable cookie", async () => {
    getUserContext.mockResolvedValue(
      ctx({
        institutionRoles: [
          { institutionId: "inst_a", role: "OSE_DIRECTOR" },
          { institutionId: "inst_b", role: "OSE_STAFF" },
        ],
      }),
    )
    findManyInstitution.mockResolvedValue([{ id: "inst_b", slug: "b", name: "Institution B" }])

    await expect(chooseActingInstitution("user_1", "inst_b")).resolves.toEqual({
      id: "inst_b",
      slug: "b",
      name: "Institution B",
    })

    expect(mockCookieSet).toHaveBeenCalledWith(
      ACTING_INSTITUTION_COOKIE,
      "inst_b",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    )
  })

  it("refuses to record an institution the user is not a member of, and writes nothing", async () => {
    getUserContext.mockResolvedValue(
      ctx({ institutionRoles: [{ institutionId: "inst_a", role: "OSE_DIRECTOR" }] }),
    )

    await expect(chooseActingInstitution("user_1", "inst_b")).rejects.toThrow(/not a member/)
    expect(mockCookieSet).not.toHaveBeenCalled()
  })
})

describe("jobs with no user", () => {
  it("records the job as the actor", async () => {
    const actor = await withSystemTenantScope("inst_a", "jobs/reminders", async () =>
      currentScope()?.actor,
    )

    expect(actor).toEqual({ principalId: "jobs/reminders", principalType: "system" })
  })

  it("opens one scope per institution rather than spanning them", async () => {
    findManyInstitution.mockResolvedValue([{ id: "inst_a" }, { id: "inst_b" }])

    const seen = await forEachInstitution("jobs/reminders", async (scope) => scope.institutionId)

    expect(seen).toEqual(["inst_a", "inst_b"])
  })

  it("states a control-plane grant for enumerating the tenants", async () => {
    findManyInstitution.mockImplementation(async () => {
      expect(currentUnscopedGrant()).toEqual({
        reason: "control-plane",
        detail: "jobs/reminders: enumerate institutions",
      })
      return []
    })

    await forEachInstitution("jobs/reminders", async () => null)
    expect(findManyInstitution).toHaveBeenCalled()
  })
})
