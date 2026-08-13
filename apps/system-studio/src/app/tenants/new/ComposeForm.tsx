"use client"

import { useActionState, useMemo, useState } from "react"

import { activationPreview, fromMinorUnits, toDecimal, type OptionPrice } from "@tenure/finops"

/*
 * Relative, not `@/components/md3`, and it is the toolchain that decides this.
 *
 * The Studio has no jest of its own — `apps/web/jest.config.js` collects
 * `apps/system-studio/src` through that app's next/jest transform, and its
 * `moduleNameMapper` resolves `^@/(.*)$` to `apps/web/src/$1`. So a Studio
 * component that imports `@/components/md3` cannot be rendered by the only
 * runner that can render one, and `compose-pricing.test.tsx` — which asserts
 * the real catalog's prices reach the markup — would fail to resolve a module
 * rather than fail on a price. The alias is right in the app and wrong under
 * the test; the relative path is right under both.
 */
import { Badge, Button, Card, DataTable, EmptyState } from "../../../components/md3"

import { composeTenant, type ComposeResult } from "../actions"
import {
  canPlace,
  placementRefusal,
  placementSummary,
  type PlacementOffer,
} from "./placement"

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
 *
 * ## The shape of the page, and why it changed
 *
 * It was one flat wall of rows under one heading per stage, led by the
 * apparatus: the first thing an operator met was a seat-count box. The
 * operator's summary of this console was that it "looks like a construction
 * site", and this surface was a fair example.
 *
 * It now leads with the ANSWER — what registering does, what the configuration
 * would cost if it were activated today, what is still undecided before it
 * could be, and where it would run — and every stage below is a Material 3
 * `Card` with a real heading, a sentence saying what the card is, and a line
 * saying WHERE ITS FACTS CAME FROM AND AS OF WHEN. That last part is not
 * decoration: three of these cards are populated from catalogs compiled into
 * this build and one is read live from the fleet at request time, and until a
 * card said so an operator had no way to tell which of the two they were
 * looking at.
 *
 * The colours, type sizes, elevations and shapes are the token layer's — via
 * `components/md3`. There is no hand-set size and no literal colour in this
 * file, which is the rule `docs/architecture/studio-design-system.md` states and
 * `e2e/md3-tokens-logic.spec.ts` enforces on the primitives it depends on.
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

type ComposeProblem = ComposeResult["problems"][number]

/**
 * A labelled control, its hint, and the server's complaints about it.
 *
 * At module scope, deliberately. It used to be declared inside `ComposeForm`,
 * which gave it a new component identity on every render — so React unmounted
 * and remounted every field whenever any state changed, and the operator
 * ticking module checkboxes lost keyboard focus on each tick. Hoisting it is
 * the fix; the props are the state it used to close over.
 */
function Field({
  name,
  label,
  hint,
  problems,
  children,
}: {
  name: string
  label: string
  hint?: string
  problems: readonly ComposeProblem[]
  children: React.ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {problems.map((p) => (
        <p className="error" key={p.reason}>
          {p.detail}
        </p>
      ))}
    </div>
  )
}

/** One row of the ledger preview: a priced line, or the total under them. */
interface LedgerRow {
  key: string
  option: string
  perSeat: string
  perOrg: string
  extended: string
  total: boolean
}

