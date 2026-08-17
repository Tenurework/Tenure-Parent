/**
 * PAY-150-008 — the six attacks on payment authority, each run against the
 * function production calls.
 *
 * This is a requirement to TEST, so what it is worth depends entirely on
 * whether the code under it is the real code. Every case below drives a
 * production entry point — `decideFinanceAction` (the money write path's gate),
 * `exceedsApprovalThreshold` (the ladder), `delegationStanding` (what
 * `effectiveApprovalContext` filters on) and `evaluateMovementLimits` (the
 * ceilings `actOnApproval` clears a posting against) — with no stand-in for the
 * rule being attacked.
 *
 * The split-approval attack has a second half in
 * `src/app/(app)/approvals/payment-movement-gate.test.ts`, which drives the
 * whole server action and asserts that nothing reaches the ledger.
 */

import { ROLE_TEMPLATES } from "@tenure/authorization"
import { evaluateMovementLimits, observationWindows, DEFAULT_MOVEMENT_LIMITS } from "@tenure/payments"

import { approvalAuthorityFor, exceedsApprovalThreshold } from "@/lib/approvals"
import { delegationStanding, DELEGATION_MAX_LIFETIME_DAYS } from "@/lib/authz/delegation-expiry"
import { decideFinanceAction, type OrgRole, type UserContext } from "@/lib/rbac"

const SLUG = "rochester"
const ORG = { id: "club_1", institutionId: "inst_1", status: "ACTIVE" as const }

const seat = (over: Partial<OrgRole> = {}): OrgRole => ({
  organizationId: ORG.id,
  roleId: "r1",
  roleName: "Treasurer",
  scope: "FUNCTIONAL",
  status: "ACTIVE",
  templateKey: "finance.officer",
  ...over,
})

const ctx = (
  orgRoles: OrgRole[],
  institutionRoles: UserContext["institutionRoles"] = [],
): UserContext => ({ userId: "u1", institutionRoles, orgRoles })

describe("attack 1 — privilege escalation", () => {
  it("refuses an ordinary member the ledger, and names the capability", () => {
    const decision = decideFinanceAction(
      ctx([seat({ templateKey: "unit.member" })]),
      ORG,
      SLUG,
      "finance.ledger.post",
    )
    expect(decision.allowed).toBe(false)
    expect(decision.detail).toContain("finance.ledger.post")
  })

  it("refuses a club lead the REVERSAL even though it holds the posting", () => {
    // The escalation this catches is the plausible one: a seat that legitimately
    // holds one finance capability reaching for the neighbouring, larger one.
    const lead = ctx([seat({ scope: "PRESIDENT", templateKey: "unit.lead" })])
    expect(decideFinanceAction(lead, ORG, SLUG, "finance.ledger.post").allowed).toBe(true)
    expect(decideFinanceAction(lead, ORG, SLUG, "finance.ledger.reverse").allowed).toBe(false)
  })

  it("refuses a seat in ANOTHER club, however senior", () => {
    const elsewhere = ctx([seat({ organizationId: "club_2", templateKey: "unit.lead" })])
    expect(decideFinanceAction(elsewhere, ORG, SLUG, "finance.ledger.post").allowed).toBe(false)
  })

  it("confers the reversal on exactly the two accountable seats, and no others", () => {
    // A ratchet, not a preference. Restating money the institution has already
    // recognised belongs to the seat accountable for the ledger and to the
    // oversight office (PAY-150-001); the escalation this catches is a template
    // quietly gaining `finance.ledger.reverse` in a later edit, which would make
    // the refusal two cases above reachable by asking for that seat.
    const holders = ROLE_TEMPLATES.filter((template) =>
      template.permissions.includes("finance.ledger.reverse"),
    ).map((template) => template.key)
    expect(holders.sort()).toEqual(["finance.officer", "institution.director"])
    expect(holders).not.toContain("unit.lead")
    expect(holders).not.toContain("unit.member")
  })
})

describe("attack 2 — a stale seat", () => {
  it("refuses a seat that is no longer ACTIVE, and does not pretend it never existed", () => {
    const alumni = ctx([seat({ status: "ALUMNI" })])
    const decision = decideFinanceAction(alumni, ORG, SLUG, "finance.ledger.post")
    expect(decision.allowed).toBe(false)
    // The same person with the same seat, ACTIVE, is allowed — so the refusal is
    // about the seat's state and nothing else.
    expect(decideFinanceAction(ctx([seat()]), ORG, SLUG, "finance.ledger.post").allowed).toBe(true)
  })

  it("refuses a SHADOW seat whose term has not begun", () => {
    expect(
      decideFinanceAction(ctx([seat({ status: "SHADOW" })]), ORG, SLUG, "finance.ledger.post")
        .allowed,
    ).toBe(false)
  })

  it("refuses every finance capability on an archived club, whatever the seat", () => {
    const archived = { ...ORG, status: "ARCHIVED" as const }
    const decision = decideFinanceAction(ctx([seat()]), archived, SLUG, "finance.ledger.post")
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("ORGANIZATION_NOT_ACTIVE")
  })
})

describe("attack 3 — a terminated user", () => {
  it("refuses somebody who holds no seat at all", () => {
    const decision = decideFinanceAction(ctx([]), ORG, SLUG, "finance.ledger.post")
    expect(decision.allowed).toBe(false)
  })

  it("refuses them for every finance capability, not just the posting", () => {
    for (const permission of [
      "finance.ledger.post",
      "finance.ledger.reverse",
      "finance.budget.update",
    ] as const) {
      expect(decideFinanceAction(ctx([]), ORG, SLUG, permission).allowed).toBe(false)
    }
  })
})

