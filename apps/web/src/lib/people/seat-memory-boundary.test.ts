import type { MemoryRecordType } from "@prisma/client"
import {
  SHADOW_WINDOW,
  classifySeatMemory,
  inheritsToSuccessor,
  successorHandoffPacket,
  type SeatMemoryCard,
} from "./seat-memory-boundary"

/**
 * HCM-040-003. What an incoming seat holder inherits, and what stays with the
 * person who is leaving.
 *
 * Every assertion below is about a card the *shadow* holder can see today, in
 * the shipped application, and must not: the fixtures are the real
 * `MemoryRecordType` enum and the real `sensitivity` labels
 * (`lib/search.ts`'s `SENSITIVITY_LEVELS`, plus one label the build does not
 * know, because the column is a free `String`).
 */

const SEAT = "role_vp_finance"

function card(overrides: Partial<SeatMemoryCard> = {}): SeatMemoryCard {
  return {
    id: "mem_1",
    roleId: SEAT,
    type: "PLAYBOOK",
    sensitivity: "standard",
    ...overrides,
  }
}

/** Every type in the enum, so a ninth one cannot be added without a decision. */
const ALL_TYPES: readonly MemoryRecordType[] = [
  "CONTACT",
  "PLAYBOOK",
  "BUDGET",
  "VENDOR",
  "LESSON",
  "THREAD",
  "CREDENTIAL",
  "DEADLINE",
]

describe("classifySeatMemory", () => {
  it("treats the seat's working record as the seat's own", () => {
    for (const type of ALL_TYPES.filter((t) => t !== "CREDENTIAL")) {
      expect(classifySeatMemory(card({ type }))).toEqual({
        inheritance: "SEAT_RECORD",
        classification: null,
      })
    }
  })

  it("classifies a credential as controlled, whatever its label says", () => {
    expect(classifySeatMemory(card({ type: "CREDENTIAL" }))).toEqual({
      inheritance: "CONTROLLED",
      classification: "CREDENTIAL",
    })
    expect(
      classifySeatMemory(card({ type: "CREDENTIAL", sensitivity: "standard" })),
    ).toEqual({ inheritance: "CONTROLLED", classification: "CREDENTIAL" })
  })

  it("controls anything above standard, and does not invent which restriction it is", () => {
    // `restricted` is on the ladder; `board-eyes-only` is not, and ranks at the
    // most restrictive known level. Both are CONTROLLED with a null
    // classification: the column does not say WHICH restriction applies, and
    // guessing HR_RECORD or LEGAL_HOLD would let a policy be checked against an
    // invention.
    expect(classifySeatMemory(card({ sensitivity: "restricted" }))).toEqual({
      inheritance: "CONTROLLED",
      classification: null,
    })
    expect(classifySeatMemory(card({ sensitivity: "board-eyes-only" }))).toEqual({
      inheritance: "CONTROLLED",
      classification: null,
    })
  })

  it("treats an absent label as the schema default, which is standard", () => {
    expect(classifySeatMemory(card({ sensitivity: null }))).toEqual({
      inheritance: "SEAT_RECORD",
      classification: null,
    })
    expect(classifySeatMemory(card({ sensitivity: "" }))).toEqual({
      inheritance: "SEAT_RECORD",
      classification: null,
    })
  })

  it("refuses a type this build does not know rather than guessing", () => {
    // A row written by a newer migration, or by hand. "We could not classify
    // this" and "we classified it as harmless" must not be the same answer.
    const unknown = card({ type: "PERFORMANCE_REVIEW" as MemoryRecordType })
    expect(classifySeatMemory(unknown)).toEqual({
      inheritance: "CONTROLLED",
      classification: null,
    })
  })
})

describe("inheritsToSuccessor", () => {
  it("passes on the seat's working record", () => {
    const decision = inheritsToSuccessor(card({ type: "PLAYBOOK" }))
    expect(decision.action).toBe("TRANSFER")
    expect(decision.reason).toMatch(/seat's own record/)
  })

  it("never hands over a credential — it is reissued", () => {
    const decision = inheritsToSuccessor(card({ type: "CREDENTIAL" }))
    expect(decision.action).toBe("ROTATE")
    expect(decision.reason).toMatch(/rotated or reassigned/)
  })

  it("withholds a restricted card until a transition completes", () => {
    const decision = inheritsToSuccessor(card({ sensitivity: "restricted" }))
    expect(decision.action).toBe("WITHHOLD")
    // The reason names the missing step, not merely "no".
    expect(decision.reason).toMatch(/No transition workflow has completed/)
  })

  it("withholds every type once it is labelled above standard", () => {
    for (const type of ALL_TYPES) {
      expect(inheritsToSuccessor(card({ type, sensitivity: "restricted" })).action).not.toBe(
        "TRANSFER",
      )
    }
  })

  it("is decided in the shadow window, which is before the transition, not after", () => {
    // The context is asserted directly because it is the whole reason controlled
    // material is withheld: a future edit setting `transitionCompleted: true`
    // would release it, and that must not be able to happen quietly.
    expect(SHADOW_WINDOW.successorHoldsSeat).toBe(true)
    expect(SHADOW_WINDOW.transitionCompleted).toBe(false)
    expect(SHADOW_WINDOW.policy.releases).toEqual([])
  })
})

describe("successorHandoffPacket", () => {
  const cards: readonly SeatMemoryCard[] = [
    card({ id: "mem_playbook", type: "PLAYBOOK" }),
    card({ id: "mem_vendor", type: "VENDOR" }),
    card({ id: "mem_login", type: "CREDENTIAL" }),
    card({ id: "mem_case", type: "LESSON", sensitivity: "restricted" }),
    card({ id: "mem_sealed", type: "THREAD", sensitivity: "board-eyes-only" }),
  ]

  it("splits the seat's memory three ways and says why each one is there", () => {
    const packet = successorHandoffPacket(cards)
    expect(packet.transferred).toEqual(["mem_playbook", "mem_vendor"])
    expect(packet.rotated).toEqual(["mem_login"])
    expect(packet.withheld.map((w) => w.resourceId)).toEqual(["mem_case", "mem_sealed"])
    for (const withheld of packet.withheld) {
      expect(withheld.reason.length).toBeGreaterThan(20)
    }
  })

  it("accounts for every card exactly once", () => {
    const packet = successorHandoffPacket(cards)
    const counted =
      packet.transferred.length + packet.rotated.length + packet.withheld.length
    expect(counted).toBe(cards.length)
  })

  it("is empty for a seat with no memory, rather than throwing", () => {
    expect(successorHandoffPacket([])).toEqual({
      transferred: [],
      rotated: [],
      withheld: [],
    })
  })
})
