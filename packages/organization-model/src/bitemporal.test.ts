import {
  correct,
  decisionDrifted,
  factHistory,
  resolveAsOf,
  type BitemporalVersion,
  type CorrectionRefusal,
} from "./bitemporal"

/**
 * GE-050-005 — the question one clock cannot answer.
 *
 * "Who held the seat in March?" needs effective dating. "When the approval was
 * granted in March, who did we believe held the seat?" needs a second clock,
 * and it is the question an audit actually asks.
 */

const MARCH = new Date("2026-03-15T12:00:00Z")
const JULY = new Date("2026-07-15T12:00:00Z")
const NOW = new Date("2026-08-03T12:00:00Z")

/** Believed since January: Dana holds the president's seat, open-ended. */
const original: BitemporalVersion<string> = {
  factId: "seat-president:holder",
  value: "dana",
  validFrom: "2026-01-01T00:00:00Z",
  validTo: null,
  recordedAt: "2026-01-01T00:00:00Z",
  supersededAt: null,
  reason: "Elected at the January meeting.",
}

/**
 * Discovered in July: Dana's term actually ended in February.
 *
 * The correction every part of this file exists for. With one clock it silently
 * rewrites March.
 */
const corrected = correct([original], {
  factId: "seat-president:holder",
  value: "dana",
  validFrom: "2026-01-01T00:00:00Z",
  validTo: "2026-02-01T00:00:00Z",
  recordedAt: JULY.toISOString(),
  reason: "Registrar confirmed the term ended in February; the January record was wrong.",
})
if (!corrected.ok) throw new Error(corrected.detail)
const VERSIONS = corrected.versions

describe("a correction does not rewrite what we used to believe", () => {
  it("still reports Dana in March, as of March", () => {
    // The whole point. An approval granted in March was granted on this belief,
    // and an audit that judged it against July's knowledge would find an
    // approver with no authority and blame somebody for a fact that did not
    // exist yet.
    const asOfMarch = resolveAsOf(VERSIONS, { validAt: MARCH, knownAt: MARCH })
    expect(asOfMarch.known).toBe(true)
    if (!asOfMarch.known) throw new Error("unreachable")
    expect(asOfMarch.value).toBe("dana")
  })

  it("reports nobody in March, as of now", () => {
    // Present knowledge, which is what an operational view should show.
    const asOfNow = resolveAsOf(VERSIONS, { validAt: MARCH, knownAt: NOW })
    expect(asOfNow.known).toBe(false)
    if (asOfNow.known) throw new Error("unreachable")
    expect(asOfNow.reason).toBe("NOTHING_KNOWN")
  })

  it("keeps the superseded version readable, value and all", () => {
    // A corrected-in-place row destroys the only evidence of what was believed,
    // which makes the March-as-of-March query impossible rather than wrong.
    //
    // The value is asserted explicitly: a mutation that overwrote it while
    // leaving the timestamps alone survived every other test here, and it is
    // the one field the whole module exists to preserve.
    const old = VERSIONS.find((v) => v.validTo === null)
    expect(old).toBeDefined()
    expect(old!.recordedAt).toBe(original.recordedAt)
    expect(old!.supersededAt).toBe(JULY.toISOString())
    expect(old!.value).toBe(original.value)
    expect(old!.validFrom).toBe(original.validFrom)
    expect(old!.reason).toBe(original.reason)
  })

  it("keeps the old VALUE when a correction changes who it names", () => {
    // The fixture above corrects a date and keeps the holder, so overwriting
    // the superseded value was invisible to every assertion here — a mutation
    // doing exactly that survived. This corrects the holder itself, which is
    // the case the module is for: what we used to believe has to remain
    // readable after we stop believing it.
    const replaced = correct([original], {
      factId: "seat-president:holder",
      value: "sam",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      recordedAt: JULY.toISOString(),
      reason: "The January minutes named Sam; Dana was recorded in error.",
    })
    if (!replaced.ok) throw new Error(replaced.detail)

    const old = replaced.versions.find((v) => v.recordedAt === original.recordedAt)!
    expect(old.value).toBe("dana")
    expect(old.supersededAt).toBe(JULY.toISOString())

    // And the two clocks still disagree, which is the point of keeping it.
    const asOfMarch = resolveAsOf(replaced.versions, { validAt: MARCH, knownAt: MARCH })
    const asOfNow = resolveAsOf(replaced.versions, { validAt: MARCH, knownAt: NOW })
    if (!asOfMarch.known || !asOfNow.known) throw new Error("unreachable")
    expect(asOfMarch.value).toBe("dana")
    expect(asOfNow.value).toBe("sam")
  })

  it("stops believing the old version at the exact instant of the correction", () => {
    // The boundary. At the correction's own instant we already believe the new
    // version — asking a moment before and a moment after must differ, and
    // asking exactly at it must give the new one.
    const atCorrection = resolveAsOf(VERSIONS, {
      validAt: new Date("2026-01-15T00:00:00Z"),
      knownAt: JULY,
    })
    if (!atCorrection.known) throw new Error("unreachable")
    expect(atCorrection.version.recordedAt).toBe(JULY.toISOString())

    const justBefore = resolveAsOf(VERSIONS, {
      validAt: new Date("2026-01-15T00:00:00Z"),
      knownAt: new Date(JULY.getTime() - 1),
    })
    if (!justBefore.known) throw new Error("unreachable")
    expect(justBefore.version.recordedAt).toBe(original.recordedAt)
  })

  it("defaults knownAt to now, which is the ordinary case", () => {
    const implicit = resolveAsOf(VERSIONS, { validAt: MARCH })
    expect(implicit.known).toBe(false)
  })
})

