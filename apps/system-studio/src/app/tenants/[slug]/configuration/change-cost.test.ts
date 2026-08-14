/**
 * The configuration page's third question, proved: *what would changing it
 * cost?*
 *
 * Every assertion below is on a rule that decides what an operator reads before
 * they press Publish on a LIVE tenant — which direction the bill moves, by how
 * much at the seat count they stated, and which options were never theirs to
 * move. A sign flipped here is a console telling somebody that turning a
 * feature on will SAVE them money.
 *
 * Runs through `apps/web`'s jest, whose `roots` include the Studio's `src`:
 *
 *     npm run test --workspace apps/web -- --ci \
 *       apps/system-studio/src/app/tenants/\[slug\]/configuration/change-cost.test.ts
 */

import { fromMinorUnits, toDecimal, type OptionPrice } from "@tenure/finops"
import { REGISTRY } from "@tenure/platform-config"

// Relative, not `@/`: jest's `moduleNameMapper` points `@/` at apps/web's src,
// which is a different app. See the header note on the runner.
import { editableDomains } from "../../../../lib/editable-config"

import {
  billDelta,
  changeCostsByDomain,
  changeSpread,
  lockReason,
  signedAmount,
  type ConfigurableOption,
} from "./change-cost"

const priced = (perSeatMinor: number, perOrgMinor: number, currency = "USD"): OptionPrice => ({
  perSeatMinor,
  perOrgMinor,
  currency,
  rounding: "half-up",
})

const included = (because: string): OptionPrice => ({
  perSeatMinor: 0,
  perOrgMinor: 0,
  currency: "USD",
  rounding: "half-up",
  includedBecause: because,
})

const option = (over: Partial<ConfigurableOption> = {}): ConfigurableOption => ({
  key: "platform.flags.aiAssistant.enabled",
  description: "The assistant.",
  domainId: "modules",
  domainGoverns: "Which modules and features are enabled.",
  price: priced(400, 0),
  chargedToday: false,
  requiresCapability: null,
  input: "boolean",
  ...over,
})

describe("what changing one option does to the bill", () => {
  it("prices turning an option ON as an ADDITION at the stated seat count", () => {
    const [group] = changeCostsByDomain([option({ chargedToday: false })], 250, [])
    const [cost] = group.options

    expect(cost.direction).toBe("adds")
    // 250 seats x $4.00, and nothing per organisation.
    expect(toDecimal(cost.delta, "half-even")).toBe("1000.00")
    expect(cost.delta.units).toBeGreaterThan(0)
    expect(cost.change).toBe("Turning it on")
  })

  it("prices turning an option OFF as a REMOVAL of the same magnitude", () => {
    const [group] = changeCostsByDomain([option({ chargedToday: true })], 250, [])
    const [cost] = group.options

    expect(cost.direction).toBe("removes")
    expect(toDecimal(cost.delta, "half-even")).toBe("-1000.00")
    expect(cost.delta.units).toBeLessThan(0)
    expect(cost.change).toBe("Turning it off")
  })

  it("adds the per-organisation half on top of the per-seat half", () => {
    const [group] = changeCostsByDomain(
      [option({ key: "platform.branding.wordmark", price: priced(0, 9900), input: "string" })],
      250,
      [],
    )
    expect(toDecimal(group.options[0].delta, "half-even")).toBe("99.00")
    expect(group.options[0].change).toBe("Choosing anything other than the platform default")
  })

  it("charges a non-boolean by whether it differs from the default, not by a switch", () => {
    const [group] = changeCostsByDomain(
      [
        option({
          key: "platform.branding.wordmark",
          price: priced(0, 9900),
          input: "string",
          chargedToday: true,
        }),
      ],
      1,
      [],
    )
    expect(group.options[0].change).toBe("Returning it to the platform default")
    expect(group.options[0].direction).toBe("removes")
  })

  it("says an included option is UNCHANGED rather than 'adds 0.00'", () => {
    // "This is included in the plan" and "this costs less than a cent" are
    // different facts, and rounding one into the other is how a price list stops
    // being readable.
    const [group] = changeCostsByDomain(
      [option({ key: "platform.localization.locale", price: included("Every plan is localised."), input: "string" })],
      250,
      [],
    )
    const [cost] = group.options
    expect(cost.direction).toBe("unchanged")
    expect(cost.delta.units).toBe(0)
    expect(cost.includedBecause).toBe("Every plan is localised.")
  })

  it("scales with the seat count the operator stated", () => {
    const at10 = changeCostsByDomain([option()], 10, [])[0].options[0]
    const at250 = changeCostsByDomain([option()], 250, [])[0].options[0]
    expect(toDecimal(at10.delta, "half-even")).toBe("40.00")
    expect(toDecimal(at250.delta, "half-even")).toBe("1000.00")
  })

  it("names an unsupported input as something nobody can change from here", () => {
    const [group] = changeCostsByDomain(
      [option({ key: "platform.payments.approvalThresholds", input: "unsupported" })],
      1,
      [],
    )
    expect(group.options[0].change).toMatch(/no editor here yet/)
  })
})

