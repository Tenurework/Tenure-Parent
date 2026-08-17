import { CurrencyMismatchError, fromMinorUnits, toMinorUnits } from "./money"
import {
  GeneralLedgerInputError,
  accountAnalysis,
  financialStatements,
  flux,
  lateAdjustments,
  reconcileAccountBalance,
  trialBalance,
  type AccountClassification,
  type PostedLine,
} from "./general-ledger"

/**
 * FIN-010-003. What each test is here to catch is stated on it; the ones without
 * a note are the arithmetic itself.
 */

const usd = (cents: number) => fromMinorUnits(cents, "USD")
const cents = (amount: { units: number; currency: string }) => toMinorUnits(amount, "half-even")

let seq = 0
function line(over: Partial<PostedLine> = {}): PostedLine {
  seq += 1
  return {
    journalId: "J1",
    lineId: `L${seq}`,
    account: "1000",
    side: "DEBIT",
    amount: usd(10_000),
    effectiveAt: "2026-03-15",
    recordedAt: "2026-03-15T12:00:00Z",
    ...over,
  }
}

/** A balanced two-line journal: expense debit, payable credit. */
function journal(id: string, amountCents: number, effectiveAt = "2026-03-15"): PostedLine[] {
  return [
    line({
      journalId: id,
      lineId: `${id}-dr`,
      account: "6000",
      side: "DEBIT",
      amount: usd(amountCents),
      effectiveAt,
      recordedAt: `${effectiveAt.slice(0, 10)}T12:00:00Z`,
    }),
    line({
      journalId: id,
      lineId: `${id}-cr`,
      account: "2000",
      side: "CREDIT",
      amount: usd(amountCents),
      effectiveAt,
      recordedAt: `${effectiveAt.slice(0, 10)}T12:00:00Z`,
    }),
  ]
}

