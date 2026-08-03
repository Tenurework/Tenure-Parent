/**
 * GE-050-005 — two clocks, because one cannot answer the question that matters.
 *
 * Bible §8.2: "All mutable organizational facts requiring historical
 * reconstruction use effective dating plus transaction time. Corrections append
 * a superseding version; they do not rewrite history invisibly."
 *
 * Everything in this platform so far carries **one** clock: `effectiveFrom` and
 * `effectiveUntil` — when a fact was true of the world. That answers "who held
 * this seat in March?" and cannot answer the question an audit actually asks:
 *
 *   *When the approval was granted in March, who did we believe held the seat?*
 *
 * Those differ whenever a fact is corrected. Somebody discovers in July that a
 * VP's term actually ended in February, and fixes the record. With one clock,
 * every report about March silently changes: an approval that was correctly
 * granted now shows an approver who had no authority, and the person who granted
 * it looks like they broke a rule that did not exist yet.
 *
 * The second clock is `recordedAt` — when the platform learned it — and
 * `supersededAt`, when it stopped believing it. A query takes **both** instants:
 * what was true at *validAt*, according to what we knew at *knownAt*.
 *
 * ## Corrections append
 *
 * `correct()` never mutates a version. The old row keeps its `recordedAt` and
 * gains a `supersededAt`; the new one is appended. That is what makes the
 * March-as-known-in-March query possible at all — a corrected-in-place row has
 * destroyed the only evidence of what was believed.
 */

/** When a fact was true of the world. Half-open, like every other interval here. */
export interface ValidPeriod {
  validFrom: string
  /** Null means "still true, as far as this version says". */
  validTo: string | null
}

/** When the platform believed it. */
export interface RecordPeriod {
  recordedAt: string
  /** Null means this is still what we believe. */
  supersededAt: string | null
}

export interface BitemporalVersion<T> extends ValidPeriod, RecordPeriod {
  /** Stable across corrections: every version of one fact shares it. */
  factId: string
  value: T
  /** Why this version exists. A correction with no reason cannot be reviewed. */
  reason: string
}

export interface TemporalQuery {
  /** The instant the fact is about. */
  validAt: Date
  /**
   * The instant we are asking *as of*.
   *
   * Omitted means now — the ordinary case. Supplied means "reconstruct what we
   * believed then", which is the only way to audit a past decision fairly.
   */
  knownAt?: Date
}

function covers(from: string, to: string | null, at: number): boolean {
  const start = Date.parse(from)
  if (Number.isNaN(start) || at < start) return false
  if (to === null) return true
  const end = Date.parse(to)
  // Half-open: a period ending at 17:00 does not cover 17:00, so one ending
  // exactly where the next begins leaves no gap and no overlap.
  return !Number.isNaN(end) && at < end
}

/**
 * The versions that were believed at `knownAt`.
 *
 * A version recorded *after* the instant we are asking as of is invisible —
 * that is the entire mechanism. Without it, a correction made in July would
 * leak into a reconstruction of March.
 */
function believedAt<T>(
  versions: readonly BitemporalVersion<T>[],
  knownAt: number,
): readonly BitemporalVersion<T>[] {
  return versions.filter((version) => {
    const recorded = Date.parse(version.recordedAt)
    if (Number.isNaN(recorded) || recorded > knownAt) return false
    if (version.supersededAt === null) return true
    const superseded = Date.parse(version.supersededAt)
    // Superseded at or before the instant we are asking about means we had
    // already stopped believing it.
    return Number.isNaN(superseded) ? false : knownAt < superseded
  })
}

export type ResolutionRefusal = "NOTHING_KNOWN" | "AMBIGUOUS"

export type Resolution<T> =
  | { known: true; value: T; version: BitemporalVersion<T> }
  | { known: false; reason: ResolutionRefusal; detail: string }

/**
 * What we believed, at a point in time, about a point in time.
 *
 * Refuses rather than guesses when two un-superseded versions both cover the
 * instant. That is a real state — two corrections recorded without either
 * superseding the other — and picking one by array order is a decision nobody
 * made, in the one place where the answer is later used to judge somebody.
 */
export function resolveAsOf<T>(
  versions: readonly BitemporalVersion<T>[],
  query: TemporalQuery,
): Resolution<T> {
  const knownAt = (query.knownAt ?? new Date()).getTime()
  const validAt = query.validAt.getTime()

  const candidates = believedAt(versions, knownAt).filter((version) =>
    covers(version.validFrom, version.validTo, validAt),
  )

  if (candidates.length === 0) {
    return {
      known: false,
      reason: "NOTHING_KNOWN",
      detail: `Nothing was known about this at ${new Date(validAt).toISOString()}, as of ${new Date(knownAt).toISOString()}.`,
    }
  }
  if (candidates.length > 1) {
    return {
      known: false,
      reason: "AMBIGUOUS",
      detail:
        `${candidates.length} versions were believed simultaneously and all cover this instant. ` +
        `Resolving by order would pick one nobody chose.`,
    }
  }

  return { known: true, value: candidates[0].value, version: candidates[0] }
}