describe("a version recorded later is invisible to an earlier question", () => {
  it("does not leak a July correction into a March reconstruction", () => {
    // The entire mechanism, stated on its own.
    const believedInMarch = resolveAsOf(VERSIONS, {
      validAt: new Date("2026-01-15T00:00:00Z"),
      knownAt: MARCH,
    })
    if (!believedInMarch.known) throw new Error("unreachable")
    expect(believedInMarch.version.recordedAt).toBe(original.recordedAt)
  })

  it("sees the correction once the asking instant passes it", () => {
    const after = resolveAsOf(VERSIONS, {
      validAt: new Date("2026-01-15T00:00:00Z"),
      knownAt: new Date("2026-07-16T00:00:00Z"),
    })
    if (!after.known) throw new Error("unreachable")
    expect(after.version.recordedAt).toBe(JULY.toISOString())
  })

  it("knows nothing before the fact was first recorded", () => {
    const before = resolveAsOf(VERSIONS, {
      validAt: new Date("2026-01-15T00:00:00Z"),
      knownAt: new Date("2025-12-01T00:00:00Z"),
    })
    expect(before.known).toBe(false)
  })
})

describe("validity is half-open, like every other interval here", () => {
  it("covers the start instant", () => {
    expect(resolveAsOf(VERSIONS, { validAt: new Date("2026-01-01T00:00:00Z"), knownAt: NOW }).known).toBe(true)
  })

  it("does not cover the end instant", () => {
    // One period ending exactly where the next begins leaves no gap and no
    // overlap.
    expect(resolveAsOf(VERSIONS, { validAt: new Date("2026-02-01T00:00:00Z"), knownAt: NOW }).known).toBe(false)
  })

  it("does not cover an instant before the period begins", () => {
    // Removing the start check left every version covering all of history, and
    // nothing else here noticed.
    expect(
      resolveAsOf(VERSIONS, { validAt: new Date("2025-06-01T00:00:00Z"), knownAt: NOW }).known,
    ).toBe(false)
    expect(
      resolveAsOf([original], { validAt: new Date("2025-06-01T00:00:00Z"), knownAt: NOW }).known,
    ).toBe(false)
  })

  it("treats an unparseable period as covering nothing", () => {
    const broken: BitemporalVersion<string> = { ...original, validFrom: "not-a-date" }
    expect(resolveAsOf([broken], { validAt: MARCH, knownAt: NOW }).known).toBe(false)
  })
})

describe("two simultaneous beliefs are refused, not resolved by order", () => {
  it("refuses when both cover the instant and neither is superseded", () => {
    // A real state: two corrections recorded without either superseding the
    // other. Picking one by array order is a decision nobody made, in the one
    // place where the answer is later used to judge somebody.
    const rival: BitemporalVersion<string> = { ...original, value: "sam", recordedAt: "2026-01-02T00:00:00Z" }
    const outcome = resolveAsOf([original, rival], { validAt: MARCH, knownAt: NOW })

    expect(outcome.known).toBe(false)
    if (outcome.known) throw new Error("unreachable")
    expect(outcome.reason).toBe("AMBIGUOUS")
    expect(outcome.detail).toMatch(/nobody chose/)
  })

  it("does not refuse when one of them is superseded", () => {
    const outcome = resolveAsOf(VERSIONS, { validAt: new Date("2026-01-15T00:00:00Z"), knownAt: NOW })
    expect(outcome.known).toBe(true)
  })
})

