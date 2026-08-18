/**
 * GE-103-013, on the console — the panel is driven by what the Parent actually
 * holds, and says so where it holds nothing.
 *
 * This is the wiring test. The gate itself is proven in
 * `packages/provisioning/src/purge-exit.test.ts`; what is asserted here is that
 * the console supplies it real facts and no invented ones, and that a check
 * nobody can answer is never rendered as one that passed.
 */
import { describe, expect, it } from "@jest/globals"

import type { TenantState } from "@tenure/provisioning"

import {
  PURGE_FACT_SOURCES,
  purgeFactsFromRegistry,
  purgeReadiness,
  purgeRequestedAt,
  type PurgeHistoryStep,
} from "./purge-readiness"

const NOW = "2026-08-17T12:00:00.000Z"
const OPERATOR = "dana@tenure.example"

const history = (...steps: Array<[TenantState, string, string]>): PurgeHistoryStep[] =>
  steps.map(([to, at, actor]) => ({ to, at, actor }))

const inputs = (over: Partial<{ slug: string; state: TenantState; history: PurgeHistoryStep[] }> = {}) => ({
  slug: "midtown-arts",
  state: "PURGE_PENDING" as TenantState,
  history: history(
    ["ACTIVE", "2024-09-01T00:00:00.000Z", OPERATOR],
    ["OFFBOARDING", "2026-08-01T00:00:00.000Z", OPERATOR],
    ["PURGE_PENDING", "2026-08-17T09:00:00.000Z", OPERATOR],
  ),
  ...over,
})

describe("the console supplies only what the registry holds", () => {
  it("supplies the legal hold from the lifecycle state, because that is where a hold lives", () => {
    expect(purgeFactsFromRegistry(inputs()).legalHold).toEqual({ active: false })
    expect(purgeFactsFromRegistry(inputs({ state: "LEGAL_HOLD" })).legalHold).toEqual({ active: true })
  })

  it("supplies the cooling-off clock from the persisted transition into PURGE_PENDING", () => {
    expect(purgeFactsFromRegistry(inputs()).coolingOff).toEqual({
      requestedAt: "2026-08-17T09:00:00.000Z",
      requestedBy: OPERATOR,
    })
  })

  it("takes the LATEST ask when a tenant has been here before", () => {
    // A tenant can leave PURGE_PENDING for LEGAL_HOLD and come back. Running the
    // cooling-off from an abandoned ask months ago would make it already
    // elapsed on the day somebody asks again.
    const repeated = inputs({
      history: history(
        ["PURGE_PENDING", "2026-01-01T00:00:00.000Z", OPERATOR],
        ["LEGAL_HOLD", "2026-01-02T00:00:00.000Z", OPERATOR],
        ["PURGE_PENDING", "2026-08-17T11:59:00.000Z", OPERATOR],
      ),
    })
    expect(purgeRequestedAt(repeated.history)?.at).toBe("2026-08-17T11:59:00.000Z")
    expect(purgeReadiness(repeated, NOW).rows.find((r) => r.check === "cooling-off")?.verdict).toBe(
      "blocked",
    )
  })

  it("supplies no cooling-off at all for a tenant that never asked", () => {
    const never = inputs({ state: "ACTIVE", history: history(["ACTIVE", "2024-09-01T00:00:00.000Z", OPERATOR]) })
    expect(purgeFactsFromRegistry(never).coolingOff).toBeUndefined()
    expect(purgeReadiness(never, NOW).rows.find((r) => r.check === "cooling-off")?.verdict).toBe(
      "unknown",
    )
  })

  it("invents nothing — the four facts no store holds are absent, not blank", () => {
    const facts = purgeFactsFromRegistry(inputs())
    expect(facts.exportOutcome).toBeUndefined()
    expect(facts.contract).toBeUndefined()
    expect(facts.retention).toBeUndefined()
    expect(facts.tax).toBeUndefined()
    expect(facts.audit).toBeUndefined()
    // And no approval, because the C7 approval is recorded on the transition
    // this panel exists to precede.
    expect(facts.approval).toBeUndefined()
  })
})

describe("what cannot be answered is never rendered as answered", () => {
  it("reports the five unanswerable checks as unknown, and never as satisfied", () => {
    const readiness = purgeReadiness(inputs(), NOW)
    const unknown = readiness.rows.filter((r) => r.verdict === "unknown").map((r) => r.check)
    expect(unknown.sort()).toEqual(["audit", "contract", "export", "retention", "tax"])
    expect(readiness.rows.some((r) => r.verdict === "satisfied" && unknown.includes(r.check))).toBe(
      false,
    )
  })

  it("answers exactly the two the registry genuinely knows", () => {
    const readiness = purgeReadiness(inputs(), NOW)
    expect(readiness.answerable).toBe(2)
    expect(
      readiness.rows.filter((r) => r.verdict !== "unknown").map((r) => r.check).sort(),
    ).toEqual(["cooling-off", "legal-hold"])
  })

  it("never reports a tenant as clear", () => {
    // Not an accident of this fixture: nothing in the platform can supply four
    // of the seven facts, so no tenant can clear until those stores exist.
    for (const state of ["ACTIVE", "PURGE_PENDING", "LEGAL_HOLD"] as TenantState[]) {
      expect(purgeReadiness(inputs({ state }), NOW).clearance.cleared).toBe(false)
    }
  })

  it("names the store that would have to exist for each unanswerable check", () => {
    const readiness = purgeReadiness(inputs(), NOW)
    for (const row of readiness.rows.filter((r) => r.verdict === "unknown")) {
      expect(row.needs).not.toBeNull()
      expect(row.needs?.length).toBeGreaterThan(20)
    }
    // And says nothing is needed for the two it can answer.
    expect(readiness.rows.find((r) => r.check === "legal-hold")?.needs).toBeNull()
    expect(readiness.rows.find((r) => r.check === "cooling-off")?.needs).toBeNull()
  })

  it("declares a source for every check the gate declares", () => {
    const readiness = purgeReadiness(inputs(), NOW)
    expect(PURGE_FACT_SOURCES.map((s) => s.check).sort()).toEqual(
      readiness.rows.map((r) => r.check).sort(),
    )
    for (const row of readiness.rows) {
      expect(row.holds).not.toBe("No source is declared for this check.")
    }
  })

  it("says how many of the seven are answerable rather than calling it a pass rate", () => {
    const readiness = purgeReadiness(inputs(), NOW)
    expect(readiness.headline).toContain("2 of 7 pre-purge checks can be answered")
    expect(readiness.headline).toContain("An unanswerable check is not a passed one")
  })

  it("is deterministic — the same tenant and instant render identically", () => {
    expect(JSON.stringify(purgeReadiness(inputs(), NOW))).toBe(
      JSON.stringify(purgeReadiness(inputs(), NOW)),
    )
  })
})