export function ComposeForm({
  blueprints,
  modules,
  plans,
  defaultPlanId,
  placement,
  axes,
  alwaysOnModules,
  suiteModules,
  coexistenceProfiles,
  businessDomains,
  engineVersion,
  fleetReadAt,
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
  /**
   * What the fleet will accept — or why it could not say.
   *
   * This replaced a bare `regions: readonly string[]`, and the type changed
   * rather than gaining an optional field on purpose: an OPTIONAL prop a caller
   * omits is invisible to `tsc`, and the whole point of the change is that
   * every construction site has to state what it knows about placement. There
   * are two of them and both are in this directory.
   */
  placement: PlacementOffer
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
  /**
   * The engine version the catalogs below were compiled at.
   *
   * Every panel states what it is AS OF. For the blueprint, module and plan
   * catalogs the honest answer is not a clock reading — they are compiled into
   * this build and do not change between requests — it is the version of the
   * build. Printing a timestamp beside them would suggest a freshness they do
   * not have.
   */
  engineVersion: string
  /**
   * When the fleet was read, in ISO-8601.
   *
   * This one IS a clock reading, because the cell registry is read on the
   * server per request. It is passed in rather than taken here so the server
   * and the browser cannot disagree about it.
   */
  fleetReadAt: string
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

  const enableableCount = modules.filter((m) => m.enableable).length
  const refusal = placementRefusal(placement)
  const placeable = canPlace(placement)

  const ledgerRows: LedgerRow[] = [
    ...quote.lines.map((line) => ({
      key: line.optionKey,
      option: line.optionKey,
      perSeat: priceLabel(line.perSeatMinor, quote.currency),
      perOrg: priceLabel(line.perOrgMinor, quote.currency),
      extended: priceLabel(line.extendedMinor, quote.currency),
      total: false,
    })),
    {
      key: "__total",
      option: "Total, per month",
      perSeat: "",
      perOrg: "",
      extended: priceLabel(quote.runningTotalMinor, quote.currency),
      total: true,
    },
  ]

  return (
    <form action={action}>
      {/* ── The answer, before the apparatus ────────────────────────────────
          PAY-160-002. What registering does, what it would cost, what is not
          settled yet, and where it would run — the four things an operator came
          to this page to find out, above the form that decides them.

          Sticky rather than a footer: the price of a composition has to be
          visible WHILE the composition is being made, not discovered after the
          last stage. The inline style carries position only; every colour,
          radius and shadow on the card below is a token, through `Surface`. */}
      <div
        data-testid="running-total"
        style={{ position: "sticky", insetBlockStart: 0, zIndex: 2 }}
      >
        <Card
          headline="This composition"
          headerAside={
            <Badge
              tone={preview.readyToActivate ? "ok" : "warn"}
              title="Whether every pre-activation disclosure has been settled. Registering in DRAFT does not require it; activating does."
            >
              {preview.readyToActivate
                ? "every disclosure settled"
                : `${preview.openTopics.length} undecided`}
            </Badge>
          }
          supportingText="Registering puts this tenant in DRAFT. Nothing is built, nothing is billed and no routing changes — provisioning is a separate, approved step taken from the tenant's own page once its plan has been read."
          container="high"
          level={1}
        >
          <dl className="kv">
            <dt>List price if activated today</dt>
            <dd>
              <b data-testid="running-total-amount">
                {priceLabel(quote.runningTotalMinor, quote.currency)}
              </b>{" "}
              per month — {quote.lines.length} option(s) at {quote.seatCount} seat(s),
              per-organization plus per-seat. List price for the configuration below, not a
              contracted price.
            </dd>

            <dt>Before it could be activated</dt>
            <dd>
              {preview.readyToActivate
                ? "Nothing is open. Each of the seven disclosures below carries where it was decided."
                : `${preview.openTopics.length} of ${preview.disclosures.length} disclosures are open, and none of them is defaulted. They are listed at the end of this form with what would record each one.`}
            </dd>

            <dt>Where it would run</dt>
            <dd>{placementSummary(placement)}</dd>

            <dt>As of</dt>
            <dd>
              Blueprint, module and plan catalogs as compiled into this build, engine{" "}
              <code>{engineVersion}</code>. Fleet read at <code>{fleetReadAt}</code>.
            </dd>
          </dl>

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
        </Card>
      </div>

      <Card
        headline="Identity"
        supportingText="What this tenant is called, in the URL, in the contract and on screen."
      >
        <p className="hint">
          As of now: nothing here is read from anywhere. These are the values you are supplying,
          and the slug is the only one that is expensive to change afterwards.
        </p>

        <Field
          name="slug"
          label="Slug"
          hint="Becomes platform.tenurework.com/<slug> and part of resource names. Changing it later is a migration."
          problems={problemsFor("slug")}
        >
          <input id="slug" name="slug" required placeholder="midtown-arts" autoComplete="off" />
        </Field>

        <Field
          name="legalName"
          label="Legal name"
          hint="The entity this system belongs to."
          problems={problemsFor("legalName")}
        >
          <input id="legalName" name="legalName" required placeholder="Midtown Arts Collective" />
        </Field>

        <Field
          name="displayName"
          label="Display name"
          hint="What its users see."
          problems={problemsFor("displayName")}
        >
          <input id="displayName" name="displayName" required placeholder="Midtown Arts" />
        </Field>
      </Card>

      <Card
        headline="Blueprint and archetype"
        supportingText="The preset, and the point on each axis the engine will compile the system from."
      >
        <p className="hint">
          As of engine <code>{engineVersion}</code>: {blueprints.length} blueprint(s) and{" "}
          {axes.length} axes, read from the catalog compiled into this build. A blueprint supplies
          the starting position on every axis; one axis moved is a genuinely different system rather
          than a fourth blueprint (PACK-020-001, PACK-GATE-020).
        </p>

        <Field
          name="blueprintId"
          label="Blueprint"
          hint="The preset. It supplies the starting position on every axis below and the modules that follow from them — all of which you can then change."
          problems={problemsFor("blueprintId")}
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

        {axes.map((axis) =>
          axis.cardinality === "one" ? (
            <Field
              key={axis.id}
              name={`archetype.${axis.id}`}
              label={axis.label}
              hint={axis.effect}
              problems={problemsFor(`archetype.${axis.id}`)}
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
              problems={problemsFor(`archetype.${axis.id}`)}
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
      </Card>

      {/* PACK-020-002 / PACK-000-004.
          Checked from the preset the axes above compile to, and submitted as
          the DIFF from it. A module outside `ENABLEABLE` is shown with its
          lifecycle and refused rather than offered as if it were available —
          which is what dropping `lifecycle` from this list used to do. */}
      <Card
        headline="Modules"
        headerAside={
          <Badge
            tone={enableableCount === modules.length ? "neutral" : "warn"}
            title="How many of the catalog's modules the resolver would currently accept."
          >
            {enableableCount} of {modules.length} enableable
          </Badge>
        }
        supportingText="What the system can do. Starts at what the axes above compile to; every tick or untick is recorded as an edit against that preset."
      >
        <p className="hint">
          As of engine <code>{engineVersion}</code>: the module catalog compiled into this build,
          with each manifest&rsquo;s own list price and lifecycle carried through. A module the
          resolver would refuse is shown with the lifecycle that refuses it rather than being
          hidden, because an option absent from a list is indistinguishable from one that does not
          exist.
        </p>

        <Field
          name="modules"
          label="Modules"
          hint="Ticking or unticking one records a per-module edit against the preset, which is what a suite cannot express."
          problems={problemsFor("modules")}
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
      </Card>

      {/* Entitlements are a consequence of the contracted plan, not free
          text. Typed, every tenant's commercial state was a typing exercise:
          a typo was a silently missing feature and there was nothing to
          reconcile an invoice against (GE-030-004). */}
      <Card
        headline="Plan"
        supportingText="What was contracted. Entitlements and quotas follow from it, and a module the plan does not grant is refused rather than quietly dropped."
      >
        <p className="hint">
          As of engine <code>{engineVersion}</code>: {plans.length} plan(s) from the catalog
          compiled into this build. The plan this opens on is not a literal — it is the first one
          whose entitlements let the default preset resolve, decided on the server by the same
          `resolveModules` the action refuses with.
        </p>

        <Field
          name="planId"
          label="Plan"
          hint="What was contracted. Entitlements and quotas follow from it."
          problems={problemsFor("planId")}
        >
          <select id="planId" name="planId" defaultValue={defaultPlanId}>
            {plans.map((p) => (
              <option key={p.planId} value={p.planId}>
                {p.displayName} — {p.grants}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card
        headline="Placement"
        headerAside={
          <Badge
            tone={placeable ? "info" : "warn"}
            title="Whether the fleet named a region this composition could be placed in."
          >
            {placeable ? "fleet answered" : "no region offered"}
          </Badge>
        }
        supportingText="Which cell this system runs in, and how much of it the tenant has to itself."
      >
        <p className="hint">
          As of <code>{fleetReadAt}</code>: read from the cell registry on the server, for this
          request. Not a hard-coded list — a hard-coded list lets an operator pick a region no cell
          serves, and placement then refuses with &ldquo;no cell in your residency&rdquo;, which is
          a confusing way to learn the list was a guess.
        </p>

        {placement.state === "OFFERED" ? (
          <Field name="region" label="Region" problems={problemsFor("region")}>
            <select id="region" name="region" defaultValue={placement.regions[0]}>
              {placement.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          /*
           * STUDIO-000-007. Unknown is not empty, and neither is a refusal.
           *
           * The page used to call `placeableRegions()` bare, and that function
           * throws rather than inventing an estate — so a console with no AWS
           * credentials served a 500 here. It now renders WHICH of the three
           * things happened, and what would fix it, and it does not offer a
           * region control there is no fleet behind.
           */
          <div>
            {/* Not `role="status"`. `components/states.tsx` reserves the live
                region for the governed state block; this panel is rendered with
                the page, and announcing a static refusal every time the page
                settles is how a screen reader is trained to ignore one. */}
            <p className="md3-title-small">{refusal?.headline}</p>
            <p className="md3-body-medium">{refusal?.detail}</p>
            <p className="md3-body-medium">{refusal?.remedy}</p>
            {placement.state === "UNKNOWN" && (
              <dl className="kv">
                {placement.problems.map((p) => (
                  <div key={p.field} style={{ display: "contents" }}>
                    <dt>{p.field}</dt>
                    <dd>{p.detail}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <Field
          name="isolation"
          label="Isolation"
          hint="Pooled shares the cell's database and cluster; isolation is the application's tenant scope. A dedicated account needs an AWS Organization, which does not exist yet."
          problems={problemsFor("isolation")}
        >
          <select id="isolation" name="isolation" defaultValue="pooled">
            <option value="pooled">pooled — shares the cell</option>
            <option value="bridge">bridge — shared cluster, own schema</option>
            <option value="silo">silo — dedicated resources in the cell</option>
            <option value="dedicated-account">dedicated-account — unavailable, needs GE-010</option>
          </select>
        </Field>
      </Card>

      {/* PACK-020-004. Separate from Placement on purpose: placement is where
          Tenure runs, this is who is allowed to write. A `pooled` tenant can be
          authoritative for everything and a `silo` tenant for nothing. */}
      <Card
        headline="Coexistence"
        supportingText="How this system sits beside whatever the customer already runs, and which side writes what."
      >
        <p className="hint">
          As of engine <code>{engineVersion}</code>: {coexistenceProfiles.length} profile(s) and{" "}
          {businessDomains.length} business domain(s), from the closed vocabularies the server
          validates against — so this form cannot offer a profile or a domain the server refuses.
          Customer on-premise estates and other clouds are external systems, not Tenure deployment
          targets.
        </p>

        <Field
          name="coexistence"
          label="Profile"
          hint="How this system sits beside whatever the customer already runs."
          problems={problemsFor("coexistence")}
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
          problems={problemsFor("systemOfRecord")}
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
          problems={problemsFor("objectAuthority")}
        >
          <textarea
            id="objectAuthority"
            name="objectAuthority"
            rows={4}
            spellCheck={false}
            placeholder={"finance.Invoice external INBOUND\nfinance.Invoice.internalNote tenure"}
          />
        </Field>
      </Card>

      <Card
        headline="First administrator"
        supportingText="Who can sign in once it is provisioned. A system nobody can sign into is not deployed."
      >
        <p className="hint">
          As of now: nothing here is read from anywhere. Provisioning creates exactly one
          invitation, to the address below.
        </p>

        <Field
          name="initialAdminEmail"
          label="Email"
          hint="Provisioning creates exactly one invitation."
          problems={problemsFor("initialAdminEmail")}
        >
          <input id="initialAdminEmail" name="initialAdminEmail" type="email" required />
        </Field>

        <Field name="notes" label="Notes" hint="Shown on the plan." problems={problemsFor("notes")}>
          <textarea id="notes" name="notes" rows={3} />
        </Field>
      </Card>

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
      <div data-testid="pre-activation">
        <Card
          headline="Before activation"
          headerAside={
            <Badge tone={preview.readyToActivate ? "ok" : "warn"}>
              {preview.readyToActivate
                ? "every disclosure settled"
                : `${preview.openTopics.length} undecided`}
            </Badge>
          }
          supportingText="Registering in DRAFT commits to none of this. Provisioning is a separate, approved step, and it must not be taken while anything below is open — a system that takes money before its merchant of record, funds flow and loss responsibility are settled is one nobody can say who is liable for."
        >
          <p className="hint">
            As of this composition, recomputed as it changes. Six of the seven are decisions no code
            can make, so each open one names the artefact that would record it rather than showing a
            default.
          </p>

          <DataTable
            caption="Pre-activation disclosures"
            rows={preview.disclosures}
            rowKey={(d) => d.topic}
            columns={[
              {
                key: "disclosure",
                header: "Disclosure",
                cell: (d) => <span data-testid={`disclosure-${d.topic}`}>{d.label}</span>,
              },
              {
                key: "state",
                header: "State",
                cell: (d) => (
                  <Badge tone={d.state === "DECIDED" ? "ok" : "warn"}>
                    {d.state === "DECIDED" ? "decided" : "undecided"}
                  </Badge>
                ),
              },
              {
                key: "statement",
                header: "What it says today",
                cell: (d) => (
                  <>
                    {d.statement}{" "}
                    <span className="slug">
                      {d.state === "DECIDED"
                        ? `Recorded in ${d.recordedIn}.`
                        : `Would be recorded by ${d.wouldRecordIt}.`}
                    </span>
                  </>
                ),
              },
            ]}
            empty={
              <EmptyState
                headline="No disclosure applies"
                description="activationPreview returned no topics at all, which it is not expected to do — seven are unconditional. Treat this as a defect in the preview rather than as a settled configuration."
              />
            }
          />
        </Card>
      </div>

      <Card
        headline="Ledger preview"
        supportingText="Exactly what would be posted, per month, if this configuration were activated today."
      >
        <p className="hint">
          As of this composition, at {quote.seatCount} seat(s), in {quote.currency}. Every line is
          the manifest&rsquo;s own list price in whole minor units with no proration applied.
        </p>

        <DataTable
          caption={`Monthly charge lines at ${quote.seatCount} seat(s)`}
          rows={ledgerRows}
          rowKey={(row) => row.key}
          columns={[
            {
              key: "option",
              header: "Option",
              cell: (row) => (row.total ? <b>{row.option}</b> : row.option),
            },
            { key: "perSeat", header: "Per seat", align: "end", cell: (row) => row.perSeat },
            {
              key: "perOrg",
              header: "Per organization",
              align: "end",
              cell: (row) => row.perOrg,
            },
            {
              key: "extended",
              header: `At ${quote.seatCount} seats`,
              align: "end",
              cell: (row) =>
                row.total ? (
                  <b data-testid="ledger-preview-total">{row.extended}</b>
                ) : (
                  row.extended
                ),
            },
          ]}
          empty={
            <EmptyState
              headline="No option carries a charge yet"
              description="Nothing selected above has a per-seat or per-organization price, so there is no line to post. That is a statement about the selection, not a discount."
            />
          }
        />
      </Card>

      {(result?.problems.length ?? 0) > 0 && (
        <p className="error">
          {result!.problems.length} problem{result!.problems.length === 1 ? "" : "s"} — nothing was
          registered.
        </p>
      )}

      {!placeable && (
        <p className="error">
          Composing is disabled: {placementSummary(placement)} A manifest with no region is refused
          by the server, so this form will not submit one.
        </p>
      )}

      <div className="md3-card-actions">
        <Button type="submit" variant="filled" disabled={pending || !placeable}>
          {pending ? "Registering…" : "Register in DRAFT"}
        </Button>
      </div>
    </form>
  )
}
