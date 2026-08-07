import {
  balanceTransactionKey,
  ingest,
  type BalanceTransactionInput,
  type StoredBalanceTransaction,
} from "./balance-transactions"

/**
 * PAY-130-004 — the inbound replay guard.
 *
 * Two properties, and the second is the one that is usually missing:
 *   1. the key is qualified, so `txn_1` in test and `txn_1` in live are two
 *      transactions rather than one and a false "replayed";
 *   2. a seen id with DIFFERENT content is a conflict, never an idempotent
 *      no-op — a provider correcting a transaction reuses the id, and dropping
 *      it keeps the superseded figure and reports nothing.
 */

const base: BalanceTransactionInput = {
  institutionId: "inst_1",
  provider: "stripe",
  mode: "live",
  providerAccountId: "acct_1",
  externalId: "txn_1",
  currency: "USD",
  grossMinorUnits: 10_000,
  feeMinorUnits: 320,
  netMinorUnits: 9_680,
  occurredAt: "2026-08-01T00:00:00.000Z",
  payloadDigest: "digest-a",
}

const stored = (txn: BalanceTransactionInput): StoredBalanceTransaction => ({
  provider: txn.provider,
  mode: txn.mode,
  providerAccountId: txn.providerAccountId,
  externalId: txn.externalId,
  payloadDigest: txn.payloadDigest,
})

describe("ingest", () => {
  it("inserts what it has not seen", () => {
    const out = ingest([], [base])
    expect(out.inserted).toHaveLength(1)
    expect(out.replayed).toHaveLength(0)
    expect(out.conflicting).toHaveLength(0)
  })

  it("reports an identical redelivery as a replay, and writes nothing", () => {
    const out = ingest([stored(base)], [base])
    expect(out.inserted).toHaveLength(0)
    expect(out.replayed).toHaveLength(1)
  })

  it("refuses a seen id whose payload digest differs", () => {
    const corrected = { ...base, netMinorUnits: 9_000, payloadDigest: "digest-b" }
    const out = ingest([stored(base)], [corrected])

    expect(out.inserted).toHaveLength(0)
    expect(out.replayed).toHaveLength(0)
    expect(out.conflicting).toHaveLength(1)
    expect(out.conflicting[0].storedDigest).toBe("digest-a")
    expect(out.conflicting[0].detail).toContain("never a retry")
  })

  it("treats the SAME id in test and live as two transactions", () => {
    // This is the mutation target for the requirement: dropping `mode` from the
    // key makes the second of these a false "replayed", and a real live
    // transaction is silently never ingested.
    const liveTxn = base
    const testTxn = { ...base, mode: "test" as const, payloadDigest: "digest-test" }

    const out = ingest([stored(liveTxn)], [testTxn])

    expect(out.replayed).toHaveLength(0)
    expect(out.conflicting).toHaveLength(0)
    expect(out.inserted).toHaveLength(1)
    expect(out.inserted[0].mode).toBe("test")
  })

  it("treats the same id under two provider accounts as two transactions", () => {
    const out = ingest(
      [stored(base)],
      [{ ...base, providerAccountId: "acct_2", payloadDigest: "digest-other" }],
    )
    expect(out.inserted).toHaveLength(1)
    expect(out.replayed).toHaveLength(0)
  })

  it("handles a batch that repeats a transaction: first inserts, identical repeat replays", () => {
    const out = ingest([], [base, base])
    expect(out.inserted).toHaveLength(1)
    expect(out.replayed).toHaveLength(1)
  })

  it("handles a batch that CONTRADICTS itself: the differing repeat conflicts", () => {
    const out = ingest([], [base, { ...base, payloadDigest: "digest-b" }])
    expect(out.inserted).toHaveLength(1)
    expect(out.conflicting).toHaveLength(1)
  })
})

describe("balanceTransactionKey", () => {
  it("changes when any of the four qualifying parts changes", () => {
    const keys = new Set([
      balanceTransactionKey(base),
      balanceTransactionKey({ ...base, provider: "adyen" }),
      balanceTransactionKey({ ...base, mode: "test" }),
      balanceTransactionKey({ ...base, providerAccountId: "acct_2" }),
      balanceTransactionKey({ ...base, externalId: "txn_2" }),
    ])
    expect(keys.size).toBe(5)
  })
})
