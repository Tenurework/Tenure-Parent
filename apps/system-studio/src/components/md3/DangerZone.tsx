import type { ReactNode } from "react"

import { Button, type ButtonProps } from "./Button"
import type { HighRisk } from "../states"

/**
 * STUDIO-030-004 — the region an irreversible control goes in, and the reason a
 * caller cannot put an ordinary one there with it.
 *
 * > *Make destructive controls visually and spatially distinct; never place
 * > irreversible tenant/account/key deletion next to ordinary actions.*
 *
 * The tenant page already separates its one-way lifecycle moves by hand
 * (`app/tenants/[slug]/AdvanceControls.tsx` — a `fieldset.destructive` after
 * the ordinary chips, measured as a rectangle by `e2e/layout.spec.ts`). That
 * is a convention: it holds on the one surface somebody wrote it on, and the
 * next surface with a purge control on it starts from a blank file. This is the
 * same separation as a primitive, so the next surface gets it by construction —
 * and `e2e/destructive-separation.spec.ts` is the half that walks every rendered
 * route and fails when the rule is broken somewhere that never imported this.
 *
 * ## The caller does not choose the placement — the risk does
 *
 * There is no `dangerous` prop and no `<DangerZone.Ordinary>` slot. A caller
 * hands this region every action in the group along with the `HighRisk` that
 * `lib/tenant-state.ts#riskOf` computed for it, and the region reads
 * `risk.reversibility` to decide which side of the rule each one lands on. An
 * API where the caller passes a boolean is an API where the boolean is wrong on
 * the surface nobody re-read, and it is wrong in the safe-looking direction:
 * the mistake that puts PURGING back in the row is a missing `dangerous`, and a
 * missing boolean is `false`.
 *
 * `riskOf` derives that sentence by walking the lifecycle graph — `IRREVERSIBLE`
 * means no serving state is reachable from the destination, which is a fact
 * about the machine rather than a note somebody kept up to date. So the region
 * and the state machine cannot disagree without `DangerZone.test.tsx` failing,
 * because that test drives the real `riskOf` through this classifier.
 *
 * ## A consequence this console cannot read is not filed as safe
 *
 * `classifyConsequence` throws on a `reversibility` sentence that says neither
 * word. The tempting default — "not recognisably irreversible, therefore
 * ordinary" — is a guard that reads green on exactly the input it exists for: a
 * risk built by hand for a new surface, phrased in some other words, rendered
 * into the ordinary row. Fail-closed here is a `500` on a page that is being
 * built; fail-open is a purge button in a chip row in production.
 *
 * ## Three axes, because colour alone is not one of them
 *
 * Bible §26.3.2 forbids meaning carried by colour alone, so the separation is:
 *
 *   * **spatial** — the irreversible controls are in a `fieldset.destructive`
 *     that comes *after* the ordinary group, behind a rule and a margin
 *     (`--space-6` in `globals.css`);
 *   * **verbal** — the legend says the word, and the hint below it prints the
 *     actions' own `risk.reversibility` sentences rather than a slogan;
 *   * **visual** — the control is `tone="danger"` and a different variant from
 *     its ordinary neighbours.
 *
 * ## Why it emits no new class names
 *
 * Every class here already exists in `app/globals.css` — `destructive`,
 * `chips`, `hint`, `slug`, `md3-button`. `e2e/md3-tokens-logic.spec.ts` fails a
 * component that emits an `md3-*` class the stylesheet does not declare, and the
 * separation this region needs is already styled: the rule, the margin, the
 * legend and the padding were written for the tenant page and are not specific
 * to it.
 *
 * ## The DOM contract, and who else reads it
 *
 * `data-danger-zone` on the region and `data-risk` on every control are not
 * decoration: `e2e/destructive-separation.spec.ts` reads them as the *declared*
 * classification of a control, alongside the vocabulary it derives from
 * `riskOf` and `DESTRUCTIVE_VERBS` for controls that never came through here.
 * They are exported as constants so the guard imports the strings rather than
 * retyping them, because a guard looking for `data-risk` while the component
 * emits `data-risk-level` is a guard that finds nothing and passes.
 *
 * ## It is not a client component
 *
 * No `"use client"`, matching the rest of this directory, and no hooks — which
 * is why `id` is a required prop rather than a `useId()`. The region renders in
 * a server tree beside a server action's `<form>`, and a client parent can still
 * hand each action an `onClick`.
 */

