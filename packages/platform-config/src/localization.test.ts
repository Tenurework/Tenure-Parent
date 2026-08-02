import { resolveConfig } from "@tenure/configuration"

import { businessDaysBetween, formatMoney } from "./index"
import { REGISTRY, layersFor, localizationFor } from "./index"

describe("two systems, two sets of conventions, one code path", () => {
  it("gives the US university dollars on an academic year", () => {
    const l = localizationFor("rochester")
    expect(l).toEqual({
      locale: "en-US",
      currency: "USD",
      firstDayOfWeek: 0,
      fiscalYearStartMonth: 7,
      // Derived, never configured — see direction.ts.
      direction: "ltr",
      businessCalendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] },
    })
  })

  it("gives the UK charity sterling on an April year, weeks starting Monday", () => {
    // Not a translation of the university's settings — a different organisation
    // with different obligations.
    const l = localizationFor("midtown-arts")
    expect(l).toEqual({
      locale: "en-GB",
      currency: "GBP",
      firstDayOfWeek: 1,
      fiscalYearStartMonth: 4,
      // Derived, never configured — see direction.ts.
      direction: "ltr",
      businessCalendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] },
    })
  })

  it("gives the Gulf fixture a right-to-left document and a Sunday–Thursday week", () => {
    // GE-022-004. Both real bindings are English, Monday-to-Friday and
    // left-to-right, so every localization claim the engine makes would
    // otherwise be true by accident. This is the binding that can fail.
    const l = localizationFor("fixture-rtl")
    expect(l.locale).toBe("ar-AE")
    expect(l.currency).toBe("AED")
    // Derived from the locale, not configured — nobody can set Arabic to ltr.
    expect(l.direction).toBe("rtl")
    expect(l.businessCalendar.workingDays).toEqual([0, 1, 2, 3, 4])
    expect(l.businessCalendar.holidays).toEqual(["2026-12-02", "2026-12-03"])
  })

  it("counts a deadline on the fixture's week, not on the pilot's", () => {
    // Over a whole week the two agree — both work five days — so the span has
    // to end inside one weekend and not the other for the difference to show.
    // Friday 2026-08-07 to Sunday 2026-08-09 does: nothing ages for the pilot,
    // whose weekend that is, and Sunday is a working day for the fixture.
    const friday = new Date("2026-08-07T09:00:00Z")
    const sunday = new Date("2026-08-09T09:00:00Z")
    expect(businessDaysBetween(friday, sunday, localizationFor("rochester").businessCalendar)).toBe(0)
    expect(businessDaysBetween(friday, sunday, localizationFor("fixture-rtl").businessCalendar)).toBe(1)

    // And across the fixture's own closures. Tuesday 2026-12-01 to Sunday the
    // 6th is Wed/Thu/Fri for the pilot; for the fixture, Wednesday and Thursday
    // are closed and Friday and Saturday are its weekend, leaving Sunday alone.
    const dec1 = new Date("2026-12-01T09:00:00Z")
    const dec6 = new Date("2026-12-06T09:00:00Z")
    expect(businessDaysBetween(dec1, dec6, localizationFor("rochester").businessCalendar)).toBe(3)
    expect(businessDaysBetween(dec1, dec6, localizationFor("fixture-rtl").businessCalendar)).toBe(1)
  })

  it("falls back to platform defaults for an unbound institution", () => {
    expect(localizationFor("not-configured-yet")).toEqual({
      locale: "en-US",
      currency: "USD",
      firstDayOfWeek: 0,
      fiscalYearStartMonth: 7,
      // Derived, never configured — see direction.ts.
      direction: "ltr",
      businessCalendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] },
    })
  })
})

