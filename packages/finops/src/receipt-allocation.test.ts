import { allocateReceipt } from "./allocation"

/**
 * PAY-230-004 — a receipt's slices add back to exactly the receipt.
 *
 * The reason this is a test and not a comment: the obvious implementation
 * rounds each share on its own, and the obvious implementation is wrong by a
 * unit on the very first uneven split. A missing cent from a SPEND is a
 * reporting annoyance; a missing cent from a RECEIPT is money the platform says
 * arrived and then cannot say where it went.
 */

const targets = (...weights: number[]) =>
  weights.map((weight, index) => ({ organizationId: `org_${index}`, weight }))

describe("allocateReceipt", () => {
  it("splits an uneven amount so the parts sum to the whole", () => {
    const slices = allocateReceipt({
      minorUnits: 10_000,
      currency: "USD",
      targets: targets(1, 1, 1),
    })

    expect(slices.map((s) => s.minorUnits)).toEqual([3334, 3333, 3333])
    expect(slices.reduce((total, s) => total + s.minorUnits, 0)).toBe(10_000)
  })

  it("sums to the whole across a range of awkward amounts and weight sets", () => {
    // The property, not one example. Rounding each share independently fails
    // most of these; the largest-remainder method fails none.
    const weightSets = [
      [1, 1, 1],
      [2, 3, 5],
      [7, 11, 13, 17],
      [1, 0, 0, 1],
      [99, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]
    for (const amount of [1, 7, 99, 101, 1234, 99_999, 1_000_003]) {
      for (const weights of weightSets) {
        const slices = allocateReceipt({
          minorUnits: amount,
          currency: "USD",
          targets: targets(...weights),
        })
        expect(slices.reduce((total, s) => total + s.minorUnits, 0)).toBe(amount)
      }
    }
  })

  it("is deterministic — the same input splits the same way every time", () => {
    const once = allocateReceipt({ minorUnits: 100, currency: "USD", targets: targets(1, 1, 1) })
    const twice = allocateReceipt({ minorUnits: 100, currency: "USD", targets: targets(1, 1, 1) })
    expect(once.map((s) => s.minorUnits)).toEqual(twice.map((s) => s.minorUnits))
  })

  it("carries each target's club, fund and event onto its slice", () => {
    const slices = allocateReceipt({
      minorUnits: 900,
      currency: "GBP",
      targets: [
        { organizationId: "org_a", fundCode: "GEN", eventId: "evt_1", weight: 2 },
        { organizationId: "org_b", fundCode: "TRAVEL", eventId: null, weight: 1 },
      ],
    })
    expect(slices[0]).toMatchObject({
      organizationId: "org_a",
      fundCode: "GEN",
      eventId: "evt_1",
      minorUnits: 600,
      currency: "GBP",
    })
    expect(slices[1]).toMatchObject({ organizationId: "org_b", minorUnits: 300 })
  })

  it("refuses a receipt with no targets", () => {
    expect(() => allocateReceipt({ minorUnits: 100, currency: "USD", targets: [] })).toThrow(
      /at least one target/,
    )
  })

  it("refuses a negative receipt — a refund is a reversal, not an allocation", () => {
    expect(() =>
      allocateReceipt({ minorUnits: -100, currency: "USD", targets: targets(1) }),
    ).toThrow(RangeError)
  })

  it("refuses an all-zero weight set rather than handing everything to the first bucket", () => {
    expect(() =>
      allocateReceipt({ minorUnits: 100, currency: "USD", targets: targets(0, 0) }),
    ).toThrow(/no driver decides this split/)
  })

  it("allocates a zero receipt to zero, without refusing it", () => {
    const slices = allocateReceipt({ minorUnits: 0, currency: "USD", targets: targets(1, 2) })
    expect(slices.map((s) => s.minorUnits)).toEqual([0, 0])
  })
})
