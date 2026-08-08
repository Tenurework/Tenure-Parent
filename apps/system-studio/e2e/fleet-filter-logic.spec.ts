import { test, expect } from "@playwright/test"

import {
  EMPTY_FILTER,
  describeFilter,
  isFiltered,
  matchesFilter,
  parseFleetFilter,
  type FilterableTenant,
} from "../src/lib/fleet-filter"
import { healthOf } from "../src/lib/fleet-health"

/**
 * STUDIO-100-002 — the fleet filter, exercised without a browser or a table.
 *
 * `fleet-filter.ts` cited this file before it existed, which is exactly the kind
 * of claim the repository's own rules forbid: a comment asserting a proof that
 * nobody had written. It exists now, and it is worth having on its own terms —
 * the filter is applied in TWO places (the fleet page and the CSV export route)
 * and the only thing stopping an export from carrying rows the screen said were
 * hidden is that both call this one predicate.
 *
 * The browser-level half — that `?signal=` actually changes what `/tenants`
 * renders, and that the export drops a tenant this operator may not read — is in
 * `fleet-surface.spec.ts`, because those are properties of the PRODUCER and a
 * test that called the helper directly would stay green if the page stopped
 * calling it.
 */

const row = (over: Partial<FilterableTenant> = {}): FilterableTenant => ({
  slug: "acme-university",
  displayName: "Acme University",
  state: "ACTIVE",
  owner: "dean@acme.example",
  planId: "growth",
  cellId: "cell-us-east-1-a",
  ...over,
})

test.describe("reading a filter out of the URL", () => {
  test("an absent query is the empty filter and constrains nothing", () => {
    const filter = parseFleetFilter({})
    expect(filter).toEqual(EMPTY_FILTER)
    expect(isFiltered(filter)).toBe(false)
    expect(matchesFilter(row(), filter, undefined)).toBe(true)
  })

  test("free text is lowercased so the match is case-insensitive", () => {
    expect(parseFleetFilter({ q: "  ACME  " }).q).toBe("acme")
    expect(matchesFilter(row(), parseFleetFilter({ q: "ACME" }), undefined)).toBe(true)
  })

  test("a state is uppercased, because the registry stores it that way", () => {
    expect(parseFleetFilter({ state: "active" }).state).toBe("ACTIVE")
    expect(matchesFilter(row(), parseFleetFilter({ state: "active" }), undefined)).toBe(true)
    expect(matchesFilter(row(), parseFleetFilter({ state: "draft" }), undefined)).toBe(false)
  })

  test("an unrecognised signal is dropped rather than made to match nothing", () => {
    // The alternative — keeping `?signal=banana` and matching zero tenants —
    // renders identically to a fleet that is empty, which is the confusion the
    // empty states exist to prevent.
    const filter = parseFleetFilter({ signal: "banana" })
    expect(filter.signal).toBeNull()
    expect(isFiltered(filter)).toBe(false)
  })

  test("a repeated parameter takes the first value rather than throwing", () => {
    expect(parseFleetFilter({ q: ["acme", "beta"] }).q).toBe("acme")
  })
})

test.describe("what the filter selects", () => {
  test("free text reaches owner, plan and cell, not only the slug", () => {
    const f = (q: string) => parseFleetFilter({ q })
    expect(matchesFilter(row(), f("dean@acme"), undefined)).toBe(true)
    expect(matchesFilter(row(), f("growth"), undefined)).toBe(true)
    expect(matchesFilter(row(), f("us-east-1"), undefined)).toBe(true)
    expect(matchesFilter(row(), f("nothing-like-this"), undefined)).toBe(false)
  })

  test("a tenant with no owner or plan is searchable, not a crash", () => {
    const sparse = row({ owner: null, planId: null, cellId: null })
    expect(matchesFilter(sparse, parseFleetFilter({ q: "acme" }), undefined)).toBe(true)
    expect(matchesFilter(sparse, parseFleetFilter({ q: "growth" }), undefined)).toBe(false)
  })

  /*
   * The direction a filtering mistake must never go.
   *
   * `?signal=stalled` over a caller that could not compute health has to match
   * NOTHING. Matching everything would hand an operator narrowing to "what is
   * broken" the entire fleet and let them believe all of it was broken — and
   * that is the arm the CSV export route actually takes, because it does not
   * make the two AWS observation calls the page makes.
   */
  test("a signal filter with no health matches nothing, never everything", () => {
    expect(matchesFilter(row(), parseFleetFilter({ signal: "stalled" }), undefined)).toBe(false)
  })

  test("a signal filter selects on the health the page computed", () => {
    const at = new Date("2026-08-01T00:00:00.000Z")
    // Built through `healthOf` rather than by hand: the signal names are the
    // producer's, so a rename breaks this test instead of silently making the
    // filter select nothing.
    const neverDeployed = healthOf(
      {
        slug: "acme-university",
        state: "ACTIVE",
        updatedAt: at.toISOString(),
        hasDeployment: false,
        observations: [],
      },
      at,
    )
    expect(neverDeployed.signals).toContain("never-deployed")

    expect(
      matchesFilter(row(), parseFleetFilter({ signal: "never-deployed" }), neverDeployed),
    ).toBe(true)
    expect(matchesFilter(row(), parseFleetFilter({ signal: "stalled" }), neverDeployed)).toBe(false)
  })

  test("the three clauses are AND, not OR", () => {
    const filter = parseFleetFilter({ q: "acme", state: "DRAFT" })
    expect(matchesFilter(row(), filter, undefined)).toBe(false)
    expect(matchesFilter(row({ state: "DRAFT" }), filter, undefined)).toBe(true)
  })
})

test("the filter can say what it is, so a short table can explain itself", () => {
  expect(describeFilter(parseFleetFilter({ q: "acme", signal: "never-deployed", state: "active" })))
    .toBe('matching "acme", with the never deployed signal, in ACTIVE')
  expect(describeFilter(EMPTY_FILTER)).toBe("")
})
