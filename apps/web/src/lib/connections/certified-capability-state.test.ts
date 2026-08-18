/**
 * WRK-030-005 — the DERIVATION of `certified`, asserted in both directions.
 *
 * ## The hole this closes
 *
 * `resolveCapability` refuses a connect action when `certified` is false, and
 * `capability-resolution.test.ts` proves that thoroughly. But that suite builds
 * its own `certified` and contains no occurrence of `certifiedCapabilityState`
 * or `FIRST_PARTY` at all — so the function that DECIDES the flag every shipped
 * surface spreads had no unit test. Inverting its fail-closed default,
 *
 *     return { key, certified: FIRST_PARTY.includes(key) }
 *   → return { key, certified: true }
 *
 * left `npx jest src/lib/connections src/app/api/ai` at 134 passed / 0 failed.
 * The practical consequence is exactly the requirement's own sentence: the next
 * capability key added — a new provider, or a typo in an existing one — would
 * default to certified and grow a working-looking Connect button for something
 * `/api/ai/chat` will refuse, with the whole suite green.
 *
 * The lexical guard `tests/architecture/certified-is-derived.test.mjs` does not
 * cover it either: its rule is "no `certified:` literal in a `.tsx`", which is
 * the call-site failure, not the derivation's own default.
 *
 * ## What is asserted, and why it is not a restatement of the table
 *
 * Three branches, one test each, and the CONSEQUENCE of each carried through
 * `resolveCapability` so the flag is not asserted in isolation:
 *
 *   1. a first-party key — Tenure's own infrastructure, no provider to review;
 *   2. a provider-reviewed key — the verdict comes from `providerActivation`
 *      reading the real `RELAY_ANTHROPIC_REVIEW`, not from a fixture;
 *   3. a key in NEITHER list — false, because a capability nobody has
 *      classified is one nobody has certified.
 *
 * Nothing here measures anything off this machine.
 */

import { RELAY_ANTHROPIC_REVIEW } from "@tenure/platform-config"

import {
  capabilityAdministrators,
  certifiedCapabilityState,
  resolveCapability,
  type CapabilityState,
} from "@/lib/connections/capability-resolution"

/** The instant every verdict below is decided against. */
const AT = "2026-08-07T00:00:00.000Z"

/**
 * The capabilities Tenure serves from its own infrastructure, written out
 * rather than imported: `FIRST_PARTY` is module-private, and a test that read
 * the list back would be the list asserting that it equals itself.
 */
const FIRST_PARTY_KEYS = ["documents.storage", "calendar.feed", "identity.sso"] as const

/**
 * Keys nobody has classified. Three shapes of the same mistake: a plausible new
 * provider, a typo in a real key, and the empty string a mis-wired call site
 * would pass.
 */
const UNCLASSIFIED_KEYS = ["slack.messages", "calendar.feeds", "documents.storge", ""] as const

/** A connect-shaped state, so only the flag can decide the outcome. */
function stateFor(key: string, certified: boolean): CapabilityState {
  return {
    key,
    label: "Some capability",
    certified,
    configured: false,
    reachable: true,
    connectableBy: "user",
    requiredScopes: [],
    grantedScopes: [],
    credential: null,
    ...capabilityAdministrators(key),
    alternative: null,
  }
}

describe("certifiedCapabilityState decides the flag, in both directions", () => {
  it.each(FIRST_PARTY_KEYS)(
    "certifies %s, because Tenure runs it and no provider has an opinion",
    (key) => {
      expect(certifiedCapabilityState(key, AT)).toEqual({ key, certified: true })
    },
  )

  it.each(UNCLASSIFIED_KEYS)(
    "refuses to certify %p, because nobody has classified it",
    (key) => {
      // The fail-closed default. A capability absent from both lists is one
      // nobody has certified, and the cost of being wrong in the other
      // direction is a Connect button that cannot work.
      expect(certifiedCapabilityState(key, AT)).toEqual({ key, certified: false })
    },
  )

  it("reads the real provider review for the one capability that has one", () => {
    // Not a fixture: the verdict tracks `RELAY_ANTHROPIC_REVIEW`, whose state is
    // NOT_SUBMITTED, which is why `/api/ai/chat` refuses the vendor call. If a
    // real review is ever recorded, this assertion changes with it rather than
    // pinning a stale answer.
    expect(RELAY_ANTHROPIC_REVIEW.state).toBe("NOT_SUBMITTED")
    expect(certifiedCapabilityState("ai.model", AT)).toEqual({
      key: "ai.model",
      certified: false,
    })
  })

  it("returns the key it was asked about, so no call site can pair two capabilities", () => {
    // The whole reason this is a fragment to spread rather than a bare boolean.
    for (const key of [...FIRST_PARTY_KEYS, ...UNCLASSIFIED_KEYS, "ai.model"]) {
      expect(certifiedCapabilityState(key, AT).key).toBe(key)
    }
  })
})

describe("what the derivation costs a surface that gets it wrong", () => {
  it("an unclassified key yields no connect control, end to end", () => {
    // The requirement's own sentence, exercised through the resolver rather
    // than stopping at the flag: an uncertified capability must never produce a
    // working-looking OAuth button.
    for (const key of UNCLASSIFIED_KEYS) {
      const derived = certifiedCapabilityState(key, AT)
      const resolved = resolveCapability(stateFor(key, derived.certified))
      expect(resolved.outcome).toBe("NOT_CERTIFIED")
      expect(resolved.action.kind).toBe("none")
      expect(resolved.action.label).toBe("")
      expect(resolved.statusWord).toBe("Not available yet")
    }
  })

  it("a first-party key does reach a connect control, so the default is not vacuous", () => {
    // The other direction matters: a derivation that returned false for
    // everything would pass every assertion above and take the platform's own
    // capabilities off the air. `calendar.feed` is the viewer's own to connect.
    const derived = certifiedCapabilityState("calendar.feed", AT)
    expect(derived.certified).toBe(true)
    const resolved = resolveCapability(stateFor("calendar.feed", derived.certified))
    expect(resolved.outcome).not.toBe("NOT_CERTIFIED")
    expect(resolved.action.kind).toBe("connect")
  })
})
