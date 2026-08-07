import { compareVersionStrings } from "@tenure/platform-config/compatibility"

import {
  ApiVersionError,
  PROVIDER_API_VERSION,
  SUPPORTED_EVENT_TYPES,
  checkEventApiVersion,
  compareProviderApiVersions,
  normalizeProviderApiVersion,
  parseProviderEvent,
} from "./api-version"

/**
 * PAY-140-002. The comparator under test is the platform's own — imported here
 * and INJECTED at every production call site, because `@tenure/platform-config`
 * imports this package and cannot be imported back. Testing against a locally
 * written comparator would prove the two agree with each other and nothing else.
 */

describe("the pinned version is a single frozen literal", () => {
  it("is a provider date version", () => {
    expect(PROVIDER_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("ordering delegates to the platform comparator", () => {
  // Deliberately NOT the pinned literal: `provider-api-version-is-pinned.test.mjs`
  // refuses a second copy of it anywhere in the tree, including here, because a
  // version restated in a test is a version somebody updates in one place.
  it("orders by year, then month, then day", () => {
    expect(
      compareProviderApiVersions("2024-01-15", "2024-02-01", compareVersionStrings),
    ).toBeLessThan(0)
    expect(
      compareProviderApiVersions("2024-10-01", "2024-09-30", compareVersionStrings),
    ).toBeGreaterThan(0)
    expect(compareProviderApiVersions("2024-01-15", "2024-01-15", compareVersionStrings)).toBe(0)
  })

  it("orders month 10 after month 9 — the bug a string compare would have", () => {
    expect(
      compareProviderApiVersions("2024-09-01", "2024-10-01", compareVersionStrings),
    ).toBeLessThan(0)
  })

  it("refuses an unparseable version rather than treating it as very old", () => {
    expect(() => normalizeProviderApiVersion("2024-1-15")).toThrow(ApiVersionError)
    expect(() => normalizeProviderApiVersion("beta")).toThrow(/would compare as older/)
  })
})

describe("an event's declared version is checked against the pin", () => {
  it("accepts an exact match", () => {
    expect(checkEventApiVersion(PROVIDER_API_VERSION, compareVersionStrings)).toEqual({
      ok: true,
      relation: "pinned",
    })
  })

  it("refuses an older version as stale, and a newer one as unreviewed", () => {
    const stale = checkEventApiVersion("2025-01-01", compareVersionStrings)
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error("unreachable")
    expect(stale.code).toBe("api-version-stale")

    const ahead = checkEventApiVersion("2099-01-01", compareVersionStrings)
    expect(ahead.ok).toBe(false)
    if (ahead.ok) throw new Error("unreachable")
    expect(ahead.code).toBe("api-version-ahead")
  })

  it("refuses garbage without throwing at the boundary", () => {
    const result = checkEventApiVersion("whenever", compareVersionStrings)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("api-version-unparseable")
  })
})

describe("every supported event type has a parser and a declared field set", () => {
  it("parses each declared type when every field is present", () => {
    for (const type of SUPPORTED_EVENT_TYPES) {
      // Build the minimum object the declared field paths describe, so this is
      // the real parser reading real paths rather than a fixture that agrees
      // with itself.
      const object: Record<string, unknown> = {}
      for (const path of type.fields) {
        const segments = path.split(".")
        let cursor = object
        for (const segment of segments.slice(0, -1)) {
          cursor[segment] = cursor[segment] ?? {}
          cursor = cursor[segment] as Record<string, unknown>
        }
        cursor[segments[segments.length - 1]] = segments[0] === "id" ? "obj_1" : 1
      }
      const parsed = parseProviderEvent(type.type, object)
      expect(parsed.type).toBe(type.type)
      expect(parsed.objectId).toBe("obj_1")
      expect(Object.keys(parsed.fields).sort()).toEqual([...type.fields].sort())
    }
  })

  it("refuses an event type nobody wrote a reader for", () => {
    expect(() => parseProviderEvent("invoice.overdue", { id: "in_1" })).toThrow(
      /not a supported event type/,
    )
  })

  it("refuses a stale schema — a declared field the event no longer carries", () => {
    // The whole stale-schema case: the provider renamed a field, the JSON still
    // parses, and every downstream read would silently become undefined.
    expect(() => parseProviderEvent("payout.paid", { id: "po_1", amount: 100, currency: "usd" })).toThrow(
      /is missing "arrival_date"/,
    )
  })

  it("refuses an event whose id is not a string", () => {
    const object = {
      id: 7,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { currently_due: [] },
    }
    expect(() => parseProviderEvent("account.updated", object)).toThrow(/no string id/)
  })

  it("declares `id` on every type, so every parsed event can be keyed", () => {
    for (const type of SUPPORTED_EVENT_TYPES) {
      expect(type.fields).toContain("id")
      expect(type.summary.length).toBeGreaterThan(0)
    }
  })
})
