/**
 * PAY-060-001 — the canonical order and attempt machines, and their
 * independence from the provider.
 *
 * Test 1 pins every exported list BY VALUE before anything else runs. A reader
 * that silently returned `[]` would make every "no illegal transition exists"
 * assertion below vacuously true, which is the failure this repository has
 * shipped more than once.
 */

import { SUPPORTED_EVENT_TYPES } from "./api-version"
import {
  ACCOUNT_SCOPED_EVENTS,
  ATTEMPT_TRANSITIONS,
  EVIDENCE_SOURCES,
  NON_SETTLEMENT_EVIDENCE,
  ORDER_TRANSITIONS,
  PAYMENT_ATTEMPT_STATES,
  PAYMENT_CONTROL_STATES,
  PAYMENT_ORDER_STATES,
  SETTLEMENT_STATES,
  advanceAttempt,
  advanceOrder,
  canonicalProviderReadings,
  isTerminalOrderState,
  observeProviderState,
} from "./payment-order-state"

describe("the lists themselves", () => {
  it("are the Bible's, in the Bible's order", () => {
    expect(PAYMENT_ORDER_STATES).toEqual([
      "DRAFT",
      "VALIDATED",
      "APPROVAL_REQUIRED",
      "READY",
      "CUSTOMER_ACTION_REQUIRED",
      "PROCESSING",
      "AUTHORIZED",
      "CAPTURED",
      "SUCCEEDED",
      "SETTLEMENT_PENDING",
      "SETTLED",
      "RECONCILED",
      "CLOSED",
    ])
    expect(PAYMENT_CONTROL_STATES).toEqual([
      "REQUIRES_PAYMENT_METHOD",
      "REQUIRES_CONFIRMATION",
      "REQUIRES_ACTION",
      "CANCELLED",
      "FAILED",
      "PARTIALLY_CAPTURED",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
      "DISPUTED",
      "REVERSED",
      "HELD",
      "EXPIRED",
      "UNKNOWN_PROVIDER_STATE",
    ])
    expect(PAYMENT_ATTEMPT_STATES).toEqual([
      "INITIATED",
      "REQUIRES_ACTION",
      "SUBMITTED",
      "AUTHORIZED",
      "CAPTURED",
      "FAILED",
      "ABANDONED",
      "EXPIRED",
    ])
    expect(NON_SETTLEMENT_EVIDENCE).toEqual([
      "CLIENT_REDIRECT",
      "SYNCHRONOUS_API_RESPONSE",
      "EMAIL",
      "ELAPSED_TIME",
    ])
    expect(SETTLEMENT_STATES).toEqual(["SETTLED", "RECONCILED", "CLOSED"])
  })

  it("gives every state a transition row, and names no state twice", () => {
    const all = [...PAYMENT_ORDER_STATES, ...PAYMENT_CONTROL_STATES]
    expect(new Set(all).size).toBe(all.length)
    for (const state of all) {
      expect(Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS, state)).toBe(true)
    }
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...all].sort())
    // And every destination is itself a modelled state — a row pointing at a
    // typo is a transition that can be taken and never left.
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of tos) {
        expect(all).toContain(to)
        expect(to).not.toBe(from)
      }
    }
    for (const [from, tos] of Object.entries(ATTEMPT_TRANSITIONS)) {
      for (const to of tos) {
        expect(PAYMENT_ATTEMPT_STATES).toContain(to)
        expect(to).not.toBe(from)
      }
    }
  })
})

