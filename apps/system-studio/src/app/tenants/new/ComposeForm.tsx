"use client"

import { useActionState, useMemo, useState, type ReactNode } from "react"

import type { OptionPrice } from "@tenure/finops"

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
import {
  Badge,
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  Select,
  TextArea,
  TextField,
  type KeyValueItem,
} from "../../../components/md3"

import { composeTenant, type ComposeResult } from "../actions"
import { Choice, ChoiceGroup } from "./ChoiceGroup"
import {
  canPlace,
  placementRefusal,
  placementSummary,
  type PlacementOffer,
} from "./placement"
import {
  REFUSAL_HEADLINE,
  REFUSAL_REMEDY,
  optionPriceStatement,
  parseSeats,
  priceLabel,
  quoteSelection,
  type QuoteProblem,
  type SelectionQuote,
} from "./quote"

import styles from "./compose.module.css"

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
 * ## The shape of the page
 *
 * It leads with the ANSWER — what is about to be created, what it would cost if
 * it were activated today, what is still undecided before it could be, and where
 * it would run — and every stage below is a Material 3 `Card` with a real
 * heading, a sentence saying what the card is, and a line saying WHERE ITS FACTS
 * CAME FROM AND AS OF WHEN. That last part is not decoration: most of these
 * cards are populated from catalogs compiled into this build and one is read live
 * from the fleet at request time, and until a card said so an operator had no way
 * to tell which of the two they were looking at.
 *
 * ## Every control here is a `components/md3` primitive
 *
 * `TextField`, `TextArea` and `Select` — never a bare `<input>` in an ad-hoc
 * `.field` wrapper. The console's pre-Material-3 form classes (`.field`,
 * `.hint`, `.checks`, `.check`, `.slug`, `.version`, `.kv`) each hand-set a
 * `font-size` and several set a colour, which is precisely what the contrast
 * audit in `e2e/md3-tokens-logic.spec.ts` cannot see. There is no hand-set size,
 * no literal colour and no elevation in this file: the type scale is
 * `md3-*` classes, the surfaces are `Card`, and the only geometry this route
 * owns is in `compose.module.css`.
 *
 * The one thing the directory does not provide is a fieldset-and-legend group
 * for a question answered by many checkboxes; `ChoiceGroup.tsx` beside this file
 * composes the token layer for it rather than forking `Field`, and says so.
 *
 * ## The money
 *
 * Every figure comes from `quoteSelection` in `./quote`, which returns a quote or
 * an itemised refusal and never a zero standing in for one. Nothing in this file
 * does arithmetic on a price.
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
   *
   * Required on the TYPE and still checked at runtime: `quoteSelection` accepts
   * `OptionPrice | undefined` and reports what it finds, because `tsc`
   * guarantees the shape of a value and not its presence — a projection that
   * drops one field still compiles here and arrives as `undefined` there.
   */
  price: OptionPrice
}

type ComposeProblem = ComposeResult["problems"][number]

/** One row of the ledger preview: a priced line, or the total under them. */
interface LedgerRow {
  key: string
  option: string
  perSeat: string
  perOrg: string
  extended: string
  total: boolean
}

/**
 * The block that replaces a figure when there is no figure.
 *
 * Not an `EmptyState` and not a zero. `EmptyState` is the shape of "we looked and
 * there is nothing"; this is the shape of "this cannot be totalled, and that is
 * not the same as it being free". The headline, the remedy and the itemised
 * problems all come from `./quote` so the four refusals say four different
 * things — a refusal that reads the same however it failed is one nobody can act
 * on.
 *
 * `role="status"` is deliberately NOT set: this is rendered with the card, not
 * announced on a change, and `components/states.tsx` reserves the live region for
 * the governed state block.
 */
