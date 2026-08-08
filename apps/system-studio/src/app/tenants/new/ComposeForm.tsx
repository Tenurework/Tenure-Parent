"use client"

import { useActionState, useMemo, useState } from "react"

import { activationPreview, fromMinorUnits, toDecimal, type OptionPrice } from "@tenure/finops"

import { composeTenant, type ComposeResult } from "../actions"

/**
 * PAY-160-002 — a price in whole minor units, rendered at its currency's own
 * precision.
 *
 * Through `@tenure/finops` rather than `(minor / 100).toFixed(2)`: the divisor is
 * not 100 for every currency, and `toDecimal` reads the exponent off the `Money`
 * it is given. `half-even` because it is a display rounding with no bias, stated
 * rather than defaulted.
 */
function priceLabel(minor: number, currency: string): string {
  const rendered = toDecimal(fromMinorUnits(minor, currency), "half-even")
  return currency === "USD" ? `$${rendered}` : `${rendered} ${currency}`
}

/**
 * What ticking a coexistence domain does to the quote.
 *
 * Nothing — and saying so is the point. Handing a domain to an external system
 * REMOVES what Tenure may write there; it does not add a charge, and the charge
 * that does exist follows the modules. Rendering the sentence beside every
 * domain is what stops an unpriced option reading as a free one.
 */
const DOMAIN_PRICE_NOTE =
  "Not separately charged — what this costs follows the modules that write the domain."

/**
 * The composer.
 *
 * Client-side only so problems can be shown against the fields that caused them
 * without discarding what was typed. It deliberately does NOT validate: the
 * rules live in `@tenure/provisioning` and run on the server. A second copy in
 * the browser is a second copy that will disagree.
 */
export interface ComposeAxis {
  id: string
  label: string
  cardinality: "one" | "many"
  effect: string
  values: Array<{ id: string; label: string; description: string }>
}

export interface ComposeBlueprint {
  id: string
  axes: { organization: string; operatingModel: string; functional: readonly string[] }
}

export interface ComposeModule {
  key: string
  description: string
  version: string
  /** Where the module is in its life. Shown, not dropped. */
  lifecycle: string
  /** Whether the resolver would accept it. Decided by `ENABLEABLE`, on the server. */
  enableable: boolean
  /**
   * PAY-160-002. The catalog's list price, per seat and per organization.
   *
   * Required, not optional. An option whose price the form never received
   * renders as a blank beside a checkbox, and a blank price on a composer with a
   * running total is indistinguishable from free.
   */
  price: OptionPrice
}

