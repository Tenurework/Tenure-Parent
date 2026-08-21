/**
 * PAY-200-003 — purpose-based masked display.
 *
 * `financial-identifiers.test.ts` proves the rules (`revealFor`,
 * `maskIdentifier`). This proves the APPLICATION's answer: which purpose a
 * reader of an approval record is acting under, and what that produces on the
 * screen. Everything here is the production function; nothing is re-implemented
 * for the test.
 */
import { displayPurposeFor, maskForDisplay } from "@/lib/payments/masked-display"
import type { OrgRole, UserContext } from "@/lib/rbac"
import type { PurposeGrant } from "@tenure/payments"

const ORG = { id: "org_robotics", institutionId: "inst_simon" }

const PAN = "4111111111111111"
const IBAN = "GB33BUKB20201555555555"
const ROUTING = "021000021"

function seat(over: Partial<OrgRole> = {}): OrgRole {
  return {
    organizationId: ORG.id,
    roleId: "role_1",
    roleName: "Member",
    scope: "MEMBER",
    status: "ACTIVE",
    templateKey: "unit.member",
    ...over,
  } as OrgRole
}

function context(over: Partial<UserContext> = {}): UserContext {
  return {
    userId: "user_reader",
    institutionRoles: [],
    orgRoles: [],
    ...over,
  } as UserContext
}

