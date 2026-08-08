/**
 * WRK-070-003 — the governed deep link, and the two facts a citation carries
 * that nothing in this repository could state before it.
 *
 * ## What is here and what is deliberately elsewhere
 *
 * `governedDeepLink` is a GATE, and a gate is one of the few things worth
 * testing directly: its refusals are unreachable from the corpus (no connector
 * exists, so no row carries a provider URL) and a gate whose refusal branch is
 * never exercised is a gate nobody has checked. The provider branch is
 * exercised against the SHIPPED `GRAPH_CALENDAR_REVIEW` — honestly
 * `NOT_SUBMITTED` — so the refusal proved here is the one production takes.
 *
 * The half that could be faked by testing a helper is not here. That the corpus
 * actually stamps these citations, that `/api/search` and `/api/ai/chat` emit
 * them, and that a STALE row is labelled in the model's own prompt are asserted
 * at the producers: `src/lib/search.test.ts` (through `loadSearchCorpus`),
 * `src/app/api/ai/chat/relay-prompt-safety.test.ts` (through the route) and
 * `src/lib/search-data.itest.ts` (through a real Postgres load).
 */

import {
  CitationError,
  PROVIDER_DEEP_LINK_POLICIES,
  SEARCH_STALE_AFTER_MS,
  citationOf,
  citationRules,
  freshnessOf,
  governedDeepLink,
  parseSourceCitation,
  projectTenureRecord,
  providerIdOf,
  type ProviderDeepLinkPolicy,
} from "./citation"

const NOW = new Date("2026-08-01T00:00:00.000Z")

/**
 * The one external provider this repository catalogues, approved.
 *
 * Injected rather than written into `provider-review.ts`, for the reason the
 * gate exists: recording an approval nobody obtained to make a test pass is the
 * exact failure `providerActivation` was built to prevent. This is the value the
 * shipped record would hold the day somebody performs the review.
 */
