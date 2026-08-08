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
  effectiveModeFor,
  modelSourceFor,
  projectionModeFor,
  projectionModeOf,
  residencyCeiling,
  retainedBody,
  PROJECTION_MODES,
  REFERENCE_ONLY_NOTE,
  type ProjectedKind,
  type ProjectionResidency,
} from "./projection-policy"
import { projectTenureRecord } from "./citation"

/** Every kind `loadSearchCorpus` builds. Kept in step by `MODE_BY_KIND`'s type. */
const ALL_KINDS: ProjectedKind[] = [
  "memory",
  "document",
  "approval",
  "event",
  "organization",
]

/**
 * WRK-070-001. Where the tenant's data is, per test.
 *
 * `COMMERCIAL` is the pilot's own residency and the one every pre-existing
 * assertion below is now made against explicitly rather than implicitly — which
 * is the point of the parameter being required.
 */
const COMMERCIAL: ProjectionResidency = { partition: "aws", region: "us-east-1" }
/** A cell whose partition has no route to `api.anthropic.com`. */
const GOVCLOUD: ProjectionResidency = { partition: "aws-us-gov", region: "us-gov-west-1" }
/** A residency record that contradicts itself: commercial partition, GovCloud region. */
const INCOHERENT: ProjectionResidency = { partition: "aws", region: "us-gov-west-1" }

/** A real citation for the fixture docs, so nothing here builds one by hand. */
const CITED = projectTenureRecord({
  tenant: "inst_alpha",
  externalId: "mem_1",
  href: "/orgs/alpha/memory",
  asOf: new Date("2026-08-01T00:00:00.000Z"),
  now: new Date("2026-08-02T00:00:00.000Z"),
})

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
      expect(PROJECTION_MODES).toContain(projectionModeFor(kind, COMMERCIAL))
    }
  })
})

describe("projectionModeFor defaults to the least-retentive mode that works", () => {
  it("keeps memory-card text out of the projection entirely", () => {
    // The corpus's most guarded free text: role-scoped, classified, and the
    // only kind whose body is a person's own words. §3.4's worked example.
    expect(projectionModeFor("memory", COMMERCIAL)).toBe("REFERENCE_ONLY")
  })

  it("indexes the description-shaped kinds, which are written to be read", () => {
    expect(projectionModeFor("document", COMMERCIAL)).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("approval", COMMERCIAL)).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("event", COMMERCIAL)).toBe("SEARCH_PROJECTION")
    expect(projectionModeFor("organization", COMMERCIAL)).toBe("SEARCH_PROJECTION")
  })

  it("retains nothing as a governed replica yet", () => {
    // Declared because §3.4 fixes the name and re-inventing it later is how a
    // vocabulary rots — but claimed by nothing, because nothing in this corpus
    // retains a copy of anything.
    expect(ALL_KINDS.map((k) => projectionModeFor(k, COMMERCIAL))).not.toContain(
      "GOVERNED_REPLICA",
    )
  })
})

/**
 * WRK-070-001 — the projection is no longer global.
 *
 * `projectionModeFor(kind)` decided over a module-level constant, so every
 * tenant, in every cell, in every region got the same retention answer: a tenant
 * whose residency forbids shipping a body to a vendor still had its descriptions
 * projected at `SEARCH_PROJECTION` and assembled into a prompt.
 */
