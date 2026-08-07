/**
 * GE-022-002 / GE-143-022 — the fourteen states a dense ERP surface is actually in.
 *
 * Not a palette. Each entry below encodes decisions that are wrong by default
 * and expensive to get wrong once, and putting them in one table is what stops
 * every panel re-deciding them:
 *
 *   * which ARIA role, and how urgently a screen reader interrupts
 *   * whether the surface may be presented as *data* at all
 *   * whether a retry is offered, and whether retrying could possibly help
 *
 * The middle one is the reason this exists. `stale`, `partial` and `offline`
 * all render rows, and a reader who cannot tell them from a complete result
 * makes a decision on an incomplete one — which is the failure mode of every
 * dashboard that has ever misled someone. `presentsAsComplete: false` is what
 * a component keys the "this is not everything" affordance off, rather than
 * each panel remembering.
 *
 * Four of the fourteen exist only because collapsing them onto a neighbour
 * produces copy that is actively wrong:
 *
 *   * `no-results` is not `empty`. Empty says "this is up to date — there is
 *     simply nothing to show", and telling that to someone whose filter matched
 *     nothing sends them looking for the missing records instead of at the
 *     filter chip they left on.
 *   * `syncing` is not `offline`. Offline says "changes will not save", which
 *     is the exact opposite of what is happening while a write is in flight.
 *   * `read-only` is not `permission-denied`. The data is on screen and correct;
 *     only the edit affordances are gone, so the surface must not read as a
 *     refusal to show anything.
 *   * `pending-purge` is not `archived`. Archived is kept for the record;
 *     pending-purge is on a countdown to being gone, and a reader who reads it
 *     as archived does not restore it in time.
 *
 * The purely interaction-level states — hover, active, focus-visible, selected,
 * disabled — are properties of a control, not of a surface, and live on Button /
 * TextField / Select. They are deliberately not in this table.
 */

export type SurfaceState =
  | "loading"
  | "empty"
  | "no-results"
  | "error"
  | "permission-denied"
  | "stale"
  | "syncing"
  | "conflict"
  | "offline"
  | "archived"
  | "read-only"
  | "pending-purge"
  | "partial"
  | "high-risk-confirm"

export interface StateSemantics {
  /** ARIA role. `status` for progress, `alert` for something the reader must know now. */
  role: "status" | "alert" | "region" | "dialog"
  /** How a screen reader announces it. `assertive` interrupts; use it sparingly. */
  live: "polite" | "assertive" | "off"
  /** Whether what is on screen may be read as a complete, current answer. */
  presentsAsComplete: boolean
  /** Whether trying the same thing again could plausibly help. */
  retryable: boolean
  /** Token key for the surface's tone. Greyscale-first; never colour alone. */
  tone: "neutral" | "muted" | "caution" | "danger"
  /** Whether the surface must carry a visible, non-colour signal of its state. */
  requiresTextualSignal: boolean
}

/**
 * The table.
 *
 * `presentsAsComplete` is true for exactly four states — `empty`, `no-results`,
 * `archived` and `read-only`, the only four where what is on screen IS the
 * whole, correct answer for the question that was asked. The other ten are
 * incomplete in some way. That split is checked by a test rather than trusted
 * to this comment.
 */
