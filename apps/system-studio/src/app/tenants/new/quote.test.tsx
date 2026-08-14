import { renderToStaticMarkup } from "react-dom/server"

import {
  ARCHETYPE_AXES,
  ALWAYS_ON_MODULES,
  BLUEPRINTS,
  FUNCTIONAL_SUITES,
  compileArchetype,
} from "@tenure/blueprints"
import { ENABLEABLE } from "@tenure/module-runtime"
import { MODULE_CATALOG } from "@tenure/modules"
import type { OptionPrice } from "@tenure/finops"

import {
  REFUSAL_HEADLINE,
  REFUSAL_REMEDY,
  optionPriceStatement,
  parseSeats,
  quoteSelection,
} from "./quote"

/**
 * PAY-160-002 — an option whose price cannot be resolved SAYS SO, and is never
 * silently priced at zero.
 *
 * ## What was wrong
 *
 * `ComposeForm` called `activationPreview` inside a `useMemo` with nothing under
 * it. That function refuses rather than guesses — `PriceError` for an unusable
 * price, `CurrencyMismatchError` for a selection that spans two currencies — and
 * both refusals were thrown during the render of a client component. The
 * composer did not show a wrong price. It showed NOTHING: the surface whose
 * entire job is to state a cost before a decision is taken came down with the
 * exception.
 *
 * Every module in `MODULE_CATALOG` is USD today and `ModuleCatalog.of` validates
 * each manifest's price at construction, so none of those refusals fires in
 * production right now. That is exactly why this file exists: the arms cannot be
 * reached by configuration, they can only be reached by a test, and until one
 * reached them the failure mode was a blank page nobody had ever seen.
 *
 * ## What is asserted, and against what
 *
 * The happy path is driven by the REAL catalog — the same projection `page.tsx`
 * makes — so a repricing that breaks quoting reds here. The refusals are driven
 * by that same catalog with ONE field changed, which is the smallest difference
 * that reaches the arm, and each is asserted twice: on the union `quoteSelection`
 * returns, and on the MARKUP the composer emits, because a pure function that
 * returns the right union and a page that renders `$0.00` anyway is the defect
 * this is about.
 */

jest.mock("../actions", () => ({
  composeTenant: async () => null,
}))

// eslint-disable-next-line import/first -- after the mock, deliberately: the form
// imports the server action at module scope.
import { ComposeForm } from "./ComposeForm"

/** Exactly the projection `page.tsx` makes. */
const modules = MODULE_CATALOG.all().map((m) => ({
  key: m.key,
  description: m.description,
  version: m.version,
  lifecycle: m.lifecycle,
  enableable: ENABLEABLE.has(m.lifecycle),
  price: m.price,
}))

type ComposeModuleShape = (typeof modules)[number]

const blueprints = BLUEPRINTS.map((b) => ({ id: b.id, axes: b.axes }))

const suiteModules = Object.fromEntries(
  FUNCTIONAL_SUITES.map((suite) => [
    suite,
    compileArchetype({
      organization: blueprints[0].axes.organization,
      operatingModel: blueprints[0].axes.operatingModel,
      functional: [suite],
    }).modules.filter((key) => !ALWAYS_ON_MODULES.includes(key)),
  ]),
)

/** The preset the form opens on — every module it starts with ticked. */
function presetKeys(): string[] {
  const keys = new Set<string>(ALWAYS_ON_MODULES)
  for (const suite of blueprints[0].axes.functional) {
    for (const key of suiteModules[suite] ?? []) keys.add(key)
  }
  return [...keys].filter((key) => modules.find((m) => m.key === key)?.enableable === true)
}

/**
 * The catalog with one module's price replaced.
 *
 * A key from the PRESET, so the module is ticked when the form opens and the
 * broken price is therefore inside the selection being quoted. Replacing an
 * unticked module's price would leave the total correct and prove nothing.
 */
function catalogWith(price: OptionPrice | undefined): {
  modules: ComposeModuleShape[]
  key: string
} {
  const key = presetKeys()[0]
  expect(key).toBeTruthy()
  return {
    key,
    modules: modules.map((m) =>
      m.key === key ? ({ ...m, price: price as OptionPrice } as ComposeModuleShape) : m,
    ),
  }
}

function renderComposer(withModules: ComposeModuleShape[]): string {
  return renderToStaticMarkup(
    <ComposeForm
      blueprints={blueprints}
      modules={withModules}
      plans={[{ planId: "institution", displayName: "Institution", grants: "finance" }]}
      defaultPlanId="institution"
      placement={{ state: "OFFERED", regions: ["us-east-1"] }}
      engineVersion="0.0.0-test"
      fleetReadAt="2026-01-01T00:00:00.000Z"
      alwaysOnModules={[...ALWAYS_ON_MODULES]}
      suiteModules={suiteModules}
      coexistenceProfiles={[{ id: "TENURE_CLOUD_PRIMARY", meaning: "Tenure is authoritative" }]}
      isolationClasses={[{ id: "pooled", meaning: "shares the cell" }]}
      businessDomains={["finance", "hr"]}
      axes={ARCHETYPE_AXES.map((axis) => ({
        id: axis.id,
        label: axis.label,
        cardinality: axis.cardinality,
        effect: axis.effect,
        values: axis.values.map((v) => ({ id: v.id, label: v.label, description: v.description })),
      }))}
    />,
  )
}

