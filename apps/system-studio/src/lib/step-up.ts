import { approvalFor, fromMinorUnits } from "@tenure/finops"
import { classify, type ChangeOperation } from "@tenure/provisioning"

import { POLICY_REVISION, STUDIO_COMMANDS, type StudioCommand } from "./authorize"
import type { OperatorResource, OperatorVerb } from "./operators"

/**
 * STUDIO-020-008 — step-up authentication and fresh authorization, for the
 * seven kinds of action the Bible names.
 *
 * ## What was here before
 *
 * Nothing. `command-gate.ts` carried the gap in its own header — "There is no
 * step-up check here. STUDIO-020-008 is not implemented anywhere in this
 * repository" — and a comment at line 223 marking where one would go. So a
 * console session that authenticated at 09:00 could purge a tenant at 18:00
 * with no further proof that the person at the keyboard was still the operator
 * who signed in. The lifecycle engine demanded a second approver's ADDRESS; it
 * never demanded that the requester still be present.
 *
 * ## The two halves, which are different questions
 *
 *   * **Step-up authentication** — is the person asking still, demonstrably,
 *     the operator who signed in? Answered from the moment authentication
 *     actually happened, not from the age of the cookie. A JWT session cookie
 *     is re-issued on every request, so `iat` says when the browser last
 *     spoke to the server, which is a liveness signal about the TAB.
 *     `authenticatedAt` is stamped once, at sign-in, and carried forward
 *     unchanged (`stampAuthentication` below).
 *   * **Fresh authorization** — was the permission this is running under
 *     decided against the policy that is in force NOW? The grant table can
 *     change while a tenant page sits open. `POLICY_REVISION` is derived from
 *     `OPERATOR_GRANTS` itself, so a revision submitted by a form that was
 *     rendered under the old table no longer matches, and the decision is
 *     retaken rather than inherited.
 *
 * Both fail CLOSED, and the two "cannot corroborate" arms are deliberately
 * refusals rather than passes: a session with no `authenticatedAt` is a session
 * minted before this check existed, and treating an uncheckable session as a
 * fresh one is how a control ships and protects nothing.
 *
 * ## Nothing here is a second list
 *
 * The seven triggers are DERIVED from tables that already decide these things:
 * `STUDIO_COMMANDS` says what resource and verb a command is,
 * `classify` from `@tenure/provisioning` says what class a change is, and
 * `approvalFor` from `@tenure/finops` says which cost band it falls in. A
 * hand-written list of "dangerous commands" here would be a list that disagrees
 * with the gate the first time somebody adds a command — the same argument
 * `lib/tenant-state.ts` makes about `ARCHIVED_STATES`.
 *
 * That has a consequence this module states rather than hides:
 * `triggersNoCommandCanFire()` computes which of the seven NO command in this console
 * can currently fire, and today that is `identity` and `data-export` for the
 * command table — the console has no identity-mutating command, and its data
 * export is an HTTP route rather than a typed command, so the export surface
 * calls `dataExportStepUp` directly. A trigger that can never fire and says so
 * is a gap somebody can close; a trigger that can never fire and looks
 * enforced is the shape of a control nobody checks.
 *
 * Pure and clock-injected. No `server-only`, no `@/` alias, no `process.env`:
 * every input is a parameter, so the verdict a test renders is the verdict the
 * gate renders.
 */

/** The seven kinds of action the requirement names, in its own order. */
export const STEP_UP_TRIGGERS = [
  "production",
  "high-cost",
  "security-sensitive",
  "identity",
  "data-export",
  "lifecycle",
  "destructive",
] as const

export type StepUpTrigger = (typeof STEP_UP_TRIGGERS)[number]

/**
 * How old an authentication may be before a triggering action needs a new one.
 *
 * Fifteen minutes, chosen the same way `C7_COOLING_OFF_MS` was: long enough
 * that an operator working through a lifecycle move — read the consequence,
 * find a second approver, type the slug — is not challenged in the middle of
 * it, and short enough that a laptop left open at a conference does not still
 * hold the authority to purge a tenant an hour later.
 *
 * A constant rather than an environment variable on purpose. A deployment that
 * can widen its own step-up window is a deployment where the window is whatever
 * the last person who edited a task definition believed, and nobody reviewing
 * this file would know.
 */
