/**
 * PAY-180-006 and PAY-130-002, asserted on what the ACTION emits.
 *
 * Both requirements are about a PRODUCER, not a helper. A test
 * that called `classifyRequest` or `buildJournal` directly would stay green the
 * day `actOnApproval` stopped calling them, which is exactly the regression
 * being guarded against — so everything below drives the real server action and
 * asserts on the rows it hands the database.
 *
 * Mocked: the database, the session, the tenant scope, the RBAC read and the
 * notification fan-out. NOT mocked: the payments package, the posting
 * templates, the refusal engine, `nextStatus`, the outbox row builder and the
 * approval digest — every rule this is about runs for real.
 */

import type { Prisma } from "@prisma/client"

type Args = { data: Record<string, unknown> }

/**
 * The mocks are built INSIDE the factories, not captured from module scope.
 *
 * `import { actOnApproval }` hoists above every `const` in this file, so a
 * factory closing over a module-scope object reads it in its temporal dead zone
 * and the suite fails to load. Building them in the factory and reading them
 * back through the mocked module is the shape that survives the hoist.
 */
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
    // `findFirst` is the chain's predecessor read: `recordAuditEvent` appends
    // each row against the institution's previous one, and null means "this is
    // the first", which is what a per-test mock database always is.
    auditEvent: {
      create: jest.fn(async (args: unknown) => args),
      findFirst: jest.fn(async () => null),
    },
    ledgerEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn((args: Args) => ({ __op: "ledger", ...args })),
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
  // Both forms. The action uses the ARRAY form to post a journal atomically;
  // `recordAuditEvent` uses the CALLBACK form, because the audit chain reads
  // the predecessor and writes the successor under one transaction. A mock
  // honouring only the array form returned the callback itself instead of
  // running it, so the refusal row was silently never written and the
  // assertions below read as "the refusal was not recorded" when in truth it
  // was not *simulated* — the stand-in has to behave like the real client, or
  // it proves nothing about either path.
  //
  // The callback is handed `client` itself, which is what makes the chained
  // write land on the same `auditEvent.create` spy the assertions read.
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

// Only the authority read is stubbed. `nextStatus`, `approvalDigest`,
// `approvalMoney` and `exceedsApprovalThreshold` all run for real, so the
// transition this test drives is the transition the app performs.
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
  ledgerEntry: { findFirst: Mocked; create: Mocked }
  budgetLine: { findFirst: Mocked; update: Mocked }
  outboxEvent: { create: Mocked }
  $transaction: Mocked
}

const ledgerCreate = db.ledgerEntry.create
const budgetLineUpdate = db.budgetLine.update
const auditCreate = db.auditEvent.create
const transaction = db.$transaction

import { actOnApproval } from "./actions"

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

const REIMBURSEMENT = {
  reimbursement: { budgetLineId: "line_1", amountCents: 4200, documentId: null },
}

function approveForm() {
  const fd = new FormData()
  fd.set("action", "approve")
  return fd
}

/** Every `db.ledgerEntry.create` argument the action produced, in order. */
function ledgerWrites(): Record<string, unknown>[] {
  return ledgerCreate.mock.calls.map((call) => (call[0] as Args).data)
}

/** Point the mocked read at one approval row. */
function given(metadata: Record<string, unknown>) {
  db.approvalRequest.findUnique.mockResolvedValue(approvalWith(metadata))
}

beforeEach(() => {
  jest.clearAllMocks()
  db.ledgerEntry.findFirst.mockResolvedValue(null)
  db.approvalStep.findMany.mockResolvedValue([])
  db.budgetLine.findFirst.mockResolvedValue({
    id: "line_1",
    academicYear: "2026-2027",
    currency: "USD",
  })
  db.approvalRequest.update.mockImplementation((args: unknown) => ({ __op: "approval", args }))
  db.approvalStep.create.mockImplementation((args: unknown) => ({ __op: "step", args }))
  db.outboxEvent.create.mockImplementation((args: unknown) => ({ __op: "outbox", args }))
  db.auditEvent.create.mockImplementation(async (args: unknown) => args)
  ledgerCreate.mockImplementation((args: Args) => ({ __op: "ledger", ...args }))
  budgetLineUpdate.mockImplementation((args: unknown) => ({ __op: "budgetLine", args }))
  // Both forms, exactly as the factory built it. `jest.clearAllMocks()` above
  // wipes implementations as well as call counts, so re-stating the array form
  // alone here quietly reverted the callback form the audit chain needs — the
  // mock behaved correctly until the first `beforeEach` and wrongly forever
  // after, which is the hardest version of this bug to see.
  transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(mockedDb)
      : arg,
  )
  given(REIMBURSEMENT)
})

