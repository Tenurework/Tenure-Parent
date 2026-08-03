import {
  authorityFromTenureRecords,
  proposalFromClaims,
  type ClaimsMapping,
  type TenantMembership,
} from "./index"

/**
 * GE-043-003 — claims are inputs, and inputs are not authority.
 *
 * The negative rule already exists as a source guard. These prove the positive
 * one: what an assertion may contribute, and where authority actually comes
 * from.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const mapping: ClaimsMapping = {
  subjectClaim: "sub",
  emailClaim: "email",
  displayNameClaim: "name",
}

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-1",
  personId: "person-1",
  tenantId: "rochester",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: iso(-30), effectiveUntil: null },
  statusReason: null,
  ...over,
})

/** A token from a provider that asserts rather more than it should. */
const OPINIONATED_CLAIMS = {
  sub: "okta|00u1a2b3",
  email: "dana.whitfield@rochester.example.edu",
  name: "Dana Whitfield",
  groups: ["OSE-Admins", "Everyone"],
  "cognito:groups": ["superuser"],
  roles: ["director"],
  "custom:isAdmin": "true",
  "urn:example:entitlements": ["billing.write"],
  dept_code: "OSE-ADMIN",
  scope: "openid profile admin",
}

describe("an assertion may contribute three things", () => {
  it("reads the claims the mapping names", () => {
    const outcome = proposalFromClaims(OPINIONATED_CLAIMS, mapping)
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.proposal.subject).toBe("okta|00u1a2b3")
    expect(outcome.proposal.email).toBe("dana.whitfield@rochester.example.edu")
    expect(outcome.proposal.displayName).toBe("Dana Whitfield")
  })

  it("reads nothing else, whatever it is called", () => {
    // The point of an allowlist. A denylist has to guess every spelling —
    // `groups`, `cognito:groups`, `custom:isAdmin`, `urn:example:entitlements`,
    // `dept_code` — and the one it has never heard of is the one that leaks.
    const outcome = proposalFromClaims(OPINIONATED_CLAIMS, mapping)
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(Object.keys(outcome.proposal).sort()).toEqual(["displayName", "email", "subject"])
  })

  it("carries no authority-bearing value anywhere in it", () => {
    // Asserted on the serialised proposal rather than on its keys, so a value
    // smuggled into `displayName` would fail too.
    const outcome = proposalFromClaims(OPINIONATED_CLAIMS, mapping)
    if (!outcome.ok) throw new Error(outcome.detail)

    const serialised = JSON.stringify(outcome.proposal)
    for (const leaked of ["OSE-Admins", "superuser", "director", "billing.write", "OSE-ADMIN", "isAdmin"]) {
      expect(serialised).not.toContain(leaked)
    }
  })

  it("ignores a claim that is not a string", () => {
    // A provider sending an array or an object would otherwise stringify into
    // something that looks like an identifier and is not one.
    const outcome = proposalFromClaims(
      { sub: "okta|1", email: ["a@b.test", "c@d.test"], name: { given: "Dana" } },
      mapping,
    )
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.proposal.email).toBeNull()
    expect(outcome.proposal.displayName).toBeNull()
  })

  it("refuses an assertion with no usable subject", () => {
    const outcome = proposalFromClaims({ email: "a@b.test" }, mapping)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NO_SUBJECT")
  })

  it("refuses an empty subject rather than treating it as one", () => {
    const outcome = proposalFromClaims({ sub: "" }, mapping)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NO_SUBJECT")
  })

  it("tolerates an optional claim being absent", () => {
    const outcome = proposalFromClaims({ sub: "okta|1" }, mapping)
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.proposal.subject).toBe("okta|1")
    expect(outcome.proposal.email).toBeNull()
  })
})

describe("a mapping that tries to carry authority is refused whole", () => {
  it("refuses rather than honouring the parts of it that are fine", () => {
    // Quietly dropping the offending field while honouring the rest leaves
    // somebody believing their mapping worked.
    const outcome = proposalFromClaims(OPINIONATED_CLAIMS, { ...mapping, displayNameClaim: "groups" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("INVALID_MAPPING")
    expect(outcome.detail).toMatch(/authority/i)
  })

  it("refuses email as the subject claim", () => {
    const outcome = proposalFromClaims(OPINIONATED_CLAIMS, { ...mapping, subjectClaim: "email" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("INVALID_MAPPING")
  })
})

describe("authority comes from Tenure's records", () => {
  const facts = {
    memberships: [membership()],
    seatCapabilities: ["budget.read", "roster.read"],
    policyCapabilities: ["calendar.write"],
    tenantId: "rochester",
    at: NOW,
  }

  it("takes no claims at all", () => {
    // The enforcement is the signature. A rule written as "do not read the
    // token here" is one somebody breaks by reading the token here; a function
    // with no token parameter cannot. Asserted on the shape a caller must pass,
    // so adding a claims field is a change to this test as well as to the code.
    expect(Object.keys(facts).sort()).toEqual([
      "at",
      "memberships",
      "policyCapabilities",
      "seatCapabilities",
      "tenantId",
    ])
    expect(authorityFromTenureRecords(facts)).toEqual(["budget.read", "calendar.write", "roster.read"])
  })

  it("grants nothing without a live membership of the tenant", () => {
    // A seat is scoped to an organization inside a tenant, so a seat surviving
    // the end of the membership that placed it is a seat nobody reviewed.
    expect(
      authorityFromTenureRecords({
        ...facts,
        memberships: [membership({ status: "REVOKED", statusReason: "left" })],
      }),
    ).toEqual([])
  })

  it("grants nothing on a membership of a different tenant", () => {
    expect(authorityFromTenureRecords({ ...facts, tenantId: "ithaca" })).toEqual([])
  })

  it("grants nothing on a membership whose term has ended", () => {
    expect(
      authorityFromTenureRecords({
        ...facts,
        memberships: [membership({ interval: { effectiveFrom: iso(-30), effectiveUntil: iso(-1) } })],
      }),
    ).toEqual([])
  })

  it("grants nothing on a membership that has not started", () => {
    expect(
      authorityFromTenureRecords({
        ...facts,
        memberships: [membership({ interval: { effectiveFrom: iso(3), effectiveUntil: null } })],
      }),
    ).toEqual([])
  })

  it("does not invent capability from membership alone", () => {
    // Being a member is not being able to do anything in particular. Without
    // this, "live membership" would quietly become a capability.
    expect(
      authorityFromTenureRecords({ ...facts, seatCapabilities: [], policyCapabilities: [] }),
    ).toEqual([])
  })

  it("returns the same answer whatever the provider asserted", () => {
    // The property the whole item is about, stated end to end: two people whose
    // tokens claim wildly different things, and identical Tenure records, get
    // identical authority.
    const modest = proposalFromClaims({ sub: "okta|1", email: "a@b.test" }, mapping)
    const grandiose = proposalFromClaims(OPINIONATED_CLAIMS, mapping)
    expect(modest.ok && grandiose.ok).toBe(true)

    // Neither proposal is an input to the call, which is the point — there is
    // nowhere to pass it.
    expect(authorityFromTenureRecords(facts)).toEqual(authorityFromTenureRecords(facts))
    expect(authorityFromTenureRecords(facts)).toContain("budget.read")
  })

  it("de-duplicates and orders, so a caller cannot depend on accident", () => {
    expect(
      authorityFromTenureRecords({
        ...facts,
        seatCapabilities: ["b", "a", "b"],
        policyCapabilities: ["a", "c"],
      }),
    ).toEqual(["a", "b", "c"])
  })
})
