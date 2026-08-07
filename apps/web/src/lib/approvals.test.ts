import type { ApprovalStatus, OrgStatus } from "@prisma/client";
import {
  actorRoles,
  availableActions,
  decisionControl,
  isConcurrentDecision,
  nextStatus,
  type ApprovalView,
} from "./approvals";
import type { UserContext } from "./rbac";

const INST = "inst_1";
const ORG = "org_1";

function approval(
  status: ApprovalStatus,
  submittedById = "vp_user",
  // ACTIVE unless a test says otherwise: these cases are about who may act on a
  // request, not about the club's lifecycle.
  organizationStatus: OrgStatus = "ACTIVE",
): ApprovalView {
  return {
    id: "ap_1",
    status,
    submittedById,
    organizationId: ORG,
    institutionId: INST,
    organizationStatus,
  };
}

function ctx(
  userId: string,
  overrides: Partial<UserContext> = {},
): UserContext {
  return { userId, institutionRoles: [], orgRoles: [], ...overrides };
}

const vp = ctx("vp_user", {
  orgRoles: [
    {
      organizationId: ORG,
      roleId: "r_vp",
      roleName: "VP Finance",
      templateKey: "finance.officer",
      scope: "FUNCTIONAL",
      status: "ACTIVE",
    },
  ],
});
const president = ctx("pres_user", {
  orgRoles: [
    {
      organizationId: ORG,
      roleId: "r_p",
      roleName: "President",
      templateKey: "unit.lead",
      scope: "PRESIDENT",
      status: "ACTIVE",
    },
  ],
});
const oseDirector = ctx("ose_user", {
  institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
});
const outsider = ctx("random_user");

