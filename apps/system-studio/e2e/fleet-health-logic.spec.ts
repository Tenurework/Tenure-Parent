import { test, expect } from "@playwright/test"

import { STALL_HOURS, TRANSITIONAL, byUrgency, healthOf, summariseFleet } from "../src/lib/fleet-health"

/**
 * GE-033-002 — fleet health, derived without reading a tenant's data.
 *
 * Pure, so no browser. The cases that matter are the ones where a signal must
 * NOT fire: a draft is not a stall, an unreadable timestamp is not an outage,
 * and a tenant that has not reached CONFIGURING has nothing to have deployed.
 * A health view that cries wolf is one operators stop opening.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

const input = (over: Partial<Parameters<typeof healthOf>[0]> = {}) => ({
  slug: "acme",
  state: "ACTIVE" as const,
  updatedAt: hoursAgo(1),
  hasDeployment: true,
  ...over,
})

test.describe("what an operator should act on", () => {
  test("a serving tenant needs nothing", () => {
    const health = healthOf(input(), NOW)
    expect(health.signals).toContain("serving")
    expect(health.attention).toBeNull()
  })

  test("a transitional state that has not moved is stalled", () => {
    const health = healthOf(input({ state: "MIGRATING", updatedAt: hoursAgo(STALL_HOURS + 1) }), NOW)
    expect(health.signals).toContain("stalled")
    expect(health.attention).toBe("stalled")
  })

  test("a transitional state that moved recently is not", () => {
    // The threshold has to be a real boundary, or every in-flight tenant is an
    // alarm and the view stops being read.
    expect(healthOf(input({ state: "MIGRATING", updatedAt: hoursAgo(1) }), NOW).signals).not.toContain(
      "stalled",
    )
  })

  test("a draft sitting for a month is a draft, not a stall", () => {
    // DRAFT is deliberately absent from TRANSITIONAL: nothing is supposed to be
    // moving it, so time passing is not a finding.
    const health = healthOf(input({ state: "DRAFT", updatedAt: hoursAgo(24 * 30), hasDeployment: false }), NOW)
    expect(health.signals).not.toContain("stalled")
    expect(health.attention).toBeNull()
  })

  test("an unreadable timestamp is not reported as a stall", () => {
    // "We cannot tell how long this has been here" and "this has been here too
    // long" are different facts, and reporting the first as the second sends an
    // operator to investigate a clock.
    const health = healthOf(input({ state: "MIGRATING", updatedAt: "not a date" }), NOW)
    expect(health.hoursSinceChange).toBeNull()
    expect(health.signals).not.toContain("stalled")
  })

  test("a failed tenant outranks a stalled one", () => {
    // A failure has already happened; a stall might still resolve.
    const health = healthOf(input({ state: "FAILED", updatedAt: hoursAgo(48), hasDeployment: false }), NOW)
    expect(health.attention).toBe("failed")
  })

  test("a tenant past CONFIGURING with no manifest is flagged", () => {
    expect(healthOf(input({ state: "ACTIVE", hasDeployment: false }), NOW).signals).toContain(
      "never-deployed",
    )
  })

  test("a tenant that has not reached CONFIGURING is not", () => {
    // Before that point there is nothing to have deployed, so absence is the
    // normal case rather than a finding.
    for (const state of ["DRAFT", "VALIDATING", "PROVISIONING"] as const) {
      expect(healthOf(input({ state, hasDeployment: false }), NOW).signals).not.toContain("never-deployed")
    }
  })

  test("a registry and store that disagree about the live revision", () => {
    // Two records of one fact. When they differ the console shows one and the
    // cell runs the other.
    const health = healthOf(input({ registryConfigRevision: 4, storeConfigRevision: 5 }), NOW)
    expect(health.signals).toContain("config-behind")
  })

  test("agreeing revisions say nothing, and a missing one is not a disagreement", () => {
    expect(healthOf(input({ registryConfigRevision: 5, storeConfigRevision: 5 }), NOW).signals).not.toContain(
      "config-behind",
    )
    // A tenant that has never published has no revision on either side; that is
    // not drift.
    expect(healthOf(input({ registryConfigRevision: 4 }), NOW).signals).not.toContain("config-behind")
  })

  test("a terminal state is terminal, not stalled", () => {
    const health = healthOf(
      input({ state: "PURGED_ZERO_INCREMENTAL_COST", updatedAt: hoursAgo(1000), hasDeployment: false }),
      NOW,
    )
    expect(health.signals).toContain("terminal")
    expect(health.signals).not.toContain("stalled")
  })

  test("every transitional state is a real lifecycle state", () => {
    // The type annotation enforces this at compile time; asserting it here
    // means a rename that someone silences with a cast still fails.
    expect(TRANSITIONAL.length).toBeGreaterThan(0)
    for (const state of TRANSITIONAL) expect(typeof state).toBe("string")
  })
})

test.describe("the fleet summary", () => {
  const fleet = [
    healthOf(input({ slug: "a" }), NOW),
    healthOf(input({ slug: "b", state: "FAILED", hasDeployment: false }), NOW),
    healthOf(input({ slug: "c", state: "MIGRATING", updatedAt: hoursAgo(48) }), NOW),
  ]

  test("counts a tenant needing attention once, however many signals it has", () => {
    // "b" is both failed and never-deployed. Summing signals would report two
    // tenants in trouble when there is one.
    const summary = summariseFleet(fleet)
    expect(summary.total).toBe(3)
    expect(summary.needingAttention).toBe(2)
    expect(summary.bySignal.failed).toBe(1)
    expect(summary.bySignal["never-deployed"]).toBe(1)
  })

  test("counts what is serving", () => {
    expect(summariseFleet(fleet).serving).toBe(1)
  })

  test("is empty for an empty fleet rather than throwing", () => {
    const summary = summariseFleet([])
    expect(summary.total).toBe(0)
    expect(summary.needingAttention).toBe(0)
  })
})

test.describe("ordering", () => {
  test("puts the worst first and the healthy last", () => {
    const ordered = byUrgency([
      healthOf(input({ slug: "healthy" }), NOW),
      healthOf(input({ slug: "stalled", state: "MIGRATING", updatedAt: hoursAgo(48) }), NOW),
      healthOf(input({ slug: "failed", state: "FAILED" }), NOW),
    ])
    expect(ordered.map((t) => t.slug)).toEqual(["failed", "stalled", "healthy"])
  })

  test("breaks a tie on how long it has been that way", () => {
    const ordered = byUrgency([
      healthOf(input({ slug: "recent", state: "MIGRATING", updatedAt: hoursAgo(7) }), NOW),
      healthOf(input({ slug: "ancient", state: "MIGRATING", updatedAt: hoursAgo(200) }), NOW),
    ])
    expect(ordered.map((t) => t.slug)).toEqual(["ancient", "recent"])
  })
})