export const STEP_UP_MAX_AGE_SECONDS = 15 * 60

/**
 * Which resources belong to which trigger.
 *
 * Keyed by the resource vocabulary in `./operators`, so adding a resource makes
 * the question "which trigger is this" answerable in one place. `production`,
 * `high-cost` and `destructive` are absent because they are not properties of a
 * resource at all — they are properties of the environment, the money and the
 * change class, and each is derived below from the table that owns it.
 */
const TRIGGER_RESOURCES: Partial<Record<StepUpTrigger, ReadonlySet<OperatorResource>>> = {
  lifecycle: new Set<OperatorResource>(["tenant.lifecycle"]),
  // Nothing in `OPERATOR_RESOURCES` names an identity object today. The set is
  // empty rather than absent so `unmatchedTriggers()` reports it as a trigger
  // with no command, instead of this module quietly having six triggers.
  identity: new Set<OperatorResource>([]),
  "data-export": new Set<OperatorResource>([]),
}

/**
 * Verbs that are security-sensitive whatever they are aimed at.
 *
 * `approve` is the second half of four-eyes and `break-glass` is an emergency
 * permission set — `operators.ts` separates both from `write` and `read` for
 * exactly this reason, and this reads that separation rather than restating it.
 */
const SECURITY_SENSITIVE_VERBS: ReadonlySet<OperatorVerb> = new Set<OperatorVerb>([
  "approve",
  "break-glass",
])

/** A change that destroys something nothing can put back. `classify`'s own C7. */
const DESTRUCTIVE_CLASS = "C7"

/** What the caller knows about the act, in the shape the triggers are derived from. */
export interface StepUpAction {
  /** The named command, from `STUDIO_COMMANDS`. */
  command: StudioCommand
  /** The environment the command targets, as `controlPlaneIdentity` resolved it. */
  environment: string
  /**
   * The change itself, so its class is computed here rather than asserted by
   * the caller. `null` for a command that changes nothing classifiable — a
   * read, or a command whose surface the taxonomy does not cover.
   */
  operation: ChangeOperation | null
  /**
   * A recurring monthly commitment the command makes, in minor units, or null
   * when it commits to nothing new. The same field `command-gate` assesses the
   * approval band from, so "high cost" here and "needs a cost approval" there
   * cannot disagree.
   */
  recurringMonthly: { minorUnits: number; currency: string; change: string } | null
  /**
   * Triggers the SURFACE knows about and the command table cannot express.
   *
   * Exactly one exists today: the estate export is a GET route rather than a
   * typed command, so `data-export` is contributed by `dataExportStepUp` below
   * instead of being read off `STUDIO_COMMANDS`. It is a declared field rather
   * than a special case inside the derivation because a caller that can add a
   * trigger can only ever make the check STRICTER — there is no arm here that
   * removes one.
   */
  surfaceTriggers?: readonly StepUpTrigger[]
}

