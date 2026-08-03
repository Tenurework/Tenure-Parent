import { ROLE_TEMPLATES } from "@tenure/authorization"

import { canManageFinance, carriesFinanceAuthority, type OrgRole, type UserContext } from "@/lib/rbac"

/**
 * GE-051-005 — a seat's authority stops being read from its title.
 *
 * `canManageFinance` decided who may edit a budget by testing a regular
 * expression against the seat's name:
 *
 *     /financ|treasur|\bcfo\b|chief financ|chief operating|\bcoo\b/i
 *
 * Bible §"Decisions" 3 forbids exactly this, and the failure is not
 * hypothetical in either direction. A club that calls the seat "Budget Lead"
 * has somebody accountable for money who cannot touch it. A club with a
 * "Financial Inclusion Officer" — a diversity seat — has somebody who can.
 * Renaming a seat silently moved spending authority, with no record of the
 * change and no date on either side of it.
 *
 * The authority is now a column, chosen when the seat is created.
 */

const ORG = { id: "club-1", institutionId: "inst-1" }

const seat = (over: Partial<OrgRole> = {}): OrgRole => ({
  organizationId: ORG.id,
  roleId: "r1",
  roleName: "VP Finance & Operations",
  scope: "FUNCTIONAL",
  status: "ACTIVE",
  templateKey: "finance.officer",
  ...over,
})

const ctx = (orgRoles: OrgRole[], institutionRoles: UserContext["institutionRoles"] = []): UserContext => ({
  userId: "u1",
  institutionRoles,
  orgRoles,
})

describe("finance authority comes from the bundle the seat was given", () => {
  it("lets a finance officer manage the budget", () => {
    expect(canManageFinance(ctx([seat()]), ORG)).toBe(true)
  })

  it("still lets the president manage it", () => {
    // Unchanged, and asserted so that removing the title regex is not quietly
    // also removing the presidency.
    expect(
      canManageFinance(ctx([seat({ scope: "PRESIDENT", templateKey: "unit.lead" })]), ORG),
    ).toBe(true)
  })

  it("still lets the OSE Director manage it", () => {
    expect(canManageFinance(ctx([], [{ institutionId: "inst-1", role: "OSE_DIRECTOR" }]), ORG)).toBe(
      true,
    )
  })

  it("refuses an ordinary member", () => {
    expect(canManageFinance(ctx([seat({ templateKey: "unit.member" })]), ORG)).toBe(false)
  })

  it("refuses a SHADOW finance officer", () => {
    // Previewing before the term begins is the whole point of SHADOW, and
    // previewing is not spending.
    expect(canManageFinance(ctx([seat({ status: "SHADOW" })]), ORG)).toBe(false)
  })

  it("refuses an ALUMNI finance officer", () => {
    expect(canManageFinance(ctx([seat({ status: "ALUMNI" })]), ORG)).toBe(false)
  })

  it("does not reach into another club", () => {
    expect(canManageFinance(ctx([seat({ organizationId: "club-2" })]), ORG)).toBe(false)
  })
})

describe("the title no longer decides anything", () => {
  it("gives a seat called Budget Lead the authority it was granted", () => {
    // The old regex did not match "Budget Lead", so the person accountable for
    // this club's money could not edit its budget.
    expect(
      canManageFinance(
        ctx([seat({ roleName: "Budget Lead", templateKey: "finance.officer" })]),
        ORG,
      ),
    ).toBe(true)
  })

  it("gives a seat called Financial Inclusion Officer nothing it was not granted", () => {
    // The old regex matched "Financial", so a diversity seat could spend.
    expect(
      canManageFinance(
        ctx([seat({ roleName: "Financial Inclusion Officer", templateKey: "unit.member" })]),
        ORG,
      ),
    ).toBe(false)
  })

  it("does not change what somebody may do when their seat is renamed", () => {
    // The property the column exists for. Under the regex these two answers
    // differed; a rename is a rename.
    const before = canManageFinance(ctx([seat({ roleName: "Treasurer" })]), ORG)
    const after = canManageFinance(ctx([seat({ roleName: "Steward of Funds" })]), ORG)
    expect(after).toBe(before)
    expect(after).toBe(true)
  })
})

describe("the finance bundle is read from the catalog, not listed twice", () => {
  it("recognises every template that confers budget editing", () => {
    for (const template of ROLE_TEMPLATES) {
      const confers = template.permissions.includes("finance.budget.update")
      expect(carriesFinanceAuthority({ templateKey: template.key })).toBe(confers)
    }
  })

  it("finds at least one template that does and one that does not", () => {
    // Otherwise the loop above passes by comparing two constants.
    const conferring = ROLE_TEMPLATES.filter((t) =>
      t.permissions.includes("finance.budget.update"),
    )
    expect(conferring.length).toBeGreaterThan(0)
    expect(conferring.length).toBeLessThan(ROLE_TEMPLATES.length)
  })

  it("refuses a template key the platform does not ship", () => {
    // Fail closed. A key nobody recognises is a seat nobody decided about.
    expect(carriesFinanceAuthority({ templateKey: "finance.everything" })).toBe(false)
    expect(carriesFinanceAuthority({ templateKey: "" })).toBe(false)
  })
})
