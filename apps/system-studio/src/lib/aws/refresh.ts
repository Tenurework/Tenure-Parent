/**
 * STUDIO-140-007 (client half) — the loop that keeps a served page current.
 *
 * ## The half that was missing
 *
 * `capabilities.ts` argues a `refreshMs` per resource; `api/aws/[surface]/route.ts`
 * puts that number on every response as `x-aws-refresh-ms`, on the 200, on the
 * 304 that has no body to carry it, and on the problem documents. Until this
 * module existed `grep -rn "x-aws-refresh-ms" src` found the header EMITTED and
 * consumed nowhere: every AWS-backed page was a server-rendered snapshot,
 * correct at load and frozen until a human pressed reload. The permissions were
 * there, the cadence was there, the contract was there — the loop was not.
 *
 * ## Four rules, and each one is a decision this file makes alone
 *
 *   1. **The interval is the server's, never this file's.** `statedIntervalMs`
 *      returns null when the response stated nothing, and a null delay STOPS the
 *      loop. There is no fallback constant anywhere in this module, because a
 *      fallback constant is exactly how a client ends up polling a
 *      twenty-four-hour price list every five seconds — and a throttled read is
 *      how a page starts lying.
 *   2. **Never faster than any instruction on the response.** Three headers can
 *      each state a floor (`retry-after`, `x-poll-after-ms`, `x-aws-refresh-ms`)
 *      and they disagree on purpose: a 429 says "not for two seconds" while the
 *      capability says "nothing changes inside five minutes". Taking the LARGEST
 *      obeys all of them at once; taking the first one found obeys whichever
 *      happens to be listed first.
 *   3. **Failures slow down.** `backoffMultiplier` doubles from the second
 *      consecutive failure and caps at eight, so a surface that comes back is
 *      picked up again within a bounded time rather than in an hour, and a
 *      surface that is down is not hammered. The BASE is still the server's
 *      number — backoff makes the client slower than it was told, never faster.
 *   4. **A failed read never overwrites a good value.** `afterFailure` carries
 *      `value` and `valueAt` across untouched, by construction. This is the
 *      client half of what the route already guarantees on the wire: a live
 *      surface never returns rows and a failure in the same response, so "a
 *      failed poll carries no rows, so it cannot overwrite a good value"
 *      (`e2e/api-contract.spec.ts`) has a client that honours it rather than a
 *      client that blanks the table anyway.
 *
 * ## No imports, deliberately
 *
 * Not React, not the capability registry, not a formatter. Every decision here
 * is arithmetic over a response's headers, and a module with no imports is one a
 * Playwright spec can require directly with no browser, no server and no
 * credentials — which is how the four rules above are driven at the node level
 * in `e2e/live-refresh.spec.ts` before a pixel is rendered.
 */

/* ------------------------------------------------------ what the server said -- */

/** The subset of `Headers` this module needs. Structural, so a test can pass a Map-alike. */
export interface HeaderBag {
  get(name: string): string | null
}

/** Every cadence instruction one response carried. Each field is null when absent. */
export interface CadenceStatement {
  /** `x-aws-refresh-ms` — the capability's own argued cadence. */
  refreshMs: number | null
  /** `x-poll-after-ms` — how long before asking again is worth anything. */
  pollAfterMs: number | null
  /** `retry-after`, in milliseconds. Seconds on the wire, as HTTP spells it. */
  retryAfterMs: number | null
  /** `x-aws-read-state` — ACTUAL, EMPTY, STALE, DENIED, THROTTLED, … */
  state: string | null
  /** `x-aws-as-of` — the instant the reading is true at. */
  asOf: string | null
  /** `x-throttle-origin`: `control-plane` when this engine said slow down, `aws` when AWS did. */
  throttleOrigin: string | null
}

const EMPTY_CADENCE: CadenceStatement = {
  refreshMs: null,
  pollAfterMs: null,
  retryAfterMs: null,
  state: null,
  asOf: null,
  throttleOrigin: null,
}

