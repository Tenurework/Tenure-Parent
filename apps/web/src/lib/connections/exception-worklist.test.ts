import {
  REDACTED,
  SLA_MINUTES,
  buildIntegrationException,
  classifyDeliveryError,
  deadDeliveryExceptions,
  impactOfEventType,
  orderExceptions,
  severityOf,
  summariseWorklist,
  type DeadDelivery,
  type ExceptionInput,
} from "@/lib/connections/exception-worklist"
import { INTEGRATION_ERROR_CLASSES } from "@/lib/connections/integration-errors"

const NOW = "2026-08-17T12:00:00.000Z"

function input(over: Partial<ExceptionInput> = {}): ExceptionInput {
  return {
    key: "outbox:ob-1",
    errorClass: "TRANSIENT_PROVIDER",
    sourceObject: { type: "ApprovalRequest", id: "ar-1" },
    intendedOutcome: "deliver approval.requested to its registered consumers",
    currentOutcome: "delivery stopped after 8 attempts: connection reset",
    impact: { financial: false, authority: false, data: true },
    evidence: ["OutboxEvent:ob-1"],
    relatedRecords: ["ApprovalRequest:ar-1"],
    occurredAt: "2026-08-17T11:00:00.000Z",
    ...over,
  }
}

describe("an exception carries every field Bible §14 requires", () => {
  it("has all eleven display fields, none of them optional", () => {
    const e = buildIntegrationException(input(), NOW)
    for (const field of [
      "sourceObject",
      "intendedOutcome",
      "currentOutcome",
      "impact",
      "retry",
      "remediation",
      "owner",
      "slaMinutes",
      "evidence",
      "relatedRecords",
      "severity",
    ] as const) {
      expect(e[field]).toBeDefined()
    }
    expect(e.remediation.length).toBeGreaterThan(20)
  })

  it("gives every class in the taxonomy an owner and a remediation", () => {
    for (const errorClass of INTEGRATION_ERROR_CLASSES) {
      const e = buildIntegrationException(input({ errorClass }), NOW)
      expect(e.owner).toBeTruthy()
      expect(e.remediation).not.toBe("")
      expect(e.classification).toBe("derived")
    }
  })

  it("dates the SLA from when the failure happened, not from when the list was built", () => {
    const e = buildIntegrationException(
      input({ impact: { financial: false, authority: false, data: false } }),
      NOW,
    )
    // normal severity → 24h SLA, measured from occurredAt (11:00), so 11:00 next day.
    expect(e.slaMinutes).toBe(SLA_MINUTES.normal)
    expect(e.dueAt).toBe("2026-08-18T11:00:00.000Z")
    expect(e.ageMinutes).toBe(60)
    expect(e.breached).toBe(false)
  })

  it("refuses a failure with no usable time — an SLA off an unparseable stamp is meaningless", () => {
    expect(() => buildIntegrationException(input({ occurredAt: "whenever" }), NOW)).toThrow(TypeError)
  })

  it("never reports a negative age when a clock runs ahead", () => {
    const e = buildIntegrationException(input({ occurredAt: "2026-08-17T13:00:00.000Z" }), NOW)
    expect(e.ageMinutes).toBe(0)
  })
})

describe("severity is derived, never supplied", () => {
  it("makes money and authority critical whatever the class is", () => {
    expect(severityOf({ financial: true, authority: false, data: false }, "RATE_LIMITED")).toBe(
      "critical",
    )
    expect(severityOf({ financial: false, authority: true, data: false }, "RATE_LIMITED")).toBe(
      "critical",
    )
  })

  it("ranks an unclassified failure above a classified one of the same impact", () => {
    const impact = { financial: false, authority: false, data: false }
    expect(severityOf(impact, null)).toBe("high")
    expect(severityOf(impact, "RATE_LIMITED")).toBe("normal")
  })

  it("ranks the two 'we do not know' classes high", () => {
    const impact = { financial: false, authority: false, data: false }
    expect(severityOf(impact, "UNKNOWN_OUTCOME")).toBe("high")
    expect(severityOf(impact, "RECONCILIATION_VARIANCE")).toBe("high")
  })
})

