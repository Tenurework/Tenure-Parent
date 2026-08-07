import {
  canContribute,
  canListAllOrgs,
  canManageFinance,
  canManageOrg,
  canManageResources,
  canManageRoster,
  canViewFinance,
  canViewOrg,
  isOse,
  isOseDirector,
  type UserContext,
} from "./rbac";

const INST = "inst_1";
// ACTIVE by default: these tests are about who may act, not about the
// club lifecycle. The archived-club refusal is tested separately.
const ORG = { id: "org_1", institutionId: INST, status: "ACTIVE" as const };
const OTHER_ORG = {
  id: "org_2",
  institutionId: INST,
  status: "ACTIVE" as const,
};

function ctx(overrides: Partial<UserContext> = {}): UserContext {
  return { userId: "user_1", institutionRoles: [], orgRoles: [], ...overrides };
}

const president = (status: "SHADOW" | "ACTIVE" | "ALUMNI"): UserContext =>
  ctx({
    orgRoles: [
      {
        organizationId: ORG.id,
        roleId: "role_pres",
        roleName: "President",
        templateKey: "unit.lead",
        scope: "PRESIDENT",
        status,
      },
    ],
  });

const member = (status: "SHADOW" | "ACTIVE" | "ALUMNI"): UserContext =>
  ctx({
    orgRoles: [
      {
        organizationId: ORG.id,
        roleId: "role_member",
        roleName: "Member",
        templateKey: "unit.member",
        scope: "MEMBER",
        status,
      },
    ],
  });

describe("institution-level checks", () => {
  it("recognizes any OSE membership", () => {
    const staff = ctx({
      institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }],
    });
    expect(isOse(staff, INST)).toBe(true);
    expect(isOseDirector(staff, INST)).toBe(false);
  });

  it("scopes OSE membership to the institution", () => {
    const director = ctx({
      institutionRoles: [{ institutionId: "other_inst", role: "OSE_DIRECTOR" }],
    });
    expect(isOse(director, INST)).toBe(false);
    expect(canListAllOrgs(director, INST)).toBe(false);
  });
});

describe("canViewOrg", () => {
  it("allows any OSE role to view any club", () => {
    const advisor = ctx({
      institutionRoles: [{ institutionId: INST, role: "OSE_ADVISOR" }],
    });
    expect(canViewOrg(advisor, ORG)).toBe(true);
  });

  it("allows ACTIVE and SHADOW members, denies ALUMNI", () => {
    expect(canViewOrg(member("ACTIVE"), ORG)).toBe(true);
    expect(canViewOrg(member("SHADOW"), ORG)).toBe(true);
    expect(canViewOrg(member("ALUMNI"), ORG)).toBe(false);
  });

  it("denies members of other orgs", () => {
    expect(canViewOrg(member("ACTIVE"), OTHER_ORG)).toBe(false);
  });

  it("denies users with no roles at all", () => {
    expect(canViewOrg(ctx(), ORG)).toBe(false);
  });
});

describe("canManageRoster", () => {
  it("allows OSE Director but not OSE Staff", () => {
    const director = ctx({
      institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
    });
    const staff = ctx({
      institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }],
    });
    expect(canManageRoster(director, ORG)).toBe(true);
    expect(canManageRoster(staff, ORG)).toBe(false);
  });

  it("allows only the ACTIVE president — SHADOW is read-only", () => {
    expect(canManageRoster(president("ACTIVE"), ORG)).toBe(true);
    expect(canManageRoster(president("SHADOW"), ORG)).toBe(false);
    expect(canManageRoster(president("ALUMNI"), ORG)).toBe(false);
  });

  it("denies active non-president members", () => {
    expect(canManageRoster(member("ACTIVE"), ORG)).toBe(false);
  });
});

/**
 * GE-085-004 — archiving a club suspends what can be done TO it, not what is
 * recorded ABOUT it.
 *
 * `Organization.status` existed and was decoration: `/orgs` and `/admin/clubs`
 * greyed an archived club out, and every write path went on accepting changes
 * to it, because the authority checks took `{ id, institutionId }` and never
 * looked. These pin both halves — writes refused, reads untouched — because a
 * fix that also hid the history would be a worse bug than the one it replaced.
 */
describe("an archived club", () => {
  const ARCHIVED = {
    id: "org_1",
    institutionId: INST,
    status: "ARCHIVED" as const,
  };
  const PENDING = {
    id: "org_1",
    institutionId: INST,
    status: "PENDING" as const,
  };
  const director = ctx({
    institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
  });

  it("takes no writes, not even from the OSE Director", () => {
    // Deliberately including the Director. Nobody edits a retired club's roster
    // or budget in place; reactivating it is a separate, deliberate act that
    // does NOT come through these predicates (setClubStatus gates on
    // isOseDirector directly), so refusing here cannot strand a club archived.
    expect(canManageRoster(director, ARCHIVED)).toBe(false);
    expect(canManageOrg(director, ARCHIVED)).toBe(false);
    expect(canContribute(director, ARCHIVED)).toBe(false);
    expect(canManageFinance(director, ARCHIVED)).toBe(false);
  });

  it("takes no writes from its own former president either", () => {
    expect(canManageRoster(president("ACTIVE"), ARCHIVED)).toBe(false);
    expect(canContribute(member("ACTIVE"), ARCHIVED)).toBe(false);
  });

  it("stays fully readable — the record is preserved, not hidden", () => {
    expect(canViewOrg(director, ARCHIVED)).toBe(true);
    expect(canViewOrg(member("ACTIVE"), ARCHIVED)).toBe(true);
    expect(canViewFinance(director, ARCHIVED)).toBe(true);
  });

  it("refuses writes to a club that has not been approved into existence yet", () => {
    // PENDING is the other non-ACTIVE state: a club nobody has approved should
    // not be accumulating documents or budget lines before it exists.
    expect(canManageRoster(director, PENDING)).toBe(false);
    expect(canContribute(member("ACTIVE"), PENDING)).toBe(false);
  });

  it("still lets an ACTIVE club through, so the gate is not simply off", () => {
    expect(canManageRoster(director, ORG)).toBe(true);
    expect(canContribute(member("ACTIVE"), ORG)).toBe(true);
  });
});

describe("canContribute", () => {
  it("requires ACTIVE status — SHADOW is read-only", () => {
    expect(canContribute(member("ACTIVE"), ORG)).toBe(true);
    expect(canContribute(member("SHADOW"), ORG)).toBe(false);
    expect(canContribute(member("ALUMNI"), ORG)).toBe(false);
  });
});

describe("canManageResources", () => {
  const director = ctx({
    institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
  });
  const staff = ctx({
    institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }],
  });
  const advisor = ctx({
    institutionRoles: [{ institutionId: INST, role: "OSE_ADVISOR" }],
  });

  it("lets the OSE Director publish resources", () => {
    // The gap this closes: the Director owns the board-resource programme and
    // previously had no way to add one, because resources were hardcoded.
    expect(canManageResources(director, INST)).toBe(true);
  });

  it("lets OSE Staff maintain them day to day", () => {
    expect(canManageResources(staff, INST)).toBe(true);
  });

  it("keeps advisors and club officers read-only", () => {
    expect(canManageResources(advisor, INST)).toBe(false);
    expect(canManageResources(president("ACTIVE"), INST)).toBe(false);
    expect(canManageResources(member("ACTIVE"), INST)).toBe(false);
    expect(canManageResources(ctx(), INST)).toBe(false);
  });

  it("does not leak across institutions", () => {
    expect(canManageResources(director, "inst_other")).toBe(false);
  });
});
