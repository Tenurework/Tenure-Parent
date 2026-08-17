import { relayReply } from "./relay-reply"

/**
 * PAY-000-004 — the content review over a Relay response.
 *
 * A new file rather than more cases in `relay-reply.test.ts`: that suite is
 * TTES-020-002's, and this is the one branch of the ladder whose input is text a
 * vendor wrote rather than a fact the route computed.
 *
 * These are the sentences a model actually produces when a club treasurer asks
 * where their money is. None of them is adversarial and none needs a jailbreak;
 * each is the fluent English answer, and each is false about who holds funds.
 */

const base = {
  answer: null as string | null,
  aiEnabled: true,
  aiDisabledReason: null,
  toolRefusal: null,
  citationRefusal: null,
  sourceCount: 0,
}

describe("a Relay answer making a prohibited payments claim is withheld", () => {
  it.each([
    ["Tenure holds your funds until the payout runs on Friday.", "tenure-holds-funds"],
    ["Your gala income lands in the Tenure bank account for the club.", "tenure-bank-account"],
    ["You can order a Tenure-issued card for the treasurer.", "tenure-issued-card"],
    ["Your Tenure balance is $4,120 and available now.", "tenure-balance-is-funds"],
    ["Card payments are available globally, so you can sell anywhere.", "payments-available-globally"],
  ])("withholds %j", (answer) => {
    const reply = relayReply({ ...base, answer, sourceCount: 3 })
    expect(reply.outcome).toBe("claim-refused")
    expect(reply.message).not.toContain(answer)
    expect(reply.message).toContain("did not show it")
    // The retrieved rows are real whatever the model said about them.
    expect(reply.showSources).toBe(true)
  })

  it("tells the reader why, in the rule's own reason", () => {
    const reply = relayReply({
      ...base,
      answer: "Tenure holds your funds until the payout runs.",
      sourceCount: 0,
    })
    expect(reply.message).toContain("Tenure is not a custodian")
    expect(reply.showSources).toBe(false)
  })

  it("still answers when the model gets it right", () => {
    // MUTATION TARGET in the other direction: a scan that matched everything
    // would red here, and a lint that refuses the accurate sentence is a lint
    // somebody deletes.
    const answer =
      "The club's own bank account receives the payout. Tenure does not hold funds; the provider " +
      "and its banking partners do."
    const reply = relayReply({ ...base, answer, sourceCount: 2 })
    expect(reply.outcome).toBe("answered")
    expect(reply.message).toBe(answer)
  })

  it("does not reach the claim check when there is no answer to check", () => {
    // Order matters: a refused retrieval must not be reported as a prohibited
    // claim, because nothing was written.
    const reply = relayReply({ ...base, answer: null, toolRefusal: "You may not run search.corpus." })
    expect(reply.outcome).toBe("retrieval-refused")
  })
})