describe("corrections append and are explained", () => {
  const refused = (
    over: Partial<Parameters<typeof correct<string>>[1]>,
    reason: CorrectionRefusal,
    versions: readonly BitemporalVersion<string>[] = [original],
  ) => {
    const outcome = correct(versions, {
      factId: "seat-president:holder",
      value: "sam",
      validFrom: "2026-02-01T00:00:00Z",
      validTo: null,
      recordedAt: JULY.toISOString(),
      reason: "Sam took over in February.",
      ...over,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe(reason)
    expect(outcome.detail.length).toBeGreaterThan(20)
  }

  it("adds a version rather than editing one", () => {
    expect(VERSIONS).toHaveLength(2)
    expect(VERSIONS.filter((v) => v.supersededAt === null)).toHaveLength(1)
  })

  it("refuses a correction with no reason", () => {
    // A history of unexplained changes is not a history.
    refused({ reason: "   " }, "NO_REASON")
  })

  it("refuses to correct a fact nobody has recorded", () => {
    refused({ factId: "seat-treasurer:holder" }, "UNKNOWN_FACT")
  })

  it("refuses a correction recorded before what it corrects", () => {
    // Transaction time is the one axis that is genuinely monotonic — we cannot
    // un-learn something — and letting it go backwards makes "as of then"
    // unanswerable.
    refused({ recordedAt: "2025-06-01T00:00:00Z" }, "BACKDATED_RECORD")
  })

  it("refuses an unparseable recordedAt", () => {
    refused({ recordedAt: "soon" }, "BACKDATED_RECORD")
  })

  it("refuses when every version is already superseded", () => {
    const allSuperseded: BitemporalVersion<string>[] = [
      { ...original, supersededAt: "2026-06-01T00:00:00Z" },
    ]
    refused({}, "ALREADY_SUPERSEDED", allSuperseded)
  })

  it("supersedes at the correction's own instant, not at now", () => {
    // A caller replaying an import needs the times the facts were actually
    // learned; stamping `now` would record the migration instead of the history.
    const old = VERSIONS.find((v) => v.recordedAt === original.recordedAt)!
    expect(old.supersededAt).toBe(JULY.toISOString())
  })

  it("allows a second correction on top of the first", () => {
    const again = correct(VERSIONS, {
      factId: "seat-president:holder",
      value: "sam",
      validFrom: "2026-02-01T00:00:00Z",
      validTo: null,
      recordedAt: "2026-07-20T00:00:00Z",
      reason: "Sam's appointment confirmed by the board minutes.",
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error("unreachable")
    expect(again.versions.filter((v) => v.supersededAt === null)).toHaveLength(1)
  })
})

describe("the history says when we learned each thing", () => {
  it("lists versions oldest first by transaction time", () => {
    // One of §8.2's six required answers: when did the platform learn or
    // correct a fact.
    const history = factHistory(VERSIONS, "seat-president:holder")

    expect(history).toHaveLength(2)
    expect(history[0].recordedAt).toBe(original.recordedAt)
    expect(history[1].recordedAt).toBe(JULY.toISOString())
    expect(history[0].supersededAt).toBe(JULY.toISOString())
    expect(history[1].supersededAt).toBeNull()
  })

  it("orders by transaction time, not by validity or array order", () => {
    // A fixture where the three orders genuinely differ: the version learned
    // LAST describes the EARLIEST validity, and it is placed first in the
    // array. Ordering by anything other than recordedAt reads differently.
    const late: BitemporalVersion<string> = {
      factId: "f",
      value: "learned-last",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: "2026-02-01T00:00:00Z",
      recordedAt: "2026-09-01T00:00:00Z",
      supersededAt: null,
      reason: "Found in the archive.",
    }
    const early: BitemporalVersion<string> = {
      factId: "f",
      value: "learned-first",
      validFrom: "2026-06-01T00:00:00Z",
      validTo: null,
      recordedAt: "2026-02-01T00:00:00Z",
      supersededAt: null,
      reason: "Recorded at the time.",
    }

    const history = factHistory([late, early], "f")
    expect(history.map((h) => h.value)).toEqual(["learned-first", "learned-last"])
  })

  it("carries the reason for each version", () => {
    const history = factHistory(VERSIONS, "seat-president:holder")
    expect(history[1].reason).toMatch(/Registrar confirmed/)
  })

  it("says nothing about a fact it does not hold", () => {
    expect(factHistory(VERSIONS, "seat-treasurer:holder")).toEqual([])
  })
})

describe("whether a past decision still reads the way it did", () => {
  it("reports drift when a correction changed the ground under it", () => {
    // Not a fault — corrections are legitimate — but the thing a reviewer must
    // be shown rather than left to discover.
    const drift = decisionDrifted(VERSIONS, { decidedAt: MARCH, now: NOW })

    expect(drift.drifted).toBe(true)
    expect(drift.thenKnown).toBe(true)
    expect(drift.nowKnown).toBe(false)
  })

  it("reports no drift when nothing changed", () => {
    const drift = decisionDrifted([original], { decidedAt: MARCH, now: NOW })
    expect(drift.drifted).toBe(false)
    expect(drift.thenKnown).toBe(true)
    expect(drift.nowKnown).toBe(true)
  })

  it("reports no drift when the value is unchanged despite a correction", () => {
    // A correction that only widened a window changed nothing about who held
    // the seat, and flagging it would train a reviewer to ignore the flag.
    const widened = correct([original], {
      factId: "seat-president:holder",
      value: "dana",
      validFrom: "2025-12-01T00:00:00Z",
      validTo: null,
      recordedAt: JULY.toISOString(),
      reason: "Term actually began in December.",
    })
    if (!widened.ok) throw new Error(widened.detail)

    const drift = decisionDrifted(widened.versions, { decidedAt: MARCH, now: NOW })
    expect(drift.drifted).toBe(false)
  })

  it("compares with a caller's own equality where the value is not a primitive", () => {
    const versions: BitemporalVersion<{ holder: string }>[] = [
      { ...original, value: { holder: "dana" } },
    ]
    const drift = decisionDrifted(versions, { decidedAt: MARCH, now: NOW }, (a, b) => a.holder === b.holder)
    expect(drift.drifted).toBe(false)
  })
})