const APPROVED: Readonly<Record<string, ProviderDeepLinkPolicy>> = {
  "microsoft-graph-calendar": {
    ...PROVIDER_DEEP_LINK_POLICIES["microsoft-graph-calendar"],
    review: {
      program: "Microsoft Publisher Verification — Graph calendar (Calendars.ReadWrite)",
      state: "APPROVED",
      approvedScopes: [...PROVIDER_DEEP_LINK_POLICIES["microsoft-graph-calendar"].scopes],
      verifiedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
}

describe("governedDeepLink — Tenure's own rows", () => {
  it("emits a same-origin absolute path", () => {
    expect(governedDeepLink({ providerId: null, url: "/calendar/ev_1" }, NOW)).toBe(
      "/calendar/ev_1",
    )
  })

  it("refuses a protocol-relative path, which resolves against another host", () => {
    // `//evil.example/x` is not a Tenure route. A browser reads it as
    // `https://evil.example/x`, and a check for a leading "/" alone accepts it.
    expect(governedDeepLink({ providerId: null, url: "//evil.example/x" }, NOW)).toBeNull()
  })

  it("refuses an absolute URL stamped into a Tenure row's href", () => {
    expect(
      governedDeepLink({ providerId: null, url: "https://evil.example/steal" }, NOW),
    ).toBeNull()
    expect(governedDeepLink({ providerId: null, url: "javascript:alert(1)" }, NOW)).toBeNull()
    expect(governedDeepLink({ providerId: null, url: "" }, NOW)).toBeNull()
  })
})

describe("governedDeepLink — a provider's rows", () => {
  const OUTLOOK = "https://outlook.office.com/calendar/item/AAMk"

  it("refuses every link for the provider as this ships, because nobody reviewed it", () => {
    // Against the SHIPPED record. `GRAPH_CALENDAR_REVIEW` is NOT_SUBMITTED, and
    // this is the consequence: the object may be cited, and the reader cannot be
    // sent to it. Not a hypothetical — it is what the default table produces.
    expect(governedDeepLink({ providerId: "microsoft-graph-calendar", url: OUTLOOK }, NOW)).toBeNull()
  })

  it("emits the link once the provider has approved every requested scope", () => {
    expect(
      governedDeepLink({ providerId: "microsoft-graph-calendar", url: OUTLOOK }, NOW, APPROVED),
    ).toBe(`${OUTLOOK}`)
  })

  it("still refuses a host the provider did not declare, however approved it is", () => {
    // Activation is not sufficient. The stored URL is attacker-influenceable —
    // it is a string somebody wrote into the provider — so "it claims to be an
    // Outlook link" is a claim by the wrong half of the pair.
    for (const url of [
      "https://outlook.office.com.evil.example/calendar/item/AAMk",
      "https://collect.example.com/steal?roster=all",
      // Right host, wrong scheme: a downgrade is still a link Tenure vouched for.
      "http://outlook.office.com/calendar/item/AAMk",
      "not a url at all",
    ]) {
      expect(
        governedDeepLink({ providerId: "microsoft-graph-calendar", url }, NOW, APPROVED),
      ).toBeNull()
    }
  })

  it("refuses a provider that is not in the table at all", () => {
    // Absent is refused, not defaulted: adding a connector without declaring its
    // host produces a citation with no link, never one with an unchecked link.
    expect(
      governedDeepLink({ providerId: "drive", url: "https://drive.google.com/f/1" }, NOW, APPROVED),
    ).toBeNull()
  })

  it("refuses once an approval has lapsed", () => {
    const lapsed: Readonly<Record<string, ProviderDeepLinkPolicy>> = {
      "microsoft-graph-calendar": {
        ...APPROVED["microsoft-graph-calendar"],
        review: {
          ...APPROVED["microsoft-graph-calendar"].review,
          expiresAt: "2026-07-01T00:00:00.000Z",
        },
      },
    }
    expect(
      governedDeepLink({ providerId: "microsoft-graph-calendar", url: OUTLOOK }, NOW, lapsed),
    ).toBeNull()
  })
})

describe("providerIdOf", () => {
  it("reads Tenure's own rows as the internal branch and everything else as a provider", () => {
    expect(providerIdOf({ tenant: "t", provider: "tenure", externalId: "x" })).toBeNull()
    expect(providerIdOf({ tenant: "t", provider: "drive", externalId: "x" })).toBe("drive")
  })
})

describe("parseSourceCitation runs the gate at the boundary", () => {
  const base = {
    ref: { tenant: "inst_1", provider: "tenure", externalId: "ev_1" },
    assertion: "RECORD",
    versionAt: "2026-08-01T00:00:00.000Z",
    observedAt: "2026-08-01T00:00:00.000Z",
    state: "LIVE",
  }

  it("keeps a governed link", () => {
    expect(parseSourceCitation({ ...base, href: "/calendar/ev_1" }).href).toBe("/calendar/ev_1")
  })

  it("drops an ungoverned one rather than throwing", () => {
    // A citation with no link is still a citation. Throwing would degrade the
    // whole value to `UNRESOLVED_CITATION` through `citationOf`, which withholds
    // the source's TEXT — a body suppressed over a link is the wrong trade.
    const cited = parseSourceCitation({ ...base, href: "https://evil.example/steal" })
    expect(cited.href).toBeNull()
    expect(cited.state).toBe("LIVE")
  })

  it("still refuses a citation whose state or origin cannot be checked", () => {
    expect(() => parseSourceCitation({ ...base, href: "/x", state: "PROBABLY_FINE" })).toThrow(
      CitationError,
    )
    expect(() => parseSourceCitation({ ...base, href: "/x", ref: { provider: "tenure" } })).toThrow(
      CitationError,
    )
  })

  it("fails closed through citationOf, which is what a cached payload hits", () => {
    expect(citationOf({ nonsense: true }).state).toBe("ACCESS_LOST")
    expect(citationOf({ nonsense: true }).href).toBeNull()
  })
})

describe("freshnessOf", () => {
  it("calls a row inside the horizon live and one outside it stale", () => {
    expect(freshnessOf(new Date(NOW.getTime() - 1000), NOW)).toBe("LIVE")
    expect(freshnessOf(new Date(NOW.getTime() - SEARCH_STALE_AFTER_MS + 1000), NOW)).toBe("LIVE")
    expect(freshnessOf(new Date(NOW.getTime() - SEARCH_STALE_AFTER_MS - 1000), NOW)).toBe("STALE")
  })

  it("fails closed on a date nobody can read", () => {
    // A row whose `updatedAt` did not survive its projection has no freshness
    // anybody can vouch for, and the safe direction is to say so.
    expect(freshnessOf(new Date("not a date"), NOW)).toBe("STALE")
  })
})

describe("projectTenureRecord builds the state and the citation together", () => {
  const row = {
    tenant: "inst_1",
    externalId: "ev_1",
    href: "/calendar/ev_1",
    asOf: new Date(NOW.getTime() - 1000),
    now: NOW,
  }

  it("agrees with itself: the doc's state and the citation's state are one value", () => {
    for (const lifecycle of [{}, { deleted: true }, { quarantined: true }]) {
      const projected = projectTenureRecord({ ...row, ...lifecycle })
      expect(projected.citation.state).toBe(projected.state)
    }
  })

  it("ranks deletion above quarantine above age", () => {
    // A cancelled event that is also old is GONE, not stale: telling a reader
    // "this may be out of date" about something that no longer exists is worse
    // than saying nothing.
    const ancient = { ...row, asOf: new Date(NOW.getTime() - SEARCH_STALE_AFTER_MS - 1000) }
    expect(projectTenureRecord({ ...ancient, deleted: true }).state).toBe("TOMBSTONED")
    expect(projectTenureRecord({ ...ancient, quarantined: true }).state).toBe("QUARANTINED")
    expect(projectTenureRecord({ ...ancient, deleted: true, quarantined: true }).state).toBe(
      "TOMBSTONED",
    )
    expect(projectTenureRecord(ancient).state).toBe("STALE")
    expect(projectTenureRecord(row).state).toBe("LIVE")
  })

  it("carries §9.3's version time, which is the row's own and not the clock", () => {
    const projected = projectTenureRecord(row)
    expect(projected.citation.versionAt).toBe(row.asOf.toISOString())
    expect(projected.citation.observedAt).toBe(NOW.toISOString())
    expect(projected.citation.versionAt).not.toBe(projected.citation.observedAt)
  })
})

describe("citationRules — the half only the model can carry", () => {
  it("states the freshness rule, the withheld-source rule and the inference rule", () => {
    const rules = citationRules()
    // `[\s\S]*` rather than `.` with the `s` flag: dotAll is ES2018 and this
    // workspace targets ES2017, so `/…/is` is a compile error rather than a
    // style choice. Same match, no target change — raising the whole project's
    // target to satisfy one assertion would be the wrong lever entirely.
    expect(rules).toMatch(/labelled STALE [\s\S]*may be out of date/i)
    expect(rules).toMatch(/TOMBSTONED, QUARANTINED, ACCESS_LOST or CONFLICTED carries no text/)
    expect(rules).toMatch(/not traceable to a numbered source is your own inference/)
    // The rule that makes the route's after-the-fact check rare rather than
    // unnecessary. Both are needed: this asks, `verifyCitations` verifies.
    expect(rules).toMatch(/use only numbers that appear in the list you were given/)
  })
})