describe("the order machine is a machine, not a suggestion", () => {
  it("walks the Bible's happy path end to end", () => {
    const path: string[] = [
      "DRAFT",
      "VALIDATED",
      "APPROVAL_REQUIRED",
      "READY",
      "CUSTOMER_ACTION_REQUIRED",
      "PROCESSING",
      "AUTHORIZED",
      "CAPTURED",
      "SUCCEEDED",
      "SETTLEMENT_PENDING",
      "SETTLED",
      "RECONCILED",
      "CLOSED",
    ]
    for (let i = 0; i < path.length - 1; i += 1) {
      const step = advanceOrder({
        from: path[i] as never,
        to: path[i + 1] as never,
        // Settlement-grade evidence throughout, so the only thing under test
        // here is the transition table.
        evidence: "SETTLEMENT_REPORT",
        at: "2026-08-20T00:00:00.000Z",
      })
      expect(step.ok ? step.state : `${path[i]} -> ${path[i + 1]}: ${step.code}`).toBe(path[i + 1])
    }
  })

  it("refuses a skipped step and says what the machine does allow", () => {
    const jump = advanceOrder({
      from: "DRAFT",
      to: "SETTLED",
      evidence: "SETTLEMENT_REPORT",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(jump.ok).toBe(false)
    if (jump.ok) throw new Error("unreachable")
    expect(jump.code).toBe("order-transition-forbidden")
    expect(jump.reason).toContain("VALIDATED")
  })

  it("refuses to leave a terminal state", () => {
    expect(isTerminalOrderState("CLOSED")).toBe(true)
    expect(isTerminalOrderState("CANCELLED")).toBe(true)
    expect(isTerminalOrderState("PROCESSING")).toBe(false)
    const reopen = advanceOrder({
      from: "CANCELLED",
      to: "READY",
      evidence: "OPERATOR",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(reopen.ok).toBe(false)
    if (reopen.ok) throw new Error("unreachable")
    expect(reopen.code).toBe("order-state-terminal")
  })

  it("refuses a provider object state as an order state", () => {
    // "succeeded" is Stripe's word. It is not a state of this machine, and the
    // refusal points at the observation door rather than guessing.
    const wrong = advanceOrder({
      from: "succeeded" as never,
      to: "SETTLED",
      evidence: "SETTLEMENT_REPORT",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) throw new Error("unreachable")
    expect(wrong.code).toBe("order-state-unknown-from")
    expect(wrong.reason).toContain("observeProviderState")
  })
})

describe("Bible §8: four things that are never final settlement", () => {
  it.each(["CLIENT_REDIRECT", "SYNCHRONOUS_API_RESPONSE", "EMAIL", "ELAPSED_TIME"] as const)(
    "refuses SETTLED on %s",
    (evidence) => {
      const attempt = advanceOrder({
        from: "SETTLEMENT_PENDING",
        to: "SETTLED",
        evidence,
        at: "2026-08-20T00:00:00.000Z",
      })
      expect(attempt.ok).toBe(false)
      if (attempt.ok) throw new Error("unreachable")
      expect(attempt.code).toBe("order-settlement-evidence-insufficient")
    },
  )

  it("accepts SETTLED on a settlement report, and on a bank statement", () => {
    for (const evidence of ["SETTLEMENT_REPORT", "BANK_STATEMENT"] as const) {
      const ok = advanceOrder({
        from: "SETTLEMENT_PENDING",
        to: "SETTLED",
        evidence,
        at: "2026-08-20T00:00:00.000Z",
      })
      expect(ok.ok).toBe(true)
    }
  })

  it("still lets a redirect move an order that is NOT claiming settlement", () => {
    // The rule is about settlement, not about redirects. A redirect is perfectly
    // good evidence that the customer came back and the order is processing.
    const ok = advanceOrder({
      from: "CUSTOMER_ACTION_REQUIRED",
      to: "PROCESSING",
      evidence: "CLIENT_REDIRECT",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(ok.ok).toBe(true)
  })

  it("knows every evidence source it is handed, and refuses ones it does not", () => {
    expect(EVIDENCE_SOURCES).toContain("PROVIDER_WEBHOOK")
    const bad = advanceOrder({
      from: "READY",
      to: "PROCESSING",
      evidence: "A_PHONE_CALL" as never,
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error("unreachable")
    expect(bad.code).toBe("order-evidence-unknown")
  })
})

describe("provider events are observations, never transitions", () => {
  it("covers exactly the event types this platform can parse", () => {
    const parsable = SUPPORTED_EVENT_TYPES.map((e) => e.type).sort()
    expect(parsable.length).toBeGreaterThan(0)
    const modelled = [...Object.keys(canonicalProviderReadings()), ...ACCOUNT_SCOPED_EVENTS].sort()
    expect(modelled).toEqual(parsable)
  })

  it("reads a payment event as evidence of a canonical state and applies nothing", () => {
    const seen = observeProviderState("payment_intent.succeeded")
    expect(seen.reading).toBe("CANONICAL")
    expect(seen.observed).toBe("SUCCEEDED")
    expect(seen.note).toContain("not applied")
    // The observation has no `from` and no resulting order. There is nothing in
    // the returned shape that could be mistaken for a state change.
    expect(Object.keys(seen).sort()).toEqual(
      ["note", "observed", "providerState", "reading", "source"].sort(),
    )
  })

  it("separates 'not about an order' from 'we could not read it'", () => {
    const account = observeProviderState("account.updated")
    expect(account.reading).toBe("NOT_A_PAYMENT_ORDER_EVENT")
    expect(account.observed).toBeNull()

    const strange = observeProviderState("payment_intent.partially_funded")
    expect(strange.reading).toBe("UNRECOGNISED")
    expect(strange.observed).toBe("UNKNOWN_PROVIDER_STATE")
  })

  it("still makes the caller pass the transition table with the order's real state", () => {
    // The provider says SUCCEEDED. The order is DRAFT — a replayed or
    // misrouted event. Applying the observation blindly would advance it; the
    // machine refuses, which is the independence the requirement asks for.
    const seen = observeProviderState("payment_intent.succeeded")
    expect(seen.observed).toBe("SUCCEEDED")
    const applied = advanceOrder({
      from: "DRAFT",
      to: seen.observed as never,
      evidence: "PROVIDER_WEBHOOK",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(applied.ok).toBe(false)
    if (applied.ok) throw new Error("unreachable")
    expect(applied.code).toBe("order-transition-forbidden")
  })

  it("cannot claim settlement off a webhook alone where the table forbids it", () => {
    // payout.paid reads as SETTLED. From PROCESSING that is not a transition,
    // so a payout event cannot short-circuit an order that never authorized.
    const seen = observeProviderState("payout.paid")
    expect(seen.observed).toBe("SETTLED")
    const applied = advanceOrder({
      from: "PROCESSING",
      to: "SETTLED",
      evidence: "PROVIDER_WEBHOOK",
      at: "2026-08-20T00:00:00.000Z",
    })
    expect(applied.ok).toBe(false)
  })
})

describe("the attempt machine is a second machine", () => {
  it("has states the order machine does not, and vice versa", () => {
    expect(PAYMENT_ATTEMPT_STATES).toContain("ABANDONED")
    expect([...PAYMENT_ORDER_STATES, ...PAYMENT_CONTROL_STATES]).not.toContain("ABANDONED")
    expect([...PAYMENT_ORDER_STATES]).toContain("RECONCILED")
    expect(PAYMENT_ATTEMPT_STATES).not.toContain("RECONCILED")
  })

  it("refuses an order state handed to it", () => {
    const wrong = advanceAttempt({ from: "INITIATED", to: "SETTLEMENT_PENDING" })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) throw new Error("unreachable")
    expect(wrong.code).toBe("attempt-state-unknown")
  })

  it("makes a retry a new attempt rather than a step out of FAILED", () => {
    const retry = advanceAttempt({ from: "FAILED", to: "SUBMITTED" })
    expect(retry.ok).toBe(false)
    if (retry.ok) throw new Error("unreachable")
    expect(retry.code).toBe("attempt-state-terminal")
    expect(retry.reason).toContain("NEW attempt")
  })

  it("walks initiated → requires action → submitted → authorized → captured", () => {
    const walk: [string, string][] = [
      ["INITIATED", "REQUIRES_ACTION"],
      ["REQUIRES_ACTION", "SUBMITTED"],
      ["SUBMITTED", "AUTHORIZED"],
      ["AUTHORIZED", "CAPTURED"],
    ]
    for (const [from, to] of walk) {
      const step = advanceAttempt({ from, to })
      expect(step.ok ? step.state : `${from}->${to}: ${step.code}`).toBe(to)
    }
  })
})
