/**
 * PAY-060-001 — the canonical payment order and attempt state machines.
 *
 * Bible §8: "State model separates business order, provider intent, attempt,
 * authorization, capture, settlement, refund and dispute. Never treat a client
 * redirect, synchronous API response, email or elapsed time as final
 * settlement." Two machines, therefore, not one — an order that has three
 * failed attempts and one live one is a single order, and collapsing the two
 * loses the sentence "this order is still open".
 *
 * "Independent of Stripe object state" is the whole requirement, and it is
 * enforced three ways rather than asserted in a comment:
 *
 *   1. **The state sets are not the provider's.** `SETTLEMENT_PENDING`,
 *      `RECONCILED` and `CLOSED` have no provider object behind them; a
 *      provider considers a payment finished at `succeeded`, and Tenure does
 *      not consider it finished until the money has been seen on a settlement
 *      and tied to a journal.
 *   2. **A provider event produces an OBSERVATION, never a transition.**
 *      `observeProviderState` returns what an event is evidence OF. It cannot
 *      move an order, and it does not know what state the order is in. Applying
 *      it is a second, separate call that re-validates against the transition
 *      table — so an out-of-order or replayed event cannot walk an order
 *      backwards or skip a step.
 *   3. **An unrecognised provider state maps to `UNKNOWN_PROVIDER_STATE`**, not
 *      to the nearest plausible canonical state. "We looked and this event
 *      means nothing we model" and "this event means the payment succeeded" are
 *      different answers, and a mapping table with a fallthrough default
 *      collapses them.
 *
 * Pure: no provider client, no node builtin, no clock. `at` is passed in where
 * time matters, so the tests are not calibrated to the machine they run on.
 */

/** The lifecycle Bible §8 states, in its order. */
export const PAYMENT_ORDER_STATES = [
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
] as const

export type PaymentOrderState = (typeof PAYMENT_ORDER_STATES)[number]

/** The control and failure states Bible §8 lists, verbatim. */
export const PAYMENT_CONTROL_STATES = [
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
] as const

export type PaymentControlState = (typeof PAYMENT_CONTROL_STATES)[number]

export type PaymentState = PaymentOrderState | PaymentControlState

/**
 * The attempt machine. One order has many of these.
 *
 * Deliberately NOT a subset of the order states: an attempt can be `ABANDONED`
 * — the customer closed the tab — which is not a thing an order is, and an
 * order can be `RECONCILED`, which is not a thing an attempt is.
 */
export const PAYMENT_ATTEMPT_STATES = [
  "INITIATED",
  "REQUIRES_ACTION",
  "SUBMITTED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "ABANDONED",
  "EXPIRED",
] as const

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number]

/**
 * Where a claim about a payment came from.
 *
 * Bible §8 names four things that are never final settlement. They are values
 * here rather than a rule in a comment, so a caller that has only a redirect
 * cannot phrase it as anything else.
 */
export const EVIDENCE_SOURCES = [
  "CLIENT_REDIRECT",
  "SYNCHRONOUS_API_RESPONSE",
  "EMAIL",
  "ELAPSED_TIME",
  "PROVIDER_WEBHOOK",
  "PROVIDER_LOOKUP",
  "SETTLEMENT_REPORT",
  "BANK_STATEMENT",
  "OPERATOR",
] as const

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

/** The four Bible §8 forbids as proof of settlement. */
export const NON_SETTLEMENT_EVIDENCE: readonly EvidenceSource[] = [
  "CLIENT_REDIRECT",
  "SYNCHRONOUS_API_RESPONSE",
  "EMAIL",
  "ELAPSED_TIME",
]

/** States that may only be entered on evidence that money actually moved. */
export const SETTLEMENT_STATES: readonly PaymentState[] = ["SETTLED", "RECONCILED", "CLOSED"]

/**
 * The order transition table. Absent means forbidden.
 *
 * Every control state is reachable from the states where it can truthfully
 * occur and from nowhere else: an order cannot be `DISPUTED` before it has been
 * captured, and it cannot be `EXPIRED` after it has succeeded.
 */