describe("attack 4 — delegated authority that outlived its reason", () => {
  const NOW = new Date("2026-08-17T12:00:00.000Z")
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

  it("lends authority inside the lifetime", () => {
    expect(delegationStanding({ createdAt: daysAgo(3), revokedAt: null }, NOW).live).toBe(true)
  })

  it("stops lending it past the maximum lifetime, though nobody revoked it", () => {
    const standing = delegationStanding(
      { createdAt: daysAgo(DELEGATION_MAX_LIFETIME_DAYS + 1), revokedAt: null },
      NOW,
    )
    expect(standing.live).toBe(false)
    expect(standing.refusal).toBe("EXPIRED")
    expect(standing.detail).toContain("nobody has re-decided")
  })

  it("puts the boundary exactly at the lifetime", () => {
    expect(
      delegationStanding({ createdAt: daysAgo(DELEGATION_MAX_LIFETIME_DAYS), revokedAt: null }, NOW)
        .live,
    ).toBe(true)
  })

  it("refuses a delegation it cannot date rather than assuming it is recent", () => {
    const standing = delegationStanding({ createdAt: "whenever", revokedAt: null }, NOW)
    expect(standing.live).toBe(false)
    expect(standing.refusal).toBe("UNDATED")
  })

  it("refuses a revoked one and one dated in the future", () => {
    expect(
      delegationStanding({ createdAt: daysAgo(2), revokedAt: daysAgo(1) }, NOW).refusal,
    ).toBe("REVOKED")
    expect(
      delegationStanding({ createdAt: new Date(NOW.getTime() + 60_000), revokedAt: null }, NOW)
        .refusal,
    ).toBe("NOT_YET_GRANTED")
  })
})

describe("attack 5 — the currency threshold", () => {
  const authority = approvalAuthorityFor(SLUG)

  it("puts a request above the ceiling above it, and one at the ceiling below", () => {
    expect(
      exceedsApprovalThreshold({ amountMinorUnits: 500_001, currency: "USD" }, authority),
    ).toBe(true)
    expect(
      exceedsApprovalThreshold({ amountMinorUnits: 500_000, currency: "USD" }, authority),
    ).toBe(false)
  })

  it("refuses to let an unpriced currency walk under the ceiling", () => {
    // ¥1,000,000 is far above the USD ceiling in every sense that matters, and
    // its minor-unit count is not comparable to one. Fail closed.
    expect(
      exceedsApprovalThreshold({ amountMinorUnits: 1_000_000, currency: "JPY" }, authority),
    ).toBe(true)
    // Even a trivial amount in an unpriced currency: the answer is "this ladder
    // does not price this", not "it is small".
    expect(exceedsApprovalThreshold({ amountMinorUnits: 1, currency: "JPY" }, authority)).toBe(true)
  })

  it("lets a request that moves no money take the ordinary gate", () => {
    // By design: an event proposal is not a large payment.
    //
    // FINDING, recorded rather than asserted away: `approvalMoney` returns the
    // same `amountMinorUnits: null` for "this request carries no money" and for
    // "this request carries an amount nobody could parse", so a claim whose
    // amount is free text takes this branch too. Distinguishing them belongs to
    // the parser (PAY-150-002's `approvalMoney`), not to this comparison, and
    // the ceilings in attack 6 bound the posting either way.
    expect(
      exceedsApprovalThreshold({ amountMinorUnits: null, currency: "USD" }, authority),
    ).toBe(false)
  })
})

describe("attack 6 — splitting a request to get under a gate", () => {
  const AT = "2026-08-17T12:00:00.000Z"
  const windows = observationWindows(DEFAULT_MOVEMENT_LIMITS, AT)

  const movement = (amountMinorUnits: number) => ({
    institutionId: "inst_1",
    actorPrincipalId: "u1",
    recipientKey: "user_member",
    accountKey: "line_1",
    amountMinorUnits,
    currency: "USD",
    at: AT,
  })

  const history = (recipientPriorMinorUnits: number) => ({
    observedAt: AT,
    coversSince: windows.earliest,
    actorCommands: 0,
    tenantCommands: 0,
    recipientPriorMinorUnits,
    accountPriorMinorUnits: recipientPriorMinorUnits,
    tenantPriorMinorUnits: recipientPriorMinorUnits,
    currency: "USD",
    recipientKey: "user_member",
    accountKey: "line_1",
  })

  it("lets one legitimate claim through", () => {
    expect(evaluateMovementLimits(movement(400_000), history(0)).verdict).toBe("WITHIN_LIMITS")
  })

  it("refuses the sibling that takes the day's total over the recipient ceiling", () => {
    // Twelve claims of $4,000 to the same person on the same day: each one is
    // under every single-posting ceiling and under the approval ladder's gate,
    // and together they are $48,000 — which is what the per-recipient ceiling is
    // measured against.
    const decision = evaluateMovementLimits(movement(400_000), history(4_800_000))
    expect(decision.verdict).toBe("EXCEEDED")
    expect(decision.breaches.map((b) => b.limit)).toContain("recipient")
  })

  it("refuses the split even when each half goes to a different account", () => {
    // Same recipient, different budget lines: the account ceiling cannot see
    // this and the recipient ceiling can.
    const decision = evaluateMovementLimits(
      { ...movement(400_000), accountKey: "line_2" },
      { ...history(4_800_000), accountKey: "line_2", accountPriorMinorUnits: 0 },
    )
    // Only the recipient ceiling goes: the account's own tally is clean and the
    // institution's daily total is an order of magnitude further off.
    expect(decision.breaches.map((b) => b.limit)).toEqual(["recipient"])
  })
})
