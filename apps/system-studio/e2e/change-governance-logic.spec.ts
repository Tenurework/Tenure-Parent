import { test, expect } from "@playwright/test"

import { MODULES, PROCESS_CHAINS } from "@tenure/modules"
import { classify, type ChangeOperation } from "@tenure/provisioning"

import {
  BLAST_DIMENSIONS,
  blastRadius,
  blastRadiusLines,
  blastRadiusProblems,
  interruption,
  type BlastInput,
} from "../src/lib/change/blast-radius"
import {
  AFTER_ACTION_DUE_HOURS,
  afterActionDebt,
  cancel,
  freezeFor,
  nextWindowOpening,
  noticeFor,
  scheduleLines,
  notificationReadiness,
  scheduleVerdict,
  supersede,
  windowContains,
  type ChangeCalendar,
  type ScheduleRequest,
  type ScheduledChange,
} from "../src/lib/change/windows"

/**
 * STUDIO-060-004 and STUDIO-060-008, with no browser and no server.
 *
 * Both modules are pure and take their clock as a parameter, so everything
 * below is arithmetic over data. The same reason `preferences-logic.spec.ts`
 * gives for using Playwright as a plain runner applies: the Studio has no
 * unit-test toolchain, and a second transform for two pure modules is a worse
 * trade than an unusual home for a fast test.
 *
 * The catalogue is the REAL one (`@tenure/modules`), not a fixture, wherever a
 * property should hold over what actually ships. Shapes the catalogue does not
 * have — a cell with nine tenants, an unreadable estate — are built by hand,
 * because those are the cases an operator meets and the catalogue cannot
 * produce.
 */

/* ───────────────────────────────────────────────────────────── blast radius ── */

const LIFECYCLE_SUSPEND: ChangeOperation = {
  surface: "tenant-lifecycle",
  action: "SUSPENDING",
  target: "simon",
}

function input(overrides: Partial<BlastInput> = {}): BlastInput {
  return {
    slug: "simon",
    currentState: "ACTIVE",
    operation: LIFECYCLE_SUSPEND,
    changeClass: classify(LIFECYCLE_SUSPEND),
    changedModules: [],
    modules: MODULES,
    chains: PROCESS_CHAINS,
    cell: {
      known: true,
      value: { cellId: "cell-use1-a", region: "us-east-1", release: "1.4.0", capacity: { tenants: 9 } },
    },
    seats: { known: true, value: 250 },
    resources: {
      known: true,
      value: [
        { handle: "dynamodb:table/tenure-simon", region: "us-east-1" },
        { handle: "s3:bucket/tenure-simon-uploads", region: "us-east-1" },
      ],
    },
    externalDomains: ["finance"],
    region: "us-east-1",
    ...overrides,
  }
}

const measure = (report: ReturnType<typeof blastRadius>, dimension: string) => {
  const found = report.measures.find((m) => m.dimension === dimension)
  if (!found) throw new Error(`no measure for ${dimension}`)
  return found
}

test.describe("the blast radius covers every axis the requirement names", () => {
  test("all twelve dimensions are measured, in the requirement's order", () => {
    const report = blastRadius(input())
    expect(report.measures.map((m) => m.dimension)).toEqual([...BLAST_DIMENSIONS])
    expect(BLAST_DIMENSIONS).toHaveLength(12)
  })

  test("the report checks its own integrity and finds nothing wrong with itself", () => {
    expect(blastRadiusProblems(blastRadius(input()))).toEqual([])
  })

  test("eleven axes answer and only `users` says it could not look", () => {
    const report = blastRadius(input())
    expect(report.unreadable).toEqual(["users"])
    expect(report.measured).toHaveLength(11)
  })

  test("`users` names the read that would answer it rather than reporting zero", () => {
    const reading = measure(blastRadius(input()), "users").reading
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("no user table")
    expect(reading.fix).toContain("cell's operations API")
  })
})

