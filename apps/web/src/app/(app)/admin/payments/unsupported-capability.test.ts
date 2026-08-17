/**
 * PAY-010-008 — an unsupported capability cannot be turned on from outside.
 *
 * Two doors, and the requirement names both.
 *
 * **Stale UI.** `page.tsx` builds the capability dropdown from
 * `PAYMENT_CAPABILITIES.filter((c) => c.state !== "UNSUPPORTED")`. A filtered
 * `<select>` is a fact about one rendered page, and a rendered page is a copy of
 * the truth that was current when it was fetched: the operator's tab from
 * yesterday, a re-submitted form, `curl`. So these drive the WRITER with the ids
 * that dropdown deliberately does not offer, and assert that
 * `paymentsFundsFlowConfig.upsert` is never reached.
 *
 * **Direct manifest editing.** The other way to "enable" something is to edit
 * the document that declares what a tenant has. The last test proves there is no
 * such document for payments: no blueprint and no module manifest names a
 * payments capability id at all, so availability has exactly one source — the
 * registry, which validates its approving ADR against the filesystem on every
 * read. There is no manifest to edit, which is a stronger property than a
 * manifest that is checked.
 *
 * The registry, eligibility, the responsibility matrix, `decideChargeModel` and
 * the gate all run for real; only the database, the session and the admin guard
 * are mocked, exactly as `liability-gate.test.ts` does.
 */

import fs from "node:fs"
import path from "node:path"

jest.mock("@/lib/db", () => {
  const client: Record<string, unknown> = {
    organization: { findFirst: jest.fn(async () => ({ id: "org_1" })) },
    approvalRequest: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: "ar_new" })),
    },
    paymentsFundsFlowConfig: { upsert: jest.fn(async () => ({ id: "cfg_1" })) },
    auditEvent: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null) },
  }
  client.$transaction = jest.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(client) : arg,
  )
  return { db: client }
})
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

/** Every axis answered and every other input valid, so only the id is at issue. */
function form(capabilityId: string): FormData {
  const fd = new FormData()
  fd.set("capabilityId", capabilityId)
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
  fd.set("grossCents", "12000")
  fd.set("platformFeeCents", "0")
  fd.set("lossBearer", "TENANT")
  const answers: Record<string, string> = {
    merchantDisplay: "TENANT",
    feePayer: "TENANT",
    lossPayer: "TENANT",
    refundPayer: "TENANT",
    disputeOwner: "TENANT",
    kycUpdateOwner: "PROVIDER",
    accountCollectionOwner: "PROVIDER",
    supportOwner: "TENANT",
  }
  for (const axis of AXES) fd.set(`direct.${axis}`, answers[axis])
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

describe("the dropdown is not the gate — the writer is", () => {
  const unsupported = PAYMENT_CAPABILITIES.filter((c) => c.state === "UNSUPPORTED").map((c) => c.id)

  it("has UNSUPPORTED leaves to test with, and the page does not offer them", () => {
    // Pinned by value: an empty list would make every case below vacuous.
    expect(unsupported).toEqual([
      "acceptance.in-person-terminal",
      "funds-flow.application-fee",
      "financial-account.embedded",
      "financial-account.transfers",
      "cards.physical-and-virtual",
      "cards.lifecycle",
      "identity.kyc-kyb",
    ])
    const page = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8")
    expect(page).toContain('c.state !== "UNSUPPORTED"')
  })

  it.each(PAYMENT_CAPABILITIES.filter((c) => c.state === "UNSUPPORTED").map((c) => c.id))(
    "refuses %s and writes nothing",
    async (capabilityId) => {
      const result = await saveFundsFlowConfiguration("org_1", form(capabilityId))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("unreachable")
      expect(result.code).toBe("charge-model-undecidable")
      expect(result.blockers.join(" ")).toContain("capability-not-transactable")
      expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
      expect(db.approvalRequest.create).not.toHaveBeenCalled()
    },
  )

  it("refuses a PLANNED leaf too — only certification makes one transactable", async () => {
    const planned = PAYMENT_CAPABILITIES.find((c) => c.state === "PLANNED")!
    const result = await saveFundsFlowConfiguration("org_1", form(planned.id))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.blockers.join(" ")).toContain("capability-not-transactable")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
  })

  it("refuses an id nobody registered, with a reason rather than a stack trace", async () => {
    // Before PAY-010-008 this threw `PaymentCapabilityError` out of the server
    // action: `decideChargeModel` calls `capability(id)`, which refuses an
    // unknown id by throwing. Failing closed, and unreadable — the operator got
    // a 500 and the log got an exception, where the honest answer is that the
    // capability does not exist.
    const result = await saveFundsFlowConfiguration("org_1", form("cards.unlimited-spending"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("capability-unknown")
    expect(result.reason).toContain("cards.unlimited-spending")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
    expect(db.approvalRequest.create).not.toHaveBeenCalled()
  })

  it("refuses an empty capability id rather than reading it as a wildcard", async () => {
    const result = await saveFundsFlowConfiguration("org_1", form(""))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("capability-unknown")
    expect(db.paymentsFundsFlowConfig.upsert).not.toHaveBeenCalled()
  })
})

describe("there is no manifest that could enable a payments capability", () => {
  function repoRoot(): string {
    let dir = process.cwd()
    for (;;) {
      if (fs.existsSync(path.join(dir, "docs", "decisions"))) return dir
      const parent = path.dirname(dir)
      if (parent === dir) throw new Error("no repo root")
      dir = parent
    }
  }

  function filesUnder(rel: string, out: string[] = []): string[] {
    const abs = path.join(repoRoot(), rel)
    for (const entry of fs.readdirSync(abs)) {
      if (entry === "node_modules") continue
      const next = path.join(rel, entry)
      const stat = fs.statSync(path.join(repoRoot(), next))
      if (stat.isDirectory()) filesUnder(next, out)
      else if (/\.(ts|tsx|json)$/.test(entry)) out.push(next.split(path.sep).join("/"))
    }
    return out
  }

  it("finds no payments capability id in any blueprint or module manifest", () => {
    // MUTATION TARGET: adding `capabilityId: "cards.physical-and-virtual"` to a
    // blueprint reds this. The point is not that such a line would work — it is
    // that today there is no document a tenant configuration could put it in,
    // so the only place availability is stated is the registry.
    const documents = [...filesUnder("blueprints"), "modules/index.ts"]
    expect(documents.length).toBeGreaterThanOrEqual(5)

    const ids = PAYMENT_CAPABILITIES.map((c) => c.id)
    expect(ids.length).toBeGreaterThanOrEqual(30)

    const mentions: string[] = []
    for (const file of documents) {
      const text = fs.readFileSync(path.join(repoRoot(), file), "utf8")
      for (const id of ids) {
        if (text.includes(id)) mentions.push(`${file} names ${id}`)
      }
      // The boolean Bible §3 forbids by name, in either spelling.
      for (const flag of ["stripe_enabled", "stripeEnabled", "paymentsEnabled"]) {
        if (text.includes(flag)) mentions.push(`${file} declares ${flag}`)
      }
    }
    expect(mentions).toEqual([])
  })

  it("still finds the ids when it looks for them — the scan is not blind", () => {
    // The control for the assertion above: the same search over a document that
    // does name one must find it.
    const ids = PAYMENT_CAPABILITIES.map((c) => c.id)
    const synthetic = `{ capabilityId: "${ids[0]}", stripe_enabled: true }`
    const found = ids.filter((id) => synthetic.includes(id))
    expect(found).toEqual([ids[0]])
    expect(synthetic.includes("stripe_enabled")).toBe(true)
  })
})
