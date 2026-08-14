import type { TenantState } from "@tenure/provisioning"

import type { FleetReadings } from "../../lib/aws/health"
import type { HealthObservation, HealthSignal, TenantHealth } from "../../lib/fleet-health"
import {
  SIGNAL_SOURCE,
  THE_QUESTION,
  attentionTone,
  describeSignals,
  leadAnswer,
  lifecycleTone,
  observedCount,
  provenanceOf,
  rankFleetRows,
  unknownReadings,
} from "./fleet-view"

/**
 * The decisions `/tenants` makes, asserted without a table, a role or a browser.
 *
 * The page itself is an async server component that reads DynamoDB, resolves an
 * AWS identity and calls ACM and CloudWatch. Nothing inside it can be exercised
 * here, which is exactly how the last defect on this surface survived: a literal
 * `hasDeployment: true` in the JSX, with the helper's own unit test passing the
 * whole time because a helper's test cannot see a producer that stopped using
 * it. So the judgements live in `fleet-view.ts` and this asserts them directly.
 *
 * Collected by apps/web's jest, whose `roots` include `../system-studio/src`.
 * Imports are relative because that project's `@/` alias points at apps/web.
 */

const observation = (
  source: HealthObservation["source"],
  status: HealthObservation["status"],
  asOf: string,
): HealthObservation => ({ source, status, asOf, detail: `${source} ${status}` })

const health = (over: Partial<TenantHealth> & { slug: string }): TenantHealth => ({
  state: "ACTIVE",
  signals: [],
  attention: null,
  hoursSinceChange: 1,
  residualCost: null,
  observations: [],
  ...over,
})

describe("the question this page answers", () => {
  it("is asked in the operator's own words, not in the console's", () => {
    // Copy, and load-bearing: it is the first thing on the page and the thing
    // every panel below is arranged to answer.
    expect(THE_QUESTION).toBe(
      "Which tenants exist, what state is each in, and which need me right now?",
    )
  })
})

describe("the answer, in one sentence", () => {
  const base = {
    throttled: false,
    failure: false,
    configured: true,
    registered: 12,
    serving: 9,
    needingAttention: 0,
  }

  it("answers all three halves of the question when the registry answered", () => {
    expect(leadAnswer(base)).toBe(
      "12 tenants are registered, 9 of them serving, and none of them need an operator.",
    )
  })

  it("says how many need an operator, and that they are listed first", () => {
    const said = leadAnswer({ ...base, needingAttention: 3 })
    expect(said).toContain("3 need an operator")
    expect(said).toMatch(/worst first/i)
  })

  it("agrees with itself about one tenant", () => {
    expect(leadAnswer({ ...base, registered: 1, serving: 1 })).toContain("1 tenant is registered")
  })

  /*
   * The three arms that must NOT print a count.
   *
   * "0 need attention" derived from a read that failed is the specific false
   * green this console exists not to print, and each of these is a read that did
   * not produce a fleet.
   */
  it.each([
    [
      "a throttled registry",
      { ...base, throttled: true, registered: 0, serving: 0 },
      /is not known right now/,
    ],
    [
      "a failed registry",
      { ...base, failure: true, registered: 0, serving: 0 },
      /could not be read/,
    ],
    [
      "no registry at all",
      { ...base, configured: false, registered: 0, serving: 0 },
      /No tenant registry is configured/,
    ],
  ])("names its own uncertainty after %s", (_name, input, expected) => {
    const said = leadAnswer(input)
    // The positive half. Without it, an arm deleted from the chain falls
    // through to "No tenant has been composed through this console yet." — a
    // sentence that satisfies both negatives below and is a lie about a read
    // that never happened.
    expect(said).toMatch(expected)
    expect(said).not.toMatch(/none of them need an operator/)
    expect(said).not.toMatch(/0 (tenants|of them)/)
    expect(said).not.toBe("No tenant has been composed through this console yet.")
  })

  it("distinguishes an empty registry from an unread one", () => {
    expect(leadAnswer({ ...base, registered: 0, serving: 0 })).toBe(
      "No tenant has been composed through this console yet.",
    )
  })
})

