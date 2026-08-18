/**
 * The tenant lifecycle, as a state machine that cannot be talked out of.
 *
 * GE-102-001 names these states and says, in as many words: *do not reduce
 * lifecycle to a misleading active boolean.* That instruction is doing real
 * work. A boolean cannot distinguish a tenant that is paused but still costing
 * money from one that is scaled to zero, or one whose data is under legal hold
 * from one awaiting purge — and every one of those distinctions is either a
 * bill someone did not expect or a compliance answer someone cannot give.
 */

import { RESIDUAL_CLAIMS, type ResidualClaim } from "./residual-reconciliation"
import { tombstoneProblems } from "./tombstone"
import type { PurgeClearance } from "./purge-gate"

/** Where a tenant is, exactly. */
export type TenantState =
  // ── Bringing one up ──────────────────────────────────────────────────────
  | "DRAFT"
  | "VALIDATING"
  | "PLANNED"
  | "AWAITING_APPROVAL"
  | "PROVISIONING"
  | "CONFIGURING"
  | "MIGRATING"
  | "VERIFYING"
  | "READY"
  | "ACTIVATING"
  | "ACTIVE"
  // ── Running, but not serving ─────────────────────────────────────────────
  | "IDLE"
  | "SUSPENDING"
  | "SUSPENDED_LOGICAL"
  | "HIBERNATING"
  | "HIBERNATED_ZERO_RUNTIME"
  | "REACTIVATING"
  // ── Leaving ──────────────────────────────────────────────────────────────
  | "EXPORTING"
  | "OFFBOARDING"
  | "LEGAL_HOLD"
  | "PURGE_PENDING"
  | "PURGING"
  | "PURGED_ZERO_INCREMENTAL_COST"
  // ── Not where anyone wanted to be ────────────────────────────────────────
  | "FAILED"
  | "ROLLING_BACK"

/**
 * Legal transitions.
 *
 * Everything reachable is reachable from exactly one place, on purpose. The
 * cost of a permissive graph is not a wrong diagram — it is a tenant that
 * reached ACTIVE without VERIFYING, which is an outage discovered by its users.
 */
const TRANSITIONS: Readonly<Record<TenantState, readonly TenantState[]>> = {
  DRAFT: ["VALIDATING", "OFFBOARDING"],
  VALIDATING: ["PLANNED", "FAILED", "DRAFT"],
  PLANNED: ["AWAITING_APPROVAL", "DRAFT"],
  AWAITING_APPROVAL: ["PROVISIONING", "DRAFT"],
  PROVISIONING: ["CONFIGURING", "FAILED", "ROLLING_BACK"],
  CONFIGURING: ["MIGRATING", "FAILED", "ROLLING_BACK"],
  MIGRATING: ["VERIFYING", "FAILED", "ROLLING_BACK"],
  VERIFYING: ["READY", "FAILED", "ROLLING_BACK"],

  // READY is provisioned-but-not-routed. The separation is the whole point of
  // GE-102-010: routing is switched on as its own act, after the gates, so a
  // tenant that built correctly but verifies badly never receives a request.
  READY: ["ACTIVATING", "ROLLING_BACK", "OFFBOARDING"],
  ACTIVATING: ["ACTIVE", "ROLLING_BACK", "FAILED"],

  ACTIVE: ["IDLE", "SUSPENDING", "HIBERNATING", "EXPORTING", "OFFBOARDING", "LEGAL_HOLD"],
  IDLE: ["ACTIVE", "SUSPENDING", "HIBERNATING", "OFFBOARDING"],

  SUSPENDING: ["SUSPENDED_LOGICAL", "FAILED"],
  SUSPENDED_LOGICAL: ["REACTIVATING", "HIBERNATING", "OFFBOARDING", "LEGAL_HOLD"],
  HIBERNATING: ["HIBERNATED_ZERO_RUNTIME", "FAILED"],
  HIBERNATED_ZERO_RUNTIME: ["REACTIVATING", "OFFBOARDING", "LEGAL_HOLD"],
  REACTIVATING: ["ACTIVE", "FAILED"],

  EXPORTING: ["ACTIVE", "OFFBOARDING", "FAILED"],
  OFFBOARDING: ["PURGE_PENDING", "LEGAL_HOLD", "EXPORTING"],

  // Legal hold releases back to where it can be decided again, never straight
  // to PURGING. A hold that can be lifted directly into deletion is not a hold.
  LEGAL_HOLD: ["OFFBOARDING", "ACTIVE", "SUSPENDED_LOGICAL"],

  PURGE_PENDING: ["PURGING", "LEGAL_HOLD", "OFFBOARDING"],
  PURGING: ["PURGED_ZERO_INCREMENTAL_COST", "FAILED"],
  PURGED_ZERO_INCREMENTAL_COST: [],

  FAILED: ["ROLLING_BACK", "DRAFT", "OFFBOARDING"],
  ROLLING_BACK: ["DRAFT", "FAILED"],
}

