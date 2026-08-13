/**
 * "As of T" — and whether T is still allowed to be the answer.
 *
 * ## Why a timestamp alone is not a fact
 *
 * Every AWS reading in this console carries an `asOf`, and printing it is where
 * most consoles stop. It is not enough, because the reader cannot tell whether
 * "as of 4 minutes ago" is normal or alarming without knowing the CADENCE of the
 * thing being read. Four minutes is fresh for a certificate inventory
 * (`ACM_TTL_MS`, an hour) and four minutes is a stale SQS queue depth
 * (`SQS_DEPTH_TTL_MS`, ten seconds) — the same age, opposite meanings, and the
 * cadence is the only thing that separates them.
 *
 * So this component takes BOTH, and the cadence is required. It renders the
 * instant, the cadence, the age, and — when the age is past the cadence — it
 * says so in a word and marks itself `data-degraded="true"` so the stylesheet
 * can make it visibly different. Degraded is carried by the WORD "overdue" as
 * well as by the tint, because meaning conveyed by colour alone is forbidden
 * (Bible §26.3.2) and this console's palette is deliberately quiet.
 *
 * `cadenceMs` is not invented at the call site: it is
 * `CAPABILITIES[capability].refreshMs`, the same number the reader uses to
 * decide whether to re-read. A page that passes its own number is describing a
 * refresh window that does not exist.
 *
 * ## Times are printed as ISO, never localised
 *
 * `toLocaleString` would produce a different string on the server than in the
 * browser (different locale, different time zone), which React hydration reports
 * as a mismatch and which makes two operators reading the same screenshot
 * disagree about when something happened. An operator comparing a console
 * against a CloudTrail event needs the same instant in the same notation, so the
 * instant is printed exactly as AWS gave it and `<time dateTime>` carries it
 * machine-readably.
 */

/** What the arithmetic below concluded, separately from how it is drawn. */
export interface Staleness {
  /** Milliseconds between the reading and now. Negative when `asOf` is ahead. */
  ageMs: number
  /** True once the reading is older than its own capability allows. */
  degraded: boolean
  /** `asOf` could not be parsed. Degraded, and it says why rather than "NaN". */
  unparseable: boolean
  /** `asOf` is in the future by more than a second — a clock disagreement. */
  ahead: boolean
}

/**
 * The decision, as a pure function.
 *
 * Exported and separate from the component so it can be asserted directly, and
 * so a caller that needs the verdict without the markup — a table column that
 * sorts by staleness — does not have to render a span to get it.
 *
 * A reading dated in the FUTURE is not fresh and is not stale: it is a clock
 * disagreement between this process and AWS, and reporting it as "0s old" hides
 * the only interesting thing about it. It is reported as `ahead`, and it is not
 * degraded, because the remedy is NTP rather than a refresh.
 */
export function staleness(asOf: string, cadenceMs: number, now: number): Staleness {
  const at = Date.parse(asOf)
  if (Number.isNaN(at)) {
    // Unparseable is degraded, deliberately. The alternative is to treat an
    // unreadable timestamp as fresh, which is the most optimistic reading of the
    // least trustworthy input on the page.
    return { ageMs: 0, degraded: true, unparseable: true, ahead: false }
  }
  const ageMs = now - at
  if (ageMs < -1000) return { ageMs, degraded: false, unparseable: false, ahead: true }
  return { ageMs, degraded: ageMs > cadenceMs, unparseable: false, ahead: false }
}

/**
 * A duration a person reads, from a number of milliseconds.
 *
 * Deterministic and locale-free — no `Intl`, no relative-time formatter — for
 * the same reason the instant is ISO: the string is compared across machines.
 * The units step up rather than compose ("2h", never "1h 47m") because this is a
 * glance, not a report; the exact instant is beside it.
 */
export function formatAge(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${Math.round(abs)}ms`
  const seconds = Math.round(abs / 1000)
  if (seconds < 90) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export interface StaleIndicatorProps {
  /** The instant the reading was taken. An ISO 8601 string, as AWS gave it. */
  asOf: string
  /**
   * How long a reading of this kind may be reused, in milliseconds.
   *
   * `CAPABILITIES[capability].refreshMs`. Required, and never a literal at the
   * call site: the cadence is a property of the resource being read, and a page
   * that supplies its own is describing a refresh window nothing implements.
   */
  cadenceMs: number
  /**
   * The clock, injected so a rendering is deterministic under test.
   *
   * Defaults to `Date.now()`. This component has no `"use client"` directive, so
   * in this console it evaluates on the server during the render that produced
   * the reading — the age is computed once, against the same clock that took the
   * reading, and it does not tick.
   */
  now?: number
  /** What was read, for a reader who meets this span outside its row. */
  label?: string
}

export function StaleIndicator({ asOf, cadenceMs, now = Date.now(), label }: StaleIndicatorProps) {
  const verdict = staleness(asOf, cadenceMs, now)

  return (
    <span
      className="md3-stale md3-label-small"
      data-degraded={verdict.degraded ? "true" : "false"}
      // Read aloud as one phrase. Without this a screen reader announces the
      // three fragments as three unrelated pieces of text in a table cell.
      aria-label={
        `${label ? `${label}: ` : ""}` +
        (verdict.unparseable
          ? `timestamp could not be read: ${asOf}`
          : verdict.ahead
            ? `dated ${asOf}, which is ${formatAge(verdict.ageMs)} ahead of this console's clock`
            : `as of ${asOf}, ${formatAge(verdict.ageMs)} old, ` +
              `refreshed every ${formatAge(cadenceMs)}` +
              `${verdict.degraded ? ", which is overdue" : ""}`)
      }
    >
      {verdict.unparseable ? (
        <>
          <span>as of</span>
          <span className="md3-stale-age">an unreadable timestamp</span>
          <span className="md3-stale-cadence">{asOf}</span>
        </>
      ) : (
        <>
          <span>as of</span>
          <time dateTime={asOf}>{asOf}</time>
          <span className="md3-stale-age">
            {verdict.ahead ? `${formatAge(verdict.ageMs)} ahead of this clock` : `${formatAge(verdict.ageMs)} old`}
          </span>
          <span className="md3-stale-cadence">
            {/*
              The cadence, always — not only when overdue. A reader who is told
              "3m old" without being told the window is 10s cannot tell whether
              to act, and a reader told nothing at all assumes the number is
              fine. "overdue" is a WORD rather than only a tint, because meaning
              carried by colour alone is forbidden here.
            */}
            {verdict.degraded
              ? `overdue — refreshes every ${formatAge(cadenceMs)}`
              : `refreshes every ${formatAge(cadenceMs)}`}
          </span>
        </>
      )}
    </span>
  )
}
