import {
  canPostToConversation,
  canReadConversation,
  messagingTier,
  type ConversationLike,
} from "./messaging"
import type { UserContext } from "./rbac"

const INST = "inst_1"
const ORG = "org_1"

function ctx(userId: string, overrides: Partial<UserContext> = {}): UserContext {
  return { userId, institutionRoles: [], orgRoles: [], ...overrides }
}

const member = ctx("member", {
  orgRoles: [{ organizationId: ORG, roleId: "r1", roleName: "Member", scope: "MEMBER", status: "ACTIVE" }],
})
const shadow = ctx("shadow", {
  orgRoles: [{ organizationId: ORG, roleId: "r2", roleName: "President", scope: "PRESIDENT", status: "SHADOW" }],
})
const alumni = ctx("alumni", {
  orgRoles: [{ organizationId: ORG, roleId: "r3", roleName: "President", scope: "PRESIDENT", status: "ALUMNI" }],
})
const ose = ctx("ose", { institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }] })
const outsider = ctx("outsider")

function convo(type: ConversationLike["type"], participants: string[] = [], organizationId: string | null = ORG): ConversationLike {
  return { type, institutionId: INST, organizationId, participantUserIds: participants }
}

describe("DIRECT_MESSAGE", () => {
  const dm = convo("DIRECT_MESSAGE", ["member", "shadow"], null)
  it("restricts to participants", () => {
    expect(canReadConversation(member, dm)).toBe(true)
    expect(canPostToConversation(member, dm)).toBe(true)
    expect(canReadConversation(outsider, dm)).toBe(false)
    expect(canReadConversation(ose, dm)).toBe(false) // DMs are private even from OSE
  })
})

describe("BOARD_CHANNEL", () => {
  const channel = convo("BOARD_CHANNEL")
  it("lets active members read and post", () => {
    expect(canReadConversation(member, channel)).toBe(true)
    expect(canPostToConversation(member, channel)).toBe(true)
  })
  it("gives shadow members read-only access", () => {
    expect(canReadConversation(shadow, channel)).toBe(true)
    expect(canPostToConversation(shadow, channel)).toBe(false)
  })
  it("revokes alumni entirely", () => {
    expect(canReadConversation(alumni, channel)).toBe(false)
    expect(canPostToConversation(alumni, channel)).toBe(false)
  })
  it("lets OSE read for oversight", () => {
    expect(canReadConversation(ose, channel)).toBe(true)
  })
})

describe("APPROVAL_THREAD", () => {
  const thread = convo("APPROVAL_THREAD", ["requester", "president"])
  it("limits to engaged participants and OSE", () => {
    expect(canReadConversation(ctx("requester"), thread)).toBe(true)
    expect(canPostToConversation(ctx("president"), thread)).toBe(true)
    expect(canReadConversation(ose, thread)).toBe(true)
    expect(canPostToConversation(ose, thread)).toBe(true)
    expect(canReadConversation(outsider, thread)).toBe(false)
  })
})

describe("OSE_BROADCAST", () => {
  const broadcast = convo("OSE_BROADCAST", [], null)
  it("lets OSE post and current members read but not reply", () => {
    expect(canPostToConversation(ose, broadcast)).toBe(true)
    expect(canReadConversation(member, broadcast)).toBe(true)
    expect(canPostToConversation(member, broadcast)).toBe(false)
    expect(canReadConversation(outsider, broadcast)).toBe(false)
  })
})

describe("messagingTier", () => {
  it("ranks OSE above club seats and gates non-active users", () => {
    const president = ctx("p", {
      orgRoles: [{ organizationId: ORG, roleId: "r", roleName: "President", scope: "PRESIDENT", status: "ACTIVE" }],
    })
    expect(messagingTier(ose)).toBe("OSE")
    expect(messagingTier(president)).toBe("PRESIDENT")
    expect(messagingTier(member)).toBe("MEMBER")
    expect(messagingTier(shadow)).toBe("NONE")
    expect(messagingTier(alumni)).toBe("NONE")
    expect(messagingTier(outsider)).toBe("NONE")
  })
})
