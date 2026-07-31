import type { ApprovalStatus } from "@prisma/client"
import { applyAction, availableActions as engineActions } from "@tenure/workflow"

import {
  availableActions as switchActions,
  nextStatus,
  type ApprovalActionName,
  type ApprovalView,
} from "@/lib/approvals"
import type { UserContext } from "@/lib/rbac"

import { APPROVAL_WORKFLOW } from "./approval-definition"

/**
 * The definition must behave *identically* to the switch it transcribes.
 *
 * Moving a flow into data is only valuable if a second organization system can
 * have a different one; it is only safe if the first one's behaviour did not
 * change while someone claimed to have merely moved it. A handful of example
 * tests cannot tell those apart, so this walks the full cross product:
 *
 *   7 statuses × 8 actor-role combinations × 2 values of requesterIsPresident
 *
 * — 112 cases, comparing available actions and resulting status against the
 * existing implementation on every one.
 */

const STATUSES: ApprovalStatus[] = [
  "DRAFT",
  "PENDING_PRESIDENT",
  "PENDING_OSE",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]

const ORG = "org1"
const INST = "inst1"
const ME = "me"

/** A UserContext that produces the requested actor roles for this request. */
function contextFor(roles: { requester: boolean; president: boolean; ose: boolean }): {
  ctx: UserContext
  approval: ApprovalView
} {
  const ctx: UserContext = {
    userId: ME,
    institutionRoles: roles.ose ? [{ institutionId: INST, role: "OSE_DIRECTOR" }] : [],
    orgRoles: roles.president
      ? [
          {
            organizationId: ORG,
            roleId: "r1",
            roleName: "President",
            scope: "PRESIDENT",
            status: "ACTIVE",
          },
        ]
      : [],
  }
  return {
    ctx,
    approval: {
      id: "a1",
      status: "DRAFT",
      submittedById: roles.requester ? ME : "someone-else",
      organizationId: ORG,
      institutionId: INST,
    },
  }
}

const ROLE_COMBINATIONS = [false, true].flatMap((requester) =>
  [false, true].flatMap((president) =>
    [false, true].map((ose) => ({ requester, president, ose })),
  ),
)

describe("the definition reproduces the switch exactly", () => {
  for (const combo of ROLE_COMBINATIONS) {
    for (const status of STATUSES) {
      for (const requesterIsPresident of [false, true]) {
        const name =
          `${status} · requester=${combo.requester} president=${combo.president} ` +
          `ose=${combo.ose} · requesterIsPresident=${requesterIsPresident}`

        it(`offers the same actions — ${name}`, () => {
          const { ctx, approval } = contextFor(combo)
          const expected = switchActions(ctx, { ...approval, status })

          // The host resolves which roles the actor plays for this instance —
          // exactly what actorRoles() does in the existing implementation.
          const roles: string[] = []
          if (combo.requester) roles.push("requester")
          if (combo.president) roles.push("president")
          if (combo.ose) roles.push("oseGate")

          const actual = engineActions(APPROVAL_WORKFLOW, {
            state: status,
            roles,
            conditions: { requesterIsPresident },
          }).map((a) => a.action)

          expect([...actual].sort()).toEqual([...expected].sort())
        })
      }
    }
  }
})

describe("the definition reaches the same next status", () => {
  const ACTIONS: ApprovalActionName[] = [
    "submit",
    "approve",
    "request_changes",
    "reject",
    "resubmit",
    "cancel",
  ]

  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      for (const requesterIsPresident of [false, true]) {
        it(`${action} from ${status} (president=${requesterIsPresident})`, () => {
          const expected = nextStatus(action, status, { requesterIsPresident })

          // Every role, so role filtering cannot mask a routing difference —
          // this compares where the flow GOES, which nextStatus also ignores
          // roles for.
          const result = applyAction(APPROVAL_WORKFLOW, {
            state: status,
            roles: ["requester", "president", "oseGate"],
            conditions: { requesterIsPresident },
          }, action)

          if (expected === null) {
            expect(result.ok).toBe(false)
          } else {
            expect(result.ok).toBe(true)
            expect(result.ok && result.to).toBe(expected)
          }
        })
      }
    }
  }
})

describe("what the definition adds over the switch", () => {
  it("distinguishes why an action was refused", () => {
    // A wrong state is a stale page and should be reloaded; a permission
    // failure is a genuine denial and should be shown as one. The switch
    // collapses both into "not in the list".
    const stale = applyAction(APPROVAL_WORKFLOW, {
      state: "APPROVED",
      roles: ["oseGate"],
      conditions: {},
    }, "approve")
    expect(stale).toMatchObject({ ok: false, reason: "not-from-this-state" })

    const denied = applyAction(APPROVAL_WORKFLOW, {
      state: "PENDING_OSE",
      roles: ["requester"],
      conditions: {},
    }, "approve")
    expect(denied).toMatchObject({ ok: false, reason: "actor-not-permitted" })

    const unknown = applyAction(APPROVAL_WORKFLOW, {
      state: "DRAFT",
      roles: ["requester"],
      conditions: {},
    }, "escalate")
    expect(unknown).toMatchObject({ ok: false, reason: "unknown-action" })
  })

  it("carries labels, so a UI does not need its own copy of them", () => {
    const actions = engineActions(APPROVAL_WORKFLOW, {
      state: "PENDING_OSE",
      roles: ["oseGate"],
      conditions: {},
    })
    expect(actions.map((a) => a.label)).toEqual(["Approve", "Request changes", "Reject"])
  })

  it("is a published, frozen version", () => {
    expect(APPROVAL_WORKFLOW.version).toBe("1.0.0")
    expect(Object.isFrozen(APPROVAL_WORKFLOW)).toBe(true)
    expect(Object.isFrozen(APPROVAL_WORKFLOW.transitions)).toBe(true)
  })
})
