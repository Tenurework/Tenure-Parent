/**
 * WRK-010-001 — Bible §3.5's projection state ladder, as a decision.
 *
 * §3.5 fixes six normal states and ten exceptional ones and then states the
 * rule the states exist for: "Never answer as though a stale, deleted,
 * inaccessible, or reconciliation-failed source is current." Before this file,
 * `grep -rn 'STALE|SOURCE_DELETED|ACCESS_REVOKED' apps packages` returned
 * nothing outside the Bible, so there was no value in this tree that could hold
 * "the thing you are about to cite is gone", and no place the sentence could be
 * written.
 *
 * ## Why this is sixteen names and one function, and not sixty types
 *
 * §3.2 lists twenty-odd canonical objects. Declaring all of them here would
 * produce a package of types nothing calls, which is worse than an empty
 * directory: it reads as though the section landed. What landed is the part the
 * one live projection in this repository actually consumes — `loadSearchCorpus`
 * builds a citation for every row it returns, through `projectTenureRecord`
 * (`citation.ts`), which walks this ladder and refuses a value that cannot reach
 * `CURRENT`. The remaining objects stay unwritten and the ledger says which.
 *
 * ## Terminal means terminal
 *
 * `ACCESS_REVOKED`, `SOURCE_DELETED` and `RETENTION_EXPIRED` accept no event at
 * all. That is the whole point of modelling them: a projection whose grant was
 * withdrawn, whose source was deleted, or whose retention clock ran out must not
 * become `CURRENT` again because a refresh job asked politely. The other seven
 * exceptional states are recoverable — a moved source can be re-resolved, a
 * quarantine can be lifted — and they re-enter the ladder at `FETCH_PENDING`,
 * never directly at `CURRENT`, because "we fixed the mapping" is not "we have
 * the content".
 */

/** §3.5's happy path, in order. */
export const NORMAL_PROJECTION_STATES = [
  "DISCOVERED",
  "AUTHORIZED",
  "FETCH_PENDING",
  "CURRENT",
  "STALE",
  "REFRESHING",
] as const

/** §3.5's ten exceptional states, verbatim and in the Bible's own order. */
export const EXCEPTIONAL_PROJECTION_STATES = [
  "ACCESS_REVOKED",
  "SOURCE_DELETED",
  "SOURCE_MOVED",
  "SOURCE_UNKNOWN",
  "RETENTION_EXPIRED",
  "LEGAL_HOLD",
  "QUARANTINED",
  "CLASSIFICATION_BLOCKED",
  "INDEX_FAILED",
  "MAPPING_CONFLICT",
] as const

export const PROJECTION_STATES = [
  ...NORMAL_PROJECTION_STATES,
  ...EXCEPTIONAL_PROJECTION_STATES,
] as const

export type ProjectionState = (typeof PROJECTION_STATES)[number]

/**
 * The three that never come back.
 *
 * Each is a fact about the world outside this system that a retry cannot
 * change: the grant was withdrawn, the object was deleted, the retention period
 * expired. A projection in one of these is evidence to be shown, not a fetch to
 * be re-attempted.
 */
export const TERMINAL_PROJECTION_STATES = [
  "ACCESS_REVOKED",
  "SOURCE_DELETED",
  "RETENTION_EXPIRED",
] as const

export type TerminalProjectionState = (typeof TERMINAL_PROJECTION_STATES)[number]

export function isProjectionState(value: unknown): value is ProjectionState {
  return typeof value === "string" && (PROJECTION_STATES as readonly string[]).includes(value)
}

export function isTerminalProjectionState(state: ProjectionState): boolean {
  return (TERMINAL_PROJECTION_STATES as readonly string[]).includes(state)
}

/**
 * What can happen to a projection.
 *
 * Named for the observation, not for the destination state, so a caller records
 * what it saw and this module decides what that means. `FETCH_SUCCEEDED` from
 * `FETCH_PENDING` and from `REFRESHING` are the same observation and land on
 * the same state; `FETCH_SUCCEEDED` from `DISCOVERED` is a caller that skipped
 * authorization, and it is refused.
 */
export const PROJECTION_EVENTS = [
  "AUTHORIZE",
  "REQUEST_FETCH",
  "FETCH_SUCCEEDED",
  "AGE",
  "REFRESH",
  "ACCESS_REVOKED",
  "SOURCE_DELETED",
  "SOURCE_MOVED",
  "SOURCE_UNKNOWN",
  "RETENTION_EXPIRED",
  "LEGAL_HOLD",
  "QUARANTINE",
  "CLASSIFICATION_BLOCKED",
  "INDEX_FAILED",
  "MAPPING_CONFLICT",
] as const

export type ProjectionEvent = (typeof PROJECTION_EVENTS)[number]

export function isProjectionEvent(value: unknown): value is ProjectionEvent {
  return typeof value === "string" && (PROJECTION_EVENTS as readonly string[]).includes(value)
}

