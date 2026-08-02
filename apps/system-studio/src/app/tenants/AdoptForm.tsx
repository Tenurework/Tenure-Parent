"use client"

import { useActionState, useState } from "react"

import { adoptTenantAction, type AdoptResult } from "./actions"

/**
 * Adopt a file-bound tenant.
 *
 * Deliberately not a one-click button. Three of the four things adoption
 * asserts cannot be derived from the binding — who administers the tenant,
 * which regions its contract permits, and whether the institution row actually
 * exists in the cell — and a button that filled those in with defaults would
 * write a contractual claim nobody checked into the registry.
 *
 * So it asks. The one that matters most is the checkbox: the engine does not
 * read tenant databases, so "the institution exists" is an operator's assertion
 * and the evidence line records it as one.
 */
export function AdoptForm({
  bindings,
  plans,
  regions,
}: {
  bindings: ReadonlyArray<{ slug: string; displayName: string; blueprintId: string }>
  plans: ReadonlyArray<{ planId: string; displayName: string }>
  /** What the fleet can actually place into — a starting point, not a rule. */
  regions: readonly string[]
}) {
  const [result, action, pending] = useActionState<AdoptResult | null, FormData>(
    adoptTenantAction,
    null,
  )
  const [slug, setSlug] = useState(bindings[0]?.slug ?? "")

  if (bindings.length === 0) return null

  const problems = result?.problems ?? []

  return (
    <form action={action} className="adopt">
      <p className="hint">
        These are configured in <code>blueprints/</code> and predate the registry. Adopting one
        gives it a registry record — placement, release, lifecycle — so the fleet can see it. The
        record is marked <b>adopted</b> permanently: no provisioning history is written, because
        none was run.
      </p>

      <div className="field">
        <label htmlFor="adopt-slug">Tenant</label>
        <select
          id="adopt-slug"
          name="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        >
          {bindings.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.displayName} ({b.slug})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="adopt-contact">Administrator</label>
        <input
          id="adopt-contact"
          name="primaryContactEmail"
          type="email"
          required
          placeholder="who to contact about this account"
        />
      </div>

      <div className="field">
        <label htmlFor="adopt-residency">Permitted regions</label>
        <input
          id="adopt-residency"
          name="residency"
          required
          defaultValue={regions.join(", ")}
          placeholder="us-east-1, us-west-2"
        />
        <span className="hint">
          A contract term, comma separated. Not inferred from where it runs today — the two are
          different claims.
        </span>
      </div>

      <div className="field">
        <label htmlFor="adopt-plan">Plan</label>
        <select id="adopt-plan" name="planId" defaultValue={plans[0]?.planId}>
          {plans.map((p) => (
            <option key={p.planId} value={p.planId}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="field checkbox">
        <label htmlFor="adopt-institution">
          <input id="adopt-institution" name="institutionExists" type="checkbox" />
          <span>
            I have confirmed the institution row exists in the cell. The engine does not read
            tenant databases, so this is recorded as your assertion.
          </span>
        </label>
      </div>

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p, i) => (
            <li key={i}>
              <b>{p.reason}</b> — {p.detail}
            </li>
          ))}
        </ul>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "Adopting…" : "Adopt into the registry"}
      </button>
    </form>
  )
}
