import { CUSTOMER_TENANT_BINDINGS, TENANT_BINDINGS, getTenantBinding } from "@tenure/blueprints"

import { adoptableBindings, manifestForBinding } from "./adopt"

/**
 * What the console offers to adopt.
 *
 * `adoptableBindings` is rendered on `/tenants` as a list of organisations an
 * operator can bring under management, and adopting one writes a registry
 * record and a manifest. It mapped over the unfiltered `TENANT_BINDINGS`, so
 * three of the four rows were fixtures — `midtown-arts`, `fixture-rtl` and
 * `fixture-external-erp` — presented identically to the live pilot.
 *
 * `tests/architecture/no-fixture-tenants-on-operator-surfaces.test.mjs` catches
 * the IMPORT. This catches the behaviour, which is the thing that mattered: a
 * future edit could reintroduce a fixture through `getTenantBinding` in a loop
 * and satisfy the source-text guard while putting them back on the page.
 */
describe("adoptableBindings", () => {
  it("offers no fixture, however many the bindings carry", () => {
    const offered = adoptableBindings([])
    const fixtureSlugs = TENANT_BINDINGS.filter((b) => b.fixture).map((b) => b.slug)

    // Guards against a vacuous pass: if the bindings ever stop carrying
    // fixtures, this test proves nothing and should say so rather than go green.
    expect(fixtureSlugs.length).toBeGreaterThan(0)

    expect(offered.map((b) => b.slug)).toEqual(
      expect.not.arrayContaining(fixtureSlugs),
    )
  })

  it("offers every customer binding that is not already registered", () => {
    expect(adoptableBindings([]).map((b) => b.slug).sort()).toEqual(
      CUSTOMER_TENANT_BINDINGS.map((b) => b.slug).sort(),
    )
  })

  it("drops a binding once it is in the registry", () => {
    const first = CUSTOMER_TENANT_BINDINGS[0]
    expect(first).toBeDefined()

    expect(adoptableBindings([first!.slug]).map((b) => b.slug)).not.toContain(first!.slug)
  })
})

/**
 * The other half of the same change: a fixture stays RESOLVABLE by slug even
 * though it is never offered.
 *
 * The two functions that look a binding up by slug moved from
 * `TENANT_BINDINGS.find(...)` to `getTenantBinding(...)`. That is meant to be a
 * pure refactor — same answer, no unfiltered list on an operator surface — and
 * this is what would catch it if somebody "fixed" it to
 * `CUSTOMER_TENANT_BINDINGS` and silently broke the suites that reach a fixture
 * on purpose.
 */
describe("a fixture binding stays reachable by slug", () => {
  const fixture = TENANT_BINDINGS.find((b) => b.fixture)

  /**
   * `manifestForBinding` resolves a cell, and the cell registry refuses to
   * invent an estate: with no `AWS_ACCOUNT_ID` and no `sts:GetCallerIdentity`
   * it throws `FleetMisconfigured` rather than defaulting, because a default
   * would place tenants in an account nobody chose. That refusal is correct
   * and is asserted elsewhere; here it just has to be satisfied. The id is
   * AWS's documentation placeholder, obviously constructed and not an estate.
   */
  const ACCOUNT = process.env.AWS_ACCOUNT_ID
  const PARTITION = process.env.AWS_PARTITION
  beforeAll(() => {
    process.env.AWS_ACCOUNT_ID = "123456789012"
    process.env.AWS_PARTITION = "aws"
  })
  afterAll(() => {
    // Restore rather than delete: an ambient value set by the runner is not
    // this test's to remove.
    if (ACCOUNT === undefined) delete process.env.AWS_ACCOUNT_ID
    else process.env.AWS_ACCOUNT_ID = ACCOUNT
    if (PARTITION === undefined) delete process.env.AWS_PARTITION
    else process.env.AWS_PARTITION = PARTITION
  })

  it("resolves through getTenantBinding", () => {
    expect(fixture).toBeDefined()
    expect(getTenantBinding(fixture!.slug)).toBeDefined()
  })

  it("still compiles to a manifest", () => {
    expect(fixture).toBeDefined()
    expect(manifestForBinding(fixture!.slug).slug).toBe(fixture!.slug)
  })
})
