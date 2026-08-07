import { lookupRoleTemplate } from "@tenure/authorization";
import { tiersFor, type SystemTiers } from "@tenure/platform-config";

import type { OrgRole, UserContext } from "@/lib/rbac";

import { decideFromSeats, seatGrants, seatWorld } from "./seat-world";

/**
 * GE-051-005 — a club action decided by the engine rather than by a row count.
 *
 * `submitReimbursement` asked "does this person hold an ACTIVE seat here?" and
 * treated yes as permission to file. Every seat answered the same, so a club
 * that gave somebody a read-only advisory seat had given them a spending claim,
 * and every refusal — term not started, module off, no seat at all — arrived as
 * the same sentence.
 */

const TENANT = "inst-1";
const CLUB = "club-1";
const OTHER_CLUB = "club-2";
const MODULES = ["reimbursements", "budgeting", "approvals", "organizations"];

/**
 * What `budgeting` sells, and where a tenant sits in it.
 *
 * The ordering is the module's own — `modules/index.ts` declares
 * ["budget", "ledger", "consolidation"] — and `finance.approver` requires
 * "ledger". A tenant on "budget" therefore holds the bundle and may not use the
 * half of it that belongs to the higher tier.
 */
const onTier = (tier: string): SystemTiers => ({
  tiers: { budgeting: ["budget", "ledger", "consolidation"] },
  currentTier: { budgeting: tier },
});

/** Reimbursements is not a tiered module, so filing is unaffected by any of this. */
const NO_TIERS: SystemTiers = { tiers: {}, currentTier: {} };

const seat = (over: Partial<OrgRole> = {}): OrgRole => ({
  organizationId: CLUB,
  roleId: "r1",
  roleName: "Member",
  scope: "MEMBER",
  status: "ACTIVE",
  templateKey: "unit.member",
  ...over,
});

const ctx = (
  orgRoles: OrgRole[],
  institutionRoles: UserContext["institutionRoles"] = [],
): UserContext => ({
  userId: "u1",
  institutionRoles,
  orgRoles,
});

const file = (
  context: UserContext,
  organizationId = CLUB,
  enabledModules = MODULES,
) =>
  decideFromSeats(context, {
    permission: "finance.reimbursement.create",
    organizationId,
    tenantId: TENANT,
    enabledModules,
    tiers: NO_TIERS,
    at: "2026-08-03T12:00:00Z",
  });

/** Approve a budget — a permission whose bundle requires the `ledger` tier. */
const approveBudget = (context: UserContext, tiers: SystemTiers) =>
  decideFromSeats(context, {
    permission: "finance.budget.approve",
    organizationId: CLUB,
    tenantId: TENANT,
    enabledModules: MODULES,
    tiers,
    at: "2026-08-03T12:00:00Z",
  });

describe("who may file a reimbursement", () => {
  it("lets an ordinary member of the club file", () => {
    // Anybody who spent money on the club's behalf may claim it back. The
    // controlled act is approving, and the duties matrix forbids one person
    // doing both.
    expect(file(ctx([seat()])).allowed).toBe(true);
  });

  it("lets the club's lead file", () => {
    expect(
      file(ctx([seat({ templateKey: "unit.lead", scope: "PRESIDENT" })]))
        .allowed,
    ).toBe(true);
  });

  it("lets the finance officer file", () => {
    expect(file(ctx([seat({ templateKey: "finance.officer" })])).allowed).toBe(
      true,
    );
  });

  it("refuses a read-only advisory seat", () => {
    // The case the old check could not express: an ACTIVE seat that confers
    // watching, not spending.
    const decision = file(ctx([seat({ templateKey: "oversight.advisor" })]));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NO_ROLE_GRANTING");
  });

  it("refuses somebody with no seat here at all", () => {
    expect(file(ctx([])).reason).toBe("NO_MEMBERSHIP");
  });

  it("refuses a seat in a different club", () => {
    // Scope, checked by the engine against the org unit rather than by a
    // `where` clause somebody has to remember to write.
    expect(file(ctx([seat({ organizationId: OTHER_CLUB })])).reason).toBe(
      "OUT_OF_SCOPE",
    );
  });
});

describe("the refusal says which refusal it is", () => {
  it("tells a SHADOW holder their term has not begun", () => {
    // The old check answered this with "you need an active role in this club",
    // which is both wrong and unactionable: they have one, it starts in August.
    const decision = file(ctx([seat({ status: "SHADOW" })]));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("GRANT_NOT_CONFIRMED");
  });

  it("tells a system that does not run reimbursements so", () => {
    const decision = file(ctx([seat()]), CLUB, ["budgeting", "approvals"]);
    expect(decision.reason).toBe("MODULE_NOT_ENABLED");
    expect(decision.detail).toMatch(/reimbursements/);
  });

  it("gives every refusal a detail worth showing", () => {
    for (const decision of [
      file(ctx([seat({ templateKey: "oversight.advisor" })])),
      file(ctx([])),
      file(ctx([seat({ status: "SHADOW" })])),
      file(ctx([seat()]), CLUB, []),
    ]) {
      expect(decision.allowed).toBe(false);
      expect(decision.detail.length).toBeGreaterThan(20);
    }
  });
});