/** The attribute naming the region. Read by `e2e/destructive-separation.spec.ts`. */
export const DANGER_ZONE_ATTRIBUTE = "data-danger-zone"

/** `data-danger-zone` on the separated `fieldset` itself. */
export const DANGER_ZONE_REGION = "region"

/** `data-danger-zone` on the wrapper holding both sides of the rule. */
export const DANGER_ZONE_GROUP = "group"

/** The attribute naming a control's consequence. */
export const RISK_ATTRIBUTE = "data-risk"

/** The two values `RISK_ATTRIBUTE` takes. */
export const IRREVERSIBLE = "irreversible"
export const REVERSIBLE = "reversible"

/**
 * The words `riskOf` writes, and the only two this region accepts.
 *
 * Anchored at the start because that is where `riskOf` puts them, and matched
 * case-sensitively for `IRREVERSIBLE` because the whole point of that sentence
 * is that it shouts.
 */
const IRREVERSIBLE_SENTENCE = /^IRREVERSIBLE\b/
const REVERSIBLE_SENTENCE = /^Reversible\b/

/** What a rendered consequence is. */
export type Consequence = typeof IRREVERSIBLE | typeof REVERSIBLE

/**
 * Which side of the rule an action falls on, read off the risk the engine
 * computed for it.
 *
 * Throws rather than guessing. See the note above: the guess that would be made
 * here is "ordinary", and it would be made about the actions nobody has looked
 * at yet.
 */
export function classifyConsequence(risk: HighRisk): Consequence {
  if (IRREVERSIBLE_SENTENCE.test(risk.reversibility)) return IRREVERSIBLE
  if (REVERSIBLE_SENTENCE.test(risk.reversibility)) return REVERSIBLE
  throw new Error(
    `DangerZone cannot classify the consequence of ${risk.target || "an unnamed action"}: ` +
      `its reversibility reads ${JSON.stringify(risk.reversibility)}, which begins with neither ` +
      `IRREVERSIBLE nor Reversible. riskOf() in lib/tenant-state.ts writes one of those two, and a ` +
      `risk assembled anywhere else must say the same thing — an unreadable consequence is not ` +
      `filed as an ordinary action.`,
  )
}

/** `true` when nothing this console holds can put the action back. */
export function isIrreversible(risk: HighRisk): boolean {
  return classifyConsequence(risk) === IRREVERSIBLE
}

/**
 * One control, and the consequence of pressing it.
 *
 * `label` is a string and not a `ReactNode` on purpose: it is the control's
 * accessible name, it is the key, and it is what
 * `e2e/destructive-separation.spec.ts` reports when a pair fails. A node here
 * would let a caller ship an icon-only irreversible control, which is the
 * failure mode `Button` already refuses.
 */
export interface DangerAction {
  label: string
  /** What `riskOf` said about this action. Read, never re-decided. */
  risk: HighRisk
  /**
   * A note under the control — an id, a count, what it leaves behind.
   *
   * Rendered as text beside the label rather than a `title`, because a tooltip
   * is not readable on a touch device and is not read aloud.
   */
  note?: ReactNode
  /**
   * The `<button>` half: `type="submit"`, a `name`/`value` a server action
   * reads, an `onClick`, a `disabled`.
   *
   * `variant` and `tone` are not in it. Emphasis is decided by the consequence,
   * so a caller cannot render an irreversible action as a quiet text button or
   * an ordinary one in the error family.
   */
  button?: Omit<ButtonProps, "children" | "variant" | "tone">
}

