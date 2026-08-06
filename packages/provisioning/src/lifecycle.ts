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
 */
export const RESIDUAL_COST: Readonly<Partial<Record<TenantState, string>>> = {
  SUSPENDED_LOGICAL:
    "Full infrastructure is retained — compute, database and storage all still bill. Only access is revoked.",
  HIBERNATED_ZERO_RUNTIME:
    "Zero runtime, not zero cost: snapshots, retained object storage, audit evidence and any dedicated edge resources continue to bill.",
  LEGAL_HOLD: "All data is retained by obligation; storage and backup continue to bill.",
  PURGE_PENDING: "Data is retained until the purge is approved and executed.",
  PURGED_ZERO_INCREMENTAL_COST: "No incremental tenant cost. Shared cell resources are unaffected.",
}

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
  reason?: string
}

/** One recorded step. GE-102-002. */
export interface LifecycleStep {
  from: TenantState
  to: TenantState
  at: string
  actor: string
  approvedBy?: string
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

  // Attempt counts per destination, so a retry of PROVISIONING is visibly a
  // retry rather than a fresh start — which is what makes GE-102-011's
  // idempotency claim checkable after the fact.
  const attempt = history.filter((s) => s.to === to).length + 1

  return {
    state: to,
    step: {
      from,
      to,
      at: options.actor.at,
      actor: options.actor.principalId,
      ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      attempt,
    },
  }
}

/** Every state, for exhaustive rendering and testing. */
export const ALL_STATES = Object.keys(TRANSITIONS) as TenantState[]
