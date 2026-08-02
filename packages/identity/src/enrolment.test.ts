import {
  ENROLMENT_POLICIES,
  admitToTenant,
  enrolmentPolicy,
  selfSignUpBreaches,
  type Invitation,
  type Person,
  type TenantEnrolment,
} from "./index"

/**
 * GE-041-004 — nobody arrives without being invited.
 *
 * Bible §9.1: "approved Cognito local authentication, invitation-only by
 * default". The word doing the work is *default* — self-service sign-up must be
 * a decision a tenant records, not a state a tenant falls into because a field
 * was never set.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const tenant = (over: Partial<TenantEnrolment> = {}): TenantEnrolment => ({
  tenantId: "rochester",
  verifiedDomains: ["rochester.example"],
  ...over,
})

const invitation = (over: Partial<Invitation> = {}): Invitation => ({
  id: "inv-1",
  tenantId: "rochester",
  sentToEmail: "newcomer@rochester.example",
  invitedBy: "director@rochester.example",
  status: "PENDING",
  createdAt: days(-1),
  expiresAt: days(6),
  acceptedByPersonId: null,
  ...over,
})

const request = (over: Partial<Parameters<typeof admitToTenant>[0]> = {}) => ({
  tenant: tenant(),
  email: "newcomer@rochester.example",
  invitation: invitation(),
  existingMember: null as Person | null,
  at: NOW,
  ...over,
})

describe("the default is closed, and it is closed by absence", () => {
  it("is invitation-only when the tenant has decided nothing", () => {
    // A misconfiguration must fail closed. Failing open means the first sign
    // anything is wrong is a stranger inside a university's finance module.
    expect(enrolmentPolicy({ tenantId: "x", verifiedDomains: [] })).toBe("INVITATION_ONLY")
  })

  it("refuses an uninvited arrival at a tenant that has decided nothing", () => {
    const outcome = admitToTenant(request({ tenant: { tenantId: "x", verifiedDomains: [] }, invitation: null }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_REQUIRED")
  })

  it("only opens when a tenant says so explicitly", () => {
    expect(enrolmentPolicy(tenant({ policy: "OPEN_TO_VERIFIED_DOMAIN" }))).toBe("OPEN_TO_VERIFIED_DOMAIN")
    expect(ENROLMENT_POLICIES).toHaveLength(2)
  })
})

describe("an invitation is single-use, tenant-bound and expiring", () => {
  it("admits the person it was addressed to", () => {
    const outcome = admitToTenant(request())
    expect(outcome.admitted).toBe(true)
    if (!outcome.admitted) return
    expect(outcome.via).toBe("INVITATION")
    expect(outcome.consumedInvitationId).toBe("inv-1")
  })

  it("refuses an invitation for a different tenant", () => {
    // Otherwise somebody invited to a small pilot walks into the tenant next
    // door.
    const outcome = admitToTenant(request({ invitation: invitation({ tenantId: "somewhere-else" }) }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_WRONG_TENANT")
  })

  it("refuses an invitation addressed to somebody else", () => {
    // A shared link is an open door with extra steps, and it spreads by being
    // convenient — one person forwards it and nothing complains.
    const outcome = admitToTenant(request({ email: "someone.else@rochester.example" }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_WRONG_RECIPIENT")
  })

  it("matches the recipient case-insensitively", () => {
    // Mailbox providers are case-insensitive, and this is a match rather than a
    // key (GE-040-002).
    expect(admitToTenant(request({ email: "NewComer@Rochester.example" })).admitted).toBe(true)
  })

  it("refuses an expired invitation", () => {
    const outcome = admitToTenant(request({ invitation: invitation({ expiresAt: days(-1) }) }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_NOT_LIVE")
  })

  it("refuses an invitation that has already been accepted", () => {
    const used = invitation({ status: "ACCEPTED", acceptedByPersonId: "person-9" })
    const outcome = admitToTenant(request({ invitation: used }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_NOT_LIVE")
  })

  it("refuses a withdrawn invitation", () => {
    expect(admitToTenant(request({ invitation: invitation({ status: "REVOKED" }) })).admitted).toBe(false)
  })

  it("returns the invitation to consume rather than consuming it", () => {
    // The caller writes the membership and the consumption in one transaction.
    // Marked used before the membership is written, it cannot be retried after
    // a crash; marked after, two people can race it.
    const outcome = admitToTenant(request())
    if (!outcome.admitted) return
    expect(outcome.consumedInvitationId).toBe("inv-1")
  })
})

describe("every refusal reads the same from outside", () => {
  it("says one thing whatever the cause", () => {
    // The difference between "no such invitation", "expired" and "already used"
    // is exactly what tells somebody probing whether an address was ever
    // invited. The reason is for the log; the detail is for the person.
    const causes = [
      request({ invitation: null }),
      request({ invitation: invitation({ tenantId: "elsewhere" }) }),
      request({ email: "stranger@rochester.example" }),
      request({ invitation: invitation({ expiresAt: days(-1) }) }),
      request({ invitation: invitation({ status: "ACCEPTED", acceptedByPersonId: "p" }) }),
    ].map(admitToTenant)

    const details = new Set(causes.map((c) => (c.admitted ? "admitted" : c.detail)))
    expect(details.size).toBe(1)
    expect([...details][0]).toMatch(/ask whoever invited you/)
  })

  it("still distinguishes the causes in the reason, for the log", () => {
    const reasons = [
      request({ invitation: null }),
      request({ invitation: invitation({ tenantId: "elsewhere" }) }),
      request({ email: "stranger@rochester.example" }),
      request({ invitation: invitation({ expiresAt: days(-1) }) }),
    ]
      .map(admitToTenant)
      .map((outcome) => (outcome.admitted ? "admitted" : outcome.reason))

    expect(new Set(reasons).size).toBe(4)
  })

  it("says something different only to somebody already inside", () => {
    // Telling an existing member they are already a member reveals nothing they
    // do not know.
    const outcome = admitToTenant(
      request({ existingMember: { id: "p1", displayName: "A", primaryEmail: null, status: "ACTIVE", createdAt: days(-9), mergedIntoPersonId: null } }),
    )
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("ALREADY_ENROLLED")
    expect(outcome.detail).not.toMatch(/ask whoever invited you/)
  })
})

describe("open enrolment admits a verified domain and nothing else", () => {
  const open = tenant({ policy: "OPEN_TO_VERIFIED_DOMAIN" })

  it("admits somebody from a verified domain with no invitation", () => {
    const outcome = admitToTenant(request({ tenant: open, invitation: null }))
    expect(outcome.admitted).toBe(true)
    if (!outcome.admitted) return
    expect(outcome.via).toBe("VERIFIED_DOMAIN")
    expect(outcome.consumedInvitationId).toBeNull()
  })

  it("still admits an invited external advisor", () => {
    // A tenant open to its own domain still invites outsiders. Refusing them
    // would make the open policy narrower than the closed one.
    const outcome = admitToTenant(
      request({
        tenant: open,
        email: "advisor@external.example",
        invitation: invitation({ sentToEmail: "advisor@external.example" }),
      }),
    )
    expect(outcome.admitted).toBe(true)
    if (!outcome.admitted) return
    expect(outcome.via).toBe("INVITATION")
  })

  it("refuses an uninvited stranger from an unverified domain", () => {
    const outcome = admitToTenant(request({ tenant: open, email: "stranger@elsewhere.example", invitation: null }))
    expect(outcome.admitted).toBe(false)
    if (outcome.admitted) return
    expect(outcome.reason).toBe("INVITATION_REQUIRED")
  })

  it("does not treat a domain suffix as a match", () => {
    // "notrochester.example" ends with "rochester.example" as a string. A
    // suffix match here would admit anybody who could register that domain.
    const outcome = admitToTenant(
      request({ tenant: open, email: "attacker@notrochester.example", invitation: null }),
    )
    expect(outcome.admitted).toBe(false)
  })
})

describe("a policy that reads open and behaves closed", () => {
  it("is reported, because its operator believes self-service works", () => {
    const breaches = selfSignUpBreaches([
      tenant({ tenantId: "a", policy: "OPEN_TO_VERIFIED_DOMAIN", verifiedDomains: [] }),
      tenant({ tenantId: "b", policy: "OPEN_TO_VERIFIED_DOMAIN" }),
      tenant({ tenantId: "c" }),
    ])
    expect(breaches.map((b) => b.tenantId)).toEqual(["a"])
    expect(breaches[0].detail).toMatch(/reads as open and behaves as closed/)
  })

  it("does not report a tenant that is simply closed", () => {
    // Verified domains with no policy is correct, not a breach.
    expect(selfSignUpBreaches([tenant({ tenantId: "c" })])).toEqual([])
  })
})