describe("an unclassified failure stays unclassified", () => {
  it("says so in the classification field rather than guessing a class", () => {
    const e = buildIntegrationException(input({ errorClass: null }), NOW)
    expect(e.errorClass).toBeNull()
    expect(e.classification).toBe("unclassified")
    expect(e.retry).toBe("reconcile-before-retry")
    expect(e.remediation).toMatch(/not recognised by the taxonomy/)
  })

  it("classifies a stored delivery error only when the text establishes it", () => {
    expect(classifyDeliveryError("event does not satisfy the DomainEvent contract: type missing")).toBe(
      "SCHEMA_INCOMPATIBLE",
    )
    expect(classifyDeliveryError("no consumer is registered for approval.requested")).toBe(
      "REFERENCE_NOT_FOUND",
    )
    // The important half: anything else is null, not a confident neighbour.
    expect(classifyDeliveryError("ECONNRESET")).toBeNull()
    expect(classifyDeliveryError("Something went wrong")).toBeNull()
    expect(classifyDeliveryError(null)).toBeNull()
  })
})

describe("sensitive payloads remain protected", () => {
  it("redacts a credential-shaped value out of every field that carries provider text", () => {
    const leaked = "whsec_0123456789abcdef0123456789abcdef"
    const e = buildIntegrationException(
      input({
        currentOutcome: leaked,
        evidence: ["OutboxEvent:ob-1", leaked],
        relatedRecords: [leaked],
      }),
      NOW,
    )
    expect(e.currentOutcome).toBe(REDACTED)
    expect(e.evidence).toEqual(["OutboxEvent:ob-1", REDACTED])
    expect(e.relatedRecords).toEqual([REDACTED])
    expect(JSON.stringify(e)).not.toContain(leaked)
  })

  it("leaves ordinary text alone — redaction that ate everything would hide the incident", () => {
    const e = buildIntegrationException(input(), NOW)
    expect(e.currentOutcome).toBe("delivery stopped after 8 attempts: connection reset")
    expect(e.evidence).toEqual(["OutboxEvent:ob-1"])
  })
})

describe("the worklist is ordered like a worklist, not a log", () => {
  const items = [
    buildIntegrationException(
      input({
        key: "b-recent-critical",
        impact: { financial: true, authority: false, data: false },
        occurredAt: "2026-08-17T11:59:00.000Z",
      }),
      NOW,
    ),
    buildIntegrationException(
      input({
        key: "c-old-normal",
        impact: { financial: false, authority: false, data: false },
        occurredAt: "2026-08-16T00:00:00.000Z",
      }),
      NOW,
    ),
    buildIntegrationException(
      input({
        key: "a-recent-normal",
        impact: { financial: false, authority: false, data: false },
        occurredAt: "2026-08-17T11:58:00.000Z",
      }),
      NOW,
    ),
  ]

  it("puts a breached SLA first even when it is the least severe", () => {
    // c-old-normal is 36h old against a 24h SLA: breached.
    expect(orderExceptions(items).map((i) => i.key)[0]).toBe("c-old-normal")
  })

  it("orders the rest by severity, then by age", () => {
    expect(orderExceptions(items).map((i) => i.key)).toEqual([
      "c-old-normal",
      "b-recent-critical",
      "a-recent-normal",
    ])
  })

  it("counts what an operator needs before reading a single row", () => {
    const summary = summariseWorklist(items)
    expect(summary.items).toHaveLength(3)
    expect(summary.breached).toBe(1)
    expect(summary.bySeverity.critical).toBe(1)
    expect(summary.bySeverity.normal).toBe(2)
    expect(summary.unclassified).toBe(0)
  })

  it("counts the ones that must not be replayed until somebody establishes the outcome", () => {
    const summary = summariseWorklist([
      ...items,
      buildIntegrationException(input({ key: "d-unknown", errorClass: "UNKNOWN_OUTCOME" }), NOW),
    ])
    expect(summary.needingReconciliation).toBe(1)
  })
})

describe("impact comes from the event type, conservatively", () => {
  it("recognises money and authority", () => {
    expect(impactOfEventType("payment.captured").financial).toBe(true)
    expect(impactOfEventType("ledger.entry.posted").financial).toBe(true)
    expect(impactOfEventType("approval.requested").authority).toBe(true)
    expect(impactOfEventType("role.assigned").authority).toBe(true)
  })

  it("does not downgrade an unrecognised type to nothing", () => {
    const impact = impactOfEventType("something.nobody.listed")
    expect(impact).toEqual({ financial: false, authority: false, data: true })
  })
})

