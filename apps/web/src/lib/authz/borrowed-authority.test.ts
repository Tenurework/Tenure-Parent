import { mayBorrowAuthority } from "./borrowed-authority"

/**
 * WF-16 finding: a backup approver could approve their own request.
 */

describe("borrowed authority on your own request", () => {
  it("lets a backup act on somebody else's request", () => {
    // Without this every refusal below could come from a rule that refuses
    // everybody, and delegation would be broken rather than fixed.
    expect(mayBorrowAuthority({ actorId: "bob", requestedByPrincipalId: "maya" }).ok).toBe(true)
  })

  it("refuses a backup acting on their own request", () => {
    const outcome = mayBorrowAuthority({ actorId: "bob", requestedByPrincipalId: "bob" })
    expect(outcome.ok).toBe(false)
    expect(outcome.refusal).toBe("OWN_REQUEST")
    expect(outcome.detail).toMatch(/not the standing to use it on yourself/)
  })

  it("fails closed when the author cannot be established", () => {
    // The one case where "is this your own?" has no answer, and handing over
    // borrowed authority while that is true is the wrong direction to guess in.
    for (const requestedByPrincipalId of [null, undefined, ""]) {
      const outcome = mayBorrowAuthority({ actorId: "bob", requestedByPrincipalId })
      expect(outcome.ok).toBe(false)
      expect(outcome.refusal).toBe("UNKNOWN_REQUESTER")
    }
  })

  it("gives every refusal something a reader can act on", () => {
    for (const requestedByPrincipalId of ["bob", null]) {
      expect(
        (mayBorrowAuthority({ actorId: "bob", requestedByPrincipalId }).detail ?? "").length,
      ).toBeGreaterThan(30)
    }
  })
})