describe("a seat becomes a grant of the bundle it carries", () => {
  it("grants at the club, not the tenant", () => {
    // Tenant scope would make a seat in one club a seat in all of them.
    const [grant] = seatGrants(ctx([seat()]), TENANT);
    expect(grant.scope).toEqual({ kind: "orgUnit", orgUnitId: CLUB });
  });

  it("names the template the seat carries", () => {
    const [grant] = seatGrants(
      ctx([seat({ templateKey: "finance.officer" })]),
      TENANT,
    );
    expect(grant.roleKey).toBe("finance.officer");
    expect(lookupRoleTemplate(grant.roleKey)).not.toBeNull();
  });

  it("confirms an ACTIVE seat and holds a SHADOW one pending", () => {
    const grants = seatGrants(
      ctx([seat(), seat({ roleId: "r2", status: "SHADOW" })]),
      TENANT,
    );
    expect(grants.map((g) => g.state)).toEqual(["CONFIRMED", "PENDING"]);
  });

  it("keeps a SHADOW seat rather than dropping it", () => {
    // Dropping it would make the denial say "you have no role here", which is
    // the answer that generates a support ticket.
    expect(seatGrants(ctx([seat({ status: "SHADOW" })]), TENANT)).toHaveLength(
      1,
    );
  });
});

describe("the world is built from what the application stores", () => {
  it("offers every shipped template as a role definition", () => {
    // A grant naming a template the world does not carry confers nothing, which
    // fails closed and silently.
    const world = seatWorld(ctx([seat()]), TENANT, MODULES, NO_TIERS);
    for (const grant of world.grants) {
      expect(world.roles.some((r) => r.key === grant.roleKey)).toBe(true);
    }
  });

  it("counts a seat holder as a member of the tenant", () => {
    expect(
      seatWorld(ctx([seat()]), TENANT, MODULES, NO_TIERS).memberships,
    ).toHaveLength(1);
  });

  it("counts an OSE member as one too, even with no seat", () => {
    // They are members; what they may do is decided elsewhere, because the
    // three institution roles do not map onto the shipped templates.
    const world = seatWorld(
      ctx([], [{ institutionId: TENANT, role: "OSE_DIRECTOR" }]),
      TENANT,
      MODULES,
      NO_TIERS,
    );
    expect(world.memberships).toHaveLength(1);
    expect(world.grants).toEqual([]);
  });

  it("counts somebody with neither as a member of nothing", () => {
    expect(seatWorld(ctx([]), TENANT, MODULES, NO_TIERS).memberships).toEqual(
      [],
    );
  });
});

describe("the tier a tenant bought decides what the same bundle confers", () => {
  /**
   * REVIEW-FINDINGS P0 #5, the half that was missing.
   *
   * `decide()` has compared tiers by ORDER — not by string equality — since
   * GE-051, and the comparison could never run: the only production builders of
   * an AuthorizationWorld never set `entitlements`, so `tierRank` returned null,
   * `required` was null, and the loop was a no-op on every request. The engine
   * was right and nothing supplied it facts.
   *
   * These two assertions are what prove the WIRING rather than the engine.
   * Delete the `entitlements` line from `seatWorld` and the second one fails —
   * the denial disappears and a tenant on the bottom tier approves budgets.
   */
  const approver = ctx([seat({ templateKey: "finance.approver" })]);

  it("allows the tenant on the tier the bundle requires", () => {
    expect(approveBudget(approver, onTier("ledger")).allowed).toBe(true);
  });

  it("allows a tenant ABOVE it, because tiers are ordered and not equal", () => {
    // The defect the architecture's own SQL has: `tier = min_tier` revokes every
    // capability the moment you sell the customer an upgrade.
    expect(approveBudget(approver, onTier("consolidation")).allowed).toBe(true);
  });

  it("denies the tenant below it, and names the tier", () => {
    const decision = approveBudget(approver, onTier("budget"));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("TIER_TOO_LOW");
    expect(decision.detail).toContain("ledger");
  });

  it("denies a tenant with no recorded tier rather than assuming the lowest", () => {
    // Fail closed. Defaulting an unrecorded tenant to the bottom tier would be a
    // guess about a commercial fact, made in an authorization decision.
    const decision = approveBudget(approver, {
      tiers: { budgeting: ["budget", "ledger", "consolidation"] },
      currentTier: {},
    });
    expect(decision.reason).toBe("TIER_TOO_LOW");
  });

  it("leaves an untiered module's permissions alone", () => {
    // finance.approver also carries reimbursement and approvals permissions,
    // whose modules declare no tiers. A role-wide gate would have taken those
    // with it; the gate is per permission's owning pack.
    expect(
      decideFromSeats(approver, {
        permission: "finance.reimbursement.approve",
        organizationId: CLUB,
        tenantId: TENANT,
        enabledModules: MODULES,
        tiers: onTier("budget"),
        at: "2026-08-03T12:00:00Z",
      }).allowed,
    ).toBe(true);
  });

  it("takes those facts from the real tenant binding, not from a fixture", () => {
    // The production path: `tiersFor` reads the catalog's declared tiers and the
    // binding's recorded sale. If either stops being declared this goes empty
    // and every assertion above becomes a statement about a fixture only.
    const real = tiersFor("rochester");
    expect(real.tiers.budgeting).toEqual([
      "budget",
      "ledger",
      "consolidation",
    ]);
    expect(real.currentTier.budgeting).toBe("ledger");
    expect(approveBudget(approver, real).allowed).toBe(true);
  });
});
