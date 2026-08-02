"use client"

import { useActionState } from "react"

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
 */

interface Field {
  key: string
  description: string
  input: "string" | "number" | "boolean" | "unsupported"
  defaultValue: string
  current: string | null
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

  return (
    <form className="config-editor">
      <input type="hidden" name="slug" value={slug} />

      {domains.map((domain) => (
        <fieldset key={domain.id} className="pref-group">
          <legend>{domain.id}</legend>
          <p className="pref-hint">{domain.governs}</p>

          {domain.fields.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={field.key}>{field.key}</label>
              {field.input === "boolean" ? (
                <select id={field.key} name={field.key} defaultValue={field.current ?? ""}>
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
                  defaultValue={field.current ?? ""}
                  placeholder={`default: ${field.defaultValue}`}
                  readOnly={field.input === "unsupported"}
                />
              )}
              <p className="hint">
                {field.description}
                {field.input === "unsupported" && " — lists and objects are read-only until there is an editor for them."}
              </p>
            </div>
          ))}
        </fieldset>
      ))}

      <div className="field">
        <label htmlFor="changeReason">Reason for the change</label>
        <input id="changeReason" name="changeReason" placeholder="what changed and why" />
        <p className="hint">Recorded on the layer. It is what an incident review reads.</p>
      </div>

      <div className="field">
        <label htmlFor="approvedBy">Approved by</label>
        <input id="approvedBy" name="approvedBy" type="email" placeholder="a second operator" required />
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
