/**
 * PAY-200-004 and PAY-190-002, asserted on what the ACTION does.
 *
 * Both requirements are about the producer. A test that called
 * `evaluateMovementLimits` or `convertWithEvidence` directly would stay green
 * the day `actOnApproval` stopped calling them — and "stopped calling them" is
 * the regression, since both gates are invisible from the outside until the day
 * they are needed. So everything below drives the real server action and asserts
 * on the rows it hands the database.
 *
 * Mocked: the database, the session, the tenant scope, the RBAC read and the
 * notification fan-out. NOT mocked: the limits engine, the FX evidence builder,
 * the refusal engine, the posting templates, `nextStatus` or the approval
 * digest. Every rule this is about runs for real.
 */

import type { Prisma } from "@prisma/client"

type Args = { data: Record<string, unknown> }

jest.mock("@/lib/db", () => {
  const client: Record<string, unknown> = {
    approvalRequest: {
      findUnique: jest.fn(),
      update: jest.fn((args: unknown) => ({ __op: "approval", args })),
    },
    roleAssignment: { findFirst: jest.fn(async () => null) },
    event: { findUnique: jest.fn(async () => null) },
    approvalStep: {
      findMany: jest.fn(async () => []),
      create: jest.fn((args: unknown) => ({ __op: "step", args })),
    },
    auditEvent: {
      create: jest.fn(async (args: unknown) => args),
      findFirst: jest.fn(async () => null),
    },
    ledgerEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn((args: Args) => ({ __op: "ledger", ...args })),
      count: jest.fn(async () => 0),
      aggregate: jest.fn(async () => ({ _sum: { amountCents: 0 } })),
    },
    budgetLine: {
      findFirst: jest.fn(async () => ({
        id: "line_1",
        academicYear: "2026-2027",
        currency: "USD",
      })),
      update: jest.fn((args: unknown) => ({ __op: "budgetLine", args })),
    },
    outboxEvent: { create: jest.fn((args: unknown) => ({ __op: "outbox", args })) },
  }
  client.$transaction = jest.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(client) : arg,
  )
  return { db: client }
})
jest.mock("@/lib/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "user_ose" } })) }))
jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (_userId: string, fn: () => Promise<unknown>) => fn(),
}))
jest.mock("@/lib/rbac", () => ({
  getUserContext: jest.fn(async () => ({
    userId: "user_ose",
    orgRoles: [],
    institutionRoles: [{ institutionId: "inst_1", role: "OSE Director" }],
  })),
}))
jest.mock("@/lib/config/server", () => ({
  institutionSlugFor: jest.fn(async () => "rochester"),
  configSnapshotForInstitution: jest.fn(async () => ({
    revision: "university-student-organizations@1.0.0",
    checksum: "abc123",
  })),
}))
jest.mock("@/lib/approvals-world", () => ({ standingDeclarationsFor: jest.fn(async () => ({})) }))
jest.mock("@/lib/delegation", () => ({
  effectiveApprovalContext: jest.fn(async () => ({ ctx: {}, delegators: [] })),
}))
jest.mock("@/lib/notify", () => ({
  notifyUsers: jest.fn(async () => undefined),
  orgCurrentMemberIds: jest.fn(async () => []),
  orgPresidentIds: jest.fn(async () => []),
  oseMemberIds: jest.fn(async () => []),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))

jest.mock("@/lib/approvals", () => {
  const actual = jest.requireActual("@/lib/approvals")
  return { ...actual, availableActions: jest.fn(() => ["approve"]) }
})

import { db as mockedDb } from "@/lib/db"

type Mocked = jest.Mock
const db = mockedDb as unknown as {
  approvalRequest: { findUnique: Mocked; update: Mocked }
  approvalStep: { findMany: Mocked; create: Mocked }
  auditEvent: { create: Mocked }
  ledgerEntry: { findFirst: Mocked; create: Mocked; count: Mocked; aggregate: Mocked }
  budgetLine: { findFirst: Mocked; update: Mocked }
  outboxEvent: { create: Mocked }
  $transaction: Mocked
}

const ledgerCreate = db.ledgerEntry.create
const auditCreate = db.auditEvent.create
const stepCreate = db.approvalStep.create

import { actOnApproval } from "./actions"

/** A rate quoted a minute ago, which the default one-day tolerance accepts. */
function freshQuote(rate: string, from = "EUR", to = "USD") {
  return {
    from,
    to,
    rate,
    asOf: new Date(Date.now() - 60_000).toISOString(),
    source: "provider:stripe",
    quoteId: "fxq_1",
  }
}

function approvalWith(metadata: Record<string, unknown>) {
  return {
    id: "ar_1",
    institutionId: "inst_1",
    organizationId: "org_1",
    type: "BUDGET",
    title: "Reimbursement: pizza for the case competition",
    status: "PENDING_OSE",
    submittedById: "user_member",
    metadata,
    organization: { status: "ACTIVE" },
  }
}

const USD_CLAIM = {
  currency: "USD",
  reimbursement: { budgetLineId: "line_1", amountCents: 4_200, documentId: null },
}

function approveForm() {
  const fd = new FormData()
  fd.set("action", "approve")
  return fd
}

function given(metadata: Record<string, unknown>) {
  db.approvalRequest.findUnique.mockResolvedValue(approvalWith(metadata))
}

function ledgerWrites(): Record<string, unknown>[] {
  return ledgerCreate.mock.calls.map((call) => (call[0] as Args).data)
}

function paymentsDenial(): Record<string, unknown> | undefined {
  return auditCreate.mock.calls
    .map((call) => (call[0] as Args).data)
    .find((d) => String(d.action).startsWith("Payments."))
}

/** The `movement` block the decision step records. */
function recordedMovement(): Record<string, unknown> | undefined {
  const step = stepCreate.mock.calls
    .map((call) => (call[0] as { data: Record<string, unknown> }).data)
    .find((d) => d.toStatus === "APPROVED")
  return (step?.policySnapshot as { movement?: Record<string, unknown> })?.movement
}

beforeEach(() => {
  jest.clearAllMocks()
  db.ledgerEntry.findFirst.mockResolvedValue(null)
  db.ledgerEntry.count.mockResolvedValue(0)
  db.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.approvalStep.findMany.mockResolvedValue([])
  db.budgetLine.findFirst.mockResolvedValue({
    id: "line_1",
    academicYear: "2026-2027",
    currency: "USD",
  })
  db.approvalRequest.update.mockImplementation((args: unknown) => ({ __op: "approval", args }))
  stepCreate.mockImplementation((args: unknown) => ({ __op: "step", args }))
  db.outboxEvent.create.mockImplementation((args: unknown) => ({ __op: "outbox", args }))
  auditCreate.mockImplementation(async (args: unknown) => args)
  ledgerCreate.mockImplementation((args: Args) => ({ __op: "ledger", ...args }))
  db.budgetLine.update.mockImplementation((args: unknown) => ({ __op: "budgetLine", args }))
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(mockedDb) : arg,
  )
  given(USD_CLAIM)
})

