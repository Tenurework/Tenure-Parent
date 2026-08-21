import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import { ALL_STATES, type TenantState } from "@tenure/provisioning"

import {
  FLEET_VIEWS,
  FLEET_VIEW_IDS,
  STATES_IN_NO_NAMED_VIEW,
  describeViewCount,
  fleetView,
  parseFleetView,
  viewCounts,
  viewVerdict,
  type FleetViewId,
  type ViewableTenant,
} from "../src/lib/fleet-views"
import type { HealthObservation, TenantHealth } from "../src/lib/fleet-health"

/**
 * GE-103-001 — the eleven views, without a browser, a table or an AWS call.
 *
 * The browser half — that the chips are rendered, that clicking one changes the
 * URL and that the export carries the same rows — belongs to `fleet-surface.spec.ts`,
 * because those are properties of the PRODUCER. What is here is every judgement
 * the views make, and the one that matters most is the third verdict: a drift
 * reading nobody took is not a tenant that has not drifted.
 */

const tenant = (over: Partial<ViewableTenant> = {}): ViewableTenant => ({
  slug: "acme-university",
  state: "ACTIVE",
  ...over,
})

const observation = (over: Partial<HealthObservation> = {}): HealthObservation => ({
  source: "drift",
  status: "ok",
  asOf: "2026-08-19T00:00:00.000Z",
  detail: "The estate matches the last applied stack.",
  ...over,
})

const health = (over: Partial<TenantHealth> = {}): TenantHealth => ({
  slug: "acme-university",
  state: "ACTIVE",
  signals: [],
  attention: null,
  hoursSinceChange: 1,
  residualCost: null,
  observations: [observation()],
  ...over,
})

const view = (id: FleetViewId) => {
  const found = fleetView(id)
  if (!found) throw new Error(`no view ${id}`)
  return found
}

test.describe("the eleven the requirement names", () => {
  test("is exactly eleven views, with the requirement's own names", () => {
    // The sentence: "active, idle, suspended, hibernated, reactivating,
    // offboarding, legal hold, purge pending, purged, failed, and drifted".
    expect(FLEET_VIEW_IDS).toEqual([
      "active",
      "idle",
      "suspended",
      "hibernated",
      "reactivating",
      "offboarding",
      "legal-hold",
      "purge-pending",
      "purged",
      "failed",
      "drifted",
    ])
  })

  test("no view is empty — every one either names states or is decided by observation", () => {
    for (const v of FLEET_VIEWS) {
      expect(v.states.length > 0 || v.observed, `${v.id} selects nothing at all`).toBe(true)
    }
  })

  test("every state a view names is a state the lifecycle actually has", () => {
    const known = new Set<string>(ALL_STATES)
    for (const v of FLEET_VIEWS) {
      for (const s of v.states) {
        expect(known.has(s), `${v.id} names ${s}, which the lifecycle does not have`).toBe(true)
      }
    }
  })

  test("no state is claimed by two views, so a tenant is never in two of them at once", () => {
    const seen = new Map<string, FleetViewId>()
    for (const v of FLEET_VIEWS) {
      for (const s of v.states) {
        expect(seen.has(s), `${s} is claimed by both ${seen.get(s)} and ${v.id}`).toBe(false)
        seen.set(s, v.id)
      }
    }
  })
})