export const ORDER_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  DRAFT: ["VALIDATED", "CANCELLED", "EXPIRED", "REQUIRES_PAYMENT_METHOD"],
  VALIDATED: ["APPROVAL_REQUIRED", "READY", "CANCELLED", "EXPIRED", "HELD"],
  APPROVAL_REQUIRED: ["READY", "CANCELLED", "EXPIRED", "HELD"],
  READY: [
    "CUSTOMER_ACTION_REQUIRED",
    "PROCESSING",
    "REQUIRES_PAYMENT_METHOD",
    "REQUIRES_CONFIRMATION",
    "CANCELLED",
    "EXPIRED",
    "HELD",
  ],
  CUSTOMER_ACTION_REQUIRED: ["PROCESSING", "REQUIRES_ACTION", "CANCELLED", "EXPIRED", "FAILED"],
  PROCESSING: [
    "AUTHORIZED",
    "SUCCEEDED",
    "REQUIRES_ACTION",
    "FAILED",
    "HELD",
    "UNKNOWN_PROVIDER_STATE",
  ],
  AUTHORIZED: ["CAPTURED", "PARTIALLY_CAPTURED", "CANCELLED", "FAILED", "EXPIRED", "HELD"],
  CAPTURED: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "REVERSED"],
  SUCCEEDED: ["SETTLEMENT_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "HELD"],
  SETTLEMENT_PENDING: ["SETTLED", "REVERSED", "DISPUTED", "HELD", "UNKNOWN_PROVIDER_STATE"],
  SETTLED: ["RECONCILED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "REVERSED"],
  RECONCILED: ["CLOSED", "DISPUTED", "REVERSED"],
  CLOSED: [],
  REQUIRES_PAYMENT_METHOD: ["READY", "CANCELLED", "EXPIRED"],
  REQUIRES_CONFIRMATION: ["PROCESSING", "CANCELLED", "EXPIRED"],
  REQUIRES_ACTION: ["PROCESSING", "FAILED", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  FAILED: ["READY", "CLOSED"],
  PARTIALLY_CAPTURED: ["CAPTURED", "SUCCEEDED", "PARTIALLY_REFUNDED", "DISPUTED", "REVERSED"],
  PARTIALLY_REFUNDED: ["REFUNDED", "SETTLEMENT_PENDING", "DISPUTED", "CLOSED"],
  REFUNDED: ["SETTLEMENT_PENDING", "DISPUTED", "CLOSED"],
  DISPUTED: ["REVERSED", "SETTLEMENT_PENDING", "CLOSED"],
  REVERSED: ["SETTLEMENT_PENDING", "CLOSED"],
  HELD: ["READY", "PROCESSING", "CANCELLED", "FAILED"],
  EXPIRED: ["CLOSED"],
  // Not a resting place and not a dead end. An order whose provider state
  // nobody recognises is investigated, and investigation ends in a human
  // saying which of these it was.
  UNKNOWN_PROVIDER_STATE: ["PROCESSING", "SETTLEMENT_PENDING", "FAILED", "HELD"],
}

/** The attempt transition table. Separate machine, separate table. */
export const ATTEMPT_TRANSITIONS: Readonly<
  Record<PaymentAttemptState, readonly PaymentAttemptState[]>
> = {
  INITIATED: ["REQUIRES_ACTION", "SUBMITTED", "FAILED", "ABANDONED", "EXPIRED"],
  REQUIRES_ACTION: ["SUBMITTED", "FAILED", "ABANDONED", "EXPIRED"],
  SUBMITTED: ["AUTHORIZED", "CAPTURED", "FAILED"],
  AUTHORIZED: ["CAPTURED", "FAILED", "EXPIRED"],
  CAPTURED: [],
  FAILED: [],
  ABANDONED: [],
  EXPIRED: [],
}

export interface TransitionRefusal {
  ok: false
  code: string
  reason: string
}

export interface OrderTransitionAccepted {
  ok: true
  state: PaymentOrderState | PaymentControlState
  from: PaymentState
  /** What justified it. Recorded so the transition can be re-read later. */
  evidence: EvidenceSource
  at: string
}

export type OrderTransition = OrderTransitionAccepted | TransitionRefusal

export interface AdvanceOrderInput {
  from: PaymentState
  to: PaymentState
  evidence: EvidenceSource
  /** ISO-8601. Passed in, never read from a clock inside this module. */
  at: string
}

/**
 * Move one order, or refuse and say why.
 *
 * Refuses in four ways, and they are four different sentences because they are
 * four different problems: a state this machine does not model, a transition
 * the table forbids, a settlement claimed on evidence that cannot prove
 * settlement, and a terminal state being left.
 */
export function advanceOrder(input: AdvanceOrderInput): OrderTransition {
  const known = (state: string): state is PaymentState =>
    (PAYMENT_ORDER_STATES as readonly string[]).includes(state) ||
    (PAYMENT_CONTROL_STATES as readonly string[]).includes(state)

  if (!known(input.from)) {
    return {
      ok: false,
      code: "order-state-unknown-from",
      reason:
        `"${input.from}" is not a state of the canonical payment order. It may be a provider ` +
        `object state; those are observations (see observeProviderState) and are never an order's ` +
        `state directly.`,
    }
  }
  if (!known(input.to)) {
    return {
      ok: false,
      code: "order-state-unknown-to",
      reason:
        `"${input.to}" is not a state of the canonical payment order. Adding a state means adding ` +
        `it to PAYMENT_ORDER_STATES or PAYMENT_CONTROL_STATES and giving it a row in ` +
        `ORDER_TRANSITIONS; a state with no row is unreachable rather than unrestricted.`,
    }
  }
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(input.evidence)) {
    return {
      ok: false,
      code: "order-evidence-unknown",
      reason:
        `"${input.evidence}" is not an evidence source. A transition with unclassifiable evidence ` +
        `is a transition nobody can later say the grounds for.`,
    }
  }

  const allowed = ORDER_TRANSITIONS[input.from]
  if (allowed.length === 0) {
    return {
      ok: false,
      code: "order-state-terminal",
      reason:
        `${input.from} is terminal: nothing follows it. Reopening a closed or cancelled order is a ` +
        `new order that references it, not a transition out of it.`,
    }
  }
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      code: "order-transition-forbidden",
      reason:
        `${input.from} -> ${input.to} is not a transition this machine has. From ${input.from} the ` +
        `machine goes to ${allowed.join(", ")}.`,
    }
  }

  if (SETTLEMENT_STATES.includes(input.to) && NON_SETTLEMENT_EVIDENCE.includes(input.evidence)) {
    return {
      ok: false,
      code: "order-settlement-evidence-insufficient",
      reason:
        `${input.to} claims the money has settled, and the evidence offered is ${input.evidence}. ` +
        `Bible §8: a client redirect, a synchronous API response, an email and elapsed time are ` +
        `never final settlement. A settlement report, a bank statement or a provider lookup is.`,
    }
  }

  return { ok: true, state: input.to, from: input.from, evidence: input.evidence, at: input.at }
}