/** What the summary panel prints as the running total. */
function renderedTotal(html: string): string {
  return /data-testid="running-total-amount"[^>]*>([^<]*)</.exec(html)?.[1] ?? ""
}

/** The price sentence beside one module's checkbox. */
function renderedPrice(html: string, key: string): string {
  return new RegExp(`data-testid="price-${key}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? ""
}

/** The `data-price-state` the form attributed to one module's price. */
function renderedPriceState(html: string, key: string): string {
  return (
    new RegExp(`data-testid="price-${key}"[^>]*data-price-state="([^"]*)"`).exec(html)?.[1] ?? ""
  )
}

/** The seat count the form opens on, and the count the assertions below use. */
const SEATS = 25

describe("the real catalog quotes", () => {
  it("returns a quote for the preset, in one currency, from the manifests' own prices", () => {
    const selected = modules
      .filter((m) => presetKeys().includes(m.key))
      .map((m) => ({ optionKey: m.key, price: m.price }))

    const quote = quoteSelection(selected, SEATS)

    expect(quote.state).toBe("QUOTED")
    if (quote.state !== "QUOTED") throw new Error("unreachable")

    // Derived from the same manifests, so a repricing moves both — and the
    // concrete figure is pinned in `compose-pricing.test.tsx`, which is what
    // stops that from being vacuous.
    const expected = selected.reduce(
      (running, o) => running + o.price.perOrgMinor + o.price.perSeatMinor * SEATS,
      0,
    )
    expect(expected).toBeGreaterThan(0)
    expect(quote.preview.quote.runningTotalMinor).toBe(expected)
    expect(quote.preview.quote.seatCount).toBe(SEATS)
  })
})

describe("a price that cannot be resolved is not zero", () => {
  it("refuses a selection that spans two currencies, and names both options", () => {
    const { key, modules: mixed } = catalogWith({
      perSeatMinor: 500,
      perOrgMinor: 0,
      currency: "EUR",
      rounding: "half-up",
    })

    const quote = quoteSelection(
      mixed.filter((m) => presetKeys().includes(m.key)).map((m) => ({ optionKey: m.key, price: m.price })),
      SEATS,
    )

    expect(quote.state).toBe("UNPRICEABLE")
    if (quote.state !== "UNPRICEABLE") throw new Error("unreachable")
    expect(quote.reason).toBe("MIXED_CURRENCY")
    // Every option is named with its currency, so the operator can see WHICH
    // one disagrees rather than being handed a two-code exception message.
    expect(quote.problems.map((p) => p.optionKey)).toContain(key)
    expect(quote.problems.some((p) => p.detail.includes("EUR"))).toBe(true)
    expect(quote.problems.some((p) => p.detail.includes("USD"))).toBe(true)
  })

  it("renders the whole composer rather than throwing out of it, and shows no total", () => {
    const { modules: mixed } = catalogWith({
      perSeatMinor: 500,
      perOrgMinor: 0,
      currency: "EUR",
      rounding: "half-up",
    })

    // The render itself is the assertion this test exists for: before
    // `quoteSelection`, `CurrencyMismatchError` came out of here.
    const html = renderComposer(mixed)

    // The page is still a page.
    expect(html).toContain("This composition")
    expect(html).toContain("Register in DRAFT")

    // And the figure is a refusal, not a number, and specifically not zero.
    expect(renderedTotal(html)).toBe("Cannot be totalled")
    expect(renderedTotal(html)).not.toContain("0.00")
    expect(html).toContain('data-testid="unpriceable"')
    expect(html).toContain('data-reason="MIXED_CURRENCY"')

    // The disclosures are computed FROM the quote, so there is no quote and no
    // disclosure set — and the panel says so rather than showing six
    // reassuring rows.
    expect(html).toContain("not computed")
    expect(html).not.toContain("every disclosure settled")
  })

  it("refuses a module whose price never arrived, and does not price it at zero", () => {
    const { key, modules: broken } = catalogWith(undefined)

    const quote = quoteSelection(
      broken.filter((m) => presetKeys().includes(m.key)).map((m) => ({ optionKey: m.key, price: m.price })),
      SEATS,
    )

    expect(quote.state).toBe("UNPRICEABLE")
    if (quote.state !== "UNPRICEABLE") throw new Error("unreachable")
    expect(quote.reason).toBe("OPTION_PRICE")
    expect(quote.problems[0].optionKey).toBe(key)
    expect(quote.problems[0].detail).toContain("declares no price")

    const html = renderComposer(broken)
    expect(renderedTotal(html)).toBe("Cannot be totalled")
    expect(renderedPriceState(html, key)).toBe("UNPRICEABLE")
    expect(renderedPrice(html, key)).toContain("Price cannot be resolved")
    // The sentence must say it is not free, because a checkbox with no figure
    // beside it on a form with a running total reads as free.
    expect(renderedPrice(html, key)).toContain("not free")
  })

  it("refuses zero on both axes with no reason, because zero is a statement", () => {
    const { key, modules: free } = catalogWith({
      perSeatMinor: 0,
      perOrgMinor: 0,
      currency: "USD",
      rounding: "half-up",
      // No `includedBecause`. `validateManifest` refuses this in the catalog;
      // this asserts the surface refuses it too, because the surface is where
      // "free" would be read.
    })

    const quote = quoteSelection(
      free.filter((m) => presetKeys().includes(m.key)).map((m) => ({ optionKey: m.key, price: m.price })),
      SEATS,
    )
    expect(quote.state).toBe("UNPRICEABLE")
    if (quote.state !== "UNPRICEABLE") throw new Error("unreachable")
    expect(quote.reason).toBe("OPTION_PRICE")
    expect(quote.problems.some((p) => p.detail.includes("states no reason"))).toBe(true)

    const statement = optionPriceStatement(key, free.find((m) => m.key === key)!.price, SEATS, null)
    expect(statement.state).toBe("UNPRICEABLE")
    expect(statement.text).toContain("Price cannot be resolved")
  })

  it("prices zero on both axes WITH a reason as included, not as unpriceable", () => {
    const statement = optionPriceStatement(
      "platform.something",
      {
        perSeatMinor: 0,
        perOrgMinor: 0,
        currency: "USD",
        rounding: "half-up",
        includedBecause: "every system runs it and it is not separately sellable",
      },
      SEATS,
      null,
    )
    expect(statement.state).toBe("INCLUDED")
    expect(statement.text).toContain("Included at no charge")
    expect(statement.text).toContain("not separately sellable")
  })

  it("states both axes and the extension for a priced option", () => {
    const statement = optionPriceStatement(
      "finance.ledger",
      { perSeatMinor: 400, perOrgMinor: 9900, currency: "USD", rounding: "half-up" },
      10,
      null,
    )
    expect(statement.state).toBe("PRICED")
    expect(statement.text).toContain("$4.00 per seat")
    expect(statement.text).toContain("$99.00 per organization")
    // 9900 + 400 x 10 = 13900.
    expect(statement.text).toContain("$139.00 at 10 seat(s)")
  })
})

