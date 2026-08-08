/**
 * WRK-010-001 — Bible §3.5's ladder, and the three rungs nothing comes back
 * from.
 *
 * The pure half. The half that proves the LADDER IS WALKED on the production
 * path is in `search.test.ts` (`loadSearchCorpus` builds every row's citation
 * through `projectTenureRecord`, which advances DISCOVERED → AUTHORIZED →
 * FETCH_PENDING → CURRENT and throws if this table stops admitting it) and in
 * `api/ai/chat/relay-prompt-safety.test.ts` (the real route, asserting a
 * tombstoned source's text never reaches `aiComplete`'s argument).
 */

import {
  EXCEPTIONAL_PROJECTION_STATES,
  NORMAL_PROJECTION_STATES,
  PROJECTION_EVENTS,
  PROJECTION_STATES,
  TERMINAL_PROJECTION_STATES,
  advance,
  bodyMayBeQuoted,
  isProjectionEvent,
  isProjectionState,
  isTerminalProjectionState,
  type ProjectionState,
} from "./projection-state"

describe("the sixteen names §3.5 fixes", () => {
  it("declares the six normal states in the Bible's own order", () => {
    // Not a subset and not a length: the failure this guards is a vocabulary
    // that drifts, and a loose assertion would not notice a renamed rung.
    expect([...NORMAL_PROJECTION_STATES]).toEqual([
      "DISCOVERED",
      "AUTHORIZED",
      "FETCH_PENDING",
      "CURRENT",
      "STALE",
      "REFRESHING",
    ])
  })

  it("declares all ten exceptional states, verbatim", () => {
    expect([...EXCEPTIONAL_PROJECTION_STATES]).toEqual([
      "ACCESS_REVOKED",
      "SOURCE_DELETED",
      "SOURCE_MOVED",
      "SOURCE_UNKNOWN",
      "RETENTION_EXPIRED",
      "LEGAL_HOLD",
      "QUARANTINED",
      "CLASSIFICATION_BLOCKED",
      "INDEX_FAILED",
      "MAPPING_CONFLICT",
    ])
    expect(PROJECTION_STATES).toHaveLength(16)
  })

  it("narrows an unknown string rather than accepting it", () => {
    for (const state of PROJECTION_STATES) expect(isProjectionState(state)).toBe(true)
    for (const junk of [undefined, null, "", "CURRENTISH", 3, {}, "current"]) {
      expect(isProjectionState(junk)).toBe(false)
    }
    for (const event of PROJECTION_EVENTS) expect(isProjectionEvent(event)).toBe(true)
    expect(isProjectionEvent("FETCH_FAILED")).toBe(false)
  })
})

describe("the happy path is walked a rung at a time", () => {
  /** Advance through a list of events, failing loudly on the first refusal. */
  function walk(from: ProjectionState, events: readonly string[]): ProjectionState {
    let state = from
    for (const event of events) {
      const step = advance(state, event as never)
      if (!step.ok) throw new Error(`${state} + ${event}: ${step.reason}`)
      state = step.state
    }
    return state
  }

  it("reaches CURRENT from DISCOVERED and back to CURRENT through a refresh", () => {
    expect(walk("DISCOVERED", ["AUTHORIZE", "REQUEST_FETCH", "FETCH_SUCCEEDED"])).toBe("CURRENT")
    expect(walk("CURRENT", ["AGE", "REFRESH", "FETCH_SUCCEEDED"])).toBe("CURRENT")
  })

  it("refuses a step that skips authorization", () => {
    // The direction that matters. A default that shrugged and returned the
    // current state would let a caller "advance" a DISCOVERED projection to
    // CURRENT by sending the wrong event and never hear about it.
    const skipped = advance("DISCOVERED", "FETCH_SUCCEEDED")
    expect(skipped.ok).toBe(false)
    if (skipped.ok) return
    expect(skipped.from).toBe("DISCOVERED")
    expect(skipped.event).toBe("FETCH_SUCCEEDED")
    expect(skipped.reason).toMatch(/nobody authorized is not one anybody may fetch/)
  })

  it("leaves a refresh that found nothing stale rather than current", () => {
    const aged = advance("REFRESHING", "AGE")
    expect(aged).toEqual({ ok: true, state: "STALE" })
  })
})

describe("the three terminal states accept nothing", () => {
  it("names exactly the three whose cause a retry cannot change", () => {
    expect([...TERMINAL_PROJECTION_STATES]).toEqual([
      "ACCESS_REVOKED",
      "SOURCE_DELETED",
      "RETENTION_EXPIRED",
    ])
  })

  it("refuses every event from every terminal state", () => {
    // The assertion the ladder exists for: a projection whose grant was
    // withdrawn, whose source was deleted, or whose retention clock ran out must
    // not become CURRENT again because a refresh job asked politely.
    for (const state of TERMINAL_PROJECTION_STATES) {
      expect(isTerminalProjectionState(state)).toBe(true)
      for (const event of PROJECTION_EVENTS) {
        const step = advance(state, event)
        expect(step.ok).toBe(false)
        if (step.ok) continue
        expect(step.reason).toContain("terminal")
      }
    }
  })

  it("lets a recoverable exceptional state re-enter at FETCH_PENDING, never at CURRENT", () => {
    // Resolving a moved source or lifting a quarantine says where the content
    // is, not that we hold it.
    for (const state of ["SOURCE_MOVED", "QUARANTINED", "MAPPING_CONFLICT"] as const) {
      expect(advance(state, "REQUEST_FETCH")).toEqual({ ok: true, state: "FETCH_PENDING" })
      expect(advance(state, "FETCH_SUCCEEDED").ok).toBe(false)
    }
  })

  it("drops into an exceptional state from anywhere that is not terminal", () => {
    expect(advance("CURRENT", "ACCESS_REVOKED")).toEqual({ ok: true, state: "ACCESS_REVOKED" })
    expect(advance("FETCH_PENDING", "SOURCE_DELETED")).toEqual({
      ok: true,
      state: "SOURCE_DELETED",
    })
    expect(advance("REFRESHING", "QUARANTINE")).toEqual({ ok: true, state: "QUARANTINED" })
  })
})

describe("only three states may put words in an answer", () => {
  it("allows CURRENT, STALE and REFRESHING and refuses the rest", () => {
    // STALE is answerable on purpose and labelled rather than withheld: a
    // deadline from three months ago is still the best answer anybody has.
    expect(PROJECTION_STATES.filter(bodyMayBeQuoted)).toEqual([
      "CURRENT",
      "STALE",
      "REFRESHING",
    ])
  })
})