/**
 * States that require a recorded human decision to leave.
 *
 * Not "should ask" — cannot leave. `advance` refuses without an approver, so
 * the approval is a property of the transition rather than a step someone can
 * forget to put in front of it.
 */
export const REQUIRES_APPROVAL: Readonly<Partial<Record<TenantState, readonly TenantState[]>>> = {
  AWAITING_APPROVAL: ["PROVISIONING"],
  // Deleting a tenant's data is the one action with no undo.
  PURGE_PENDING: ["PURGING"],
  // Routing real users at a new system.
  READY: ["ACTIVATING"],
}

/** States in which the tenant serves requests. */
export const SERVING: ReadonlySet<TenantState> = new Set<TenantState>(["ACTIVE", "IDLE"])

/** Terminal states. */
export const TERMINAL: ReadonlySet<TenantState> = new Set<TenantState>([
  "PURGED_ZERO_INCREMENTAL_COST",
])

/**
 * Whether a state can still cost money, and why.
 *
 * GE-103-012: `HIBERNATED_ZERO_RUNTIME` may retain priced recovery, storage and
 * evidence, and **must never be displayed as $0 if it is not.** The name says
 * zero *runtime*, and a console that renders that as "free" is the specific lie
 * this map exists to prevent.
 *
 * WRK-120-005: derived from `RESIDUAL_CLAIMS` rather than declared, so the
 * sentence a console prints and the resource list `reconcileResidual` checks
 * against are one fact. Written twice, the sentence is what everybody reads and
 * the list is what everybody trusts, and the day they disagree the console is
 * confidently wrong.
 */
export const RESIDUAL_COST: Readonly<Partial<Record<TenantState, string>>> = Object.fromEntries(
  Object.values(RESIDUAL_CLAIMS)
    .filter((c): c is ResidualClaim => c !== undefined)
    .map((claim) => [claim.state, claim.note]),
) as Readonly<Partial<Record<TenantState, string>>>

/**
 * WRK-120-005 — states a tenant may not be moved into without a recorded owner.
 *
 * Owner departure is the case. A tenant is suspended, hibernated or offboarded
 * for exactly one common reason — the person who owned it left — and until this
 * existed the move recorded who pressed the button and nothing about who is
 * responsible for the thing afterwards. The result is an orphan: a tenant with
 * retained data, a residual bill and nobody to ask about either, discovered
 * months later by finance.
 *
 * The same shape as `REQUIRES_APPROVAL`, and for the same reason — it is a
 * property of the transition rather than a step somebody remembers to do first.
 * It is deliberately NOT the approver: the approver agrees to the move, the
 * owner is who answers for the tenant after it. One person can be both, and the
 * engine does not care, because refusing that would stop a small team from
 * suspending anything.
 */
export const REQUIRES_OWNER: ReadonlySet<TenantState> = new Set<TenantState>([
  "SUSPENDING",
  "HIBERNATING",
  "OFFBOARDING",
])

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly from: TenantState,
    readonly to: TenantState,
  ) {
    super(message)
    this.name = "LifecycleError"
  }
}

/** The states reachable from here. */
export function nextStates(from: TenantState): readonly TenantState[] {
  return TRANSITIONS[from] ?? []
}

export function canAdvance(from: TenantState, to: TenantState): boolean {
  return nextStates(from).includes(to)
}

/** Whether leaving `from` for `to` needs a recorded approver. */
export function needsApproval(from: TenantState, to: TenantState): boolean {
  return (REQUIRES_APPROVAL[from] ?? []).includes(to)
}

export interface Actor {
  /** Who. An operator's identity, never a service name standing in for one. */
  principalId: string
  at: string
}

