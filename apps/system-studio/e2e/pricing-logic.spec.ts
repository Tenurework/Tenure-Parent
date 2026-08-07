import { test, expect } from "@playwright/test"

import { resolveConfig, type ConfigLayer } from "@tenure/configuration"
import { REGISTRY, layersFor } from "@tenure/platform-config"
import { PLATFORM_DEFINITIONS } from "@tenure/platform-config"
import { SCALE } from "@tenure/finops"

import { editableDomains } from "../src/lib/editable-config"

/**
 * NEXT-SESSION §7 — every configuration option priced, with a running total.
 *
 * Pure, so no browser: what is being checked is that the Studio's configuration
 * surface is fed real money by the RESOLVER, and that is decided before any
 * pixel is drawn. `configuration/page.tsx` calls exactly the two functions this
 * file calls — `layersFor` + `resolveConfig` for the total, `editableDomains`
 * for the per-option prices — so a change that stops the page pricing anything
 * fails here.
 *
 * Every total below is read off `config.runningCost`, which is what the resolver
 * emits. Summing the definitions here instead would prove the arithmetic and
 * prove nothing about whether the resolver still does it.
 */

/** Minor units — cents — out of a Money's internal sub-cent scale. */
const minor = (amount: { units: number }) => amount.units / 10 ** SCALE

/** The layer stack `configuration/page.tsx` builds, with a published overlay. */
function layersWith(slug: string, published: Record<string, unknown>): ConfigLayer[] {
  return [
    ...layersFor(slug),
    { scope: "tenant", id: slug, label: "published", values: published },
  ]
}

test.describe("every option a tenant can choose carries a price", () => {
  test("no editable field is offered without one", () => {
    // The defect §7 names, asserted over the real definitions the editor
    // derives its fields from: an option with no price is incomplete.
    const fields = editableDomains().flatMap((d) => d.fields)
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(field.price, `${field.key} has no price`).toBeTruthy()
      expect(Number.isInteger(field.price.perSeatMinor)).toBe(true)
      expect(Number.isInteger(field.price.perOrgMinor)).toBe(true)
      expect(field.price.currency).toMatch(/^[A-Z]{3}$/)
    }
  })

  test("a free option says why it is free", () => {
    // Zero is a commercial statement. One nobody wrote down reads on a form as
    // "nobody has priced this", which is the same defect wearing a zero.
    for (const definition of PLATFORM_DEFINITIONS) {
      if (definition.price.perSeatMinor === 0 && definition.price.perOrgMinor === 0) {
        expect(definition.price.includedBecause, `${definition.key} is free for no stated reason`).toBeTruthy()
      }
    }
  })
})

test.describe("the running total the Studio renders comes from the resolver", () => {
  test("prices the assistant per seat, because it ships on", () => {
    const { config, problems } = resolveConfig(REGISTRY, layersWith("rochester", {}), {
      collectProblems: true,
      seats: 250,
    })
    expect(problems).toEqual([])

    // $4.00 a seat, and the whole point of putting the charge on the switch:
    // an unmodified tenant sees it, and turning the flag off removes it.
    expect(minor(config!.runningCost.perSeat)).toBe(400)
    expect(config!.runningCost.seats).toBe(250)
    expect(minor(config!.runningCost.total)).toBe(400 * 250)
    expect(config!.runningCost.currency).toBe("USD")
  })

  test("adds the white-label charge when the tenant sets its own wordmark", () => {
    const { config } = resolveConfig(
      REGISTRY,
      layersWith("rochester", { "platform.branding.wordmark": "Rochester" }),
      { collectProblems: true, seats: 250 },
    )
    expect(minor(config!.runningCost.organization)).toBe(9_900)
    expect(minor(config!.runningCost.total)).toBe(400 * 250 + 9_900)
  })

  test("adds the multi-currency charge on top, and both appear as lines", () => {
    const { config } = resolveConfig(
      REGISTRY,
      layersWith("rochester", {
        "platform.branding.wordmark": "Rochester",
        "platform.localization.currency": "GBP",
      }),
      { collectProblems: true, seats: 250 },
    )
    expect(minor(config!.runningCost.organization)).toBe(9_900 + 4_900)
    expect(minor(config!.runningCost.total)).toBe(400 * 250 + 9_900 + 4_900)

    const keys = config!.runningCost.lines.map((l) => l.key)
    expect(keys).toContain("platform.branding.wordmark")
    expect(keys).toContain("platform.localization.currency")
  })

  test("removes the per-seat charge when the assistant is switched off", () => {
    const { config } = resolveConfig(
      REGISTRY,
      layersWith("rochester", { "platform.flags.aiAssistant.enabled": false }),
      { collectProblems: true, seats: 250 },
    )
    expect(minor(config!.runningCost.perSeat)).toBe(0)
    expect(minor(config!.runningCost.total)).toBe(0)
  })

  test("quotes one seat when nobody says how many", () => {
    // Never implied. The page has no seat count to read from the registry, so
    // the number used is stated on the result and rendered beside the total.
    const { config } = resolveConfig(REGISTRY, layersWith("rochester", {}), {
      collectProblems: true,
    })
    expect(config!.runningCost.seats).toBe(1)
    expect(minor(config!.runningCost.total)).toBe(400)
  })
})
