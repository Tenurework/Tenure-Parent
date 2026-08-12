"use client"

import { useActionState, useState } from "react"

import { publish, review, type PublishResult, type ReviewResult } from "./actions"

/**
 * GE-032-001 — the editor, in two steps.
 *
 * Review produces a plan and writes nothing; publish commits it. A one-step
 * save would make the diff, the lint findings, the impact preview and the
 * four-eyes check into things that happened somewhere the operator did not
 * look — which is the same as not having them.
 *
 * The form is submitted twice, once to each action, rather than carrying the
 * reviewed plan in a hidden field. A hidden field holding a serialised layer is
 * a hidden field holding whatever the browser sends, and it would be the one
 * input on this path that nothing validates.
 *
 * ## Every input is controlled, and that is load-bearing
 *
 * React 19 resets a form after an action attached to it completes. With
 * uncontrolled inputs that meant "Review the change" **wiped every field the
 * operator had just filled in** — the values, the reason, and the required
 * approver. The plan still rendered, because the action had already read the
 * submitted data, so the screen looked correct. Publish then did nothing at
 * all: it was enabled, but the now-empty `required` approver failed HTML5
 * validation, which blocks submission silently and shows no message.
 *
 * The whole publish path was therefore dead in the real UI while
 * GE-031-006, GE-032-001 and GE-032-003 were all recorded as passing — every
 * one of them proven over pure functions and an in-memory store. Nothing
 * exercised the browser, so nothing noticed. It was GE-GATE-3 that found it,
 * which is what a phase gate is for.
 *
 * Holding the values in state makes the reset a no-op: React restores what the
 * component says they are, which is what the operator typed. It is not a
 * styling choice, so it must not be "simplified" back to `defaultValue`.
 */

interface Field {
  key: string
  description: string
  input: "string" | "number" | "boolean" | "unsupported"
  defaultValue: string
  current: string | null
  /**
   * What this option costs, rendered by the server (NEXT-SESSION §7).
   *
   * A string rather than the price object, and formatted on the server rather
   * than here, because the running total in the section below this form is the
   * resolver's. A client that could compute money would eventually compute a
   * different total than the engine, and the one on the screen would be the one
   * nobody validated.
   */
  price: string
}

