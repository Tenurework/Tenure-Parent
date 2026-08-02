import { type ReactNode } from "react"

import {
  DEFAULT_COPY,
  STATE_SEMANTICS,
  retryAdvice,
  type StateSemantics,
  type SurfaceState,
} from "@/components/ui/states"

/**
 * One component for all ten states, rendering from the semantics table.
 *
 * Ten separate components would each re-decide the ARIA role, the urgency and
 * whether to offer a retry, and they would drift — nine of them correct and one
 * announcing a loading spinner assertively over whatever the reader was doing.
 * Reading it from `states.ts` means the decision is made once and the component
 * cannot disagree with the tests.
 *
 * `presentsAsComplete: false` renders a visible marker rather than only a tone.
 * Colour alone fails for a reader who cannot distinguish it, and "this is not
 * everything" is precisely the thing they must not miss.
 */

/**
 * Tone → design tokens.
 *
 * Four tones rather than ten, because the palette is a smaller vocabulary than
 * the state set: `stale`, `offline`, `partial` and `permission-denied` are
 * different situations that should look the same amount of unfinished. Every
 * value resolves to a token from `globals.css`; nothing here invents a colour.
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
  onRetry,
  retryLabel,
  children,
  className,
}: {
  state: SurfaceState
  title?: string
  detail?: ReactNode
  /** Ignored when the state says a retry cannot help; see `retryAdvice`. */
  onRetry?: () => void
  retryLabel?: string
  /** Rows this surface is wrapping, for stale/partial/archived/offline. */
  children?: ReactNode
  className?: string
}) {
  const semantics = STATE_SEMANTICS[state]
  const copy = DEFAULT_COPY[state]
  const advice = retryAdvice(state)
  const tone = TONE[semantics.tone]

  return (
    <div
      className={[
        "state-surface rounded-md border px-4 py-3",
        `state-${state}`,
        `tone-${semantics.tone}`,
        tone.frame,
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
      <p className={`state-title text-sm font-semibold ${tone.title}`}>{title ?? copy.title}</p>
      <p className={`state-detail mt-0.5 text-sm ${tone.body}`}>{detail ?? copy.detail}</p>

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

      {children ? <div className="state-body mt-3">{children}</div> : null}
    </div>
  )
}
