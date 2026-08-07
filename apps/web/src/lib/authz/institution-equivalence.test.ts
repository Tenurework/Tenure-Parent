import type { InstitutionRole } from "@prisma/client";

import {
  canListAllOrgs,
  canManageResources,
  canManageRoster,
  canViewOrg,
  isOse,
  isOseDirector,
  type OrgRole,
  type UserContext,
} from "@/lib/rbac";

import { decideAcrossInstitution, INSTITUTION_TEMPLATES } from "./seat-world";

/**
 * No module in this fixture set declares tiers, so no `minTier` can rank and
 * the tier gate is inert here — which is what these equivalence assertions
 * need. The tier gate itself is exercised in `seat-world.test.ts`.
 */
const NO_TIERS = { tiers: {}, currentTier: {} };

/**
 * GE-051-005 — the institution templates must confer exactly what the
 * predicates already do.
 *
 * This is a refactor. Three hand-written booleans in `rbac.ts` decide what the
 * oversight office may do, and they are being replaced by a permission
 * decision. If the two disagree anywhere, that is not a nicer implementation —
 * it is a permission change nobody asked for, and it goes in whichever
 * direction nobody notices.
 *
 * So every claim below is a comparison, not an assertion about what the answer
 * ought to be. The predicates are the specification here, wrong or right.
 */

const TENANT = "inst-1";
const CLUB = "club-1";
const MODULES = [
  "organizations",
  "approvals",
  "events",
  "resources",
  "budgeting",
  "reimbursements",
  "messaging",
  "feed",
  "memory",
  "search",
  "dashboard",
  "administration",
];

const ROLES: InstitutionRole[] = ["OSE_DIRECTOR", "OSE_STAFF", "OSE_ADVISOR"];

const ose = (role: InstitutionRole, orgRoles: OrgRole[] = []): UserContext => ({
  userId: "u1",
  institutionRoles: [{ institutionId: TENANT, role }],
  orgRoles,
});

// ACTIVE by default: these tests are about who may act, not about the
// club lifecycle. The archived-club refusal is tested separately.
const org = { id: CLUB, institutionId: TENANT, status: "ACTIVE" as const };

const allows = (
  ctx: UserContext,
  permission: string,
  organizationId?: string,
) =>
  decideAcrossInstitution(ctx, {
    permission,
    tenantId: TENANT,
    enabledModules: MODULES,
    tiers: NO_TIERS,
    organizationId,
    at: "2026-08-03T12:00:00Z",
  }).allowed;

describe("every institution role maps to a template", () => {
  it("names one for each value of the enum", () => {
    // A value added to the Prisma enum with no entry here resolves to
    // `undefined`, confers nothing, and fails closed silently — for a role
    // somebody had just created and expected to work.
    for (const role of ROLES) {
      expect(typeof INSTITUTION_TEMPLATES[role]).toBe("string");
    }
    expect(Object.keys(INSTITUTION_TEMPLATES).sort()).toEqual(
      [...ROLES].sort(),
    );
  });

  it("gives the three roles three different templates", () => {
    // Mapping them to one would be tidier and would widen two of them.
    expect(new Set(Object.values(INSTITUTION_TEMPLATES)).size).toBe(3);
  });
});

describe("the decision agrees with canManageResources", () => {
  // Director yes, Staff yes, Advisor no. The predicate's own tests pin those
  // three; this pins that the engine says the same.
  it.each(ROLES)("agrees for %s", (role) => {
    const ctx = ose(role);
    expect(allows(ctx, "resources.resource.create")).toBe(
      canManageResources(ctx, TENANT),
    );
  });

  it("is not vacuous — the three roles do not all answer the same", () => {
    // Without this, an engine that allowed everything or nothing would pass
    // every comparison above.
    const answers = ROLES.map((role) =>
      allows(ose(role), "resources.resource.create"),
    );
    expect(new Set(answers).size).toBe(2);
  });
});

describe("the decision agrees with canManageRoster", () => {
  it.each(ROLES)("agrees for %s", (role) => {
    const ctx = ose(role);
    expect(allows(ctx, "org.roster.update", CLUB)).toBe(
      canManageRoster(ctx, org),
    );
  });

  it("is not vacuous — only the Director manages a roster", () => {
    const answers = ROLES.map((role) =>
      allows(ose(role), "org.roster.update", CLUB),
    );
    expect(answers).toEqual([true, false, false]);
  });
});