test.describe("the axes that are calculated, not passed in", () => {
  test("modules is the changed set plus everything transitively depending on it", () => {
    const report = blastRadius(input({ changedModules: ["approvals"] }))
    const reading = measure(report, "modules").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.items).toContain("approvals")
    // Real catalogue: `memory` consumes ApprovalDecided and depends on approvals.
    expect(reading.value.count).toBeGreaterThan(1)
    expect(reading.value.count).toBe(reading.value.items.length)
  })

  test("workflows are the declared process chains crossing an affected module", () => {
    const reading = measure(blastRadius(input({ changedModules: ["approvals"] })), "workflows").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.items).toContain("request-to-approval-to-memory")
  })

  test("a module on no chain reaches no workflow", () => {
    const reading = measure(
      blastRadius(input({ changedModules: ["nothing-declares-this"] })),
      "workflows",
    ).reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(0)
    expect(reading.value.items).toEqual([])
  })

  test("records counts object classes and its unit says it is not a row count", () => {
    const reading = measure(blastRadius(input({ changedModules: ["approvals"] })), "records").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.unit).toContain("classes, not rows")
    expect(reading.value.count).toBe(reading.value.items.length)
  })

  test("SLOs are the objectives the affected modules actually declare", () => {
    const reading = measure(blastRadius(input({ changedModules: ["approvals"] })), "slos").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.items.join(" ")).toContain("approvals: a pending approval is decided within its SLA")
  })

  test("regions unions the manifest, the cell and every resource's region", () => {
    const reading = measure(
      blastRadius(
        input({
          region: "us-east-1",
          resources: {
            known: true,
            value: [{ handle: "s3:bucket/x", region: "eu-west-1" }],
          },
        }),
      ),
      "regions",
    ).reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.items).toEqual(["eu-west-1", "us-east-1"])
  })

  test("tenants counts the cell's co-tenants and says why it cannot name them", () => {
    const reading = measure(blastRadius(input()), "tenants").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(9)
    expect(reading.value.items).toEqual(["simon"])
    expect(reading.value.itemsWithheld).toContain("not named")
  })

  test("a tenant on no cell shares nothing, and that is a zero and not an unknown", () => {
    const reading = measure(blastRadius(input({ cell: { known: true, value: null } })), "tenants").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(1)
    expect(reading.value.itemsWithheld).toBeNull()
  })
})

test.describe("an axis derived from a failed read fails with it", () => {
  const blind = input({
    resources: { known: false, because: "dynamodb:Query was denied", fix: "Grant the task role dynamodb:Query." },
  })

  test("resources and regions both report the denial, and neither reports zero", () => {
    const report = blastRadius(blind)
    expect(report.unreadable).toContain("resources")
    expect(report.unreadable).toContain("regions")
    const regions = measure(report, "regions").reading
    if (regions.known) throw new Error("regions must not answer when the estate could not be enumerated")
    expect(regions.because).toContain("dynamodb:Query was denied")
    expect(regions.fix).toContain("Grant the task role")
  })

  test("an unreadable cell takes tenants and downstream releases with it", () => {
    const report = blastRadius(
      input({ cell: { known: false, because: "the cell registry is not configured", fix: "Set CELL_TABLE." } }),
    )
    expect(report.unreadable).toEqual(["tenants", "users", "downstreamReleases"])
  })
})

test.describe("downtime is derived from the move, not from the class", () => {
  test("leaving a serving state for one that does not serve is an interruption", () => {
    expect(interruption(input())).toContain("ACTIVE → SUSPENDING")
    const reading = measure(blastRadius(input()), "downtime").reading
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(1)
  })

  test("a move that was never serving interrupts nobody", () => {
    expect(interruption(input({ currentState: "DRAFT" }))).toBeNull()
  })

  test("a configuration change is not a lifecycle interruption", () => {
    const operation: ChangeOperation = {
      surface: "tenant-configuration",
      action: "publish",
      target: "simon",
    }
    expect(interruption(input({ operation, changeClass: classify(operation) }))).toBeNull()
  })
})

