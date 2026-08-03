import type { Dated, Seat } from "./continuity"

/**
 * GE-050-006 — what happens to a position, and what happens to its history.
 *
 * Bible §"Core capabilities": "Position request, creation, change, freeze,
 * transfer, split, merge, archive, and approval."
 *
 * Most of these read like CRUD and are not. A seat is the platform's continuity
 * primitive — decisions, files, financial history and operational knowledge
 * attach to it — so every one of these operations is really a question about
 * where that history goes, and the wrong answer is usually the tidy one.
 *
 * The four that carry real decisions:
 *
 *   * **freeze** stops a position being *filled*, not being *held*. Freezing a
 *     post to stop backfilling it must not evict the person currently in it.
 *   * **transfer** moves a seat between units and the history goes with it. The
 *     seat keeps its id, because an id that changed on a reorganisation would
 *     detach every record that referenced it — which is the thing a durable
 *     position exists to prevent.
 *   * **split** and **merge** are where history actually breaks. Both are
 *     handled below with the reasoning, because both have an obvious answer
 *     that is wrong.
 */

export type PositionOperation =
  | "FREEZE"
  | "UNFREEZE"
  | "TRANSFER"
  | "SPLIT"
  | "MERGE"
  | "ARCHIVE"

export type PositionRefusal =
  | "ALREADY_ARCHIVED"
  | "ALREADY_FROZEN"
  | "NOT_FROZEN"
  | "STILL_OCCUPIED"
  | "TARGET_HOLDS_NO_SEATS"
  | "SAME_UNIT"
  | "TOO_FEW_PARTS"
  | "MERGE_WOULD_DROP_A_HOLDER"
  | "NO_REASON"

export interface PositionRefused {
  ok: false
  reason: PositionRefusal
  detail: string
}

/** A seat plus the lifecycle state the operations decide on. */
export interface LivePosition extends Seat {
  /** Frozen positions may not be filled. A current holder keeps the seat. */
  frozenAt: string | null
  /**
   * The seat this one came from, when it was created by a split.
   *
   * A reference, never a copy. Two seats each holding a copy of one history are
   * two records claiming the same past, and a reader has no way to tell which
   * decision belonged to which successor.
   */
  splitFromSeatId?: string | null
  /** Seats folded into this one by a merge. Their history stays with them. */
  mergedFromSeatIds?: readonly string[]
}

export interface OperationContext {
  at: Date
  /** Why. An unexplained reorganisation cannot be reviewed afterwards. */
  reason: string
  /** Whether the seat has a live occupant. Decided by the assignment catalog. */
  occupied: boolean
}

function refuse(reason: PositionRefusal, detail: string): PositionRefused {
  return { ok: false, reason, detail }
}

function reasonProblem(context: OperationContext): PositionRefused | null {
  if (context.reason.trim().length >= 10) return null
  return refuse(
    "NO_REASON",
    "A position change needs a stated reason. An org chart that moved and nobody can say why is one nobody can put back.",
  )
}

function archivedProblem(position: LivePosition): PositionRefused | null {
  if (position.retiredAt === null) return null
  return refuse(
    "ALREADY_ARCHIVED",
    `This position was archived at ${position.retiredAt}. Its history stands; changing it now would edit a record nobody is accountable for.`,
  )
}

/* ────────────────────────────────────────────────────────────── freeze ── */

export type FreezeOutcome = { ok: true; position: LivePosition } | PositionRefused

/**
 * Stop a position being filled.
 *
 * Deliberately does **not** touch the current holder. A hiring freeze that
 * evicted incumbents would be a redundancy programme wearing a budget
 * decision's name, and the two need very different approvals.
 */
export function freezePosition(position: LivePosition, context: OperationContext): FreezeOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(position)
  if (problem) return problem

  if (position.frozenAt !== null) {
    return refuse("ALREADY_FROZEN", `This position was already frozen at ${position.frozenAt}.`)
  }
  return { ok: true, position: { ...position, frozenAt: context.at.toISOString() } }
}

export function unfreezePosition(position: LivePosition, context: OperationContext): FreezeOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(position)
  if (problem) return problem

  if (position.frozenAt === null) {
    return refuse("NOT_FROZEN", "This position is not frozen, so there is nothing to lift.")
  }
  return { ok: true, position: { ...position, frozenAt: null } }
}