export function ConfigurationEditor({
  slug,
  domains,
}: {
  slug: string
  domains: readonly { id: string; governs: string; fields: readonly Field[] }[]
}) {
  const [reviewed, doReview, reviewing] = useActionState<ReviewResult | null, FormData>(review, null)
  const [published, doPublish, publishing] = useActionState<PublishResult | null, FormData>(publish, null)

  // Seeded from what is currently published, so the editor opens showing the
  // tenant's real configuration rather than an empty form that would publish
  // "unset" for every key the operator did not happen to retype.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(domains.flatMap((d) => d.fields.map((f) => [f.key, f.current ?? ""]))),
  )
  const [changeReason, setChangeReason] = useState("")
  const [activateAt, setActivateAt] = useState("")
  const [approvedBy, setApprovedBy] = useState("")

  const set = (key: string) => (event: { target: { value: string } }) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }))

  const domainSummaries = domains.map((domain) => {
    const filled = domain.fields.filter((field) => (values[field.key] ?? "").trim() !== "").length
    const readOnly = domain.fields.filter((field) => field.input === "unsupported").length
    return {
      id: domain.id,
      governs: domain.governs,
      total: domain.fields.length,
      filled,
      readOnly,
    }
  })

  return (
    <form className="config-editor">
      <input type="hidden" name="slug" value={slug} />

      <div className="config-shell">
        <nav className="config-map" aria-label="Configuration domains" data-testid="configuration-map">
          <p className="state-label">Configuration map</p>
          {domainSummaries.map((domain) => (
            <a key={domain.id} href={`#config-domain-${domain.id}`} className="config-map-link">
              <span>
                <b>{domain.id}</b>
                <small>{domain.governs}</small>
              </span>
              <span className="config-map-count">
                {domain.filled}/{domain.total}
                {domain.readOnly > 0 ? ` · ${domain.readOnly} read-only` : ""}
              </span>
            </a>
          ))}
        </nav>

        <div className="config-fields">
          {domains.map((domain) => (
            <fieldset key={domain.id} id={`config-domain-${domain.id}`} className="pref-group config-domain">
              <legend>{domain.id}</legend>
              <p className="pref-hint">{domain.governs}</p>

              {domain.fields.map((field) => (
                <div className="field config-field" key={field.key}>
                  <label htmlFor={field.key}>{field.key}</label>
                  {field.input === "boolean" ? (
                    <select id={field.key} name={field.key} value={values[field.key] ?? ""} onChange={set(field.key)}>
                      {/* Empty means "do not set", which is not the same as false. */}
                      <option value="">unset — the default applies</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      id={field.key}
                      name={field.key}
                      type={field.input === "number" ? "number" : "text"}
                      value={values[field.key] ?? ""}
                      onChange={set(field.key)}
                      placeholder={`default: ${field.defaultValue}`}
                      readOnly={field.input === "unsupported"}
                    />
                  )}
                  <p className="hint">
                    {field.description}
                    {field.input === "unsupported" &&
                      " — lists and objects are read-only until there is an editor for them."}
                  </p>
                  {/* The price, beside the choice rather than on a summary the
                      operator has to go and find. §7: cost is never a surprise at
                      the end because it was never only at the end. */}
                  <p className="hint" data-price={field.key}>
                    {field.price}
                  </p>
                </div>
              ))}
            </fieldset>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="changeReason">Reason for the change</label>
        <input
          id="changeReason"
          name="changeReason"
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          placeholder="what changed and why"
        />
        <p className="hint">Recorded on the layer. It is what an incident review reads.</p>
      </div>

      <div className="field">
        <label htmlFor="activateAt">Take effect</label>
        <input
          id="activateAt"
          name="activateAt"
          type="datetime-local"
          value={activateAt}
          onChange={(e) => setActivateAt(e.target.value)}
        />
        <p className="hint">Empty means now. A past instant is refused rather than quietly moved to now.</p>
      </div>

      <div className="field">
        <label htmlFor="approvedBy">Approved by</label>
        <input
          id="approvedBy"
          name="approvedBy"
          type="email"
          value={approvedBy}
          onChange={(e) => setApprovedBy(e.target.value)}
          placeholder="a second operator"
          required
        />
        <p className="hint">Must not be you. An approval by the author is not a second pair of eyes.</p>
      </div>

      <div className="state-actions">
        <button type="submit" formAction={doReview} disabled={reviewing}>
          {reviewing ? "Planning…" : "Review the change"}
        </button>
        <button
          type="submit"
          className="primary-action"
          formAction={doPublish}
          // Publishing before reviewing is possible on the server and refused
          // there; disabling it here is a courtesy, not the control.
          disabled={publishing || !reviewed?.plan || reviewed.plan.blocked}
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>

      {reviewed?.error && <p className="error">{reviewed.error}</p>}
      {published?.error && <p className="error">{published.error}</p>}
      {published?.revision && <p className="ok">Published as revision {published.revision}.</p>}

      {reviewed?.plan && (
        <section className="plan">
          <h3>Plan</h3>

          {reviewed.plan.blocked && (
            <div className="state state-bad" data-state="blocked">
              <p className="state-label">Blocked</p>
              <div className="state-body">
                {/* Violations first and labelled. "This is not yours to change"
                    is a different answer from "this configuration is wrong",
                    and an operator needs to know which before deciding whether
                    to fix it or to ask (GE-032-002). */}
                {reviewed.plan.violations.map((v) => (
                  <p key={`${v.invariant}-${v.key ?? v.layerId}`}>
                    <b>{v.invariant.replace(/-/g, " ")}</b> — {v.detail}
                  </p>
                ))}
                {[...reviewed.plan.blockers, ...reviewed.plan.rejections.map((r) => r.detail)].map((b) => (
                  <p key={b}>{b}</p>
                ))}
              </div>
            </div>
          )}

          <h4>What changes</h4>
          <pre className="state-detail">{reviewed.plan.humanDiff}</pre>

          <h4>Impact</h4>
          <div className="chips">
            <span className="chip">
              <b>{reviewed.plan.impact.keysChanged}</b> changed
            </span>
            <span className="chip">
              <b>{reviewed.plan.impact.keysAdded}</b> added
            </span>
            <span className="chip">
              <b>{reviewed.plan.impact.keysRemoved}</b> removed
            </span>
            <span className="chip">
              rollback to <b>{reviewed.plan.rollbackTo ?? "nothing — this is the first"}</b>
            </span>
          </div>

          {reviewed.plan.simulations.length > 0 && (
            <>
              <h4>Fixture results</h4>
              <table className="grid">
                <tbody>
                  {reviewed.plan.simulations.map((sim) => (
                    <tr key={sim.fixture}>
                      <td className="id">{sim.fixture}</td>
                      <td className="slug">{sim.checksum ?? "did not resolve"}</td>
                      <td className="slug">{sim.problems.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {reviewed.plan.lint.length > 0 && (
            <>
              <h4>Worth a look</h4>
              <p className="slug">These do not block publication.</p>
              <ul className="state-list">
                {reviewed.plan.lint.map((finding) => (
                  <li key={`${finding.code}-${finding.key ?? finding.layerId}`}>{finding.detail}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </form>
  )
}