describe("the decision agrees with canViewOrg and canListAllOrgs", () => {
  it.each(ROLES)("agrees for %s", (role) => {
    const ctx = ose(role);
    expect(allows(ctx, "org.unit.read", CLUB)).toBe(canViewOrg(ctx, org));
    expect(allows(ctx, "org.unit.read")).toBe(canListAllOrgs(ctx, TENANT));
  });

  it("is not vacuous — every OSE role sees every unit", () => {
    // The one that IS the same for all three, asserted so that the comparisons
    // above are known to be comparing a true value somewhere.
    expect(
      ROLES.map((role) => allows(ose(role), "org.unit.read", CLUB)),
    ).toEqual([true, true, true]);
  });
});

describe("the decision agrees with isOse on the second approval gate", () => {
  // `actorRoles` sets `isOseGate: isOse(ctx, institutionId)` — ANY institution
  // role decides there, Advisor included. Giving the permission to the Director
  // alone was a narrowing, which is a permission change in the direction nobody
  // complains about until the Advisor on duty cannot clear the queue.
  it.each(ROLES)("agrees for %s", (role) => {
    const ctx = ose(role);
    expect(allows(ctx, "approvals.request.decide", CLUB)).toBe(
      isOse(ctx, TENANT),
    );
  });

  it("is not vacuous — all three decide, and a non-member does not", () => {
    expect(
      ROLES.map((role) => allows(ose(role), "approvals.request.decide", CLUB)),
    ).toEqual([true, true, true]);
    const outsider: UserContext = {
      userId: "x",
      institutionRoles: [],
      orgRoles: [],
    };
    expect(allows(outsider, "approvals.request.decide", CLUB)).toBe(false);
  });
});

describe("the decision agrees with isOseDirector on budget management", () => {
  it.each(ROLES)("agrees for %s", (role) => {
    const ctx = ose(role);
    expect(allows(ctx, "finance.budget.update", CLUB)).toBe(
      isOseDirector(ctx, TENANT),
    );
  });
});

describe("somebody with no institution role gets nothing from it", () => {
  const outsider: UserContext = {
    userId: "u2",
    institutionRoles: [],
    orgRoles: [],
  };

  it("agrees with isOse", () => {
    expect(isOse(outsider, TENANT)).toBe(false);
    expect(allows(outsider, "org.unit.read", CLUB)).toBe(false);
  });

  it("does not read another institution's role", () => {
    const elsewhere: UserContext = {
      userId: "u3",
      institutionRoles: [{ institutionId: "other-inst", role: "OSE_DIRECTOR" }],
      orgRoles: [],
    };
    expect(isOse(elsewhere, TENANT)).toBe(false);
    expect(allows(elsewhere, "resources.resource.create")).toBe(false);
  });
});

describe("holding both a seat and an institution role", () => {
  const seat: OrgRole = {
    organizationId: CLUB,
    roleId: "r1",
    roleName: "Treasurer",
    scope: "FUNCTIONAL",
    status: "ACTIVE",
    templateKey: "finance.officer",
  };

  it("keeps what the seat confers", () => {
    // An OSE staffer who is also a club treasurer. A world that dropped one set
    // of grants would answer a question about the other wrongly.
    const both = ose("OSE_ADVISOR", [seat]);
    expect(allows(both, "finance.reimbursement.create", CLUB)).toBe(true);
  });

  it("keeps what the institution role confers", () => {
    const both = ose("OSE_STAFF", [seat]);
    expect(allows(both, "resources.resource.create")).toBe(true);
  });

  it("does not let the seat's club scope limit institution authority", () => {
    // The seat is scoped to one club; the institution grant is tenant-wide, and
    // the union has to reach a different club.
    const both = ose("OSE_STAFF", [seat]);
    expect(allows(both, "org.unit.read", "club-2")).toBe(true);
  });
});

describe("a module the system does not run still gates the office", () => {
  it("refuses resource publishing when resources is off", () => {
    // Institution authority is not a way past module enablement.
    const ctx = ose("OSE_DIRECTOR");
    const decision = decideAcrossInstitution(ctx, {
      permission: "resources.resource.create",
      tenantId: TENANT,
      enabledModules: MODULES.filter((m) => m !== "resources"),
      tiers: NO_TIERS,
      at: "2026-08-03T12:00:00Z",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("MODULE_NOT_ENABLED");
  });
});
