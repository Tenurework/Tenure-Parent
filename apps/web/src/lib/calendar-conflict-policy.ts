import type { CapabilityId } from "@/lib/admin/capabilities"
import {
  CONFLICT_RULES,
  isBlockingConflict,
  type ConflictRule,
  type DetectedConflict,
} from "@/lib/calendar"

/**
 * What a detected conflict is allowed to do to a calendar write.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 * Detection existed; governance did not. A drag-to-reschedule wrote the new
 * time first and classified afterwards, so a HARD conflict — the same room
 * booked twice, a club double-booking itself — produced a notification and
 * nothing else. "Hard" named a colour in the UI, not a rule with authority
 * behind it. Anyone who could move an event could move it into a clash.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A HARD conflict BLOCKS the write. It can be overridden, but only by an actor
 * who (a) holds the `event.override` capability and (b) says so explicitly, in
 * this request, with a written reason. Three separate conditions, because each
 * removes a different failure:
 *
 *   · authority alone would make every OSE Director's ordinary drag silently
 *     bypass the rule they are supposed to be enforcing;
 *   · an explicit request alone would let anyone opt out of the gate by
 *     setting a flag the client controls;
 *   · without a reason there is nothing for the audit row to say beyond
 *     "someone chose to", which is not an account of a decision.
 *
 * SOFT and INFORMATIONAL conflicts never block. They are competition and
 * coincidence, not collisions, and blocking on them would train officers to
 * treat the override as routine — which is how a hard gate stops meaning
 * anything.
 *
 * This module is pure: no database, no session, no clock. The caller supplies
 * the conflicts, whether the actor holds the capability, and what the actor
 * asked for; the decision it returns is what gets written to the audit log.
 */

/** The authority that can override a blocking conflict. */
export const EVENT_OVERRIDE_CAPABILITY: CapabilityId = "event.override"

/**
 * An override reason is written into the audit log and read by whoever asks
 * later why the room was double-booked. "ok" is not an answer, so a floor is
 * enforced here rather than left to each caller's form validation.
 */
export const MIN_OVERRIDE_REASON = 10

/** What the actor asked for, as it arrives from a caller. */
export interface ConflictOverrideRequest {
  requested: boolean
  reason?: string | null
}

export interface ConflictDecisionInput {
  conflicts: DetectedConflict[]
  /** Does this actor hold `event.override` at this event's institution? */
  actorHasOverride: boolean
  /** Did this request explicitly ask to override, rather than merely proceed? */
  overrideRequested: boolean
  overrideReason?: string | null
}

/** Why a write was refused — a code, so callers and tests do not match on prose. */
export type ConflictBlockCode =
  | "NO_OVERRIDE_AUTHORITY"
  | "OVERRIDE_NOT_REQUESTED"
  | "OVERRIDE_REASON_REQUIRED"

export interface ConflictOverrideDecision {
  rules: ConflictRule[]
  reason: string
  conflictWithEventIds: string[]
}

export interface ConflictDecision {
  allowed: boolean
  /** Distinct blocking rule ids standing in the way, in detection order. */
  blockedByRules: ConflictRule[]
  /** Present exactly when `allowed` is false. */
  blocked: null | { code: ConflictBlockCode; requiredCapability: CapabilityId }
  /** Present exactly when a blocking conflict was overridden to allow the write. */
  override: null | ConflictOverrideDecision
  /** One sentence — shown to the actor AND recorded on the audit row. */
  explanation: string
}

function distinctRules(conflicts: DetectedConflict[]): ConflictRule[] {
  return [...new Set(conflicts.map((c) => c.rule))]
}

function nameRules(rules: ConflictRule[]): string {
  const labels = rules.map((r) => CONFLICT_RULES[r]?.label ?? r)
  if (labels.length <= 1) return labels[0] ?? "conflict"
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

/**
 * Decide whether a calendar write may proceed in the face of its conflicts.
 *
 * Blocking severity is read from the rule table (`isBlockingConflict`), not
 * from the severity field on the record, so a caller cannot downgrade a rule by
 * handing back a mutated copy of what detection returned.
 */
export function decideConflictOutcome(input: ConflictDecisionInput): ConflictDecision {
  const blocking = input.conflicts.filter(isBlockingConflict)

  if (blocking.length === 0) {
    const advisory = input.conflicts.length
    return {
      allowed: true,
      blockedByRules: [],
      blocked: null,
      override: null,
      explanation:
        advisory === 0
          ? "No conflicts."
          : `${advisory} advisory conflict${advisory === 1 ? "" : "s"} ` +
            `(${nameRules(distinctRules(input.conflicts))}) — these do not block.`,
    }
  }

  const rules = distinctRules(blocking)
  const named = nameRules(rules)
  const first = blocking[0].reason
  const blockedBase = { allowed: false as const, blockedByRules: rules, override: null }

  if (!input.actorHasOverride) {
    return {
      ...blockedBase,
      blocked: { code: "NO_OVERRIDE_AUTHORITY", requiredCapability: EVENT_OVERRIDE_CAPABILITY },
      explanation:
        `Blocked by ${named}. ${first}. ` +
        `Only an administrator holding “Override events” can schedule over it.`,
    }
  }

  if (!input.overrideRequested) {
    return {
      ...blockedBase,
      blocked: { code: "OVERRIDE_NOT_REQUESTED", requiredCapability: EVENT_OVERRIDE_CAPABILITY },
      explanation:
        `Blocked by ${named}. ${first}. ` +
        `You hold “Override events” — re-submit as an explicit override, with a reason, to proceed.`,
    }
  }

  const reason = (input.overrideReason ?? "").trim()
  if (reason.length < MIN_OVERRIDE_REASON) {
    return {
      ...blockedBase,
      blocked: { code: "OVERRIDE_REASON_REQUIRED", requiredCapability: EVENT_OVERRIDE_CAPABILITY },
      explanation:
        `Blocked by ${named}. An override must record why, in at least ` +
        `${MIN_OVERRIDE_REASON} characters.`,
    }
  }

  return {
    allowed: true,
    blockedByRules: [],
    blocked: null,
    override: {
      rules,
      reason,
      conflictWithEventIds: [...new Set(blocking.map((c) => c.conflictWithEventId))],
    },
    explanation: `Overridden ${named} under “Override events”: ${reason}`,
  }
}