describe("the lifecycle's tone", () => {
  it("calls a failure a failure, and nothing else", () => {
    expect(lifecycleTone("FAILED")).toBe("bad")
    const everythingElse: TenantState[] = [
      "DRAFT",
      "PLANNED",
      "READY",
      "ACTIVE",
      "IDLE",
      "PROVISIONING",
      "LEGAL_HOLD",
      "PURGED_ZERO_INCREMENTAL_COST",
    ]
    for (const state of everythingElse) expect(lifecycleTone(state)).not.toBe("bad")
  })

  it("is quiet about the states somebody put a tenant in on purpose", () => {
    // The defect this replaced: `SERVING.has(state) ? "ok" : "warn"` painted
    // every one of these in the same warning tone as FAILED.
    for (const state of ["DRAFT", "PLANNED", "READY", "LEGAL_HOLD", "PURGE_PENDING"] as const) {
      expect(lifecycleTone(state)).toBe("neutral")
    }
  })

  it("marks a state the machine is supposed to leave as informational", () => {
    expect(lifecycleTone("PROVISIONING")).toBe("info")
    expect(lifecycleTone("ROLLING_BACK")).toBe("info")
  })

  it("uses the serving set rather than a list of its own", () => {
    expect(lifecycleTone("ACTIVE")).toBe("ok")
    expect(lifecycleTone("IDLE")).toBe("ok")
  })
})

describe("the attention tone", () => {
  it("does not make a healthy tenant loud", () => {
    // Neutral, not "ok". A page of green badges is a page whose one warning
    // badge is harder to see than it would be on a page of grey.
    expect(attentionTone(null)).toBe("neutral")
  })

  it("separates what has already broken from what might still resolve", () => {
    expect(attentionTone("failed")).toBe("bad")
    expect(attentionTone("dependency-failing")).toBe("bad")
    expect(attentionTone("stalled")).toBe("warn")
    expect(attentionTone("config-behind")).toBe("warn")
  })
})

describe("which source a signal came from", () => {
  it("attributes the two signals that can only come from looking at AWS", () => {
    expect(SIGNAL_SOURCE["dependency-failing"]).toBe("estate")
    expect(SIGNAL_SOURCE.unobserved).toBe("estate")
  })

  it("attributes every signal derived from the registry row to the registry", () => {
    for (const signal of [
      "serving",
      "resting",
      "stalled",
      "failed",
      "terminal",
      "never-deployed",
      "config-behind",
    ] as const) {
      expect(SIGNAL_SOURCE[signal]).toBe("registry")
    }
  })

  it("groups a mixed row under both sources rather than one flat list", () => {
    const signals: HealthSignal[] = ["serving", "config-behind", "dependency-failing"]
    expect(describeSignals(signals)).toBe(
      "registry: serving, config behind · live estate: dependency failing",
    )
  })

  it("names only the source that said something", () => {
    expect(describeSignals(["serving"])).toBe("registry: serving")
    expect(describeSignals(["unobserved"])).toBe("live estate: unobserved")
  })

  it("says so when there is no signal at all", () => {
    expect(describeSignals([])).toBe("no signal")
  })
})

describe("when a tenant's state was last read, and from where", () => {
  const registryReadAt = "2026-08-13T12:00:00.000Z"

  it("separates the instant the row was read from the instant it moved", () => {
    const said = provenanceOf({
      registryReadAt,
      movedAt: "2026-03-01T09:30:00.000Z",
      observations: [],
    })
    expect(said.registry).toBe(`read ${registryReadAt} · last moved 2026-03-01T09:30:00.000Z`)
  })

  it("does not invent a movement for a row that has none", () => {
    expect(provenanceOf({ registryReadAt, movedAt: "", observations: [] }).registry).toContain(
      "no movement recorded on the row",
    )
  })

  it("reports an unobserved tenant as unobserved, never as a blank", () => {
    // A blank in this column reads as "fine", which is the one thing an
    // unobserved tenant is not known to be.
    expect(provenanceOf({ registryReadAt, movedAt: "", observations: [] }).estate).toBe(
      "not observed — no reading was taken of the running system",
    )
  })

  it("takes the newest observation instant, not the first in the list", () => {
    const said = provenanceOf({
      registryReadAt,
      movedAt: "2026-08-13T11:00:00.000Z",
      observations: [
        observation("tls", "ok", "2026-08-13T11:59:00.000Z"),
        observation("alarm", "unknown", "2026-08-13T11:59:30.000Z"),
        observation("backup", "unknown", "2026-08-13T11:58:00.000Z"),
      ],
    })
    expect(said.estate).toBe("observed 2026-08-13T11:59:30.000Z · 1/3 sources answered")
  })

  it("counts only the sources that came back with something definite", () => {
    const said = provenanceOf({
      registryReadAt,
      movedAt: "",
      observations: [
        observation("tls", "unknown", "2026-08-13T11:00:00.000Z"),
        observation("alarm", "unknown", "2026-08-13T11:00:00.000Z"),
        observation("backup", "degraded", "2026-08-13T11:00:00.000Z"),
      ],
    })
    // `degraded` is an answer. Only `unknown` is not.
    expect(said.estate).toContain("1/3 sources answered")
  })

  it("does not report the newest of nothing as an instant", () => {
    const said = provenanceOf({
      registryReadAt,
      movedAt: "",
      observations: [observation("tls", "ok", "not a timestamp")],
    })
    expect(said.estate).toBe("observed at an unreadable time · 1/1 sources answered")
  })
})