/** A cadence statement from a response that never arrived. States nothing. */
export function noCadence(): CadenceStatement {
  return { ...EMPTY_CADENCE }
}

/**
 * A positive whole number of milliseconds, or null.
 *
 * Zero and negative are null rather than "poll immediately": a header saying
 * `x-poll-after-ms: 0` would otherwise become a hot loop against a surface whose
 * own route computed the zero from a missing cadence.
 */
function positiveMs(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw.trim())
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

export function readCadence(headers: HeaderBag): CadenceStatement {
  const retryAfterSeconds = positiveMs(headers.get("retry-after"))
  const asOf = headers.get("x-aws-as-of")
  return {
    refreshMs: positiveMs(headers.get("x-aws-refresh-ms")),
    pollAfterMs: positiveMs(headers.get("x-poll-after-ms")),
    // `Retry-After` is seconds in HTTP and milliseconds everywhere else in this
    // engine. Converting here is what keeps the comparison in `statedIntervalMs`
    // between three numbers in the same unit.
    retryAfterMs: retryAfterSeconds === null ? null : retryAfterSeconds * 1000,
    state: headers.get("x-aws-read-state"),
    asOf: asOf === null || asOf.trim() === "" ? null : asOf,
    throttleOrigin: headers.get("x-throttle-origin"),
  }
}

/**
 * The interval this response instructs, or null when it instructed none.
 *
 * The largest of everything stated — see rule 2 above. Null is not "use a
 * default"; there is no default. It means the response said nothing about when
 * to ask again, and the only honest thing a client can do with that is stop and
 * say the screen is a snapshot.
 */
export function statedIntervalMs(cadence: CadenceStatement): number | null {
  const stated = [cadence.retryAfterMs, cadence.pollAfterMs, cadence.refreshMs].filter(
    (value): value is number => value !== null,
  )
  return stated.length === 0 ? null : Math.max(...stated)
}

/** The ceiling on how far a run of failures may stretch the server's interval. */
export const MAX_BACKOFF_MULTIPLIER = 8

/**
 * How much slower than instructed a client polls after `failures` consecutive
 * failures.
 *
 * One on the first failure — the server's `Retry-After` IS the backoff, and
 * multiplying it would ignore the number it just gave. Doubling from the second,
 * capped at eight so a surface that recovers is picked up within eight intervals
 * rather than after an unbounded exponential run.
 */
export function backoffMultiplier(failures: number): number {
  if (failures <= 1) return 1
  return Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** (failures - 1))
}

/* ------------------------------------------------------------- the state ---- */

/** The value a live region is showing. Only ever replaced by a SUCCESSFUL read. */
export interface LiveValue {
  /** Rows in the envelope. `atLeast` when a `nextCursor` says there are more. */
  count: number
  /** True when the count is one page of a longer list, so it is a floor. */
  atLeast: boolean
  /** The instant the rows are true at, as AWS gave it. Null when none was stated. */
  asOf: string | null
  /** `x-aws-read-state` for the read the rows came from. */
  state: string
}

export interface LiveState {
  /** The last good value, or null when nothing has ever been read. */
  value: LiveValue | null
  /**
   * When THIS BROWSER received the value, in epoch milliseconds; null when the
   * value came from the server render rather than from a poll.
   *
   * Distinct from `value.asOf`, which is when AWS says the rows were true. Both
   * are shown: "read at 12:04" and "true as of 12:03:58" are different facts and
   * an operator chasing a discrepancy needs the pair.
   */
  valueAt: number | null
  /** When the last attempt finished, epoch milliseconds. Null before the first. */
  attemptAt: number | null
  /** Whether it succeeded. Null before the first attempt. */
  attemptOk: boolean | null
  /** Why the last attempt failed, in the server's own words. Null when it did not. */
  because: string | null
  /** Consecutive failures. Zero after any success. */
  failures: number
  /** The interval the server last stated. Null until a response has stated one. */
  statedMs: number | null
  /** How long to wait before the next attempt. NULL MEANS STOP. */
  nextDelayMs: number | null
  /** Attempts made in this browser. */
  polls: number
}