describe("PAY-180-006 — a payout-shaped approval never reaches the ledger", () => {
  it("refuses the write and records the refusal", async () => {
    // MUTATION TARGET: making `classifyRequest` return ALLOWED unconditionally
    // reds this, and it reds here — at the action — rather than only in the
    // classifier's own suite.
    given({
      ...REIMBURSEMENT,
      payment: {
        kind: "payout",
        destinationLegalEntityId: "inst_1",
        beneficiary: { external: true, name: "Rochester Catering Co." },
      },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/cannot be posted/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(budgetLineUpdate).not.toHaveBeenCalled()
    // NOT `expect(transaction).not.toHaveBeenCalled()` any more. That assertion
    // meant "nothing was posted", and it read the transaction count as a proxy
    // for it. The refusal's audit row now goes through `recordAuditEvent`, which
    // opens a transaction of its own to append the row against the institution's
    // previous one — so the count is no longer a proxy for anything, and keeping
    // it would fail on an improvement. What it was actually protecting is the
    // two lines above: no ledger entry, no budget line moved.
    expect(transaction).toHaveBeenCalledTimes(1)

    const denial = auditCreate.mock.calls
      .map((call) => (call[0] as Args).data)
      .find((d) => String(d.action).startsWith("Payments."))
    expect(denial).toBeDefined()
    expect(denial!.outcome).toBe("DENY")
    expect(denial!.action).toBe("Payments.REFUSED")
    expect(String(denial!.reason)).toContain("money-movement-prohibited")
  })

  it("escalates — and still refuses to post — an allocation naming an outside payee", async () => {
    given({
      ...REIMBURSEMENT,
      payment: {
        kind: "ledger-allocation",
        destinationLegalEntityId: "inst_1",
        beneficiary: { external: true, name: "Rochester Catering Co." },
      },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/payments-operations/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    const denial = auditCreate.mock.calls
      .map((call) => (call[0] as Args).data)
      .find((d) => String(d.action).startsWith("Payments."))
    expect(denial!.action).toBe("Payments.ESCALATE")
    expect(String(denial!.reason)).toContain("money-movement-external-beneficiary")
  })

  it("escalates a posting that crosses a legal entity boundary", async () => {
    given({
      ...REIMBURSEMENT,
      payment: { kind: "ledger-allocation", destinationLegalEntityId: "inst_other" },
    })
    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow()
    expect(ledgerCreate).not.toHaveBeenCalled()
  })
})

describe("PAY-130-002 — an approved reimbursement posts a balanced journal", () => {
  it("writes both halves, sharing one journal id, from the effective template", async () => {
    // MUTATION TARGET: persisting only the expense half reds this, as does
    // dropping the effective-dated lookup for a hardcoded template.
    await actOnApproval("ar_1", approveForm())

    const writes = ledgerWrites()
    expect(writes).toHaveLength(2)

    const journalIds = new Set(writes.map((w) => w.journalId))
    expect(journalIds.size).toBe(1)
    expect([...journalIds][0]).toEqual(expect.any(String))

    for (const write of writes) {
      expect(write.templateId).toBe("reimbursement.member-expense")
      expect(write.kind).toBe("SPEND")
      expect(write.currency).toBe("USD")
      expect(write.effectiveAt).toBeInstanceOf(Date)
      expect(write.approvalId).toBe("ar_1")
    }
  })

  it("puts the budget dimension on exactly one side, and balances to zero", async () => {
    await actOnApproval("ar_1", approveForm())
    const writes = ledgerWrites()

    const dimensioned = writes.filter((w) => w.budgetLineId !== null)
    expect(dimensioned).toHaveLength(1)
    expect(dimensioned[0].account).toBe("6000-program-expense")
    expect(dimensioned[0].side).toBe("DEBIT")
    expect(dimensioned[0].amountCents).toBe(4200)

    const counter = writes.filter((w) => w.budgetLineId === null)
    expect(counter).toHaveLength(1)
    expect(counter[0].account).toBe("2100-reimbursement-payable")
    expect(counter[0].side).toBe("CREDIT")
    expect(counter[0].amountCents).toBe(-4200)

    // Debit-positive, so a balanced journal sums to zero on the rows themselves.
    expect(writes.reduce((n, w) => n + Number(w.amountCents), 0)).toBe(0)
  })

  it("moves the line's actual by the budget-dimensioned side only", async () => {
    // Summing the whole journal would move it by zero — which is what balanced
    // means, and is not what a line's actual is.
    await actOnApproval("ar_1", approveForm())
    expect(budgetLineUpdate).toHaveBeenCalledTimes(1)
    expect(budgetLineUpdate).toHaveBeenCalledWith({
      where: { id: "line_1" },
      data: { actualCents: { increment: 4200 } },
    })
  })

  it("splits recoverable tax off the budget line under the current revision", async () => {
    given({
      reimbursement: { budgetLineId: "line_1", amountCents: 4200, taxCents: 200, documentId: null },
    })
    await actOnApproval("ar_1", approveForm())

    const writes = ledgerWrites()
    expect(writes).toHaveLength(3)
    expect(writes.map((w) => [w.account, w.amountCents])).toEqual([
      ["6000-program-expense", 4000],
      ["1400-recoverable-tax", 200],
      ["2100-reimbursement-payable", -4200],
    ])
    expect(budgetLineUpdate).toHaveBeenCalledWith({
      where: { id: "line_1" },
      data: { actualCents: { increment: 4000 } },
    })
  })

  it("posts nothing at all when this approval already has an entry", async () => {
    db.ledgerEntry.findFirst.mockResolvedValue({ id: "le_existing" })
    await actOnApproval("ar_1", approveForm())
    expect(ledgerCreate).not.toHaveBeenCalled()
    // The decision itself still commits — idempotence is about the posting.
    expect(transaction).toHaveBeenCalled()
  })

  it("commits the journal in the SAME transaction as the status change", async () => {
    // A ledger write outside the compare-and-swap would post against a request
    // another approver had already rejected.
    await actOnApproval("ar_1", approveForm())
    const [ops] = transaction.mock.calls[0] as [{ __op?: string }[]]
    const kinds = ops.map((op) => op.__op)
    expect(kinds).toContain("ledger")
    expect(kinds).toContain("approval")
    expect(kinds).toContain("step")
    expect(kinds).toContain("outbox")
  })
})

// Keeps the Prisma type import load-bearing rather than decorative: the action
// casts its outbox row to this type, and a change to it should be visible here.
export type _OutboxRow = Prisma.OutboxEventUncheckedCreateInput