describe("an option gated by a capability", () => {
  const gated = option({
    key: "platform.relay.modelTokenBudgetPerMonth",
    domainId: "relay",
    domainGoverns: "Assistant tool exposure and per-tenant model policy.",
    input: "number",
    requiresCapability: "relay.modelBudget.publish",
    price: included("A spending ceiling is a control, not a feature."),
  })

  it("is SHOWN, not hidden, when the operator does not hold the capability", () => {
    // The defect this exists against: an option filtered out of the page because
    // it cannot be published, so an operator spends twenty minutes looking for a
    // setting the console decided not to mention.
    const groups = changeCostsByDomain([gated], 1, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].options.map((o) => o.key)).toEqual(["platform.relay.modelTokenBudgetPerMonth"])
  })

  it("carries the reason, naming the capability and what holds it", () => {
    const [group] = changeCostsByDomain([gated], 1, [])
    expect(group.options[0].lockedReason).toContain("relay.modelBudget.publish")
    expect(group.options[0].lockedReason).toContain("no capabilities at all")
    expect(group.locked).toBe(1)
  })

  it("is NOT locked once the capability is held", () => {
    const [group] = changeCostsByDomain([gated], 1, ["relay.modelBudget.publish"])
    expect(group.options[0].lockedReason).toBeNull()
    expect(group.locked).toBe(0)
  })

  it("is not locked by holding some OTHER capability", () => {
    const [group] = changeCostsByDomain([gated], 1, ["payments.mode.publish"])
    expect(group.options[0].lockedReason).toContain("relay.modelBudget.publish")
    expect(group.options[0].lockedReason).toContain("payments.mode.publish")
    expect(group.locked).toBe(1)
  })

  it("leaves an ungated option unlocked", () => {
    const [group] = changeCostsByDomain([option()], 1, [])
    expect(group.options[0].lockedReason).toBeNull()
  })
})

describe("grouping", () => {
  it("groups by the domain that governs the key, in the order the domains arrive", () => {
    // The order in is the domain registry's order — the bible's — not
    // alphabetical and not the order keys happened to be declared in.
    const groups = changeCostsByDomain(
      [
        option({ key: "platform.organization.a", domainId: "organization", domainGoverns: "Org shape." }),
        option({ key: "platform.flags.b", domainId: "modules", domainGoverns: "Features." }),
        option({ key: "platform.organization.c", domainId: "organization", domainGoverns: "Org shape." }),
      ],
      1,
      [],
    )
    expect(groups.map((g) => g.domainId)).toEqual(["organization", "modules"])
    expect(groups[0].options.map((o) => o.key)).toEqual(["platform.organization.a", "platform.organization.c"])
    expect(groups[1].options.map((o) => o.key)).toEqual(["platform.flags.b"])
    expect(groups[0].governs).toBe("Org shape.")
  })

  it("returns nothing at all when there is nothing to price", () => {
    expect(changeCostsByDomain([], 250, [])).toEqual([])
  })
})

describe("the delta against what the tenant pays today", () => {
  it("reports an increase as an addition", () => {
    const delta = billDelta(fromMinorUnits(100_000, "USD"), fromMinorUnits(109_900, "USD"))
    expect(delta).not.toBeNull()
    expect(delta!.direction).toBe("adds")
    expect(toDecimal(delta!.delta, "half-even")).toBe("99.00")
  })

  it("reports a decrease as a removal, signed", () => {
    const delta = billDelta(fromMinorUnits(109_900, "USD"), fromMinorUnits(100_000, "USD"))
    expect(delta!.direction).toBe("removes")
    expect(toDecimal(delta!.delta, "half-even")).toBe("-99.00")
  })

  it("reports no movement as unchanged rather than as a tiny change", () => {
    const delta = billDelta(fromMinorUnits(100_000, "USD"), fromMinorUnits(100_000, "USD"))
    expect(delta!.direction).toBe("unchanged")
    expect(delta!.delta.units).toBe(0)
  })

  it("refuses to subtract across currencies rather than inventing a number", () => {
    // A cross-currency difference is not a number, and rendering it as a
    // reassuring "no change" is exactly what the Money type exists to prevent.
    expect(billDelta(fromMinorUnits(1000, "USD"), fromMinorUnits(1000, "JPY"))).toBeNull()
  })
})

describe("signing a delta for a column", () => {
  it("writes the plus that toDecimal does not", () => {
    expect(signedAmount(fromMinorUnits(9900, "USD"))).toBe("+99.00 USD")
  })

  it("keeps the minus toDecimal does write", () => {
    expect(signedAmount(fromMinorUnits(-9900, "USD"))).toBe("-99.00 USD")
  })

  it("signs zero neither way", () => {
    expect(signedAmount(fromMinorUnits(0, "USD"))).toBe("0.00 USD")
  })

  it("respects a currency whose minor unit is not a hundredth", () => {
    expect(signedAmount(fromMinorUnits(1200, "JPY"))).toBe("+1200 JPY")
  })
})

