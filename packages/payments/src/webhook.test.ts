import { createHmac } from "node:crypto"

import { DEFAULT_TOLERANCE_MS, dedupe, verifySignature, type ReceivedEvent } from "./webhook"

/**
 * PAY-140-008. Forged signatures, secret rotation, duplicates, reordering and
 * stale timestamps — the five cases that were previously unreachable because no
 * endpoint existed to receive an event at all.
 */

const NOW = Date.parse("2026-08-07T12:00:00.000Z")
const BODY = '{"id":"evt_1","type":"account.updated","data":{"object":{"id":"acct_1"}}}'
const OLD_SECRET = "whsec_rotating_out"
const NEW_SECRET = "whsec_rotating_in"

function header(secret: string, atMs: number = NOW, body: string = BODY): string {
  const t = Math.floor(atMs / 1000)
  const signature = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")
  return `t=${t},v1=${signature}`
}

describe("a forged signature is refused", () => {
  it("refuses a signature computed with a secret nobody supplied", () => {
    // MUTATION TARGET: skipping the HMAC comparison reds this.
    const result = verifySignature(BODY, header("whsec_attacker"), [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("signature-mismatch")
  })

  it("refuses a signature of the wrong length WITHOUT throwing", () => {
    // MUTATION TARGET: calling timingSafeEqual unguarded reds this — it throws
    // on a length mismatch, and a routine forgery would become a 500 with a
    // stack trace in the logs rather than a refusal.
    const result = verifySignature(BODY, `t=${Math.floor(NOW / 1000)},v1=deadbeef`, [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("signature-mismatch")
  })

  it("refuses when the body was altered after signing", () => {
    const signed = header(NEW_SECRET, NOW, BODY)
    const tampered = BODY.replace("acct_1", "acct_2")
    const result = verifySignature(tampered, signed, [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
  })

  it("refuses when no secret is supplied at all", () => {
    const result = verifySignature(BODY, header(NEW_SECRET), [], NOW)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("signature-no-candidates")
  })

  it("refuses a header with no timestamp and one with no signature", () => {
    const codes: string[] = []
    for (const raw of ["v1=abc", `t=${Math.floor(NOW / 1000)}`, "t=soon,v1=abc"]) {
      const result = verifySignature(BODY, raw, [NEW_SECRET], NOW)
      if (!result.ok) codes.push(result.code)
    }
    expect(codes).toEqual([
      "signature-timestamp-missing",
      "signature-header-malformed",
      "signature-header-malformed",
    ])
  })
})

describe("the rotation window accepts two secrets", () => {
  it("accepts an event still signed with the outgoing secret", () => {
    // MUTATION TARGET: verifying against secrets[0] only reds this, which is
    // what makes every rotation an outage and is why rotations get skipped.
    const result = verifySignature(BODY, header(OLD_SECRET), [NEW_SECRET, OLD_SECRET], NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.matchedSecretIndex).toBe(1)
  })

  it("accepts one signed with the incoming secret and says which matched", () => {
    const result = verifySignature(BODY, header(NEW_SECRET), [NEW_SECRET, OLD_SECRET], NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.matchedSecretIndex).toBe(0)
  })

  it("refuses once the outgoing secret has left the window", () => {
    const result = verifySignature(BODY, header(OLD_SECRET), [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
  })
})

describe("the replay window", () => {
  it("refuses a correctly signed event from outside the tolerance", () => {
    // MUTATION TARGET: dropping the tolerance check reds this. Without it a
    // captured event stays valid forever.
    const stale = NOW - DEFAULT_TOLERANCE_MS - 1000
    const result = verifySignature(BODY, header(NEW_SECRET, stale), [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("signature-timestamp-outside-tolerance")
  })

  it("refuses one from too far in the FUTURE as well", () => {
    const ahead = NOW + DEFAULT_TOLERANCE_MS + 1000
    const result = verifySignature(BODY, header(NEW_SECRET, ahead), [NEW_SECRET], NOW)
    expect(result.ok).toBe(false)
  })

  it("accepts one inside the window and reports its timestamp", () => {
    const recent = NOW - 60_000
    const result = verifySignature(BODY, header(NEW_SECRET, recent), [NEW_SECRET], NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.timestampMs).toBe(Math.floor(recent / 1000) * 1000)
  })
})

describe("dedupe against the persisted receipts", () => {
  const seen: ReceivedEvent[] = [
    { provider: "stripe", mode: "live", accountId: "acct_1", eventId: "evt_1", sequence: 1 },
    { provider: "stripe", mode: "live", accountId: "acct_1", eventId: "evt_2", sequence: 2 },
  ]

  it("calls a never-seen event with a higher sequence new", () => {
    expect(
      dedupe(
        { provider: "stripe", mode: "live", accountId: "acct_1", eventId: "evt_3", sequence: 3 },
        seen,
      ),
    ).toBe("new")
  })

  it("calls a redelivery duplicate, not out-of-order", () => {
    // A retry is BOTH — its sequence is behind the newest — and reporting it as
    // out-of-order would send every ordinary provider retry to an exception queue.
    expect(dedupe(seen[0], seen)).toBe("duplicate")
  })

  it("calls an unseen event with a stale sequence out-of-order", () => {
    expect(
      dedupe(
        { provider: "stripe", mode: "live", accountId: "acct_1", eventId: "evt_9", sequence: 2 },
        seen,
      ),
    ).toBe("out-of-order")
  })

  it("keeps test and live apart", () => {
    expect(
      dedupe({ ...seen[0], mode: "test" }, seen),
    ).toBe("new")
  })

  it("keeps two connected accounts apart", () => {
    expect(dedupe({ ...seen[0], accountId: "acct_2" }, seen)).toBe("new")
  })

  it("keeps two providers apart", () => {
    expect(dedupe({ ...seen[0], provider: "adyen" }, seen)).toBe("new")
  })

  it("calls the first event on an empty stream new whatever its sequence", () => {
    expect(dedupe({ ...seen[0], sequence: 0 }, [])).toBe("new")
  })
})
