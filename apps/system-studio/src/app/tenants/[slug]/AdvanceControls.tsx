"use client"

import { useActionState, useMemo, useState } from "react"

import { advanceState, type AdvanceResult } from "../actions"
import { ConflictState, HighRiskConfirmation, type HighRisk } from "@/components/states"

/**
 * The buttons that move a tenant.
 *
 * Which buttons exist comes from the lifecycle engine, passed in from the
 * server. This component decides nothing about legality — it renders what it is
 * given and shows what the engine says when it refuses.
 *
 * The approver field appears only for transitions that require one, and the
 * requirement is enforced server-side regardless. Hiding a field is a courtesy;
 * it is not the control.
 *
 * ## STUDIO-030-004 — the irreversible moves are not in the same row
 *
 * Every move used to render as an identical `chip` in one flex row, so PURGING
 * sat pixel-adjacent to an ordinary advance at the same size and the same
 * colour. The information to do better was already there and simply unused:
 * `risk.reversibility` is computed by walking the transition graph
 * (`lib/tenant-state.ts`), and it was rendered only AFTER a selection — that is,
 * after the click the separation is meant to prevent.
 *
 * So the one-way moves are grouped into their own `fieldset`, placed after the
 * ordinary ones, behind a rule, under a heading that names what cannot be
 * undone. The separation is spatial rather than chromatic: a red button would
 * break the palette the layout suite measures, and colour alone is forbidden as
 * the carrier of meaning (Bible §26.3.2). `layout.spec.ts` asserts the vertical
 * gap geometrically, so a restyle that collapses the groups reds even if the
 * class names survive.
 */