/** The event that puts a projection into each exceptional state. */
const EXCEPTIONAL_BY_EVENT: Partial<Record<ProjectionEvent, ProjectionState>> = {
  ACCESS_REVOKED: "ACCESS_REVOKED",
  SOURCE_DELETED: "SOURCE_DELETED",
  SOURCE_MOVED: "SOURCE_MOVED",
  SOURCE_UNKNOWN: "SOURCE_UNKNOWN",
  RETENTION_EXPIRED: "RETENTION_EXPIRED",
  LEGAL_HOLD: "LEGAL_HOLD",
  QUARANTINE: "QUARANTINED",
  CLASSIFICATION_BLOCKED: "CLASSIFICATION_BLOCKED",
  INDEX_FAILED: "INDEX_FAILED",
  MAPPING_CONFLICT: "MAPPING_CONFLICT",
}

/**
 * The happy path, stated as a table rather than as a chain of `if`s.
 *
 * Every pair not in here is a refusal, which is the direction that matters: a
 * default that shrugged and returned the current state would let a caller
 * "advance" a `DISCOVERED` projection to `CURRENT` by sending the wrong event
 * and never hear about it.
 */
const NORMAL_TRANSITIONS: readonly {
  from: ProjectionState
  event: ProjectionEvent
  to: ProjectionState
}[] = [
  { from: "DISCOVERED", event: "AUTHORIZE", to: "AUTHORIZED" },
  { from: "AUTHORIZED", event: "REQUEST_FETCH", to: "FETCH_PENDING" },
  { from: "FETCH_PENDING", event: "FETCH_SUCCEEDED", to: "CURRENT" },
  { from: "CURRENT", event: "AGE", to: "STALE" },
  { from: "STALE", event: "REFRESH", to: "REFRESHING" },
  { from: "REFRESHING", event: "FETCH_SUCCEEDED", to: "CURRENT" },
  // A refresh that found nothing new leaves the projection stale rather than
  // silently current: "we asked again" is not "we have it again".
  { from: "REFRESHING", event: "AGE", to: "STALE" },
]

export type AdvanceResult =
  | { ok: true; state: ProjectionState }
  | {
      ok: false
      from: ProjectionState
      event: ProjectionEvent
      /** Why, in words a person reads. Never a bare boolean — see below. */
      reason: string
    }

/**
 * The next state, or a refusal that says why.
 *
 * Not `ProjectionState | null` and not a throw. A refusal here is a fact
 * somebody has to be told — "this citation cannot be refreshed because its
 * access was revoked" — and a null erases the reason at exactly the point it
 * becomes useful.
 *
 * Its production caller is `projectTenureRecord` in `citation.ts`, which walks
 * DISCOVERED → AUTHORIZED → FETCH_PENDING → CURRENT for every row
 * `loadSearchCorpus` returns. That is a real coupling and it is deliberate:
 * deleting the FETCH_PENDING rung from the table below reds 40 tests across the
 * real corpus loader and the real `/api/ai/chat` route, because the corpus load
 * fails loudly rather than handing a model a citation whose state nothing
 * checked.
 */
export function advance(state: ProjectionState, event: ProjectionEvent): AdvanceResult {
  if (isTerminalProjectionState(state)) {
    return {
      ok: false,
      from: state,
      event,
      reason:
        `${state} is terminal: the grant, the object or the retention period is gone, and no ` +
        `event returns a projection from it. Re-discover the source instead of refreshing this one.`,
    }
  }

  const exceptional = EXCEPTIONAL_BY_EVENT[event]
  if (exceptional) return { ok: true, state: exceptional }

  // A recoverable exceptional state re-enters at FETCH_PENDING, never at
  // CURRENT: resolving a moved source or lifting a quarantine says where the
  // content is, not that we hold it.
  if (
    event === "REQUEST_FETCH" &&
    (EXCEPTIONAL_PROJECTION_STATES as readonly string[]).includes(state)
  ) {
    return { ok: true, state: "FETCH_PENDING" }
  }

  const hit = NORMAL_TRANSITIONS.find((t) => t.from === state && t.event === event)
  if (hit) return { ok: true, state: hit.to }

  return {
    ok: false,
    from: state,
    event,
    reason:
      `"${event}" is not something that can happen to a projection in ${state}. The ladder is ` +
      `DISCOVERED → AUTHORIZED → FETCH_PENDING → CURRENT → STALE → REFRESHING → CURRENT, and a ` +
      `step cannot be skipped: a source nobody authorized is not one anybody may fetch.`,
  }
}

/**
 * Whether a source in this state may contribute its TEXT to an answer.
 *
 * §3.5's rule, applied at the one boundary that matters. `CURRENT` is the only
 * state whose text is what the source says now; `STALE` and `REFRESHING` are
 * text we did hold and must be labelled as such rather than withheld, because a
 * budget deadline from last week is still the best answer available and hiding
 * it is its own kind of wrong. Every other state — deleted, revoked, held,
 * quarantined, blocked, unresolved, failed — contributes a citation and no
 * words, which is exactly what "never answer as though it is current" means
 * when the alternative is inventing.
 */
export function bodyMayBeQuoted(state: ProjectionState): boolean {
  return state === "CURRENT" || state === "STALE" || state === "REFRESHING"
}
