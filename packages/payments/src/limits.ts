/**
 * PAY-200-004 — rate, velocity, amount, recipient, account and tenant limits,
 * and what to do when the history they are judged against cannot be read.
 *
 * `refusal.ts` answers "is this KIND of movement allowed at all". It says
 * nothing about how much, how often, or how much in total — so an internal
 * allocation, which `classifyRequest` allows by design, was unbounded. One
 * approval could post any amount, an actor could post any number of them in a
 * second, and two requests each under an approval ceiling summed to whatever
 * their author wanted. Bible §0.9 lists limits alongside maker-checker and
 * step-up as a control one click may never bypass; there was no code behind the
 * word.
 *
 * ## Six limits, because one is not the same control as another
 *
 *   * **rate** — commands by ONE actor in a short window. Bounds automation and
 *     a stolen session, and is the only one of the six that is about tempo
 *     rather than money.
 *   * **velocity** — commands for one TENANT in a longer window. An attacker
 *     with two seats defeats a per-actor rate limit and not this.
 *   * **amount** — the single-posting ceiling. An absolute cap, above the
 *     approval ladder rather than a substitute for it: the ladder decides WHO
 *     may approve, this decides what the path will carry at all.
 *   * **recipient** — everything landing on one payee inside the aggregate
 *     window. This is the split-request control: two $4,000 claims are one
 *     $8,000 claim to the person receiving them.
 *   * **account** — everything landing on one internal dimension (a budget
 *     line, a fund). Catches a single account being drained through many
 *     recipients, which the recipient limit cannot see.
 *   * **tenant** — everything the institution posts in the window. The last
 *     backstop, and the one that holds when every other subject is different.
 *
 * ## Safe failure means the two answers stay different
 *
 * "We looked and found no prior spend" and "we could not look" are not the same
 * fact, and a limit engine that collapses them is worse than no limit at all:
 * the day the read fails is the day every ceiling reads as unused. So
 * `evaluate` takes `LimitObservations | null`, and `null` is `UNVERIFIABLE` —
 * a refusal, with its own code, distinct from `EXCEEDED`. Coverage is checked
 * too: a read that only reaches back an hour cannot answer a 24-hour ceiling,
 * and answering it anyway is the same lie in slower motion.
 *
 * Everything here is pure. The caller does the reading — with the windows this
 * module computes, so the span read and the span judged cannot disagree.
 */

/** The six limits, in the order a decision reports them. */
export const LIMIT_NAMES = [
  "rate",
  "velocity",
  "amount",
  "recipient",
  "account",
  "tenant",
] as const

export type LimitName = (typeof LIMIT_NAMES)[number]

/**
 * The ceilings.
 *
 * Money ceilings are per ISO-4217 code in that currency's own minor units, and
 * a currency the policy does not price is refused rather than compared against
 * whatever the smallest entry happens to be — the same fail-closed reading
 * `exceedsApprovalThreshold` takes, and for the same reason: an unpriced
 * currency must not be the way around every ceiling.
 */
export interface MovementLimitPolicy {
  /** Commands by one actor per `windowSeconds`. */
  rate: { commands: number; windowSeconds: number }
  /** Commands for one tenant per `windowSeconds`. */
  velocity: { commands: number; windowSeconds: number }
  /** The span the three money aggregates are summed over. */
  aggregateWindowSeconds: number
  /**
   * How stale an observation may be, in seconds, before the decision refuses.
   *
   * A ceiling judged against a reading taken ten minutes ago has a ten-minute
   * hole in it, and this path is fast: the read happens in the same request.
   */
  observationMaxAgeSeconds: number
  /** Largest single posting. */
  singleAmount: Readonly<Record<string, number>>
  /** Total to one recipient within the aggregate window. */
  perRecipient: Readonly<Record<string, number>>
  /** Total on one internal account within the aggregate window. */
  perAccount: Readonly<Record<string, number>>
  /** Total for the tenant within the aggregate window. */
  perTenant: Readonly<Record<string, number>>
}

/**
 * The default ceilings, priced for what this platform actually does.
 *
 * A pilot institution's clubs run budgets of a few thousand dollars and
 * reimburse members for supplies, food and travel. So $20,000 is far above any
 * legitimate single claim and far below an amount that could be moved by
 * accident; $50,000 a day to one person, $100,000 on one budget line and
 * $500,000 for the whole institution are each an order of magnitude above the
 * busiest real day and still bounded.
 *
 * USD only, deliberately. The pilot's configured currency is USD
 * (`platform.localization.currency`), and every other currency is refused by
 * `evaluate` until somebody prices it — which is a decision with a number
 * attached rather than an inherited default.
 */
