import { test, expect, type Page } from "@playwright/test"

import {
  BACKUP_STALE_HOURS,
  HEALTH_REFRESH_MS,
  TLS_WARN_DAYS,
  __resetObservations,
  alarmObservation,
  backupObservation,
  certificateCovers,
  certificateObservation,
  fleetReadings,
  observeFleet,
  type AlarmSummary,
  type CertificateSummary,
} from "../src/lib/aws/health"
import type { AwsGateway } from "../src/lib/aws/read"
import {
  STALL_HOURS,
  TRANSITIONAL,
  byUrgency,
  explainAttention,
  healthOf,
  summariseFleet,
  type HealthObservation,
} from "../src/lib/fleet-health"
import { operatorFor } from "./operator-identity"

/**
 * GE-033-002 / STUDIO-120-003 — fleet health, derived without reading a
 * tenant's data.
 *
 * Mostly pure, so mostly no browser. The cases that matter are the ones where a
 * signal must NOT fire: a draft is not a stall, an unreadable timestamp is not
 * an outage, and a tenant that has not reached CONFIGURING has nothing to have
 * deployed. A health view that cries wolf is one operators stop opening.
 *
 * The last describe block IS a browser case, and deliberately. Everything above
 * it proves what `healthOf` and the readers compute; only the page proves that
 * the fleet view actually asks. That distinction has already cost this
 * repository once — `config-store.spec.ts` was written because three items were
 * recorded PASS over a publish path that was dead in the real UI.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 24 * 3600_000)

/** A tenant nothing has been observed about. Most cases below are about the row. */
const NOTHING_OBSERVED: readonly HealthObservation[] = []

/** One definite answer, which is what stops `unobserved` firing. */
const observedOk: readonly HealthObservation[] = [
  { source: "alarm", status: "ok", asOf: NOW.toISOString(), detail: "2 alarms watching, all OK." },
]