describe("the worklist derived from real dead-lettered deliveries", () => {
  const dead: DeadDelivery[] = [
    {
      outboxId: "ob-100",
      eventType: "payment.captured",
      resourceType: "Settlement",
      resourceId: "st-1",
      attempts: 8,
      lastError: "ECONNRESET",
      deadLetteredAt: "2026-08-17T09:00:00.000Z",
      correlationId: "corr-1",
    },
    {
      outboxId: "ob-101",
      eventType: "approval.requested",
      resourceType: "ApprovalRequest",
      resourceId: "ar-9",
      attempts: 8,
      lastError: "event does not satisfy the DomainEvent contract: resourceId missing",
      deadLetteredAt: "2026-08-17T11:55:00.000Z",
      correlationId: "corr-2",
    },
  ]

  const ports = { deadDeliveries: async () => dead }

  it("produces exactly one item per dead record — it neither hides nor invents", async () => {
    const worklist = await deadDeliveryExceptions(ports, { now: NOW })
    expect(worklist.items).toHaveLength(dead.length)
    expect(worklist.items.map((i) => i.key).sort()).toEqual(["outbox:ob-100", "outbox:ob-101"])
  })

  it("names the real outbox row as evidence", async () => {
    const worklist = await deadDeliveryExceptions(ports, { now: NOW })
    const item = worklist.items.find((i) => i.key === "outbox:ob-100")!
    expect(item.evidence).toContain("OutboxEvent:ob-100")
    expect(item.evidence).toContain("correlationId:corr-1")
    expect(item.relatedRecords).toEqual(["Settlement:st-1"])
  })

  it("leaves an unrecognised delivery error unclassified and severe", async () => {
    const worklist = await deadDeliveryExceptions(ports, { now: NOW })
    const item = worklist.items.find((i) => i.key === "outbox:ob-100")!
    expect(item.classification).toBe("unclassified")
    // financial event type → critical whatever the class
    expect(item.severity).toBe("critical")
    expect(worklist.unclassified).toBe(1)
  })

  it("classifies the one whose stored error our own dispatcher wrote", async () => {
    const worklist = await deadDeliveryExceptions(ports, { now: NOW })
    const item = worklist.items.find((i) => i.key === "outbox:ob-101")!
    expect(item.errorClass).toBe("SCHEMA_INCOMPATIBLE")
    expect(item.classification).toBe("derived")
  })

  it("returns an empty worklist rather than a fabricated one when nothing is dead", async () => {
    const worklist = await deadDeliveryExceptions({ deadDeliveries: async () => [] }, { now: NOW })
    expect(worklist.items).toEqual([])
    expect(worklist.breached).toBe(0)
    expect(worklist.unclassified).toBe(0)
  })
})

describe("§16.8's replay half — the worklist says no where it must", () => {
  it("refuses replay for an unknown outcome, with the reason on the item", () => {
    const e = buildIntegrationException(input({ errorClass: "UNKNOWN_OUTCOME" }), NOW)
    expect(e.replayable).toBe(false)
    expect(e.replayRefusal).toMatch(/not known/)
  })

  it("refuses replay for an unclassified failure — nobody knows what it was", () => {
    const e = buildIntegrationException(input({ errorClass: null }), NOW)
    expect(e.replayable).toBe(false)
  })

  it("refuses replay for work that already finished", () => {
    for (const errorClass of ["DUPLICATE", "BUSINESS_REJECTED", "ACKNOWLEDGED_NOT_SETTLED"] as const) {
      expect(buildIntegrationException(input({ errorClass }), NOW).replayable).toBe(false)
    }
  })

  it("allows replay after a remediation, and for plain transient failures", () => {
    for (const errorClass of ["AUTHENTICATION_FAILED", "TRANSIENT_PROVIDER", "NETWORK_TIMEOUT"] as const) {
      const e = buildIntegrationException(input({ errorClass }), NOW)
      expect(e.replayable).toBe(true)
      expect(e.replayRefusal).toBeNull()
    }
  })

  it("every non-replayable item carries a reason — a disabled button with no reason is a bug report", () => {
    for (const errorClass of INTEGRATION_ERROR_CLASSES) {
      const e = buildIntegrationException(input({ errorClass }), NOW)
      if (!e.replayable) expect(e.replayRefusal).not.toBeNull()
      else expect(e.replayRefusal).toBeNull()
    }
  })
})
