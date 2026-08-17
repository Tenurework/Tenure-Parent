import { ledgerTieOut, toPostedLines, type LedgerLineInput } from "./finance"

/**
 * FIN-010-003 — the adapter half: `LedgerEntry` rows as this database really
 * stores them, tied out.
 *
 * The one thing worth testing here is the sign. `amountCents` is DEBIT-POSITIVE
 * SIGNED (`buildJournal` in `packages/payments/src/posting.ts` writes
 * `side === "debit" ? value : -value`), so a CREDIT row holds a NEGATIVE amount.
 * Handing that straight to a trial balance totals the credit column negative and
 * reports a perfectly balanced ledger as out of balance by twice itself — and
 * the number looks plausible, which is what makes it dangerous.
 */

let n = 0
function row(over: Partial<LedgerLineInput> = {}): LedgerLineInput {
  n += 1
  return {
    id: `e${n}`,
    journalId: "j1",
    account: "6000",
    side: "DEBIT",
    amountCents: 5_000,
    currency: "USD",
    effectiveAt: "2026-03-15T00:00:00.000Z",
    createdAt: "2026-03-15T00:00:00.000Z",
    ...over,
  }
}

/** A club expense as the app actually posts it: expense debit, payable credit. */
function spend(journalId: string, cents: number, effectiveAt = "2026-03-15T00:00:00.000Z") {
  return [
    row({ journalId, id: `${journalId}-dr`, account: "6000", side: "DEBIT", amountCents: cents, effectiveAt, createdAt: effectiveAt }),
    row({ journalId, id: `${journalId}-cr`, account: "2000", side: "CREDIT", amountCents: -cents, effectiveAt, createdAt: effectiveAt }),
  ]
}

describe("toPostedLines", () => {
  it("puts each amount in its declared column as a positive figure", () => {
    const [debit, credit] = toPostedLines(spend("j1", 5_000))
    expect(debit.side).toBe("DEBIT")
    expect(debit.amount.units).toBe(5_000 * 10 ** 6)
    expect(credit.side).toBe("CREDIT")
    // Negated, not abs-ed: the stored figure is -5000.
    expect(credit.amount.units).toBe(5_000 * 10 ** 6)
  })

  it("keeps a contra amount negative instead of moving it to the other column", () => {
    // A reversal is persisted as the flipped side with the negated amount, so a
    // DEBIT row holding a negative figure is a real row.
    const [contra] = toPostedLines([row({ side: "DEBIT", amountCents: -5_000 })])
    expect(contra.amount.units).toBe(-5_000 * 10 ** 6)
  })

  it("carries both dates through, distinctly", () => {
    const [line] = toPostedLines([
      row({ effectiveAt: "2026-03-31T00:00:00.000Z", createdAt: "2026-04-02T09:15:00.000Z" }),
    ])
    expect(line.effectiveAt).toBe("2026-03-31T00:00:00.000Z")
    expect(line.recordedAt).toBe("2026-04-02T09:15:00.000Z")
  })
})

describe("ledgerTieOut", () => {
  it("ties a normal set of journals", () => {
    const tie = ledgerTieOut([...spend("j1", 5_000), ...spend("j2", 12_550)])

    expect(tie.balanced).toBe(true)
    expect(tie.currencies).toHaveLength(1)
    expect(tie.currencies[0].debitCents).toBe(17_550)
    expect(tie.currencies[0].creditCents).toBe(17_550)
    expect(tie.currencies[0].outOfBalanceCents).toBe(0)
    expect(tie.currencies[0].accountCount).toBe(2)
    expect(tie.unbalancedJournalIds).toEqual([])
    expect(tie.postingCount).toBe(4)
    expect(tie.detail).toContain("The ledger ties")
    expect(tie.detail).toContain("$175.50")
  })

  it("reports the difference when a half is missing", () => {
    const tie = ledgerTieOut([...spend("j1", 5_000), row({ journalId: "j3", amountCents: 700 })])

    expect(tie.balanced).toBe(false)
    expect(tie.currencies[0].outOfBalanceCents).toBe(700)
    expect(tie.detail).toContain("$7.00")
    expect(tie.detail).toContain("Shown, not corrected")
  })

  it("says nothing-to-tie-out on an empty ledger", () => {
    const tie = ledgerTieOut([])
    expect(tie.balanced).toBeNull()
    expect(tie.currencies).toEqual([])
    expect(tie.detail).toContain("nothing to tie out")
  })

  it("names journals that cancel each other out", () => {
    const tie = ledgerTieOut([
      row({ journalId: "jA", id: "jA-dr", account: "6000", side: "DEBIT", amountCents: 10_000 }),
      row({ journalId: "jA", id: "jA-cr", account: "2000", side: "CREDIT", amountCents: -9_000 }),
      row({ journalId: "jB", id: "jB-dr", account: "6000", side: "DEBIT", amountCents: 5_000 }),
      row({ journalId: "jB", id: "jB-cr", account: "2000", side: "CREDIT", amountCents: -6_000 }),
    ])

    expect(tie.balanced).toBe(true)
    expect(tie.unbalancedJournalIds).toEqual(["jA", "jB"])
    expect(tie.detail).toContain("do not balance on their own")
  })

  it("keeps two currencies apart", () => {
    const tie = ledgerTieOut([
      ...spend("j1", 5_000),
      row({ journalId: "je", id: "je-dr", account: "6000", side: "DEBIT", amountCents: 3_000, currency: "EUR" }),
      row({ journalId: "je", id: "je-cr", account: "2000", side: "CREDIT", amountCents: -3_000, currency: "EUR" }),
    ])

    expect(tie.currencies.map((c) => c.currency)).toEqual(["EUR", "USD"])
    expect(tie.balanced).toBe(true)
  })

  it("finds a posting written into a later month than it belongs to", () => {
    const tie = ledgerTieOut([
      ...spend("j1", 5_000),
      row({ journalId: "j9", id: "j9-dr", amountCents: 400, effectiveAt: "2026-03-31T00:00:00.000Z", createdAt: "2026-04-02T09:15:00.000Z" }),
      row({ journalId: "j9", id: "j9-cr", account: "2000", side: "CREDIT", amountCents: -400, effectiveAt: "2026-03-31T00:00:00.000Z", createdAt: "2026-04-02T09:15:00.000Z" }),
    ])

    expect(tie.late.map((l) => l.lineId).sort()).toEqual(["j9-cr", "j9-dr"])
    expect(tie.late[0].effectivePeriod).toBe("2026-03")
    expect(tie.late[0].recordedPeriod).toBe("2026-04")
    expect(tie.balanced).toBe(true)
  })
})