describe("trialBalance", () => {
  it("ties a balanced ledger and nets each account", () => {
    const tb = trialBalance([...journal("J1", 50_000), ...journal("J2", 25_000)])

    expect(tb.sections).toHaveLength(1)
    const section = tb.sections[0]
    expect(section.currency).toBe("USD")
    expect(cents(section.debits)).toBe(75_000)
    expect(cents(section.credits)).toBe(75_000)
    expect(cents(section.outOfBalance)).toBe(0)
    expect(section.balanced).toBe(true)
    expect(tb.balanced).toBe(true)
    expect(section.accounts.map((a) => a.account)).toEqual(["2000", "6000"])
    expect(cents(section.accounts[0].net)).toBe(-75_000) // 2000 is a credit balance
    expect(cents(section.accounts[1].net)).toBe(75_000)
    expect(section.accounts[1].lineCount).toBe(2)
    expect(section.unbalancedJournals).toEqual([])
  })

  it("reports the residual when the books do not tie, and plugs nothing", () => {
    const tb = trialBalance([...journal("J1", 50_000), line({ journalId: "J3", account: "6000", amount: usd(700) })])

    expect(tb.balanced).toBe(false)
    expect(cents(tb.sections[0].outOfBalance)).toBe(700)
    expect(tb.sections[0].refusal?.code).toBe("TRIAL_BALANCE_DOES_NOT_TIE")
    // The residual survives into the sentence, so a reader sees the amount and
    // not just "out of balance".
    expect(tb.detail).toContain("7000000")
    expect(cents(tb.sections[0].debits)).toBe(50_700)
  })

  it("says nothing-to-report rather than balanced when no line falls in the window", () => {
    // The reassuring wrong answer this exists to prevent: an empty period
    // reported as a clean one.
    const tb = trialBalance(journal("J1", 50_000), { from: "2026-04-01", through: "2026-04-30" })

    expect(tb.balanced).toBeNull()
    expect(tb.sections).toEqual([])
    expect(tb.excluded.beforeWindow).toBe(2)
    expect(tb.detail).toContain("not \"the books tie\"")
  })

  it("refuses a duplicated line rather than doubling a balance", () => {
    const [dr, cr] = journal("J1", 50_000)
    expect(() => trialBalance([dr, cr, dr])).toThrow(GeneralLedgerInputError)
    expect(() => trialBalance([dr, cr, dr])).toThrow(/appears? more than once/)
  })

  it("refuses a date carrying a numeric offset", () => {
    // It sorts as text into the wrong period and nothing downstream can tell.
    expect(() => trialBalance([line({ effectiveAt: "2026-03-31T23:00:00+05:30" })])).toThrow(
      /must be `YYYY-MM-DD` or a UTC instant/,
    )
    expect(() => trialBalance([line()], { through: "31/03/2026" })).toThrow(GeneralLedgerInputError)
  })

  it("treats a date-only upper bound as the whole of that day", () => {
    // `through: "2026-03-31"` must not mean "as at the first instant of 31 March".
    const late = journal("J1", 40_000, "2026-03-31")
    const tb = trialBalance(
      [
        late[0],
        late[1],
        line({ journalId: "J9", lineId: "J9-dr", effectiveAt: "2026-03-31T14:00:00Z", recordedAt: "2026-03-31T14:00:00Z", account: "6000", amount: usd(1_000) }),
        line({ journalId: "J9", lineId: "J9-cr", effectiveAt: "2026-03-31T14:00:00Z", recordedAt: "2026-03-31T14:00:00Z", account: "2000", side: "CREDIT", amount: usd(1_000) }),
      ],
      { through: "2026-03-31" },
    )

    expect(tb.included).toBe(4)
    expect(cents(tb.sections[0].debits)).toBe(41_000)
    expect(tb.excluded.afterWindow).toBe(0)
  })

  it("answers as-of: what was known then, not what is known now", () => {
    const original = journal("J1", 50_000, "2026-03-20")
    const correction = journal("J2", 5_000, "2026-03-25").map((l) => ({
      ...l,
      recordedAt: "2026-04-10T09:00:00Z",
    }))

    const asKnownAtMonthEnd = trialBalance([...original, ...correction], {
      through: "2026-03-31",
      knownAt: "2026-03-31T23:59:59Z",
    })
    const asKnownNow = trialBalance([...original, ...correction], { through: "2026-03-31" })

    expect(cents(asKnownAtMonthEnd.sections[0].debits)).toBe(50_000)
    expect(asKnownAtMonthEnd.excluded.notYetRecorded).toBe(2)
    expect(cents(asKnownNow.sections[0].debits)).toBe(55_000)
  })

  it("keeps currencies in separate sections", () => {
    const eur = [
      line({ journalId: "JE", lineId: "JE-dr", account: "6000", amount: fromMinorUnits(3_000, "EUR") }),
      line({ journalId: "JE", lineId: "JE-cr", account: "2000", side: "CREDIT", amount: fromMinorUnits(3_000, "EUR") }),
    ]
    const tb = trialBalance([...journal("J1", 50_000), ...eur])

    expect(tb.sections.map((s) => s.currency)).toEqual(["EUR", "USD"])
    expect(cents(tb.sections[0].debits)).toBe(3_000)
    expect(cents(tb.sections[1].debits)).toBe(50_000)
    expect(tb.balanced).toBe(true)
  })

  it("finds two journals out by equal and opposite amounts while the total ties", () => {
    // The failure no total will ever show: two mis-coded postings that cancel.
    const lines = [
      line({ journalId: "JA", lineId: "JA-dr", account: "6000", amount: usd(10_000) }),
      line({ journalId: "JA", lineId: "JA-cr", account: "2000", side: "CREDIT", amount: usd(9_000) }),
      line({ journalId: "JB", lineId: "JB-dr", account: "6000", amount: usd(5_000) }),
      line({ journalId: "JB", lineId: "JB-cr", account: "2000", side: "CREDIT", amount: usd(6_000) }),
    ]
    const tb = trialBalance(lines)

    expect(tb.balanced).toBe(true)
    expect(tb.sections[0].unbalancedJournals.map((j) => j.journalId)).toEqual(["JA", "JB"])
    expect(cents(tb.sections[0].unbalancedJournals[0].outOfBalance)).toBe(1_000)
    expect(cents(tb.sections[0].unbalancedJournals[1].outOfBalance)).toBe(-1_000)
  })

  it("keeps the sign of a contra amount instead of moving it to the other column", () => {
    // A negative debit reduces the debit column. Taking its magnitude would tie
    // the trial balance while the books were wrong by twice the amount.
    const tb = trialBalance([
      line({ journalId: "JC", lineId: "JC-dr", account: "6000", amount: usd(-2_000) }),
      line({ journalId: "JC", lineId: "JC-cr", account: "2000", side: "CREDIT", amount: usd(-2_000) }),
    ])

    expect(cents(tb.sections[0].debits)).toBe(-2_000)
    expect(cents(tb.sections[0].credits)).toBe(-2_000)
    expect(tb.balanced).toBe(true)
    expect(cents(tb.sections[0].accounts.find((a) => a.account === "6000")!.net)).toBe(-2_000)
  })

  it("refuses a line whose column is neither DEBIT nor CREDIT", () => {
    expect(() => trialBalance([line({ side: "MIDDLE" as never })])).toThrow(/column is unknown/)
  })
})