/**
 * The state a page hands the region: the server's own read, at render time.
 *
 * `nextDelayMs` is 0 rather than an interval, because no response has stated one
 * yet and the first poll is what obtains it. That single immediate read is the
 * only request this module makes at a time it was not told to.
 */
export function seedState(value: LiveValue | null, because: string | null): LiveState {
  return {
    value,
    valueAt: null,
    attemptAt: null,
    attemptOk: null,
    because,
    failures: 0,
    statedMs: null,
    nextDelayMs: 0,
    polls: 0,
  }
}

export function afterSuccess(
  prev: LiveState,
  value: LiveValue,
  cadence: CadenceStatement,
  at: number,
): LiveState {
  // The last statement wins, and the last statement is remembered: a transport
  // failure carries no headers, and a client that forgot the cadence it was
  // given would stop polling because the network blinked.
  const stated = statedIntervalMs(cadence) ?? prev.statedMs
  return {
    value,
    valueAt: at,
    attemptAt: at,
    attemptOk: true,
    because: null,
    failures: 0,
    statedMs: stated,
    nextDelayMs: stated,
    polls: prev.polls + 1,
  }
}

/**
 * A 304: the representation this browser holds is still the current one.
 *
 * A success for the purposes of the attempt line, and NOT a new value — `asOf`
 * has not moved, so `valueAt` must not either. Stamping it would report data as
 * fresher than the server said it was, which is the failure this whole
 * vocabulary exists to prevent, arrived at through the one response designed to
 * save bandwidth.
 */
export function afterUnchanged(prev: LiveState, cadence: CadenceStatement, at: number): LiveState {
  const stated = statedIntervalMs(cadence) ?? prev.statedMs
  return {
    ...prev,
    attemptAt: at,
    attemptOk: true,
    because: null,
    failures: 0,
    statedMs: stated,
    nextDelayMs: stated,
    polls: prev.polls + 1,
  }
}

/**
 * A failed attempt. THE RULE: the value and the instant it was true survive it.
 *
 * `value` and `valueAt` are copied across explicitly rather than by spreading
 * `prev`, so that a future edit which drops them is a visible deletion of two
 * named lines rather than an invisible consequence of reordering a spread.
 */
export function afterFailure(
  prev: LiveState,
  because: string,
  cadence: CadenceStatement,
  at: number,
): LiveState {
  const stated = statedIntervalMs(cadence) ?? prev.statedMs
  const failures = prev.failures + 1
  return {
    value: prev.value,
    valueAt: prev.valueAt,
    attemptAt: at,
    attemptOk: false,
    because,
    failures,
    statedMs: stated,
    nextDelayMs: stated === null ? null : stated * backoffMultiplier(failures),
    polls: prev.polls + 1,
  }
}

/**
 * The seed a page hands the region, taken from the read the page ALREADY made.
 *
 * Structural rather than `AwsRead<T>`, so this module keeps its promise of
 * importing nothing — and `state` is required rather than optional for the
 * reason `estate-answer.ts` states about weak types: a parameter whose every
 * property is optional accepts any object at all, and `seedValue(theWrongThing)`
 * would compile and return null forever.
 *
 * Three arms produce a value and four produce null, and the split is the one
 * this console is built on. `EMPTY` is a value — AWS answered and there is
 * nothing — so it seeds a real zero. `DENIED`, `THROTTLED`, `UNCONFIGURED` and
 * `ERROR` produce NULL rather than a zero, because a zero is an answer about the
 * estate and those four are the absence of one.
 */
