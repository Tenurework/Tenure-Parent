"use client"

import { useActionState } from "react"

import { composeTenant, type ComposeResult } from "../actions"

/**
 * The composer.
 *
 * Client-side only so problems can be shown against the fields that caused them
 * without discarding what was typed. It deliberately does NOT validate: the
 * rules live in `@tenure/provisioning` and run on the server. A second copy in
 * the browser is a second copy that will disagree.
 */
export function ComposeForm({
  blueprints,
  modules,
  plans,
  regions,
}: {
  blueprints: string[]
  modules: Array<{ key: string; description: string; version: string }>
  // Passed in, not imported. The provisioning package's index reaches
  // `node:crypto` for the manifest digests, and importing it from a client
  // component fails the build — which is the build telling the truth about
  // what would otherwise be shipped to a browser.
  plans: Array<{ planId: string; displayName: string; grants: string }>
  /** From the fleet. A hard-coded list offers a region no cell serves. */
  regions: readonly string[]
}) {
  const [result, action, pending] = useActionState<ComposeResult | null, FormData>(
    composeTenant,
    null,
  )

  const problemsFor = (field: string) => (result?.problems ?? []).filter((p) => p.field === field)

  const Field = ({
    name,
    label,
    hint,
    children,
  }: {
    name: string
    label: string
    hint?: string
    children: React.ReactNode
  }) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {problemsFor(name).map((p) => (
        <p className="error" key={p.reason}>
          {p.detail}
        </p>
      ))}
    </div>
  )

  return (
    <form action={action} className="compose">
      <section className="system">
        <header>
          <h2>Identity</h2>
        </header>

        <Field
          name="slug"
          label="Slug"
          hint="Becomes platform.tenurework.com/<slug> and part of resource names. Changing it later is a migration."
        >
          <input id="slug" name="slug" required placeholder="midtown-arts" autoComplete="off" />
        </Field>

        <Field name="legalName" label="Legal name" hint="The entity this system belongs to.">
          <input id="legalName" name="legalName" required placeholder="Midtown Arts Collective" />
        </Field>

        <Field name="displayName" label="Display name" hint="What its users see.">
          <input id="displayName" name="displayName" required placeholder="Midtown Arts" />
        </Field>
      </section>

      <section className="system">
        <header>
          <h2>System</h2>
        </header>

        <Field name="blueprintId" label="Blueprint">
          <select id="blueprintId" name="blueprintId" required defaultValue={blueprints[0]}>
            {blueprints.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>

        <Field name="modules" label="Modules" hint="A system with none has no surfaces.">
          <div className="checks">
            {modules.map((m) => (
              <label key={m.key} className="check" title={m.description}>
                <input type="checkbox" name="modules" value={m.key} />
                <span>
                  <b>{m.key}</b>{" "}
                  <span className="version">v{m.version}</span>
                  <span className="slug">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        {/* Entitlements are a consequence of the contracted plan, not free
            text. Typed, every tenant's commercial state was a typing exercise:
            a typo was a silently missing feature and there was nothing to
            reconcile an invoice against (GE-030-004). */}
        <Field
          name="planId"
          label="Plan"
          hint="What was contracted. Entitlements and quotas follow from it."
        >
          <select id="planId" name="planId" defaultValue="institution-core">
            {plans.map((p) => (
              <option key={p.planId} value={p.planId}>
                {p.displayName} — {p.grants}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="system">
        <header>
          <h2>Placement</h2>
        </header>

        <Field name="region" label="Region">
          {/* From the fleet, not a literal list. A hard-coded list lets an
              operator pick a region no cell serves, and placement then
              refuses with "no cell in your residency" — a confusing way to
              learn the list was a guess. */}
          <select id="region" name="region" defaultValue={regions[0]}>
            {regions.map((r: string) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="isolation"
          label="Isolation"
          hint="Pooled shares the cell's database and cluster; isolation is the application's tenant scope. A dedicated account needs an AWS Organization, which does not exist yet."
        >
          <select id="isolation" name="isolation" defaultValue="pooled">
            <option value="pooled">pooled — shares the cell</option>
            <option value="bridge">bridge — shared cluster, own schema</option>
            <option value="silo">silo — dedicated resources in the cell</option>
            <option value="dedicated-account">dedicated-account — unavailable, needs GE-010</option>
          </select>
        </Field>
      </section>

      <section className="system">
        <header>
          <h2>First administrator</h2>
        </header>

        <Field
          name="initialAdminEmail"
          label="Email"
          hint="Provisioning creates exactly one invitation. A system nobody can sign into is not deployed."
        >
          <input id="initialAdminEmail" name="initialAdminEmail" type="email" required />
        </Field>

        <Field name="notes" label="Notes" hint="Shown on the plan.">
          <textarea id="notes" name="notes" rows={3} />
        </Field>
      </section>

      {(result?.problems.length ?? 0) > 0 && (
        <p className="error">
          {result!.problems.length} problem{result!.problems.length === 1 ? "" : "s"} — nothing was
          registered.
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Register in DRAFT"}
      </button>
    </form>
  )
}
