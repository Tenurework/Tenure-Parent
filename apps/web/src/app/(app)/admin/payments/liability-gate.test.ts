/**
 * PAY-040-003 / PAY-070-003, asserted on what the WRITER emits.
 *
 * `requiresLiabilityException` returning the right answer proves nothing on its
 * own — the requirement is that the configuration writer REFUSES to persist. So
 * these drive `saveFundsFlowConfiguration` and assert on whether
 * `paymentsFundsFlowConfig.upsert` was reached and on the exception request the
 * refusal raised.
 *
 * The registry, the eligibility simulation, the responsibility matrix, the
 * funds-flow choice, `decideChargeModel`, the digest and the gate all run for
 * real. Only the database, the session and the admin guard are mocked.
 */

type Args = { data?: Record<string, unknown>; where?: unknown; create?: Record<string, unknown> }

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findFirst: jest.fn(async () => ({ id: "org_1" })) },
    approvalRequest: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: "ar_new" })),
    },
    paymentsFundsFlowConfig: { upsert: jest.fn(async () => ({ id: "cfg_1" })) },
    auditEvent: { create: jest.fn(async () => ({})) },
  },
}))
jest.mock("@/lib/admin/guard", () => ({
  requireAdminContext: jest.fn(async () => ({
    userId: "user_admin",
    ctx: {},
    institutionId: "inst_1",
    role: "OSE_DIRECTOR",
  })),
}))
jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (_userId: string, fn: () => Promise<unknown>) => fn(),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { PAYMENT_CAPABILITIES } from "@tenure/payments"
import { db as mockedDb } from "@/lib/db"

type Mocked = jest.Mock
const db = mockedDb as unknown as {
  organization: { findFirst: Mocked }
  approvalRequest: { findMany: Mocked; create: Mocked }
  paymentsFundsFlowConfig: { upsert: Mocked }
  auditEvent: { create: Mocked }
}

import { saveFundsFlowConfiguration } from "./actions"

const LEAF = "funds-flow.direct-charge"

/**
 * Certify the leaf for the duration of one call.
 *
 * Nothing in the shipped registry is transactable, which is the truthful state
 * and would make every case below refuse for the same uninteresting reason. The
 * narrowest possible stub — the state field of one entry, with the real matrix
 * values left alone — is what lets the liability branch be reached at all.
 */
async function certified<T>(run: () => Promise<T>): Promise<T> {
  const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === LEAF)!
  const original = leaf.state
  ;(leaf as { state: string }).state = "GA_LIMITED"
  try {
    // AWAITED inside the try. Returning the promise and restoring in `finally`
    // puts the state back before the action has read it, which is a stub that
    // silently does nothing — the first version of this file did exactly that
    // and every case refused for the wrong reason.
    return await run()
  } finally {
    ;(leaf as { state: string }).state = original
  }
}

const AXES = [
  "merchantDisplay",
  "feePayer",
  "lossPayer",
  "refundPayer",
  "disputeOwner",
  "kycUpdateOwner",
  "accountCollectionOwner",
  "supportOwner",
] as const

const TENANT_ANSWERS: Record<(typeof AXES)[number], string> = {
  merchantDisplay: "TENANT",
  feePayer: "TENANT",
  lossPayer: "TENANT",
  refundPayer: "TENANT",
  disputeOwner: "TENANT",
  kycUpdateOwner: "PROVIDER",
  accountCollectionOwner: "PROVIDER",
  supportOwner: "TENANT",
}

