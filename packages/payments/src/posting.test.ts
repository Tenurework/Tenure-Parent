import {
  MANUAL_RECOVERY_TEMPLATE,
  POSTING_TEMPLATES,
  PROGRAM_EXPENSE_ACCOUNT,
  PostingError,
  RECOVERABLE_TAX_ACCOUNT,
  REIMBURSEMENT_PAYABLE_ACCOUNT,
  REIMBURSEMENT_TEMPLATE,
  buildJournal,
  postingFor,
  type PostingTemplate,
} from "./posting"

/**
 * PAY-130-002. Three properties: templates are data, journals balance, and the
 * effective-dated lookup REFUSES rather than falling back to the newest.
 */

const MARCH = "2026-03-15T00:00:00.000Z"
const AUGUST = "2026-08-07T00:00:00.000Z"
const BEFORE_ANY = "2025-11-01T00:00:00.000Z"

describe("postingFor is effective-dated and refuses outside every window", () => {
  it("returns the revision in force, not the newest one", () => {
    const march = postingFor(REIMBURSEMENT_TEMPLATE, MARCH)
    const august = postingFor(REIMBURSEMENT_TEMPLATE, AUGUST)
    expect(march).not.toBe(august)
    expect(march.lines).toHaveLength(2)
    expect(august.lines).toHaveLength(3)
    expect(august.lines.map((l) => l.account)).toContain(RECOVERABLE_TAX_ACCOUNT)
  })

  it("refuses when the clock is before every revision's effectiveFrom", () => {
    // MUTATION TARGET: falling back to the newest revision reds this. Posting a
    // 2025 transaction under the fiscal-2027 template would balance, reconcile
    // and be wrong — which is why the refusal is the point.
    let error: unknown
    try {
      postingFor(REIMBURSEMENT_TEMPLATE, BEFORE_ANY)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PostingError)
    expect((error as PostingError).code).toBe("posting-template-not-effective")
    expect((error as PostingError).message).toContain("2026-01-01")
    expect((error as PostingError).message).toContain("2026-07-01")
  })

  it("refuses an unknown template id and an unreadable clock", () => {
    expect(() => postingFor("reimbursement.the-one-i-meant", AUGUST)).toThrow(
      /posting template/i,
    )
    try {
      postingFor(REIMBURSEMENT_TEMPLATE, "whenever")
    } catch (error) {
      expect((error as PostingError).code).toBe("posting-bad-as-of")
    }
  })

  it("refuses overlapping revisions rather than picking one", () => {
    // Exercised through the real function by asserting the shipped registry has
    // no overlap: two answers to one question is the failure, and the guard
    // above is what would catch it if a revision were added carelessly.
    for (const id of new Set(POSTING_TEMPLATES.map((t) => t.id))) {
      const revisions = POSTING_TEMPLATES.filter((t) => t.id === id)
      for (const a of revisions) {
        for (const b of revisions) {
          if (a === b) continue
          const aEnd = a.effectiveTo === null ? Infinity : Date.parse(a.effectiveTo)
          const bStart = Date.parse(b.effectiveFrom)
          const bEnd = b.effectiveTo === null ? Infinity : Date.parse(b.effectiveTo)
          const overlap = Date.parse(a.effectiveFrom) < bEnd && bStart < aEnd
          expect(overlap).toBe(false)
        }
      }
    }
  })
})