/** Move one attempt, or refuse. Same shape, different table. */
export function advanceAttempt(input: {
  from: PaymentAttemptState | string
  to: PaymentAttemptState | string
}): { ok: true; state: PaymentAttemptState } | TransitionRefusal {
  const known = (s: string): s is PaymentAttemptState =>
    (PAYMENT_ATTEMPT_STATES as readonly string[]).includes(s)
  if (!known(input.from) || !known(input.to)) {
    return {
      ok: false,
      code: "attempt-state-unknown",
      reason:
        `An attempt goes between ${PAYMENT_ATTEMPT_STATES.join(", ")}. "${input.from}" -> ` +
        `"${input.to}" names something outside that set — an order state, most likely, and the ` +
        `two machines are separate on purpose.`,
    }
  }
  const allowed = ATTEMPT_TRANSITIONS[input.from]
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      code: allowed.length === 0 ? "attempt-state-terminal" : "attempt-transition-forbidden",
      reason:
        allowed.length === 0
          ? `${input.from} is terminal for an attempt. A retry is a NEW attempt on the same order.`
          : `${input.from} -> ${input.to} is not an attempt transition. From ${input.from}: ${allowed.join(", ")}.`,
    }
  }
  return { ok: true, state: input.to }
}

/**
 * Three answers, because there are three cases and two of them are routinely
 * collapsed: the event means something to a payment order, the event is about
 * something that is not a payment order, and we cannot read the event at all.
 * A reader that returns `UNKNOWN_PROVIDER_STATE` for the middle case says "we
 * could not look" about an event that was perfectly legible.
 */