/** Which of the seven this act is. Empty means step-up is not required. */
export function stepUpTriggers(action: StepUpAction): readonly StepUpTrigger[] {
  const { resource, action: verb } = STUDIO_COMMANDS[action.command]
  const fired = new Set<StepUpTrigger>(action.surfaceTriggers ?? [])

  // ── production ──────────────────────────────────────────────────────────
  // The literal environment name, compared exactly. `controlPlaneIdentity`
  // already resolves an unset deployment environment to `production`, which is
  // the safe direction: an unlabelled deployment is treated as the live one.
  if (action.environment === "production") fired.add("production")

  // ── lifecycle / identity / data-export ──────────────────────────────────
  // From the resource, and only for verbs that are not reads. Reading a
  // tenant's lifecycle is what the tenant page does on every load; requiring a
  // fresh authentication to LOOK at one would make the console unusable and
  // would teach operators to re-authenticate reflexively, which is the habit
  // that makes a step-up prompt worthless.
  if (verb !== "read") {
    for (const [trigger, resources] of Object.entries(TRIGGER_RESOURCES)) {
      if (resources?.has(resource)) fired.add(trigger as StepUpTrigger)
    }
  }

  // ── security-sensitive ──────────────────────────────────────────────────
  if (SECURITY_SENSITIVE_VERBS.has(verb)) fired.add("security-sensitive")

  // ── destructive ─────────────────────────────────────────────────────────
  if (action.operation !== null && classify(action.operation) === DESTRUCTIVE_CLASS) {
    fired.add("destructive")
  }

  // ── high-cost ───────────────────────────────────────────────────────────
  // Any band above NONE. The threshold is `@tenure/finops`'s, not a second
  // number here — a step-up window with its own idea of "expensive" would
  // disagree with the approval the same command is about to demand.
  if (action.recurringMonthly) {
    const band = approvalFor({
      change: action.recurringMonthly.change,
      estimated: fromMinorUnits(action.recurringMonthly.minorUnits, action.recurringMonthly.currency),
    })
    if (band.level !== "NONE") fired.add("high-cost")
  }

  return STEP_UP_TRIGGERS.filter((t) => fired.has(t))
}

/**
 * Triggers that no command in this console can currently fire.
 *
 * Computed over the real `STUDIO_COMMANDS`, never written down, so it stops
 * naming a trigger the day a command matches it. `production`, `high-cost` and
 * `destructive` are excluded from the walk because they depend on the
 * environment, the money and the change rather than on the command, and a
 * command table cannot answer for them.
 *
 * Two answers today, and they are different gaps. `identity` is a real one:
 * this console has no identity-mutating command, so nothing can trigger it and
 * nothing is protected by it. `data-export` is not — the estate export is an
 * HTTP route rather than a typed command, and `dataExportStepUp` fires the
 * trigger from that surface. Both are reported, because a reader of this list
 * needs to know which triggers the COMMAND TABLE cannot reach; whether some
 * other door reaches them is a separate question with a separate answer.
 */
export function triggersNoCommandCanFire(): readonly StepUpTrigger[] {
  const reachable = new Set<StepUpTrigger>()
  for (const command of Object.keys(STUDIO_COMMANDS) as StudioCommand[]) {
    for (const trigger of stepUpTriggers({
      command,
      environment: "non-production",
      operation: null,
      recurringMonthly: null,
    })) {
      reachable.add(trigger)
    }
  }
  return (Object.keys(TRIGGER_RESOURCES) as StepUpTrigger[])
    .filter((t) => !reachable.has(t))
    .sort()
}

/** How the check came out. Every value is reachable and the spec drives each one. */
export type StepUpOutcome =
  /** No trigger fired. The act is an ordinary one. */
  | "NOT_REQUIRED"
  /** A trigger fired and the authentication is inside the window. */
  | "SATISFIED"
  /** The session carries no authentication time at all. */
  | "NO_AUTHENTICATION_TIME"
  /** It carries one this engine cannot read as a time. */
  | "UNREADABLE_AUTHENTICATION_TIME"
  /** It carries one, and it is older than the window. */
  | "AUTHENTICATION_STALE"
  /** The authorization was decided under a policy revision that is no longer in force. */
  | "AUTHORIZATION_STALE"

export interface StepUpVerdict {
  outcome: StepUpOutcome
  /** Whether the act may proceed. False for every outcome but the first two. */
  permitted: boolean
  triggers: readonly StepUpTrigger[]
  /** Age of the authentication in whole seconds, or null when there is none to age. */
  ageSeconds: number | null
  /** The policy revision the decision is being made under, for the audit line. */
  policyRevision: string
  /** What the operator is told. Empty for the permitted outcomes. */
  detail: string
}

