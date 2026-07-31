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

import {
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
  scope: "PRESIDENT" as const,
  status,
})

beforeEach(() => {
  jest.clearAllMocks()
  findManyOrganization.mockResolvedValue([])
  findManyInstitution.mockResolvedValue([])
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

  it("picks the first of several institutions, deterministically", async () => {
    // Documented as a gap, not a design: the acting institution should be the
    // user's stated choice. Pinned so the placeholder cannot drift silently.
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