describe("the fleet is listed worst first", () => {
  const rows = [
    { slug: "healthy-a" },
    { slug: "stalled-one" },
    { slug: "healthy-b" },
    { slug: "failed-one" },
  ]
  // What `byUrgency` decided, passed in rather than re-derived: there is one
  // ranking of urgency in this console and the page must not fork it.
  const order = ["failed-one", "stalled-one", "healthy-a", "healthy-b"]

  it("puts the tenants that need an operator on the first page", () => {
    expect(rankFleetRows(rows, order).map((r) => r.slug)).toEqual([
      "failed-one",
      "stalled-one",
      "healthy-a",
      "healthy-b",
    ])
  })

  it("keeps a row the health pass did not cover, after the ranked ones", () => {
    const withStranger = [...rows, { slug: "not-in-the-health-pass" }]
    const ranked = rankFleetRows(withStranger, order)
    expect(ranked).toHaveLength(5)
    expect(ranked[ranked.length - 1]?.slug).toBe("not-in-the-health-pass")
  })

  it("leaves unranked rows in the registry's own order", () => {
    const ranked = rankFleetRows([{ slug: "zzz" }, { slug: "aaa" }], [])
    expect(ranked.map((r) => r.slug)).toEqual(["zzz", "aaa"])
  })

  it("does not reorder the caller's array in place", () => {
    const original = [...rows]
    rankFleetRows(rows, order)
    expect(rows).toEqual(original)
  })
})

describe("a read that could not be taken", () => {
  const denied = {
    state: "DENIED",
    capability: "acm:ListCertificates",
    action: "acm:ListCertificates",
    principal: "arn:aws:sts::000000000000:assumed-role/studio/task",
    accountId: "000000000000",
    region: "us-east-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: '{"Effect":"Allow","Action":"acm:ListCertificates","Resource":"*"}',
  } as const

  const ok = {
    state: "ACTUAL",
    capability: "cloudwatch:DescribeAlarms",
    value: [],
    asOf: "2026-08-13T12:00:00.000Z",
    fresh: true,
  } as const

  it("surfaces a refusal instead of leaving it as twenty unobserved cells", () => {
    const readings: FleetReadings = { at: 0, certificates: denied, alarms: ok }
    const unknown = unknownReadings(readings)
    expect(unknown).toHaveLength(1)
    expect(unknown[0]?.key).toBe("certificates")
    expect(unknown[0]?.read.state).toBe("DENIED")
    expect(unknown[0]?.what).toContain("certificates")
  })

  it("surfaces a throttle and an error too", () => {
    const readings: FleetReadings = {
      at: 0,
      certificates: {
        state: "THROTTLED",
        capability: "acm:ListCertificates",
        retryAfterMs: 400,
        asOf: "2026-08-13T12:00:00.000Z",
      },
      alarms: {
        state: "ERROR",
        capability: "cloudwatch:DescribeAlarms",
        code: "ObservationTimedOut",
        safeDetail: "did not answer within 4000ms",
      },
    }
    expect(unknownReadings(readings).map((r) => r.read.state)).toEqual(["THROTTLED", "ERROR"])
  })

  it("does not report a reading that worked", () => {
    // `EMPTY` is a real answer — "we looked and there is genuinely nothing" —
    // and `STALE` carries a value. Neither is unknown, and reporting either
    // here would be this page inventing a denial nobody issued.
    const readings: FleetReadings = {
      at: 0,
      certificates: { state: "EMPTY", capability: "acm:ListCertificates", asOf: "2026-08-13T12:00:00.000Z" },
      alarms: {
        state: "STALE",
        capability: "cloudwatch:DescribeAlarms",
        value: [],
        asOf: "2026-08-13T11:00:00.000Z",
        ageMs: 3_600_000,
      },
    }
    expect(unknownReadings(readings)).toEqual([])
  })
})

describe("how much of the fleet the chips are a measurement of", () => {
  it("counts only tenants something definite came back about", () => {
    const counted = observedCount([
      health({ slug: "seen", observations: [observation("tls", "ok", "2026-08-13T12:00:00.000Z")] }),
      health({
        slug: "guessed-at",
        observations: [observation("tls", "unknown", "2026-08-13T12:00:00.000Z")],
      }),
      health({ slug: "not-looked-at" }),
    ])
    expect(counted).toBe(1)
  })
})