export interface AdvanceOptions {
  actor: Actor
  /** Required where `needsApproval` — a second identity, not the same person. */
  approvedBy?: string
  /**
   * Whether the caller looked `approvedBy` up and found a platform operator.
   *
   * The answer, not the email, because this package must not carry the operator
   * registry — and passing the answer means there is no way to be "verified"
   * against the wrong list. Undefined is a refusal.
   *
   * This does NOT make the transition two-party. The approver still does not
   * authenticate: one operator types another operator's address. What it
   * removes is the ability to type anything at all.
   */
  approverIsOperator?: boolean
  /**
   * WRK-120-005 — who answers for this tenant after the move.
   *
   * Required by `advance` for every destination in `REQUIRES_OWNER`, refused
   * when blank. Optional in the type because most transitions do not need one
   * and demanding it everywhere would turn a real control into a field people
   * fill with the same word every time.
   *
   * The successor, not the departing owner. Recording who left says what
   * happened; recording who is now responsible is the thing that stops the
   * tenant being an orphan, and only one of those can be acted on six months
   * later when the bill arrives.
   */
  ownerPrincipalId?: string
  reason?: string

  /**
   * GE-103-013 — the seven pre-purge checks and the destructive approval,
   * already evaluated.
   *
   * Required by `advance` for `PURGE_PENDING → PURGING`, which is the only edge
   * into the only state from which `PURGED_ZERO_INCREMENTAL_COST` is reachable.
   * Absent is a refusal, exactly as `approverIsOperator` is: a caller that
   * forgets the field must not be able to skip the control by omission.
   *
   * The evaluated clearance rather than the raw facts, because the facts are
   * read from stores this package must not know about — a contract end date, a
   * tax schedule, a legal-hold matter. `purgeClearance` is the function that
   * turns them into this, and it lives beside this one so there is no second
   * reading of what "cleared" means.
   */
  purgeClearance?: PurgeClearance

  /**
   * GE-103-015 — what is left in the Parent afterwards.
   *
   * Required by `advance` for `PURGING → PURGED_ZERO_INCREMENTAL_COST`, and
   * typed `unknown` on purpose: a caller that has built one gets it checked
   * rather than trusted, which is the same argument `tombstoneProblems` makes
   * about rows read back out of a store. A tenant may not be recorded as purged
   * until the thing that survives the purge has been checked to carry nothing
   * that should not have.
   */
  tombstone?: unknown
}

/** One recorded step. GE-102-002. */
export interface LifecycleStep {
  from: TenantState
  to: TenantState
  at: string
  actor: string
  approvedBy?: string
  /** Who owns the tenant from this step on. Present wherever `REQUIRES_OWNER`. */
  ownerPrincipalId?: string
  reason?: string
  attempt: number
}

/**
 * Move a tenant, or refuse and say why.
 *
 * Returns the new state and the step to persist. It does not persist anything
 * itself: this module is the rules, and keeping it free of storage is what lets
 * the rules be tested exhaustively without a database.
 */