const input = (over: Partial<Parameters<typeof healthOf>[0]> = {}) => ({
  slug: "acme",
  state: "ACTIVE" as const,
  updatedAt: hoursAgo(1),
  hasDeployment: true,
  // Serving tenants default to having been observed, so that the cases about
  // stalls and manifests are not all silently also about observation.
  observations: observedOk,
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
    const health = healthOf(
      input({ state: "DRAFT", updatedAt: hoursAgo(24 * 30), hasDeployment: false }),
      NOW,
    )
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
      input({
        state: "PURGED_ZERO_INCREMENTAL_COST",
        updatedAt: hoursAgo(1000),
        hasDeployment: false,
        observations: NOTHING_OBSERVED,
      }),
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

/**
 * STUDIO-120-003 — the half of health that comes from looking at the running
 * system rather than at the row describing it.
 */
test.describe("what was observed of the running system", () => {
  test("a serving tenant nobody could observe is unobserved, not healthy", () => {
    // The defect this closes: every signal used to come from `state` and
    // `updatedAt`, so a tenant whose certificate had expired and whose alarms
    // had no data reported "nothing needs attention".
    const health = healthOf(input({ observations: NOTHING_OBSERVED }), NOW)
    expect(health.signals).toContain("unobserved")
    expect(health.attention).toBe("unobserved")
  })

  test("every source unknown is the same as none at all", () => {
    const health = healthOf(
      input({
        observations: [
          { source: "tls", status: "unknown", asOf: NOW.toISOString(), detail: "denied" },
          { source: "alarm", status: "unknown", asOf: NOW.toISOString(), detail: "denied" },
        ],
      }),
      NOW,
    )
    expect(health.signals).toContain("unobserved")
  })

  test("one definite answer is enough to stop it, including a degraded one", () => {
    // `degraded` IS an answer. Treating it as no-answer would file every
    // near-expiry certificate under "we cannot tell", which is the opposite of
    // what it means.
    const health = healthOf(
      input({
        observations: [
          { source: "tls", status: "degraded", asOf: NOW.toISOString(), detail: "expires in 9 days" },
          { source: "alarm", status: "unknown", asOf: NOW.toISOString(), detail: "denied" },
        ],
      }),
      NOW,
    )
    expect(health.signals).not.toContain("unobserved")
  })

  test("a tenant that is not serving is not chased for observations", () => {
    // A DRAFT tenant has no running system, so "nothing was observed" is the
    // normal case rather than a finding, and flagging it would make the signal
    // noise on exactly the tenants nobody needs to look at.
    for (const state of ["DRAFT", "PROVISIONING", "HIBERNATED_ZERO_RUNTIME"] as const) {
      expect(
        healthOf(input({ state, hasDeployment: false, observations: NOTHING_OBSERVED }), NOW).signals,
      ).not.toContain("unobserved")
    }
  })

  test("a failing observation is a dependency failure whatever the lifecycle says", () => {
    const health = healthOf(
      input({
        observations: [
          {
            source: "tls",
            status: "failing",
            asOf: NOW.toISOString(),
            detail: "the certificate for app.tenurework.com expired 3 day(s) ago.",
          },
        ],
      }),
      NOW,
    )
    expect(health.state).toBe("ACTIVE")
    expect(health.signals).toContain("dependency-failing")
    expect(health.attention).toBe("dependency-failing")
  })

  test("a real failure outranks not knowing", () => {
    // Both fire on the same tenant when one source is broken and the rest are
    // denied. Ranking `unobserved` first would bury the finding.
    const health = healthOf(
      input({
        observations: [
          { source: "tls", status: "failing", asOf: NOW.toISOString(), detail: "expired" },
          { source: "alarm", status: "unknown", asOf: NOW.toISOString(), detail: "denied" },
        ],
      }),
      NOW,
    )
    expect(health.attention).toBe("dependency-failing")
  })

  test("a lifecycle failure still outranks a dependency failure", () => {
    const health = healthOf(
      input({
        state: "FAILED",
        observations: [{ source: "tls", status: "failing", asOf: NOW.toISOString(), detail: "expired" }],
      }),
      NOW,
    )
    expect(health.attention).toBe("failed")
  })

  test("the badge carries the reason with it", () => {
    const failing = healthOf(
      input({
        observations: [
          { source: "tls", status: "failing", asOf: NOW.toISOString(), detail: "expired 3 days ago" },
        ],
      }),
      NOW,
    )
    expect(explainAttention(failing)).toContain("expired 3 days ago")

    const unobserved = healthOf(input({ observations: NOTHING_OBSERVED }), NOW)
    expect(explainAttention(unobserved)).toContain("nothing was observed")

    // A stall needs no explanation beyond the state and the hours beside it.
    expect(explainAttention(healthOf(input({ state: "MIGRATING", updatedAt: hoursAgo(48) }), NOW))).toBeNull()
  })
})

/* ------------------------------------------------------------ the readers -- */

const CERTIFICATES = "acm:ListCertificates"
const ALARMS = "cloudwatch:DescribeAlarms"

/**
 * A gateway that answers like AWS and records what it was asked.
 *
 * Not a stand-in for the code under test: `readAws` still classifies the
 * outcome, the readers still parse the response shape, and an error thrown here
 * is thrown exactly where the SDK would throw it — including the `name` field,
 * which is what `read.ts` keys its denial classification on rather than on
 * message text.
 */
function gatewayOf(answers: {
  certificates?: CertificateSummary[] | Error
  alarms?: AlarmSummary[] | Error
}): AwsGateway & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async call(capability) {
      calls.push(capability)
      if (capability === CERTIFICATES) {
        const a = answers.certificates ?? []
        if (a instanceof Error) throw a
        return { CertificateSummaryList: a }
      }
      if (capability === ALARMS) {
        const a = answers.alarms ?? []
        if (a instanceof Error) throw a
        return { MetricAlarms: a, CompositeAlarms: [] }
      }
      throw new Error(`the fleet health reader asked for ${capability}, which it should never do`)
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

const denial = (name: string) => Object.assign(new Error(`${name}: refused`), { name })

async function readingsFrom(answers: Parameters<typeof gatewayOf>[0], now = NOW) {
  __resetObservations()
  return fleetReadings({ now, gateway: gatewayOf(answers) })
}

test.describe("reading a certificate", () => {
  test("a wildcard covers one label and not two", () => {
    // A suffix test would report `*.tenurework.com` as covering
    // `a.b.tenurework.com`, which no browser accepts.
    expect(certificateCovers("*.tenurework.com", "app.tenurework.com")).toBe(true)
    expect(certificateCovers("*.tenurework.com", "a.b.tenurework.com")).toBe(false)
    expect(certificateCovers("platform.tenurework.com", "platform.tenurework.com")).toBe(true)
    expect(certificateCovers("platform.tenurework.com", "app.tenurework.com")).toBe(false)
    expect(certificateCovers(undefined, "app.tenurework.com")).toBe(false)
  })

  test("an issued certificate with room to spare is ok", async () => {
    const readings = await readingsFrom({
      certificates: [
        { DomainName: "platform.tenurework.com", Status: "ISSUED", NotAfter: daysAhead(200) },
      ],
    })
    const o = certificateObservation("platform.tenurework.com", readings.certificates, NOW)
    expect(o.status).toBe("ok")
    expect(o.asOf).toBe(NOW.toISOString())
  })

  test("inside the renewal window and not renewed is degraded", async () => {
    const readings = await readingsFrom({
      certificates: [
        {
          DomainName: "platform.tenurework.com",
          Status: "ISSUED",
          NotAfter: daysAhead(TLS_WARN_DAYS - 4),
        },
      ],
    })
    const o = certificateObservation("platform.tenurework.com", readings.certificates, NOW)
    expect(o.status).toBe("degraded")
    expect(o.detail).toContain("has not renewed")
  })

  test("an expired certificate is failing", async () => {
    const readings = await readingsFrom({
      certificates: [
        { DomainName: "platform.tenurework.com", Status: "ISSUED", NotAfter: daysAhead(-3) },
      ],
    })
    expect(certificateObservation("platform.tenurework.com", readings.certificates, NOW).status).toBe(
      "failing",
    )
  })

  test("the soonest expiry decides, not the latest", async () => {
    // Two certificates for one host is the normal state during a renewal. Taking
    // the latest would report the host safe for a year because a certificate
    // exists that nothing is serving.
    const readings = await readingsFrom({
      certificates: [
        { DomainName: "platform.tenurework.com", Status: "ISSUED", NotAfter: daysAhead(300) },
        { DomainName: "platform.tenurework.com", Status: "ISSUED", NotAfter: daysAhead(-1) },
      ],
    })
    expect(certificateObservation("platform.tenurework.com", readings.certificates, NOW).status).toBe(
      "failing",
    )
  })

  test("the estate's own three FAILED certificates are a failure, not an absence", async () => {
    // docs/architecture/aws-current-state.md, verbatim: three FAILED for
    // app.tenurework.com and one ISSUED for platform.tenurework.com. Before this
    // reader that was a line in a document and nothing per tenant.
    const readings = await readingsFrom({
      certificates: [
        { DomainName: "app.tenurework.com", Status: "FAILED" },
        { DomainName: "app.tenurework.com", Status: "FAILED" },
        { DomainName: "app.tenurework.com", Status: "FAILED" },
        { DomainName: "platform.tenurework.com", Status: "ISSUED", NotAfter: daysAhead(120) },
      ],
    })
    const failed = certificateObservation("app.tenurework.com", readings.certificates, NOW)
    expect(failed.status).toBe("failing")
    expect(failed.detail).toContain("FAILED")

    // And the host that IS issued is not dragged down with it.
    expect(certificateObservation("platform.tenurework.com", readings.certificates, NOW).status).toBe("ok")
  })

  test("a denied call is unknown, and says which action and which policy", async () => {
    // STUDIO-000-007. The failure this exists to prevent is a denial rendered
    // as an empty certificate list, which reads as "this host has no
    // certificate" — a completely different, and actionable, claim.
    const readings = await readingsFrom({ certificates: denial("AccessDeniedException") })
    const o = certificateObservation("platform.tenurework.com", readings.certificates, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("acm:ListCertificates")
    expect(o.detail).toContain("Minimum statement")
  })

  test("a host the fleet cannot name is unknown rather than assumed", async () => {
    const readings = await readingsFrom({ certificates: [] })
    const o = certificateObservation(null, readings.certificates, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("CELL_BASE_URL")
  })
})

test.describe("reading an alarm", () => {
  const alarm = (over: AlarmSummary): AlarmSummary => ({ AlarmName: "tenure-rochester-5xx", ...over })

  test("an alarm in ALARM is a dependency failure, named", async () => {
    const readings = await readingsFrom({ alarms: [alarm({ StateValue: "ALARM" })] })
    const o = alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW)
    expect(o.status).toBe("failing")
    expect(o.detail).toContain("tenure-rochester-5xx")
  })

  test("INSUFFICIENT_DATA is unknown, never ok", async () => {
    // The mapping that carries this whole reader. An alarm that has never
    // received a data point has never been able to fire, so scoring it green
    // makes the console greenest exactly where the metric pipeline is broken.
    const readings = await readingsFrom({ alarms: [alarm({ StateValue: "INSUFFICIENT_DATA" })] })
    const o = alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("has never been able to fire")
  })

  test("ALARM wins over INSUFFICIENT_DATA on the same tenant", async () => {
    const readings = await readingsFrom({
      alarms: [
        alarm({ AlarmName: "tenure-rochester-latency", StateValue: "INSUFFICIENT_DATA" }),
        alarm({ AlarmName: "tenure-rochester-5xx", StateValue: "ALARM" }),
      ],
    })
    expect(alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW).status).toBe(
      "failing",
    )
  })

  test("no alarm mentioning the tenant is unknown, not ok", async () => {
    // "Nothing is watching this tenant" and "everything watching this tenant is
    // happy" are opposite facts with the same empty list behind them.
    const readings = await readingsFrom({
      alarms: [alarm({ AlarmName: "tenure-somebody-else-5xx", StateValue: "OK" })],
    })
    const o = alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("An absent alarm is not a healthy one")
  })

  test("a cell-wide alarm counts for the tenants on that cell", async () => {
    const readings = await readingsFrom({
      alarms: [alarm({ AlarmName: "cell-us-east-1-a-cpu", StateValue: "ALARM" })],
    })
    expect(
      alarmObservation({ slug: "rochester", cellId: "cell-us-east-1-a" }, readings.alarms, NOW).status,
    ).toBe("failing")
  })

  test("a dimension naming the tenant counts as well as the name", async () => {
    const readings = await readingsFrom({
      alarms: [
        alarm({
          AlarmName: "tenure-5xx",
          StateValue: "ALARM",
          Dimensions: [{ Name: "Tenant", Value: "rochester" }],
        }),
      ],
    })
    expect(alarmObservation({ slug: "rochester", cellId: null }, readings.alarms, NOW).status).toBe(
      "failing",
    )
  })

  test("OK with actions disabled is degraded, because nobody is paged", async () => {
    const readings = await readingsFrom({
      alarms: [alarm({ StateValue: "OK", ActionsEnabled: false })],
    })
    const o = alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW)
    expect(o.status).toBe("degraded")
    expect(o.detail).toContain("nobody is paged")
  })

  test("OK with actions enabled is ok", async () => {
    const readings = await readingsFrom({
      alarms: [alarm({ StateValue: "OK", ActionsEnabled: true })],
    })
    expect(alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW).status).toBe("ok")
  })

  test("a throttled read is unknown and says to retry, not that nothing is wrong", async () => {
    const readings = await readingsFrom({ alarms: denial("ThrottlingException") })
    const o = alarmObservation({ slug: "rochester", cellId: "cell-a" }, readings.alarms, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("throttled")
  })
})

test.describe("reading a backup", () => {
  test("never verified is unknown, and names what would set it", () => {
    // `lib/cells.ts` already defaults this to null with the reason. This is what
    // turns that null into something a tenant row shows.
    const o = backupObservation({ cellId: "cell-a", lastVerifiedAt: null, retentionDays: 1 }, NOW)
    expect(o.status).toBe("unknown")
    expect(o.detail).toContain("CELL_LAST_BACKUP_AT")
  })

  test("verified recently is ok", () => {
    const o = backupObservation(
      { cellId: "cell-a", lastVerifiedAt: hoursAgo(2), retentionDays: 7 },
      NOW,
    )
    expect(o.status).toBe("ok")
  })

  test("stale but inside retention is degraded", () => {
    const o = backupObservation(
      { cellId: "cell-a", lastVerifiedAt: hoursAgo(BACKUP_STALE_HOURS + 5), retentionDays: 7 },
      NOW,
    )
    expect(o.status).toBe("degraded")
  })

  test("older than the retention window is failing, because nothing verified survives", () => {
    const o = backupObservation(
      { cellId: "cell-a", lastVerifiedAt: hoursAgo(24 * 9), retentionDays: 7 },
      NOW,
    )
    expect(o.status).toBe("failing")
    expect(o.detail).toContain("nothing to restore")
  })

  test("a timestamp that does not parse is unknown, not old", () => {
    const o = backupObservation(
      { cellId: "cell-a", lastVerifiedAt: "last tuesday", retentionDays: 7 },
      NOW,
    )
    expect(o.status).toBe("unknown")
  })
})

test.describe("one pass of the fleet", () => {
  test("makes two calls for the whole fleet, not two per tenant", async () => {
    __resetObservations()
    const gateway = gatewayOf({ certificates: [], alarms: [] })
    const targets = ["a", "b", "c"].map((slug) => ({
      slug,
      host: "platform.tenurework.com",
      cellId: "cell-a",
      backup: { lastVerifiedAt: null, retentionDays: 1 },
    }))

    const observed = await observeFleet(targets, { now: NOW, gateway })
    expect(observed.size).toBe(3)
    expect(gateway.calls.sort()).toEqual([CERTIFICATES, ALARMS].sort())
  })

  test("reuses the reading inside the refresh window and re-reads after it", async () => {
    __resetObservations()
    const gateway = gatewayOf({ certificates: [], alarms: [] })
    const target = [{ slug: "a", host: "h", cellId: "c", backup: null }]

    await observeFleet(target, { now: NOW, gateway })
    await observeFleet(target, { now: new Date(NOW.getTime() + HEALTH_REFRESH_MS - 1), gateway })
    expect(gateway.calls.length).toBe(2)

    await observeFleet(target, { now: new Date(NOW.getTime() + HEALTH_REFRESH_MS + 1), gateway })
    expect(gateway.calls.length).toBe(4)
  })

  test("reports every source, including the ones nothing can read yet", async () => {
    __resetObservations()
    const observed = await observeFleet(
      [{ slug: "a", host: "platform.tenurework.com", cellId: "cell-a", backup: null }],
      { now: NOW, gateway: gatewayOf({ certificates: [], alarms: [] }) },
    )
    const sources = (observed.get("a") ?? []).map((o) => o.source)
    // Absent and unknown look identical on a page. Six, always.
    expect(sources.sort()).toEqual(["alarm", "backup", "cost-anomaly", "drift", "queue-age", "tls"])
  })

  test("no gateway is unknown, and says so rather than attempting a call", async () => {
    __resetObservations()
    const observed = await observeFleet(
      [{ slug: "a", host: "platform.tenurework.com", cellId: "cell-a", backup: null }],
      { now: NOW, gateway: null },
    )
    for (const o of observed.get("a") ?? []) expect(o.status).toBe("unknown")
    expect(healthOf(input({ observations: observed.get("a") ?? [] }), NOW).attention).toBe("unobserved")
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

  test("counts the new signals too", () => {
    // A signal missing from the tally is a chip that never appears, which is the
    // same silence the signal exists to break.
    const summary = summariseFleet([
      healthOf(input({ slug: "quiet", observations: NOTHING_OBSERVED }), NOW),
      healthOf(
        input({
          slug: "broken",
          observations: [{ source: "tls", status: "failing", asOf: NOW.toISOString(), detail: "x" }],
        }),
        NOW,
      ),
    ])
    expect(summary.bySignal.unobserved).toBe(1)
    expect(summary.bySignal["dependency-failing"]).toBe(1)
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

  test("an unobserved tenant sorts below findings and above nothing", () => {
    const ordered = byUrgency([
      healthOf(input({ slug: "unobserved", observations: NOTHING_OBSERVED }), NOW),
      healthOf(input({ slug: "healthy" }), NOW),
      healthOf(input({ slug: "stalled", state: "MIGRATING", updatedAt: hoursAgo(48) }), NOW),
    ])
    expect(ordered.map((t) => t.slug)).toEqual(["stalled", "unobserved", "healthy"])
  })

  test("breaks a tie on how long it has been that way", () => {
    const ordered = byUrgency([
      healthOf(input({ slug: "recent", state: "MIGRATING", updatedAt: hoursAgo(7) }), NOW),
      healthOf(input({ slug: "ancient", state: "MIGRATING", updatedAt: hoursAgo(200) }), NOW),
    ])
    expect(ordered.map((t) => t.slug)).toEqual(["ancient", "recent"])
  })
})

/* ------------------------------------------------------------- the page -- */

/**
 * The only case here that proves the fleet view actually asks.
 *
 * Everything above proves what `healthOf` and the readers compute. A page that
 * never called them would leave every one of those cases green — which is the
 * shape of the defect this item names: correct code, and a surface that reports
 * a fleet healthy on the strength of having asked nothing.
 *
 * No AWS is reachable from a test environment, so what the page must show is
 * `unobserved` — the honest answer, and the one that only appears if the page
 * really calls `observeFleet` and really passes what came back into `healthOf`.
 */
// Through `operatorFor`, not `PLATFORM_OPERATORS.split(",")[0]`: the variable's
// grammar is `email:role`, so the raw first entry is an address, a colon and a
// role, and typing that into the Email field is a sign-in the console refuses —
// correctly, and for a reason that has nothing to do with fleet health. See
// `operator-identity.ts`, which exists because of exactly this.
const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const registryConfigured = !!process.env.TENANT_TABLE

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

test.describe("the fleet page reports what it could not observe", () => {
  test.skip(!registryConfigured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("a serving tenant nothing can be observed about is shown as unobserved", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")

    const section = page.locator("section", { hasText: "Fleet health" }).first()
    await expect(section).toBeVisible()

    // The registry has to hold something, or this asserts on an absent panel.
    const rows = section.locator("tbody tr")
    expect(await rows.count()).toBeGreaterThan(0)

    // The claim: the page shows the signal that only exists because it asked
    // AWS and got nothing back. `healthOf` alone cannot produce this.
    await expect(section).toContainText("unobserved")
    await expect(section).toContainText("nothing definite came back from")

    // And it says when it looked and how often it looks, because a health panel
    // with neither is a set of claims that were true at some point.
    await expect(section).toContainText(/Observed \d{4}-\d{2}-\d{2}T/)
    await expect(section).toContainText(/re-read every \d+s/)
  })

  test("the tenant's own page names every source it could not read", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")

    // `td a`, not `td.id a`. The fleet surface now composes
    // `components/md3/DataTable`, which derives every cell from one column
    // declaration and therefore does not let a caller put a class on a `<td>`.
    // The property this line needs is unchanged and is the one it always
    // wanted: the first link in the first row of the attention list opens that
    // tenant.
    const first = page.locator("section", { hasText: "Fleet health" }).first().locator("tbody tr td a").first()
    await first.click()
    await page.waitForURL(/\/tenants\/[^/]+$/)

    /*
     * `#observed`, not "the first section mentioning the word".
     *
     * This was `page.locator("section", { hasText: "Observed" }).first()`, and
     * Playwright's `hasText` with a STRING is a case-insensitive SUBSTRING
     * match. So it also matched the "Right now" card, whose supporting text
     * reads "…from the registry and from what was observed of the running
     * system" — an earlier section in DOM order, so `.first()` chose it, and the
     * table it went looking for was three panels further down. The failure read
     * `element(s) not found` while the table was present and correctly named,
     * which is the most expensive shape a locator bug can take.
     *
     * The Card carries `id="observed"` precisely so a panel can be addressed
     * rather than described. This is strictly more precise than what it
     * replaces: it names ONE element, so the assertions below can no longer
     * pass or fail on the strength of which panel happened to sort first.
     */
    const observed = page.locator("section#observed")
    await expect(observed).toBeVisible()
    // `/tenants/[slug]` composes `DataTable` for this panel too, so its Source
    // column is a plain `<td>` with no class to hook — the class was markup,
    // and the property this test is about is not. Asserted through the table's
    // own role instead, and TIGHTER than the `td.id` substring it replaces: the
    // Source cell's whole text must BE the source, so a page that dropped the
    // `queue-age` row and merely mentioned the words somewhere in another row's
    // prose no longer passes, and neither does a row rendered anywhere other
    // than inside this panel's table.
    const sources = observed.getByRole("table", {
      name: "Observation sources, and what each one said",
    })
    await expect(sources).toBeVisible()
    for (const source of ["tls", "alarm", "backup", "queue-age", "cost-anomaly", "drift"]) {
      await expect(
        sources.getByRole("cell", { name: source, exact: true }),
        `${source} has no row of its own`,
      ).toHaveCount(1)
    }
    // The three that have no reader must say what would give them one, rather
    // than rendering as a blank row that reads like a healthy one.
    await expect(observed).toContainText("sqs:GetQueueAttributes")
    await expect(observed).toContainText("FINOPS_CUR_BUCKET")
    await expect(observed).toContainText("STUDIO-080-001")
  })
})
