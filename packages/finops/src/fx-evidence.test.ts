/**
 * PAY-190-002 — the FX record, and every fact it refuses to invent.
 *
 * The arithmetic under this is `convert`, which has its own tests. What is
 * asserted here is the evidence: that a converted amount carries the quote that
 * produced it, that the fee stays separate from the rate, that a gain and a loss
 * come out with the right sign, that "no recognition leg" is not reported as a
 * gain of zero, and that every missing or contradicted fact is a named refusal
 * rather than a number.
 */

import { convertWithEvidence, fxEvidenceRecord, type QuotedRate } from "./fx-evidence"

const AT = "2026-08-17T12:00:00.000Z"

function quote(over: Partial<QuotedRate> = {}): QuotedRate {
  return {
    from: "EUR",
    to: "USD",
    rate: "1.1",
    asOf: "2026-08-17T11:59:30.000Z",
    source: "provider:stripe",
    quoteId: "fxq_1",
    ...over,
  }
}

function input(over: Record<string, unknown> = {}) {
  return {
    presentmentMinorUnits: 10_000,
    presentmentCurrency: "EUR",
    settlementCurrency: "USD",
    quote: quote(),
    providerFeeMinorUnits: null as number | null,
    recognitionQuote: null as QuotedRate | null,
    providerSettledMinorUnits: null as number | null,
    at: AT,
    maxQuoteAgeSeconds: 3600,
    ...over,
  }
}

