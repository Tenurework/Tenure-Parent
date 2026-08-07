import { detectConflicts } from "./calendar"
import {
  decideConflictOutcome,
  EVENT_OVERRIDE_CAPABILITY,
  MIN_OVERRIDE_REASON,
} from "./calendar-conflict-policy"

/**
 * The conflicts fed in here are produced by the real detector, not hand-built,
 * so a rule that stops firing — or stops being HARD — fails these tests too.
 */
const d = (iso: string) => new Date(iso)

const proposed = {
  organizationId: "org_a",
  title: "Case Prep Night",
  startAt: d("2026-10-01T18:00:00Z"),
  endAt: d("2026-10-01T20:00:00Z"),
  venue: "Schlegel 203",
}

/** Another club, same room, same hours → VENUE_DOUBLE_BOOKING (HARD). */
const venueClash = () =>
  detectConflicts(proposed, [
    {
      id: "e_hard",
      organizationId: "org_b",
      title: "Robotics Build",
      startAt: d("2026-10-01T19:00:00Z"),
      endAt: d("2026-10-01T21:00:00Z"),
      venue: "schlegel 203",
    },
  ])

/** Another club, another room, overlapping → AUDIENCE_OVERLAP (SOFT). */
const audienceOnly = () =>
  detectConflicts(proposed, [
    {
      id: "e_soft",
      organizationId: "org_b",
      title: "Debate Social",
      startAt: d("2026-10-01T19:00:00Z"),
      endAt: d("2026-10-01T21:00:00Z"),
      venue: "Gleason 118",
    },
  ])

const REASON = "Dean's reception moved; the room was released to us in writing."

describe("decideConflictOutcome", () => {
  it("allows a write with no conflicts at all", () => {
    const decision = decideConflictOutcome({
      conflicts: [],
      actorHasOverride: false,
      overrideRequested: false,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.blockedByRules).toEqual([])
    expect(decision.override).toBeNull()
  })

  it("lets SOFT and INFORMATIONAL conflicts through untouched", () => {
    const conflicts = audienceOnly()
    expect(conflicts[0].rule).toBe("AUDIENCE_OVERLAP")

    const decision = decideConflictOutcome({
      conflicts,
      actorHasOverride: false,
      overrideRequested: false,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.blockedByRules).toEqual([])
    expect(decision.explanation).toMatch(/do not block/)
  })

  it("blocks a HARD conflict when the actor has no override authority", () => {
    const decision = decideConflictOutcome({
      conflicts: venueClash(),
      actorHasOverride: false,
      overrideRequested: false,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.blockedByRules).toEqual(["VENUE_DOUBLE_BOOKING"])
    expect(decision.blocked).toEqual({
      code: "NO_OVERRIDE_AUTHORITY",
      requiredCapability: EVENT_OVERRIDE_CAPABILITY,
    })
    expect(decision.override).toBeNull()
    // The explanation names the rule AND the facts that fired it.
    expect(decision.explanation).toMatch(/venue double-booking/)
    expect(decision.explanation).toMatch(/Robotics Build/)
  })

  it("still blocks an authorized actor who did not explicitly ask to override", () => {
    const decision = decideConflictOutcome({
      conflicts: venueClash(),
      actorHasOverride: true,
      overrideRequested: false,
      overrideReason: REASON,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.blocked?.code).toBe("OVERRIDE_NOT_REQUESTED")
    expect(decision.override).toBeNull()
  })

  it("blocks an explicit override that records no usable reason", () => {
    for (const reason of [undefined, null, "   ", "ok"]) {
      const decision = decideConflictOutcome({
        conflicts: venueClash(),
        actorHasOverride: true,
        overrideRequested: true,
        overrideReason: reason,
      })
      expect(decision.allowed).toBe(false)
      expect(decision.blocked?.code).toBe("OVERRIDE_REASON_REQUIRED")
    }
    expect("ok".length).toBeLessThan(MIN_OVERRIDE_REASON)
  })

  it("allows the write only with authority, an explicit request and a reason", () => {
    const decision = decideConflictOutcome({
      conflicts: venueClash(),
      actorHasOverride: true,
      overrideRequested: true,
      overrideReason: `  ${REASON}  `,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.blocked).toBeNull()
    expect(decision.blockedByRules).toEqual([])
    expect(decision.override).toEqual({
      rules: ["VENUE_DOUBLE_BOOKING"],
      reason: REASON,
      conflictWithEventIds: ["e_hard"],
    })
    expect(decision.explanation).toContain(REASON)
  })

  it("reports every distinct blocking rule, once each, and ignores advisory ones", () => {
    const conflicts = detectConflicts(proposed, [
      // Same room, other club → VENUE_DOUBLE_BOOKING
      {
        id: "e1",
        organizationId: "org_b",
        title: "Robotics Build",
        startAt: d("2026-10-01T19:00:00Z"),
        endAt: d("2026-10-01T21:00:00Z"),
        venue: "Schlegel 203",
      },
      // Same room again → a second VENUE_DOUBLE_BOOKING, one rule id
      {
        id: "e2",
        organizationId: "org_c",
        title: "Chess Ladder",
        startAt: d("2026-10-01T18:30:00Z"),
        endAt: d("2026-10-01T19:30:00Z"),
        venue: "schlegel 203",
      },
      // Own club elsewhere → SELF_DOUBLE_BOOKING
      {
        id: "e3",
        organizationId: "org_a",
        title: "Alumni Call",
        startAt: d("2026-10-01T19:00:00Z"),
        endAt: d("2026-10-01T20:30:00Z"),
        venue: "Gleason 118",
      },
      // Another club elsewhere → AUDIENCE_OVERLAP, advisory
      {
        id: "e4",
        organizationId: "org_b",
        title: "Debate Social",
        startAt: d("2026-10-01T19:00:00Z"),
        endAt: d("2026-10-01T21:00:00Z"),
        venue: "Sloan 4",
      },
    ])

    const decision = decideConflictOutcome({
      conflicts,
      actorHasOverride: false,
      overrideRequested: false,
    })
    expect(decision.allowed).toBe(false)
    expect([...decision.blockedByRules].sort()).toEqual([
      "SELF_DOUBLE_BOOKING",
      "VENUE_DOUBLE_BOOKING",
    ])

    const allowed = decideConflictOutcome({
      conflicts,
      actorHasOverride: true,
      overrideRequested: true,
      overrideReason: REASON,
    })
    expect(allowed.allowed).toBe(true)
    expect([...allowed.override!.conflictWithEventIds].sort()).toEqual(["e1", "e2", "e3"])
    expect(allowed.override!.conflictWithEventIds).not.toContain("e4")
  })

  it("reads severity from the rule table, so a downgraded record still blocks", () => {
    // A caller that hands back a mutated copy claiming SOFT must not get past
    // the gate: the rule id is what decides.
    const tampered = venueClash().map((c) => ({ ...c, severity: "SOFT" as const }))
    const decision = decideConflictOutcome({
      conflicts: tampered,
      actorHasOverride: false,
      overrideRequested: false,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.blockedByRules).toEqual(["VENUE_DOUBLE_BOOKING"])
  })
})