export function ComposeForm({
  blueprints,
  modules,
  plans,
  defaultPlanId,
  regions,
  axes,
  alwaysOnModules,
  suiteModules,
  coexistenceProfiles,
  businessDomains,
}: {
  blueprints: ComposeBlueprint[]
  modules: ComposeModule[]
  // Passed in, not imported. The provisioning package's index reaches
  // `node:crypto` for the manifest digests, and importing it from a client
  // component fails the build — which is the build telling the truth about
  // what would otherwise be shipped to a browser.
  plans: Array<{ planId: string; displayName: string; grants: string }>
  /**
   * The plan the select opens on.
   *
   * Required, and passed in rather than defaulted here: the form cannot decide
   * it, because deciding it means resolving the preset's modules against a
   * plan's entitlements, and that is `resolveModules` on the server. A literal
   * in this file is what made the composer open on a plan its own action
   * refused.
   */
  defaultPlanId: string
  /** From the fleet. A hard-coded list offers a region no cell serves. */
  regions: readonly string[]
  /**
   * The archetype axes and the values each accepts, from `ARCHETYPE_AXES`.
   *
   * A tenant system is a point on these axes, not a blueprint id plus a list of
   * ticked boxes — the boxes could only ever subtract what a blueprint already
   * fixed, so "the same blueprint operating differently" had no expression at
   * all (PACK-GATE-020).
   */
  axes: ComposeAxis[]
  /** Modules every system runs, from `ALWAYS_ON_MODULES`. */
  alwaysOnModules: string[]
  /**
   * What each functional suite contributes, projected out of `compileArchetype`
   * on the server. Not a second copy of the mapping — see the page.
   */
  suiteModules: Record<string, string[]>
  /**
   * The coexistence profiles, from `COEXISTENCE_PROFILES`, each with what it
   * means. Passed in rather than imported for the same reason the plans are:
   * `@tenure/provisioning` reaches `node:crypto` and cannot be imported from a
   * client component.
   */
  coexistenceProfiles: Array<{ id: string; meaning: string }>
  /** The closed business-domain vocabulary, from `BUSINESS_DOMAINS`. */
  businessDomains: readonly string[]
}) {
  const [result, action, pending] = useActionState<ComposeResult | null, FormData>(
    composeTenant,
    null,
  )

  /* ------------------------------------------------------- PACK-020-002 --
   * The preset, and the operator's edit over it.
   *
   * The module checkboxes used to render with no `defaultChecked` and no
   * relationship to the blueprint <select> above them, so the preset
   * contributed nothing to a composition and nothing recorded that the
   * operator's selection diverged from it. They now START at what the selected
   * axes compile to, and what is submitted is the DIFF — `moduleAdd` and
   * `moduleRemove` — so the composition records what was changed rather than an
   * absolute list that no longer names the preset it came from.
   *
   * The server recompiles the preset from the submitted axes and replays the
   * diff onto it, so this state cannot be the authority. If the two disagree,
   * the server wins and says so.
   */
  const [blueprintId, setBlueprintId] = useState(blueprints[0]?.id ?? "")
  const blueprint = blueprints.find((b) => b.id === blueprintId) ?? blueprints[0]

  const [organization, setOrganization] = useState(blueprint?.axes.organization ?? "")
  const [operatingModel, setOperatingModel] = useState(blueprint?.axes.operatingModel ?? "")
  const [suites, setSuites] = useState<string[]>([...(blueprint?.axes.functional ?? [])])

  /** What the current axis selection compiles to, by the server's own table. */
  const preset = useMemo(() => {
    const keys = new Set(alwaysOnModules)
    for (const suite of suites) for (const key of suiteModules[suite] ?? []) keys.add(key)
    return keys
  }, [alwaysOnModules, suiteModules, suites])

  // Explicit divergences only. Everything else follows the preset, so changing
  // an axis moves the checkboxes with it instead of stranding a stale set —
  // which is exactly the bug an absolute selection would have.
  const [added, setAdded] = useState<string[]>([])
  const [removed, setRemoved] = useState<string[]>([])

  const enableable = new Map(modules.map((m) => [m.key, m.enableable]))
  const checked = (key: string) =>
    enableable.get(key) !== false && (added.includes(key) || (preset.has(key) && !removed.includes(key)))

  const toggle = (key: string) => {
    const inPreset = preset.has(key)
    if (checked(key)) {
      setAdded((a) => a.filter((k) => k !== key))
      if (inPreset) setRemoved((r) => (r.includes(key) ? r : [...r, key]))
    } else {
      setRemoved((r) => r.filter((k) => k !== key))
      if (!inPreset) setAdded((a) => (a.includes(key) ? a : [...a, key]))
    }
  }

  const onBlueprint = (id: string) => {
    const next = blueprints.find((b) => b.id === id)
    setBlueprintId(id)
    if (!next) return
    // A different blueprint is a different preset, and carrying an edit across
    // it would record a divergence from something the operator never saw.
    setOrganization(next.axes.organization)
    setOperatingModel(next.axes.operatingModel)
    setSuites([...next.axes.functional])
    setAdded([])
    setRemoved([])
  }

  /* --------------------------------------------------------- PAY-160-002 --
   * The quote, and what has to be settled before activation.
   *
   * Five stages and, before this, no price anywhere in any of them. Somebody
   * ticking twelve module checkboxes was assembling a commercial arrangement
   * with no idea what any of it cost, and an option with no price beside it does
   * not read as unpriced on a form — it reads as free.
   *
   * The seat count is an input rather than an assumption. Per-seat and per-org
   * are different prices and both matter: quote only the first and a
   * two-hundred-officer faculty is charged like a two-person club; quote only
   * the second and the reverse. The running total is computed by
   * `quoteConfiguration` inside `activationPreview` from the SAME manifest
   * prices the catalog validates, through integer `Money` arithmetic, so a
   * mixed-currency catalog throws rather than adding dollars to euros.
   */
  const [seats, setSeats] = useState(25)

  const preview = useMemo(
    () =>
      activationPreview(
        modules
          .filter((m) => checked(m.key))
          .map((m) => ({ optionKey: m.key, price: m.price })),
        Number.isFinite(seats) && seats >= 0 ? Math.trunc(seats) : 0,
      ),
    // `checked` closes over added/removed/preset, which is what makes the total
    // move when a checkbox does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules, seats, added, removed, preset],
  )
  const quote = preview.quote
  const extendedFor = (key: string) => quote.lines.find((l) => l.optionKey === key)?.extendedMinor ?? 0

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
      {/* PAY-160-002 — the running total, across all five stages.
          Sticky rather than a footer: the price of the composition has to be
          visible while the composition is being made, not discovered after the
          last stage. It is the figure `activationPreview` emits, not a second
          arithmetic written here. */}
      <div
        data-testid="running-total"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "var(--space-3) var(--space-4)",
          marginBottom: "var(--space-4)",
        }}
      >
        <strong>
          Running total{" "}
          <span data-testid="running-total-amount">
            {priceLabel(quote.runningTotalMinor, quote.currency)}
          </span>{" "}
          per month
        </strong>
        <p className="slug">
          {quote.lines.length} option(s) at {quote.seatCount} seat(s), per-organization plus per-seat.
          List price for the configuration below, not a contracted price — see the pre-activation
          disclosure at the end.
        </p>
        <div className="field">
          <label htmlFor="seatCount">Seats</label>
          <input
            id="seatCount"
            name="seatCount"
            type="number"
            min={0}
            step={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
          />
          <p className="hint">
            How many people hold a seat. Per-seat and whole-organization charges are quoted
            separately below because they behave differently: a ledger costs the same for ten
            officers and two hundred, and messaging does not.
          </p>
        </div>
      </div>

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

        <Field
          name="blueprintId"
          label="Blueprint"
          hint="The preset. It supplies the starting position on every axis below and the modules that follow from them — all of which you can then change."
        >
          <select
            id="blueprintId"
            name="blueprintId"
            required
            value={blueprintId}
            onChange={(e) => onBlueprint(e.target.value)}
          >
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id}
              </option>
            ))}
          </select>
        </Field>

        {/* The axes. A blueprint supplies the DEFAULT position on each; what is
            chosen here is what the engine compiles, and one axis moved is a
            genuinely different system rather than a fourth blueprint
            (PACK-020-001, PACK-GATE-020, PACK-020-003). */}
        {axes.map((axis) =>
          axis.cardinality === "one" ? (
            <Field
              key={axis.id}
              name={`archetype.${axis.id}`}
              label={axis.label}
              hint={axis.effect}
            >
              <select
                id={`archetype.${axis.id}`}
                name={`archetype.${axis.id}`}
                required
                value={axis.id === "organization" ? organization : operatingModel}
                onChange={(e) =>
                  axis.id === "organization"
                    ? setOrganization(e.target.value)
                    : setOperatingModel(e.target.value)
                }
              >
                {axis.values.map((v) => (
                  <option key={v.id} value={v.id} title={v.description}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field
              key={axis.id}
              name={`archetype.${axis.id}`}
              label={axis.label}
              hint={axis.effect}
            >
              <div className="checks">
                {axis.values.map((v) => (
                  <label key={v.id} className="check" title={v.description}>
                    <input
                      type="checkbox"
                      name={`archetype.${axis.id}`}
                      value={v.id}
                      checked={suites.includes(v.id)}
                      onChange={() =>
                        setSuites((s) =>
                          s.includes(v.id) ? s.filter((x) => x !== v.id) : [...s, v.id],
                        )
                      }
                    />
                    <span>
                      <b>{v.label}</b>
                      <span className="slug">{v.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          ),
        )}

        {/* PACK-020-002 / PACK-000-004.
            Checked from the preset the axes above compile to, and submitted as
            the DIFF from it. A module outside `ENABLEABLE` is shown with its
            lifecycle and refused rather than offered as if it were available —
            which is what dropping `lifecycle` from this list used to do. */}
        <Field
          name="modules"
          label="Modules"
          hint="Starts at what the axes above compile to. Ticking or unticking one records a per-module edit against that preset, which is what a suite cannot express."
        >
          <div className="checks">
            {modules.map((m) => (
              <label
                key={m.key}
                className="check"
                title={m.enableable ? m.description : `${m.description} — lifecycle "${m.lifecycle}"`}
              >
                <input
                  type="checkbox"
                  value={m.key}
                  checked={checked(m.key)}
                  disabled={!m.enableable}
                  onChange={() => toggle(m.key)}
                />
                <span>
                  <b>{m.key}</b>{" "}
                  <span className="version">v{m.version}</span>{" "}
                  <span className="version">{m.lifecycle}</span>
                  {!m.enableable && (
                    <span className="slug">
                      Cannot be enabled: lifecycle is &ldquo;{m.lifecycle}&rdquo;.
                    </span>
                  )}
                  {m.enableable && preset.has(m.key) && !checked(m.key) && (
                    <span className="slug">Removed from the preset.</span>
                  )}
                  {m.enableable && !preset.has(m.key) && checked(m.key) && (
                    <span className="slug">Added to the preset.</span>
                  )}
                  {/* PAY-160-002 — per SEAT and per ORG, beside every option.
                      Both, always: quoting one of them is how a two-person club
                      gets charged like a faculty or the other way round. A
                      module included at no charge says why, because zero is a
                      commercial statement and a blank is not. */}
                  <span className="slug" data-testid={`price-${m.key}`}>
                    {m.price.perSeatMinor === 0 && m.price.perOrgMinor === 0
                      ? `Included at no charge — ${m.price.includedBecause ?? "no reason stated"}`
                      : `${priceLabel(m.price.perSeatMinor, m.price.currency)} per seat · ` +
                        `${priceLabel(m.price.perOrgMinor, m.price.currency)} per organization · ` +
                        `${priceLabel(
                          checked(m.key) ? extendedFor(m.key) : m.price.perOrgMinor + m.price.perSeatMinor * seats,
                          m.price.currency,
                        )} at ${seats} seat(s)`}
                  </span>
                  <span className="slug">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
          {/* The diff, not the absolute set. The server recompiles the preset
              from the axes above and replays these onto it. */}
          {added
            .filter((key) => enableable.get(key) !== false)
            .map((key) => (
              <input key={`add-${key}`} type="hidden" name="moduleAdd" value={key} />
            ))}
          {removed
            .filter((key) => preset.has(key))
            .map((key) => (
              <input key={`remove-${key}`} type="hidden" name="moduleRemove" value={key} />
            ))}
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
          {/* Not a literal. `defaultPlanId` is the first plan whose
              entitlements let the default preset resolve, decided on the server
              by the same `resolveModules` the action refuses with — see
              `page.tsx`. */}
          <select id="planId" name="planId" defaultValue={defaultPlanId}>
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

      {/* PACK-020-004. Separate from Placement on purpose: placement is where
          Tenure runs, this is who is allowed to write. A `pooled` tenant can be
          authoritative for everything and a `silo` tenant for nothing. */}
      <section className="system">
        <header>
          <h2>Coexistence</h2>
        </header>

        <Field
          name="coexistence"
          label="Profile"
          hint="How this system sits beside whatever the customer already runs. Customer on-premise estates and other clouds are external systems, not Tenure deployment targets."
        >
          <select id="coexistence" name="coexistence" defaultValue="TENURE_CLOUD_PRIMARY">
            {coexistenceProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.meaning}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="systemOfRecord"
          label="Domains an external system owns"
          hint="Exactly one system writes a domain's facts. A module that writes a domain ticked here is refused — dual write is prohibited, and buying the entitlement would not change that."
        >
          <div className="checks">
            {businessDomains.map((domain) => (
              <label key={domain} className="check">
                <input type="checkbox" name="externalDomains" value={domain} />
                <span>
                  <b>{domain}</b>
                  <span className="slug">
                    unticked means Tenure is authoritative for {domain}
                  </span>
                  {/* Every option on every stage carries a price statement, and
                      for these the true one is that they carry no charge. A
                      blank here would read as an unpriced option; the sentence
                      says which side of the quote it is on. */}
                  <span className="slug" data-testid={`price-domain-${domain}`}>
                    {DOMAIN_PRICE_NOTE}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        {/* WRK-020-004. The grain below the domain. A domain map answers who
            writes finance; it cannot answer which side writes an invoice's
            internal note, and a bidirectional profile with no direction on it
            cannot state which side may write which field at all. Free text
            rather than a widget because an object is a record name and a field
            is one of its columns — neither is a list this console can hold. */}
        <Field
          name="objectAuthority"
          label="Object and field authority (optional)"
          hint="One per line. `finance.Invoice external INBOUND` says the customer's system writes it and Tenure receives a copy. `finance.Invoice.internalNote tenure` says that one field is ours. An object may not disagree with its domain above, and BIDIRECTIONAL is refused outside COEXISTENCE_TRANSITION and HYBRID_PROCESS_SPLIT."
        >
          <textarea
            id="objectAuthority"
            name="objectAuthority"
            rows={4}
            spellCheck={false}
            placeholder={"finance.Invoice external INBOUND\nfinance.Invoice.internalNote tenure"}
          />
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

      {/* ── Before activation ────────────────────────────────────────────
          PAY-160-002 / Bible §18. The seven things that must be settled
          before a system is activated, each either DECIDED with where the
          decision is recorded, or UNDECIDED naming what would record it.

          There is deliberately no default. A panel that renders "Merchant of
          record: Tenure" because a field was blank has made a legal claim on
          the platform's behalf, and six of these seven are decisions no code
          can make. What IS decided is the ledger preview: it is the quote
          above, which is exactly what would be posted if this configuration
          were activated today. */}
      <section className="system" data-testid="pre-activation">
        <header>
          <h2>Before activation</h2>
          <span className={`badge ${preview.readyToActivate ? "ok" : "warn"}`}>
            {preview.readyToActivate
              ? "every disclosure settled"
              : `${preview.openTopics.length} undecided`}
          </span>
        </header>
        <p>
          Registering in <code>DRAFT</code> commits to none of this. Provisioning is a separate,
          approved step, and it must not be taken while anything below is open — a system that
          takes money before its merchant of record, funds flow and loss responsibility are
          settled is one nobody can say who is liable for.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th>Disclosure</th>
              <th>State</th>
              <th>What it says today</th>
            </tr>
          </thead>
          <tbody>
            {preview.disclosures.map((d) => (
              <tr key={d.topic} data-testid={`disclosure-${d.topic}`}>
                <td>{d.label}</td>
                <td>
                  <span className={`badge ${d.state === "DECIDED" ? "ok" : "warn"}`}>
                    {d.state === "DECIDED" ? "decided" : "undecided"}
                  </span>
                </td>
                <td>
                  {d.statement}{" "}
                  <span className="slug">
                    {d.state === "DECIDED"
                      ? `Recorded in ${d.recordedIn}.`
                      : `Would be recorded by ${d.wouldRecordIt}.`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Ledger preview</h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Option</th>
              <th className="num">Per seat</th>
              <th className="num">Per organization</th>
              <th className="num">At {quote.seatCount} seats</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((quoteLine) => (
              <tr key={quoteLine.optionKey}>
                <td>{quoteLine.optionKey}</td>
                <td className="num">{priceLabel(quoteLine.perSeatMinor, quote.currency)}</td>
                <td className="num">{priceLabel(quoteLine.perOrgMinor, quote.currency)}</td>
                <td className="num">{priceLabel(quoteLine.extendedMinor, quote.currency)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total, per month</b>
              </td>
              <td className="num" />
              <td className="num" />
              <td className="num" data-testid="ledger-preview-total">
                <b>{priceLabel(quote.runningTotalMinor, quote.currency)}</b>
              </td>
            </tr>
          </tbody>
        </table>
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
