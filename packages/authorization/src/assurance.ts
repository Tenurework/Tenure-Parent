import type { ISODate } from "./model"

/**
 * GE-051-002 — how sure the platform is that the session is who it says.
 *
 * Bible §9.2 lists "risk/session assurance" among the inputs to every decision,
 * and §9.4 requires step-up MFA before support access. Neither was expressible:
 * a decision knew *who* was asking and nothing about *how well they had proved
 * it*, so "you may approve payments" and "you may approve payments from a
 * session you opened three weeks ago on a device we have never seen" were the
 * same sentence.
 *
 * ## Assurance is ordered, and that is the whole point
 *
 * The comparison has to be "at least", not "equal to". The architecture's tier
 * check got this wrong in the other direction — `tier = min_tier OR tier =
 * 'enterprise'` — and an upgraded tenant matched neither. Equality on an ordered
 * thing fails the same way here, except the failure is a step-up prompt that
 * cannot be satisfied: a principal who authenticated with a hardware key would
 * be refused an action requiring a one-time code.
 */
export const ASSURANCE_LEVELS = [
  /** A session, and nothing more is known. */
  "SESSION",
  /** A password or equivalent was presented in this session. */
  "PASSWORD",
  /** A second factor was presented in this session. */
  "MFA",
  /** A second factor was presented for this specific action, recently. */
  "STEP_UP",
  /** A phishing-resistant authenticator. Nothing above this. */
  "HARDWARE",
] as const

export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number]

const RANK: ReadonlyMap<AssuranceLevel, number> = new Map(
  ASSURANCE_LEVELS.map((level, i) => [level, i]),
)

/** `-1` for an unrecognised level, so an unknown one satisfies nothing. */
export function assuranceRank(level: string): number {
  return RANK.get(level as AssuranceLevel) ?? -1
}

/**
 * Does `held` meet `required`?
 *
 * An unrecognised held level meets nothing, including `SESSION`. Reading it
 * charitably would mean a typo in a session record grants whatever it is
 * compared against, and this is the comparison a step-up requirement rests on.
 */
export function meetsAssurance(held: string, required: string): boolean {
  const heldRank = assuranceRank(held)
  const requiredRank = assuranceRank(required)
  if (heldRank < 0 || requiredRank < 0) return false
  return heldRank >= requiredRank
}

/**
 * How the session was established, as the decision sees it.
 *
 * `establishedAt` is here because assurance decays. A step-up satisfied at
 * 09:00 is not a step-up at 17:00, and a model that recorded only the level
 * would treat them as identical — which turns "confirm it is you" into
 * "confirm it was you once today".
 */
export interface SessionAssurance {
  level: AssuranceLevel
  establishedAt: ISODate
  /**
   * Risk the platform assessed for this session, 0–100.
   *
   * A number rather than a band, because the thresholds belong to the policy
   * that reads it. Bands here would mean every policy inherits one team's idea
   * of "high".
   */
  risk?: number
}

/**
 * What a permission demands of the session asking for it.
 *
 * Declared per permission rather than as a field on the permission itself: the
 * catalog is the same everywhere and this is not. A platform that requires
 * step-up before approving payments is making a policy choice, and the same
 * permission somewhere else may reasonably want only MFA.
 */
export interface AssuranceRequirement {
  permission: string
  minimum: AssuranceLevel
  /**
   * How long the level stays good for, in seconds. Absent means it does not
   * decay within the session.
   *
   * Only meaningful above `MFA` — a password does not become less true with
   * time, it becomes less *recent*, and re-prompting for it proves nothing a
   * stolen session could not also produce.
   */
  maxAgeSeconds?: number
  /** Refuse above this risk score, whatever the level. */
  maxRisk?: number
}

export type AssuranceFailure = "TOO_LOW" | "STALE" | "TOO_RISKY" | "NO_SESSION"

export interface AssuranceOutcome {
  ok: boolean
  failure?: AssuranceFailure
  detail?: string
}

/**
 * Does this session satisfy the requirement, at this instant?
 *
 * Fails closed on a missing session: a requirement that exists and a session
 * the caller could not describe is the case where something has gone wrong
 * upstream, and "we could not tell" is not "yes".
 */
export function checkAssurance(
  requirement: AssuranceRequirement | undefined,
  session: SessionAssurance | undefined,
  at: ISODate,
): AssuranceOutcome {
  if (!requirement) return { ok: true }

  if (!session) {
    return {
      ok: false,
      failure: "NO_SESSION",
      detail:
        `"${requirement.permission}" requires ${requirement.minimum} and nothing is known about ` +
        `this session. A decision that cannot see the session cannot claim it was assured.`,
    }
  }

  if (!meetsAssurance(session.level, requirement.minimum)) {
    return {
      ok: false,
      failure: "TOO_LOW",
      detail:
        `"${requirement.permission}" requires ${requirement.minimum}; this session is ` +
        `${session.level}.`,
    }
  }

  if (requirement.maxAgeSeconds != null) {
    const established = Date.parse(session.establishedAt)
    const instant = Date.parse(at)
    if (Number.isNaN(established) || Number.isNaN(instant)) {
      return {
        ok: false,
        failure: "STALE",
        detail: "This session's establishment time could not be read, so its age is unknown.",
      }
    }
    const ageSeconds = (instant - established) / 1000
    if (ageSeconds > requirement.maxAgeSeconds) {
      return {
        ok: false,
        failure: "STALE",
        detail:
          `"${requirement.permission}" needs assurance no older than ${requirement.maxAgeSeconds}s; ` +
          `this session's is ${Math.round(ageSeconds)}s old.`,
      }
    }
  }

  if (requirement.maxRisk != null && session.risk != null && session.risk > requirement.maxRisk) {
    return {
      ok: false,
      failure: "TOO_RISKY",
      detail:
        `"${requirement.permission}" refuses sessions scoring above ${requirement.maxRisk}; this ` +
        `one scores ${session.risk}.`,
    }
  }

  return { ok: true }
}

/**
 * The requirement that applies to a permission, or none.
 *
 * The **strictest** match wins when more than one is declared, rather than the
 * first. Order-dependence in a security rule means adding a requirement can
 * weaken one already there, and the person adding it has no reason to look.
 */
export function requirementFor(
  requirements: readonly AssuranceRequirement[] | undefined,
  permission: string,
): AssuranceRequirement | undefined {
  const matching = (requirements ?? []).filter((r) => r.permission === permission)
  if (matching.length === 0) return undefined

  return matching.reduce((strictest, candidate) => {
    if (assuranceRank(candidate.minimum) > assuranceRank(strictest.minimum)) return candidate
    if (assuranceRank(candidate.minimum) < assuranceRank(strictest.minimum)) return strictest

    // Same level: take the tighter age and the tighter risk, from wherever each
    // came. Choosing one whole requirement would silently drop the other's
    // constraint.
    return {
      permission,
      minimum: strictest.minimum,
      maxAgeSeconds: tighter(strictest.maxAgeSeconds, candidate.maxAgeSeconds),
      maxRisk: tighter(strictest.maxRisk, candidate.maxRisk),
    }
  })
}

function tighter(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}