export const STATE_SEMANTICS: Readonly<Record<SurfaceState, StateSemantics>> = {
  loading: {
    role: "status",
    live: "polite",
    // Nothing is on screen yet, so nothing can be mistaken for an answer.
    presentsAsComplete: false,
    retryable: false,
    tone: "muted",
    requiresTextualSignal: true,
  },

  empty: {
    role: "status",
    live: "polite",
    // Empty IS the complete answer. A panel that reads "nothing yet" when the
    // query failed is the confusion this distinction prevents.
    presentsAsComplete: true,
    retryable: false,
    tone: "muted",
    requiresTextualSignal: true,
  },

  "no-results": {
    role: "status",
    live: "polite",
    // The query ran and the honest answer is "none". Complete, like `empty` —
    // but the copy has to point at the filter, not at the absence of records.
    presentsAsComplete: true,
    // Re-running the identical query against the identical filters returns the
    // identical nothing. The action is to change the filters.
    retryable: false,
    tone: "muted",
    requiresTextualSignal: true,
  },

  error: {
    role: "alert",
    live: "assertive",
    presentsAsComplete: false,
    retryable: true,
    tone: "danger",
    requiresTextualSignal: true,
  },

  "permission-denied": {
    role: "alert",
    live: "assertive",
    presentsAsComplete: false,
    // Retrying cannot grant a permission. Offering a retry button teaches
    // people to click it, and it will never work.
    retryable: false,
    tone: "caution",
    requiresTextualSignal: true,
  },

  stale: {
    role: "status",
    // Polite: the data is usable, just not fresh. Interrupting a reader for
    // freshness trains them to dismiss the alert that matters.
    live: "polite",
    presentsAsComplete: false,
    retryable: true,
    tone: "caution",
    requiresTextualSignal: true,
  },

  syncing: {
    role: "status",
    // Polite. A write in flight is progress, not news; interrupting for it is
    // the same mistake as interrupting for a spinner.
    live: "polite",
    // What is on screen is mid-flight — the server has not agreed to it yet.
    presentsAsComplete: false,
    // The request is already out. A retry control here duplicates the write,
    // which for anything money- or approval-shaped is the expensive failure.
    retryable: false,
    tone: "muted",
    requiresTextualSignal: true,
  },

  conflict: {
    role: "alert",
    live: "assertive",
    presentsAsComplete: false,
    // Retrying the identical write reproduces the conflict. The user must
    // reload and reconcile first — which is what the copy has to say.
    retryable: false,
    tone: "danger",
    requiresTextualSignal: true,
  },

  offline: {
    role: "status",
    live: "polite",
    presentsAsComplete: false,
    retryable: true,
    tone: "caution",
    requiresTextualSignal: true,
  },

  archived: {
    role: "region",
    live: "off",
    // Archived data IS complete and correct — it is simply no longer live.
    // Marking it incomplete would make every historical view look broken.
    presentsAsComplete: true,
    retryable: false,
    tone: "muted",
    requiresTextualSignal: true,
  },

  "read-only": {
    role: "region",
    // Not an event. Announcing "read-only" over a reader's navigation every
    // time a region mounts is noise; the copy is there when they reach it.
    live: "off",
    // The data is live, current and complete. Only the edit affordances are
    // absent — marking it incomplete would make every viewer-seat page look
    // broken, which is the mistake that makes people distrust the whole screen.
    presentsAsComplete: true,
    retryable: false,
    tone: "neutral",
    requiresTextualSignal: true,
  },

  "pending-purge": {
    role: "alert",
    // Assertive, and this is one of the few that earns it: the window to stop
    // an irreversible deletion closes on a clock the reader cannot see.
    live: "assertive",
    // Whatever is on screen is scheduled to stop existing. Reading it as the
    // durable answer is exactly the misread that ends with it gone.
    presentsAsComplete: false,
    // Retrying the read does not move the deletion date. The action is restore.
    retryable: false,
    tone: "danger",
    requiresTextualSignal: true,
  },

  partial: {
    role: "status",
    live: "polite",
    presentsAsComplete: false,
    retryable: true,
    tone: "caution",
    requiresTextualSignal: true,
  },

  "high-risk-confirm": {
    role: "dialog",
    live: "assertive",
    presentsAsComplete: false,
    retryable: false,
    tone: "danger",
    requiresTextualSignal: true,
  },
}

export const ALL_STATES = Object.keys(STATE_SEMANTICS) as SurfaceState[]

/** States that render something a reader could mistake for the whole answer. */
export const INCOMPLETE_STATES = ALL_STATES.filter((s) => !STATE_SEMANTICS[s].presentsAsComplete)

