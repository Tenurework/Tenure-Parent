"use client"

import { useActionState, useState } from "react"

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
 */
export function AdvanceControls({
  slug,
  moves,
}: {
  slug: string
  moves: Array<{ to: string; needsApproval: boolean; risk: HighRisk }>
}) {
  const [result, action, pending] = useActionState<AdvanceResult | null, FormData>(
    advanceState,
    null,
  )
  const [selected, setSelected] = useState<string | null>(null)

  if (moves.length === 0) {
    return <p className="slug">Terminal — nothing follows this state.</p>
  }

  const chosen = moves.find((m) => m.to === selected)

  return (
    <div className="advance">
      <h3>Move to</h3>

      <div className="chips">
        {moves.map((m) => (
          <button
            key={m.to}
            type="button"
            className={`chip ${selected === m.to ? "chosen" : ""}`}
            onClick={() => setSelected(m.to)}
          >
            {m.to}
            {m.needsApproval && <span className="slug"> · needs approval</span>}
          </button>
        ))}
      </div>

      {/*
        GE-022-006. The five things Bible §26.6 requires before a high-risk
        action runs, shown BEFORE the submit button exists to be pressed rather
        than in a modal after it. Reversibility is computed from the transition
        graph — a one-way move says so in the word IRREVERSIBLE, which is the
        single fact most worth having before the click.
      */}
      {chosen?.needsApproval && (
        <HighRiskConfirmation action={`Move ${slug} to ${chosen.to}`} risk={chosen.risk} />
      )}

      {chosen && (
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="to" value={chosen.to} />

          {chosen.needsApproval && (
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

          <div className="field">
            <label htmlFor="reason">Reason</label>
            <input id="reason" name="reason" placeholder="recorded on the step" />
          </div>

          <button type="submit" disabled={pending}>
            {pending ? "Moving…" : `Move to ${chosen.to}`}
          </button>
        </form>
      )}

      {/*
        A refusal because the tenant moved under you is a conflict, not a
        failure: another operator did something legitimate and the page is now
        stale. Told apart by the lifecycle engine's own wording, so a rename of
        the message is a test failure rather than a silent downgrade to a
        generic error.
      */}
      {result?.error &&
        (/not a legal transition|no longer in/i.test(result.error) ? (
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
          <p className="error">{result.error}</p>
        ))}
    </div>
  )
}
