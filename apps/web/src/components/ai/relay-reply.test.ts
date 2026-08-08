import { relayReply } from "@/components/ai/relay-reply"

/**
 * The four outcomes `/api/ai/chat` can produce, and the one sentence each is
 * allowed to say. Each case here corresponds to a real response shape the route
 * builds at src/app/api/ai/chat/route.ts:153-166.
 */
describe("relayReply", () => {
  const base = {
    answer: null,
    aiEnabled: false,
    aiDisabledReason: null,
    toolRefusal: null,
    // WRK-GATE-070 made this REQUIRED rather than optional, deliberately: an
    // optional field would have compiled at every call site and left the ladder
    // falling through to "couldn't generate an answer just now", which is false
    // twice over. Required means `tsc` names every construction site — this
    // fixture was one of them.
    citationRefusal: null,
    sourceCount: 0,
  }

  it("passes an answer through untouched", () => {
    const reply = relayReply({ ...base, answer: "Your gala is on the 14th [1].", aiEnabled: true, sourceCount: 2 })
    expect(reply.outcome).toBe("answered")
    expect(reply.message).toBe("Your gala is on the 14th [1].")
    expect(reply.showSources).toBe(true)
  })

  it("a refused user is not told the assistant is unconfigured", () => {
    // The route returns `aiEnabled: false` for a tool refusal too, because
    // `available` is the AND of three things. If the ladder checks `aiEnabled`
    // before `toolRefusal`, this person is told nobody set up a model — which
    // is a fact about the deployment, not about their permissions.
    const reply = relayReply({
      ...base,
      toolRefusal: "principal does not hold search.index.query",
      aiEnabled: false,
    })

    expect(reply.outcome).toBe("retrieval-refused")
    expect(reply.message).toContain("principal does not hold search.index.query")
    // And it must NOT claim anything about what is in the workspace: nothing
    // was searched, so "I couldn't find anything" would be untrue.
    expect(reply.message).not.toMatch(/couldn't find anything|didn't find anything/i)
    expect(reply.message).not.toMatch(/no model is connected|aren't set up|isn't set up/i)
    expect(reply.showSources).toBe(false)
  })

  it("a tenant that switched the assistant off is told so, with the flag's reason", () => {
    const reply = relayReply({
      ...base,
      aiDisabledReason: "disabled by tenant policy on 2026-03-02",
      sourceCount: 3,
    })

    expect(reply.outcome).toBe("assistant-disabled")
    expect(reply.message).toContain("disabled by tenant policy on 2026-03-02")
    expect(reply.message).toMatch(/switched off/i)
    // Retrieval is unaffected by the flag, so the sources are still worth it.
    expect(reply.showSources).toBe(true)
  })

  it("an unconfigured cell says nobody connected a model — not that the tenant disabled it", () => {
    const reply = relayReply({ ...base, sourceCount: 1 })

    expect(reply.outcome).toBe("unconfigured")
    expect(reply.message).toMatch(/no model is connected/i)
    expect(reply.message).not.toMatch(/switched off/i)
    expect(reply.showSources).toBe(true)
  })

  it("an enabled assistant that produced nothing is a transient failure, not a refusal", () => {
    const reply = relayReply({ ...base, aiEnabled: true, sourceCount: 2 })

    expect(reply.outcome).toBe("answered")
    expect(reply.message).toMatch(/couldn't generate an answer just now/i)
    expect(reply.showSources).toBe(true)
  })

  it("an empty-string answer is not an answer", () => {
    // A vendor that returns "" is not the same as a vendor that returned prose,
    // and rendering an empty assistant bubble looks like the product broke.
    const reply = relayReply({ ...base, answer: "   ", aiEnabled: true, sourceCount: 0 })
    expect(reply.message).not.toBe("   ")
    expect(reply.message).toMatch(/couldn't generate an answer just now/i)
  })

  it("says the citation was fabricated rather than blaming a transient failure", () => {
    // WRK-GATE-070. The field was made required so the ladder could not fall
    // through to the bottom rung here, and without this test that requirement is
    // a field nothing reads — which is the exact shape of dead code the type was
    // widened to prevent.
    const reply = relayReply({
      ...base,
      aiEnabled: true,
      citationRefusal: "It cited [4]; three sources were retrieved.",
      sourceCount: 3,
    })

    expect(reply.outcome).toBe("citation-refused")
    // The two facts a reader needs: an answer WAS written, and it was withheld
    // because it cited something unretrieved.
    expect(reply.message).toMatch(/wrote an answer and did not show it/i)
    expect(reply.message).toContain("It cited [4]; three sources were retrieved.")
    // And explicitly NOT the bottom rung, which would send them to retry the one
    // thing that cannot help and would hide that a model fabricated a citation.
    expect(reply.message).not.toMatch(/couldn't generate an answer just now/i)
    // The retrieved sources are real and are still shown — a degradation, not a
    // dead end.
    expect(reply.showSources).toBe(true)
  })

  it("shows no sources on a citation refusal when none were retrieved", () => {
    const reply = relayReply({ ...base, aiEnabled: true, citationRefusal: "It cited [1].", sourceCount: 0 })
    expect(reply.outcome).toBe("citation-refused")
    expect(reply.showSources).toBe(false)
  })

  it("a real retrieval refusal still outranks a citation refusal", () => {
    // Ordering matters: `toolRefusal` describes a search that never happened,
    // `citationRefusal` describes an answer that did. Telling somebody their
    // answer was withheld for a bad citation, when in fact nothing was ever
    // searched, is a worse lie than either message alone.
    const reply = relayReply({
      ...base,
      aiEnabled: true,
      toolRefusal: "You do not have access to search here.",
      citationRefusal: "It cited [2].",
      sourceCount: 0,
    })
    expect(reply.outcome).toBe("retrieval-refused")
  })
})
