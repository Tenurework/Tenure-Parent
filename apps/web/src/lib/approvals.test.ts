import type { ApprovalStatus, OrgStatus } from "@prisma/client";
import {
  actorRoles,
  approvalAuthorityFor,
  approvalDigest,
  approvalMoney,
  availableActions,
  decisionControl,
  exceedsApprovalThreshold,
  isConcurrentDecision,
  isGateStep,
  nextStatus,
  NO_STANDING_DECLARATIONS,
  recordedPayloadDigest,
  toMinorUnits,
  APPROVAL_DIGEST_FIELDS,
  type ApprovalAuthority,
  type ApprovalView,
} from "./approvals";
import type { UserContext } from "./rbac";

const INST = "inst_1";
const ORG = "org_1";

/**
 * The ladder these cases are decided against: $5,000.00, and nothing else
 * priced. Written out rather than resolved from configuration so a case says
 * what it is testing — `approvalAuthorityFor` is exercised separately, against
 * the real registry, further down.
 */
const LADDER: ApprovalAuthority = { thresholds: { USD: 500_000 } };

/** No money on the request: the shape every pre-PAY-150-002 case is in. */
const NO_MONEY = { amountMinorUnits: null, currency: "USD" } as const;

function approval(
  status: ApprovalStatus,
  submittedById = "vp_user",
  // ACTIVE unless a test says otherwise: these cases are about who may act on a
  // request, not about the club's lifecycle.
  organizationStatus: OrgStatus = "ACTIVE",
  money: { amountMinorUnits: number | null; currency: string } = NO_MONEY,
): ApprovalView {
  return {
    id: "ap_1",
    status,
    submittedById,
    // Nobody else prepared these: the maker-checker arm is exercised in
    // approvals-world's own cases, and naming a preparer here would change
    // which refusal every case below produces.
    preparedById: null,
    organizationId: ORG,
    institutionId: INST,
    controlWorld: NO_STANDING_DECLARATIONS,
    organizationStatus,
    // A fact about the submitter. The two president fixtures below are the only
    // ones who hold the seat.
    requesterIsPresident:
      submittedById === "pres_user" || submittedById === "ose_pres",
    ...money,
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
/** Staff, not the director. Holds the ordinary gate and not the extra one. */
const oseStaff = ctx("ose_staff_user", {
  institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }],
});
const outsider = ctx("random_user");

