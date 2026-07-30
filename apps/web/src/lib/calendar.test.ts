import { detectConflicts, overlaps, type CalendarEventLike } from "./calendar"

const d = (iso: string) => new Date(iso)

function evt(partial: Partial<CalendarEventLike> & { id: string }): CalendarEventLike {
  return {
    organizationId: "org_a",
    title: `Event ${partial.id}`,
    startAt: d("2026-10-01T18:00:00Z"),
    endAt: d("2026-10-01T20:00:00Z"),
    venue: null,
    ...partial,
  }
}

describe("overlaps", () => {
  it("detects genuine overlap and rejects back-to-back bookings", () => {
    const a = { startAt: d("2026-10-01T18:00:00Z"), endAt: d("2026-10-01T20:00:00Z") }
    expect(overlaps(a, { startAt: d("2026-10-01T19:00:00Z"), endAt: d("2026-10-01T21:00:00Z") })).toBe(true)
    expect(overlaps(a, { startAt: d("2026-10-01T20:00:00Z"), endAt: d("2026-10-01T22:00:00Z") })).toBe(false)
    expect(overlaps(a, { startAt: d("2026-10-01T16:00:00Z"), endAt: d("2026-10-01T18:00:00Z") })).toBe(false)
  })
})

describe("detectConflicts", () => {
  const proposed = {
    organizationId: "org_a",
    title: "Case Prep Night",
    startAt: d("2026-10-01T18:00:00Z"),
    endAt: d("2026-10-01T20:00:00Z"),
    venue: "Schlegel 203",
  }

  it("flags same-venue overlap as HARD even across clubs", () => {
    const found = detectConflicts(proposed, [
      evt({ id: "e1", organizationId: "org_b", venue: "schlegel 203" }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe("HARD")
    expect(found[0].reason).toMatch(/Venue clash/)
  })

  it("flags own-club overlap as HARD even in different venues", () => {
    const found = detectConflicts(proposed, [
      evt({ id: "e2", organizationId: "org_a", venue: "Gleason 118" }),
    ])
    expect(found[0].severity).toBe("HARD")
    expect(found[0].reason).toMatch(/Double booking/)
  })

  it("flags cross-club time overlap as SOFT", () => {
    const found = detectConflicts(proposed, [
      evt({ id: "e3", organizationId: "org_b", venue: "Gleason 118" }),
    ])
    expect(found[0].severity).toBe("SOFT")
  })

  it("flags same-day non-overlap as INFORMATIONAL", () => {
    const found = detectConflicts(proposed, [
      evt({
        id: "e4",
        organizationId: "org_b",
        startAt: d("2026-10-01T21:00:00Z"),
        endAt: d("2026-10-01T22:00:00Z"),
      }),
    ])
    expect(found[0].severity).toBe("INFORMATIONAL")
  })

  it("ignores different days and the event itself", () => {
    expect(
      detectConflicts(proposed, [
        evt({ id: "e5", startAt: d("2026-10-02T18:00:00Z"), endAt: d("2026-10-02T20:00:00Z") }),
      ])
    ).toHaveLength(0)
    expect(
      detectConflicts({ ...proposed, id: "self" }, [evt({ id: "self" })])
    ).toHaveLength(0)
  })

  it("sorts HARD before SOFT before INFORMATIONAL", () => {
    const found = detectConflicts(proposed, [
      evt({
        id: "info",
        organizationId: "org_b",
        startAt: d("2026-10-01T21:30:00Z"),
        endAt: d("2026-10-01T22:00:00Z"),
      }),
      evt({ id: "soft", organizationId: "org_b", venue: "Gleason 118" }),
      evt({ id: "hard", organizationId: "org_b", venue: "Schlegel 203" }),
    ])
    expect(found.map((c) => c.severity)).toEqual(["HARD", "SOFT", "INFORMATIONAL"])
  })
})