export const DEFAULT_MOVEMENT_LIMITS: MovementLimitPolicy = {
  rate: { commands: 12, windowSeconds: 60 },
  velocity: { commands: 240, windowSeconds: 3600 },
  aggregateWindowSeconds: 86_400,
  observationMaxAgeSeconds: 120,
  singleAmount: { USD: 2_000_000 },
  perRecipient: { USD: 5_000_000 },
  perAccount: { USD: 10_000_000 },
  perTenant: { USD: 50_000_000 },
}

/** The movement being bounded. */
export interface LimitedMovement {
  institutionId: string
  /** Who issued the command. */
  actorPrincipalId: string
  /**
   * Who receives the value, as a stable key.
   *
   * `null` means the movement names nobody — a memo between two dimensions of
   * one legal entity. It does NOT mean "we do not know who": a caller that
   * cannot name a recipient it has must pass `undefined`, which is refused.
   */
  recipientKey: string | null | undefined
  /** The internal dimension it lands on — a budget line, a fund. Same rule. */
  accountKey: string | null | undefined
  amountMinorUnits: number
  currency: string
  /** When the command is being decided. */
  at: string
}

/**
 * What the caller read, and what it read it for.
 *
 * The subject keys are echoed back so a read taken for the wrong recipient
 * cannot be scored against this one. That mistake has no symptom: the ceiling
 * simply looks unused.
 */
export interface LimitObservations {
  /** When the read was taken. */
  observedAt: string
  /** The earliest instant the read covers. */
  coversSince: string
  /** Commands by this actor inside the rate window. */
  actorCommands: number
  /** Commands for this tenant inside the velocity window. */
  tenantCommands: number
  /** Minor units already landed on this recipient inside the aggregate window. */
  recipientPriorMinorUnits: number
  /** Minor units already landed on this account inside the aggregate window. */
  accountPriorMinorUnits: number
  /** Minor units already posted by this tenant inside the aggregate window. */
  tenantPriorMinorUnits: number
  /** The currency every aggregate above is counted in. */
  currency: string
  /** The recipient the aggregate was read for. */
  recipientKey: string | null
  /** The account the aggregate was read for. */
  accountKey: string | null
}

export type LimitVerdict = "WITHIN_LIMITS" | "EXCEEDED" | "UNVERIFIABLE"

export interface LimitBreach {
  limit: LimitName
  code: string
  ceiling: number
  /** The value compared against the ceiling, this movement included. */
  observed: number
  reason: string
}

export interface LimitDecision {
  verdict: LimitVerdict
  /** Stable code an audit row records and a test asserts on. */
  code: string
  reason: string
  /** Every breach, in `LIMIT_NAMES` order. Empty unless `EXCEEDED`. */
  breaches: readonly LimitBreach[]
  /**
   * Limits that did not apply, and were therefore not checked.
   *
   * Recorded rather than skipped silently: "the recipient ceiling did not apply
   * because this movement names no recipient" is a fact a reviewer needs, and a
   * quiet skip is indistinguishable from a pass.
   */
  notApplicable: readonly LimitName[]
}

/**
 * The windows a caller must read, derived from the policy it will be judged by.
 *
 * Exported so the read and the decision cannot disagree about the span. A
 * caller computing its own `since` is how a 24-hour ceiling comes to be scored
 * against an hour of history.
 */
export function observationWindows(
  policy: MovementLimitPolicy,
  at: string,
): { rateSince: string; velocitySince: string; aggregateSince: string; earliest: string } {
  const instant = Date.parse(at)
  if (Number.isNaN(instant)) {
    throw new RangeError(`"${at}" is not a readable instant, so no window can be derived from it.`)
  }
  const back = (seconds: number): string => new Date(instant - seconds * 1000).toISOString()
  const earliestSeconds = Math.max(
    policy.rate.windowSeconds,
    policy.velocity.windowSeconds,
    policy.aggregateWindowSeconds,
  )
  return {
    rateSince: back(policy.rate.windowSeconds),
    velocitySince: back(policy.velocity.windowSeconds),
    aggregateSince: back(policy.aggregateWindowSeconds),
    earliest: back(earliestSeconds),
  }
}

const MAX_EXACT = Number.MAX_SAFE_INTEGER

function unverifiable(code: string, reason: string): LimitDecision {
  return { verdict: "UNVERIFIABLE", code, reason, breaches: [], notApplicable: [] }
}

function wholeNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

/**
 * Decide whether this movement is inside every applicable ceiling.
 *
 * Returns `UNVERIFIABLE` — never `WITHIN_LIMITS` — whenever the inputs cannot
 * support the comparison. There is no path through this function that treats an
 * unreadable history as an empty one.
 */