function form(options: {
  flow: "direct" | "destination" | "separate_charges_and_transfers"
  answers?: Partial<Record<(typeof AXES)[number], string>>
  lossBearer?: string
  grossCents?: number
  /** Axes to answer on `direct`, to force a fall-through to a later flow. */
  directAnswers?: Partial<Record<(typeof AXES)[number], string>>
}): FormData {
  const fd = new FormData()
  fd.set("capabilityId", LEAF)
  fd.set("legalEntityId", "le_rochester")
  fd.set("sellerCountry", "US")
  fd.set("legalEntityType", "NON_PROFIT")
  fd.set("businessType", "EDUCATION")
  fd.set("buyerCountry", "US")
  fd.set("buyerKind", "INDIVIDUAL")
  fd.set("region", "US")
  fd.set("currency", "USD")
  fd.set("connectedAccountId", "acct_1")
  fd.set("chargesEnabled", "on")
  fd.set("payoutsEnabled", "on")
  fd.set("grossCents", String(options.grossCents ?? 12000))
  fd.set("platformFeeCents", "0")
  fd.set("lossBearer", options.lossBearer ?? "TENANT")

  const answers = { ...TENANT_ANSWERS, ...(options.answers ?? {}) }
  for (const axis of AXES) fd.set(`${options.flow}.${axis}`, answers[axis])
  if (options.directAnswers) {
    for (const [axis, value] of Object.entries(options.directAnswers)) {
      fd.set(`direct.${axis}`, value)
    }
  }
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  db.organization.findFirst.mockResolvedValue({ id: "org_1" })
  db.approvalRequest.findMany.mockResolvedValue([])
  db.approvalRequest.create.mockResolvedValue({ id: "ar_new" })
  db.paymentsFundsFlowConfig.upsert.mockResolvedValue({ id: "cfg_1" })
  db.auditEvent.create.mockResolvedValue({})
})

describe("a direct charge on the tenant needs no exception and persists", () => {
  it("writes the configuration and records no exception approval", async () => {
    const result = await certified(() =>
      saveFundsFlowConfiguration("org_1", form({ flow: "direct" })),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.chargeModel).toBe("DIRECT")
    expect(result.liableParty).toBe("TENANT")

    expect(db.paymentsFundsFlowConfig.upsert).toHaveBeenCalledTimes(1)
    const [args] = db.paymentsFundsFlowConfig.upsert.mock.calls[0] as [Args]
    expect(args.create!.chargeModel).toBe("DIRECT")
    expect(args.create!.exceptionApprovalId).toBeNull()
    expect(db.approvalRequest.create).not.toHaveBeenCalled()
  })
})

