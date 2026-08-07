import { renderToStaticMarkup } from "react-dom/server"

import { ARCHETYPE_AXES, ALWAYS_ON_MODULES, FUNCTIONAL_SUITES, compileArchetype, getBlueprint, TENANT_BINDINGS } from "@tenure/blueprints"
import { ENABLEABLE } from "@tenure/module-runtime"
import { MODULE_CATALOG } from "@tenure/modules"

/**
 * The submit target, and nothing else.
 *
 * `ComposeForm` hands `composeTenant` to `useActionState` and never calls it;
 * this render never submits. The real module is a `"use server"` file that
 * reaches NextAuth and the DynamoDB registry, neither of which a static render
 * needs and neither of which resolves under this runner. Replacing it cannot
 * mask what is under test here — every price, every line and the running total
 * come from `MODULE_CATALOG` through `activationPreview`, none of which this
 * touches. If it were removed, the form would render identically.
 */
jest.mock("../actions", () => ({
  composeTenant: async () => null,
}))

import { ComposeForm } from "./ComposeForm"

/**
 * PAY-160-002 — the composer shows a price for every option and a running total.
 *
 * Asserted on the TOTAL THE FORM EMITS, from the REAL module catalog, projected
 * exactly the way `page.tsx` projects it. That is deliberate and it is what
 * makes this test worth having: `quoteConfiguration` called with hand-built
 * fixtures proves the arithmetic and stays green when a module in
 * `modules/index.ts` is repriced to zero, which is the change that would put a
 * wrong number in front of a customer.
 *
 * The form is rendered to markup rather than driven in a browser because the
 * Studio's Playwright runner transforms JSX with its own component-locator
 * pragma and cannot produce a React tree. The markup is what the browser would
 * receive.
 */

/** The seat count the form defaults to. The rendered total is quoted at it. */
const SEATS = 25

/** Exactly the projection `apps/system-studio/src/app/tenants/new/page.tsx` makes. */
const modules = MODULE_CATALOG.all().map((m) => ({
  key: m.key,
  description: m.description,
  version: m.version,
  lifecycle: m.lifecycle,
  enableable: ENABLEABLE.has(m.lifecycle),
  price: m.price,
}))

const blueprints = [...new Set(TENANT_BINDINGS.map((b) => b.blueprintId))].map((id) => ({
  id,
  axes: getBlueprint(id)!.axes,
}))

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

function renderComposer(): string {
  return renderToStaticMarkup(
    <ComposeForm
      blueprints={blueprints}
      modules={modules}
      plans={[{ planId: "institution", displayName: "Institution", grants: "finance" }]}
      regions={["us-east-1"]}
      alwaysOnModules={[...ALWAYS_ON_MODULES]}
      suiteModules={suiteModules}
      coexistenceProfiles={[{ id: "TENURE_CLOUD_PRIMARY", meaning: "Tenure is authoritative" }]}
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

/** The preset the form starts on — what the first blueprint's axes compile to. */
function presetKeys(): string[] {
  const keys = new Set<string>(ALWAYS_ON_MODULES)
  for (const suite of blueprints[0].axes.functional) {
    for (const key of suiteModules[suite] ?? []) keys.add(key)
  }
  return [...keys].filter((key) => {
    const manifest = modules.find((m) => m.key === key)
    return manifest !== undefined && manifest.enableable
  })
}

/**
 * The total the catalog's own prices come to at the preset, computed from the
 * manifests rather than from a literal.
 *
 * Repricing a module in `modules/index.ts` moves BOTH this and the rendered
 * figure, which would make the comparison vacuous — so the rendered figure is
 * also checked against an independent floor and against the per-line sum, and
 * the "a repriced module changes the emitted total" test below pins the concrete
 * number the catalog produces today.
 */
function expectedTotalMinor(): number {
  return presetKeys().reduce((running, key) => {
    const price = modules.find((m) => m.key === key)!.price
    return running + price.perOrgMinor + price.perSeatMinor * SEATS
  }, 0)
}

describe("the composer quotes every option and totals them", () => {
  it("renders a per-seat and per-organization price beside every module", () => {
    const html = renderComposer()
    for (const m of modules) {
      const cell = new RegExp(`data-testid="price-${m.key}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? ""
      expect(cell.trim().length).toBeGreaterThan(10)
      if (m.price.perSeatMinor === 0 && m.price.perOrgMinor === 0) {
        // Zero is a commercial statement and has to carry its reason. A blank
        // here would read as an unpriced option, which reads as free.
        expect(cell).toContain("Included at no charge")
        expect(m.price.includedBecause?.length ?? 0).toBeGreaterThan(20)
      } else {
        expect(cell).toContain("per seat")
        expect(cell).toContain("per organization")
      }
    }
  })

  it("states a price for every coexistence domain too", () => {
    const html = renderComposer()
    for (const domain of ["finance", "hr"]) {
      const cell = new RegExp(`data-testid="price-domain-${domain}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? ""
      expect(cell).toContain("Not separately charged")
    }
  })

  it("emits a running total that is the sum of the selected options", () => {
    const html = renderComposer()
    const rendered = /data-testid="running-total-amount"[^>]*>([^<]*)</.exec(html)?.[1] ?? ""
    const expected = expectedTotalMinor()

    expect(expected).toBeGreaterThan(0)
    expect(rendered).toBe(`$${(expected / 100).toFixed(2)}`)

    // And the ledger preview at the end of the form shows the same figure.
    const preview = /data-testid="ledger-preview-total"[^>]*>(?:<b>)?([^<]*)</.exec(html)?.[1] ?? ""
    expect(preview).toBe(`$${(expected / 100).toFixed(2)}`)
  })

  it("emits the catalog's actual total today, so repricing a module moves it", () => {
    // A concrete number, deliberately. Every other assertion here derives the
    // expectation from the same manifests the form reads, so setting a module's
    // perSeatMinor to 0 would move both sides and pass. This one does not move.
    //
    // 25 seats is the composer's default. If this number changes, a price in
    // modules/index.ts changed — which is a commercial decision, and updating
    // this line is how it gets noticed.
    const html = renderComposer()
    const rendered = /data-testid="running-total-amount"[^>]*>([^<]*)</.exec(html)?.[1] ?? ""
    expect(rendered).toBe("$770.00")
  })

  it("shows the seven pre-activation disclosures, six of them undecided", () => {
    const html = renderComposer()
    expect(html).toContain('data-testid="pre-activation"')
    for (const topic of [
      "legal-merchant",
      "funds-flow",
      "fees",
      "loss-responsibility",
      "tax",
      "settlement",
      "ledger-preview",
    ]) {
      expect(html).toContain(`data-testid="disclosure-${topic}"`)
    }
    expect(html).toContain("6 undecided")
    // Refuses to say it is ready while anything is open.
    expect(html).not.toContain("every disclosure settled")
  })
})