describe("which purpose a reader of an approval record holds", () => {
  it("gives the submitter self-service, because the record is about them", () => {
    const decision = displayPurposeFor({
      ctx: context({ userId: "user_alice" }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBe("CUSTOMER_SELF_SERVICE")
    expect(decision.because).toContain("about the person reading it")
  })

  it("gives an active finance seat the reconciliation purpose", () => {
    const decision = displayPurposeFor({
      ctx: context({
        orgRoles: [seat({ templateKey: "finance.officer", roleName: "VP Finance" })],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBe("OPERATIONS_RECONCILIATION")
  })

  it("gives the club's active president the reconciliation purpose", () => {
    const decision = displayPurposeFor({
      ctx: context({ orgRoles: [seat({ scope: "PRESIDENT" })] }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBe("OPERATIONS_RECONCILIATION")
  })

  it("gives the staff-office director the reconciliation purpose", () => {
    const decision = displayPurposeFor({
      ctx: context({
        institutionRoles: [{ institutionId: ORG.institutionId, role: "OSE_DIRECTOR" }],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBe("OPERATIONS_RECONCILIATION")
  })

  it("gives a director of a DIFFERENT institution no purpose at all", () => {
    const decision = displayPurposeFor({
      ctx: context({
        institutionRoles: [{ institutionId: "inst_other", role: "OSE_DIRECTOR" }],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBeNull()
  })

  it("gives a plain member no purpose, though they can read the request", () => {
    const decision = displayPurposeFor({
      ctx: context({ orgRoles: [seat()] }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBeNull()
    expect(decision.because).toContain("no access purpose")
  })

  it("gives a SHADOW finance seat no purpose — a handoff is not a reason to look", () => {
    const decision = displayPurposeFor({
      ctx: context({
        orgRoles: [seat({ templateKey: "finance.officer", status: "SHADOW" })],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBeNull()
  })

  it("gives a finance seat in ANOTHER club no purpose here", () => {
    const decision = displayPurposeFor({
      ctx: context({
        orgRoles: [seat({ organizationId: "org_chess", templateKey: "finance.officer" })],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBeNull()
  })

  it("gives a treasurer reading her OWN claim the narrower purpose", () => {
    const decision = displayPurposeFor({
      ctx: context({
        userId: "user_alice",
        orgRoles: [seat({ templateKey: "finance.officer" })],
      }),
      org: ORG,
      subjectUserId: "user_alice",
    })
    expect(decision.purpose).toBe("CUSTOMER_SELF_SERVICE")
  })
})

const SELF = { purpose: "CUSTOMER_SELF_SERVICE", because: "own record" } as const
const OPS = { purpose: "OPERATIONS_RECONCILIATION", because: "reconciler" } as const
const NONE = { purpose: null, because: "no access purpose applies to this reader" } as const

describe("what reaches the screen", () => {
  it("shows a treasurer reading her own claim only the last four of the card", () => {
    const shown = maskForDisplay(`paid on the club Visa ${PAN}, receipt attached`, SELF)
    expect(shown.text).toBe("paid on the club Visa ••••1111, receipt attached")
    expect(shown.text).not.toContain(PAN)
    expect(shown.occurrences).toEqual([{ kind: "PAN", level: "LAST4" }])
  })

  it("shows a reconciler the issuer prefix as well, which is what a match needs", () => {
    const shown = maskForDisplay(`paid on the club Visa ${PAN}`, OPS)
    expect(shown.text).toBe("paid on the club Visa 411111••••••1111")
    expect(shown.occurrences).toEqual([{ kind: "PAN", level: "PREFIX_LAST4" }])
  })

  it("shows a reader with no purpose nothing of the value", () => {
    const shown = maskForDisplay(`paid on the club Visa ${PAN}`, NONE)
    expect(shown.text).toBe("paid on the club Visa ••••••••••••")
    expect(shown.occurrences).toEqual([{ kind: "PAN", level: "NONE" }])
    expect(shown.notice).toBe(
      "1 financial identifier (card number) hidden entirely — no access purpose applies to this reader.",
    )
  })

  it("masks an IBAN and a routing number in the same note, each by its own rule", () => {
    const shown = maskForDisplay(`wire to ${IBAN} via ${ROUTING}`, OPS)
    expect(shown.text).not.toContain(IBAN)
    expect(shown.text).not.toContain(ROUTING)
    expect(shown.occurrences).toEqual([
      { kind: "IBAN", level: "PREFIX_LAST4" },
      { kind: "US_ROUTING", level: "LAST4" },
    ])
    expect(shown.notice).toBe(
      "2 financial identifiers (IBAN, routing number) masked — shown as far as OPERATIONS_RECONCILIATION allows.",
    )
  })

  it("masks the same card twice when it appears twice", () => {
    const shown = maskForDisplay(`${PAN} and again ${PAN}`, SELF)
    expect(shown.text).toBe("••••1111 and again ••••1111")
    expect(shown.occurrences).toHaveLength(2)
  })

  it("leaves a note with no identifier in it byte-for-byte alone, and says nothing", () => {
    const note = "Pizza for the outreach night, 34 attendees, receipt attached."
    const shown = maskForDisplay(note, NONE)
    expect(shown.text).toBe(note)
    expect(shown.occurrences).toEqual([])
    expect(shown.notice).toBeNull()
  })

  it("returns an empty string and no notice for an absent note", () => {
    expect(maskForDisplay(null, OPS)).toEqual({ text: "", occurrences: [], notice: null })
    expect(maskForDisplay(undefined, OPS)).toEqual({ text: "", occurrences: [], notice: null })
  })
})

const AT = "2026-08-20T12:00:00.000Z"

function grant(over: Partial<PurposeGrant> = {}): PurposeGrant {
  return {
    purpose: "OPERATIONS_RECONCILIATION",
    grantedTo: "user_reader",
    grantedBy: "user_director",
    justification: "bank return investigation ticket OPS-4412",
    expiresAt: "2026-08-21T12:00:00.000Z",
    kinds: ["IBAN", "PAN"],
    ...over,
  }
}

describe("a recorded purpose grant", () => {
  it("reveals an IBAN in full while it is live", () => {
    const shown = maskForDisplay(`wire to ${IBAN}`, OPS, { grant: grant(), at: AT })
    expect(shown.text).toBe(`wire to ${IBAN}`)
    expect(shown.occurrences).toEqual([{ kind: "IBAN", level: "FULL" }])
    expect(shown.notice).toBe(
      "1 financial identifier (IBAN) shown in full under a recorded purpose grant.",
    )
  })

  it("cannot lift a card number past the PCI ceiling, however it is written", () => {
    const shown = maskForDisplay(`card ${PAN}`, OPS, { grant: grant(), at: AT })
    expect(shown.text).toBe("card 411111••••••1111")
    expect(shown.occurrences).toEqual([{ kind: "PAN", level: "PREFIX_LAST4" }])
  })

  it("does nothing once it has expired", () => {
    const shown = maskForDisplay(`wire to ${IBAN}`, OPS, {
      grant: grant({ expiresAt: "2026-08-19T12:00:00.000Z" }),
      at: AT,
    })
    expect(shown.text).not.toContain(IBAN)
    expect(shown.occurrences).toEqual([{ kind: "IBAN", level: "PREFIX_LAST4" }])
  })

  it("does nothing when it names a kind it does not cover", () => {
    const shown = maskForDisplay(`wire via ${ROUTING}`, OPS, { grant: grant(), at: AT })
    expect(shown.occurrences).toEqual([{ kind: "US_ROUTING", level: "LAST4" }])
  })

  it("does nothing when it is not well-formed — a placeholder justification", () => {
    const shown = maskForDisplay(`wire to ${IBAN}`, OPS, {
      grant: grant({ justification: "work" }),
      at: AT,
    })
    expect(shown.occurrences).toEqual([{ kind: "IBAN", level: "PREFIX_LAST4" }])
  })

  it("does nothing for a reader whose purpose it was not granted for", () => {
    const shown = maskForDisplay(`wire to ${IBAN}`, SELF, { grant: grant(), at: AT })
    expect(shown.occurrences).toEqual([{ kind: "IBAN", level: "LAST4" }])
  })
})
