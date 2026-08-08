import {
  GRAPH_CALENDAR_REVIEW,
  GRAPH_CALENDAR_SCOPES,
  RELAY_ANTHROPIC_REVIEW,
  calendarSyncSentence,
  providerActivation,
  type ProviderReview,
} from "./provider-review"

/**
 * WRK-GATE-080 — the calendar half of the provider-activation gate.
 *
 * `providerActivation` itself already has cases in
 * `apps/web/src/app/api/ai/ai-kill-switch.test.ts`, over the Anthropic relay.
 * What had none was the record this item added, and the one function whose
 * output a STUDENT reads.
 *
 * ## Why the assertions read the real constants
 *
 * Every case below runs `calendarSyncSentence` and `providerActivation` over
 * the module's own `GRAPH_CALENDAR_REVIEW`, never over a fixture standing in
 * for it. A fixture would keep this file green on the day somebody edited that
 * constant to `APPROVED` — which is precisely the change that makes Tenure tell
 * a student their Outlook edits flow back, for a connector that does not exist.
 * Fixtures appear only where the point is the OTHER branch: that the refusal
 * today is a property of the record rather than a sentence with no live path
 * out of it.
 */

const NOW = "2026-08-07T12:00:00.000Z"

describe("the record, as it actually stands", () => {
  it("names the exact product, action and scope a write-back would need", () => {
    // The certification tuple. `Calendars.Read` would not cover writing Tenure's
    // changes into Outlook, and a vaguer string would be an approval nobody
    // could check a request against.
    expect(GRAPH_CALENDAR_SCOPES).toEqual(["microsoft:Calendars.ReadWrite"])
  })

  it("says NOT_SUBMITTED, approves nothing, and dates nothing", () => {
    expect(GRAPH_CALENDAR_REVIEW.state).toBe("NOT_SUBMITTED")
    expect(GRAPH_CALENDAR_REVIEW.approvedScopes).toEqual([])
    expect(GRAPH_CALENDAR_REVIEW.verifiedAt).toBeNull()
    // A programme by name, because "reviewed" with no programme is a claim
    // about nothing in particular.
    expect(GRAPH_CALENDAR_REVIEW.program).toMatch(/Microsoft/)
  })

  it("is a separate record from the relay's, so one cannot be read as the other", () => {
    // Both are NOT_SUBMITTED today and it would be easy to collapse them. They
    // are different vendors, different programmes and different scope sets, and
    // an approval of one must never activate the other.
    expect(GRAPH_CALENDAR_REVIEW.program).not.toBe(RELAY_ANTHROPIC_REVIEW.program)
  })
})

describe("what a student is told about calendar sync", () => {
  it("is one way today, and says so without promising a later two-way", () => {
    const out = calendarSyncSentence(NOW)

    expect(out.activated).toBe(false)
    // The specific refusal, not merely "not activated": NOT_SUBMITTED is work
    // nobody started, which is a different fact from an answer somebody gave.
    expect(out.reason).toBe("provider-review-missing")

    expect(out.sentence).toContain("publishes one way")
    expect(out.sentence).toContain("never reaches Tenure")

    // The sentence this item deleted, and every softer spelling of it. A future
    // promise is the same overstatement as a present one — it is what
    // "turns on once your institution connects Microsoft 365" was.
    expect(out.sentence).not.toMatch(/two-way|written back|flows? back|turns on|once your/i)
  })

  it("is the gate's own answer rather than a sentence written beside it", () => {
    // The mutation this defeats: freezing `calendarSyncSentence` to a literal.
    // Every assertion above would stay green — the copy would still read one
    // way, and would keep reading one way forever after somebody recorded a
    // real approval. So the sentence has to CARRY the verdict's own detail.
    const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, GRAPH_CALENDAR_REVIEW, NOW)

    expect(calendarSyncSentence(NOW).reason).toBe(verdict.reason)
    expect(calendarSyncSentence(NOW).activated).toBe(verdict.activated)
    expect(calendarSyncSentence(NOW).sentence).toContain(verdict.detail)
    // And the detail names the programme, so an operator reading the student's
    // screen knows which console to go to.
    expect(verdict.detail).toContain(GRAPH_CALENDAR_REVIEW.program)
  })

  it("has a reachable activated branch, so the refusal is about the record", () => {
    // A refusal with no live path out of it is indistinguishable from a
    // hardcoded denial. This proves the gate would activate on a real approval
    // WITHOUT editing the shipped record — which is why it is the one place a
    // fixture is correct.
    const approved: ProviderReview = {
      program: GRAPH_CALENDAR_REVIEW.program,
      state: "APPROVED",
      approvedScopes: [...GRAPH_CALENDAR_SCOPES],
      verifiedAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2027-07-01T00:00:00.000Z",
    }
    const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, approved, NOW)
    expect(verdict.activated).toBe(true)
    expect(verdict.unapprovedScopes).toEqual([])
  })
})

describe("the ways a Microsoft approval can fail to cover the calendar", () => {
  const base: ProviderReview = {
    program: GRAPH_CALENDAR_REVIEW.program,
    state: "APPROVED",
    approvedScopes: [...GRAPH_CALENDAR_SCOPES],
    verifiedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-07-01T00:00:00.000Z",
  }

  it("APPROVED for nothing is not approved for this", () => {
    // The exact shape of the cheapest bad edit: flip `state` to APPROVED and
    // leave `approvedScopes` as the empty array it ships with.
    const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, { ...base, approvedScopes: [] }, NOW)
    expect(verdict.activated).toBe(false)
    expect(verdict.reason).toBe("scopes-exceed-provider-approval")
    expect(verdict.unapprovedScopes).toEqual(["microsoft:Calendars.ReadWrite"])
  })

  it("APPROVED for the read scope only does not authorise writing back", () => {
    const verdict = providerActivation(
      GRAPH_CALENDAR_SCOPES,
      { ...base, approvedScopes: ["microsoft:Calendars.Read"] },
      NOW,
    )
    expect(verdict.activated).toBe(false)
    expect(verdict.reason).toBe("scopes-exceed-provider-approval")
    expect(verdict.detail).toContain("microsoft:Calendars.ReadWrite")
  })

  it("a lapsed approval is expired, not missing — they send an operator to different places", () => {
    const verdict = providerActivation(
      GRAPH_CALENDAR_SCOPES,
      { ...base, expiresAt: "2026-01-01T00:00:00.000Z" },
      NOW,
    )
    expect(verdict.activated).toBe(false)
    expect(verdict.reason).toBe("provider-review-expired")
  })

  it("an unreadable expiry fails closed", () => {
    // An approval whose end nobody can parse is one nobody can renew on time.
    const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, { ...base, expiresAt: "soon" }, NOW)
    expect(verdict.activated).toBe(false)
    expect(verdict.reason).toBe("provider-review-expired")
  })

  it("no record at all is refused rather than assumed fine", () => {
    const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, undefined, NOW)
    expect(verdict.activated).toBe(false)
    expect(verdict.reason).toBe("provider-review-missing")
    expect(verdict.unapprovedScopes).toEqual(["microsoft:Calendars.ReadWrite"])
  })
})