describe("accountAnalysis", () => {
  it("runs the balance in a deterministic order and carries the drill-through ids", () => {
    const lines = [
      line({ journalId: "J2", lineId: "b", account: "1000", amount: usd(2_000), effectiveAt: "2026-03-02", recordedAt: "2026-03-02T00:00:00Z" }),
      line({ journalId: "J1", lineId: "a", account: "1000", amount: usd(5_000), effectiveAt: "2026-03-01", recordedAt: "2026-03-01T00:00:00Z" }),
      line({ journalId: "J3", lineId: "c", account: "1000", side: "CREDIT", amount: usd(1_000), effectiveAt: "2026-03-02", recordedAt: "2026-03-03T00:00:00Z" }),
      line({ account: "9999" }),
    ]
    const analysis = accountAnalysis(lines, "1000")

    expect(analysis.sections[0].entries.map((e) => e.lineId)).toEqual(["a", "b", "c"])
    expect(analysis.sections[0].entries.map((e) => cents(e.runningNet))).toEqual([5_000, 7_000, 6_000])
    expect(analysis.sections[0].entries[2].journalId).toBe("J3")
    expect(cents(analysis.sections[0].closingNet)).toBe(6_000)
    expect(analysis.empty).toBe(false)
  })

  it("reports an account with no movement as empty rather than as zero", () => {
    const analysis = accountAnalysis(journal("J1", 50_000), "7777")
    expect(analysis.empty).toBe(true)
    expect(analysis.sections).toEqual([])
  })
})

