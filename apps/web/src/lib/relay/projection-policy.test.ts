/**
 * WRK-010-003 — the §3.4 data modes, and the decision each source kind gets.
 *
 * The pure half. The half that proves the *production* path honours it lives in
 * `src/lib/search-data.itest.ts` (a real Postgres corpus load, asserting a
 * memory body never appears in any returned doc) and in
 * `src/app/api/ai/chat/relay-prompt-safety.test.ts` (the real route, asserting
 * a REFERENCE_ONLY body never reaches `aiComplete`'s argument even when the
 * corpus hands one over).
 */

import {
  modelSourceFor,
  projectionModeFor,
  projectionModeOf,
  retainedBody,
  PROJECTION_MODES,
  REFERENCE_ONLY_NOTE,
  type ProjectedKind,
} from "./projection-policy"

/** Every kind `loadSearchCorpus` builds. Kept in step by `MODE_BY_KIND`'s type. */
const ALL_KINDS: ProjectedKind[] = [
  "memory",
  "document",
  "approval",
  "event",
  "organization",
]

describe("the three modes Bible §3.4 fixes", () => {
  it("declares exactly those three names, in retention order", () => {
    // Not a subset and not a length: the failure this guards is a vocabulary
    // that drifts, and a loose assertion would not notice a renamed mode.
    expect([...PROJECTION_MODES]).toEqual([
      "REFERENCE_ONLY",
      "SEARCH_PROJECTION",
      "GOVERNED_REPLICA",
    ])
  })

  it("gives every source kind an explicit mode", () => {
    for (const kind of ALL_KINDS) {
      expect(PROJECTION_MODES).toContain(projectionModeFor(kind))
    }
  })
})

describe("projectionModeFor defaults to the least-retentive mode that works", () => {
  it("keeps memory-card text out of the projection entirely", () => {
    // The corpus's most guarded free text: role-scoped, classified, and the
    // only kind whose body is a person's own words. §3.4's worked example.
    expect(projectionModeFor("memory")).toBe("REFERENCE_ONLY")
  })

  it("indexes the description-shaped kinds, which are written to be read", () => {
    expect(projectionModeFor("document")).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("approval")).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("event")).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("organization")).toBe("SEARCH_PROJECTION")
  })

  it("retains nothing as a governed replica yet", () => {
    // Declared because §3.4 fixes the name and re-inventing it later is how a
    // vocabulary rots — but claimed by nothing, because nothing in this corpus
    // retains a copy of anything.
    expect(ALL_KINDS.map(projectionModeFor)).not.toContain("GOVERNED_REPLICA")
  })
})

describe("projectionModeOf fails closed", () => {
  it("accepts the three declared modes", () => {
    for (const mode of PROJECTION_MODES) expect(projectionModeOf(mode)).toBe(mode)
  })

  it("treats anything else as REFERENCE_ONLY", () => {
    // The dangerous default for "how much of this may we ship?" is "all of it".
    for (const junk of [undefined, null, "", "FULL", 3, {}, "reference_only"]) {
      expect(projectionModeOf(junk)).toBe("REFERENCE_ONLY")
    }
  })
})

describe("retainedBody decides what enters the corpus", () => {
  it("drops the body of a REFERENCE_ONLY row", () => {
    expect(retainedBody("REFERENCE_ONLY", "private lesson text")).toBe("")
  })

  it("keeps it for the retentive modes", () => {
    expect(retainedBody("SEARCH_PROJECTION", "club description")).toBe("club description")
    expect(retainedBody("GOVERNED_REPLICA", "signed contract")).toBe("signed contract")
  })
})

describe("modelSourceFor decides what crosses the vendor boundary", () => {
  const base = {
    title: "Catering lesson",
    context: "Alpha Club",
    href: "/orgs/alpha/memory",
    body: "CampusEats gave us 15% — ask for Simon",
  }

  it("emits title, club and link but no text for a REFERENCE_ONLY doc", () => {
    const item = modelSourceFor({ ...base, kind: "memory", mode: "REFERENCE_ONLY" })

    expect(item.heading).toContain("Catering lesson")
    expect(item.heading).toContain("Alpha Club")
    expect(item.heading).toContain("/orgs/alpha/memory")
    expect(item.body).toBe("")
    expect(item.omitted).toBe(REFERENCE_ONLY_NOTE)
    // The assertion the whole item exists for.
    expect(JSON.stringify(item)).not.toContain("CampusEats")
  })

  it("withholds the body even when the corpus handed one over", () => {
    // Defense in depth, not belt-and-braces: `loadSearchCorpus` already drops
    // it, and this is what stops a loader that forgot — or a cached payload
    // from an older build — from being the only thing between a private body
    // and `api.anthropic.com`.
    const item = modelSourceFor({
      ...base,
      kind: "memory",
      mode: "REFERENCE_ONLY",
      body: "a body that should never have been here",
    })
    expect(item.body).toBe("")
  })

  it("emits the body for a SEARCH_PROJECTION doc", () => {
    const item = modelSourceFor({
      ...base,
      kind: "event",
      title: "Kickoff",
      body: "Hoyt Hall, 6pm",
      mode: "SEARCH_PROJECTION",
    })
    expect(item.body).toBe("Hoyt Hall, 6pm")
    expect(item.omitted).toBeUndefined()
  })

  it("falls back to withholding when the mode is not one this build knows", () => {
    const item = modelSourceFor({
      ...base,
      kind: "memory",
      mode: "SOMETHING_A_LATER_BUILD_ADDED" as never,
    })
    expect(item.body).toBe("")
  })
})