test.describe("the multi-state views cover the half a typed state name misses", () => {
  test("Suspended holds the tenant that is still suspending", () => {
    expect(viewVerdict(view("suspended"), tenant({ state: "SUSPENDING" }), undefined)).toBe("in")
    expect(viewVerdict(view("suspended"), tenant({ state: "SUSPENDED_LOGICAL" }), undefined)).toBe(
      "in",
    )
  })

  test("Hibernated holds the tenant that is still hibernating", () => {
    expect(viewVerdict(view("hibernated"), tenant({ state: "HIBERNATING" }), undefined)).toBe("in")
    expect(
      viewVerdict(view("hibernated"), tenant({ state: "HIBERNATED_ZERO_RUNTIME" }), undefined),
    ).toBe("in")
  })

  test("Failed holds the tenant that is rolling back, because it only got there by failing", () => {
    expect(viewVerdict(view("failed"), tenant({ state: "ROLLING_BACK" }), undefined)).toBe("in")
  })

  test("a purge in flight is Purge pending and is NOT yet Purged", () => {
    expect(viewVerdict(view("purge-pending"), tenant({ state: "PURGING" }), undefined)).toBe("in")
    expect(viewVerdict(view("purged"), tenant({ state: "PURGING" }), undefined)).toBe("out")
    expect(
      viewVerdict(view("purged"), tenant({ state: "PURGED_ZERO_INCREMENTAL_COST" }), undefined),
    ).toBe("in")
  })

  test("Active does not quietly include Idle", () => {
    expect(viewVerdict(view("active"), tenant({ state: "IDLE" }), undefined)).toBe("out")
    expect(viewVerdict(view("idle"), tenant({ state: "IDLE" }), undefined)).toBe("in")
  })

  test("a state view never answers unknown, whether or not a reading exists", () => {
    for (const v of FLEET_VIEWS.filter((x) => !x.observed)) {
      for (const s of ALL_STATES) {
        expect(viewVerdict(v, tenant({ state: s }), undefined)).not.toBe("unknown")
        expect(viewVerdict(v, tenant({ state: s }), health())).not.toBe("unknown")
      }
    }
  })
})

test.describe("drifted is an observation, and an unread tenant is not a clean one", () => {
  test("a failing drift reading puts the tenant in the view", () => {
    expect(
      viewVerdict(view("drifted"), tenant(), health({ observations: [observation({ status: "failing" })] })),
    ).toBe("in")
  })

  test("a degraded drift reading counts too — partial drift is drift", () => {
    expect(
      viewVerdict(
        view("drifted"),
        tenant(),
        health({ observations: [observation({ status: "degraded" })] }),
      ),
    ).toBe("in")
  })

  test("an ok reading is out, and that is the only way to be out", () => {
    expect(viewVerdict(view("drifted"), tenant(), health())).toBe("out")
  })

  test("no health at all is unknown, never out", () => {
    expect(viewVerdict(view("drifted"), tenant(), undefined)).toBe("unknown")
  })

  test("health with no drift observation is unknown, never out", () => {
    expect(viewVerdict(view("drifted"), tenant(), health({ observations: [] }))).toBe("unknown")
  })

  test("a drift reading that itself came back unknown stays unknown", () => {
    expect(
      viewVerdict(
        view("drifted"),
        tenant(),
        health({ observations: [observation({ status: "unknown" })] }),
      ),
    ).toBe("unknown")
  })

  test("an observation from another source is not read as drift", () => {
    expect(
      viewVerdict(
        view("drifted"),
        tenant(),
        health({ observations: [observation({ source: "alarm", status: "failing" })] }),
      ),
    ).toBe("unknown")
  })
})

test.describe("counting, and the number that must not be swallowed", () => {
  const fleet: ViewableTenant[] = [
    { slug: "a", state: "ACTIVE" },
    { slug: "b", state: "SUSPENDING" },
    { slug: "c", state: "SUSPENDED_LOGICAL" },
    { slug: "d", state: "ACTIVE" },
    { slug: "e", state: "FAILED" },
  ]

  const readings = new Map<string, TenantHealth>([
    ["a", health({ slug: "a", observations: [observation({ status: "failing" })] })],
    ["b", health({ slug: "b", observations: [observation({ status: "ok" })] })],
    ["c", health({ slug: "c", observations: [observation({ status: "unknown" })] })],
    // d and e have no reading at all.
  ])

  test("state views count what they hold", () => {
    const counts = viewCounts(fleet, readings)
    expect(counts.active).toEqual({ matched: 2, undecided: 0 })
    expect(counts.suspended).toEqual({ matched: 2, undecided: 0 })
    expect(counts.failed).toEqual({ matched: 1, undecided: 0 })
    expect(counts.purged).toEqual({ matched: 0, undecided: 0 })
  })

  test("drifted counts one drifted and three it could not decide", () => {
    const counts = viewCounts(fleet, readings)
    expect(counts.drifted).toEqual({ matched: 1, undecided: 3 })
  })

  test("the sentence carries the undecided count rather than dropping it", () => {
    const counts = viewCounts(fleet, readings)
    const sentence = describeViewCount(view("drifted"), counts.drifted)
    expect(sentence).toContain("1 tenant in Drifted")
    expect(sentence).toContain("3 could not be decided")
    expect(sentence).toContain("neither counted here nor reported clean")
  })

  test("a fully-read fleet says nothing about undecided tenants, because there are none", () => {
    const counts = viewCounts(fleet, readings)
    expect(describeViewCount(view("active"), counts.active)).not.toContain("could not be decided")
  })
})