/**
 * Default copy.
 *
 * Here rather than at each call site so the wording of a refusal is decided
 * once. Two of these are load-bearing:
 *
 *   * `permission-denied` never says what it is hiding. "You cannot see the
 *     Rochester budget" confirms that a Rochester budget exists, which is the
 *     enumeration oracle the API refusals already avoid — a UI that leaks it
 *     back undoes that work.
 *   * `conflict` tells the reader to reload rather than retry, because
 *     retrying the identical write reproduces the conflict.
 *   * `no-results` names the filter. "Nothing here yet" sends someone hunting
 *     for records that are sitting behind the chip they forgot to clear.
 */
export const DEFAULT_COPY: Readonly<Record<SurfaceState, { title: string; detail: string }>> = {
  loading: { title: "Loading", detail: "Fetching the latest." },
  empty: { title: "Nothing here yet", detail: "This is up to date — there is simply nothing to show." },
  "no-results": {
    title: "No matches",
    detail: "Records exist here, but none match the filters you have applied. Clear or widen them.",
  },
  error: { title: "That did not load", detail: "Something went wrong on our side. Try again." },
  "permission-denied": {
    title: "Not available to you",
    detail: "Your current seat does not include this. Ask an administrator if you need it.",
  },
  stale: { title: "Showing older data", detail: "This may be out of date. Refresh for the latest." },
  syncing: {
    title: "Saving",
    detail: "Your changes are on their way to the server. Stay on this page until it finishes.",
  },
  conflict: {
    title: "This changed while you were working",
    detail: "Someone else saved first. Reload to see their version before saving yours.",
  },
  offline: { title: "You are offline", detail: "Showing what was last loaded. Changes will not save." },
  archived: { title: "Archived", detail: "Kept for the record. This is no longer active." },
  "read-only": {
    title: "Read-only",
    detail: "Everything here is current. You can view it, but not change it from this seat.",
  },
  "pending-purge": {
    title: "Scheduled for deletion",
    detail: "This is queued to be permanently removed. Restore it before the scheduled date or it is gone.",
  },
  partial: {
    title: "Some of this could not load",
    detail: "What is shown is correct; part of it is missing. Refresh to try the rest.",
  },
  "high-risk-confirm": {
    title: "This cannot be undone",
    detail: "Type the name to confirm you mean this one.",
  },
}

/**
 * Whether a state may offer a retry control.
 *
 * A separate function rather than reading `retryable` directly, so the reason a
 * retry is absent stays attached to the decision.
 */
export function retryAdvice(state: SurfaceState): { offerRetry: boolean; because: string } {
  const { retryable } = STATE_SEMANTICS[state]
  if (retryable) return { offerRetry: true, because: "the same request could succeed on a second attempt" }

  switch (state) {
    case "permission-denied":
      return { offerRetry: false, because: "retrying cannot grant a permission" }
    case "conflict":
      return { offerRetry: false, because: "retrying the identical write reproduces the conflict" }
    case "empty":
      return { offerRetry: false, because: "empty is the answer, not a failure" }
    case "no-results":
      return {
        offerRetry: false,
        because: "the same query against the same filters returns the same nothing; widen the filters instead",
      }
    case "archived":
      return { offerRetry: false, because: "archived is a state, not a failure" }
    case "read-only":
      return { offerRetry: false, because: "read-only is a property of the seat, not a request that failed" }
    case "pending-purge":
      return { offerRetry: false, because: "retrying a read does not move the deletion date; restore it instead" }
    case "syncing":
      return { offerRetry: false, because: "the write is already in flight, and retrying would submit it twice" }
    case "loading":
      return { offerRetry: false, because: "it has not finished yet" }
    case "high-risk-confirm":
      return { offerRetry: false, because: "this is a decision, not a failure" }
    default:
      // Reached only if a non-retryable state is added without a branch above.
      // A test asserts no state lands here, so the generic string cannot ship.
      return { offerRetry: false, because: "not retryable" }
  }
}
