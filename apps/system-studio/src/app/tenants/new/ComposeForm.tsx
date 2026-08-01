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
}: {
  blueprints: string[]
  modules: Array<{ key: string; description: string; version: string }>
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

        <Field
          name="entitlements"
          label="Entitlements"
          hint="Comma separated. Modules the plan permits beyond the blueprint's defaults."
        >
          <input id="entitlements" name="entitlements" placeholder="analytics, relay" />
        </Field>
      </section>

      <section className="system">
        <header>
          <h2>Placement</h2>
        </header>

        <Field name="region" label="Region">
          <select id="region" name="region" defaultValue="us-east-1">
            <option value="us-east-1">us-east-1</option>
            <option value="us-west-2">us-west-2</option>
            <option value="eu-west-1">eu-west-1</option>
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