/** Whether somebody may be placed in this position now. */
export function positionMayBeFilled(position: LivePosition, at: Date): boolean {
  if (position.retiredAt !== null || position.frozenAt !== null) return false
  const from = Date.parse(position.dated.effectiveFrom)
  if (Number.isNaN(from) || at.getTime() < from) return false
  if (position.dated.effectiveTo === null) return true
  const to = Date.parse(position.dated.effectiveTo)
  return !Number.isNaN(to) && at.getTime() < to
}

/* ──────────────────────────────────────────────────────────── transfer ── */

export type TransferOutcome = { ok: true; position: LivePosition } | PositionRefused

/**
 * Move a position to another unit, history and all.
 *
 * The seat **keeps its id**. An id that changed on a reorganisation would
 * detach every decision, file and financial record that referenced it, which is
 * exactly what a durable position exists to prevent — and reorganisations are
 * frequent enough that the detaching would be routine.
 *
 * The occupant is untouched. Somebody whose department was renamed has not
 * changed job, and a transfer that vacated the seat would make every
 * reorganisation look like a wave of resignations.
 */
export function transferPosition(
  position: LivePosition,
  target: { organizationUnitId: string; holdsSeats: boolean },
  context: OperationContext,
): TransferOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(position)
  if (problem) return problem

  if (target.organizationUnitId === position.organizationUnitId) {
    return refuse("SAME_UNIT", "The position is already in that unit.")
  }
  if (!target.holdsSeats) {
    // GE-050-003. A location is a place; a seat there is authority attached to
    // an address, which nobody can succeed to.
    return refuse(
      "TARGET_HOLDS_NO_SEATS",
      "That unit type does not hold positions, so a seat moved there would belong to nobody.",
    )
  }

  return { ok: true, position: { ...position, organizationUnitId: target.organizationUnitId } }
}

/* ─────────────────────────────────────────────────────────────── split ── */

export interface SplitPart {
  id: string
  title: string
  organizationUnitId?: string
}

export type SplitOutcome =
  | { ok: true; archived: LivePosition; parts: readonly LivePosition[] }
  | PositionRefused

/**
 * One position becomes several.
 *
 * The obvious implementation gives each new seat a copy of the old one's
 * history, and it is wrong: two seats each claiming the same past leave a reader
 * with no way to tell which decision belonged to which successor, and a
 * financial history duplicated across two cost centres is a reconciliation
 * nobody can close.
 *
 * So the original is **archived, not deleted** — its history stays with it,
 * whole and attributable — and each part carries `splitFromSeatId`, a reference
 * back. "Where did this seat come from" is answerable; "which of you owns that
 * decision" never has to be.
 *
 * Refused while occupied. Splitting a post somebody holds gives them either two
 * jobs or none, and which one is a decision for a person, not a default.
 */
export function splitPosition(
  position: LivePosition,
  parts: readonly SplitPart[],
  context: OperationContext,
): SplitOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(position)
  if (problem) return problem

  if (parts.length < 2) {
    return refuse(
      "TOO_FEW_PARTS",
      "A split produces at least two positions. One is a change of title, which does not archive the original.",
    )
  }
  if (context.occupied) {
    return refuse(
      "STILL_OCCUPIED",
      "This position has a live occupant. Splitting it would give them two jobs or none, and which is a decision for a person rather than a default.",
    )
  }

  const dated: Dated = { effectiveFrom: context.at.toISOString(), effectiveTo: null }

  return {
    ok: true,
    archived: { ...position, retiredAt: context.at.toISOString() },
    parts: parts.map((part) => ({
      id: part.id,
      tenantId: position.tenantId,
      organizationUnitId: part.organizationUnitId ?? position.organizationUnitId,
      title: part.title,
      dated,
      retiredAt: null,
      frozenAt: null,
      splitFromSeatId: position.id,
    })),
  }
}

/* ─────────────────────────────────────────────────────────────── merge ── */

export type MergeOutcome =
  | { ok: true; surviving: LivePosition; archived: readonly LivePosition[] }
  | PositionRefused

/**
 * Several positions become one.
 *
 * Refused while more than one has a live holder. A merge that quietly kept one
 * occupant and dropped the other is a dismissal recorded as a data change, and
 * the person who lost their seat would find out from an org chart.
 *
 * The folded positions are archived, not deleted, and the survivor records
 * where they went. Their history stays with them for the same reason a split's
 * does: it is attributable where it happened, and a reader following
 * `mergedFromSeatIds` finds it.
 */