export function evaluate(
  movement: LimitedMovement,
  observations: LimitObservations | null,
  policy: MovementLimitPolicy = DEFAULT_MOVEMENT_LIMITS,
): LimitDecision {
  const at = Date.parse(movement.at)
  if (Number.isNaN(at)) {
    return unverifiable(
      "limits-instant-unreadable",
      `"${movement.at}" is not a readable instant. A window cannot be placed on a timeline that ` +
        `has no point on it, so no ceiling can be checked.`,
    )
  }

  if (!wholeNonNegative(movement.amountMinorUnits)) {
    return unverifiable(
      "limits-amount-unusable",
      `${movement.amountMinorUnits} is not a whole, non-negative count of minor units. An amount ` +
        `this control cannot read is one it cannot bound.`,
    )
  }

  if (observations === null) {
    return unverifiable(
      "limits-unreadable",
      `The spend history behind these ceilings could not be read, so every ceiling would read as ` +
        `unused. "We could not look" is not "we looked and found nothing": this movement is ` +
        `refused rather than allowed against a history nobody has seen.`,
    )
  }

  if (movement.recipientKey === undefined || movement.accountKey === undefined) {
    return unverifiable(
      "limits-subject-unnamed",
      `A movement whose recipient or account this control cannot name is one whose per-recipient ` +
        `and per-account ceilings cannot be applied. Pass null to say "there is none"; undefined ` +
        `says "we do not know", and that is a refusal.`,
    )
  }

  if (observations.currency !== movement.currency) {
    return unverifiable(
      "limits-currency-mismatched",
      `This movement is ${movement.currency} and the history read for it is counted in ` +
        `${observations.currency}. Summing minor units across currencies produces a number that ` +
        `means nothing, and comparing it to a ceiling gives that number authority.`,
    )
  }

  if (observations.recipientKey !== movement.recipientKey) {
    return unverifiable(
      "limits-observations-mismatched",
      `The per-recipient history was read for ${JSON.stringify(observations.recipientKey)} and ` +
        `this movement pays ${JSON.stringify(movement.recipientKey)}. A ceiling scored against ` +
        `somebody else's history looks unused, which is the failure with no symptom.`,
    )
  }

  if (observations.accountKey !== movement.accountKey) {
    return unverifiable(
      "limits-observations-mismatched",
      `The per-account history was read for ${JSON.stringify(observations.accountKey)} and this ` +
        `movement lands on ${JSON.stringify(movement.accountKey)}.`,
    )
  }

  const counts: readonly (readonly [string, number])[] = [
    ["actorCommands", observations.actorCommands],
    ["tenantCommands", observations.tenantCommands],
    ["recipientPriorMinorUnits", observations.recipientPriorMinorUnits],
    ["accountPriorMinorUnits", observations.accountPriorMinorUnits],
    ["tenantPriorMinorUnits", observations.tenantPriorMinorUnits],
  ]
  for (const [field, value] of counts) {
    if (!wholeNonNegative(value)) {
      return unverifiable(
        "limits-observations-unusable",
        `The history read for this movement reports ${field} = ${value}, which is not a whole, ` +
          `non-negative number. A reading this control cannot interpret is not a reading.`,
      )
    }
  }

  const observedAt = Date.parse(observations.observedAt)
  const coversSince = Date.parse(observations.coversSince)
  if (Number.isNaN(observedAt) || Number.isNaN(coversSince)) {
    return unverifiable(
      "limits-observations-undated",
      `A reading with no usable date cannot be shown to cover the window it is being used to ` +
        `answer (observedAt ${JSON.stringify(observations.observedAt)}, coversSince ` +
        `${JSON.stringify(observations.coversSince)}).`,
    )
  }

  const ageSeconds = (at - observedAt) / 1000
  if (ageSeconds < 0 || ageSeconds > policy.observationMaxAgeSeconds) {
    return unverifiable(
      "limits-observations-stale",
      `The history was read at ${observations.observedAt} and this movement is being decided at ` +
        `${movement.at} — ${Math.round(ageSeconds)}s apart, against a tolerance of ` +
        `${policy.observationMaxAgeSeconds}s. A ceiling judged against a reading with a hole in ` +
        `it is a ceiling with a hole in it.`,
    )
  }

  const windows = observationWindows(policy, movement.at)
  const required = Date.parse(windows.earliest)
  if (coversSince > required) {
    return unverifiable(
      "limits-window-not-covered",
      `These ceilings are measured back to ${windows.earliest} and the reading only reaches ` +
        `${observations.coversSince}. The part of the window nobody looked at is exactly where the ` +
        `spend that breaches a ceiling would be.`,
    )
  }

  const priced: readonly (readonly [LimitName, Readonly<Record<string, number>>])[] = [
    ["amount", policy.singleAmount],
    ["recipient", policy.perRecipient],
    ["account", policy.perAccount],
    ["tenant", policy.perTenant],
  ]
  for (const [limit, table] of priced) {
    if (limit === "recipient" && movement.recipientKey === null) continue
    if (limit === "account" && movement.accountKey === null) continue
    const ceiling = table[movement.currency]
    if (!wholeNonNegative(ceiling)) {
      return unverifiable(
        "limits-currency-unpriced",
        `No ${limit} ceiling is priced in ${movement.currency}. An unpriced currency is refused ` +
          `rather than compared against another currency's number, because otherwise publishing an ` +
          `amount in an unpriced currency is the way around every ceiling.`,
      )
    }
  }

  const breaches: LimitBreach[] = []
  const notApplicable: LimitName[] = []

  const actorCommands = observations.actorCommands + 1
  if (actorCommands > policy.rate.commands) {
    breaches.push({
      limit: "rate",
      code: "limits-rate-exceeded",
      ceiling: policy.rate.commands,
      observed: actorCommands,
      reason:
        `${movement.actorPrincipalId} has issued ${observations.actorCommands} money commands in ` +
        `the last ${policy.rate.windowSeconds}s; this one would be number ${actorCommands}, and ` +
        `the ceiling is ${policy.rate.commands}.`,
    })
  }

  const tenantCommands = observations.tenantCommands + 1
  if (tenantCommands > policy.velocity.commands) {
    breaches.push({
      limit: "velocity",
      code: "limits-velocity-exceeded",
      ceiling: policy.velocity.commands,
      observed: tenantCommands,
      reason:
        `${movement.institutionId} has issued ${observations.tenantCommands} money commands in the ` +
        `last ${policy.velocity.windowSeconds}s; this one would be number ${tenantCommands}, and ` +
        `the ceiling is ${policy.velocity.commands}.`,
    })
  }

  const singleCeiling = policy.singleAmount[movement.currency] as number
  if (movement.amountMinorUnits > singleCeiling) {
    breaches.push({
      limit: "amount",
      code: "limits-amount-exceeded",
      ceiling: singleCeiling,
      observed: movement.amountMinorUnits,
      reason:
        `${movement.amountMinorUnits} ${movement.currency} minor units is above the ` +
        `${singleCeiling} single-posting ceiling. This is an absolute cap, not an approval ` +
        `threshold: no seat raises it.`,
    })
  }

  const aggregates: readonly (readonly [LimitName, string, number, number, string | null])[] = [
    [
      "recipient",
      "limits-recipient-exceeded",
      observations.recipientPriorMinorUnits,
      policy.perRecipient[movement.currency] as number,
      movement.recipientKey,
    ],
    [
      "account",
      "limits-account-exceeded",
      observations.accountPriorMinorUnits,
      policy.perAccount[movement.currency] as number,
      movement.accountKey,
    ],
    [
      "tenant",
      "limits-tenant-exceeded",
      observations.tenantPriorMinorUnits,
      policy.perTenant[movement.currency] as number,
      movement.institutionId,
    ],
  ]

  for (const [limit, code, prior, ceiling, subject] of aggregates) {
    if (subject === null) {
      notApplicable.push(limit)
      continue
    }
    if (prior > MAX_EXACT - movement.amountMinorUnits) {
      return unverifiable(
        "limits-total-overflows",
        `The ${limit} total for ${subject} plus this movement exceeds exact integer arithmetic. ` +
          `Refused rather than compared as a float, which is how a ceiling comes to be judged by a ` +
          `number that is not the total.`,
      )
    }
    const total = prior + movement.amountMinorUnits
    if (total > ceiling) {
      breaches.push({
        limit,
        code,
        ceiling,
        observed: total,
        reason:
          `${prior} ${movement.currency} minor units have already landed on ${subject} since ` +
          `${windows.aggregateSince}; this movement of ${movement.amountMinorUnits} would take it ` +
          `to ${total}, against a ceiling of ${ceiling}. Splitting one movement into several does ` +
          `not lower this total.`,
      })
    }
  }

  breaches.sort((a, b) => LIMIT_NAMES.indexOf(a.limit) - LIMIT_NAMES.indexOf(b.limit))

  if (breaches.length > 0) {
    return {
      verdict: "EXCEEDED",
      code: breaches[0].code,
      reason: breaches.map((b) => b.reason).join(" "),
      breaches,
      notApplicable,
    }
  }

  return {
    verdict: "WITHIN_LIMITS",
    code: "limits-within",
    reason:
      `Inside every applicable ceiling, judged against a reading taken at ${observations.observedAt} ` +
      `covering back to ${observations.coversSince}.`,
    breaches: [],
    notApplicable,
  }
}