describe("flux", () => {
  const section = (accounts: readonly { account: string; net: number }[]) =>
    trialBalance(
      accounts.flatMap(({ account, net }, i) => [
        line({ journalId: `F${i}`, lineId: `F${i}-dr`, account, amount: usd(net) }),
        line({ journalId: `F${i}`, lineId: `F${i}-cr`, account: "2000", side: "CREDIT", amount: usd(net) }),
      ]),
    ).sections[0]

  it("computes an exact signed percentage", () => {
    const now = section([{ account: "6000", net: 12_000 }])
    const before = section([{ account: "6000", net: 10_000 }])
    const report = flux(now, before)
    const row = report.rows.find((r) => r.account === "6000")!

    expect(row.basis).toBe("MEASURED")
    expect(row.changePercent).toBe("20.00")
    expect(cents(row.change)).toBe(2_000)
  })

  it("will not report a movement from zero as a percentage", () => {
    // "We looked and found nothing" is not "we could not look": 0 → 40,000 is
    // not a 0% change, and reporting one is the lie this distinguishes.
    const now = section([{ account: "6000", net: 40_000 }])
    const before = trialBalance([
      line({ journalId: "FZ", lineId: "FZ-dr", account: "6000", amount: usd(1_000) }),
      line({ journalId: "FZ", lineId: "FZ-cr", account: "6000", side: "CREDIT", amount: usd(1_000) }),
    ]).sections[0]

    const row = flux(now, before).rows.find((r) => r.account === "6000")!
    expect(row.basis).toBe("PRIOR_IS_ZERO")
    expect(row.changePercent).toBeNull()
    expect(cents(row.change)).toBe(40_000)
  })

  it("names a new account, a closed account and a missing prior period", () => {
    const now = section([{ account: "6000", net: 10_000 }])
    const before = section([{ account: "6100", net: 8_000 }])
    const report = flux(now, before)

    expect(report.rows.find((r) => r.account === "6000")!.basis).toBe("NEW_ACCOUNT")
    expect(report.rows.find((r) => r.account === "6100")!.basis).toBe("CLOSED_ACCOUNT")
    expect(flux(now, null).rows.every((r) => r.basis === "NO_PRIOR_PERIOD")).toBe(true)
    // 2000 is on both sides (it is the credit half of every journal here), so it
    // IS measurable — −8,000 to −10,000 is a 25% growth in a credit balance, and
    // the signed division reads it as a rise rather than a fall.
    expect(report.rows.find((r) => r.account === "2000")!.changePercent).toBe("25.00")
    expect(report.unexplainable.map((u) => u.account).sort()).toEqual(["6000", "6100"])
  })

  it("flags materiality at the stated boundary, by amount, and for rows with no percentage", () => {
    const now = section([{ account: "6000", net: 11_000 }])
    const before = section([{ account: "6000", net: 10_000 }])

    // Exactly 10% must cross a 10% threshold — the off-by-one a float
    // comparison eventually gets wrong.
    expect(flux(now, before, { percent: "10" }).rows.find((r) => r.account === "6000")!.material).toBe(true)
    expect(flux(now, before, { percent: "10.01" }).rows.find((r) => r.account === "6000")!.material).toBe(false)
    expect(flux(now, before, { amount: usd(1_000) }).rows.find((r) => r.account === "6000")!.material).toBe(true)
    expect(flux(now, before, { amount: usd(1_001) }).rows.find((r) => r.account === "6000")!.material).toBe(false)

    // A new account with a balance has no percentage to exceed and is exactly
    // what a flux review is looking for.
    const fresh = flux(section([{ account: "6200", net: 90_000 }]), before, { percent: "10" })
    expect(fresh.rows.find((r) => r.account === "6200")!.material).toBe(true)
  })

  it("refuses to compare two currencies", () => {
    const now = section([{ account: "6000", net: 10_000 }])
    const eur = trialBalance([
      line({ journalId: "FE", lineId: "FE-dr", account: "6000", amount: fromMinorUnits(9_000, "EUR") }),
      line({ journalId: "FE", lineId: "FE-cr", account: "2000", side: "CREDIT", amount: fromMinorUnits(9_000, "EUR") }),
    ]).sections[0]

    expect(() => flux(now, eur)).toThrow(CurrencyMismatchError)
  })

  it("refuses a threshold nobody can parse", () => {
    const now = section([{ account: "6000", net: 12_000 }])
    const before = section([{ account: "6000", net: 10_000 }])
    expect(() => flux(now, before, { percent: "ten percent" })).toThrow(GeneralLedgerInputError)
  })
})