export function mergePositions(
  surviving: LivePosition,
  folding: readonly { position: LivePosition; occupied: boolean }[],
  context: OperationContext,
): MergeOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(surviving)
  if (problem) return problem

  if (folding.length === 0) {
    return refuse("TOO_FEW_PARTS", "A merge needs at least one position to fold in.")
  }

  const alreadyArchived = folding.find((f) => f.position.retiredAt !== null)
  if (alreadyArchived) {
    return refuse(
      "ALREADY_ARCHIVED",
      `"${alreadyArchived.position.id}" is already archived, so it is not a position to merge.`,
    )
  }

  const occupants = (context.occupied ? 1 : 0) + folding.filter((f) => f.occupied).length
  if (occupants > 1) {
    return refuse(
      "MERGE_WOULD_DROP_A_HOLDER",
      `${occupants} of these positions have live occupants. Merging them would end somebody's assignment as a side effect of a data change; end it deliberately first.`,
    )
  }

  return {
    ok: true,
    surviving: {
      ...surviving,
      mergedFromSeatIds: [
        ...(surviving.mergedFromSeatIds ?? []),
        ...folding.map((f) => f.position.id),
      ],
    },
    archived: folding.map((f) => ({ ...f.position, retiredAt: context.at.toISOString() })),
  }
}

/* ───────────────────────────────────────────────────────────── archive ── */

export type ArchiveOutcome = { ok: true; position: LivePosition } | PositionRefused

/**
 * Retire a position.
 *
 * Never a delete. Its decisions, files and financial history remain attached and
 * the record of who held it stays answerable — which is the difference between
 * retiring a post and losing the reason it existed.
 *
 * Refused while occupied, because archiving a seat somebody holds ends their
 * assignment silently. Ending it first is one extra step and one extra record,
 * and the record is the point.
 */
export function archivePosition(position: LivePosition, context: OperationContext): ArchiveOutcome {
  const problem = reasonProblem(context) ?? archivedProblem(position)
  if (problem) return problem

  if (context.occupied) {
    return refuse(
      "STILL_OCCUPIED",
      "This position has a live occupant. Archiving it would end their assignment silently; end it deliberately first.",
    )
  }
  return { ok: true, position: { ...position, retiredAt: context.at.toISOString() } }
}

/* ─────────────────────────────────────────────── term transition ── */

export interface TermTransition {
  seatId: string
  outgoingPersonId: string | null
  incomingPersonId: string | null
}

export interface TransitionPlan {
  /** Seats whose holder changes. */
  handovers: readonly TermTransition[]
  /** Seats with an outgoing holder and nobody named. */
  vacancies: readonly string[]
  /** Seats with an incoming holder and no predecessor to learn from. */
  coldStarts: readonly string[]
}

/**
 * What a term turnover actually involves, seat by seat.
 *
 * A whole board turning over at once is the education case, and the failure it
 * invites is treating it as a bulk update: every seat reassigned, and nobody
 * notices that four of them have nobody named and two of the incoming holders
 * have no predecessor to learn from.
 *
 * Those two are separated because they need different action. A **vacancy**
 * needs somebody found. A **cold start** has somebody — they simply have nobody
 * to hand over from, which is the case where the seat's accumulated memory is
 * the only continuity there is, and the one worth flagging before the term
 * begins rather than after.
 */
export function planTermTransition(transitions: readonly TermTransition[]): TransitionPlan {
  const handovers: TermTransition[] = []
  const vacancies: string[] = []
  const coldStarts: string[] = []

  for (const transition of transitions) {
    if (transition.incomingPersonId === null) {
      // Nobody named. Whether somebody is leaving or the seat was already empty,
      // the action is the same: find somebody.
      vacancies.push(transition.seatId)
      continue
    }
    if (transition.outgoingPersonId === null) {
      coldStarts.push(transition.seatId)
      continue
    }
    if (transition.outgoingPersonId === transition.incomingPersonId) {
      // Re-elected. Not a handover, and listing it as one would put a
      // meaningless task on somebody's transition checklist.
      continue
    }
    handovers.push(transition)
  }

  return { handovers, vacancies, coldStarts }
}
