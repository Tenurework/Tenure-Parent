/**
 * PAY-060-001, asserted on the ROUTE rather than on the reader.
 *
 * The requirement is that Tenure's payment order state is its own — so the
 * test that matters is on the surface where the provider's state actually
 * arrives. A test that called `observeProviderState` directly would stay green
 * the day the inbox stopped calling it, which is exactly the regression worth
 * guarding.
 *
 * Mocked: the database. NOT mocked: signature verification, the API-version
 * check, the event parser, the dedupe rule and the canonical reader — every
 * rule this is about runs for real, over a real HMAC.
 */

import { createHmac } from "crypto"

jest.mock("@/lib/db", () => ({
  db: {
    providerEventReceipt: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async (args: unknown) => args),
    },
  },
}))

import { db as mockedDb } from "@/lib/db"
import { PROVIDER_API_VERSION } from "@tenure/payments"

import { POST } from "./route"

const db = mockedDb as unknown as {
  providerEventReceipt: { findMany: jest.Mock; create: jest.Mock }
}

const SECRET = "whsec_test_movement_1234567890"

/** A supported event body, signed the way the provider signs one. */
function signedRequest(body: Record<string, unknown>) {
  const raw = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac("sha256", SECRET).update(`${timestamp}.${raw}`, "utf8").digest("hex")
  return new Request("https://tenure.test/api/payments/provider-events", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: raw,
  })
}

function envelope(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type.replace(/\W/g, "_")}_1`,
    type,
    api_version: PROVIDER_API_VERSION,
    account: "acct_connected_1",
    created: 1_770_000_000,
    data: { object },
  }
}

const SUCCEEDED = envelope("payment_intent.succeeded", {
  id: "pi_1",
  amount_received: 4200,
  currency: "usd",
  on_behalf_of: "acct_connected_1",
})

const ACCOUNT_UPDATED = envelope("account.updated", {
  id: "acct_connected_1",
  charges_enabled: true,
  payouts_enabled: false,
  requirements: { currently_due: [] },
})

beforeEach(() => {
  jest.clearAllMocks()
  db.providerEventReceipt.findMany.mockResolvedValue([])
  db.providerEventReceipt.create.mockImplementation(async (args: unknown) => args)
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET
  process.env.PAYMENTS_PROVIDER_MODE = "test"
  delete process.env.PAYMENTS_WEBHOOK_SECRET_PREVIOUS
})

describe("PAY-060-001 — the inbox reads a provider event as evidence", () => {
  it("returns the canonical state the event evidences, and says it applied nothing", async () => {
    const response = await POST(signedRequest(SUCCEEDED))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      received: true,
      observed: "SUCCEEDED",
      reading: "CANONICAL",
      applied: false,
    })
    // Recorded, exactly once, with no state written on it: the receipt is a
    // minimized copy of what arrived, not a business transition.
    expect(db.providerEventReceipt.create).toHaveBeenCalledTimes(1)
    const written = db.providerEventReceipt.create.mock.calls[0][0].data
    expect(written.eventType).toBe("payment_intent.succeeded")
    expect(Object.keys(written)).not.toContain("observed")
  })

  it("distinguishes an account event from an unreadable one", async () => {
    const account = await (await POST(signedRequest(ACCOUNT_UPDATED))).json()
    expect(account.reading).toBe("NOT_A_PAYMENT_ORDER_EVENT")
    expect(account.observed).toBeNull()
  })

  it("carries the reading on a duplicate too, and still writes nothing", async () => {
    db.providerEventReceipt.findMany.mockResolvedValue([
      {
        provider: "stripe",
        mode: "test",
        accountId: "acct_connected_1",
        eventId: SUCCEEDED.id,
        sequence: SUCCEEDED.created,
      },
    ])
    const body = await (await POST(signedRequest(SUCCEEDED))).json()
    expect(body.verdict).toBe("duplicate")
    expect(body.observed).toBe("SUCCEEDED")
    expect(body.applied).toBe(false)
    expect(db.providerEventReceipt.create).not.toHaveBeenCalled()
  })

  it("reads a payout event as SETTLED without any order being advanced", async () => {
    const payout = envelope("payout.paid", {
      id: "po_1",
      amount: 4200,
      currency: "usd",
      arrival_date: 1_770_100_000,
      destination: "ba_1",
    })
    const body = await (await POST(signedRequest(payout))).json()
    expect(body.observed).toBe("SETTLED")
    expect(body.applied).toBe(false)
  })

  it("still refuses an unsigned event before any reading happens", async () => {
    const raw = JSON.stringify(SUCCEEDED)
    const unsigned = new Request("https://tenure.test/api/payments/provider-events", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: raw,
    })
    const response = await POST(unsigned)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.observed).toBeUndefined()
    expect(db.providerEventReceipt.create).not.toHaveBeenCalled()
  })
})
