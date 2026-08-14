"use client"

import { useActionState } from "react"

import { Button, Select, Snackbar, TextField } from "@/components/md3"

import { placeHold, releaseHold, type HoldResult } from "./actions"
import styles from "./audit.module.css"

/**
 * Placing and lifting a preservation order.
 *
 * ## Why this is a client component
 *
 * So the refusal can be read. A plain `<form action={…}>` in the server
 * component would submit and revalidate, and an operator whose hold was refused
 * — a reused id, a missing reason — would see the page redraw unchanged with no
 * explanation, which trains people to click again.
 *
 * ## Why the markup is primitives now
 *
 * It used to be four hand-written `<div className="field">` blocks, a bare
 * `<select>`, five bare `<input>`s and two bare `<button>`s, plus `.hold-controls`
 * and `.problem` — two class names that `globals.css` does not define at all, so
 * the wrapper and the refusal message were styled by nothing. That is the
 * accumulation this pass exists to remove: every control here is now the
 * console's own `TextField`, `Select` and `Button`, which carry the label
 * association, the supporting-text `aria-describedby`, the focus ring, the state
 * layer and the type scale that the hand-rolled versions each had to be given
 * separately and mostly were not.
 *
 * The ids are unchanged — `#place-partition`, `#place-holdId`, `#place-reason`,
 * `#place-actionScope`, `#release-*` — because `e2e/audit-chain.spec.ts` fills
 * this form by id to write the chain it then tampers with. A primitive that
 * could not take an id would have meant rewriting the one spec that proves the
 * ledger works end to end, which is the wrong direction to push a change.
 *
 * ## Why it lives on this page at all
 *
 * `applyRetention` takes a hold list, and a hold list nothing can write is a
 * parameter that is always empty. Placing a hold is what stops the retention
 * plan on this same page from planning the destruction of evidence somebody has
 * ordered preserved, so the control belongs beside the plan it constrains.
 */
export function HoldControls({ partitions }: { partitions: readonly string[] }) {
  const [placed, place, placing] = useActionState<HoldResult | null, FormData>(placeHold, null)
  const [released, release, releasing] = useActionState<HoldResult | null, FormData>(
    releaseHold,
    null,
  )

  const chains = partitions.map((p) => ({ value: p, label: p }))

  return (
    <div className={styles.holdForms}>
      <form action={place} className={styles.holdForm}>
        <h3 className="md3-title-medium">Place a legal hold</h3>
        <p className="md3-body-medium">
          A hold preserves matching records past their retention window. It is the one rule that
          always wins in the plan above: a held record is never in <code>expire</code>, however old
          it is, and the cut stops at it so nothing after it is orphaned either.
        </p>

        <Select
          id="place-partition"
          name="partition"
          label="Chain"
          required
          options={chains}
          supportingText="The subject whose trail this hold preserves."
        />

        <TextField
          id="place-holdId"
          name="holdId"
          label="Hold id"
          required
          supportingText="Ids are never reused; an anonymous hold cannot be released."
        />

        <TextField
          id="place-reason"
          name="reason"
          label="Why"
          required
          supportingText="Recorded on the chain. A hold placed for no reason cannot be released with confidence."
        />

        <TextField
          id="place-actionScope"
          name="actionScope"
          label="Only these actions (optional)"
          supportingText="An exact action, or a prefix when it ends in a dot — tenant. covers every tenant action. Leave it empty to hold the whole chain, which is what a litigation hold usually is."
        />

        <div>
          <Button type="submit" variant="filled" disabled={placing}>
            {placing ? "Placing…" : "Place the hold"}
          </Button>
        </div>

        {/*
          The refusal and the confirmation take the same shape, because they
          answer the same question — what happened to the thing I just submitted
          — and the sentence says which it is. `Snackbar` is a `role="status"`,
          so it is announced without stealing focus from the form the operator is
          still standing in.
        */}
        {placed?.error && <Snackbar id="place-problem" message={placed.error} />}
        {placed?.message && <Snackbar id="place-result" message={placed.message} />}
      </form>

      <form action={release} className={styles.holdForm}>
        <h3 className="md3-title-medium">Release one</h3>
        <p className="md3-body-medium">
          Released by writing a second row, never by rewriting the placement — a hold record that
          could be edited is one that can be made to look as though it was never placed.
        </p>

        <Select
          id="release-partition"
          name="partition"
          label="Chain"
          required
          options={chains}
          supportingText="The chain the hold was placed over."
        />

        <TextField
          id="release-holdId"
          name="holdId"
          label="Hold id"
          required
          supportingText="As listed in the table above."
        />

        <TextField
          id="release-reason"
          name="reason"
          label="Why"
          required
          supportingText="Recorded on the chain. Releasing a hold needs a reason as much as placing one did."
        />

        <div>
          <Button type="submit" variant="filled" disabled={releasing}>
            {releasing ? "Releasing…" : "Release the hold"}
          </Button>
        </div>

        {released?.error && <Snackbar id="release-problem" message={released.error} />}
        {released?.message && <Snackbar id="release-result" message={released.message} />}
      </form>
    </div>
  )
}