test("every line an operator reads names its axis", () => {
  const lines = blastRadiusLines(blastRadius(input()))
  expect(lines).toHaveLength(12)
  expect(lines.find((l) => l.startsWith("users:"))).toContain("not measured")
  expect(lines.find((l) => l.startsWith("tenants:"))).toContain("9 tenants on cell cell-use1-a")
})

/* ───────────────────────────────────────────────── windows, freezes, review ── */

const SATURDAY_2300: ChangeCalendar = {
  // Saturday 23:00 UTC to Sunday 03:00 UTC — the shape a naive start<end
  // comparison never matches.
  windows: [
    {
      id: "weekend",
      label: "Weekend maintenance",
      weekday: 6,
      startMinuteUtc: 23 * 60,
      endMinuteUtc: 27 * 60,
      environments: ["production"],
    },
  ],
  freezes: [],
}

// 2026-08-15 is a Saturday; 2026-08-16 a Sunday.
const INSIDE = "2026-08-15T23:30:00.000Z"
const AFTER_MIDNIGHT = "2026-08-16T02:00:00.000Z"
const OUTSIDE = "2026-08-18T14:00:00.000Z"

function request(overrides: Partial<ScheduleRequest> = {}): ScheduleRequest {
  return {
    changeId: "chg-1",
    changeClass: "C5",
    environment: "production",
    scheduledFor: INSIDE,
    emergency: null,
    ...overrides,
  }
}

test.describe("a window that runs past midnight", () => {
  test("contains an instant on its own evening", () => {
    expect(windowContains(SATURDAY_2300.windows[0], new Date(INSIDE))).toBe(true)
  })

  test("contains an instant on the following morning", () => {
    expect(windowContains(SATURDAY_2300.windows[0], new Date(AFTER_MIDNIGHT))).toBe(true)
  })

  test("does not contain a Tuesday afternoon", () => {
    expect(windowContains(SATURDAY_2300.windows[0], new Date(OUTSIDE))).toBe(false)
  })
})

test.describe("the verdict", () => {
  test("permits a change inside a window", () => {
    const verdict = scheduleVerdict(request(), SATURDAY_2300, new Date("2026-08-01T00:00:00.000Z"))
    expect(verdict.status).toBe("IN_WINDOW")
    expect(verdict.permitted).toBe(true)
  })

  test("holds a change outside one and says when the next opens", () => {
    const verdict = scheduleVerdict(
      request({ scheduledFor: OUTSIDE }),
      SATURDAY_2300,
      new Date("2026-08-01T00:00:00.000Z"),
    )
    expect(verdict.status).toBe("OUTSIDE_WINDOW")
    expect(verdict.permitted).toBe(false)
    expect(verdict.nextOpensAt).toBe("2026-08-22T23:00:00.000Z")
  })

  test("an empty calendar is not permission", () => {
    const verdict = scheduleVerdict(request(), { windows: [], freezes: [] }, new Date(INSIDE))
    expect(verdict.status).toBe("OUTSIDE_WINDOW")
    expect(verdict.permitted).toBe(false)
    expect(verdict.detail).toContain("No maintenance window is declared")
    expect(verdict.nextOpensAt).toBeNull()
  })

  test("an observation is not window-bound", () => {
    const verdict = scheduleVerdict(
      request({ changeClass: "C1", scheduledFor: OUTSIDE }),
      SATURDAY_2300,
      new Date(OUTSIDE),
    )
    expect(verdict.status).toBe("IN_WINDOW")
    expect(verdict.permitted).toBe(true)
  })
})

const FREEZE: ChangeCalendar = {
  windows: SATURDAY_2300.windows,
  freezes: [
    {
      id: "term-start",
      label: "Term start",
      fromUtc: "2026-08-10T00:00:00.000Z",
      toUtc: "2026-09-01T00:00:00.000Z",
      classes: ["C4", "C5", "C6", "C7"],
      environments: ["production"],
      emergencyPermitted: true,
    },
    {
      id: "audit",
      label: "Audit lock",
      fromUtc: "2026-08-10T00:00:00.000Z",
      toUtc: "2026-09-01T00:00:00.000Z",
      classes: ["C7"],
      environments: ["production"],
      emergencyPermitted: false,
    },
  ],
}

