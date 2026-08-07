import {
  CurrencyMismatchError,
  PriceError,
  activationPreview,
  includedInPlan,
  priceProblems,
  quoteConfiguration,
  type OptionPrice,
  type PricedOption,
} from "./index"

/**
 * PAY-160-002 — every option, every stage, per seat AND whole org, with a
 * running total, and the seven disclosures that must be settled before a system
 * is activated.
 *
 * The composer had five stages and no price in any of them. The bug that makes
 * a price field worth having is not arithmetic — it is that a blank price on a
 * form does not read as "unpriced", it reads as free. So most of what is
 * asserted here is about refusal: a price that is not a whole number of minor
 * units, an option priced at zero with no reason, a quote that would add
 * dollars to euros.
 */

const usd = (perSeatMinor: number, perOrgMinor: number): OptionPrice => ({
  perSeatMinor,
  perOrgMinor,
  currency: "USD",
  rounding: "half-up",
})

const option = (optionKey: string, price: OptionPrice): PricedOption => ({ optionKey, price })

describe("a configuration is quoted per seat and for the whole organization", () => {
  it("extends each line and totals them", () => {
    // 5,000 + 300 × 25 = 12,500; 1,500 + 50 × 25 = 2,750. Total 15,250.
    const quote = quoteConfiguration([option("organizations", usd(300, 5_000)), option("feed", usd(50, 1_500))], 25)
    expect(quote.currency).toBe("USD")
    expect(quote.seatCount).toBe(25)
    expect(quote.lines.map((l) => l.extendedMinor)).toEqual([12_500, 2_750])
    expect(quote.runningTotalMinor).toBe(15_250)
  })

  it("charges the per-organization price even at zero seats", () => {
    // The whole point of two prices. A ledger costs the same for ten officers
    // and two hundred, and a quote that collapses to per-seat charges a system
    // nobody has joined yet nothing at all.
    const quote = quoteConfiguration([option("budgeting", usd(200, 9_000))], 0)
    expect(quote.runningTotalMinor).toBe(9_000)
  })

  it("scales the per-seat half with the seat count", () => {
    const at10 = quoteConfiguration([option("messaging", usd(100, 1_500))], 10).runningTotalMinor
    const at200 = quoteConfiguration([option("messaging", usd(100, 1_500))], 200).runningTotalMinor
    expect(at10).toBe(2_500)
    expect(at200).toBe(21_500)
  })

  it("quotes nothing for nothing, without inventing a currency mismatch", () => {
    const quote = quoteConfiguration([], 25)
    expect(quote.runningTotalMinor).toBe(0)
    expect(quote.lines).toEqual([])
  })

  it("refuses a fractional or negative seat count", () => {
    expect(() => quoteConfiguration([option("a", usd(1, 1))], 2.5)).toThrow(PriceError)
    expect(() => quoteConfiguration([option("a", usd(1, 1))], -1)).toThrow(PriceError)
  })

  it("refuses to add options priced in different currencies", () => {
    // A total across currencies is not a total. Adding the integers would give a
    // number that renders happily beside a dollar sign and is wrong.
    expect(() =>
      quoteConfiguration(
        [option("a", usd(100, 0)), option("b", { ...usd(100, 0), currency: "EUR" })],
        10,
      ),
    ).toThrow(CurrencyMismatchError)
  })

  it("refuses a price that is not a whole number of minor units", () => {
    expect(() => quoteConfiguration([option("a", usd(1.5, 0))], 1)).toThrow(PriceError)
    expect(() => quoteConfiguration([option("a", usd(-1, 0))], 1)).toThrow(PriceError)
  })

  it("counts JPY in yen, not in hundredths of a yen", () => {
    const yen: OptionPrice = { perSeatMinor: 300, perOrgMinor: 5_000, currency: "JPY", rounding: "half-up" }
    expect(quoteConfiguration([option("organizations", yen)], 10).runningTotalMinor).toBe(8_000)
  })
})

describe("a price of zero is a commercial statement and has to say why", () => {
  it("accepts a free option that gives a reason", () => {
    expect(priceProblems(includedInPlan("Every system has a front door."), "Module \"dashboard\"")).toEqual([])
  })

  it("names the option when the price is unusable", () => {
    expect(priceProblems(undefined, 'Module "x"')[0]).toMatch(/Module "x" declares no price/)
    expect(priceProblems({ ...usd(0, 0), currency: "usd" }, 'Module "x"')[0]).toMatch(/ISO 4217/)
    expect(
      priceProblems({ ...usd(0, 0), rounding: "nearest" as never }, 'Module "x"')[0],
    ).toMatch(/expected one of/)
  })
})

describe("the pre-activation disclosure states what is not decided", () => {
  const preview = () =>
    activationPreview([option("organizations", usd(300, 5_000)), option("budgeting", usd(200, 9_000))], 40)

  it("covers all seven topics, every time", () => {
    expect(preview().disclosures.map((d) => d.topic).sort()).toEqual([
      "fees",
      "funds-flow",
      "ledger-preview",
      "legal-merchant",
      "loss-responsibility",
      "settlement",
      "tax",
    ])
  })

  it("is never ready to activate while a topic is open", () => {
    // No default and no third state. A panel that renders "Merchant of record:
    // Tenure" because a field was blank has made a legal claim on the
    // platform's behalf.
    const p = preview()
    expect(p.readyToActivate).toBe(false)
    expect(p.openTopics).toHaveLength(6)
    expect(p.openTopics).not.toContain("ledger-preview")
  })

  it("names what would settle each open topic", () => {
    for (const disclosure of preview().disclosures) {
      if (disclosure.state === "UNDECIDED") {
        expect(disclosure.wouldRecordIt).toMatch(/PAY-\d{3}-\d{3}/)
      } else {
        expect(disclosure.recordedIn.length).toBeGreaterThan(10)
      }
    }
  })

  it("makes the ledger preview the quote, to the unit", () => {
    // 5,000 + 300 × 40 = 17,000; 9,000 + 200 × 40 = 17,000. Total 34,000.
    const p = preview()
    expect(p.quote.runningTotalMinor).toBe(34_000)
    const ledger = p.disclosures.find((d) => d.topic === "ledger-preview")!
    expect(ledger.state).toBe("DECIDED")
    expect(ledger.statement).toContain("34000")
    expect(ledger.statement).toContain("40 seat(s)")
  })
})
