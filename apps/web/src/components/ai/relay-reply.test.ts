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
})