describe("the mode is capped by where the tenant's data actually is", () => {
  it("caps every kind at REFERENCE_ONLY in a partition the vendor is not in", () => {
    // Not "no result" and not an error: the sources are still findable and
    // citable by title and link, and no text is retained anywhere.
    for (const kind of ALL_KINDS) {
      expect(projectionModeFor(kind, GOVCLOUD)).toBe("REFERENCE_ONLY")
    }
    // The contrast that makes the line above about residency rather than about
    // the kinds: the same five, in the pilot's own partition.
    expect(projectionModeFor("document", COMMERCIAL)).toBe("SEARCH_PROJECTION")
  })

  it("reads the same availability matrix the console reads", () => {
    // `serviceAvailableIn` is `partition-services.ts`'s, not a second list.
    // `aws-cn` is the third partition and it has no `anthropic-public-api` row
    // either, so a matrix edit moves this answer.
    expect(residencyCeiling(COMMERCIAL)).toBe("GOVERNED_REPLICA")
    expect(residencyCeiling(GOVCLOUD)).toBe("REFERENCE_ONLY")
    expect(residencyCeiling({ partition: "aws-cn", region: "cn-north-1" })).toBe(
      "REFERENCE_ONLY",
    )
  })

  it("refuses a residency whose region and partition contradict each other", () => {
    // Two environment variables, and nothing had ever checked that they describe
    // the same place. A cell claiming the commercial partition while running in
    // `us-gov-west-1` gets the least-retentive answer, not the commercial one.
    expect(residencyCeiling(INCOHERENT)).toBe("REFERENCE_ONLY")
    expect(projectionModeFor("document", INCOHERENT)).toBe("REFERENCE_ONLY")
    expect(residencyCeiling({ partition: "aws", region: "not-a-region" })).toBe(
      "REFERENCE_ONLY",
    )
  })

  it("caps a mode the corpus already stamped, at the vendor boundary", () => {
    // The second gate. A corpus assembled in one cell and read in another — or a
    // cached payload from an older build — cannot re-widen itself.
    const doc = { mode: "SEARCH_PROJECTION" } as const
    expect(effectiveModeFor(doc, COMMERCIAL)).toBe("SEARCH_PROJECTION")
    expect(effectiveModeFor(doc, GOVCLOUD)).toBe("REFERENCE_ONLY")
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
    ...CITED,
  }

  it("emits title, club and link but no text for a REFERENCE_ONLY doc", () => {
    const item = modelSourceFor(
      { ...base, kind: "memory", mode: "REFERENCE_ONLY" },
      COMMERCIAL,
    )

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
    const item = modelSourceFor(
      {
        ...base,
        kind: "memory",
        mode: "REFERENCE_ONLY",
        body: "a body that should never have been here",
      },
      COMMERCIAL,
    )
    expect(item.body).toBe("")
  })

  it("emits the body for a SEARCH_PROJECTION doc", () => {
    const item = modelSourceFor(
      {
        ...base,
        kind: "event",
        title: "Kickoff",
        body: "Hoyt Hall, 6pm",
        mode: "SEARCH_PROJECTION",
      },
      COMMERCIAL,
    )
    expect(item.body).toBe("Hoyt Hall, 6pm")
    expect(item.omitted).toBeUndefined()
  })

  it("falls back to withholding when the mode is not one this build knows", () => {
    const item = modelSourceFor(
      { ...base, kind: "memory", mode: "SOMETHING_A_LATER_BUILD_ADDED" as never },
      COMMERCIAL,
    )
    expect(item.body).toBe("")
  })

  it("withholds a projected body from a cell whose partition cannot reach the vendor", () => {
    // WRK-070-001, at the boundary. Same doc, same mode, same everything except
    // where the cell is — and the text does not cross.
    const doc = {
      ...base,
      kind: "event" as const,
      title: "Kickoff",
      body: "Hoyt Hall, 6pm",
      mode: "SEARCH_PROJECTION" as const,
    }
    expect(modelSourceFor(doc, COMMERCIAL).body).toBe("Hoyt Hall, 6pm")

    const withheld = modelSourceFor(doc, GOVCLOUD)
    expect(withheld.body).toBe("")
    expect(withheld.omitted).toBe(REFERENCE_ONLY_NOTE)
    // Still citable — the club and the link go, the words do not.
    expect(withheld.heading).toContain("Kickoff")
    expect(JSON.stringify(withheld)).not.toContain("Hoyt Hall")
  })
})