describe("financialStatements", () => {
  // Cash 30,000 Dr; expense 20,000 Dr; payable 10,000 Cr; revenue 40,000 Cr.
  const books: PostedLine[] = [
    line({ journalId: "S1", lineId: "S1-dr", account: "1000", amount: usd(40_000) }),
    line({ journalId: "S1", lineId: "S1-cr", account: "4000", side: "CREDIT", amount: usd(40_000) }),
    line({ journalId: "S2", lineId: "S2-dr", account: "6000", amount: usd(20_000) }),
    line({ journalId: "S2", lineId: "S2-cr", account: "1000", side: "CREDIT", amount: usd(10_000) }),
    line({ journalId: "S2", lineId: "S2-cr2", account: "2000", side: "CREDIT", amount: usd(10_000) }),
  ]

  const chart: AccountClassification[] = [
    { account: "1000", group: "ASSET", normalBalance: "DEBIT", line: "Cash and equivalents" },
    { account: "2000", group: "LIABILITY", normalBalance: "CREDIT", line: "Trade payables" },
    { account: "4000", group: "REVENUE", normalBalance: "CREDIT", line: "Programme revenue" },
    { account: "6000", group: "EXPENSE", normalBalance: "DEBIT", line: "Programme costs" },
  ]

  it("ties the balance sheet to the income statement", () => {
    const section = trialBalance(books).sections[0]
    const statements = financialStatements(section, chart)

    expect(cents(statements.balanceSheet.assets)).toBe(30_000)
    expect(cents(statements.balanceSheet.liabilities)).toBe(10_000)
    expect(cents(statements.balanceSheet.equity)).toBe(0)
    expect(cents(statements.incomeStatement.revenue)).toBe(40_000)
    expect(cents(statements.incomeStatement.expenses)).toBe(20_000)
    expect(cents(statements.incomeStatement.netIncome)).toBe(20_000)
    expect(cents(statements.residual)).toBe(0)
    expect(statements.ties).toBe(true)
    expect(statements.refusal).toBeNull()
  })

  it("keeps a statement line's whole name", () => {
    // A composite key split apart again returns "Cash" for "Cash and
    // equivalents" — a line silently renamed by its own first word.
    const statements = financialStatements(trialBalance(books).sections[0], chart)
    expect(statements.balanceSheet.lines.map((l) => l.line).sort()).toEqual([
      "Cash and equivalents",
      "Trade payables",
    ])
    expect(statements.incomeStatement.lines.map((l) => l.line).sort()).toEqual([
      "Programme costs",
      "Programme revenue",
    ])
  })

  it("refuses rather than dropping an account it cannot classify", () => {
    const statements = financialStatements(
      trialBalance(books).sections[0],
      chart.filter((c) => c.account !== "2000"),
    )

    expect(statements.refusal?.code).toBe("ACCOUNTS_NOT_CLASSIFIED")
    expect(statements.unclassified).toEqual(["2000"])
    expect(statements.ties).toBe(false)
    // Dropping it would have produced a balance sheet that balanced and was
    // wrong; the liability really is missing from the totals, and the refusal is
    // what says so.
    expect(cents(statements.balanceSheet.liabilities)).toBe(0)
  })

  it("rolls several accounts into one line and reports an untied residual", () => {
    const withSecondCash = [
      ...books,
      line({ journalId: "S3", lineId: "S3-dr", account: "1010", amount: usd(500) }),
    ]
    const statements = financialStatements(trialBalance(withSecondCash).sections[0], [
      ...chart,
      { account: "1010", group: "ASSET", normalBalance: "DEBIT", line: "Cash and equivalents" },
    ])

    expect(statements.balanceSheet.lines.find((l) => l.line === "Cash and equivalents")!.accounts).toEqual([
      "1000",
      "1010",
    ])
    expect(cents(statements.residual)).toBe(500)
    expect(statements.refusal?.code).toBe("STATEMENTS_DO_NOT_TIE")
  })
})

