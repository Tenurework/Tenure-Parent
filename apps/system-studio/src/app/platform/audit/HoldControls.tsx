"use client"

import { useActionState } from "react"

import { placeHold, releaseHold, type HoldResult } from "./actions"

/**
 * Placing and lifting a preservation order.
 *
 * A client component only because the refusal has to be readable. A plain
 * `<form action={…}>` in the server component would submit and revalidate, and
 * an operator whose hold was refused — a reused id, a missing reason — would see
 * the page redraw unchanged with no explanation, which trains people to click
 * again.
 */
export function HoldControls({ partitions }: { partitions: readonly string[] }) {
  const [placed, place, placing] = useActionState<HoldResult | null, FormData>(placeHold, null)
  const [released, release, releasing] = useActionState<HoldResult | null, FormData>(
    releaseHold,
    null,
  )

  return (
    <div className="hold-controls">
      <form action={place}>
        <h3>Place a legal hold</h3>
        <p>
          A hold preserves matching records past their retention window. It is the one rule that
          always wins in the plan above: a held record is never in <code>expire</code>, however old
          it is, and the cut stops at it so nothing after it is orphaned either.
        </p>

        <div className="field">
          <label htmlFor="place-partition">Chain</label>
          <select id="place-partition" name="partition" required>
            {partitions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="place-holdId">Hold id</label>
          <input id="place-holdId" name="holdId" required placeholder="litigation-2026-08" />
        </div>

        <div className="field">
          <label htmlFor="place-reason">Why</label>
          <input
            id="place-reason"
            name="reason"
            required
            placeholder="Preservation order in re: …"
          />
        </div>

        <div className="field">
          <label htmlFor="place-actionScope">Only these actions (optional)</label>
          <input id="place-actionScope" name="actionScope" placeholder="tenant." />
          <p className="slug">
            An exact action, or a prefix when it ends in a dot — <code>tenant.</code> covers every
            tenant action. Leave empty to hold the whole chain, which is what a litigation hold
            usually is.
          </p>
        </div>

        <button type="submit" disabled={placing}>
          {placing ? "Placing…" : "Place the hold"}
        </button>
        {placed?.error && <p className="problem">{placed.error}</p>}
        {placed?.message && <p className="slug">{placed.message}</p>}
      </form>

      <form action={release}>
        <h3>Release one</h3>
        <p>
          Released by writing a second row, never by rewriting the placement — a hold record that
          could be edited is one that can be made to look as though it was never placed.
        </p>

        <div className="field">
          <label htmlFor="release-partition">Chain</label>
          <select id="release-partition" name="partition" required>
            {partitions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="release-holdId">Hold id</label>
          <input id="release-holdId" name="holdId" required />
        </div>

        <div className="field">
          <label htmlFor="release-reason">Why</label>
          <input id="release-reason" name="reason" required placeholder="Matter closed on …" />
        </div>

        <button type="submit" disabled={releasing}>
          {releasing ? "Releasing…" : "Release the hold"}
        </button>
        {released?.error && <p className="problem">{released.error}</p>}
        {released?.message && <p className="slug">{released.message}</p>}
      </form>
    </div>
  )
}
