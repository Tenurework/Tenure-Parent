"use client"

import { useActionState, useState } from "react"

import { rollback, type RollbackResult } from "./actions"

/**
 * GE-032-003 — rolling back.
 *
 * The wording is the design. "Roll back to 3" reads as though revision 3
 * becomes live again; what actually happens is that its values are republished
 * as a new revision, and the history keeps every step. An operator who believes
 * the first thing will look for revision 3 at the top of the list and not find
 * it, so the control says what it does before it is pressed.
 *
 * An approver is required, exactly as for any other publication. A rollback
 * that skipped the four-eyes check would be the one change nobody reviewed,
 * which is a poor property for the change made under pressure.
 */
export function RollbackControls({
  slug,
  revisions,
  live,
}: {
  slug: string
  revisions: readonly number[]
  live: number
}) {
  const [result, act, pending] = useActionState<RollbackResult | null, FormData>(rollback, null)
  const [selected, setSelected] = useState<number | "">("")
  // Controlled for the same reason as the editor's fields: React 19 resets a
  // form once its action completes, so an uncontrolled `required` approver is
  // empty on the second rollback while the controlled select still shows a
  // choice. The button looks armed and submission is refused silently by HTML5
  // validation, with no message anywhere.
  const [approvedBy, setApprovedBy] = useState("")

  const targets = revisions.filter((r) => r !== live)
  if (targets.length === 0) {
    return <p className="slug">Only one revision exists, so there is nothing behind it to return to.</p>
  }

  return (
    <form action={act} className="rollback">
      <h3>Roll back</h3>
      <input type="hidden" name="slug" value={slug} />

      <div className="field">
        <label htmlFor="toRevision">Return to the configuration of</label>
        <select
          id="toRevision"
          name="toRevision"
          value={selected}
          onChange={(event) => setSelected(event.target.value === "" ? "" : Number(event.target.value))}
        >
          <option value="">choose a revision</option>
          {[...targets].reverse().map((r) => (
            <option key={r} value={r}>
              revision {r}
            </option>
          ))}
        </select>
        <p className="hint">
          This publishes <b>revision {live + 1}</b> carrying revision {selected === "" ? "N" : selected}&rsquo;s
          values. The history is not rewound — what was live stays on the record.
        </p>
      </div>

      <div className="field">
        <label htmlFor="rollbackApprovedBy">Approved by</label>
        <input
          id="rollbackApprovedBy"
          name="approvedBy"
          type="email"
          required
          value={approvedBy}
          onChange={(event) => setApprovedBy(event.target.value)}
          placeholder="a second operator"
        />
        <p className="hint">A rollback is a publication. It needs the same second identity.</p>
      </div>

      <button type="submit" disabled={pending || selected === ""}>
        {pending ? "Rolling back…" : "Roll back"}
      </button>

      {result?.error && <p className="error">{result.error}</p>}
      {result?.revision && <p className="ok">Published as revision {result.revision}.</p>}
    </form>
  )
}
