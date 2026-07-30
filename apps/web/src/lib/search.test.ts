import { makeSnippet, rankDocs, scoreDoc, tokenize, type SearchDoc } from "./search"

function doc(partial: Partial<SearchDoc> & { id: string }): SearchDoc {
  return {
    kind: "memory",
    title: `Doc ${partial.id}`,
    body: "",
    href: `/x/${partial.id}`,
    context: "Club",
    ...partial,
  }
}

describe("tokenize", () => {
  it("lowercases, splits, and drops single characters", () => {
    expect(tokenize("Catering for the Spring-Gala!")).toEqual([
      "catering",
      "for",
      "the",
      "spring",
      "gala",
    ])
    expect(tokenize("a I")).toEqual([])
  })
})

describe("scoreDoc", () => {
  it("weights title matches above body matches", () => {
    const inTitle = scoreDoc(doc({ id: "t", title: "catering contact" }), ["catering"])
    const inBody = scoreDoc(doc({ id: "b", body: "ask about catering" }), ["catering"])
    expect(inTitle).toBeGreaterThan(inBody)
  })

  it("requires every term to appear (AND semantics)", () => {
    const d = doc({ id: "x", title: "catering contact", body: "CampusEats discount" })
    expect(scoreDoc(d, ["catering", "discount"])).toBeGreaterThan(0)
    expect(scoreDoc(d, ["catering", "missingterm"])).toBe(0)
  })
})

describe("makeSnippet", () => {
  it("centers the window on the first match", () => {
    const body = "x".repeat(300) + " the SIMON15 code works " + "y".repeat(300)
    const snip = makeSnippet(body, ["simon15"])
    expect(snip).toContain("SIMON15")
    expect(snip.length).toBeLessThan(200)
  })
})

describe("rankDocs", () => {
  it("filters non-matches and sorts by score", () => {
    const docs = [
      doc({ id: "1", title: "vendor list", body: "catering vendors" }),
      doc({ id: "2", title: "catering playbook", body: "how to book catering" }),
      doc({ id: "3", title: "budget", body: "no relevant terms" }),
    ]
    const ranked = rankDocs(docs, "catering")
    expect(ranked.map((r) => r.id)).toEqual(["2", "1"])
    expect(ranked[0].snippet).toBeTruthy()
  })
})
