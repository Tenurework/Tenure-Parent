import {
  CurrencyMismatchError,
  ConversionError,
  convert,
  fromDecimal,
  fromMinorUnits,
  money,
  netSettlement,
  reconcileToJournal,
  zero,
  type ConversionRate,
  type SettlementComponents,
} from "./index"

/**
 * PAY-080-007 — reconcile allocations to a journal and a clearing balance.
 * PAY-130-003 — gross, fees, refunds, disputes, transfers, payouts, FX, net.
 *
 * Both are about the same failure. A reconciliation that can quietly balance is
 * worse than none: it converts "we do not know where the money went" into "the
 * report says it is fine", and the second is the one everybody stops checking.
 * So the assertions below are mostly about what these functions REFUSE to do —
 * round a variance away, absorb a residual, or call something balanced that is
 * one unit out.
 */

const USD = "USD"
const usd = (decimal: string) => fromDecimal(decimal, USD)
const cents = (n: number) => fromMinorUnits(n, USD)

const RATE: ConversionRate = {
  from: "USD",
  to: "JPY",
  rate: "150.25",
  asOf: "2026-08-02T12:00:00Z",
}

describe("reconciling allocations to a journal", () => {
  const balanced = {
    allocations: [
      { account: "line-a", amount: cents(10_000) },
      { account: "line-b", amount: cents(2_500) },
    ],
    journalPostings: [
      { account: "line-a", amount: cents(7_000) },
      { account: "line-a", amount: cents(3_000) },
      { account: "line-b", amount: cents(2_500) },
    ],
    clearing: { balance: cents(12_500) },
  }

  it("balances when every account's postings equal its allocation", () => {
    const report = reconcileToJournal(balanced)
    expect(report.balanced).toBe(true)
    expect(report.unexplained).toEqual([])
    expect(report.clearing.variance.units).toBe(0)
    expect(report.accounts.map((a) => a.account)).toEqual(["line-a", "line-b"])
  })

  it("reports a one-unit discrepancy rather than rounding it away", () => {
    // ONE unit at the package's internal scale — a millionth of a cent. A
    // tolerance of "less than a minor unit" would swallow it, and a systematic
    // sub-unit error repeated across a fleet is exactly what such a tolerance is
    // built (accidentally) to hide.
    const report = reconcileToJournal({
      ...balanced,
      allocations: [
        { account: "line-a", amount: money(cents(10_000).units + 1, USD) },
        { account: "line-b", amount: cents(2_500) },
      ],
      clearing: { balance: cents(12_500) },
    })
    expect(report.balanced).toBe(false)
    expect(report.unexplained).toHaveLength(1)
    expect(report.unexplained[0].account).toBe("line-a")
    expect(report.unexplained[0].variance.units).toBe(1)
    // And it is reported as it stands, not adjusted into another account.
    expect(report.accounts.find((a) => a.account === "line-b")!.variance.units).toBe(0)
  })

  it("never moves money to make the report balance", () => {
    const report = reconcileToJournal({
      allocations: [{ account: "line-a", amount: cents(10_000) }],
      journalPostings: [{ account: "line-a", amount: cents(9_000) }],
      clearing: { balance: cents(9_000) },
    })
    expect(report.accounts[0].allocated.units).toBe(cents(10_000).units)
    expect(report.accounts[0].posted.units).toBe(cents(9_000).units)
    expect(report.accounts[0].variance.units).toBe(cents(1_000).units)
    expect(report.balanced).toBe(false)
  })

  it("catches an account the journal knows about and the platform does not", () => {
    // The case a left-join from allocations misses entirely: money the journal
    // holds against a line nothing allocates to.
    const report = reconcileToJournal({
      allocations: [{ account: "line-a", amount: cents(100) }],
      journalPostings: [
        { account: "line-a", amount: cents(100) },
        { account: "ghost", amount: cents(4_200) },
      ],
      clearing: { balance: cents(4_300) },
    })
    expect(report.balanced).toBe(false)
    expect(report.unexplained.map((u) => u.account)).toEqual(["ghost"])
    expect(report.unexplained[0].detail).toMatch(/does not allocate to at all/)
  })

  it("reports a clearing balance that disagrees with the journal", () => {
    const report = reconcileToJournal({
      allocations: [{ account: "line-a", amount: cents(100) }],
      journalPostings: [{ account: "line-a", amount: cents(100) }],
      clearing: { balance: cents(90) },
    })
    expect(report.balanced).toBe(false)
    expect(report.unexplained.map((u) => u.account)).toEqual(["(clearing)"])
    expect(report.clearing.variance.units).toBe(cents(10).units)
  })

  it("refuses a mixed-currency reconciliation instead of comparing across it", () => {
    expect(() =>
      reconcileToJournal({
        allocations: [{ account: "a", amount: fromDecimal("1.00", "EUR") }],
        journalPostings: [],
        clearing: { balance: cents(100) },
      }),
    ).toThrow(CurrencyMismatchError)
  })

  it("refuses two allocations to the same account", () => {
    expect(() =>
      reconcileToJournal({
        allocations: [
          { account: "a", amount: cents(1) },
          { account: "a", amount: cents(2) },
        ],
        journalPostings: [],
        clearing: { balance: cents(3) },
      }),
    ).toThrow(/allocated twice/)
  })

  it("proves the settling system's own statement when it states one", () => {
    // PAY-130-003 reaching PAY-080-007. A provider whose statement does not add
    // up cannot be used as the other side of a comparison as though it did.
    const components: SettlementComponents = {
      gross: cents(10_000),
      fees: cents(300),
      refunds: cents(200),
      disputes: zero(USD),
      transfers: zero(USD),
      payouts: cents(9_000), // should be 9,500
      fxGainLoss: zero(USD),
    }
    const report = reconcileToJournal({
      allocations: [{ account: "a", amount: cents(9_000) }],
      journalPostings: [{ account: "a", amount: cents(9_000) }],
      clearing: { balance: cents(9_000), components },
    })
    expect(report.settlement!.settles).toBe(false)
    expect(report.balanced).toBe(false)
    expect(report.unexplained.map((u) => u.account)).toEqual(["(settlement)"])
    expect(report.unexplained[0].variance.units).toBe(cents(500).units)
  })
})

