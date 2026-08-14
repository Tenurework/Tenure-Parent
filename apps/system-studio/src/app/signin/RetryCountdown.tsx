"use client"

import { useEffect, useState } from "react"

import styles from "./signin.module.css"

/**
 * The relative half of the lock-out's next-attempt time.
 *
 * `states.tsx` requires a `RetryingState` to carry `attempt`, `of` and
 * `nextAttemptAt`, and says why: "Retrying…" with no ceiling and no time is a
 * spinner with a different word on it. The absolute time is rendered on the
 * SERVER — `page.tsx` prints `18:42:07 UTC` — and this adds the part only a
 * clock in the reader's own browser can be right about.
 *
 * Two consequences of that split, both deliberate:
 *
 *   * There is no hydration mismatch to suppress. The server renders no
 *     relative figure at all, so there is nothing for the client to disagree
 *     with; the countdown appears once, after mount.
 *   * With JavaScript unavailable the page still states when the lock lifts, in
 *     UTC, which is the fact an operator would put in a message to a colleague.
 *
 * The page does not reload itself when the lock expires. A page that navigates
 * on a timer is a page that can discard something typed into it, and the
 * operator is standing right there — a button they press is both safer and
 * faster than a redirect they did not ask for.
 */

export interface RetryCountdownProps {
  /** Epoch ms at which the lock lifts. */
  retryAt: number
}

function spell(seconds: number): string {
  if (seconds >= 120) return `${Math.ceil(seconds / 60)} minutes`
  if (seconds >= 60) return "1 minute"
  return `${seconds} second${seconds === 1 ? "" : "s"}`
}

export function RetryCountdown({ retryAt }: RetryCountdownProps) {
  /*
   * `null` until mounted, so the server render and the first client render are
   * the same empty span.
   */
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  if (remaining === null) return null

  if (remaining <= 0) {
    return (
      <span className={styles.countdown}>
        <span data-testid="lock-expired">The lock has lifted.</span>{" "}
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </span>
    )
  }

  return (
    <span className={styles.countdown} data-testid="lock-remaining" data-seconds={remaining}>
      {spell(remaining)} from now
    </span>
  )
}