function Unpriceable({
  quote,
  what,
}: {
  quote: Extract<SelectionQuote, { state: "UNPRICEABLE" }>
  what: string
}) {
  return (
    <div className={styles.prose} data-testid="unpriceable" data-reason={quote.reason}>
      <p className="md3-title-small">{REFUSAL_HEADLINE[quote.reason]}</p>
      <p className="md3-body-medium">
        {what} is not shown as zero and not shown as a blank. Nothing here is free because this
        could not be computed.
      </p>
      <ul className={`${styles.problems} md3-body-small`}>
        {quote.problems.map((problem: QuoteProblem, index) => (
          <li key={`${problem.optionKey ?? "selection"}-${index}`}>{problem.detail}</li>
        ))}
      </ul>
      <p className="md3-body-medium">{REFUSAL_REMEDY[quote.reason]}</p>
    </div>
  )
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
  isolationClasses,
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
  /**
   * The isolation classes, from `ISOLATION_CLASSES`, each with what it means.
   *
   * From the closed vocabulary rather than four `<option>` literals, for the
   * same reason as the profiles above: a literal list is one the server can
   * start refusing without the form noticing.
   */
  isolationClasses: Array<{ id: string; meaning: string }>
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
   * relationship to the blueprint select above them, so the preset
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

  /*
   * Plan, region and isolation are controlled too.
   *
   * Not for validation — the server decides all three — but because the summary
   * at the top has to be able to say WHAT IS ABOUT TO BE CREATED, and a panel
   * that reads the blueprint out of state while reading the plan out of nowhere
   * answers half the question. An uncontrolled select is a decision the summary
   * cannot see.
   */
  const [planId, setPlanId] = useState(defaultPlanId)
  const [region, setRegion] = useState(
    placement.state === "OFFERED" ? placement.regions[0] : "",
  )
  const [isolation, setIsolation] = useState(isolationClasses[0]?.id ?? "")
  const [coexistence, setCoexistence] = useState(coexistenceProfiles[0]?.id ?? "")

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
    enableable.get(key) !== false &&
    (added.includes(key) || (preset.has(key) && !removed.includes(key)))

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
   * The seat count is an INPUT rather than an assumption, and it is held as the
   * string the operator typed rather than as a coerced number: `Number("")` is
   * `0` and `Number("abc")` is `NaN`, so coercing quoted the whole configuration
   * at zero seats — a real figure answering a question nobody had answered — or
   * at `NaN`, which propagates silently all the way to a rendered total.
   * `parseSeats` returns the number or the reason there isn't one.
   *
   * Per-seat and per-organization are different prices and both matter: quote
   * only the first and a two-hundred-officer faculty is charged like a
   * two-person club; quote only the second and the reverse.
   */
  const [seatsText, setSeatsText] = useState("25")
  const parsedSeats = parseSeats(seatsText)
  const seats = parsedSeats.ok ? parsedSeats.seats : null

  const selected = modules.filter((m) => checked(m.key))

  /*
   * The quote, or the itemised reason there is none.
   *
   * Through `quoteSelection` rather than `activationPreview` directly. The
   * pricing engine REFUSES — a mixed-currency selection throws
   * `CurrencyMismatchError`, an unusable price throws `PriceError` — and both
   * were previously thrown during the render of this component, with no
   * boundary under them. The composer did not show a wrong price; it showed
   * nothing at all, on the surface whose job is to state a price before a
   * decision is taken.
   */
  const quote: SelectionQuote = useMemo(
    () =>
      quoteSelection(
        selected.map((m) => ({ optionKey: m.key, price: m.price })),
        // `-1` rather than `0` when the seat count is not a whole number of
        // people: zero is a seat count somebody could have meant, and this must
        // not be mistaken for one. `quoteSelection` refuses it and names why.
        seats ?? -1,
      ),
    // `checked` closes over added/removed/preset, which is what makes the total
    // move when a checkbox does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules, seats, added, removed, preset],
  )

  const extendedFor = (key: string) =>
    quote.state === "QUOTED"
      ? quote.preview.quote.lines.find((l) => l.optionKey === key)?.extendedMinor ?? null
      : null

  const problemsFor = (field: string) => (result?.problems ?? []).filter((p) => p.field === field)
  /**
   * The server's complaints about one field, as the one `errorText` a
   * `components/md3` control takes.
   *
   * Joined rather than listed, because the frame renders a single line and the
   * details are sentences. `undefined` rather than `""` when there are none: the
   * presence of the message is what marks the control invalid, so an empty
   * string would outline a valid field in the error colour.
   */
  const errorFor = (field: string): string | undefined => {
    const problems = problemsFor(field)
    return problems.length ? problems.map((p: ComposeProblem) => p.detail).join(" ") : undefined
  }

  const enableableCount = modules.filter((m) => m.enableable).length
  const refusal = placementRefusal(placement)
  const placeable = canPlace(placement)

  const ledgerRows: LedgerRow[] =
    quote.state === "QUOTED"
      ? [
          ...quote.preview.quote.lines.map((line) => ({
            key: line.optionKey,
            option: line.optionKey,
            perSeat: priceLabel(line.perSeatMinor, quote.preview.quote.currency),
            perOrg: priceLabel(line.perOrgMinor, quote.preview.quote.currency),
            extended: priceLabel(line.extendedMinor, quote.preview.quote.currency),
            total: false,
          })),
          {
            key: "__total",
            option: "Total, per month",
            perSeat: "",
            perOrg: "",
            extended: priceLabel(
              quote.preview.quote.runningTotalMinor,
              quote.preview.quote.currency,
            ),
            total: true,
          },
        ]
      : []

  /* ── The answer, in words, before the apparatus ─────────────────────────
   *
   * Four facts, in the order the question asks them: what this is, what it
   * costs, what is not settled, and where it would run. Through `KeyValue`
   * rather than a hand-built `<dl>`, so a long region name or module key wraps
   * inside its column instead of setting the column's minimum width and pushing
   * the panel past the viewport at 320 CSS pixels.
   */
  const totalText: ReactNode =
    quote.state === "QUOTED"
      ? priceLabel(quote.preview.quote.runningTotalMinor, quote.preview.quote.currency)
      : "Cannot be totalled"

  const summary: KeyValueItem[] = [
    {
      key: "what",
      term: "What this will be",
      /*
       * Every emphasised fact is a `.token` — see the note in the stylesheet.
       * These are identifiers (`university-student-organizations`,
       * `institution`), they are set inside a sentence that wraps, and a plain
       * `<b>` split across a line boundary covers the facts either side of it.
       */
      value: (
        <>
          One tenant system on the <b className={styles.token}>{blueprintId || "unnamed"}</b>{" "}
          blueprint, operating as{" "}
          <b className={styles.token}>{operatingModel || "unstated"}</b> for a{" "}
          <b className={styles.token}>{organization || "unstated"}</b> organisation, running{" "}
          <b className={styles.token}>{selected.length}</b> of {modules.length} catalog module(s)
          across {suites.length} functional suite(s), contracted on{" "}
          <b className={styles.token}>{planId || "no plan"}</b>, isolated as{" "}
          <b className={styles.token}>{isolation || "unstated"}</b>.
        </>
      ),
    },
    {
      key: "cost",
      term: "List price if activated today",
      value: (
        <>
          <b className={styles.token} data-testid="running-total-amount">
            {totalText}
          </b>{" "}
          {quote.state === "QUOTED" ? (
            <>
              per month — {quote.preview.quote.lines.length} option(s) at{" "}
              {quote.preview.quote.seatCount} seat(s), per-organization plus per-seat. List price
              for the configuration below, not a contracted price.
            </>
          ) : (
            <>
              — {REFUSAL_HEADLINE[quote.reason]}. It is not zero. The Ledger preview at the end of
              this form names every option at fault.
            </>
          )}
        </>
      ),
    },
    {
      key: "open",
      term: "Before it could be activated",
      value:
        quote.state !== "QUOTED"
          ? "Unknown, because the disclosures are computed from the quote and there is no quote. Nothing here says the configuration is ready."
          : quote.preview.readyToActivate
            ? "Nothing is open. Each of the seven disclosures below carries where it was decided."
            : `${quote.preview.openTopics.length} of ${quote.preview.disclosures.length} disclosures are open, and none of them is defaulted. They are listed at the end of this form with what would record each one.`,
    },
    {
      key: "where",
      term: "Where it would run",
      value:
        placement.state === "OFFERED" && region
          ? `${region} — ${placementSummary(placement)}`
          : placementSummary(placement),
    },
    {
      key: "asof",
      term: "As of",
      value: (
        <>
          Blueprint, module, plan, isolation and coexistence catalogs as compiled into this build,
          engine <code className={styles.token}>{engineVersion}</code>. Fleet read at{" "}
          <code className={styles.token}>{fleetReadAt}</code>. The quote is recomputed on this
          device as the form changes.
        </>
      ),
    },
  ]

  return (
    <form action={action} className={styles.form}>
      {/* Sticky rather than a footer: the price of a composition has to be
          visible WHILE the composition is being made, not discovered after the
          last stage. */}
      <div data-testid="running-total" className={styles.summary}>
        <Card
          headline="This composition"
          headerAside={
            <Badge
              tone={quote.state === "QUOTED" && quote.preview.readyToActivate ? "ok" : "warn"}
              title="Whether every pre-activation disclosure has been settled. Registering in DRAFT does not require it; activating does."
            >
              {quote.state !== "QUOTED"
                ? "not quoted"
                : quote.preview.readyToActivate
                  ? "every disclosure settled"
                  : `${quote.preview.openTopics.length} undecided`}
            </Badge>
          }
          supportingText="Registering puts this tenant in DRAFT. Nothing is built, nothing is billed and no routing changes — provisioning is a separate, approved step taken from the tenant's own page once its plan has been read."
          container="high"
          level={1}
        >
          <KeyValue items={summary} ariaLabel="What this composition is and what it would cost" />

          {/* Full width, like every other control here. `TextField` omits
              `className` from its props on purpose — a caller that can restyle
              the input is a caller that can put a colour on it — and bounding
              the frame instead would squeeze this field's supporting sentence
              into a twelve-rem column. */}
          <TextField
            id="seatCount"
            name="seatCount"
            label="Seats"
            inputMode="numeric"
            value={seatsText}
            onChange={(e) => setSeatsText(e.target.value)}
            supportingText="How many people hold a seat. Per-seat and whole-organization charges are quoted separately below because they behave differently: a ledger costs the same for ten officers and two hundred, and messaging does not. This figure prices the composition; it is not part of the registered manifest, which records no seat count."
            errorText={parsedSeats.ok ? undefined : parsedSeats.detail}
          />
        </Card>
      </div>

      <Card
        headline="Identity"
        supportingText="What this tenant is called, in the URL, in the contract and on screen."
      >
        <p className="md3-body-small">
          As of now: nothing here is read from anywhere. These are the values you are supplying,
          and the slug is the only one that is expensive to change afterwards.
        </p>

        <TextField
          id="slug"
          name="slug"
          label="Slug"
          required
          autoComplete="off"
          placeholder="midtown-arts"
          supportingText="Becomes platform.tenurework.com/<slug> and part of resource names. Changing it later is a migration."
          errorText={errorFor("slug")}
        />

        <TextField
          id="legalName"
          name="legalName"
          label="Legal name"
          required
          placeholder="Midtown Arts Collective"
          supportingText="The entity this system belongs to."
          errorText={errorFor("legalName")}
        />

        <TextField
          id="displayName"
          name="displayName"
          label="Display name"
          required
          placeholder="Midtown Arts"
          supportingText="What its users see."
          errorText={errorFor("displayName")}
        />
      </Card>

      <Card
        headline="Blueprint and archetype"
        supportingText="The preset, and the point on each axis the engine will compile the system from."
      >
        <p className="md3-body-small">
          As of engine <code>{engineVersion}</code>: {blueprints.length} blueprint(s) and{" "}
          {axes.length} axes, read from the catalog compiled into this build. A blueprint supplies
          the starting position on every axis; one axis moved is a genuinely different system rather
          than a fourth blueprint (PACK-020-001, PACK-GATE-020).
        </p>

        <Select
          id="blueprintId"
          name="blueprintId"
          label="Blueprint"
          required
          value={blueprintId}
          onChange={(e) => onBlueprint(e.target.value)}
          options={blueprints.map((b) => ({ value: b.id, label: b.id }))}
          supportingText="The preset. It supplies the starting position on every axis below and the modules that follow from them — all of which you can then change."
          errorText={errorFor("blueprintId")}
        />

        {axes.map((axis) =>
          axis.cardinality === "one" ? (
            <Select
              key={axis.id}
              id={`archetype.${axis.id}`}
              name={`archetype.${axis.id}`}
              label={axis.label}
              required
              value={axis.id === "organization" ? organization : operatingModel}
              onChange={(e) =>
                axis.id === "organization"
                  ? setOrganization(e.target.value)
                  : setOperatingModel(e.target.value)
              }
              options={axis.values.map((v) => ({ value: v.id, label: `${v.label} — ${v.description}` }))}
              supportingText={axis.effect}
              errorText={errorFor(`archetype.${axis.id}`)}
            />
          ) : (
            <ChoiceGroup
              key={axis.id}
              id={`archetype.${axis.id}`}
              legend={axis.label}
              supportingText={axis.effect}
              errorText={errorFor(`archetype.${axis.id}`)}
            >
              {axis.values.map((v) => (
                <Choice
                  key={v.id}
                  name={`archetype.${axis.id}`}
                  value={v.id}
                  checked={suites.includes(v.id)}
                  onChange={() =>
                    setSuites((s) => (s.includes(v.id) ? s.filter((x) => x !== v.id) : [...s, v.id]))
                  }
                >
                  <span className="md3-label-large">{v.label}</span>
                  <span className="md3-body-small">{v.description}</span>
                </Choice>
              ))}
            </ChoiceGroup>
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
        <p className="md3-body-small">
          As of engine <code>{engineVersion}</code>: the module catalog compiled into this build,
          with each manifest&rsquo;s own list price and lifecycle carried through. A module the
          resolver would refuse is shown with the lifecycle that refuses it rather than being
          hidden, because an option absent from a list is indistinguishable from one that does not
          exist.
        </p>

        <ChoiceGroup
          id="modules"
          legend="Modules"
          supportingText="Ticking or unticking one records a per-module edit against the preset, which is what a suite cannot express."
          errorText={errorFor("modules")}
        >
          {modules.map((m) => {
            /* PAY-160-002 — per SEAT and per ORG, beside every option, always
               both. An option whose price cannot be resolved says so here; it
               is never blank and never zero. */
            const statement = optionPriceStatement(m.key, m.price, seats, extendedFor(m.key))
            return (
              <Choice
                key={m.key}
                checked={checked(m.key)}
                disabled={!m.enableable}
                onChange={() => toggle(m.key)}
              >
                <span className={`${styles.choiceName} md3-label-large`}>
                  {m.key}
                  <Chip title="The manifest version compiled into this build">v{m.version}</Chip>
                  <Chip
                    selected={m.enableable}
                    title={
                      m.enableable
                        ? "The resolver accepts this lifecycle."
                        : "The resolver refuses this lifecycle."
                    }
                  >
                    {m.lifecycle}
                  </Chip>
                </span>
                {!m.enableable && (
                  <span className="md3-body-small">
                    Cannot be enabled: lifecycle is &ldquo;{m.lifecycle}&rdquo;.
                  </span>
                )}
                {m.enableable && preset.has(m.key) && !checked(m.key) && (
                  <span className="md3-body-small">Removed from the preset.</span>
                )}
                {m.enableable && !preset.has(m.key) && checked(m.key) && (
                  <span className="md3-body-small">Added to the preset.</span>
                )}
                <span
                  className="md3-body-small"
                  data-testid={`price-${m.key}`}
                  data-price-state={statement.state}
                >
                  {statement.text}
                </span>
                <span className="md3-body-small">{m.description}</span>
              </Choice>
            )
          })}
        </ChoiceGroup>

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
      </Card>

      {/* Entitlements are a consequence of the contracted plan, not free
          text. Typed, every tenant's commercial state was a typing exercise:
          a typo was a silently missing feature and there was nothing to
          reconcile an invoice against (GE-030-004). */}
      <Card
        headline="Plan"
        supportingText="What was contracted. Entitlements and quotas follow from it, and a module the plan does not grant is refused rather than quietly dropped."
      >
        <p className="md3-body-small">
          As of engine <code>{engineVersion}</code>: {plans.length} plan(s) from the catalog
          compiled into this build. The plan this opens on is not a literal — it is the first one
          whose entitlements let the default preset resolve, decided on the server by the same
          resolver the action refuses with.
        </p>

        <Select
          id="planId"
          name="planId"
          label="Plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={plans.map((p) => ({ value: p.planId, label: `${p.displayName} — ${p.grants}` }))}
          supportingText="What was contracted. Entitlements and quotas follow from it."
          errorText={errorFor("planId")}
        />
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
        <p className="md3-body-small">
          As of <code>{fleetReadAt}</code>: read from the cell registry on the server, for this
          request. Not a hard-coded list — a hard-coded list lets an operator pick a region no cell
          serves, and placement then refuses with &ldquo;no cell in your residency&rdquo;, which is
          a confusing way to learn the list was a guess.
        </p>

        {placement.state === "OFFERED" ? (
          <Select
            id="region"
            name="region"
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={placement.regions.map((r) => ({ value: r, label: r }))}
            errorText={errorFor("region")}
          />
        ) : (
          /*
           * STUDIO-000-007. Unknown is not empty, and neither is a refusal.
           *
           * The page used to call `placeableRegions()` bare, and that function
           * throws rather than inventing an estate — so a console with no AWS
           * credentials served a 500 here. It now renders WHICH of the three
           * things happened, and what would fix it, and it does not offer a
           * region control there is no fleet behind.
           *
           * Not `role="status"`. `components/states.tsx` reserves the live
           * region for the governed state block; this panel is rendered with the
           * page, and announcing a static refusal every time the page settles is
           * how a screen reader is trained to ignore one.
           */
          <div className={styles.prose} data-testid="placement-refusal">
            <p className="md3-title-small">{refusal?.headline}</p>
            <p className="md3-body-medium">{refusal?.detail}</p>
            <p className="md3-body-medium">{refusal?.remedy}</p>
            {placement.state === "UNKNOWN" && (
              <KeyValue
                /* Arm-neutral. This list renders for BOTH `UNKNOWN` reasons, so
                   a label naming one of them — "could not be described" — put
                   the misconfigured arm's own words into the unreadable arm's
                   markup, which is exactly the "four states, one answer" defect
                   `placement.test.tsx` measures. */
                ariaLabel="What the cell registry read reported"
                items={placement.problems.map((p) => ({
                  key: p.field,
                  term: p.field,
                  value: p.detail,
                }))}
              />
            )}
          </div>
        )}

        <Select
          id="isolation"
          name="isolation"
          label="Isolation"
          value={isolation}
          onChange={(e) => setIsolation(e.target.value)}
          options={isolationClasses.map((i) => ({ value: i.id, label: `${i.id} — ${i.meaning}` }))}
          supportingText="Pooled shares the cell's database and cluster; isolation is the application's tenant scope. Each class carries what it means, from the same closed vocabulary the server validates against."
          errorText={errorFor("isolation")}
        />
      </Card>

      {/* PACK-020-004. Separate from Placement on purpose: placement is where
          Tenure runs, this is who is allowed to write. A `pooled` tenant can be
          authoritative for everything and a `silo` tenant for nothing. */}
      <Card
        headline="Coexistence"
        supportingText="How this system sits beside whatever the customer already runs, and which side writes what."
      >
        <p className="md3-body-small">
          As of engine <code>{engineVersion}</code>: {coexistenceProfiles.length} profile(s) and{" "}
          {businessDomains.length} business domain(s), from the closed vocabularies the server
          validates against — so this form cannot offer a profile or a domain the server refuses.
          Customer on-premise estates and other clouds are external systems, not Tenure deployment
          targets.
        </p>

        <Select
          id="coexistence"
          name="coexistence"
          label="Profile"
          value={coexistence}
          onChange={(e) => setCoexistence(e.target.value)}
          options={coexistenceProfiles.map((p) => ({ value: p.id, label: `${p.id} — ${p.meaning}` }))}
          supportingText="How this system sits beside whatever the customer already runs."
          errorText={errorFor("coexistence")}
        />

        <ChoiceGroup
          id="systemOfRecord"
          legend="Domains an external system owns"
          supportingText="Exactly one system writes a domain's facts. A module that writes a domain ticked here is refused — dual write is prohibited, and buying the entitlement would not change that."
          errorText={errorFor("systemOfRecord")}
        >
          {businessDomains.map((domain) => (
            <Choice key={domain} name="externalDomains" value={domain}>
              <span className="md3-label-large">{domain}</span>
              <span className="md3-body-small">
                unticked means Tenure is authoritative for {domain}
              </span>
              {/* Every option on every stage carries a price statement, and for
                  these the true one is that they carry no charge. A blank here
                  would read as an unpriced option; the sentence says which side
                  of the quote it is on. */}
              <span className="md3-body-small" data-testid={`price-domain-${domain}`}>
                {DOMAIN_PRICE_NOTE}
              </span>
            </Choice>
          ))}
        </ChoiceGroup>

        {/* WRK-020-004. The grain below the domain. A domain map answers who
            writes finance; it cannot answer which side writes an invoice's
            internal note, and a bidirectional profile with no direction on it
            cannot state which side may write which field at all. Free text
            rather than a widget because an object is a record name and a field
            is one of its columns — neither is a list this console can hold. */}
        <TextArea
          id="objectAuthority"
          name="objectAuthority"
          label="Object and field authority (optional)"
          rows={4}
          spellCheck={false}
          placeholder={"finance.Invoice external INBOUND\nfinance.Invoice.internalNote tenure"}
          supportingText="One per line. `finance.Invoice external INBOUND` says the customer's system writes it and Tenure receives a copy. `finance.Invoice.internalNote tenure` says that one field is ours. An object may not disagree with its domain above, and BIDIRECTIONAL is refused outside COEXISTENCE_TRANSITION and HYBRID_PROCESS_SPLIT."
          errorText={errorFor("objectAuthority")}
        />
      </Card>

      <Card
        headline="First administrator"
        supportingText="Who can sign in once it is provisioned. A system nobody can sign into is not deployed."
      >
        <p className="md3-body-small">
          As of now: nothing here is read from anywhere. Provisioning creates exactly one
          invitation, to the address below.
        </p>

        <TextField
          id="initialAdminEmail"
          name="initialAdminEmail"
          type="email"
          label="Email"
          required
          supportingText="Provisioning creates exactly one invitation."
          errorText={errorFor("initialAdminEmail")}
        />

        <TextArea
          id="notes"
          name="notes"
          label="Notes"
          rows={3}
          supportingText="Shown on the plan."
          errorText={errorFor("notes")}
        />
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
          were activated today — so when there is no quote, there are no
          disclosures either, and this says so rather than showing six
          reassuring rows. */}
      <div data-testid="pre-activation">
        <Card
          headline="Before activation"
          headerAside={
            <Badge tone={quote.state === "QUOTED" && quote.preview.readyToActivate ? "ok" : "warn"}>
              {quote.state !== "QUOTED"
                ? "not computed"
                : quote.preview.readyToActivate
                  ? "every disclosure settled"
                  : `${quote.preview.openTopics.length} undecided`}
            </Badge>
          }
          supportingText="Registering in DRAFT commits to none of this. Provisioning is a separate, approved step, and it must not be taken while anything below is open — a system that takes money before its merchant of record, funds flow and loss responsibility are settled is one nobody can say who is liable for."
        >
          <p className="md3-body-small">
            As of this composition, recomputed as it changes. Six of the seven are decisions no code
            can make, so each open one names the artefact that would record it rather than showing a
            default.
          </p>

          {quote.state !== "QUOTED" ? (
            <Unpriceable quote={quote} what="The pre-activation disclosure set" />
          ) : (
            <DataTable
              caption="Pre-activation disclosures"
              rows={quote.preview.disclosures}
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
                      <span className="md3-body-small">
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
          )}
        </Card>
      </div>

      <Card
        headline="Ledger preview"
        supportingText="Exactly what would be posted, per month, if this configuration were activated today."
      >
        {quote.state !== "QUOTED" ? (
          <Unpriceable quote={quote} what="The monthly charge" />
        ) : (
          <>
            <p className="md3-body-small">
              As of this composition, at {quote.preview.quote.seatCount} seat(s), in{" "}
              {quote.preview.quote.currency}. Every line is the manifest&rsquo;s own list price in
              whole minor units with no proration applied.
            </p>

            <DataTable
              caption={`Monthly charge lines at ${quote.preview.quote.seatCount} seat(s)`}
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
                  header: `At ${quote.preview.quote.seatCount} seats`,
                  align: "end",
                  cell: (row) =>
                    row.total ? <b data-testid="ledger-preview-total">{row.extended}</b> : row.extended,
                },
              ]}
              empty={
                <EmptyState
                  headline="No option carries a charge yet"
                  description="Nothing selected above has a per-seat or per-organization price, so there is no line to post. That is a statement about the selection, not a discount."
                />
              }
            />
          </>
        )}
      </Card>

      {(result?.problems.length ?? 0) > 0 && (
        <p className="md3-field-error md3-body-medium">
          <span className="md3-field-error-word">Error</span> {result!.problems.length} problem
          {result!.problems.length === 1 ? "" : "s"} — nothing was registered.
        </p>
      )}

      {!placeable && (
        <p className="md3-field-error md3-body-medium">
          <span className="md3-field-error-word">Error</span> Composing is disabled:{" "}
          {placementSummary(placement)} A manifest with no region is refused by the server, so this
          form will not submit one.
        </p>
      )}

      {quote.state !== "QUOTED" && placeable && (
        <p className="md3-body-medium">
          Registering is still allowed: a DRAFT tenant is billed for nothing, so a configuration
          that cannot be quoted can still be recorded. It must not be ACTIVATED until the problems
          named above are resolved — nothing on this page knows what it would cost.
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