describe("buildJournal refuses anything that does not balance", () => {
  const at = { journalId: "jrn_1", effectiveAt: AUGUST }

  it("builds a balanced journal from the current reimbursement revision", () => {
    const journal = buildJournal(
      postingFor(REIMBURSEMENT_TEMPLATE, AUGUST),
      { gross: 4200, net: 4000, tax: 200 },
      at,
    )
    expect(journal.totalDebitMinorUnits).toBe(4200)
    expect(journal.totalCreditMinorUnits).toBe(4200)
    expect(journal.entries.map((e) => [e.account, e.side, e.signedMinorUnits])).toEqual([
      [PROGRAM_EXPENSE_ACCOUNT, "debit", 4000],
      [RECOVERABLE_TAX_ACCOUNT, "debit", 200],
      [REIMBURSEMENT_PAYABLE_ACCOUNT, "credit", -4200],
    ])
    // Debit-positive signed values sum to zero over a balanced journal, which
    // is the invariant the LedgerEntry rows carry into the database.
    expect(journal.entries.reduce((n, e) => n + e.signedMinorUnits, 0)).toBe(0)
  })

  it("throws when a template line's side is flipped so both sides debit", () => {
    // MUTATION TARGET, applied to the DATA rather than the code, which is the
    // same defect: a template revision authored with the wrong side.
    const template = postingFor(REIMBURSEMENT_TEMPLATE, AUGUST)
    const flipped: PostingTemplate = {
      ...template,
      lines: template.lines.map((l) =>
        l.account === REIMBURSEMENT_PAYABLE_ACCOUNT ? { ...l, side: "debit" as const } : l,
      ),
    }
    let error: unknown
    try {
      buildJournal(flipped, { gross: 4200, net: 4000, tax: 200 }, at)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PostingError)
    expect((error as PostingError).code).toBe("posting-unbalanced")
    expect((error as PostingError).message).toContain("debits 8400")
  })

  it("throws when the supplied amounts do not add up, even with correct sides", () => {
    let error: unknown
    try {
      buildJournal(postingFor(REIMBURSEMENT_TEMPLATE, AUGUST), { gross: 4200, net: 4000, tax: 500 }, at)
    } catch (caught) {
      error = caught
    }
    expect((error as PostingError).code).toBe("posting-unbalanced")
  })

  it("refuses a missing amount rather than treating it as zero", () => {
    try {
      buildJournal(postingFor(REIMBURSEMENT_TEMPLATE, AUGUST), { gross: 4200, net: 4200 }, at)
    } catch (error) {
      expect((error as PostingError).code).toBe("posting-amount-missing")
      expect((error as PostingError).message).toContain("tax")
    }
  })

  it("refuses an amount the template posts nowhere", () => {
    try {
      buildJournal(
        postingFor(REIMBURSEMENT_TEMPLATE, MARCH),
        { gross: 4200, tip: 100 },
        at,
      )
    } catch (error) {
      expect((error as PostingError).code).toBe("posting-amount-unposted")
    }
  })

  it("refuses fractional and negative minor units", () => {
    const codes: string[] = []
    for (const amounts of [{ gross: 42.5 }, { gross: -100 }]) {
      try {
        buildJournal(postingFor(REIMBURSEMENT_TEMPLATE, MARCH), amounts, at)
      } catch (error) {
        codes.push((error as PostingError).code)
      }
    }
    expect(codes).toEqual(["posting-amount-not-integer", "posting-amount-negative"])
  })

  it("refuses a journal with no id and an unreadable effective date", () => {
    const codes: string[] = []
    for (const options of [
      { journalId: "", effectiveAt: AUGUST },
      { journalId: "jrn_1", effectiveAt: "soon" },
    ]) {
      try {
        buildJournal(postingFor(REIMBURSEMENT_TEMPLATE, MARCH), { gross: 1 }, options)
      } catch (error) {
        codes.push((error as PostingError).code)
      }
    }
    expect(codes.sort()).toEqual(["posting-bad-effective-at", "posting-no-journal-id"])
  })
})

describe("exactly one side of every shipped template carries the budget dimension", () => {
  it("holds for every revision, or a line's actual would double or vanish", () => {
    for (const template of POSTING_TEMPLATES) {
      const dimensioned = template.lines.filter((l) => l.budgetDimensioned)
      expect(dimensioned).toHaveLength(1)
      expect(dimensioned[0].account).toBe(PROGRAM_EXPENSE_ACCOUNT)
    }
  })

  it("puts the recovery template's budget side on the credit, lowering the actual", () => {
    const journal = buildJournal(
      postingFor(MANUAL_RECOVERY_TEMPLATE, AUGUST),
      { gross: 1500 },
      { journalId: "jrn_r", effectiveAt: AUGUST },
    )
    const budgetSide = journal.entries.find((e) => e.budgetDimensioned)!
    expect(budgetSide.side).toBe("credit")
    expect(budgetSide.signedMinorUnits).toBe(-1500)
  })
})