describe("PAY-200-004 — the ceilings bound the one path that posts money", () => {
  it("posts an ordinary claim and records which ceilings cleared it", async () => {
    await actOnApproval("ar_1", approveForm())

    const debit = ledgerWrites().find((row) => row.side === "DEBIT")
    expect(debit).toMatchObject({ amountCents: 4_200, currency: "USD" })
    expect(recordedMovement()).toMatchObject({
      limitsVerdict: "WITHIN_LIMITS",
      limitsCode: "limits-within",
    })
  })

  it("refuses a claim above the single-posting ceiling, before anything is written", async () => {
    given({
      currency: "USD",
      reimbursement: { budgetLineId: "line_1", amountCents: 2_000_001, documentId: null },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    const denial = paymentsDenial()
    expect(denial).toBeDefined()
    expect(denial!.action).toBe("Payments.LIMITS_REFUSED")
    expect(denial!.outcome).toBe("DENY")
    expect(String(denial!.reason)).toContain("limits-amount-exceeded")
  })

  it("refuses the second half of a split request on the per-recipient total", async () => {
    // Each half is a legitimate-looking claim under every single-posting
    // ceiling. What is already on the same recipient's tally for the day is
    // what makes the second one a breach.
    db.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amountCents: 4_900_000 } })
    given({
      currency: "USD",
      reimbursement: { budgetLineId: "line_1", amountCents: 200_000, documentId: null },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(String(paymentsDenial()!.reason)).toContain("limits-recipient-exceeded")
  })

  it("refuses one actor posting faster than the rate ceiling", async () => {
    db.ledgerEntry.count.mockResolvedValue(12)

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(String(paymentsDenial()!.reason)).toContain("limits-rate-exceeded")
  })

  it("refuses when the history could not be read at all — safe failure, not a clean slate", async () => {
    db.ledgerEntry.aggregate.mockRejectedValue(new Error("connection terminated"))

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/could not be read/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(String(paymentsDenial()!.reason)).toContain("limits-unreadable")
  })
})

describe("PAY-190-002 — a claim is posted in the currency the books settle in", () => {
  it("refuses a cross-currency claim with no rate rather than posting the digits unchanged", async () => {
    given({
      currency: "EUR",
      reimbursement: { budgetLineId: "line_1", amountCents: 10_000, documentId: null },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    const denial = paymentsDenial()
    expect(denial!.action).toBe("Payments.FX_REFUSED")
    expect(String(denial!.reason)).toContain("fx-quote-missing")
  })

  it("posts the CONVERTED amount when the request carries a usable quote", async () => {
    given({
      currency: "EUR",
      reimbursement: { budgetLineId: "line_1", amountCents: 10_000, documentId: null },
      payment: { fx: freshQuote("1.1") },
    })

    await actOnApproval("ar_1", approveForm())

    const debit = ledgerWrites().find((row) => row.side === "DEBIT")
    // €100.00 at 1.1 is $110.00 — 11_000 cents, not the 10_000 that was filed.
    expect(debit).toMatchObject({ amountCents: 11_000, currency: "USD" })

    // The journal still balances after conversion: both halves of the posting
    // are converted from the one quote, never one from the claim and one from
    // the converted total.
    const signed = ledgerWrites().reduce((sum, row) => sum + Number(row.amountCents), 0)
    expect(signed).toBe(0)
  })

  it("keeps the conversion's provenance on the decision step", async () => {
    given({
      currency: "EUR",
      reimbursement: { budgetLineId: "line_1", amountCents: 10_000, documentId: null },
      payment: { fx: freshQuote("1.1") },
    })

    await actOnApproval("ar_1", approveForm())

    expect(recordedMovement()).toMatchObject({
      conversion: "CONVERTED",
      presentmentMinorUnits: 10_000,
      presentmentCurrency: "EUR",
      settlementMinorUnits: 11_000,
      settlementCurrency: "USD",
      rate: "1.1",
      rateSource: "provider:stripe",
      rateQuoteId: "fxq_1",
      rounding: "half-even",
    })
  })

  it("refuses a quote for the wrong pair", async () => {
    given({
      currency: "EUR",
      reimbursement: { budgetLineId: "line_1", amountCents: 10_000, documentId: null },
      payment: { fx: freshQuote("1.1", "GBP", "USD") },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)
    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(String(paymentsDenial()!.reason)).toContain("fx-quote-pair-mismatch")
  })

  it("refuses a stale quote", async () => {
    given({
      currency: "EUR",
      reimbursement: { budgetLineId: "line_1", amountCents: 10_000, documentId: null },
      payment: {
        fx: {
          ...freshQuote("1.1"),
          asOf: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        },
      },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)
    expect(String(paymentsDenial()!.reason)).toContain("fx-quote-stale")
  })

  it("records a same-currency claim as a conversion that did not happen", async () => {
    await actOnApproval("ar_1", approveForm())
    expect(recordedMovement()).toMatchObject({
      conversion: "NONE",
      settlementMinorUnits: 4_200,
      rate: null,
      fxGainLossMinorUnits: null,
    })
  })
})

/** Kept so `Prisma` is used and the import cannot rot. */
export type _PrismaUsed = Prisma.PrismaPromise<unknown>
