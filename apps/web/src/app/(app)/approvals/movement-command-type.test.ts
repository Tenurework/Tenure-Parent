/**
 * PAY-080-001, asserted on the ACTION rather than on the classifier.
 *
 * Bible §10 asks Tenure to distinguish four things that all look alike in a UI:
 * a memo allocation that posts nothing, a balanced journal inside one legal
 * entity, a due-to/due-from between two, and money leaving the platform.
 * Everything below drives the real `actOnApproval` and reads the rows it hands
 * the database, so a test cannot stay green the day the action stops asking.
 *
 * Mocked: the database, the session, the tenant scope, the RBAC read and the
 * notification fan-out. NOT mocked: `classifyMovementCommand`,
 * `classifyRequest`, the posting templates, the journal builder or the limits
 * engine — the whole decision runs for real.
 *
 * The mock preamble is the shape `money-movement.test.ts` uses, for the reason
 * its own header gives: the factories build their objects inside themselves so
 * the hoisted `import { actOnApproval }` cannot read them in a dead zone.
 */

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
const stepCreate = db.approvalStep.create
const auditCreate = db.auditEvent.create
const transaction = db.$transaction

import { actOnApproval } from "./actions"

const REIMBURSEMENT = {
  reimbursement: { budgetLineId: "line_1", amountCents: 4200, documentId: null },
}

function given(metadata: Record<string, unknown>) {
  db.approvalRequest.findUnique.mockResolvedValue({
    id: "ar_1",
    institutionId: "inst_1",
    organizationId: "org_1",
    type: "BUDGET",
    title: "Reimbursement: pizza for the case competition",
    status: "PENDING_OSE",
    submittedById: "user_member",
    metadata,
    organization: { status: "ACTIVE" },
  })
}

function approveForm() {
  const fd = new FormData()
  fd.set("action", "approve")
  return fd
}

/** The `movement` block the decision step carries, or null. */
function movementOnStep(): Record<string, unknown> | null {
  for (const call of stepCreate.mock.calls) {
    const data = (call[0] as Args).data
    const snapshot = data.policySnapshot as Record<string, unknown> | undefined
    if (snapshot && snapshot.movement) return snapshot.movement as Record<string, unknown>
  }
  return null
}

/** The first `Payments.*` audit row, or undefined. */
function paymentsDenial(): Record<string, unknown> | undefined {
  return auditCreate.mock.calls
    .map((call) => (call[0] as Args).data)
    .find((d) => String(d.action).startsWith("Payments."))
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
  transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(mockedDb) : arg,
  )
  given(REIMBURSEMENT)
})

describe("PAY-080-001 — a posted journal records which of §10's four acts it was", () => {
  it("records a club reimbursement as an INTERNAL_LEDGER_TRANSFER", async () => {
    // MUTATION TARGET: deleting the `classifyMovementCommand` call, or dropping
    // `commandType` from the evidence block, reds this at the action.
    await actOnApproval("ar_1", approveForm())

    expect(ledgerCreate).toHaveBeenCalledTimes(2)
    const movement = movementOnStep()
    expect(movement).not.toBeNull()
    expect(movement!.commandType).toBe("INTERNAL_LEDGER_TRANSFER")
    expect(movement!.commandCode).toBe("movement-command-internal-ledger-transfer")
    expect(movement!.requiresIntercompanyPolicy).toBe(false)
  })
})

describe("PAY-080-001 — a request whose §10 type cannot be decided does not post", () => {
  it("refuses a memo, because this path writes a journal and a memo does not", async () => {
    // Bible §10's memo allocation is defined by having NO accounting posting.
    // An approval filed as a memo that reaches the journal writer is filed
    // wrong, and posting it would put a journal under a type that says there
    // is none — which reconciles to nothing.
    given({
      ...REIMBURSEMENT,
      payment: { kind: "memo", destinationLegalEntityId: "inst_1" },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/memo allocation/)

    expect(ledgerCreate).not.toHaveBeenCalled()
    expect(db.budgetLine.update).not.toHaveBeenCalled()
    const denial = paymentsDenial()
    expect(denial).toBeDefined()
    expect(denial!.action).toBe("Payments.COMMAND_UNCLASSIFIED")
    expect(denial!.outcome).toBe("DENY")
    expect(String(denial!.reason)).toContain("movement-command-memo-posts-journal")
  })
})

describe("PAY-080-001 — a refusal says WHAT was refused, not only that it was", () => {
  it("names the external command type and Bible §11's verb on a payout", async () => {
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
    const denial = paymentsDenial()
    expect(denial!.action).toBe("Payments.REFUSED")
    const metadata = denial!.metadata as Record<string, unknown>
    expect(metadata.commandType).toBe("EXTERNAL_PROVIDER_MOVEMENT")
    expect(metadata.payoutCommand).toBe("SETTLEMENT_PAYOUT")
  })

  it("names INTERCOMPANY_TRANSFER on an allocation that crosses a legal entity", async () => {
    given({
      ...REIMBURSEMENT,
      payment: { kind: "ledger-allocation", destinationLegalEntityId: "inst_other" },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow()

    expect(ledgerCreate).not.toHaveBeenCalled()
    const metadata = paymentsDenial()!.metadata as Record<string, unknown>
    expect(metadata.commandType).toBe("INTERCOMPANY_TRANSFER")
    expect(metadata.payoutCommand).toBeNull()
  })

  it("names no command type when the classification itself was undecidable", async () => {
    // An internal kind naming an outside payee. `classifyRequest` escalates it,
    // and the type is null rather than a guess — the two answers agree that
    // nobody has decided what this is.
    given({
      ...REIMBURSEMENT,
      payment: {
        kind: "ledger-allocation",
        destinationLegalEntityId: "inst_1",
        beneficiary: { external: true, name: "Rochester Catering Co." },
      },
    })

    await expect(actOnApproval("ar_1", approveForm())).rejects.toThrow(/payments-operations/)

    const metadata = paymentsDenial()!.metadata as Record<string, unknown>
    expect(metadata.commandType).toBeNull()
    expect(metadata.commandCode).toBe("movement-command-internal-names-external-beneficiary")
  })
})