describe("the converted amount and its provenance", () => {
  it("converts at the stated rate and keeps the quote on the record", () => {
    const outcome = convertWithEvidence(input())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // €100.00 at 1.1 is $110.00. Both currencies have two minor digits, so this
    // is 11_000 cents — and it is 11_000 because of the exponent term, not in
    // spite of it.
    expect(outcome.evidence.settlement).toEqual({ minorUnits: 11_000, currency: "USD" })
    expect(outcome.evidence.conversion).toBe("CONVERTED")
    expect(outcome.evidence.quote).toMatchObject({
      rate: "1.1",
      source: "provider:stripe",
      quoteId: "fxq_1",
      asOf: "2026-08-17T11:59:30.000Z",
    })
  })

  it("honours differing minor-unit exponents", () => {
    // $100.00 at 150 is ¥15,000 — 15_000 JPY minor units, not 1_500_000.
    const outcome = convertWithEvidence(
      input({
        presentmentMinorUnits: 10_000,
        presentmentCurrency: "USD",
        settlementCurrency: "JPY",
        quote: quote({ from: "USD", to: "JPY", rate: "150" }),
      }),
    )
    expect(outcome.ok && outcome.evidence.settlement.minorUnits).toBe(15_000)
  })

  it("rounds once and records the discarded fraction exactly", () => {
    // €0.01 at 1.115 is $0.011150 — a tenth of a cent past a whole cent.
    const outcome = convertWithEvidence(
      input({ presentmentMinorUnits: 1, quote: quote({ rate: "1.115" }) }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.evidence.settlement.minorUnits).toBe(1)
    // 0.011150 cents beyond the rounded 1 cent, in 10^-6 minor units, exactly.
    expect(outcome.evidence.roundingResidualMicroMinorUnits).toBe(115_000)
    expect(outcome.evidence.rounding).toBe("half-even")
  })

  it("keeps the provider's conversion fee out of the rate", () => {
    const outcome = convertWithEvidence(input({ providerFeeMinorUnits: 220 }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // The converted amount is untouched by the fee; the net is what lands.
    expect(outcome.evidence.settlement.minorUnits).toBe(11_000)
    expect(outcome.evidence.providerFee).toEqual({ minorUnits: 220, currency: "USD" })
    expect(outcome.evidence.netSettlement).toEqual({ minorUnits: 10_780, currency: "USD" })
  })

  it("passes a same-currency movement through with no quote and no gain/loss", () => {
    const outcome = convertWithEvidence(
      input({ presentmentCurrency: "USD", quote: null, providerFeeMinorUnits: null }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.evidence.conversion).toBe("NONE")
    expect(outcome.evidence.settlement.minorUnits).toBe(10_000)
    expect(outcome.evidence.quote).toBeNull()
    expect(outcome.evidence.fxGainLossMinorUnits).toBeNull()
  })
})

describe("gain and loss", () => {
  it("reports a gain when settlement beats recognition", () => {
    const outcome = convertWithEvidence(
      input({
        recognitionQuote: quote({ rate: "1.05", asOf: "2026-07-01T00:00:00.000Z", quoteId: "fxq_0" }),
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.evidence.recognition).toMatchObject({ settlementMinorUnits: 10_500 })
    // $110.00 settled against $105.00 recognised: a $5.00 gain.
    expect(outcome.evidence.fxGainLossMinorUnits).toBe(500)
  })

  it("reports a loss with a negative sign, not a magnitude", () => {
    const outcome = convertWithEvidence(
      input({
        quote: quote({ rate: "1.0" }),
        recognitionQuote: quote({ rate: "1.2", asOf: "2026-07-01T00:00:00.000Z" }),
      }),
    )
    expect(outcome.ok && outcome.evidence.fxGainLossMinorUnits).toBe(-2_000)
  })

  it("says there is no recognition leg rather than reporting a gain of zero", () => {
    const outcome = convertWithEvidence(input({ recognitionQuote: null }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.evidence.recognition).toBeNull()
    expect(outcome.evidence.fxGainLossMinorUnits).toBeNull()
    expect(outcome.evidence.fxGainLossMinorUnits).not.toBe(0)
  })

  it("reports zero when the rate genuinely did not move", () => {
    const outcome = convertWithEvidence(
      input({ recognitionQuote: quote({ asOf: "2026-07-01T00:00:00.000Z" }) }),
    )
    expect(outcome.ok && outcome.evidence.fxGainLossMinorUnits).toBe(0)
  })
})

describe("what it refuses", () => {
  it("refuses a cross-currency conversion with no quote — the platform's state today", () => {
    const outcome = convertWithEvidence(input({ quote: null }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("fx-quote-missing")
    expect(outcome.reason).toContain("wearing the same digits")
  })

  it("refuses a quote for the wrong pair, including the same pair reversed", () => {
    const reversed = convertWithEvidence(input({ quote: quote({ from: "USD", to: "EUR" }) }))
    expect(!reversed.ok && reversed.code).toBe("fx-quote-pair-mismatch")
    const unrelated = convertWithEvidence(input({ quote: quote({ from: "GBP" }) }))
    expect(!unrelated.ok && unrelated.code).toBe("fx-quote-pair-mismatch")
  })

  it("refuses a stale quote", () => {
    const outcome = convertWithEvidence(
      input({ quote: quote({ asOf: "2026-08-17T10:00:00.000Z" }), maxQuoteAgeSeconds: 3600 }),
    )
    expect(!outcome.ok && outcome.code).toBe("fx-quote-stale")
  })

  it("accepts a quote exactly at the tolerance", () => {
    const outcome = convertWithEvidence(
      input({ quote: quote({ asOf: "2026-08-17T11:00:00.000Z" }), maxQuoteAgeSeconds: 3600 }),
    )
    expect(outcome.ok).toBe(true)
  })

  it("refuses a postdated quote", () => {
    const outcome = convertWithEvidence(
      input({ quote: quote({ asOf: "2026-08-17T12:00:01.000Z" }) }),
    )
    expect(!outcome.ok && outcome.code).toBe("fx-quote-postdated")
  })

  it("refuses a rate that is not a positive decimal string", () => {
    for (const rate of ["1,1", "abc", "0", "-1.1", ""]) {
      const outcome = convertWithEvidence(input({ quote: quote({ rate }) }))
      expect(!outcome.ok && outcome.code).toBe("fx-quote-unreadable")
    }
  })

  it("refuses a rate nobody is recorded as having quoted", () => {
    const outcome = convertWithEvidence(input({ quote: quote({ source: "  " }) }))
    expect(!outcome.ok && outcome.code).toBe("fx-quote-unreadable")
  })

  it("refuses a quote supplied for a movement that converts nothing", () => {
    const outcome = convertWithEvidence(
      input({ presentmentCurrency: "USD", quote: quote({ from: "USD", to: "USD", rate: "1" }) }),
    )
    expect(!outcome.ok && outcome.code).toBe("fx-quote-not-required")
  })

  it("refuses when the provider says a different amount settled", () => {
    const outcome = convertWithEvidence(input({ providerSettledMinorUnits: 10_999 }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("fx-provider-settlement-disagrees")
    expect(outcome.reason).toContain("residual of -1")
    expect(outcome.reason).toContain("Nothing has been adjusted")
  })

  it("accepts a provider figure that agrees to the unit", () => {
    expect(convertWithEvidence(input({ providerSettledMinorUnits: 11_000 })).ok).toBe(true)
  })

  it("refuses a recognition quote for another pair", () => {
    const outcome = convertWithEvidence(
      input({ recognitionQuote: quote({ from: "GBP", asOf: "2026-07-01T00:00:00.000Z" }) }),
    )
    expect(!outcome.ok && outcome.code).toBe("fx-recognition-pair-mismatch")
  })

  it("refuses an unusable amount, fee or instant", () => {
    expect(!convertWithEvidence(input({ presentmentMinorUnits: 1.5 })).ok).toBe(true)
    expect(
      (convertWithEvidence(input({ presentmentMinorUnits: -1 })) as { code: string }).code,
    ).toBe("fx-amount-unusable")
    expect((convertWithEvidence(input({ providerFeeMinorUnits: -5 })) as { code: string }).code).toBe(
      "fx-fee-unusable",
    )
    expect((convertWithEvidence(input({ at: "soon" })) as { code: string }).code).toBe(
      "fx-instant-unreadable",
    )
    expect(
      (convertWithEvidence(input({ settlementCurrency: "US$" })) as { code: string }).code,
    ).toBe("fx-amount-unusable")
  })
})

describe("the flat record an audit row stores", () => {
  it("carries every field a restatement needs", () => {
    const outcome = convertWithEvidence(
      input({
        providerFeeMinorUnits: 220,
        recognitionQuote: quote({ rate: "1.05", asOf: "2026-07-01T00:00:00.000Z", quoteId: "fxq_0" }),
      }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(fxEvidenceRecord(outcome.evidence)).toEqual({
      conversion: "CONVERTED",
      presentmentMinorUnits: 10_000,
      presentmentCurrency: "EUR",
      settlementMinorUnits: 11_000,
      settlementCurrency: "USD",
      settlementMinorDigits: 2,
      netSettlementMinorUnits: 10_780,
      providerFeeMinorUnits: 220,
      rate: "1.1",
      rateSource: "provider:stripe",
      rateQuoteId: "fxq_1",
      rateAsOf: "2026-08-17T11:59:30.000Z",
      recognitionRate: "1.05",
      recognitionAsOf: "2026-07-01T00:00:00.000Z",
      recognitionSettlementMinorUnits: 10_500,
      fxGainLossMinorUnits: 500,
      rounding: "half-even",
      roundingResidualMicroMinorUnits: 0,
      computedAt: AT,
    })
  })
})