describe("the seat count is parsed, not coerced", () => {
  it("accepts a whole non-negative number", () => {
    expect(parseSeats("250")).toEqual({ ok: true, seats: 250 })
    expect(parseSeats(" 0 ")).toEqual({ ok: true, seats: 0 })
  })

  it("refuses blank rather than quoting the configuration at zero seats", () => {
    const parsed = parseSeats("")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("unreachable")
    expect(parsed.detail).toContain("blank")
  })

  it.each(["2.5", "-1", "abc", "1e3", "0x10", "٢٥"])("refuses %p", (raw) => {
    expect(parseSeats(raw).ok).toBe(false)
  })

  it("refuses a seat count NaN would have travelled through", () => {
    // The shape of the old bug: `Math.max(0, Number("abc"))` is `NaN`, and `NaN`
    // multiplies, sums and renders without ever announcing itself.
    const quote = quoteSelection([{ optionKey: "a", price: undefined }], Number.NaN)
    expect(quote.state).toBe("UNPRICEABLE")
    if (quote.state !== "UNPRICEABLE") throw new Error("unreachable")
    expect(quote.reason).toBe("SEAT_COUNT")
  })

  it("refuses an extension that would stop being exact", () => {
    const quote = quoteSelection(
      [
        {
          optionKey: "finance.ledger",
          price: { perSeatMinor: 400, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
        },
      ],
      Number.MAX_SAFE_INTEGER,
    )
    expect(quote.state).toBe("UNPRICEABLE")
    if (quote.state !== "UNPRICEABLE") throw new Error("unreachable")
    expect(quote.reason).toBe("SEAT_COUNT")
    expect(quote.problems[0].detail).toContain("exact")
  })
})

describe("the four refusals are four answers", () => {
  it("says four different things, and none of them is a shrug", () => {
    const headlines = Object.values(REFUSAL_HEADLINE)
    const remedies = Object.values(REFUSAL_REMEDY)

    expect(new Set(headlines).size).toBe(headlines.length)
    expect(new Set(remedies).size).toBe(remedies.length)

    for (const remedy of remedies) {
      // Long enough to name a next action, and never the two words that mean
      // "we did not think about this one".
      expect(remedy.length).toBeGreaterThan(60)
      expect(remedy.toLowerCase()).not.toContain("try again")
    }
    // Each headline states that there is no total, so a reader who sees only the
    // headline cannot mistake it for a figure.
    for (const headline of headlines) expect(headline).toContain("Cannot be totalled")
  })
})
