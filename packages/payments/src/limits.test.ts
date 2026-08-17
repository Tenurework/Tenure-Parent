/**
 * PAY-200-004 — the six ceilings, and every way the decision must refuse rather
 * than assume.
 *
 * The cases that matter most here are not the breaches. They are the ones where
 * the engine is handed something it cannot judge: a null history, a reading
 * taken for another recipient, a currency nobody priced, a window the read does
 * not cover. Every one of those must come back `UNVERIFIABLE`, because the
 * alternative — treating an unanswerable question as a pass — is the only
 * failure mode of a limit engine that nobody notices.
 */

import {
  DEFAULT_MOVEMENT_LIMITS,
  LIMIT_NAMES,
  evaluate,
  observationWindows,
  type LimitObservations,
  type LimitedMovement,
  type MovementLimitPolicy,
} from "./limits"

const AT = "2026-08-17T12:00:00.000Z"

function movement(over: Partial<LimitedMovement> = {}): LimitedMovement {
  return {
    institutionId: "inst_1",
    actorPrincipalId: "user_treasurer",
    recipientKey: "user_member",
    accountKey: "line_supplies",
    amountMinorUnits: 5_000,
    currency: "USD",
    at: AT,
    ...over,
  }
}

function observed(over: Partial<LimitObservations> = {}): LimitObservations {
  const windows = observationWindows(DEFAULT_MOVEMENT_LIMITS, AT)
  return {
    observedAt: AT,
    coversSince: windows.earliest,
    actorCommands: 0,
    tenantCommands: 0,
    recipientPriorMinorUnits: 0,
    accountPriorMinorUnits: 0,
    tenantPriorMinorUnits: 0,
    currency: "USD",
    recipientKey: "user_member",
    accountKey: "line_supplies",
    ...over,
  }
}

describe("the windows a caller must read", () => {
  it("derives every span from the policy, so the read and the decision agree", () => {
    const windows = observationWindows(DEFAULT_MOVEMENT_LIMITS, AT)
    expect(windows.rateSince).toBe("2026-08-17T11:59:00.000Z")
    expect(windows.velocitySince).toBe("2026-08-17T11:00:00.000Z")
    expect(windows.aggregateSince).toBe("2026-08-16T12:00:00.000Z")
    // The earliest of the three, which is what a reading has to cover.
    expect(windows.earliest).toBe(windows.aggregateSince)
  })

  it("refuses an unreadable instant instead of returning windows around NaN", () => {
    expect(() => observationWindows(DEFAULT_MOVEMENT_LIMITS, "yesterday")).toThrow(RangeError)
  })
})

describe("a movement inside every ceiling", () => {
  it("passes, and says what reading it was judged against", () => {
    const decision = evaluate(movement(), observed())
    expect(decision.verdict).toBe("WITHIN_LIMITS")
    expect(decision.code).toBe("limits-within")
    expect(decision.breaches).toEqual([])
    expect(decision.reason).toContain(AT)
  })

  it("records the ceilings that did not apply rather than skipping them quietly", () => {
    const decision = evaluate(
      movement({ recipientKey: null, accountKey: null }),
      observed({ recipientKey: null, accountKey: null }),
    )
    expect(decision.verdict).toBe("WITHIN_LIMITS")
    expect(decision.notApplicable).toEqual(["recipient", "account"])
  })
})

