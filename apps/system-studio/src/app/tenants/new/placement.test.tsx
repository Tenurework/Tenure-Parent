import { renderToStaticMarkup } from "react-dom/server"

import { ARCHETYPE_AXES, ALWAYS_ON_MODULES, BLUEPRINTS, FUNCTIONAL_SUITES, compileArchetype } from "@tenure/blueprints"
import { ENABLEABLE } from "@tenure/module-runtime"
import { MODULE_CATALOG } from "@tenure/modules"

import { __resetFleet, placeableRegions } from "../../../lib/cells"

import { canPlace, placementOffer, placementSummary, type PlacementOffer } from "./placement"

/**
 * STUDIO-000-007 — the compose page survives having no estate, and says which
 * of four things happened.
 *
 * ## The defect
 *
 * `page.tsx` called `placeableRegions()` bare. That function refuses to invent
 * an estate: with `AWS_REGION`, `AWS_ACCOUNT_ID` or `AWS_PARTITION` unset and
 * `sts:GetCallerIdentity` unavailable, it throws `FleetMisconfigured` — so this
 * route answered **500**. A console that 500s because STS is unreachable has not
 * refused, it has fallen over, and the operator gets a stack trace instead of
 * the name of the variable to set.
 *
 * ## Why this test is not a stand-in exercise
 *
 * Two of the four arms are driven by the REAL production reader:
 * `placeableRegions` itself, with the environment set and with it unset. The
 * error the misconfigured arm handles is therefore a real `FleetMisconfigured`
 * carrying `lib/cells`' own problem list, not a hand-made object with a matching
 * `name` — which is the version of this test that would keep passing after
 * somebody renamed the class.
 *
 * The two arms the real reader cannot produce use an injected reader, and say
 * so: `fleet()` always describes exactly one cell, so an empty fleet is not
 * reachable from this process, and "the read threw something that is not a
 * FleetMisconfigured" is by definition not reachable on purpose.
 *
 * ## And the four have to SAY different things
 *
 * The last two tests are the point. Four states that all render "unavailable"
 * are one state with extra steps, and a surface like that cannot tell an
 * operator whether to set a variable, grant an IAM action, or go and build a
 * cell. So the rendered markup is compared: four distinct summaries, four
 * distinct panels, and the region control present in exactly one of them.
 */

jest.mock("../actions", () => ({
  composeTenant: async () => null,
}))

import { ComposeForm } from "./ComposeForm"

const ESTATE = {
  AWS_REGION: "eu-west-2",
  AWS_ACCOUNT_ID: "111122223333",
  AWS_PARTITION: "aws",
}

const modules = MODULE_CATALOG.all().map((m) => ({
  key: m.key,
  description: m.description,
  version: m.version,
  lifecycle: m.lifecycle,
  enableable: ENABLEABLE.has(m.lifecycle),
  price: m.price,
}))

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

/** The composer, rendered against one placement offer and nothing else changed. */
function render(placement: PlacementOffer): string {
  return renderToStaticMarkup(
    <ComposeForm
      blueprints={blueprints}
      modules={modules}
      plans={[{ planId: "institution", displayName: "Institution", grants: "finance" }]}
      defaultPlanId="institution"
      placement={placement}
      engineVersion="0.0.0-test"
      fleetReadAt="2026-01-01T00:00:00.000Z"
      alwaysOnModules={[...ALWAYS_ON_MODULES]}
      suiteModules={suiteModules}
      coexistenceProfiles={[{ id: "TENURE_CLOUD_PRIMARY", meaning: "Tenure is authoritative" }]}
      // From `ISOLATION_CLASSES` on the page. One class is enough here: this
      // render is about the placement arms, and the isolation vocabulary is
      // exercised where it is projected.
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

/**
 * The region `<select>`, or null when the form did not offer one.
 *
 * `[^>]*\bid="region"` rather than `<select id="region"`. Deliberately the same
 * strength — it still requires a `<select>` element carrying exactly that id, and
 * still returns the element's whole markup so `toContain("eu-west-2")` reads the
 * option list rather than the page. What changed is that the control is now
 * rendered by `components/md3/Select`, which spreads the caller's props before
 * writing its own `id`, so the id is no longer the first attribute. Pinning
 * attribute ORDER pins an implementation detail of a shared primitive this route
 * does not own; pinning the element and the id pins what the assertion is about.
 */
function regionControl(html: string): string | null {
  return /<select[^>]*\bid="region"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? null
}

/** Whether the submit button carries `disabled`. */
function submitDisabled(html: string): boolean {
  const button = /<button[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? ""
  // A form with no submit button would make every "the control is disabled"
  // assertion below vacuously true, which is the shape of a guard that passes
  // because it never ran.
  expect(button).not.toBe("")
  return button.includes("disabled")
}

describe("the fleet answered", () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
    __resetFleet()
  })

  it("offers the regions the REAL cell registry names", () => {
    Object.assign(process.env, ESTATE)
    __resetFleet()

    const offer = placementOffer(placeableRegions)

    expect(offer).toEqual({ state: "OFFERED", regions: ["eu-west-2"] })
    expect(canPlace(offer)).toBe(true)
  })

  it("renders a region control, and only then", () => {
    Object.assign(process.env, ESTATE)
    __resetFleet()

    const html = render(placementOffer(placeableRegions))

    const control = regionControl(html)
    expect(control).not.toBeNull()
    expect(control).toContain("eu-west-2")
    expect(submitDisabled(html)).toBe(false)
  })
})

