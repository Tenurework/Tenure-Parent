import type { ApprovalStatus } from "@prisma/client";
import {
  applyAction,
  availableActions as engineActions,
} from "@tenure/workflow";

import {
  actorRoles,
  availableActions,
  nextStatus,
  NO_STANDING_DECLARATIONS,
  type ApprovalActionName,
  type ApprovalAuthority,
  type ApprovalView,
} from "@/lib/approvals";
import type { UserContext } from "@/lib/rbac";

import { APPROVAL_WORKFLOW } from "./approval-definition";

/**
 * The definition must behave *identically* to the switch it replaced.
 *
 * `lib/approvals.ts` now delegates to the workflow engine, so comparing it
 * against the engine would compare the engine to itself. The two functions
 * below are the ORIGINAL switch, copied verbatim from approvals.ts before the
 * delegation, and frozen here as an oracle. They are the only remaining copy of
 * the behaviour the pilot shipped with, and their whole job is to disagree if
 * the definition ever drifts.
 *
 * Moving a flow into data is only valuable if a second organization system can
 * have a different one; it is only safe if the first one's behaviour did not
 * change while someone claimed to have merely moved it. A handful of example
 * tests cannot tell those apart, so this walks the full cross product:
 *
 *   7 statuses × 8 actor-role combinations × 2 values of requesterIsPresident
 */

/** ORACLE — the pre-delegation implementation. Do not "simplify" this. */
function referenceAvailableActions(
  ctx: UserContext,
  approval: ApprovalView,
): ApprovalActionName[] {
  const { isRequester, isPresident, isOseGate } = actorRoles(ctx, approval);
  const actions: ApprovalActionName[] = [];

  switch (approval.status) {
    case "DRAFT":
      if (isRequester) actions.push("submit", "cancel");
      break;
    case "PENDING_PRESIDENT":
      if (isPresident) actions.push("approve", "request_changes", "reject");
      if (isRequester) actions.push("cancel");
      break;
    case "PENDING_OSE":
      if (isOseGate) actions.push("approve", "request_changes", "reject");
      if (isRequester) actions.push("cancel");
      break;
    case "NEEDS_CHANGES":
      if (isRequester) actions.push("resubmit", "cancel");
      break;
    // APPROVED / REJECTED / CANCELLED are terminal
  }
  return actions;
}

/** ORACLE — the pre-delegation implementation. */
function referenceNextStatus(
  action: ApprovalActionName,
  current: ApprovalStatus,
  opts: { requesterIsPresident: boolean },
): ApprovalStatus | null {
  switch (action) {
    case "submit":
      if (current !== "DRAFT") return null;
      return opts.requesterIsPresident ? "PENDING_OSE" : "PENDING_PRESIDENT";
    case "resubmit":
      if (current !== "NEEDS_CHANGES") return null;
      return opts.requesterIsPresident ? "PENDING_OSE" : "PENDING_PRESIDENT";
    case "approve":
      if (current === "PENDING_PRESIDENT") return "PENDING_OSE";
      if (current === "PENDING_OSE") return "APPROVED";
      return null;
    case "request_changes":
      if (current === "PENDING_PRESIDENT" || current === "PENDING_OSE")
        return "NEEDS_CHANGES";
      return null;
    case "reject":
      if (current === "PENDING_PRESIDENT" || current === "PENDING_OSE")
        return "REJECTED";
      return null;
    case "cancel":
      if (
        current === "DRAFT" ||
        current === "PENDING_PRESIDENT" ||
        current === "PENDING_OSE" ||
        current === "NEEDS_CHANGES"
      )
        return "CANCELLED";
      return null;
  }
}