export type CorrectionRefusal = "UNKNOWN_FACT" | "NO_REASON" | "BACKDATED_RECORD" | "ALREADY_SUPERSEDED"

export type CorrectionOutcome<T> =
  | { ok: true; versions: readonly BitemporalVersion<T>[] }
  | { ok: false; reason: CorrectionRefusal; detail: string }

/**
 * Append a superseding version.
 *
 * Never mutates the corrected version's `recordedAt` or its value — the whole
 * point is that what we used to believe stays readable. Only `supersededAt` is
 * set, and only on versions that were still believed.
 *
 * `recordedAt` is supplied rather than taken from a clock inside, because a
 * caller replaying an import needs the times the facts were actually learned,
 * and a function that stamped `now` would record the migration instead of the
 * history.
 */
export function correct<T>(
  versions: readonly BitemporalVersion<T>[],
  correction: {
    factId: string
    value: T
    validFrom: string
    validTo: string | null
    recordedAt: string
    reason: string
  },
): CorrectionOutcome<T> {
  if (!correction.reason.trim()) {
    return {
      ok: false,
      reason: "NO_REASON",
      detail: "A correction with no stated reason cannot be reviewed, and a history of unexplained changes is not a history.",
    }
  }

  const existing = versions.filter((version) => version.factId === correction.factId)
  if (existing.length === 0) {
    return {
      ok: false,
      reason: "UNKNOWN_FACT",
      detail: `No version of "${correction.factId}" exists, so there is nothing to correct. Record the fact first.`,
    }
  }

  const recordedAt = Date.parse(correction.recordedAt)
  if (Number.isNaN(recordedAt)) {
    return { ok: false, reason: "BACKDATED_RECORD", detail: "The correction's recordedAt is not a time." }
  }

  // A correction cannot be learned before the thing it corrects. Transaction
  // time is the one axis that is genuinely monotonic — we cannot un-learn
  // something — and letting it go backwards would make "as of then" unanswerable.
  const latest = Math.max(...existing.map((version) => Date.parse(version.recordedAt)))
  if (Number.isFinite(latest) && recordedAt < latest) {
    return {
      ok: false,
      reason: "BACKDATED_RECORD",
      detail: `This correction claims to have been recorded at ${correction.recordedAt}, before a version already on file. Transaction time only moves forward — a fact cannot be un-learned.`,
    }
  }

  const live = existing.filter((version) => version.supersededAt === null)
  if (live.length === 0) {
    return {
      ok: false,
      reason: "ALREADY_SUPERSEDED",
      detail: "Every version of this fact is already superseded, so there is nothing current to correct.",
    }
  }

  const next: BitemporalVersion<T>[] = versions.map((version) =>
    version.factId === correction.factId && version.supersededAt === null
      ? { ...version, supersededAt: correction.recordedAt }
      : version,
  )

  next.push({
    factId: correction.factId,
    value: correction.value,
    validFrom: correction.validFrom,
    validTo: correction.validTo,
    recordedAt: correction.recordedAt,
    supersededAt: null,
    reason: correction.reason,
  })

  return { ok: true, versions: next }
}

export interface HistoryEntry<T> {
  recordedAt: string
  supersededAt: string | null
  validFrom: string
  validTo: string | null
  value: T
  reason: string
}

/**
 * What we believed and when, oldest first.
 *
 * The answer to "when did the platform learn or correct a fact?", which is one
 * of the six questions §8.2 requires. Ordered by transaction time rather than
 * validity, because that is the order somebody reading an audit is asking about.
 */
export function factHistory<T>(
  versions: readonly BitemporalVersion<T>[],
  factId: string,
): readonly HistoryEntry<T>[] {
  return versions
    .filter((version) => version.factId === factId)
    .slice()
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
    .map((version) => ({
      recordedAt: version.recordedAt,
      supersededAt: version.supersededAt,
      validFrom: version.validFrom,
      validTo: version.validTo,
      value: version.value,
      reason: version.reason,
    }))
}

/**
 * Whether the record of a decision still reads the way it did when it was made.
 *
 * The check an audit actually needs: take a decision's instant, ask what we
 * believed *then*, and compare it with what we believe *now*. A difference is
 * not a fault — corrections are legitimate — but it is the thing a reviewer must
 * be shown rather than left to discover. Judging a past decision against
 * present knowledge is how somebody is blamed for a fact that did not exist.
 */
export function decisionDrifted<T>(
  versions: readonly BitemporalVersion<T>[],
  input: { decidedAt: Date; now?: Date },
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
): { drifted: boolean; thenKnown: boolean; nowKnown: boolean } {
  const then = resolveAsOf(versions, { validAt: input.decidedAt, knownAt: input.decidedAt })
  const now = resolveAsOf(versions, { validAt: input.decidedAt, knownAt: input.now ?? new Date() })

  if (!then.known || !now.known) {
    return { drifted: then.known !== now.known, thenKnown: then.known, nowKnown: now.known }
  }
  return { drifted: !equals(then.value, now.value), thenKnown: true, nowKnown: true }
}