describe("the fleet did not answer", () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
    __resetFleet()
  })

  it("turns the REAL FleetMisconfigured into UNKNOWN naming the variable to set", () => {
    delete process.env.AWS_REGION
    delete process.env.AWS_ACCOUNT_ID
    delete process.env.AWS_PARTITION
    __resetFleet()

    // The production function, called exactly as the page calls it. It throws.
    expect(() => placeableRegions()).toThrow()

    const offer = placementOffer(placeableRegions)

    expect(offer.state).toBe("UNKNOWN")
    if (offer.state !== "UNKNOWN") throw new Error("unreachable")
    expect(offer.reason).toBe("MISCONFIGURED")
    // The problems are `lib/cells`' own, not this file's. That is what makes the
    // remedy actionable: it names the variable that was actually missing.
    expect(offer.problems.map((p) => p.field)).toContain("AWS_REGION")
    expect(canPlace(offer)).toBe(false)
  })

  it("renders the page rather than throwing out of it, with the remedy on it", () => {
    delete process.env.AWS_REGION
    delete process.env.AWS_ACCOUNT_ID
    delete process.env.AWS_PARTITION
    __resetFleet()

    const html = render(placementOffer(placeableRegions))

    // The whole page is still there — this is the 500 that used to happen.
    expect(html).toContain("This composition")
    expect(html).toContain("cell registry could not be described")
    expect(html).toContain("sts:GetCallerIdentity")
    expect(html).toContain("AWS_REGION")

    // And it does not offer a control it has nothing behind.
    expect(regionControl(html)).toBeNull()
    expect(submitDisabled(html)).toBe(true)
  })

  it("distinguishes a read that threw something else", () => {
    // Not reachable from `placeableRegions` on purpose — every refusal it makes
    // is a FleetMisconfigured. An injected reader is the only way to reach this
    // arm, and the arm exists because a catch-all that reported every failure as
    // a missing variable would send an operator to set one that is already set.
    const offer = placementOffer(() => {
      throw new Error("connect ETIMEDOUT 169.254.169.254:80")
    })

    expect(offer.state).toBe("UNKNOWN")
    if (offer.state !== "UNKNOWN") throw new Error("unreachable")
    expect(offer.reason).toBe("UNREADABLE")
    expect(offer.problems[0].detail).toContain("ETIMEDOUT")

    const html = render(offer)
    expect(html).toContain("Unknown — reading the cell registry failed")
    expect(html).toContain("ETIMEDOUT")
    expect(regionControl(html)).toBeNull()
    expect(submitDisabled(html)).toBe(true)
  })

  it("does not report an empty fleet as an unknown one", () => {
    // `fleet()` always describes one cell, so this arm needs an injected reader
    // too. It is kept separate because the next action differs: nothing is
    // missing from the environment and no IAM statement would help — somebody
    // has to build a cell.
    const offer = placementOffer(() => [])

    expect(offer).toEqual({ state: "NO_CELL" })
    expect(canPlace(offer)).toBe(false)

    const html = render(offer)
    expect(html).toContain("No cell can take a tenant")
    expect(html).not.toContain("sts:GetCallerIdentity")
    expect(regionControl(html)).toBeNull()
    expect(submitDisabled(html)).toBe(true)
  })
})

describe("the four states are four answers", () => {
  const offers: PlacementOffer[] = [
    { state: "OFFERED", regions: ["us-east-1"] },
    { state: "NO_CELL" },
    { state: "UNKNOWN", reason: "MISCONFIGURED", problems: [{ field: "AWS_REGION", detail: "unset" }] },
    { state: "UNKNOWN", reason: "UNREADABLE", problems: [{ field: "the cell registry", detail: "boom" }] },
  ]

  it("summarises each differently", () => {
    const said = offers.map(placementSummary)
    expect(new Set(said).size).toBe(offers.length)
    // And none of them is a shrug: every one says what an operator should do
    // next, which is the property "unavailable" four times would not have.
    for (const line of said) expect(line.length).toBeGreaterThan(40)
  })

  it("renders a panel for each that the other three do not render", () => {
    // The rendered markup, not the helper's return value. A surface that
    // computed four strings and printed one of them would pass the test above
    // and fail this one. Each marker must appear in its own render and in
    // NEITHER of the other three — four distinct panels, not four labels on one.
    //
    // Predicates rather than substrings, for the first one only: the region
    // control is drawn by `components/md3/Select`, which writes its own
    // attribute order, so `'<select id="region"'` was pinning a shared
    // primitive's internals rather than this route's behaviour. `regionControl`
    // is the same assertion made order-agnostically, and the other three are
    // unchanged prose this route owns.
    const markers: Array<{ name: string; present: (html: string) => boolean }> = [
      { name: "a region control", present: (html) => regionControl(html) !== null },
      { name: "no cell", present: (html) => html.includes("No cell can take a tenant") },
      {
        name: "misconfigured",
        present: (html) => html.includes("cell registry could not be described"),
      },
      {
        name: "unreadable",
        present: (html) => html.includes("reading the cell registry failed"),
      },
    ]
    const rendered = offers.map(render)

    for (let mine = 0; mine < markers.length; mine++) {
      expect(markers[mine].present(rendered[mine])).toBe(true)
      for (let other = 0; other < markers.length; other++) {
        if (other === mine) continue
        expect(markers[mine].present(rendered[other])).toBe(false)
      }
    }
  })
})