describe("a liability-shifting flow is refused until an exception is APPROVED", () => {
  /** Direct is deliberately incomplete, so the decision falls to `destination`. */
  const destinationOnTenure = (grossCents = 12000) =>
    form({
      flow: "destination",
      answers: { lossPayer: "TENURE" },
      lossBearer: "TENURE",
      grossCents,
      directAnswers: { merchantDisplay: "TENANT" },
    })

  it("refuses a DESTINATION charge carrying loss on Tenure, and raises the request", async () => {
    const result = await certified(() =>
      saveFundsFlowConfiguration("org_1", destinationOnTenure()),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("liability-exception-missing")

    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
    expect(db.approvalRequest.create).toHaveBeenCalledTimes(1)

    const [created] = db.approvalRequest.create.mock.calls[0] as [Args]
    expect(created.data!.type).toBe("EXCEPTION")
    const metadata = created.data!.metadata as {
      payments: { decisionDigest: string; model: string; liableParty: string }
    }
    expect(metadata.payments.model).toBe("DESTINATION")
    expect(metadata.payments.liableParty).toBe("TENURE")
    expect(metadata.payments.decisionDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("refuses SEPARATE_CHARGE_AND_TRANSFER the same way", async () => {
    // MUTATION TARGET: making `requiresLiabilityException` return false for
    // SEPARATE_CHARGE_AND_TRANSFER reds this at the WRITER, which is where it
    // matters — the configuration would otherwise be persisted unapproved.
    const fd = form({
      flow: "separate_charges_and_transfers",
      answers: { lossPayer: "TENURE" },
      lossBearer: "TENURE",
      directAnswers: { merchantDisplay: "TENANT" },
    })
    fd.set("destination.merchantDisplay", "TENANT")

    const result = await certified(() => saveFundsFlowConfiguration("org_1", fd))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("liability-exception-missing")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()

    const [created] = db.approvalRequest.create.mock.calls[0] as [Args]
    const metadata = created.data!.metadata as { payments: { model: string } }
    expect(metadata.payments.model).toBe("SEPARATE_CHARGE_AND_TRANSFER")
  })

  it("still refuses while the pinned request is pending, and raises no second one", async () => {
    // First pass to learn the digest the gate pins.
    await certified(() => saveFundsFlowConfiguration("org_1", destinationOnTenure()))
    const [created] = db.approvalRequest.create.mock.calls[0] as [Args]
    const digest = (created.data!.metadata as { payments: { decisionDigest: string } }).payments
      .decisionDigest

    jest.clearAllMocks()
    db.organization.findFirst.mockResolvedValue({ id: "org_1" })
    db.approvalRequest.findMany.mockResolvedValue([
      {
        id: "ar_pending",
        type: "EXCEPTION",
        status: "PENDING_OSE",
        metadata: { payments: { decisionDigest: digest } },
      },
    ])

    const result = await certified(() =>
      saveFundsFlowConfiguration("org_1", destinationOnTenure()),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("liability-exception-not-decided")
    expect(result.approvalId).toBe("ar_pending")
    expect(db.approvalRequest.create).not.toHaveBeenCalled()
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
  })

  it("persists once the pinned request is APPROVED", async () => {
    await certified(() => saveFundsFlowConfiguration("org_1", destinationOnTenure()))
    const [created] = db.approvalRequest.create.mock.calls[0] as [Args]
    const digest = (created.data!.metadata as { payments: { decisionDigest: string } }).payments
      .decisionDigest

    jest.clearAllMocks()
    db.organization.findFirst.mockResolvedValue({ id: "org_1" })
    db.paymentsFundsFlowConfig.upsert.mockResolvedValue({ id: "cfg_1" })
    db.auditEvent.create.mockResolvedValue({})
    db.approvalRequest.findMany.mockResolvedValue([
      {
        id: "ar_ok",
        type: "EXCEPTION",
        status: "APPROVED",
        metadata: { payments: { decisionDigest: digest } },
      },
    ])

    const result = await certified(() =>
      saveFundsFlowConfiguration("org_1", destinationOnTenure()),
    )
    expect(result.ok).toBe(true)
    expect(db.paymentsFundsFlowConfig.upsert).toHaveBeenCalledTimes(1)
    const [args] = db.paymentsFundsFlowConfig.upsert.mock.calls[0] as [Args]
    expect(args.create!.exceptionApprovalId).toBe("ar_ok")
    expect(args.create!.decisionDigest).toBe(digest)
  })

  it("refuses again when the amount changes after approval", async () => {
    // MUTATION TARGET: dropping the amounts from `chargeModelDigest` reds this.
    // An approver who blessed a destination charge at 12000 minor units has not
    // blessed the same flow at 12,000,000.
    await certified(() => saveFundsFlowConfiguration("org_1", destinationOnTenure(12000)))
    const [created] = db.approvalRequest.create.mock.calls[0] as [Args]
    const digestForSmall = (created.data!.metadata as { payments: { decisionDigest: string } })
      .payments.decisionDigest

    jest.clearAllMocks()
    db.organization.findFirst.mockResolvedValue({ id: "org_1" })
    db.approvalRequest.create.mockResolvedValue({ id: "ar_new2" })
    db.approvalRequest.findMany.mockResolvedValue([
      {
        id: "ar_ok",
        type: "EXCEPTION",
        status: "APPROVED",
        metadata: { payments: { decisionDigest: digestForSmall } },
      },
    ])

    const result = await certified(() =>
      saveFundsFlowConfiguration("org_1", destinationOnTenure(12_000_000)),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("liability-exception-digest-mismatch")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
    // A NEW request, pinned to the new decision — never the old one's authority.
    expect(db.approvalRequest.create).toHaveBeenCalledTimes(1)
  })
})

describe("an undecidable decision is refused before the gate is reached", () => {
  it("returns every blocker and writes nothing when no axis is answered", async () => {
    const fd = form({ flow: "direct" })
    for (const axis of AXES) fd.delete(`direct.${axis}`)
    fd.set("lossBearer", "")

    const result = await certified(() => saveFundsFlowConfiguration("org_1", fd))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("charge-model-undecidable")
    expect(result.blockers.join(" ")).toContain("loss-bearer-unanswered")
    expect(result.blockers.join(" ")).toContain("funds-flow-unavailable")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
    expect(db.approvalRequest.create).not.toHaveBeenCalled()
  })

  it("refuses a club outside the acting institution", async () => {
    db.organization.findFirst.mockResolvedValue(null)
    const result = await certified(() =>
      saveFundsFlowConfiguration("org_other", form({ flow: "direct" })),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("organization-out-of-scope")
  })

  it("refuses on the shipped registry, where the capability is not transactable", async () => {
    const result = await saveFundsFlowConfiguration("org_1", form({ flow: "direct" }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.blockers.join(" ")).toContain("capability-not-transactable")
  })
})