export function AdvanceControls({
  slug,
  moves,
  expectedVersion,
  expectedDigest,
}: {
  slug: string
  moves: Array<{
    to: string
    needsApproval: boolean
    needsOwner: boolean
    risk: HighRisk
    /**
     * STUDIO-060-007 — the exact string the change-class gate will compare, or
     * null when this move's class needs none.
     *
     * Computed on the server by `requirementsFor`, never here. A form that asks
     * for one token while the server compares another is a control that always
     * refuses, which gets removed rather than fixed — so the field and the
     * comparison come from one function.
     */
    typedConfirmation: string | null
  }>
  /**
   * How many lifecycle steps this tenant has taken. Submitted as the command's
   * `expectedVersion`, so a move decided against this page is refused if the
   * tenant moved while it was open (STUDIO-060-002).
   */
  expectedVersion: number
  /** The manifest digest this page rendered. Compared server-side. */
  expectedDigest: string
}) {
  const [result, action, pending] = useActionState<AdvanceResult | null, FormData>(
    advanceState,
    null,
  )
  const [selected, setSelected] = useState<string | null>(null)

  /**
   * One key per chosen destination, minted when the confirmation renders.
   *
   * Keyed on the destination rather than on the component, so a double-click on
   * the same button reuses it — which is what makes the second submission a
   * replay rather than a second real attempt — while choosing a DIFFERENT
   * destination mints a new one. Reusing it across destinations would submit
   * one key for two different requests, which the gate correctly refuses as a
   * conflict, and the operator would be told their change of mind collided with
   * itself.
   */
  const idempotencyKey = useMemo(
    () => `idem-${globalThis.crypto.randomUUID().replace(/-/g, "")}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected],
  )

  if (moves.length === 0) {
    return <p className="slug">Terminal — nothing follows this state.</p>
  }

  const chosen = moves.find((m) => m.to === selected)

  // Read off the reversibility the lifecycle graph produced, never off a list
  // of "dangerous states" maintained by hand — a second list is a list that
  // disagrees with the state machine the first time somebody adds a state.
  const oneWay = (m: (typeof moves)[number]) => /^IRREVERSIBLE/.test(m.risk.reversibility)
  const ordinary = moves.filter((m) => !oneWay(m))
  const irreversible = moves.filter(oneWay)

  const chip = (m: (typeof moves)[number]) => (
    <button
      key={m.to}
      type="button"
      className={`chip ${selected === m.to ? "chosen" : ""}`}
      onClick={() => setSelected(m.to)}
    >
      {m.to}
      {m.needsApproval && <span className="slug"> · needs approval</span>}
    </button>
  )

  return (
    <div className="advance">
      <h3>Move to</h3>

      {/*
        The refusal, at the top of the block and announced.

        It used to be the LAST child of this div — below the confirmation panel,
        which `HighRiskConfirmation` renders through `StateBlock` as a
        `role="status"` live region carrying `Move <slug> to <STATE>` in a
        `.state-headline`. So on a refused high-risk move the page said, in the
        one region a screen reader announces, the name of the act that had just
        been refused, and the reason it was refused was a bare `<p>` further
        down with no role at all — unannounced, and after a panel long enough
        that a sighted operator had scrolled past the top of it too.

        `role="alert"` because this is the outcome of something the operator
        just did and did not get. Above the form because that is where an error
        summary belongs when the thing it is about is the whole submission.
      */}
      {result?.error &&
        (/not a legal transition|no longer in/i.test(result.error) ? (
          // A refusal because the tenant moved under you is a conflict, not a
          // failure: another operator did something legitimate and the page is
          // now stale. Told apart by the lifecycle engine's own wording, so a
          // rename of the message is a test failure rather than a silent
          // downgrade to a generic error.
          <ConflictState
            what={slug}
            theirChange={result.error}
            actions={
              <button type="button" className="primary-action" onClick={() => window.location.reload()}>
                Reload to see the current state
              </button>
            }
          />
        ) : (
          <p className="error" role="alert">
            {result.error}
          </p>
        ))}

      {ordinary.length > 0 && <div className="chips">{ordinary.map(chip)}</div>}

      {irreversible.length > 0 && (
        <fieldset className="destructive">
          <legend>
            One-way — no path back to a serving state
          </legend>
          <p className="hint">
            {irreversible.map((m) => m.to).join(", ")}
            {irreversible.length === 1 ? " cannot" : " cannot"} be undone from this console or any
            other. The lifecycle graph has no route from{" "}
            {irreversible.length === 1 ? "it" : "them"} back to serving.
          </p>
          <div className="chips">{irreversible.map(chip)}</div>
        </fieldset>
      )}

      {chosen && (
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="to" value={chosen.to} />
          {/*
            STUDIO-060-002. The three fields that make this submission a
            specific decision rather than a generic one: which request it is,
            which version of the tenant it was decided against, and which
            manifest the operator was reading. All three are checked at
            execution time and none of them is defaulted server-side.
          */}
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
          <input type="hidden" name="expectedDigest" value={expectedDigest} />

          {/*
            GE-022-006. The five things Bible §26.6 requires before a high-risk
            action runs, shown BEFORE the submit button exists to be pressed
            rather than in a modal after it. Reversibility is computed from the
            transition graph — a one-way move says so in the word IRREVERSIBLE,
            which is the single fact most worth having before the click.

            STUDIO-140-006 moved it INSIDE the form, and that is the whole
            change: the panel now renders a field the operator must type and a
            hidden digest of the five facts, and outside a form both are inert.
            The server refuses without them, so a panel rendered beside the form
            rather than in it would be a gate that can never be satisfied — and
            `states-logic.spec.ts` asserts the containment for exactly that
            reason.
          */}
          {(chosen.needsApproval || chosen.typedConfirmation !== null) && (
            <HighRiskConfirmation
              action={`Move ${slug} to ${chosen.to}`}
              risk={chosen.risk}
              confirm={{
                label: `Type ${slug} to confirm`,
                // The slug, because this is a lifecycle move. An AWS mutation
                // asks for the ARN — same field, same comparison, and the
                // server decides which by resolving the target itself rather
                // than trusting what the form says it was.
                expected: chosen.typedConfirmation ?? slug,
              }}
            />
          )}

          {/* STUDIO-060-007. A second identity is demanded by the CLASS as well
              as by the lifecycle engine: C5, C6 and C7 all need two people, and
              SUSPENDING is a C6 the engine does not gate. Rendering the field
              only where `needsApproval` is true would leave three moves the
              server refuses with no field to satisfy them. */}
          {(chosen.needsApproval || chosen.typedConfirmation !== null) && (
            <div className="field">
              <label htmlFor="approvedBy">Approved by</label>
              <input
                id="approvedBy"
                name="approvedBy"
                type="email"
                required
                placeholder="a second operator's email"
              />
              <p className="hint">
                This transition spends money, routes real users, or deletes data. It needs a second
                identity, and it cannot be your own.
              </p>
            </div>
          )}

          {/*
            WRK-120-005. Suspend, hibernate and offboard are the moves that
            follow an owner's departure, and the engine refuses them without a
            successor — so the field is here, and, like the approver above,
            hiding it is a courtesy rather than the control.
          */}
          {chosen.needsOwner && (
            <div className="field">
              <label htmlFor="ownerPrincipalId">Successor owner</label>
              <input
                id="ownerPrincipalId"
                name="ownerPrincipalId"
                type="email"
                required
                placeholder="who answers for this tenant now"
              />
              <p className="hint">
                Not the person leaving — the person responsible afterwards. Without one this tenant
                becomes an orphan: retained data, a residual bill, and nobody to ask about either.
              </p>
            </div>
          )}

          <div className="field">
            <label htmlFor="reason">Reason</label>
            <input id="reason" name="reason" placeholder="recorded on the step" />
          </div>

          <button type="submit" disabled={pending}>
            {pending ? "Moving…" : `Move to ${chosen.to}`}
          </button>
        </form>
      )}

    </div>
  )
}