const STATUSES: ApprovalStatus[] = [
  "DRAFT",
  "PENDING_PRESIDENT",
  "PENDING_OSE",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

const ORG = "org1";
const INST = "inst1";
const ME = "me";

/**
 * The ladder every case here is decided against. Irrelevant by construction —
 * no case carries an amount — which is exactly what makes this an equivalence
 * proof rather than a new set of expectations.
 */
const LADDER: ApprovalAuthority = { thresholds: { USD: 500_000 } };

/** A UserContext that produces the requested actor roles for this request. */
function contextFor(
  roles: {
    requester: boolean;
    president: boolean;
    ose: boolean;
  },
  requesterHoldsPresidency = false,
): {
  ctx: UserContext;
  approval: ApprovalView;
} {
  const ctx: UserContext = {
    userId: ME,
    institutionRoles: roles.ose
      ? [{ institutionId: INST, role: "OSE_DIRECTOR" }]
      : [],
    orgRoles: roles.president
      ? [
          {
            organizationId: ORG,
            roleId: "r1",
            roleName: "President",
            templateKey: "unit.lead",
            scope: "PRESIDENT",
            status: "ACTIVE",
          },
        ]
      : [],
  };
  return {
    ctx,
    approval: {
      id: "a1",
      status: "DRAFT",
      submittedById: roles.requester ? ME : "someone-else",
      preparedById: null,
      organizationId: ORG,
      institutionId: INST,
      controlWorld: NO_STANDING_DECLARATIONS,
      // These cases are about workflow roles, not the club lifecycle.
      organizationStatus: "ACTIVE" as const,
      // …nor about money. PAY-150-002 made authority amount-aware, and this
      // oracle is the proof that it changed NOTHING for a request that carries
      // no amount: `exceedsThreshold` is false for every case below, so the
      // definition must still reproduce the pre-delegation switch exactly.
      // The over-threshold divergence is asserted in approvals.test.ts.
      amountMinorUnits: null,
      currency: "USD",
      requesterIsPresident: roles.requester && requesterHoldsPresidency,
    },
  };
}

const ROLE_COMBINATIONS = [false, true].flatMap((requester) =>
  [false, true].flatMap((president) =>
    [false, true].map((ose) => ({ requester, president, ose })),
  ),
);

describe("the definition reproduces the switch exactly", () => {
  for (const combo of ROLE_COMBINATIONS) {
    for (const status of STATUSES) {
      for (const requesterIsPresident of [false, true]) {
        const name =
          `${status} · requester=${combo.requester} president=${combo.president} ` +
          `ose=${combo.ose} · requesterIsPresident=${requesterIsPresident}`;

        it(`offers the same actions — ${name}`, () => {
          const { ctx, approval } = contextFor(combo, requesterIsPresident);
          const expected = referenceAvailableActions(ctx, {
            ...approval,
            status,
          });

          // The host resolves which roles the actor plays for this instance —
          // exactly what actorRoles() does in the existing implementation.
          const roles: string[] = [];
          if (combo.requester) roles.push("requester");
          if (combo.president) roles.push("president");
          if (combo.ose) roles.push("oseGate");

          // The shipping function, not the engine — this has to prove what
          // callers actually get, and roles are unused by it beyond ctx.
          void roles;
          const actual = availableActions(
            ctx,
            { ...approval, status },
            LADDER,
          );

          expect([...actual].sort()).toEqual([...expected].sort());
          // Order matters too: the detail page renders buttons in this order.
          expect(actual).toEqual(expected);
        });
      }
    }
  }
});

describe("the definition reaches the same next status", () => {
  const ACTIONS: ApprovalActionName[] = [
    "submit",
    "approve",
    "request_changes",
    "reject",
    "resubmit",
    "cancel",
  ];

  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      for (const requesterIsPresident of [false, true]) {
        it(`${action} from ${status} (president=${requesterIsPresident})`, () => {
          const expected = referenceNextStatus(action, status, {
            requesterIsPresident,
          });

          // Every role, so role filtering cannot mask a routing difference —
          // this compares where the flow GOES, which nextStatus also ignores
          // roles for.
          expect(
            nextStatus(action, status, {
              requesterIsPresident,
              exceedsThreshold: false,
            }),
          ).toBe(expected);
        });
      }
    }
  }
});

describe("what the definition adds over the switch", () => {
  it("distinguishes why an action was refused", () => {
    // A wrong state is a stale page and should be reloaded; a permission
    // failure is a genuine denial and should be shown as one. The switch
    // collapses both into "not in the list".
    const stale = applyAction(
      APPROVAL_WORKFLOW,
      {
        state: "APPROVED",
        roles: ["oseGate"],
        conditions: {},
      },
      "approve",
    );
    expect(stale).toMatchObject({ ok: false, reason: "not-from-this-state" });

    const denied = applyAction(
      APPROVAL_WORKFLOW,
      {
        state: "PENDING_OSE",
        roles: ["requester"],
        conditions: {},
      },
      "approve",
    );
    expect(denied).toMatchObject({ ok: false, reason: "actor-not-permitted" });

    const unknown = applyAction(
      APPROVAL_WORKFLOW,
      {
        state: "DRAFT",
        roles: ["requester"],
        conditions: {},
      },
      "escalate",
    );
    expect(unknown).toMatchObject({ ok: false, reason: "unknown-action" });
  });

  it("carries labels, so a UI does not need its own copy of them", () => {
    const actions = engineActions(APPROVAL_WORKFLOW, {
      state: "PENDING_OSE",
      roles: ["oseGate"],
      conditions: {},
    });
    expect(actions.map((a) => a.label)).toEqual([
      "Approve",
      "Request changes",
      "Reject",
    ]);
  });

  it("is a published, frozen version", () => {
    expect(APPROVAL_WORKFLOW.version).toBe("1.0.0");
    expect(Object.isFrozen(APPROVAL_WORKFLOW)).toBe(true);
    expect(Object.isFrozen(APPROVAL_WORKFLOW.transitions)).toBe(true);
  });
});
