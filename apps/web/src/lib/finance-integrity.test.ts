import { financeIntegrity } from "./finance"

/**
 * PAY-080-007 — the reconciliation the finance page performs.
 *
 * `BudgetLine.actualCents` is documented as the cache of Σ `LedgerEntry.
 * amountCents` and is maintained by a relative `increment`. Nothing in this
 * repository compared the two until `financeIntegrity`, so a cache that drifted
 * stayed drifted and the club's finance page went on rendering it beside a
 * dollar sign.
 *
 * The assertions here are mostly about what it does NOT do: correct the cache,
 * absorb a difference into another line, or call a set balanced because the
 * difference was small.
 */

const line = (id: string, category: string, actualCents: number) => ({ id, category, actualCents })
const posting = (budgetLineId: string, amountCents: number) => ({ budgetLineId, amountCents })

describe("a budget line's actual is checked against the ledger behind it", () => {
  it("reconciles when every line's cache equals its postings", () => {
    const integrity = financeIntegrity(
      [line("l1", "Catering", 12_500), line("l2", "Printing", 4_000)],
      [posting("l1", 10_000), posting("l1", 2_500), posting("l2", 4_000)],
      "USD",
    )
    expect(integrity.reconciles).toBe(true)
    expect(integrity.drifted).toEqual([])
    expect(integrity.rollUpCents).toBe(16_500)
    expect(integrity.journalCents).toBe(16_500)
    expect(integrity.detail).toMatch(/Every line's actual equals/)
  })

  it("names the line whose cache has drifted, and by how much", () => {
    // One cent. The whole point: a relative `increment` that missed one
    // compensating decrement leaves exactly this, and it is invisible without a
    // comparison.
    const integrity = financeIntegrity(
      [line("l1", "Catering", 12_501), line("l2", "Printing", 4_000)],
      [posting("l1", 12_500), posting("l2", 4_000)],
      "USD",
    )
    expect(integrity.reconciles).toBe(false)
    expect(integrity.drifted.map((d) => d.lineId)).toContain("l1")
    expect(integrity.drifted.find((d) => d.lineId === "l1")!.varianceCents).toBe(1)
    expect(integrity.drifted.find((d) => d.lineId === "l1")!.category).toBe("Catering")
    // Untouched. The other line is not adjusted to make the roll-up work.
    expect(integrity.lines.find((l) => l.lineId === "l2")!.varianceCents).toBe(0)
    expect(integrity.detail).toMatch(/Shown, not corrected/)
  })

  it("reports a reimbursement that lowered the ledger and not the cache", () => {
    // REIMBURSEMENT posts a negative amount. A cache that did not follow it down
    // reads as more spend than the club actually incurred, which is the
    // direction that gets a budget refused.
    const integrity = financeIntegrity(
      [line("l1", "Travel", 30_000)],
      [posting("l1", 30_000), posting("l1", -5_000)],
      "USD",
    )
    expect(integrity.reconciles).toBe(false)
    expect(integrity.lines[0].postedCents).toBe(25_000)
    expect(integrity.lines[0].actualCents).toBe(30_000)
    expect(integrity.drifted[0].varianceCents).toBe(5_000)
  })

  it("finds ledger entries against a line the budget does not have", () => {
    // Money the journal holds that the platform does not think it has. A
    // left-join from the budget lines misses this entirely.
    const integrity = financeIntegrity(
      [line("l1", "Catering", 100)],
      [posting("l1", 100), posting("orphan", 4_200)],
      "USD",
    )
    expect(integrity.reconciles).toBe(false)
    expect(integrity.drifted.map((d) => d.lineId)).toContain("orphan")
    expect(integrity.drifted.find((d) => d.lineId === "orphan")!.category).toBe("(no budget line)")
  })

  it("reconciles an empty club rather than refusing it", () => {
    const integrity = financeIntegrity([], [], "USD")
    expect(integrity.reconciles).toBe(true)
    expect(integrity.rollUpCents).toBe(0)
  })

  it("counts in the line's own currency, not in cents-assumed-hundredths", () => {
    // A JPY club's ¥12,000 is 12,000 minor units, and the reconciliation must
    // not silently treat them as a hundredth of anything.
    const integrity = financeIntegrity(
      [line("l1", "会場費", 12_000)],
      [posting("l1", 12_000)],
      "JPY",
    )
    expect(integrity.reconciles).toBe(true)
    expect(integrity.currency).toBe("JPY")
    expect(integrity.detail).toContain("¥12,000")
  })
})