test.describe("reading the view out of the URL", () => {
  test("an absent parameter is no view", () => {
    expect(parseFleetView({})).toBeNull()
  })

  test("a known id is read, case-insensitively", () => {
    expect(parseFleetView({ view: "legal-hold" })).toBe("legal-hold")
    expect(parseFleetView({ view: " Purge-Pending " })).toBe("purge-pending")
  })

  test("an unknown id is dropped rather than made to match nothing", () => {
    // The same discipline `parseFleetFilter` applies to `?signal=`: a mistyped
    // URL that returns an empty fleet reads exactly like an empty fleet.
    expect(parseFleetView({ view: "hibernating" })).toBeNull()
    expect(parseFleetView({ view: "DRIFTED-ish" })).toBeNull()
  })

  test("a repeated parameter takes the first value rather than throwing", () => {
    expect(parseFleetView({ view: ["idle", "active"] })).toBe("idle")
  })
})

test("the eleven views are not the whole machine, and the gap is stated rather than hidden", () => {
  // Twenty-five states, eleven views. Every state the views do not name is
  // reachable only through `?state=`, and the page says so. If this list ever
  // empties it is because someone widened a view to swallow a state it should
  // not — the arithmetic is the guard, not the number.
  const covered = new Set<TenantState>(FLEET_VIEWS.flatMap((v) => v.states))
  expect(STATES_IN_NO_NAMED_VIEW.length).toBe(ALL_STATES.length - covered.size)
  expect(STATES_IN_NO_NAMED_VIEW).toContain("DRAFT")
  expect(STATES_IN_NO_NAMED_VIEW).toContain("PROVISIONING")
  expect(STATES_IN_NO_NAMED_VIEW).not.toContain("LEGAL_HOLD")
})

/* ═══════════════════════════════ the two producers that have to apply it ══ */

/**
 * A helper's own test cannot see a producer that stopped calling it.
 *
 * `fleet-view.ts` says so in its own header, about the defect that survived on
 * this very page: `hasDeployment` was a literal `true` in the JSX while the
 * helper's unit test passed the whole time. So these two assertions are about
 * the CALL, not about the answer — the rendered half (a chip that changes what
 * the table holds) is in `fleet-surface.spec.ts`, which needs a server.
 */
const SRC = path.join(__dirname, "..", "src")
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), "utf8")

test.describe("the fleet page and the export apply the same views", () => {
  test("/tenants narrows the fleet with viewVerdict, not with a boolean of its own", () => {
    const page = read("app", "tenants", "page.tsx")
    expect(page).toContain('from "@/lib/fleet-views"')
    expect(page).toContain("parseFleetView(params)")
    // The narrowing itself. `=== "in"` is the load-bearing half: `!== "out"`
    // would sweep every undecided tenant into the view.
    expect(page).toMatch(/viewVerdict\(activeView, t, healthBySlug\.get\(t\.slug\)\) === "in"/)
    // And the count row, so the undecided number reaches a human.
    expect(page).toContain("viewCounts(tenants, healthBySlug)")
    expect(page).toContain("describeViewCount")
  })

  test("the CSV export applies the view too, and refuses the one it cannot compute", () => {
    const route = read("app", "api", "aws", "[surface]", "route.ts")
    expect(route).toContain('from "@/lib/fleet-views"')
    expect(route).toMatch(/viewVerdict\(namedView, row, undefined\) === "in"/)
    // `drifted` is `observed`, and this surface takes no observations. Exporting
    // it would produce an empty file headed with the name of a problem.
    expect(route).toContain("namedView?.observed")
    expect(route).toContain("That view cannot be exported")
  })
})