describe("reconcileAccountBalance", () => {
  const bank: PostedLine[] = [
    line({ journalId: "B1", lineId: "B1", account: "1000", amount: usd(5_000), reference: "DEP-1" }),
    line({ journalId: "B2", lineId: "B2", account: "1000", side: "CREDIT", amount: usd(2_000), reference: "CHQ-9" }),
    line({ journalId: "B3", lineId: "B3", account: "1000", amount: usd(750), reference: "DEP-2" }),
    line({ journalId: "B4", lineId: "B4", account: "1000", amount: usd(100) }),
  ]

  it("names the item, not just the variance", () => {
    const result = reconcileAccountBalance({
      account: "1000",
      lines: bank,
      supporting: [
        { reference: "DEP-1", amount: usd(5_000) },
        { reference: "CHQ-9", amount: usd(-2_500) },
        { reference: "DEP-3", amount: usd(400) },
      ],
    })

    expect(result.matched.map((m) => m.reference)).toEqual(["DEP-1"])
    expect(result.amountMismatches.map((m) => m.reference)).toEqual(["CHQ-9"])
    expect(cents(result.amountMismatches[0].difference)).toBe(500)
    expect(result.unmatchedInLedger.map((u) => u.reference)).toEqual(["DEP-2"])
    expect(result.unmatchedInSupporting.map((u) => u.reference)).toEqual(["DEP-3"])
    // The unreferenced row could not be matched at all, which is not the same
    // as having matched nothing.
    expect(result.unreferenced.map((u) => u.lineId)).toEqual(["B4"])
    expect(result.reconciles).toBe(false)
    expect(result.refusal?.code).toBe("ACCOUNT_DOES_NOT_RECONCILE")
    expect(cents(result.ledgerBalance)).toBe(3_850)
    expect(cents(result.supportingBalance)).toBe(2_900)
    expect(cents(result.variance)).toBe(950)
  })

  it("reconciles when every item matches, and still reports the unreferenced", () => {
    const result = reconcileAccountBalance({
      account: "1000",
      lines: bank.filter((l) => l.lineId !== "B4"),
      supporting: [
        { reference: "DEP-1", amount: usd(5_000) },
        { reference: "CHQ-9", amount: usd(-2_000) },
        { reference: "DEP-2", amount: usd(750) },
      ],
    })

    expect(result.reconciles).toBe(true)
    expect(result.refusal).toBeNull()
    expect(cents(result.variance)).toBe(0)
    expect(result.unreferenced).toEqual([])
  })

  it("signs a credit the way the running balance does", () => {
    // A credit stated as a positive number in a difference column is the
    // reconciliation that reconciles in the wrong direction.
    const result = reconcileAccountBalance({
      account: "1000",
      lines: [bank[1]],
      supporting: [{ reference: "CHQ-9", amount: usd(-2_000) }],
    })
    expect(cents(result.ledgerBalance)).toBe(-2_000)
    expect(result.reconciles).toBe(true)
  })

  it("refuses an empty reconciliation instead of calling it clean", () => {
    expect(() => reconcileAccountBalance({ account: "1000", lines: [], supporting: [] })).toThrow(
      /Nothing to reconcile/,
    )
  })

  it("refuses supporting detail in another currency", () => {
    expect(() =>
      reconcileAccountBalance({
        account: "1000",
        lines: bank,
        supporting: [{ reference: "DEP-1", amount: fromMinorUnits(5_000, "EUR") }],
      }),
    ).toThrow(CurrencyMismatchError)
  })
})

describe("lateAdjustments", () => {
  it("counts periods, not days", () => {
    const lines = [
      // 29 days apart, same period: not late.
      line({ lineId: "same-period", effectiveAt: "2026-03-01", recordedAt: "2026-03-30T00:00:00Z" }),
      // One day apart, one period late.
      line({ lineId: "one-day-late", effectiveAt: "2026-03-31", recordedAt: "2026-04-01T00:00:00Z" }),
      line({ lineId: "very-late", effectiveAt: "2026-01-15", recordedAt: "2026-06-02T00:00:00Z" }),
    ]
    const late = lateAdjustments(lines)

    expect(late.map((l) => l.lineId)).toEqual(["one-day-late", "very-late"])
    expect(late[0].effectivePeriod).toBe("2026-03")
    expect(late[0].recordedPeriod).toBe("2026-04")
    expect(late[1].recordedPeriod).toBe("2026-06")
  })
})
