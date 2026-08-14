/**
 * "What can happen next", read from the lifecycle engine rather than written
 * down beside it.
 *
 * ── Why this is a module and not four expressions inside the JSX ───────────
 *
 * The fourth question this page answers is the only one whose answer an
 * operator ACTS on, and it is the one that was previously assembled inline: the
 * page mapped `nextStates` into a prop bag for `AdvanceControls` and every
 * judgement about how heavy a move is — whether it needs a second identity,
 * whether it can be undone, whether this console will perform it at all — was
 * spread across that literal, the component, and the server action. Nothing
 * could be driven without a DynamoDB table and a browser.
 *
 * So the judgement lives here, takes a state and a slug, and returns rows. The
 * page renders them and hands the same rows to `AdvanceControls`, so the table
 * an operator READS and the buttons they PRESS cannot disagree about what a move
 * demands. `tenant-answers.test.ts` drives it directly.
 *
 * ── Everything here is derived, and that is the whole design ───────────────
 *
 * `nextStates` is the transition graph. `needsApproval` is the approval map.
 * `REQUIRES_OWNER` is the successor-owner set. `classify`/`requirementsFor` are
 * the change-class policy, which is what decides that PURGING is refused rather
 * than merely hard. `canReachServing` walks the graph to decide reversibility —
 * the same function `AdvanceControls` reads to build its one-way group.
 *
 * There is no second list. A hand-maintained set of "dangerous destinations"
 * disagrees with the state machine the first time somebody adds a state, and
 * the disagreement surfaces as a button that always fails or, worse, one that
 * does not warn.
 *
 * ── No `server-only`, no `@/` alias ────────────────────────────────────────
 *
 * Same rule as `summary.ts` beside it, for the same reason: this module must be
 * importable by a plain Node test with no AWS credentials and no session. The
 * two imports below are the lifecycle package and one graph walk, and neither
 * reaches a client.
 */

import {
  REQUIRES_OWNER,
  classify,
  needsApproval,
  nextStates,
  requirementsFor,
  type ChangeClass,
  type TenantState,
} from "@tenure/provisioning"

import { canReachServing } from "../../../lib/tenant-state"

/**
 * How heavy a permitted move is, in four steps.
 *
 * Ordered, and the order is what the page sorts and groups by. The distinction
 * that matters most is the last one: `refused` is not "very gated". The change
 * class marks it non-automatable, which means this console will not perform it
 * however correctly the form is filled in, and the page has to say so BEFORE the
 * click rather than after it.
 */
export type MoveWeight = "routine" | "gated" | "one-way" | "refused"

/** Sort order, and the only place the ranking is written down. */
const RANK: Readonly<Record<MoveWeight, number>> = {
  routine: 0,
  gated: 1,
  "one-way": 2,
  refused: 3,
}

/**
 * The word each weight carries.
 *
 * A word rather than a colour, because colour alone is not a carrier of meaning
 * and because this page is read in four theme/contrast combinations. Each is
 * distinct enough to be scanned: "gated" and "one-way" are different facts and
 * an operator must not have to read the row to tell them apart.
 */
export const WEIGHT_WORD: Readonly<Record<MoveWeight, string>> = {
  routine: "routine",
  gated: "gated",
  "one-way": "one-way",
  refused: "refused here",
}

export interface PermittedMove {
  /** The destination. Always one the transition graph actually permits. */
  to: TenantState
  weight: MoveWeight
  /** `RANK[weight]`, carried so a consumer sorts without importing the map. */
  rank: number
  /** The change class this destination falls in — C1 through C7. */
  changeClass: ChangeClass
  /** How many distinct people must agree. Two means the requester is not one. */
  approvers: 1 | 2
  /** Whether the LIFECYCLE demands a recorded approver for this edge. */
  needsApproval: boolean
  /** Whether the destination may not be entered with nobody answering for the tenant. */
  needsOwner: boolean
  /** The exact string the gate will compare, or null when the class needs none. */
  typedConfirmation: string | null
  coolingOffMs: number
  /** Whether this console may perform it at all. False is a refusal, not a warning. */
  automatable: boolean
  /** Present exactly when `automatable` is false: what a human runs instead. */
  insteadRunYourself: string | null
  /** Whether a serving state is reachable again once this move is made. */
  reversible: boolean
  /**
   * Everything this move demands before it will run, as one sentence.
   *
   * Assembled from the requirements rather than written per destination, so a
   * class gaining a demand changes what the page says without anybody editing
   * a string.
   */
  demands: string
}

/** Fifteen minutes reads better than 900000ms to the person waiting it out. */
function minutes(ms: number): string {
  const whole = Math.round(ms / 60_000)
  return whole === 1 ? "1 minute" : `${whole} minutes`
}