test.describe("freezes", () => {
  test("hold a class they name, inside a window", () => {
    const verdict = scheduleVerdict(request(), FREEZE, new Date("2026-08-01T00:00:00.000Z"))
    expect(verdict.status).toBe("FROZEN")
    expect(verdict.permitted).toBe(false)
    expect(verdict.freeze?.id).toBe("term-start")
  })

  test("do not hold a class they do not name", () => {
    expect(freezeFor(FREEZE, request({ changeClass: "C3" }), new Date(INSIDE))).toBeNull()
  })

  test("do not hold a different environment", () => {
    expect(freezeFor(FREEZE, request({ environment: "staging" }), new Date(INSIDE))).toBeNull()
  })

  test("a declared emergency lifts one that admits emergencies, and owes a review", () => {
    const verdict = scheduleVerdict(
      request({ emergency: { reason: "outage", declaredBy: "ops@tenure" } }),
      FREEZE,
      new Date("2026-08-01T00:00:00.000Z"),
    )
    expect(verdict.status).toBe("EMERGENCY_OVERRIDE")
    expect(verdict.permitted).toBe(true)
    expect(verdict.afterActionReviewOwed).toBe(true)
  })

  test("a declared emergency does NOT lift one that refuses them", () => {
    const verdict = scheduleVerdict(
      request({ changeClass: "C7", emergency: { reason: "outage", declaredBy: "ops@tenure" } }),
      FREEZE,
      new Date("2026-08-01T00:00:00.000Z"),
    )
    expect(verdict.status).toBe("FROZEN")
    expect(verdict.permitted).toBe(false)
    expect(verdict.freeze?.id).toBe("audit")
  })
})

test.describe("maintenance notice", () => {
  test("a C7 needs three days and knows the deadline", () => {
    const notice = noticeFor(request({ changeClass: "C7" }), new Date("2026-08-01T00:00:00.000Z"))
    expect(notice?.requiredHours).toBe(72)
    expect(notice?.dueBy).toBe("2026-08-12T23:30:00.000Z")
    expect(notice?.late).toBe(false)
  })

  test("a deadline already past is reported late rather than silently met", () => {
    const notice = noticeFor(request({ changeClass: "C7" }), new Date("2026-08-14T00:00:00.000Z"))
    expect(notice?.late).toBe(true)
    const lines = scheduleLines(
      scheduleVerdict(request({ changeClass: "C7" }), SATURDAY_2300, new Date("2026-08-14T00:00:00.000Z")),
    )
    expect(lines.join("\n")).toContain("cannot be announced in time")
  })

  test("a reversible configuration change needs none", () => {
    expect(noticeFor(request({ changeClass: "C3" }), new Date("2026-08-01T00:00:00.000Z"))).toBeNull()
  })
})

const SCHEDULED: ScheduledChange = {
  changeId: "chg-1",
  resource: "tenant:simon",
  changeClass: "C5",
  environment: "production",
  scheduledFor: INSIDE,
  status: "SCHEDULED",
  emergency: null,
}

