/**
 * PAY-150-008, attack 4 — asserted on the PRODUCER.
 *
 * `delegationStanding` having the right opinion is worth nothing if the code
 * that lends authority never asks it. `effectiveApprovalContext` is what
 * `actOnApproval` and the approval detail page call, and until this was wired
 * its only filter was `revokedAt: null` — so a delegation granted in September
 * was still lending a president's gate authority in June.
 *
 * Mocked: the database read and the delegator's context load. NOT mocked: the
 * expiry rule, which runs for real.
 */

jest.mock("@/lib/db", () => ({
  db: { approvalDelegation: { findMany: jest.fn(async () => []) } },
}))
jest.mock("@/lib/rbac", () => ({
  getUserContext: jest.fn(async () => ({
    userId: "user_president",
    institutionRoles: [],
    orgRoles: [
      {
        organizationId: "club_1",
        roleId: "r_pres",
        roleName: "President",
        scope: "PRESIDENT",
        status: "ACTIVE",
        templateKey: "unit.lead",
      },
    ],
  })),
}))

import { db as mockedDb } from "@/lib/db"
import { effectiveApprovalContext } from "@/lib/delegation"
import type { UserContext } from "@/lib/rbac"

const findMany = (mockedDb as unknown as { approvalDelegation: { findMany: jest.Mock } })
  .approvalDelegation.findMany

const BORROWER: UserContext = { userId: "user_member", institutionRoles: [], orgRoles: [] }

function delegation(createdAt: Date) {
  return {
    id: "del_1",
    fromUserId: "user_president",
    toUserId: "user_member",
    institutionId: "inst_1",
    createdAt,
    revokedAt: null,
    fromUser: { id: "user_president", name: "A President", email: "p@example.edu" },
  }
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)

beforeEach(() => jest.clearAllMocks())

it("lends the delegator's seats while the delegation is inside its lifetime", async () => {
  findMany.mockResolvedValue([delegation(daysAgo(3))])

  const { ctx, delegators } = await effectiveApprovalContext(
    "user_member",
    BORROWER,
    "inst_1",
  )

  expect(delegators.map((d) => d.id)).toEqual(["user_president"])
  expect(ctx.orgRoles.map((r) => r.templateKey)).toEqual(["unit.lead"])
})

it("lends nothing once it is past the lifetime, though nobody revoked it", async () => {
  findMany.mockResolvedValue([delegation(daysAgo(40))])

  const { ctx, delegators } = await effectiveApprovalContext(
    "user_member",
    BORROWER,
    "inst_1",
  )

  expect(delegators).toEqual([])
  // The borrower's own context, unchanged — not the delegator's seats.
  expect(ctx).toBe(BORROWER)
})

it("lends nothing from a delegation whose grant date cannot be read", async () => {
  findMany.mockResolvedValue([
    { ...delegation(daysAgo(1)), createdAt: "not a date" as unknown as Date },
  ])

  const { delegators } = await effectiveApprovalContext("user_member", BORROWER, "inst_1")
  expect(delegators).toEqual([])
})

it("keeps the live one when a stale one is alongside it", async () => {
  findMany.mockResolvedValue([
    { ...delegation(daysAgo(90)), fromUserId: "user_stale" },
    delegation(daysAgo(1)),
  ])

  const { delegators } = await effectiveApprovalContext("user_member", BORROWER, "inst_1")
  expect(delegators.map((d) => d.id)).toEqual(["user_president"])
})