export interface StepUpSession {
  /**
   * When authentication actually happened, ISO-8601, or null when the session
   * does not say. Null is refused rather than defaulted — see the header.
   */
  authenticatedAt: string | null
  /**
   * The policy revision the surface that produced this request was rendered
   * under, or null when the request carries none.
   *
   * Required-and-nullable rather than optional, for the reason
   * `OperatorAuthorizationRequest` gives about its own axes: an optional field
   * a caller forgets is invisible to `tsc`, and a fresh-authorization check
   * nobody passes a revision to is a check that never fires.
   */
  policyRevisionAtRender: string | null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function names(triggers: readonly StepUpTrigger[]): string {
  return triggers.join(", ")
}

/**
 * May this act proceed on the strength of this session?
 *
 * @param currentPolicyRevision defaulted to the revision derived from the live
 *   grant table. A parameter at all so a test can drive the mismatch arm
 *   without editing the table underneath itself.
 */
export function stepUpVerdict(
  action: StepUpAction,
  session: StepUpSession,
  now: Date,
  currentPolicyRevision: string = POLICY_REVISION,
): StepUpVerdict {
  const triggers = stepUpTriggers(action)
  const base = { triggers, policyRevision: currentPolicyRevision }

  if (triggers.length === 0) {
    return { ...base, outcome: "NOT_REQUIRED", permitted: true, ageSeconds: null, detail: "" }
  }

  // Fresh authorization first. A stale policy revision means the decision this
  // request is carrying was taken under a table that no longer exists, and no
  // amount of re-authenticating fixes that — the operator has to be re-decided
  // about, not re-identified. Telling them to sign in again would send them
  // round a loop that ends in the same refusal.
  if (session.policyRevisionAtRender !== null && session.policyRevisionAtRender !== currentPolicyRevision) {
    return {
      ...base,
      outcome: "AUTHORIZATION_STALE",
      permitted: false,
      ageSeconds: null,
      detail:
        `This was decided under operator policy ${session.policyRevisionAtRender} and the policy ` +
        `in force is ${currentPolicyRevision}. Permissions changed between this page rendering and ` +
        `this submission, so the authorization behind it is not the one that would be given now. ` +
        `Reload and decide again.`,
    }
  }

  if (session.authenticatedAt === null) {
    return {
      ...base,
      outcome: "NO_AUTHENTICATION_TIME",
      permitted: false,
      ageSeconds: null,
      detail:
        `This is a ${names(triggers)} action and your session does not record when you ` +
        `authenticated, so its freshness cannot be established. Sign out and sign in again, then ` +
        `retry within ${plural(STEP_UP_MAX_AGE_SECONDS / 60, "minute")}.`,
    }
  }

  const authenticatedAt = Date.parse(session.authenticatedAt)
  if (Number.isNaN(authenticatedAt)) {
    return {
      ...base,
      outcome: "UNREADABLE_AUTHENTICATION_TIME",
      permitted: false,
      ageSeconds: null,
      detail:
        `This is a ${names(triggers)} action and your session records an authentication time this ` +
        `engine cannot read ("${session.authenticatedAt}"). Sign out and sign in again.`,
    }
  }

  // Floor rather than round: 899.6 seconds is inside a 900-second window, and a
  // rounding that reports 900 would refuse an authentication that is still
  // fresh. The comparison below is on the same floored number the operator is
  // shown, so the message and the decision cannot disagree.
  const ageSeconds = Math.floor((now.getTime() - authenticatedAt) / 1000)

  // A future authentication time is treated as stale, not as fresh. Clock skew
  // between a token issuer and this process is real, and the direction that
  // fails safe is the one where a session claiming to have authenticated
  // tomorrow does not get to purge a tenant today.
  if (ageSeconds < 0 || ageSeconds > STEP_UP_MAX_AGE_SECONDS) {
    return {
      ...base,
      outcome: "AUTHENTICATION_STALE",
      permitted: false,
      ageSeconds,
      detail:
        `This is a ${names(triggers)} action. It needs an authentication no older than ` +
        `${plural(STEP_UP_MAX_AGE_SECONDS / 60, "minute")} and yours is ` +
        (ageSeconds < 0
          ? `dated in the future (${plural(-ageSeconds, "second")} ahead of this engine's clock)`
          : `${plural(ageSeconds, "second")} old`) +
        `. Sign out and sign in again, then retry.`,
    }
  }

  return { ...base, outcome: "SATISFIED", permitted: true, ageSeconds, detail: "" }
}

/* ───────────────────────────────────────────────────────────────── session ──
 *
 * The stamp, and the two helpers that put it on a token and take it off a
 * session. Pure so `auth.ts` — which cannot be imported into a test without
 * NextAuth's whole runtime — contributes no untested logic of its own.
 */

/** The claim name, in one place, so the writer and the reader cannot drift. */
export const AUTHENTICATED_AT_CLAIM = "authenticatedAt"

/**
 * The token, with an authentication time on it.
 *
 * Stamped ONLY on a fresh sign-in. Every later request re-issues the JWT, and
 * re-stamping there would make `authenticatedAt` a synonym for "the last time
 * this tab loaded a page" — which never expires while a browser is open, and is
 * precisely the property this check exists not to trust.
 *
 * A token that arrives with no stamp keeps none. Filling one in would date an
 * authentication that happened before this code shipped to the moment it was
 * first read, i.e. would make every pre-existing session eternally fresh.
 */
export function stampAuthentication<T extends Record<string, unknown>>(
  token: T,
  signedInNow: boolean,
  now: Date,
): T {
  if (!signedInNow) return token
  return { ...token, [AUTHENTICATED_AT_CLAIM]: now.toISOString() }
}

/**
 * The session an operator's request carries, with the token's authentication
 * time copied onto it.
 *
 * A function rather than two lines inside the auth callback because a line
 * inside a NextAuth callback is a line nothing can call: `auth.ts` constructs
 * the whole library at module load, so a test that imported it would be
 * standing up an auth provider to assert an assignment. This is the assignment,
 * and `auth.ts` is left holding only the argument NextAuth supplies.
 *
 * A token with no stamp leaves the session untouched rather than writing a
 * `null` — `authenticatedAtOf` reads both as absent, and not writing keeps the
 * session the shape the library serialises.
 */
export function sessionWithAuthentication<S extends object>(session: S, token: unknown): S {
  const authenticatedAt = authenticatedAtOf(token)
  if (!authenticatedAt) return session
  ;(session as unknown as Record<string, unknown>)[AUTHENTICATED_AT_CLAIM] = authenticatedAt
  return session
}

/**
 * The authentication time carried by a session or token, or null.
 *
 * Defensive about the shape because what arrives is whatever the auth library
 * put in a cookie: a session from an older deployment has no such field, and a
 * non-string value is treated as absent rather than coerced — `String(1)` is a
 * perfectly good string and a hopeless timestamp.
 */
export function authenticatedAtOf(subject: unknown): string | null {
  if (!subject || typeof subject !== "object") return null
  const value = (subject as Record<string, unknown>)[AUTHENTICATED_AT_CLAIM]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/* ──────────────────────────────────────────────────────────── data export ──
 *
 * The export route is not a typed command and does not pass through
 * `command-gate` — it is a GET that assembles the estate and hands it over. It
 * is also, in the requirement's own list, one of the seven. So it asks the same
 * question through this door, and the door is named rather than being a
 * `stepUpVerdict` call with an invented command.
 */

/**
 * Step-up for a data export.
 *
 * The trigger is `data-export` and it fires whatever the environment is: an
 * export is a copy of the estate leaving the building, and a non-production
 * console still names real accounts, real ARNs and real security groups. It is
 * supplied through `surfaceTriggers` rather than by inventing a command,
 * because `platform.read` — which the export route really does authorize each
 * of its surfaces as — is a READ, and reads deliberately fire no resource
 * trigger.
 */
export function dataExportStepUp(
  session: StepUpSession,
  environment: string,
  now: Date,
): StepUpVerdict {
  return stepUpVerdict(
    {
      command: "platform.read",
      environment,
      operation: null,
      recurringMonthly: null,
      surfaceTriggers: ["data-export"],
    },
    session,
    now,
  )
}
