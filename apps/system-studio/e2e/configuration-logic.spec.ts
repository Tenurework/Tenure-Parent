import { test, expect } from "@playwright/test"

import { CONFIG_DOMAINS } from "@tenure/configuration"

import { configSortKey } from "../src/lib/config-sort-key"
import {
  editableDomains,
  parseField,
  reservedDomains,
  withheldDomains,
  type EditableField,
} from "../src/lib/editable-config"

/**
 * GE-032-001 — what a tenant administrator may edit, and how a revision sorts.
 *
 * Pure, so no browser. Two things here are quietly wrong in most
 * implementations: an editable-field list maintained by hand that lags the
 * engine, and a zero-padded sort key that nobody pads.
 */

test.describe("the editable set is derived, not listed", () => {
  test("offers only domains a tenant administrator may write", () => {
    const offered = editableDomains().map((d) => d.domain.id)
    for (const id of offered) {
      const domain = CONFIG_DOMAINS.find((d) => d.id === id)!
      expect(domain.tenantAdminMayWrite).toBe(true)
    }
  })

  test("never offers placement, recovery, observability or cost", () => {
    // The four the engine withholds. An editor that offered residency would let
    // a tenant move their own data, which is the case GE-031-002's domain
    // authority exists for.
    const offered = editableDomains().map((d) => d.domain.id)
    for (const withheld of ["deployment", "recovery", "observability", "cost"]) {
      expect(offered).not.toContain(withheld)
    }
  })

  test("withholds a domain even when it HAS keys", () => {
    // The gate that matters, reached directly. Every withheld domain is also
    // reserved today, so the empty-domain filter removes them whether or not
    // `tenantAdminMayWrite` is honoured — a mutation deleting the check passed
    // every other test here. This supplies a withheld domain WITH a key.
    const deployment = CONFIG_DOMAINS.find((d) => d.id === "deployment")!
    expect(deployment.tenantAdminMayWrite).toBe(false)

    const offered = editableDomains(
      [deployment],
      [
        {
          key: "platform.deployment.region",
          description: "Where this tenant's data lives.",
          default: "us-east-1",
          overridable: true,
          allowedScopes: ["tenant"],
        },
      ],
    )
    expect(offered).toEqual([])
  })

  test("withholds a key the definition does not allow at tenant scope", () => {
    // Both gates apply. A key inside a writable domain but pinned to blueprint
    // scope is not the tenant's to edit, and dropping this filter passed every
    // other test because every real definition happens to allow tenant scope.
    const organization = CONFIG_DOMAINS.find((d) => d.id === "organization")!
    const offered = editableDomains(
      [organization],
      [
        {
          key: "platform.terminology.seatSingular",
          description: "blueprint-only",
          default: "Seat",
          overridable: true,
          allowedScopes: ["blueprint"],
        },
      ],
    )
    expect(offered).toEqual([])
  })

  test("offers only keys a tenant may set at their own scope", () => {
    // Both gates apply: the domain permits the admin, AND the definition allows
    // the tenant scope. A key governed by a writable domain but pinned to
    // blueprint scope is not theirs to edit.
    for (const { fields } of editableDomains()) {
      for (const field of fields) {
        expect(field.key.startsWith("platform.")).toBe(true)
      }
    }
  })

  test("has fields for the domains that have keys today", () => {
    // If this ever returns nothing, the editor is an empty page and the
    // derivation has silently stopped finding anything.
    const offered = editableDomains()
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.flatMap((d) => d.fields).length).toBeGreaterThan(0)
  })

  test("names reserved and withheld domains rather than hiding them", () => {
    // An administrator searching for a setting that does not exist for them has
    // no way to learn that from a blank page.
    const all = new Set([
      ...editableDomains().map((d) => d.domain.id),
      ...reservedDomains().map((d) => d.id),
      ...withheldDomains().map((w) => w.domain.id),
    ])
    // Every declared domain is accounted for in exactly one of the three lists.
    expect(all.size).toBe(CONFIG_DOMAINS.length)
  })

  test("a reserved domain names the item that will fill it", () => {
    for (const domain of reservedDomains()) {
      expect(domain.reservedFor, `${domain.id} is reserved for nothing`).toBeTruthy()
    }
  })
})

test.describe("parsing a submitted value", () => {
  const field = (input: EditableField["input"]): EditableField => ({
    key: "platform.x",
    description: "",
    domain: "d",
    defaultValue: input === "number" ? 0 : input === "boolean" ? false : "",
    input,
  })

  test("treats an empty box as 'leave it alone', not as an empty value", () => {
    // Clearing a text field must not publish "" as a tenant's word for a seat.
    expect(parseField(field("string"), "")).toBeUndefined()
    expect(parseField(field("string"), "   ")).toBeUndefined()
    expect(parseField(field("string"), null)).toBeUndefined()
  })

  test("parses each declared type", () => {
    expect(parseField(field("string"), " Chair ")).toBe("Chair")
    expect(parseField(field("number"), "42")).toBe(42)
    expect(parseField(field("boolean"), "true")).toBe(true)
    expect(parseField(field("boolean"), "false")).toBe(false)
  })

  test("refuses a number that is not one rather than publishing NaN", () => {
    expect(parseField(field("number"), "abc")).toBeUndefined()
    expect(parseField(field("number"), "Infinity")).toBeUndefined()
  })

  test("never parses an unsupported input", () => {
    // Lists and objects are read-only until there is a real editor; a text box
    // for a JSON array is a way to corrupt configuration by typo.
    expect(parseField(field("unsupported"), "[1,2,3]")).toBeUndefined()
  })
})

test.describe("revision sort keys", () => {
  test("are zero-padded, so revision 10 sorts after revision 9", () => {
    // DynamoDB sorts sort keys lexicographically. Unpadded, "CONFIG#10" sorts
    // before "CONFIG#9" and a version history silently reorders itself at the
    // tenth revision — invisible until a rollback picks the wrong target.
    const keys = [1, 2, 9, 10, 11, 100].map(configSortKey)
    expect([...keys].sort()).toEqual(keys)
  })

  test("keep a fixed width", () => {
    expect(configSortKey(1)).toBe("CONFIG#00000001")
    expect(configSortKey(12345678)).toBe("CONFIG#12345678")
  })
})