export interface DangerZoneProps {
  /**
   * Required, and used for the region and for the hint the irreversible
   * controls are described by. Explicit rather than generated: this component
   * takes no hooks, and a random id would differ between the server render and
   * the client one.
   */
  id: string
  /**
   * What the actions act on, named exactly — the tenant slug, the account id,
   * the key arn. It goes in the sentence above the controls, because "this
   * cannot be undone" without a subject is a warning about nothing.
   */
  subject: string
  /** Every action in the group, ordinary and irreversible together. */
  actions: readonly DangerAction[]
}

/** The heading over the separated group. Not overridable — see the note below. */
export const DANGER_ZONE_LEGEND = "Irreversible — no path back"

export function DangerZone({ id, subject, actions }: DangerZoneProps) {
  /*
   * An empty region is a caller bug, and it is the specific caller bug where a
   * purge control silently stops rendering: the actions stopped being computed,
   * the region renders nothing, and the page looks finished. `AdvanceControls`
   * says "Terminal — nothing follows this state" instead, which is a sentence
   * rather than an absence.
   */
  if (actions.length === 0) {
    throw new Error(
      `DangerZone ${id} was given no actions for ${subject}. A region with nothing in it renders ` +
        `as a finished page with a missing control; say what there is none of instead.`,
    )
  }

  /*
   * Two controls with one name are indistinguishable to a screen reader, to an
   * operator scanning the group, and to the guard that reports which pair
   * failed — and one of the two may be the irreversible one.
   */
  const seen = new Set<string>()
  for (const action of actions) {
    if (seen.has(action.label)) {
      throw new Error(
        `DangerZone ${id} was given two actions called ${JSON.stringify(action.label)}. Two ` +
          `controls with one accessible name cannot be told apart by anything that reads this ` +
          `page, including the operator.`,
      )
    }
    seen.add(action.label)
  }

  // Every action is classified before anything renders, so an unreadable
  // consequence throws before half a group has reached the page.
  const classified = actions.map((action) => ({
    action,
    consequence: classifyConsequence(action.risk),
  }))

  const ordinary = classified.filter((c) => c.consequence === REVERSIBLE)
  const irreversible = classified.filter((c) => c.consequence === IRREVERSIBLE)

  const hintId = `${id}-consequence`

  const control = (
    { action, consequence }: (typeof classified)[number],
    describedBy?: string,
  ) => (
    <Button
      key={action.label}
      {...action.button}
      variant={consequence === IRREVERSIBLE ? "outlined" : "tonal"}
      tone={consequence === IRREVERSIBLE ? "danger" : "neutral"}
      aria-describedby={describedBy}
      /*
       * Written out rather than spread from `RISK_ATTRIBUTE`. A computed key
       * reaches `Button` as an index signature, which is a wider prop type than
       * the component declares; `DangerZone.test.tsx` asserts the rendered
       * markup carries exactly the exported constants instead, so the guard and
       * the component still cannot drift apart without a red test.
       */
      data-risk={consequence}
    >
      {action.label}
      {action.note ? <span className="slug"> · {action.note}</span> : null}
    </Button>
  )

  return (
    <div data-danger-zone="group">
      {/*
        The ordinary controls first, and outside the fieldset. Order is part of
        the separation: an operator reaching for the routine action never passes
        over the one-way one to get to it.
      */}
      {ordinary.length > 0 && (
        <div className="chips">{ordinary.map((c) => control(c))}</div>
      )}

      {irreversible.length > 0 && (
        <fieldset className="destructive" data-danger-zone="region">
          {/*
            A constant, not a prop. A caller who can name this region can name it
            "Advanced", and a heading that does not say what it means is the
            oldest way to put a deletion in front of somebody who was not
            looking for one.
          */}
          <legend>{DANGER_ZONE_LEGEND}</legend>
          <p className="hint" id={hintId}>
            {/*
              The engine's own sentences, printed. Not a slogan written here:
              `risk.reversibility` names the destination and says why there is no
              way back, and a fixed string would keep saying it after the graph
              changed.
            */}
            {subject} — {irreversible.map((c) => c.action.risk.reversibility).join(" ")}
          </p>
          <div className="chips">{irreversible.map((c) => control(c, hintId))}</div>
        </fieldset>
      )}
    </div>
  )
}
