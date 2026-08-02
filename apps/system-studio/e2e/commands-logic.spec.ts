import { test, expect } from "@playwright/test"

import {
  RECENT_LIMIT,
  STATIC_DESTINATIONS,
  moveSelection,
  rank,
  remember,
  score,
  tenantDestination,
  togglePin,
} from "../src/lib/commands"

/**
 * GE-022-007 — the launcher's ranking, recents and pins.
 *
 * Pure, so no browser. This is the half most likely to be quietly wrong: a
 * launcher that puts the right answer third still "works", and is one people
 * stop using without ever reporting a bug.
 */

const ALL = [
  ...STATIC_DESTINATIONS,
  tenantDestination("simon-ose", "Simon Business School OSE"),
  tenantDestination("platinum-corp", "Platinum Corp"),
  tenantDestination("aws-co", "AWS Migration Co"),
]

test.describe("ranking puts the obvious answer first", () => {
  test("a prefix of the title beats a prefix inside it", () => {
    // Typing "pl" means Platform, not Platinum Corp — both start a word with
    // "pl", and only one starts the title.
    const [first] = rank(ALL, "pl", [])
    expect(first.id).toBe("platform")
  })

  test("a title match beats a keyword match", () => {
    // "Tenants" the section, not the tenant whose keyword happens to contain it.
    expect(rank(ALL, "tenan", [])[0].id).toBe("tenants")
  })

  test("a tenant is reachable by slug, which is what an operator types", () => {
    expect(rank(ALL, "simon-ose", [])[0].id).toBe("tenant:simon-ose")
  })

  test("universal create is reachable by intent, not only by name", () => {
    // Nobody types "compose". Bible §26.3.1 lists universal create beside
    // command search precisely because making something is a common reason to
    // open a launcher at all.
    for (const word of ["new", "add", "provision", "create"]) {
      expect(rank(ALL, word, [])[0].id).toBe("create-tenant")
    }
  })

  test("no match returns nothing rather than everything", () => {
    // A launcher that falls back to the full list on a typo puts an unrelated
    // destination under an Enter key the operator is already pressing.
    expect(rank(ALL, "zzzz", [])).toEqual([])
    expect(score(STATIC_DESTINATIONS[0], "zzzz")).toBeNull()
  })

  test("an empty query lists everything, most recent first", () => {
    const ranked = rank(ALL, "", ["platform", "tenant:simon-ose"])
    // "platform" was visited most recently, so it leads.
    expect(ranked[0].id).toBe("platform")
    expect(ranked[1].id).toBe("tenant:simon-ose")
    expect(ranked.length).toBe(ALL.length)
  })

  test("recency breaks a genuine tie", () => {
    // "Platform" and "Platinum Corp" BOTH start their title with "pl" — a real
    // tie, and array position is the wrong way to settle it. My first version
    // of this test asserted Platform wins and was simply wrong about the
    // scores; the code was right.
    expect(score(ALL.find((d) => d.id === "platform")!, "pl")).toBe(
      score(ALL.find((d) => d.id === "tenant:platinum-corp")!, "pl"),
    )
    expect(rank(ALL, "pl", ["tenant:platinum-corp"])[0].id).toBe("tenant:platinum-corp")
  })

  test("recency does not promote a worse match", () => {
    // The limit on the rule above. "aws" is a title prefix for the tenant and
    // only a keyword for Platform, so no amount of recency should reorder them
    // — a launcher whose top hit depends on history rather than on what was
    // typed is one nobody can predict.
    expect(rank(ALL, "aws", ["platform"])[0].id).toBe("tenant:aws-co")
  })

  test("a pin outranks a better text match", () => {
    // A pin is an explicit statement about what matters; a score is a guess.
    expect(rank(ALL, "pl", [], ["tenant:platinum-corp"])[0].id).toBe("tenant:platinum-corp")
  })
})

test.describe("recents", () => {
  test("most recent first, without duplicates", () => {
    let recent = remember([], "a")
    recent = remember(recent, "b")
    recent = remember(recent, "a")
    expect(recent).toEqual(["a", "b"])
  })

  test("is bounded, or it stops being recent", () => {
    let recent: readonly string[] = []
    for (let i = 0; i < RECENT_LIMIT + 4; i++) recent = remember(recent, `d${i}`)
    expect(recent.length).toBe(RECENT_LIMIT)
    // The oldest fell off the end, not the newest.
    expect(recent[0]).toBe(`d${RECENT_LIMIT + 3}`)
    expect(recent).not.toContain("d0")
  })

  test("does not mutate what it was given", () => {
    // The caller renders from the old array while persisting the new one.
    const before = ["a"]
    remember(before, "b")
    expect(before).toEqual(["a"])
  })
})

test.describe("pins", () => {
  test("toggle on and off", () => {
    expect(togglePin([], "a")).toEqual(["a"])
    expect(togglePin(["a"], "a")).toEqual([])
  })

  test("are unbounded, because an operator who pins twenty things meant to", () => {
    let pinned: readonly string[] = []
    for (let i = 0; i < 20; i++) pinned = togglePin(pinned, `p${i}`)
    expect(pinned.length).toBe(20)
  })
})

test.describe("keyboard selection", () => {
  test("wraps at both ends", () => {
    expect(moveSelection(2, 3, 1)).toBe(0)
    expect(moveSelection(0, 3, -1)).toBe(2)
  })

  test("returns 0 on an empty list, not -1", () => {
    // -1 into an empty list and 0 into an empty list look identical until the
    // list refills, at which point only one of them is still right.
    expect(moveSelection(0, 0, 1)).toBe(0)
    expect(moveSelection(0, 0, -1)).toBe(0)
  })
})