export type ProviderReading = "CANONICAL" | "NOT_A_PAYMENT_ORDER_EVENT" | "UNRECOGNISED"

export interface ProviderObservation {
  /** The provider event or object state that was read. */
  providerState: string
  /**
   * What that is evidence OF, in canonical terms. Never applied by this call.
   * Null when the event is not about a payment order at all.
   */
  observed: PaymentState | null
  reading: ProviderReading
  source: EvidenceSource
  note: string
}

/**
 * The provider event types Tenure has a canonical payment-order reading for.
 *
 * A deliberate, closed table, and `payment-order-state.test.ts` holds it
 * against `SUPPORTED_EVENT_TYPES`: every event type this platform has a parser
 * for appears here or in `ACCOUNT_SCOPED_EVENTS`, and nothing appears in either
 * that has no parser. A mapping for an event nobody can read is a mapping
 * nobody can trust, and a parsed event with no mapping is a silent hole.
 */
const PROVIDER_STATE_READINGS: Readonly<Record<string, PaymentState>> = {
  "payment_intent.succeeded": "SUCCEEDED",
  "payment_intent.payment_failed": "FAILED",
  "charge.refunded": "REFUNDED",
  "charge.dispute.created": "DISPUTED",
  "payout.paid": "SETTLED",
  "payout.failed": "REVERSED",
}

/**
 * Supported events that carry no payment-order meaning.
 *
 * `account.updated` changes what a connected account may do. It says nothing
 * about any order, and answering "unknown" for it would put a legible event in
 * the same bucket as an unreadable one.
 */
export const ACCOUNT_SCOPED_EVENTS: readonly string[] = ["account.updated"]

/** Read-only view of the canonical mapping, for tests and for documentation. */
export function canonicalProviderReadings(): Readonly<Record<string, PaymentState>> {
  return { ...PROVIDER_STATE_READINGS }
}

/**
 * Read a provider event as evidence. It moves nothing.
 *
 * The return type has no transition in it — no `from`, no resulting order —
 * because this function does not know and must not guess what state the order
 * was in. A caller that wants to act on it calls `advanceOrder` with the order's
 * real current state, and the table gets its say. That is the difference between
 * "the provider says succeeded" and "this order is now SUCCEEDED", and the two
 * are not the same claim when the event is a replay of one from an hour ago.
 */
export function observeProviderState(
  providerState: string,
  source: EvidenceSource = "PROVIDER_WEBHOOK",
): ProviderObservation {
  if (ACCOUNT_SCOPED_EVENTS.includes(providerState)) {
    return {
      providerState,
      observed: null,
      reading: "NOT_A_PAYMENT_ORDER_EVENT",
      source,
      note:
        `"${providerState}" is about a connected account, not about a payment order. It is read, ` +
        `and it moves no order — which is a different answer from "we could not read it".`,
    }
  }
  const reading = Object.prototype.hasOwnProperty.call(PROVIDER_STATE_READINGS, providerState)
    ? PROVIDER_STATE_READINGS[providerState]
    : null
  if (reading === null) {
    return {
      providerState,
      observed: "UNKNOWN_PROVIDER_STATE",
      reading: "UNRECOGNISED",
      source,
      note:
        `"${providerState}" has no canonical reading. It is recorded as UNKNOWN_PROVIDER_STATE ` +
        `rather than mapped to the nearest plausible state: an event we cannot read and an event ` +
        `meaning success are different answers.`,
    }
  }
  return {
    providerState,
    observed: reading,
    reading: "CANONICAL",
    source,
    note:
      `"${providerState}" is evidence of ${reading}. It is not applied here — Bible §4: provider ` +
      `webhooks are evidence, not automatically authoritative business permission.`,
  }
}

/** True when nothing follows this state. */
export function isTerminalOrderState(state: PaymentState): boolean {
  return ORDER_TRANSITIONS[state].length === 0
}