describe("each of the six ceilings", () => {
  it("bounds one actor's tempo", () => {
    const decision = evaluate(movement(), observed({ actorCommands: 12 }))
    expect(decision.verdict).toBe("EXCEEDED")
    expect(decision.code).toBe("limits-rate-exceeded")
    expect(decision.breaches[0]).toMatchObject({ limit: "rate", ceiling: 12, observed: 13 })
  })

  it("lets the last command inside the rate ceiling through — the boundary is not off by one", () => {
    expect(evaluate(movement(), observed({ actorCommands: 11 })).verdict).toBe("WITHIN_LIMITS")
  })

  it("bounds the tenant's tempo, which two seats cannot split", () => {
    const decision = evaluate(movement(), observed({ tenantCommands: 240 }))
    expect(decision.verdict).toBe("EXCEEDED")
    expect(decision.breaches.map((b) => b.limit)).toEqual(["velocity"])
  })

  it("caps a single posting absolutely", () => {
    const decision = evaluate(movement({ amountMinorUnits: 2_000_001 }), observed())
    expect(decision.code).toBe("limits-amount-exceeded")
    expect(decision.breaches[0].reason).toContain("no seat raises it")
  })

  it("allows a posting exactly at the single-posting ceiling", () => {
    expect(evaluate(movement({ amountMinorUnits: 2_000_000 }), observed()).verdict).toBe(
      "WITHIN_LIMITS",
    )
  })

  it("sums what has already landed on one recipient — the split-request case", () => {
    // Two claims, each under every single-posting ceiling and each under the
    // approval ladder's $5,000 gate, aimed at the same person on the same day.
    const first = evaluate(
      movement({ amountMinorUnits: 4_900_000 }),
      observed({ recipientPriorMinorUnits: 0 }),
    )
    expect(first.verdict).toBe("EXCEEDED") // the single-posting cap catches this one
    const second = evaluate(
      movement({ amountMinorUnits: 200_000 }),
      observed({ recipientPriorMinorUnits: 4_900_000 }),
    )
    expect(second.verdict).toBe("EXCEEDED")
    expect(second.code).toBe("limits-recipient-exceeded")
    expect(second.breaches[0]).toMatchObject({ limit: "recipient", observed: 5_100_000 })
    expect(second.breaches[0].reason).toContain("Splitting one movement into several")
  })

  it("sums what has landed on one account, which the recipient ceiling cannot see", () => {
    const decision = evaluate(
      movement({ recipientKey: "user_someone_else", amountMinorUnits: 100_001 }),
      observed({ recipientKey: "user_someone_else", accountPriorMinorUnits: 9_900_000 }),
    )
    expect(decision.code).toBe("limits-account-exceeded")
    expect(decision.breaches.map((b) => b.limit)).toEqual(["account"])
  })

  it("backstops with the tenant total", () => {
    const decision = evaluate(
      movement({ recipientKey: null, accountKey: null, amountMinorUnits: 1 }),
      observed({
        recipientKey: null,
        accountKey: null,
        tenantPriorMinorUnits: 50_000_000,
      }),
    )
    expect(decision.code).toBe("limits-tenant-exceeded")
    expect(decision.notApplicable).toEqual(["recipient", "account"])
  })

  it("reports every breach, in one order, when more than one ceiling goes", () => {
    const decision = evaluate(
      movement({ amountMinorUnits: 60_000_000 }),
      observed({ actorCommands: 99, tenantCommands: 9_999 }),
    )
    expect(decision.verdict).toBe("EXCEEDED")
    expect(decision.breaches.map((b) => b.limit)).toEqual([
      "rate",
      "velocity",
      "amount",
      "recipient",
      "account",
      "tenant",
    ])
    // The order is the declared order, not the order the checks happen to run.
    expect(decision.breaches.map((b) => LIMIT_NAMES.indexOf(b.limit))).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe("safe failure — every question this engine cannot answer", () => {
  it("refuses when the history could not be read at all", () => {
    const decision = evaluate(movement(), null)
    expect(decision.verdict).toBe("UNVERIFIABLE")
    expect(decision.code).toBe("limits-unreadable")
    expect(decision.reason).toContain('"We could not look" is not "we looked and found nothing"')
  })

  it("distinguishes an empty history from an unreadable one", () => {
    // Same movement, same ceilings. The only difference is whether the caller
    // could see the history — and the answers must not be the same.
    expect(evaluate(movement(), observed()).verdict).toBe("WITHIN_LIMITS")
    expect(evaluate(movement(), null).verdict).toBe("UNVERIFIABLE")
  })

  it("refuses a movement whose recipient the caller could not name", () => {
    const decision = evaluate(movement({ recipientKey: undefined }), observed())
    expect(decision.code).toBe("limits-subject-unnamed")
  })

  it("refuses a reading counted in another currency", () => {
    const decision = evaluate(movement(), observed({ currency: "EUR" }))
    expect(decision.code).toBe("limits-currency-mismatched")
  })

  it("refuses a reading taken for a different recipient", () => {
    const decision = evaluate(movement(), observed({ recipientKey: "user_somebody_else" }))
    expect(decision.code).toBe("limits-observations-mismatched")
    expect(decision.reason).toContain("failure with no symptom")
  })

  it("refuses a reading taken for a different account", () => {
    expect(evaluate(movement(), observed({ accountKey: "line_other" })).code).toBe(
      "limits-observations-mismatched",
    )
  })

  it("refuses a reading that does not cover the longest window", () => {
    const decision = evaluate(
      movement(),
      observed({ coversSince: "2026-08-17T11:00:00.000Z" }),
    )
    expect(decision.code).toBe("limits-window-not-covered")
  })

  it("refuses a reading taken too long before the decision", () => {
    const decision = evaluate(movement(), observed({ observedAt: "2026-08-17T11:55:00.000Z" }))
    expect(decision.code).toBe("limits-observations-stale")
  })

  it("refuses a reading dated after the decision it is used for", () => {
    expect(evaluate(movement(), observed({ observedAt: "2026-08-17T12:00:30.000Z" })).code).toBe(
      "limits-observations-stale",
    )
  })

  it("refuses a currency no ceiling prices, rather than borrowing another's number", () => {
    const decision = evaluate(
      movement({ currency: "EUR", amountMinorUnits: 1 }),
      observed({ currency: "EUR" }),
    )
    expect(decision.verdict).toBe("UNVERIFIABLE")
    expect(decision.code).toBe("limits-currency-unpriced")
  })

  it("refuses a currency priced for some ceilings and not others", () => {
    const partial: MovementLimitPolicy = {
      ...DEFAULT_MOVEMENT_LIMITS,
      singleAmount: { USD: 2_000_000, JPY: 2_000_000 },
      // perRecipient deliberately has no JPY entry.
    }
    const decision = evaluate(
      movement({ currency: "JPY", amountMinorUnits: 100 }),
      observed({ currency: "JPY" }),
      partial,
    )
    expect(decision.code).toBe("limits-currency-unpriced")
    expect(decision.reason).toContain("recipient ceiling")
  })

  it("refuses an unusable amount", () => {
    expect(evaluate(movement({ amountMinorUnits: 12.5 }), observed()).code).toBe(
      "limits-amount-unusable",
    )
    expect(evaluate(movement({ amountMinorUnits: -1 }), observed()).code).toBe(
      "limits-amount-unusable",
    )
  })

  it("refuses an unusable reading", () => {
    expect(evaluate(movement(), observed({ actorCommands: -3 })).code).toBe(
      "limits-observations-unusable",
    )
    expect(evaluate(movement(), observed({ tenantPriorMinorUnits: 1.5 })).code).toBe(
      "limits-observations-unusable",
    )
  })

  it("refuses an undated reading", () => {
    expect(evaluate(movement(), observed({ coversSince: "whenever" })).code).toBe(
      "limits-observations-undated",
    )
  })

  it("refuses a total that leaves exact integer arithmetic", () => {
    const decision = evaluate(
      movement({ amountMinorUnits: 1_000 }),
      observed({ recipientPriorMinorUnits: Number.MAX_SAFE_INTEGER }),
    )
    expect(decision.code).toBe("limits-total-overflows")
  })

  it("refuses an unreadable decision instant", () => {
    expect(evaluate(movement({ at: "soon" }), observed()).code).toBe("limits-instant-unreadable")
  })
})
