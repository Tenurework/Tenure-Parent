"use client"

import { useEffect, useRef, useState } from "react"

import { Badge, StaleIndicator } from "@/components/md3"
import {
  afterFailure,
  afterSuccess,
  afterUnchanged,
  attemptLine,
  describeProblem,
  noCadence,
  readCadence,
  seedState,
  statusWord,
  type LiveState,
  type LiveValue,
} from "@/lib/aws/refresh"

import styles from "./live.module.css"

/**
 * STUDIO-140-007 (client half) — the loop, attached to a screen.
 *
 * ## Why this component exists
 *
 * "Why isn't Studio fully connected to AWS with all data streaming?" The
 * permissions were never the gap: the task role grants 218 actions against the
 * registry's 120, and the six that look missing are spellings
 * (`s3:GetBucketCors` against `s3:GetBucketCORS`). Every capability carries a
 * `refreshMs` its author argued for; the API puts it on every response as
 * `x-aws-refresh-ms`. Nothing read it. The pages were server-rendered snapshots:
 * correct at load, frozen after it, and the only `setInterval` in the whole
 * application was the sign-in retry countdown.
 *
 * This is the missing half, and it is polling — deliberately. No websocket, no
 * SSE, no dependency. "Streaming" here means the screen keeps up, not that the
 * transport changes, and a poll on the server's own stated interval keeps up by
 * definition: the interval IS how often the underlying reading can move.
 *
 * ## What it will not do
 *
 *   * **It will not pick an interval.** Every delay comes from the response —
 *     see `statedIntervalMs`. A response that states none stops the loop and the
 *     region says so; it does not fall back to a number chosen here. A client
 *     that polls a twenty-four-hour price list every five seconds is a client
 *     that gets throttled, and a throttled read is how a page starts lying.
 *   * **It will not spend an operator's rate budget on a screen nobody is
 *     looking at.** Hidden tab, no timer. A console left open overnight makes no
 *     requests until somebody comes back to it.
 *   * **It will not blank a good value.** A failed refresh leaves the last good
 *     number on screen, marked stale, with the instant it was true and the
 *     server's own sentence about what went wrong. This is the client half of
 *     the guarantee `api/aws/[surface]/route.ts` already makes on the wire: a
 *     live surface never returns rows and a failure in the same response.
 *
 * ## Why the decisions are not in this file
 *
 * Every rule above is arithmetic in `lib/aws/refresh.ts`, which imports nothing
 * — so `e2e/live-refresh.spec.ts` drives all of them at the node level, and the
 * browser half of that spec measures the loop those rules produce. A `setTimeout`
 * with the policy inlined would be a policy nothing could test except by waiting
 * for it.
 */

export interface LiveRegionProps {
  /**
   * The `/api/aws/<surface>` id to poll. It must be a LIVE surface — one backed
   * by a capability — because those are the only ones whose responses carry a
   * cadence, and a surface that states no cadence is polled exactly once.
   */
  surface: string
  /** What one row is, singular. "edge distribution", "log group". */
  noun: string
  /** What this region is about, for its label and its accessible name. */
  what: string
  /**
   * The server's own read of the same surface, at render time — so the first
   * paint is the page's existing snapshot rather than a spinner, and the first
   * poll has something to preserve if it fails.
   *
   * Null when the server's read did not answer. `seedBecause` then says why, and
   * the region shows no number at all rather than a zero.
   */
  seed: LiveValue | null
  /** Why there is no seed, in the reader's own words. */
  seedBecause?: string | null
}

