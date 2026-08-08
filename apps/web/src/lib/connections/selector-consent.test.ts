import {
  consentVerdict,
  consentedIntersection,
  selectorDigest,
  type CalendarSelector,
} from "@/lib/connections/selector-consent"
import { calendarToken, verifyCalendarToken } from "@/lib/calendar-sync"

/**
 * WRK-020-005 — the consent comparison, and the token that carries it.
 *
 * The behavioural proof runs against real Postgres through the ICS route
 * (`selector-consent.itest.ts`). This covers the decisions that route makes,
 * including the ones a fixture cannot easily reach: a moved institution, a lost
 * OSE seat, and a URL edited by its holder.
 */
const INSTITUTION = "inst-rochester"

const pinned: CalendarSelector = {
  institutionId: INSTITUTION,
  organizationIds: ["org-consulting", "org-finance"],
  institutionWide: false,
}

describe("selectorDigest", () => {
  it("is stable under ordering and duplication", () => {
    // Role rows come back in whatever order the planner produced. A digest that
    // moved with that order would demand re-consent on every poll, which trains
    // people to click through the prompt without reading it.
    expect(
      selectorDigest({ ...pinned, organizationIds: ["org-finance", "org-consulting"] }),
    ).toBe(selectorDigest(pinned))
    expect(
      selectorDigest({
        ...pinned,
        organizationIds: ["org-finance", "org-consulting", "org-finance"],
      }),
    ).toBe(selectorDigest(pinned))
  })

  it("changes when the institution, the clubs or institution-wide access change", () => {
    expect(selectorDigest({ ...pinned, institutionId: "inst-other" })).not.toBe(
      selectorDigest(pinned),
    )
    expect(
      selectorDigest({ ...pinned, organizationIds: [...pinned.organizationIds, "org-robotics"] }),
    ).not.toBe(selectorDigest(pinned))
    // The largest expansion available on this platform, and the one a digest
    // over club ids alone would have called UNCHANGED.
    expect(selectorDigest({ ...pinned, institutionWide: true })).not.toBe(selectorDigest(pinned))
  })
})

describe("consentVerdict", () => {
  it("is UNCHANGED for the same scope", () => {
    expect(consentVerdict(pinned, { ...pinned }).outcome).toBe("UNCHANGED")
  })

  it("is EXPANDED, and names the clubs, when the holder joins one", () => {
    const verdict = consentVerdict(pinned, {
      ...pinned,
      organizationIds: [...pinned.organizationIds, "org-robotics"],
    })
    expect(verdict.outcome).toBe("EXPANDED")
    expect(verdict.addedOrganizationIds).toEqual(["org-robotics"])
  })

  it("is EXPANDED when the holder gains institution-wide access", () => {
    expect(consentVerdict(pinned, { ...pinned, institutionWide: true }).outcome).toBe("EXPANDED")
  })

  it("is NARROWED when the holder leaves a club, and needs no new consent", () => {
    const verdict = consentVerdict(pinned, { ...pinned, organizationIds: ["org-consulting"] })
    expect(verdict.outcome).toBe("NARROWED")
    expect(verdict.removedOrganizationIds).toEqual(["org-finance"])
  })

  it("is EXPANDED for a different institution whatever the club lists say", () => {
    // Checked before the set comparison on purpose: a token moved to a second
    // tenant must not come back NARROWED because it happens to name fewer clubs.
    const verdict = consentVerdict(pinned, {
      institutionId: "inst-other",
      organizationIds: ["org-consulting"],
      institutionWide: false,
    })
    expect(verdict.outcome).toBe("EXPANDED")
  })
})

describe("consentedIntersection", () => {
  it("is never wider than the consent, and never wider than current access", () => {
    const intersection = consentedIntersection(pinned, {
      institutionId: INSTITUTION,
      // One club kept, one left, one joined since.
      organizationIds: ["org-consulting", "org-robotics"],
      institutionWide: true,
    })

    expect(intersection.organizationIds).toEqual(["org-consulting"])
    // Both halves matter: dropping the second would let a revoked membership
    // keep delivering through an old token.
    expect(intersection.institutionWide).toBe(false)
  })
})

describe("the feed token carries the consent", () => {
  const EPOCH = 3

  it("round-trips the selector and its digest", () => {
    const token = calendarToken("user-priya", INSTITUTION, EPOCH, pinned)
    const claims = verifyCalendarToken(token, EPOCH)

    expect(claims).not.toBeNull()
    expect(claims!.selector.organizationIds).toEqual(["org-consulting", "org-finance"])
    expect(claims!.selector.institutionWide).toBe(false)
    expect(claims!.selectorDigest).toBe(selectorDigest(pinned))
  })

  it("refuses a token whose holder widened their own consent by editing the URL", () => {
    // The attack the MAC exists to stop, asserted rather than assumed: the
    // selector is inside the signature, so re-encoding it invalidates the token
    // rather than granting a wider feed.
    const token = calendarToken("user-priya", INSTITUTION, EPOCH, pinned)
    const parts = token.split(".")
    parts[3] = Buffer.from(
      JSON.stringify({ o: ["org-consulting", "org-finance", "org-robotics"], w: true }),
      "utf8",
    ).toString("base64url")

    expect(verifyCalendarToken(parts.join("."), EPOCH)).toBeNull()
  })

  it("refuses a v1 token, rather than reading its fields in the wrong order", () => {
    const v1 = [
      "v1",
      Buffer.from("user-priya").toString("base64url"),
      Buffer.from(INSTITUTION).toString("base64url"),
      String(Math.floor(Date.now() / 1000)),
      String(EPOCH),
      "not-a-real-mac",
    ].join(".")

    expect(verifyCalendarToken(v1, EPOCH)).toBeNull()
  })
})