describe("the eight settlement components prove each other", () => {
  const settling: SettlementComponents = {
    gross: cents(100_000),
    fees: cents(2_900),
    refunds: cents(5_000),
    disputes: cents(1_500),
    transfers: cents(20_000),
    payouts: cents(70_725),
    // A conversion gain: the statement was struck in one currency and settled
    // after a movement in the platform's favour.
    fxGainLoss: cents(125),
  }

  it("settles when the components add up to the payout", () => {
    // 100,000 − 2,900 − 5,000 − 1,500 − 20,000 + 125 = 70,725
    const net = netSettlement(settling)
    expect(net.settles).toBe(true)
    expect(net.residual.units).toBe(0)
    expect(net.refusal).toBeNull()
    expect(net.expectedPayouts.units).toBe(cents(70_725).units)
  })

  it("names the refusal rather than adjusting the payout", () => {
    const net = netSettlement({ ...settling, payouts: cents(70_000) })
    expect(net.settles).toBe(false)
    expect(net.refusal!.code).toBe("NET_SETTLEMENT_DOES_NOT_BALANCE")
    expect(net.refusal!.detail).toMatch(/Nothing has been adjusted/)
    expect(net.residual.units).toBe(cents(725).units)
    // The payout it reports is the one the statement claims, untouched.
    expect(net.payouts.units).toBe(cents(70_000).units)
  })

  it("says which direction a discrepancy goes in", () => {
    expect(netSettlement({ ...settling, payouts: cents(70_000) }).refusal!.detail).toMatch(/Short by/)
    expect(netSettlement({ ...settling, payouts: cents(71_000) }).refusal!.detail).toMatch(/Over by/)
  })

  it("refuses a statement mixing currencies", () => {
    expect(() =>
      netSettlement({ ...settling, fees: fromDecimal("29.00", "EUR") }),
    ).toThrow(CurrencyMismatchError)
  })
})

describe("converting at a stated rate is exact integer arithmetic", () => {
  it("respects the two currencies' different minor units", () => {
    // $100.00 at 150.25 is ¥15,025 — not 10,000 × 150.25 in anybody's units.
    // A float multiply of the unit counts is out by a factor of a hundred here,
    // in a direction that looks plausible.
    const converted = convert(usd("100.00"), RATE, "half-even")
    expect(converted.currency).toBe("JPY")
    expect(converted.units).toBe(fromDecimal("15025", "JPY").units)
  })

  it("rounds an exact half under the mode the caller stated, not Math.round's", () => {
    // 5 internal units of USD at rate 0.1 is exactly 0.5 of a JPY internal unit.
    // `Math.round(5 * 0.1)` is 1. half-even is 0, half-away-from-zero is 1,
    // and down is 0 — the four disagree, which is the whole point.
    const tenth: ConversionRate = { from: "USD", to: "USD", rate: "0.1", asOf: RATE.asOf }
    expect(convert(money(5, USD), tenth, "half-even").units).toBe(0)
    expect(convert(money(5, USD), tenth, "half-away-from-zero").units).toBe(1)
    expect(convert(money(5, USD), tenth, "down").units).toBe(0)
    expect(convert(money(5, USD), tenth, "half-up").units).toBe(1)
    // And symmetrically for a debit: half-away-from-zero keeps the magnitude,
    // half-up does not — because half-up is toward +Infinity by definition.
    expect(convert(money(-5, USD), tenth, "half-away-from-zero").units).toBe(-1)
    expect(convert(money(-5, USD), tenth, "half-up").units).toBe(0)
  })

  it("stays exact where a double would not", () => {
    // 1,000,000,003 × 1.1: the double product is 1100000003.3000002, and any
    // implementation that forms it and then rounds is at the mercy of the last
    // bit. Exact integer arithmetic gives 1100000003.3 -> 1100000003.
    const eleven: ConversionRate = { from: "USD", to: "USD", rate: "1.1", asOf: RATE.asOf }
    expect(convert(money(1_000_000_003, USD), eleven, "half-even").units).toBe(1_100_000_003)
    expect(convert(money(1_000_000_005, USD), eleven, "half-even").units).toBe(1_100_000_006)
  })

  it("refuses a rate with no usable date", () => {
    // A rate with no date cannot be reproduced, so neither can the settlement
    // that used it — which is the sentence CurrencyMismatchError has always
    // pointed at.
    expect(() => convert(usd("1.00"), { ...RATE, asOf: "" }, "half-even")).toThrow(ConversionError)
    expect(() => convert(usd("1.00"), { ...RATE, asOf: "soon" }, "half-even")).toThrow(ConversionError)
  })

  it("refuses a rate that is not a decimal string", () => {
    expect(() => convert(usd("1.00"), { ...RATE, rate: "1.1e2" }, "half-even")).toThrow(ConversionError)
  })

  it("refuses to convert an amount that is not in the rate's from-currency", () => {
    expect(() => convert(fromDecimal("1.00", "GBP"), RATE, "half-even")).toThrow(CurrencyMismatchError)
  })
})