describe("availableActions", () => {
  it("lets the requester submit or cancel a draft", () => {
    expect(availableActions(vp, approval("DRAFT"))).toEqual([
      "submit",
      "cancel",
    ]);
    expect(availableActions(president, approval("DRAFT"))).toEqual([]);
  });

  it("gates PENDING_PRESIDENT on the active president", () => {
    const a = approval("PENDING_PRESIDENT");
    expect(availableActions(president, a)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
    expect(availableActions(vp, a)).toEqual(["cancel"]); // requester may withdraw
    expect(availableActions(oseDirector, a)).toEqual([]); // not their gate yet
  });

  it("gates PENDING_OSE on OSE staff", () => {
    const a = approval("PENDING_OSE");
    expect(availableActions(oseDirector, a)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
    expect(availableActions(president, a)).toEqual([]);
  });

  it("lets only the requester resubmit after NEEDS_CHANGES", () => {
    const a = approval("NEEDS_CHANGES");
    expect(availableActions(vp, a)).toEqual(["resubmit", "cancel"]);
    expect(availableActions(president, a)).toEqual([]);
  });

  // ── no self-approval (GE-094-008) ──────────────────────────────────────────
  //
  // The gate roles are additive and the engine matches them with `some()`, so
  // an OSE member who raised a request used to arrive at PENDING_OSE holding
  // BOTH `requester` and `oseGate` and was offered approve / request_changes /
  // reject on their own request. `actions.ts` gates the write on exactly this
  // list, so that was a real write path, not a cosmetic one.
  it("refuses the OSE gate to the person who raised the request", () => {
    const own = approval("PENDING_OSE", "ose_user");
    expect(availableActions(oseDirector, own)).toEqual(["cancel"]);
  });

  it("still lets a different OSE member decide the same request", () => {
    const own = approval("PENDING_OSE", "ose_user");
    const colleague = ctx("ose_user_2", {
      institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
    });
    expect(availableActions(colleague, own)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("refuses the president gate to a president who raised the request", () => {
    // Reachable: a VP submits, the request sits at PENDING_PRESIDENT, and the
    // VP is then given the president seat.
    const own = approval("PENDING_PRESIDENT", "pres_user");
    expect(availableActions(president, own)).toEqual(["cancel"]);
  });

  it("leaves the requester's own actions alone", () => {
    // submit / resubmit / cancel are the requester's, not a second pair of
    // eyes. A control that took those away would stop people filing requests.
    expect(availableActions(oseDirector, approval("DRAFT", "ose_user"))).toEqual(
      ["submit", "cancel"],
    );
    expect(
      availableActions(oseDirector, approval("NEEDS_CHANGES", "ose_user")),
    ).toEqual(["resubmit", "cancel"]);
  });

  it("cannot be carried DRAFT → APPROVED by one person", () => {
    // The whole workflow, not one hop. An OSE member who is also the club's
    // ACTIVE president skips the president gate on submit (nextStatus below),
    // which leaves the OSE gate as the only remaining human — so if that gate
    // were still offered to them, no second person would ever see the request.
    const oseAndPresident = ctx("ose_pres", {
      institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
      orgRoles: [
        {
          organizationId: ORG,
          roleId: "r_p2",
          roleName: "President",
          templateKey: "unit.lead",
          scope: "PRESIDENT",
          status: "ACTIVE",
        },
      ],
    });

    const draft = approval("DRAFT", "ose_pres");
    expect(availableActions(oseAndPresident, draft)).toEqual([
      "submit",
      "cancel",
    ]);

    const afterSubmit = nextStatus("submit", "DRAFT", {
      requesterIsPresident: true,
    });
    expect(afterSubmit).toBe("PENDING_OSE");

    const pending = approval(afterSubmit!, "ose_pres");
    const offered = availableActions(oseAndPresident, pending);
    expect(offered).toEqual(["cancel"]);
    expect(
      offered.some((a) =>
        nextStatus(a, "PENDING_OSE", { requesterIsPresident: true }) ===
        "APPROVED",
      ),
    ).toBe(false);
  });

  it("names the refusal, rather than answering with a bare boolean", () => {
    // The rule is @tenure/authorization's `mayDecide`, not a local `===` — so
    // support gets "because you raised it" and the other refusal arms
    // (recusal, declared conflict, four-eyes) arrive already wired.
    expect(decisionControl(oseDirector, approval("PENDING_OSE", "ose_user")))
      .toEqual({
        ok: false,
        refusal: "SELF_APPROVAL",
        detail: "A request cannot be decided by the person who raised it.",
      });
    expect(decisionControl(oseDirector, approval("PENDING_OSE", "vp_user"))).toEqual(
      { ok: true },
    );
  });

  it("drops the gate role without pretending they are not the requester", () => {
    const roles = actorRoles(oseDirector, approval("PENDING_OSE", "ose_user"));
    expect(roles.isRequester).toBe(true);
    expect(roles.isOseGate).toBe(false);
  });

  it("offers nothing on terminal states or to outsiders", () => {
    expect(availableActions(vp, approval("APPROVED"))).toEqual([]);
    expect(availableActions(vp, approval("REJECTED"))).toEqual([]);
    expect(availableActions(vp, approval("CANCELLED"))).toEqual([]);
    expect(availableActions(outsider, approval("PENDING_PRESIDENT"))).toEqual(
      [],
    );
  });
});

describe("nextStatus", () => {
  it("routes VP submissions through the president gate", () => {
    expect(nextStatus("submit", "DRAFT", { requesterIsPresident: false })).toBe(
      "PENDING_PRESIDENT",
    );
  });

  it("skips the president gate for the president's own requests", () => {
    expect(nextStatus("submit", "DRAFT", { requesterIsPresident: true })).toBe(
      "PENDING_OSE",
    );
    expect(
      nextStatus("resubmit", "NEEDS_CHANGES", { requesterIsPresident: true }),
    ).toBe("PENDING_OSE");
  });

  it("moves through both gates to APPROVED", () => {
    expect(
      nextStatus("approve", "PENDING_PRESIDENT", {
        requesterIsPresident: false,
      }),
    ).toBe("PENDING_OSE");
    expect(
      nextStatus("approve", "PENDING_OSE", { requesterIsPresident: false }),
    ).toBe("APPROVED");
  });

  it("returns null for illegal transitions", () => {
    expect(
      nextStatus("submit", "APPROVED", { requesterIsPresident: false }),
    ).toBeNull();
    expect(
      nextStatus("approve", "DRAFT", { requesterIsPresident: false }),
    ).toBeNull();
    expect(
      nextStatus("resubmit", "DRAFT", { requesterIsPresident: false }),
    ).toBeNull();
    expect(
      nextStatus("cancel", "APPROVED", { requesterIsPresident: false }),
    ).toBeNull();
  });
});

describe("isConcurrentDecision", () => {
  // The status update names the status the decision was read at, so a P2025 from
  // that statement means another approver moved the request first.
  it("recognises Prisma P2025", () => {
    expect(
      isConcurrentDecision({
        code: "P2025",
        message: "Record to update not found.",
      }),
    ).toBe(true);
  });

  it("ignores every other Prisma error code", () => {
    expect(isConcurrentDecision({ code: "P2002" })).toBe(false);
    expect(isConcurrentDecision({ code: "P1001" })).toBe(false);
  });

  // A connection failure or a bug must not be reported to the user as though a
  // colleague had beaten them to the decision.
  it("ignores errors that carry no code", () => {
    expect(isConcurrentDecision(new Error("boom"))).toBe(false);
    expect(isConcurrentDecision(null)).toBe(false);
    expect(isConcurrentDecision(undefined)).toBe(false);
    expect(isConcurrentDecision("P2025")).toBe(false);
    expect(isConcurrentDecision({ code: 2025 })).toBe(false);
  });
});