test.describe("cancellation", () => {
  test("closes a scheduled change and records who and why", () => {
    const outcome = cancel(SCHEDULED, {
      actor: "ops@tenure",
      reason: "the customer moved their go-live date to September",
      at: "2026-08-14T00:00:00.000Z",
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.value.status).toBe("CANCELLED")
    expect(outcome.value.closedBy?.actor).toBe("ops@tenure")
  })

  test("refuses a reason nobody could read later", () => {
    const outcome = cancel(SCHEDULED, { actor: "ops@tenure", reason: "no", at: INSIDE })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("reason-too-short")
  })

  test("refuses a change that has already started", () => {
    const outcome = cancel(
      { ...SCHEDULED, status: "EXECUTING" },
      { actor: "ops@tenure", reason: "the customer moved their go-live date", at: INSIDE },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("not-open")
  })
})

test.describe("supersession", () => {
  const later: ScheduledChange = { ...SCHEDULED, changeId: "chg-2", scheduledFor: AFTER_MIDNIGHT }
  const by = { actor: "ops@tenure", reason: "replanned onto the later window", at: INSIDE }

  test("replaces an earlier change over the same target", () => {
    const outcome = supersede(SCHEDULED, later, by)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.value.status).toBe("SUPERSEDED")
    expect(outcome.value.closedBy?.supersededBy).toBe("chg-2")
  })

  test("refuses across targets, which would drop a change nobody cancelled", () => {
    const outcome = supersede(SCHEDULED, { ...later, resource: "tenant:other" }, by)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("different-target")
  })

  test("refuses a replacement that is not later", () => {
    const outcome = supersede(SCHEDULED, { ...later, scheduledFor: INSIDE }, by)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("not-later")
  })
})

test.describe("after-action review", () => {
  const ran: ScheduledChange = {
    ...SCHEDULED,
    status: "DONE",
    emergency: { reason: "outage", declaredBy: "ops@tenure" },
  }

  test("an emergency change that ran owes one", () => {
    const debt = afterActionDebt([ran], new Date("2026-08-16T00:00:00.000Z"))
    expect(debt).toHaveLength(1)
    expect(debt[0].overdue).toBe(false)
    expect(debt[0].dueBy).toBe(
      new Date(Date.parse(INSIDE) + AFTER_ACTION_DUE_HOURS * 3_600_000).toISOString(),
    )
  })

  test("owed and overdue are different facts", () => {
    const debt = afterActionDebt([ran], new Date("2026-09-01T00:00:00.000Z"))
    expect(debt[0].overdue).toBe(true)
  })

  test("a routine change owes nothing and a reviewed one is not listed", () => {
    expect(afterActionDebt([{ ...ran, emergency: null }], new Date("2026-09-01T00:00:00.000Z"))).toEqual([])
    expect(
      afterActionDebt(
        [{ ...ran, afterActionReview: { at: INSIDE, author: "ops@tenure", summary: "root cause" } }],
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toEqual([])
  })
})

test.describe("a notice that was owed, and whether one was given", () => {
  const purge: ScheduledChange = { ...SCHEDULED, changeClass: "C7" }
  const now = new Date("2026-08-01T00:00:00.000Z")

  test("a class that owes nothing is ready", () => {
    expect(notificationReadiness({ ...SCHEDULED, changeClass: "C3" }, now).ready).toBe(true)
  })

  test("a purge with no notice recorded is NOT ready, and says the console does not send them", () => {
    const readiness = notificationReadiness(purge, now)
    expect(readiness.ready).toBe(false)
    expect(readiness.required?.requiredHours).toBe(72)
    expect(readiness.detail).toContain("none is recorded")
    expect(readiness.detail).toContain("does not send notices")
  })

  test("a notice given in time makes it ready and names who told whom, how", () => {
    const readiness = notificationReadiness(
      {
        ...purge,
        notifications: [
          { audience: "simon", channel: "email", sentAt: "2026-08-11T09:00:00.000Z", by: "ops@tenure" },
        ],
      },
      now,
    )
    expect(readiness.ready).toBe(true)
    expect(readiness.detail).toContain("ops@tenure")
    expect(readiness.detail).toContain("email")
  })

  test("a notice given AFTER the deadline is a log entry, not a warning", () => {
    const readiness = notificationReadiness(
      {
        ...purge,
        notifications: [
          { audience: "simon", channel: "email", sentAt: "2026-08-15T22:00:00.000Z", by: "ops@tenure" },
        ],
      },
      now,
    )
    expect(readiness.ready).toBe(false)
    expect(readiness.detail).toContain("log entry and not a warning")
  })
})