export function LiveRegion({ surface, noun, what, seed, seedBecause = null }: LiveRegionProps) {
  const [state, setState] = useState<LiveState>(() => seedState(seed, seedBecause))
  /** Whether the loop is stopped because this tab is hidden. A browser fact, not a read fact. */
  const [paused, setPaused] = useState(false)
  /**
   * The clock the age is measured against, or null before mount.
   *
   * Null on the server render AND on the first client render, which is what
   * keeps hydration deterministic: `StaleIndicator` computes an age, and an age
   * computed on the server and again in the browser is two different strings for
   * the same markup. It is set in the effect below, and thereafter it moves when
   * a poll completes — no separate ticking timer, because the age can only be
   * one cadence behind the data it describes and a timer would be an interval
   * this component chose.
   */
  const [now, setNow] = useState<number | null>(null)

  const stateRef = useRef(state)
  stateRef.current = state
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }

    /**
     * Whether this tab is one nobody is looking at.
     *
     * One function asked in all three places that must agree — arming a timer,
     * entering a poll, and reacting to the event itself. Three inlined copies of
     * the same comparison is three places a later edit can leave the loop
     * running behind an operator's back, and only one of them is the one that
     * gets forgotten.
     */
    const hidden = () => document.visibilityState === "hidden"

    /** Arm the next attempt, or do not — `null` is the instruction to stop. */
    const schedule = (delayMs: number | null) => {
      clear()
      if (cancelled || delayMs === null) return
      // The check is here as well as in `poll`, so a response that arrives while
      // the tab is hidden cannot re-arm the loop behind the operator's back.
      if (hidden()) return
      timer.current = setTimeout(() => {
        void poll()
      }, Math.max(0, delayMs))
    }

    const poll = async () => {
      timer.current = null
      if (cancelled || hidden()) return

      let next: LiveState
      try {
        const response = await fetch(`/api/aws/${encodeURIComponent(surface)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        })
        const cadence = readCadence(response.headers)
        const at = Date.now()

        if (response.status === 304) {
          // Not a failure and not a new value: the representation this browser
          // holds is still current, and its `asOf` has not moved.
          next = afterUnchanged(stateRef.current, cadence, at)
        } else if (response.ok) {
          const body = (await response.json()) as {
            items?: unknown
            nextCursor?: unknown
            asOf?: unknown
          }
          // `items` missing is not zero rows. The envelope always carries the
          // array on a 2xx, so its absence is a shape this client does not
          // understand — and reading a length off `undefined ?? []` is exactly
          // how a refusal becomes "0 distributions" one layer down.
          if (!Array.isArray(body.items)) {
            next = afterFailure(
              stateRef.current,
              `HTTP ${response.status} — the response carried no items array, so no count could be read from it.`,
              cadence,
              at,
            )
          } else {
            next = afterSuccess(
              stateRef.current,
              {
                count: body.items.length,
                // One page of a longer list is a FLOOR, and it says so rather
                // than reporting a page size as an estate.
                atLeast: typeof body.nextCursor === "string" && body.nextCursor !== "",
                asOf: cadence.asOf ?? (typeof body.asOf === "string" ? body.asOf : null),
                state: cadence.state ?? "ACTUAL",
              },
              cadence,
              at,
            )
          }
        } else {
          const body = await response.json().catch(() => null)
          next = afterFailure(stateRef.current, describeProblem(response.status, body), cadence, at)
        }
      } catch (error) {
        // A transport failure carries no headers at all. `afterFailure` falls
        // back to the interval the surface stated LAST, so a blink of the
        // network does not end the loop — and if none was ever stated, it stops.
        next = afterFailure(
          stateRef.current,
          `the request did not complete — ${
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          }`,
          noCadence(),
          Date.now(),
        )
      }

      if (cancelled) return
      stateRef.current = next
      setState(next)
      setNow(Date.now())
      schedule(next.nextDelayMs)
    }

    const onVisibility = () => {
      if (hidden()) {
        clear()
        setPaused(true)
        return
      }
      setPaused(false)
      setNow(Date.now())
      const held = stateRef.current
      if (held.nextDelayMs === null) return
      // Resume where the loop was, not from zero: a tab flicked in and out four
      // times is not four reads. The attempt is due when the interval has
      // elapsed since the last one, and immediately when it already has.
      schedule(
        held.attemptAt === null
          ? 0
          : Math.max(0, held.attemptAt + held.nextDelayMs - Date.now()),
      )
    }

    document.addEventListener("visibilitychange", onVisibility)
    setNow(Date.now())
    schedule(stateRef.current.nextDelayMs)

    return () => {
      cancelled = true
      clear()
      document.removeEventListener("visibilitychange", onVisibility)
    }
    // `surface` is the only input to the loop. The seed is a render-time value
    // and re-arming on it would restart the loop on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface])

  const value = state.value
  const word = statusWord(state)

  return (
    <section
      className={styles.region}
      data-testid={`live-${surface}`}
      data-status={word}
      data-paused={paused ? "true" : "false"}
      aria-label={`${what}, kept current by polling`}
    >
      <div className={styles.head}>
        <span className="md3-label-large">{what} — live</span>
        <Badge
          tone={word === "stale" ? "warn" : word === "live" ? "ok" : "info"}
          title={
            word === "live"
              ? "The last refresh succeeded and another is scheduled"
              : word === "stale"
                ? "The last refresh failed; the value shown is the last one that was true"
                : word === "snapshot"
                  ? "The surface stated no refresh interval, so nothing further is asked for"
                  : "Nothing has been read in this browser yet"
          }
        >
          {word}
        </Badge>
        {paused ? (
          <Badge tone="info" title="This tab is hidden, so no request is being made">
            paused — tab hidden
          </Badge>
        ) : null}
      </div>

      <p className="md3-title-medium" data-testid={`live-value-${surface}`}>
        {value === null
          ? `no ${noun} count has been read in this browser`
          : `${value.atLeast ? "at least " : ""}${value.count} ${noun}${value.count === 1 ? "" : "s"}`}
      </p>

      {value !== null && value.asOf !== null ? (
        state.statedMs === null || now === null ? (
          // Before a response has stated a cadence there is no window to judge
          // the age against, and `StaleIndicator` requires one — a number
          // invented here would describe a refresh window nothing implements.
          <span className="md3-label-small">
            as of <time dateTime={value.asOf}>{value.asOf}</time>
          </span>
        ) : (
          <StaleIndicator
            asOf={value.asOf}
            cadenceMs={state.statedMs}
            now={now}
            label={`the ${surface} reading`}
          />
        )
      ) : null}

      {/* The attempt, announced when it changes — this is the line that says the
          screen is frozen when it is frozen. */}
      <p className="md3-body-small" aria-live="polite" data-testid={`live-attempt-${surface}`}>
        {attemptLine(state)}
      </p>

      <p className="md3-body-small" data-testid={`live-cadence-${surface}`}>
        {/*
          Three arms, not two. Until an attempt has COMPLETED there is no stated
          interval yet — which is not the same fact as a surface that stated
          none, and rendering it as one told an operator "nothing further is
          asked for" while the first request was still on the wire.
        */}
        {state.attemptAt === null
          ? `The first read of /api/aws/${surface} is in flight. Whatever interval it states on its own response (x-aws-refresh-ms) is the interval this region will poll at.`
          : state.statedMs === null
            ? `This surface has stated no refresh interval, so nothing further is asked for and the value above is the render's own snapshot.`
            : `Polling /api/aws/${surface} every ${state.statedMs}ms — the interval the surface stated on its own response (x-aws-refresh-ms), never one this console picked.`}
      </p>

      <p className="md3-body-small" data-testid={`live-polls-${surface}`}>
        {state.polls} refresh attempt(s) in this browser
        {paused ? ", paused while this tab is hidden" : ""}.
      </p>
    </section>
  )
}