describe("availableActions", () => {
  it("lets the requester submit or cancel a draft", () => {
    expect(availableActions(vp, approval("DRAFT"), LADDER)).toEqual([
      "submit",
      "cancel",
    ]);
    expect(availableActions(president, approval("DRAFT"), LADDER)).toEqual([]);
  });

  it("gates PENDING_PRESIDENT on the active president", () => {
    const a = approval("PENDING_PRESIDENT");
    expect(availableActions(president, a, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
    expect(availableActions(vp, a, LADDER)).toEqual(["cancel"]); // requester may withdraw
    expect(availableActions(oseDirector, a, LADDER)).toEqual([]); // not their gate yet
  });

  it("gates PENDING_OSE on OSE staff", () => {
    const a = approval("PENDING_OSE");
    expect(availableActions(oseDirector, a, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
    expect(availableActions(president, a, LADDER)).toEqual([]);
  });

  it("lets only the requester resubmit after NEEDS_CHANGES", () => {
    const a = approval("NEEDS_CHANGES");
    expect(availableActions(vp, a, LADDER)).toEqual(["resubmit", "cancel"]);
    expect(availableActions(president, a, LADDER)).toEqual([]);
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
    expect(availableActions(oseDirector, own, LADDER)).toEqual(["cancel"]);
  });

  it("still lets a different OSE member decide the same request", () => {
    const own = approval("PENDING_OSE", "ose_user");
    const colleague = ctx("ose_user_2", {
      institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
    });
    expect(availableActions(colleague, own, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("refuses the president gate to a president who raised the request", () => {
    // Reachable: a VP submits, the request sits at PENDING_PRESIDENT, and the
    // VP is then given the president seat.
    const own = approval("PENDING_PRESIDENT", "pres_user");
    expect(availableActions(president, own, LADDER)).toEqual(["cancel"]);
  });

  it("leaves the requester's own actions alone", () => {
    // submit / resubmit / cancel are the requester's, not a second pair of
    // eyes. A control that took those away would stop people filing requests.
    expect(
      availableActions(oseDirector, approval("DRAFT", "ose_user"), LADDER),
    ).toEqual(["submit", "cancel"]);
    expect(
      availableActions(
        oseDirector,
        approval("NEEDS_CHANGES", "ose_user"),
        LADDER,
      ),
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
    expect(availableActions(oseAndPresident, draft, LADDER)).toEqual([
      "submit",
      "cancel",
    ]);

    const afterSubmit = nextStatus("submit", "DRAFT", {
      requesterIsPresident: true,
      exceedsThreshold: false,
    });
    expect(afterSubmit).toBe("PENDING_OSE");

    const pending = approval(afterSubmit!, "ose_pres");
    const offered = availableActions(oseAndPresident, pending, LADDER);
    expect(offered).toEqual(["cancel"]);
    expect(
      offered.some(
        (a) =>
          nextStatus(a, "PENDING_OSE", {
            requesterIsPresident: true,
            exceedsThreshold: false,
          }) === "APPROVED",
      ),
    ).toBe(false);
  });

  it("names the refusal, rather than answering with a bare boolean", () => {
    // The rule is @tenure/authorization's `mayDecide`, not a local `===` — so
    // support gets "because you raised it" and the other refusal arms
    // (recusal, declared conflict, four-eyes) arrive already wired.
    expect(
      decisionControl(oseDirector, approval("PENDING_OSE", "ose_user")),
    ).toEqual({
      ok: false,
      refusal: "SELF_APPROVAL",
      detail: "A request cannot be decided by the person who raised it.",
    });
    expect(
      decisionControl(oseDirector, approval("PENDING_OSE", "vp_user")),
    ).toEqual({ ok: true });
  });

  it("drops the gate role without pretending they are not the requester", () => {
    const roles = actorRoles(oseDirector, approval("PENDING_OSE", "ose_user"));
    expect(roles.isRequester).toBe(true);
    expect(roles.isOseGate).toBe(false);
  });

  it("offers nothing on terminal states or to outsiders", () => {
    expect(availableActions(vp, approval("APPROVED"), LADDER)).toEqual([]);
    expect(availableActions(vp, approval("REJECTED"), LADDER)).toEqual([]);
    expect(availableActions(vp, approval("CANCELLED"), LADDER)).toEqual([]);
    expect(
      availableActions(outsider, approval("PENDING_PRESIDENT"), LADDER),
    ).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────── PAY-150-002 */

describe("approval authority is aware of the money on the request", () => {
  const usd = (major: number) => ({
    amountMinorUnits: major * 100,
    currency: "USD",
  });

  it("lets any staff seat give final approval below the ceiling", () => {
    const small = approval("PENDING_OSE", "vp_user", "ACTIVE", usd(5));
    expect(availableActions(oseStaff, small, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("takes final approval away from a staff seat above the ceiling", () => {
    // The whole requirement in one assertion: a $5 request and a $500,000
    // request no longer take the identical two gates. The staff seat keeps
    // every action that does NOT commit the money.
    const large = approval("PENDING_OSE", "vp_user", "ACTIVE", usd(500_000));
    expect(availableActions(oseStaff, large, LADDER)).toEqual([
      "request_changes",
      "reject",
    ]);
  });

  it("gives it to the director instead, rather than to nobody", () => {
    const large = approval("PENDING_OSE", "vp_user", "ACTIVE", usd(500_000));
    expect(availableActions(oseDirector, large, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
    // …and the director's own request still is not theirs to approve.
    const ownLarge = approval("PENDING_OSE", "ose_user", "ACTIVE", usd(500_000));
    expect(availableActions(oseDirector, ownLarge, LADDER)).toEqual(["cancel"]);
  });

  it("puts the boundary exactly at the ceiling, not one unit either side", () => {
    const at = approval("PENDING_OSE", "vp_user", "ACTIVE", usd(5_000));
    const over = approval("PENDING_OSE", "vp_user", "ACTIVE", {
      amountMinorUnits: 500_001,
      currency: "USD",
    });
    expect(availableActions(oseStaff, at, LADDER)).toContain("approve");
    expect(availableActions(oseStaff, over, LADDER)).not.toContain("approve");
  });

  it("compares in the request's currency, not in bare integers", () => {
    // ¥1,000 is about $7 and is 1000 minor units, because JPY has no minor
    // unit. Compared as a bare integer against a 500,000-minor-unit USD
    // ceiling it sails through. It must not: the ladder prices no JPY, so it
    // fails CLOSED and needs the director.
    const yen = approval("PENDING_OSE", "vp_user", "ACTIVE", {
      amountMinorUnits: 1_000,
      currency: "JPY",
    });
    expect(exceedsApprovalThreshold(yen, LADDER)).toBe(true);
    expect(availableActions(oseStaff, yen, LADDER)).toEqual([
      "request_changes",
      "reject",
    ]);
    expect(availableActions(oseDirector, yen, LADDER)).toContain("approve");

    // …and the same integer in the priced currency is genuinely small.
    const dollars = approval("PENDING_OSE", "vp_user", "ACTIVE", {
      amountMinorUnits: 1_000,
      currency: "USD",
    });
    expect(exceedsApprovalThreshold(dollars, LADDER)).toBe(false);
    expect(availableActions(oseStaff, dollars, LADDER)).toContain("approve");
  });

  it("prices a request with no amount as never over the ceiling", () => {
    // An event proposal is not a large payment, and a ladder that fired on it
    // would send every club meeting to the director.
    expect(exceedsApprovalThreshold(NO_MONEY, LADDER)).toBe(false);
    expect(
      exceedsApprovalThreshold(
        { amountMinorUnits: null, currency: "XYZ" },
        LADDER,
      ),
    ).toBe(false);
  });

  it("leaves the president gate alone — it is the final gate that is priced", () => {
    const large = approval(
      "PENDING_PRESIDENT",
      "vp_user",
      "ACTIVE",
      usd(500_000),
    );
    expect(availableActions(president, large, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("resolves the ladder from configuration, not from a literal", () => {
    // Through the real registry: the key has to exist, be inside a domain's
    // authority, validate against its zod type and carry a default. A typo in
    // the key would throw here rather than resolve to an empty ladder that
    // fails every request closed.
    const platformDefault = approvalAuthorityFor("");
    expect(platformDefault.thresholds).toEqual({ USD: 500_000 });
    // A real bound tenant resolves it too — the layers are applied and nothing
    // in the chain strips a key it is not allowed to see.
    expect(approvalAuthorityFor("rochester").thresholds.USD).toBe(500_000);
  });
});

describe("toMinorUnits", () => {
  it("converts a written amount without floating-point drift", () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754, and a threshold decided
    // one minor unit out is a threshold decided wrongly.
    expect(toMinorUnits("19.99", "USD")).toBe(1999);
    expect(toMinorUnits("0.07", "USD")).toBe(7);
    expect(toMinorUnits("1,200.50", "USD")).toBe(120050);
    expect(toMinorUnits("$50", "USD")).toBe(5000);
    expect(toMinorUnits("5000", "USD")).toBe(500000);
  });

  it("uses the currency's own exponent", () => {
    expect(toMinorUnits("1200", "JPY")).toBe(1200); // no minor unit at all
    expect(toMinorUnits("1.234", "KWD")).toBe(1234); // three digits
  });

  it("refuses text that is not a number", () => {
    expect(toMinorUnits("", "USD")).toBeNull();
    expect(toMinorUnits("about fifty", "USD")).toBeNull();
    expect(toMinorUnits("12.5.6", "USD")).toBeNull();
  });
});

describe("approvalMoney", () => {
  it("reads the reimbursement leg", () => {
    expect(
      approvalMoney(
        { currency: "USD", reimbursement: { amountCents: 5000 } },
        "USD",
      ),
    ).toEqual({ amountMinorUnits: 5000, currency: "USD" });
  });

  it("reads the free-text amount the general form collects", () => {
    expect(approvalMoney({ amount: "1200.50" }, "USD")).toEqual({
      amountMinorUnits: 120050,
      currency: "USD",
    });
  });

  it("falls back to the institution's currency, and only to a valid code", () => {
    expect(approvalMoney({ amount: "10" }, "EUR").currency).toBe("EUR");
    expect(approvalMoney({ amount: "10", currency: "nonsense" }, "EUR").currency)
      .toBe("EUR");
    expect(approvalMoney({ amount: "10", currency: "jpy" }, "EUR")).toEqual({
      amountMinorUnits: 10,
      currency: "JPY",
    });
  });

  it("says null rather than zero when a request carries no money", () => {
    // Zero is an amount. "No amount" is not, and collapsing them would price
    // every event proposal as a $0.00 payment.
    expect(approvalMoney({ venue: "Schlegel 203" }, "USD").amountMinorUnits)
      .toBeNull();
    expect(approvalMoney(null, "USD").amountMinorUnits).toBeNull();
    expect(approvalMoney("not an object", "USD").amountMinorUnits).toBeNull();
    expect(approvalMoney({ amount: "0" }, "USD").amountMinorUnits).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────── PAY-150-004 */

describe("approvalDigest", () => {
  const subject = {
    organizationId: ORG,
    type: "EXCEPTION" as const,
    amountMinorUnits: 5000,
    currency: "USD",
  };
  const metadata = {
    currency: "USD",
    reimbursement: {
      budgetLineId: "line_1",
      amountCents: 5000,
      documentId: "doc_1",
      category: "Venue & Space",
    },
  };

  it("is a sha-256 hex digest", () => {
    expect(approvalDigest(metadata, subject)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on the order keys were written in", () => {
    const reordered = {
      reimbursement: {
        category: "Venue & Space",
        documentId: "doc_1",
        amountCents: 5000,
        budgetLineId: "line_1",
      },
      currency: "USD",
    };
    expect(approvalDigest(reordered, subject)).toBe(
      approvalDigest(metadata, subject),
    );
  });

  it("moves when the amount moves", () => {
    expect(
      approvalDigest(metadata, { ...subject, amountMinorUnits: 500_000 }),
    ).not.toBe(approvalDigest(metadata, subject));
  });

  it("moves when the destination of the money moves", () => {
    const base = approvalDigest(metadata, subject);
    const otherLine = {
      ...metadata,
      reimbursement: { ...metadata.reimbursement, budgetLineId: "line_2" },
    };
    const otherReceipt = {
      ...metadata,
      reimbursement: { ...metadata.reimbursement, documentId: "doc_2" },
    };
    expect(approvalDigest(otherLine, subject)).not.toBe(base);
    expect(approvalDigest(otherReceipt, subject)).not.toBe(base);
    expect(
      approvalDigest({ ...metadata, recipient: "user_9" }, subject),
    ).not.toBe(base);
    expect(
      approvalDigest({ ...metadata, vendorId: "vendor_9" }, subject),
    ).not.toBe(base);
    expect(approvalDigest(metadata, { ...subject, currency: "EUR" })).not.toBe(
      base,
    );
    expect(
      approvalDigest(metadata, { ...subject, organizationId: "org_2" }),
    ).not.toBe(base);
  });

  it("moves when the schedule moves", () => {
    const event = { currency: "USD", venue: "Schlegel 203", startAt: "2026-09-05T22:00:00.000Z", endAt: "2026-09-06T00:00:00.000Z" };
    const eventSubject = {
      organizationId: ORG,
      type: "EVENT" as const,
      amountMinorUnits: null,
      currency: "USD",
    };
    const base = approvalDigest(event, eventSubject);
    expect(
      approvalDigest({ ...event, startAt: "2026-09-12T22:00:00.000Z" }, eventSubject),
    ).not.toBe(base);
    expect(approvalDigest({ ...event, venue: "Gleason 318" }, eventSubject))
      .not.toBe(base);
  });

  it("ignores fields a decision is not about", () => {
    // A typo fix in a note must not invalidate an approval, or people learn to
    // route around the control rather than through it.
    expect(
      approvalDigest({ ...metadata, note: "fixed a typo" }, subject),
    ).toBe(approvalDigest(metadata, subject));
    expect(
      approvalDigest(
        {
          ...metadata,
          reimbursement: {
            ...metadata.reimbursement,
            category: "renamed line label",
          },
        },
        subject,
      ),
    ).toBe(approvalDigest(metadata, subject));
  });

  it("hashes its fields in sorted order", () => {
    // The canonical form is built by walking this list, so the list being
    // sorted is what "key-sorted" means here.
    expect([...APPROVAL_DIGEST_FIELDS]).toEqual(
      [...APPROVAL_DIGEST_FIELDS].sort(),
    );
  });
});

describe("recordedPayloadDigest", () => {
  it("reads a digest a gate recorded", () => {
    const digest = "a".repeat(64);
    expect(recordedPayloadDigest({ payloadDigest: digest })).toBe(digest);
  });

  it("answers null — not a mismatch — when a gate recorded none", () => {
    // Every step written before this control existed is in this position, and
    // refusing those would freeze every request already in flight.
    expect(recordedPayloadDigest({ requesterIsPresident: true })).toBeNull();
    expect(recordedPayloadDigest(null)).toBeNull();
    expect(recordedPayloadDigest(undefined)).toBeNull();
    expect(recordedPayloadDigest({ payloadDigest: 42 })).toBeNull();
    expect(recordedPayloadDigest({ payloadDigest: "short" })).toBeNull();
  });
});

describe("isGateStep", () => {
  it("counts a real transition into a pending gate", () => {
    expect(
      isGateStep({ fromStatus: "DRAFT", toStatus: "PENDING_PRESIDENT" }),
    ).toBe(true);
    expect(
      isGateStep({ fromStatus: "PENDING_PRESIDENT", toStatus: "PENDING_OSE" }),
    ).toBe(true);
  });

  it("does not count the calendar's same-status amendment", () => {
    // `syncApprovalSnapshot` appends PENDING_OSE → PENDING_OSE when an event is
    // rescheduled, and it REWRITES the metadata as it does. Counting it as a
    // gate would let a reschedule re-bless itself.
    expect(
      isGateStep({ fromStatus: "PENDING_OSE", toStatus: "PENDING_OSE" }),
    ).toBe(false);
  });

  it("does not count a decision out of the chain", () => {
    expect(
      isGateStep({ fromStatus: "PENDING_OSE", toStatus: "APPROVED" }),
    ).toBe(false);
    expect(
      isGateStep({ fromStatus: "PENDING_OSE", toStatus: "NEEDS_CHANGES" }),
    ).toBe(false);
  });
});

describe("nextStatus", () => {
  const ordinary = { requesterIsPresident: false, exceedsThreshold: false };

  it("routes VP submissions through the president gate", () => {
    expect(nextStatus("submit", "DRAFT", ordinary)).toBe("PENDING_PRESIDENT");
  });

  it("skips the president gate for the president's own requests", () => {
    expect(
      nextStatus("submit", "DRAFT", {
        requesterIsPresident: true,
        exceedsThreshold: false,
      }),
    ).toBe("PENDING_OSE");
    expect(
      nextStatus("resubmit", "NEEDS_CHANGES", {
        requesterIsPresident: true,
        exceedsThreshold: false,
      }),
    ).toBe("PENDING_OSE");
  });

  it("moves through both gates to APPROVED", () => {
    expect(nextStatus("approve", "PENDING_PRESIDENT", ordinary)).toBe(
      "PENDING_OSE",
    );
    expect(nextStatus("approve", "PENDING_OSE", ordinary)).toBe("APPROVED");
  });

  it("still reaches APPROVED over the ceiling — by the director's transition", () => {
    // The extra gate changes WHO, not WHERE. A large request that could not be
    // approved at all would be a different product decision, and one nobody
    // made.
    expect(
      nextStatus("approve", "PENDING_OSE", {
        requesterIsPresident: false,
        exceedsThreshold: true,
      }),
    ).toBe("APPROVED");
  });

  it("returns null for illegal transitions", () => {
    expect(nextStatus("submit", "APPROVED", ordinary)).toBeNull();
    expect(nextStatus("approve", "DRAFT", ordinary)).toBeNull();
    expect(nextStatus("resubmit", "DRAFT", ordinary)).toBeNull();
    expect(nextStatus("cancel", "APPROVED", ordinary)).toBeNull();
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

// ── PAY-150-003: maker-checker, recusal and declared conflict ────────────────
//
// Three of `mayDecide`'s six arms were unreachable from the product. SAME_MAKER
// was lost because the DecisionUnderReview never named a preparer; RECUSED and
// DECLARED_CONFLICT were lost because the world was a hardcoded `{}`.
//
// Asserted through `availableActions` — the function the detail page and
// `actOnApproval` actually call — not through `mayDecide` directly. A test that
// calls the engine proves the engine works, which was never in doubt; what was
// in doubt is whether anything reaches it.

describe("maker-checker (SAME_MAKER)", () => {
  it("refuses the gate to a decider who PREPARED the request but did not raise it", () => {
    const prepared = {
      ...approval("PENDING_OSE", "vp_user"),
      preparedById: "ose_user",
    };

    expect(decisionControl(oseDirector, prepared).refusal).toBe("SAME_MAKER");
    expect(availableActions(oseDirector, prepared, LADDER)).toEqual([]);
  });

  it("still offers the gate to a DIFFERENT OSE member", () => {
    const prepared = {
      ...approval("PENDING_OSE", "vp_user"),
      preparedById: "ose_user",
    };
    expect(availableActions(oseStaff, prepared, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("answers SELF_APPROVAL first when the preparer also raised it", () => {
    // Both arms apply. "You raised this" is the better answer, and the order in
    // `mayDecide` is what makes it the one shown.
    const own = {
      ...approval("PENDING_OSE", "ose_user"),
      preparedById: "ose_user",
    };
    expect(decisionControl(oseDirector, own).refusal).toBe("SELF_APPROVAL");
  });
});

describe("recusal (RECUSED)", () => {
  const recusalWorld = {
    recusals: [
      {
        principalId: "ose_user",
        tenantId: INST,
        resourceId: "ap_1",
        reason: "I know the requester personally.",
        at: "2026-08-01T00:00:00.000Z",
      },
    ],
  };

  it("removes the gate from somebody who stood down from THIS decision", () => {
    const a = { ...approval("PENDING_OSE"), controlWorld: recusalWorld };
    expect(decisionControl(oseDirector, a).refusal).toBe("RECUSED");
    expect(availableActions(oseDirector, a, LADDER)).toEqual([]);
  });

  it("does not touch anybody else's gate", () => {
    const a = { ...approval("PENDING_OSE"), controlWorld: recusalWorld };
    expect(availableActions(oseStaff, a, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });

  it("changes nothing when the recusal names a different request", () => {
    // A recusal is an act about ONE decision. A recusal that leaked across
    // requests would be a person quietly removing themselves from everything.
    const a = {
      ...approval("PENDING_OSE"),
      controlWorld: {
        recusals: [{ ...recusalWorld.recusals[0], resourceId: "ap_other" }],
      },
    };
    expect(availableActions(oseDirector, a, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });
});

describe("declared conflict (DECLARED_CONFLICT)", () => {
  const conflictIn = (subjectId: string) => ({
    conflicts: [
      {
        principalId: "ose_user",
        tenantId: INST,
        subjectId,
        reason: "My partner works for them.",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
  });

  it("removes the gate when the interest is in a subject this decision touches", () => {
    const a = { ...approval("PENDING_OSE"), controlWorld: conflictIn(ORG) };
    expect(decisionControl(oseDirector, a, "2026-08-01T00:00:00.000Z").refusal).toBe(
      "DECLARED_CONFLICT",
    );
    expect(availableActions(oseDirector, a, LADDER)).toEqual([]);
  });

  it("leaves the gate alone when the interest is in something else", () => {
    const a = { ...approval("PENDING_OSE"), controlWorld: conflictIn("org_other") };
    expect(availableActions(oseDirector, a, LADDER)).toEqual([
      "approve",
      "request_changes",
      "reject",
    ]);
  });
});
