import { type ReactNode } from "react"

import { type IconType } from "@/components/ui/icons"
import { Skeleton, type SkeletonGeometry } from "@/components/ui/Skeleton"
import {
  DEFAULT_COPY,
  STATE_SEMANTICS,
  retryAdvice,
  type StateSemantics,
  type SurfaceState,
} from "@/components/ui/states"

/**
 * One component for all fourteen states, rendering from the semantics table.
 *
 * Fourteen separate components would each re-decide the ARIA role, the urgency
 * and whether to offer a retry, and they would drift — thirteen of them correct
 * and one announcing a loading spinner assertively over whatever the reader was
 * doing. Reading it from `states.ts` means the decision is made once and the
 * component cannot disagree with the tests.
 *
 * `presentsAsComplete: false` renders a visible marker rather than only a tone.
 * Colour alone fails for a reader who cannot distinguish it, and "this is not
 * everything" is precisely the thing they must not miss.
 *
 * `geometry` turns the loading state from a one-line card into a placeholder
 * the size of the content it precedes. When it is supplied the card chrome and
 * the visible copy step aside — they would add their own height on top of the
 * reservation and reintroduce the shift — and the copy moves to `sr-only`, so
 * the polite "Loading" announcement is unchanged for anyone listening.
 */

/**
 * Tone → design tokens.
 *
 * Four tones rather than fourteen, because the palette is a smaller vocabulary
 * than the state set: `stale`, `offline`, `partial` and `permission-denied` are
 * different situations that should look the same amount of unfinished, and
 * `empty`, `no-results`, `archived` and `syncing` are all equally quiet. Every
 * value resolves to a token from `globals.css`; nothing here invents a colour.
 * `neutral` is what `read-only` uses — live data, full contrast, no alarm.
 */
const TONE: Record<StateSemantics["tone"], { frame: string; title: string; body: string }> = {
  neutral: {
    frame: "border-border bg-surface",
    title: "text-text-1",
    body: "text-text-2",
  },
  muted: {
    frame: "border-border bg-subtle",
    title: "text-text-2",
    body: "text-text-3",
  },
  caution: {
    frame: "border-border-strong bg-subtle",
    title: "text-text-1",
    body: "text-text-2",
  },
  danger: {
    frame: "border-status-error/35 bg-surface",
    title: "text-status-error-text",
    body: "text-text-2",
  },
}

export function StateSurface({
  state,
  title,
  detail,
  icon: Icon,
  onRetry,
  retryLabel,
  geometry,
  action,
  centered = false,
  children,
  className,
}: {
  state: SurfaceState
  title?: ReactNode
  detail?: ReactNode
  /**
   * An optional glyph above the copy. Decorative — `aria-hidden`, because the
   * title and detail already say what the state is, and a reader hearing the
   * icon's name as well hears the same fact twice.
   */
  icon?: IconType
  /** Ignored when the state says a retry cannot help; see `retryAdvice`. */
  onRetry?: () => void
  retryLabel?: string
  /**
   * The one thing a reader can do from here — "Add a resource", "Clear
   * filters". Distinct from `onRetry`, which repeats the request that just
   * happened and is suppressed for the states where repeating it cannot help.
   */
  action?: ReactNode
  /**
   * Centre the copy in the space the missing content would have filled, for a
   * surface standing in for a whole panel rather than annotating rows above it.
   */
  centered?: boolean
  /**
   * The shape of the content this surface is standing in for. Supplying it
   * makes `loading` reserve that exact box instead of collapsing to a one-line
   * card and reflowing the page when the data lands. Ignored in every other
   * state — there is nothing to stand in for once the answer is known.
   */
  geometry?: SkeletonGeometry
  /** Rows this surface is wrapping, for stale/partial/archived/offline. */
  children?: ReactNode
  className?: string
}) {
  const semantics = STATE_SEMANTICS[state]
  const copy = DEFAULT_COPY[state]
  const advice = retryAdvice(state)
  const tone = TONE[semantics.tone]

  // The skeleton replaces the card, it does not sit inside it: a border and
  // 12px of padding around a height-matched placeholder is a height-mismatched
  // placeholder, which is the reflow this is here to remove.
  const showsSkeleton = state === "loading" && geometry !== undefined

  return (
    <div
      className={[
        "state-surface",
        showsSkeleton ? "" : centered ? "px-6 py-12 text-center" : "rounded-md border px-4 py-3",
        centered && !showsSkeleton ? "flex flex-col items-center justify-center" : "",
        `state-${state}`,
        `tone-${semantics.tone}`,
        showsSkeleton || centered ? "" : tone.frame,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      // The role and politeness come from the table, never from the call site.
      role={semantics.role}
      aria-live={semantics.live === "off" ? undefined : semantics.live}
      aria-busy={state === "loading" || undefined}
      data-state={state}
      data-complete={semantics.presentsAsComplete}
    >
      {/* Outline-only: a hairline ring rather than a filled plate, matching the
          rest of the product's iconography. Decorative by construction. */}
      {Icon && !showsSkeleton ? (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-border text-text-3">
          <Icon size={26} weight="light" aria-hidden />
        </div>
      ) : null}

      {/* Still announced, just not occupying height the reservation has to
          account for. `sr-only` keeps it in the accessibility tree. */}
      <p
        className={
          showsSkeleton
            ? "state-title sr-only"
            : centered
              ? `state-title text-lead font-semibold ${tone.title}`
              : `state-title text-sm font-semibold ${tone.title}`
        }
      >
        {title ?? copy.title}
      </p>
      <p
        className={
          showsSkeleton
            ? "state-detail sr-only"
            : centered
              ? `state-detail mt-1.5 max-w-md text-sm ${tone.body}`
              : `state-detail mt-0.5 text-sm ${tone.body}`
        }
      >
        {detail ?? copy.detail}
      </p>

      {showsSkeleton ? <Skeleton geometry={geometry} /> : null}

      {/* Not colour alone. A reader who cannot distinguish the tone still has
          to know that what follows is not the whole answer. */}
      {!semantics.presentsAsComplete && children ? (
        <p className="state-incomplete-marker mt-2 text-xs font-medium uppercase tracking-wide text-text-3">
          Incomplete — do not read this as the full result.
        </p>
      ) : null}

      {advice.offerRetry && onRetry ? (
        <button
          type="button"
          className="state-retry mt-3 rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text-1 hover:bg-subtle"
          onClick={onRetry}
        >
          {retryLabel ?? "Try again"}
        </button>
      ) : null}

      {action ? <div className="state-action mt-5">{action}</div> : null}

      {children ? <div className="state-body mt-3">{children}</div> : null}
    </div>
  )
}