/**
 * What a move demands, in the operator's language.
 *
 * Built by listing what is true and joining it, so a move with no demands says
 * so in words — "nothing beyond your own authority" — rather than rendering an
 * empty cell, which reads as a fact nobody bothered to fill in.
 */
function demandsOf(input: {
  approvers: 1 | 2
  needsOwner: boolean
  typedConfirmation: string | null
  coolingOffMs: number
  automatable: boolean
}): string {
  if (!input.automatable) {
    return (
      "Nothing you can supply. This console refuses to perform it whatever the form says; " +
      "a human runs the command below under their own credentials."
    )
  }

  const parts: string[] = []
  if (input.approvers === 2) {
    parts.push("a second operator's identity, which the engine refuses to let be your own")
  }
  if (input.needsOwner) {
    parts.push("a successor owner, who answers for this tenant afterwards")
  }
  if (input.typedConfirmation !== null) {
    parts.push(`the exact text ${input.typedConfirmation}, typed`)
  }
  if (input.coolingOffMs > 0) {
    parts.push(`a wait of ${minutes(input.coolingOffMs)} between asking and being allowed`)
  }

  if (parts.length === 0) return "Nothing beyond your own authority. One operator, no typed token."
  return `Needs ${parts.join("; ")}.`
}

/**
 * Every move the state machine permits out of `from`, and what each one costs.
 *
 * The list is `nextStates(from)` and nothing else, which is the point: a
 * destination the graph forbids has no row here, so it cannot be offered. A
 * terminal state produces an empty array, and the page renders that as "there is
 * no move out of this state" rather than as a control that is missing.
 *
 * Sorted heaviest-last, so a page rendering them in order puts a routine advance
 * first and the one-way move at the bottom — the same separation
 * `AdvanceControls` makes spatially, from the same fact.
 */
export function permittedMoves(from: TenantState, slug: string): readonly PermittedMove[] {
  return nextStates(from)
    .map((to): PermittedMove => {
      const changeClass = classify({ surface: "tenant-lifecycle", action: to, target: slug })
      const requirements = requirementsFor(changeClass, slug)
      const approval = needsApproval(from, to)
      const owner = REQUIRES_OWNER.has(to)
      const reversible = canReachServing(to)

      const weight: MoveWeight = !requirements.automatable
        ? "refused"
        : !reversible
          ? "one-way"
          : approval ||
              owner ||
              requirements.approvers === 2 ||
              requirements.typedConfirmation !== null
            ? "gated"
            : "routine"

      return {
        to,
        weight,
        rank: RANK[weight],
        changeClass,
        approvers: requirements.approvers,
        needsApproval: approval,
        needsOwner: owner,
        typedConfirmation: requirements.typedConfirmation,
        coolingOffMs: requirements.coolingOffMs,
        automatable: requirements.automatable,
        insteadRunYourself: requirements.refusedWithCliCommand ?? null,
        reversible,
        demands: demandsOf({
          approvers: requirements.approvers,
          needsOwner: owner,
          typedConfirmation: requirements.typedConfirmation,
          coolingOffMs: requirements.coolingOffMs,
          automatable: requirements.automatable,
        }),
      }
    })
    .sort((a, b) => a.rank - b.rank || a.to.localeCompare(b.to))
}

/**
 * The sentence the "what can happen next" panel opens with.
 *
 * Separate from the rows because it is the fact an operator most often gets
 * wrong about this console, and it must not be discoverable only by reading a
 * table: a lifecycle move RECORDS that something happened. It does not go and
 * do it. Advancing to PROVISIONING writes a step; it does not create an ECS
 * service, and nothing on this page will.
 */
export function whatMovingDoes(moves: readonly PermittedMove[]): string {
  if (moves.length === 0) {
    return (
      "Nothing. This is a terminal state — the transition graph has no edge out of it, so there " +
      "is no move to offer and none is hidden."
    )
  }

  const refused = moves.filter((m) => !m.automatable).length
  const tail =
    refused > 0
      ? ` ${refused === 1 ? "One of them is" : `${refused} of them are`} refused here outright: the ` +
        "console hands over the command rather than running it."
      : ""

  return (
    `${moves.length === 1 ? "One move is" : `${moves.length} moves are`} permitted out of this ` +
    "state, and they are the only ones — a destination the transition graph forbids has no row " +
    "and no button. Every one of them RECORDS that something happened: it writes a lifecycle " +
    "step, an audit row and the evidence for it. None of them provisions, deletes or reconfigures " +
    `anything in AWS; the cell does that by reconciling toward the published artifact.${tail}`
  )
}