export function seedValue(read: {
  readonly state: string
  readonly asOf?: string
  readonly value?: unknown
}): LiveValue | null {
  if ((read.state === "ACTUAL" || read.state === "STALE") && Array.isArray(read.value)) {
    return { count: read.value.length, atLeast: false, asOf: read.asOf ?? null, state: read.state }
  }
  if (read.state === "EMPTY") {
    return { count: 0, atLeast: false, asOf: read.asOf ?? null, state: "EMPTY" }
  }
  return null
}

/* ------------------------------------------------------------- the words ---- */

/** A problem document's own sentence, or the status when it did not send one. */
export function describeProblem(status: number, body: unknown): string {
  const problem = (body ?? {}) as { title?: unknown; detail?: unknown }
  const title = typeof problem.title === "string" ? problem.title.trim() : ""
  const detail = typeof problem.detail === "string" ? problem.detail.trim() : ""
  if (title && detail) return `HTTP ${status} — ${title}: ${detail}`
  if (title || detail) return `HTTP ${status} — ${title || detail}`
  return `HTTP ${status} — the surface answered with no problem document.`
}

const iso = (at: number): string => new Date(at).toISOString()

/**
 * What the operator is told about the last attempt — including that there has
 * not been one, and including that it failed while the number above it stands.
 *
 * A region that shows a number and no attempt line is a region an operator reads
 * as live. The whole point of this build is that a frozen screen must SAY it is
 * frozen, so every arm of this function names both the attempt and what the
 * value on screen now means.
 */
export function attemptLine(state: LiveState): string {
  if (state.attemptAt === null) {
    return state.value === null
      ? `Nothing has been read in this browser yet${state.because ? ` — ${state.because}` : ""}. ` +
          `This is not an empty estate; it is a value that has not arrived.`
      : "Rendered by the server. No refresh has completed in this browser yet."
  }

  if (state.attemptOk) {
    return (
      `Last refresh succeeded at ${iso(state.attemptAt)}` +
      (state.statedMs === null
        ? ". The surface stated no refresh interval, so nothing further will be asked for and this is now a snapshot."
        : `. Refreshing every ${state.statedMs}ms, the interval the surface stated.`)
    )
  }

  const failed =
    `Last refresh FAILED at ${iso(state.attemptAt)} — ${state.because ?? "no reason was given"}` +
    ` (${state.failures} consecutive).`
  const held =
    state.value === null
      ? " Nothing has ever been read in this browser, so there is no value below — that is not a claim about the estate."
      : ` The value below is the last one that was true${
          state.value.asOf ? `, as of ${state.value.asOf}` : ""
        }${
          state.valueAt === null ? " and read during the server render" : `, read at ${iso(state.valueAt)}`
        }. It has not been overwritten.`
  const next =
    state.nextDelayMs === null
      ? " Nothing stated when to ask again, so no further attempt will be made."
      : ` The next attempt is in ${state.nextDelayMs}ms — the interval the surface stated, multiplied by ${backoffMultiplier(state.failures)} for the failures.`

  return failed + held + next
}

/** The word beside the region: what the screen is, right now. */
export function statusWord(state: LiveState): "live" | "stale" | "waiting" | "snapshot" {
  /*
   * Before the first attempt COMPLETES, the word is `waiting` — whether or not
   * the server render left a value behind.
   *
   * This arm is not a nicety. Without it, a region whose first poll was still in
   * flight reported `snapshot`, because `statedMs` is null until a response has
   * stated one and null was being read as "the surface stated no interval". On
   * the estate page against a real, unreachable AWS that is a several-second
   * window in which the screen said "nothing further is asked for" while a
   * request was on the wire. "Not established yet" and "established as none" are
   * different facts, and this console does not render the first as the second.
   */
  if (state.attemptAt === null) return "waiting"
  if (state.attemptOk === false) return "stale"
  if (state.value === null) return "waiting"
  if (state.attemptOk === true && state.nextDelayMs === null) return "snapshot"
  return "live"
}