describe("money formats in the tenant's currency", () => {
  it("formats the same amount differently for the two tenants", () => {
    const cents = 123456
    expect(formatMoney(cents, localizationFor("rochester"))).toBe("$1,234.56")
    expect(formatMoney(cents, localizationFor("midtown-arts"))).toBe("£1,234.56")
  })

  it("handles a currency with no minor unit", () => {
    // JPY has zero minor-unit digits. Dividing by 100 unconditionally — which
    // formatCents does — renders ¥1,200 as "¥12", a hundredfold error on a
    // finance surface. Intl is asked instead of assumed.
    expect(formatMoney(1200, { locale: "ja-JP", currency: "JPY" })).toBe("￥1,200")
  })

  it("handles a currency with three minor-unit digits", () => {
    // Kuwaiti dinar is 1/1000. The same assumption is wrong in the other
    // direction here.
    expect(formatMoney(1234, { locale: "en-US", currency: "KWD" })).toContain("1.234")
  })

  it("formats negatives", () => {
    expect(formatMoney(-5000, { locale: "en-US", currency: "USD" })).toBe("-$50.00")
  })

  it("formats zero", () => {
    expect(formatMoney(0, { locale: "en-US", currency: "USD" })).toBe("$0.00")
  })
})

describe("a locale or currency the runtime cannot format is refused at publication", () => {
  const attempt = (values: Record<string, unknown>) =>
    resolveConfig(REGISTRY, [...layersFor("rochester"), { scope: "tenant", id: "rochester", values }], {
      collectProblems: true,
    })

  it("refuses a locale nobody can format in", () => {
    // The alternative is a page of RangeErrors for whichever tenant it was set
    // on, discovered by them rather than at publication.
    const { config, problems } = attempt({ "platform.localization.locale": "not-a-locale!!" })
    expect(config).toBeNull()
    expect(problems[0].reason).toBe("invalid-value")
    expect(problems[0].detail).toMatch(/locale this runtime can format in|Invalid/)
  })

  it("refuses a currency that is not ISO 4217", () => {
    expect(attempt({ "platform.localization.currency": "DOLLARS" }).config).toBeNull()
    expect(attempt({ "platform.localization.currency": "usd" }).config).toBeNull()
  })

  it("refuses a fiscal month outside 1–12 and a weekday outside 0–6", () => {
    expect(attempt({ "platform.localization.fiscalYearStartMonth": 13 }).config).toBeNull()
    expect(attempt({ "platform.localization.firstDayOfWeek": 7 }).config).toBeNull()
  })

  it("accepts a real locale it has never seen", () => {
    const { config } = attempt({ "platform.localization.locale": "fr-CA" })
    expect(config).not.toBeNull()
    expect(config!.get("platform.localization.locale")).toBe("fr-CA")
  })
})

describe("what a user may set, and what they may not", () => {
  it("lets a user choose their own locale", () => {
    // A reader's language is theirs.
    const { config } = resolveConfig(
      REGISTRY,
      [...layersFor("rochester"), { scope: "user", id: "u1", values: { "platform.localization.locale": "fr-CA" } }],
      { collectProblems: true },
    )
    expect(config!.get("platform.localization.locale")).toBe("fr-CA")
  })

  it("refuses to let a user change the currency a budget is denominated in", () => {
    // That would reinterpret every stored amount.
    const { config, problems } = resolveConfig(
      REGISTRY,
      [...layersFor("rochester"), { scope: "user", id: "u1", values: { "platform.localization.currency": "EUR" } }],
      { collectProblems: true },
    )
    expect(config).toBeNull()
    expect(problems[0].reason).toBe("scope-not-allowed")
  })

  it("refuses to let a user move the fiscal year", () => {
    const { problems } = resolveConfig(
      REGISTRY,
      [
        ...layersFor("rochester"),
        { scope: "user", id: "u1", values: { "platform.localization.fiscalYearStartMonth": 1 } },
      ],
      { collectProblems: true },
    )
    expect(problems[0].reason).toBe("scope-not-allowed")
  })

  it("lets a legal entity differ from its tenant on currency", () => {
    const { config } = resolveConfig(
      REGISTRY,
      [
        ...layersFor("rochester"),
        { scope: "legalEntity", id: "uk-subsidiary", values: { "platform.localization.currency": "GBP" } },
      ],
      { collectProblems: true },
    )
    expect(config!.get("platform.localization.currency")).toBe("GBP")
  })
})