describe("the spread across the whole editor", () => {
  const groups = () =>
    changeCostsByDomain(
      [
        option({ key: "platform.flags.assistant", price: priced(400, 0), chargedToday: false }),
        option({ key: "platform.branding.wordmark", price: priced(0, 9900), input: "string", chargedToday: false }),
        option({ key: "platform.flags.other", price: priced(100, 0), chargedToday: true }),
        option({ key: "platform.localization.locale", price: included("In every plan."), input: "string" }),
        option({
          key: "platform.relay.modelTokenBudgetPerMonth",
          input: "number",
          price: included("A ceiling is a control."),
          requiresCapability: "relay.modelBudget.publish",
        }),
      ],
      250,
      [],
    )

  it("names the single most expensive change available", () => {
    const spread = changeSpread(groups())
    // 250 x $4.00 = $1000.00 beats the $99.00 organisation charge.
    expect(spread.largestAddition!.key).toBe("platform.flags.assistant")
    expect(toDecimal(spread.largestAddition!.amount, "half-even")).toBe("1000.00")
  })

  it("names the largest saving available", () => {
    const spread = changeSpread(groups())
    expect(spread.largestRemoval!.key).toBe("platform.flags.other")
    expect(toDecimal(spread.largestRemoval!.amount, "half-even")).toBe("-250.00")
  })

  it("counts what is priced, what is locked and what costs nothing either way", () => {
    const spread = changeSpread(groups())
    expect(spread.priced).toBe(5)
    expect(spread.locked).toBe(1)
    expect(spread.free).toBe(2)
    expect(spread.currency).toBe("USD")
  })

  it("has no extremes at all when nothing on the page moves the bill", () => {
    const spread = changeSpread(
      changeCostsByDomain([option({ price: included("In every plan.") })], 250, []),
    )
    expect(spread.largestAddition).toBeNull()
    expect(spread.largestRemoval).toBeNull()
    expect(spread.currency).toBeNull()
  })

  it("declines to compare across currencies, and says how many it left out", () => {
    const spread = changeSpread(
      changeCostsByDomain(
        [
          option({ key: "platform.flags.usd", price: priced(400, 0) }),
          option({ key: "platform.flags.jpy", price: priced(300, 0, "JPY") }),
        ],
        10,
        [],
      ),
    )
    expect(spread.largestAddition!.key).toBe("platform.flags.usd")
    expect(spread.inOtherCurrencies).toBe(1)
  })
})

describe("the options this build will actually hand the page", () => {
  /*
   * Not a fixture. `editableDomains()` and `REGISTRY` are exactly what
   * `page.tsx` reads, and the claim being pinned is the one the page makes on
   * screen: at least one editable key in this build is gated by a capability,
   * so the locked control and its reason are reachable rather than theoretical.
   *
   * If a future build removes the last gated key this reds, and it should: the
   * e2e beside it asserts a locked field is on the page, and a vacuously-true
   * assertion there would be worse than a failure here.
   */
  it("includes at least one editable key gated by a capability", () => {
    const gated = editableDomains()
      .flatMap((entry) => entry.fields)
      .map((field) => REGISTRY.get(field.key))
      .filter((definition) => definition?.requiresCapability)

    expect(gated.length).toBeGreaterThan(0)
    expect(gated.map((definition) => definition!.key)).toContain(
      "platform.relay.modelTokenBudgetPerMonth",
    )
  })

  it("locks every one of them, because this console publishes with no capabilities", () => {
    // The same emptiness `page.tsx` declares, for the same reason: `review` and
    // `publish` in ./actions.ts pass no `publisherCapabilities`, whose default
    // is the empty set. The day they pass real ones, this reds and the page's
    // constant is what has to change.
    const options: ConfigurableOption[] = editableDomains().flatMap((entry) =>
      entry.fields.flatMap((field) => {
        const definition = REGISTRY.get(field.key)
        if (!definition) return []
        return [
          {
            key: field.key,
            description: field.description,
            domainId: entry.domain.id,
            domainGoverns: entry.domain.governs,
            price: field.price,
            chargedToday: false,
            requiresCapability: definition.requiresCapability ?? null,
            input: field.input,
          },
        ]
      }),
    )

    const groups = changeCostsByDomain(options, 250, [])
    const locked = groups.flatMap((group) => group.options).filter((option) => option.lockedReason)
    expect(locked.length).toBeGreaterThan(0)
    // And nothing was dropped on the way: every editable key is still rendered.
    expect(groups.flatMap((group) => group.options)).toHaveLength(options.length)
  })
})

describe("the words a locked option is refused in", () => {
  it("names the capability, what is held, and who refuses", () => {
    const reason = lockReason("payments.mode.publish", [])
    expect(reason).toContain("payments.mode.publish")
    expect(reason).toContain("refused by the engine")
  })

  it("lists what IS held when something is", () => {
    expect(lockReason("payments.mode.publish", ["relay.modelBudget.publish"])).toContain(
      "this console holds relay.modelBudget.publish",
    )
  })
})