export function advance(
  from: TenantState,
  to: TenantState,
  options: AdvanceOptions,
  history: readonly LifecycleStep[] = [],
): { state: TenantState; step: LifecycleStep } {
  if (TERMINAL.has(from)) {
    throw new LifecycleError(`${from} is terminal; nothing follows it.`, from, to)
  }

  if (!canAdvance(from, to)) {
    const allowed = nextStates(from)
    throw new LifecycleError(
      `Cannot go ${from} → ${to}. From ${from} the only legal moves are: ${allowed.join(", ") || "none"}.`,
      from,
      to,
    )
  }

  if (needsApproval(from, to)) {
    if (!options.approvedBy) {
      throw new LifecycleError(
        `${from} → ${to} requires a recorded approver. This transition is one of the three that ` +
          `cannot be automated: provisioning spends money, activating routes real users, and ` +
          `purging cannot be undone.`,
        from,
        to,
      )
    }
    if (options.approvedBy === options.actor.principalId) {
      // Separation of duties. The person who asked is not the person who agrees.
      throw new LifecycleError(
        `${options.actor.principalId} cannot approve their own ${from} → ${to}.`,
        from,
        to,
      )
    }
    // The approver has to be somebody. Until this existed, the whole check was
    // "non-empty, and not your own id" — and the value's only source is a
    // free-text field the requesting operator types. `approvedBy="x@y.z"`
    // satisfied PURGE_PENDING → PURGING: one person approving their own
    // irreversible purge by naming an address that was not theirs.
    //
    // The caller does the lookup because this package must not depend on the
    // Studio's operator registry, and it passes the ANSWER rather than the
    // email so there is no way to be "verified" against the wrong list. Absent
    // is a refusal, not a pass: a caller that forgets to check fails closed.
    if (options.approverIsOperator !== true) {
      throw new LifecycleError(
        `"${options.approvedBy}" was not verified as a platform operator, so it cannot approve ` +
          `${from} → ${to}. An unverified approver is a free-text field, and this transition ` +
          `either spends money, routes real users, or cannot be undone.`,
        from,
        to,
      )
    }
  }

  // WRK-120-005. A tenant cannot be parked or wound down with nobody named as
  // responsible for it. This is the owner-departure control: the usual reason
  // to suspend, hibernate or offboard is that the person who owned it left, and
  // the move that follows a departure is exactly the one that must not be able
  // to leave the tenant unowned.
  //
  // After the approval gate, not before: an unapproved purge and an unowned
  // suspension are both refusals, and the approval one is the older and more
  // load-bearing of the two.
  if (REQUIRES_OWNER.has(to) && !options.ownerPrincipalId?.trim()) {
    throw new LifecycleError(
      `${from} → ${to} requires a recorded owner. Moving a tenant into ${to} without naming who ` +
        `answers for it afterwards is how an owner's departure leaves an orphan: retained data, a ` +
        `residual bill, and nobody to ask about either.`,
      from,
      to,
    )
  }

  // GE-103-013. The destructive edge. After the approval and owner gates
  // because those are cheap to satisfy and this one takes fifteen minutes to
  // satisfy — an operator sent to wait out a cooling-off period only to be told
  // afterwards that their approver was unverified has been made to discover the
  // list one item at a time.
  if (from === "PURGE_PENDING" && to === "PURGING") {
    if (!options.purgeClearance) {
      throw new LifecycleError(
        `PURGE_PENDING → PURGING requires a purge clearance. Seven checks — export, contract, ` +
          `retention, legal hold, tax, audit and cooling-off — plus a separate protected ` +
          `destructive human approval have to have been evaluated before a tenant's data is ` +
          `destroyed, and no clearance was supplied. An absent clearance is a refusal rather than ` +
          `a default: this is the one transition with no undo.`,
        from,
        to,
      )
    }
    if (!options.purgeClearance.cleared) {
      throw new LifecycleError(
        `PURGE_PENDING → PURGING is refused.\n${options.purgeClearance.explanation}`,
        from,
        to,
      )
    }
  }

  // GE-103-015. Nothing is recorded as purged until what survives the purge has
  // been checked. The check runs on the value as given, not on its type.
  if (to === "PURGED_ZERO_INCREMENTAL_COST") {
    if (options.tombstone === undefined) {
      throw new LifecycleError(
        `PURGING → PURGED_ZERO_INCREMENTAL_COST requires a tombstone. It is the only record that ` +
          `survives, and a tenant recorded as purged with nothing left behind cannot answer who ` +
          `approved it, when it happened, or where the evidence is.`,
        from,
        to,
      )
    }
    const problems = tombstoneProblems(options.tombstone)
    if (problems.length > 0) {
      throw new LifecycleError(
        `The tombstone for ${to} was refused on ${problems.length} ground(s): ` +
          problems.map((p) => `${p.field || "(root)"} — ${p.reason}: ${p.detail}`).join(" | "),
        from,
        to,
      )
    }
  }

  const attempt = attemptFor(history, to)

  return {
    state: to,
    step: {
      from,
      to,
      at: options.actor.at,
      actor: options.actor.principalId,
      ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
      ...(options.ownerPrincipalId?.trim()
        ? { ownerPrincipalId: options.ownerPrincipalId.trim() }
        : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      attempt,
    },
  }
}

/**
 * Which try at a destination the next move would be.
 *
 * Counts per destination, so a retry of PROVISIONING is visibly a retry rather
 * than a fresh start — which is what makes GE-102-011's idempotency claim
 * checkable after the fact.
 *
 * Exported because `advance` is not the only thing that needs the number.
 * STUDIO-060-010 stamps the attempt onto the step's EVIDENCE too, and that is
 * produced by `executeStep` before `advance` runs — so a caller has to compute
 * it. Two implementations of "which attempt is this" would be a step numbered
 * one thing in the history and another in the evidence that proves it.
 */
export function attemptFor(history: readonly LifecycleStep[], to: TenantState): number {
  return history.filter((s) => s.to === to).length + 1
}

/** Every state, for exhaustive rendering and testing. */
export const ALL_STATES = Object.keys(TRANSITIONS) as TenantState[]
