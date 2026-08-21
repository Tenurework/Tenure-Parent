import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import { ALL_STATES, TOMBSTONE_FIELDS, type TenantState } from "@tenure/provisioning"

import { purgeFinality, purgeFinalitySentence } from "../src/lib/purge-finality"
import { riskOf } from "../src/lib/tenant-state"
import { classifyConsequence } from "../src/components/md3/DangerZone"

/**
 * GE-103-019 — "Make clear that a purged tenant has no recoverable content; it
 * can only be onboarded anew from independently retained configuration/customer
 * import."
 *
 * Two halves, and both are asserted here: that the sentence is SAID (and says
 * the right thing on each of the three purge states), and that it reaches the
 * two surfaces an operator meets — the consequence panel before the move, and
 * the lifecycle card after it.
 */

const NO_RETAINED = { classes: [] as const, sources: [] as const, unknown: [] as const }

test.describe("what is true of a purged tenant", () => {
  test("a purged tenant is told to have no recoverable content, in those words", () => {
    const finality = purgeFinality("PURGED_ZERO_INCREMENTAL_COST")
    expect(finality).not.toBeNull()
    expect(finality!.content).toBe("gone")
    expect(finality!.headline).toContain("no recoverable content")
    // The second clause of the requirement.
    expect(finality!.rebuild).toContain("onboarded anew")
  })

  test("every input a rebuild needs is independent of Tenure — none is held by the platform", () => {
    // This is the check, not a decoration. An input the platform still held
    // would make "no recoverable content" false.
    const finality = purgeFinality("PURGED_ZERO_INCREMENTAL_COST")!
    expect(finality.inputs.length).toBeGreaterThan(0)
    for (const input of finality.inputs) {
      expect(input.heldByPlatform, `${input.what} is claimed to be held by Tenure`).toBe(false)
    }
  })

  test("the inputs name configuration and customer records, which is what the sentence names", () => {
    const inputs = purgeFinality("PURGED_ZERO_INCREMENTAL_COST")!.inputs
    const all = inputs.map((i) => `${i.what} ${i.from}`).join(" | ").toLowerCase()
    expect(all).toContain("configuration")
    expect(all).toContain("export")
    expect(all).toContain("identity provider")
  })

  test("what the Parent keeps is the tombstone's own field list, not a second copy of it", () => {
    // GE-103-015 owns that key set. A disclosure with five hand-written field
    // names would be wrong the first time the tombstone changed shape.
    const retains = purgeFinality("PURGED_ZERO_INCREMENTAL_COST")!.parentRetains
    for (const field of TOMBSTONE_FIELDS) {
      expect(retains).toContain(field)
    }
  })
})

test.describe("three standings, because collapsing any two costs something", () => {
  test("PURGE_PENDING says nothing has been destroyed, and does NOT say the content is gone", () => {
    const finality = purgeFinality("PURGE_PENDING")!
    expect(finality.content).toBe("intact")
    expect(finality.headline).toContain("Nothing has been destroyed")
    expect(finality.headline).not.toContain("no recoverable content")
    // Nothing to rebuild, so nothing is listed. Advice about a rebuild that is
    // not necessary reads as a rebuild that is.
    expect(finality.inputs).toEqual([])
  })

  test("PURGING is already unrecoverable, because a half-purged tenant is not a tenant", () => {
    const finality = purgeFinality("PURGING")!
    expect(finality.content).toBe("being-destroyed")
    expect(finality.inputs.length).toBeGreaterThan(0)
  })

  test("no other state carries this disclosure at all", () => {
    const carrying = ALL_STATES.filter((s: TenantState) => purgeFinality(s) !== null)
    expect(carrying.sort()).toEqual(
      ["PURGED_ZERO_INCREMENTAL_COST", "PURGE_PENDING", "PURGING"].sort(),
    )
  })

  test("the one-sentence form is empty where the question does not arise", () => {
    expect(purgeFinalitySentence("ACTIVE")).toBe("")
    expect(purgeFinalitySentence("HIBERNATED_ZERO_RUNTIME")).toBe("")
    expect(purgeFinalitySentence("PURGED_ZERO_INCREMENTAL_COST")).toContain("no recoverable content")
  })
})

test.describe("the consequence panel says it before the move", () => {
  test("PURGING → PURGED carries the content sentence beside the lifecycle one", () => {
    const risk = riskOf("acme-university", "PURGING", "PURGED_ZERO_INCREMENTAL_COST", NO_RETAINED, [])
    expect(risk.reversibility).toContain("IRREVERSIBLE")
    expect(risk.reversibility).toContain("no recoverable content")
  })

  test("PURGE_PENDING → PURGING says destruction has started, not that it is finished", () => {
    const risk = riskOf("acme-university", "PURGE_PENDING", "PURGING", NO_RETAINED, [])
    expect(risk.reversibility).toContain("Destruction has started")
  })

  test("an ordinary move gains nothing — the sentence appears only where it is true", () => {
    const risk = riskOf("acme-university", "ACTIVE", "IDLE", NO_RETAINED, [])
    expect(risk.reversibility).toBe("Reversible. A serving state is reachable again from IDLE.")
  })

  test("appending it does not break the consequence classifier that reads the first word", () => {
    // `DangerZone.classifyConsequence` throws on a reversibility line that
    // begins with neither word. Prepending would have broken every purge
    // control on the page, silently, at render time.
    for (const to of ["PURGING", "PURGED_ZERO_INCREMENTAL_COST", "IDLE"] as TenantState[]) {
      const risk = riskOf("acme-university", "PURGE_PENDING", to, NO_RETAINED, [])
      expect(() => classifyConsequence(risk)).not.toThrow()
    }
    expect(
      classifyConsequence(
        riskOf("acme-university", "PURGING", "PURGED_ZERO_INCREMENTAL_COST", NO_RETAINED, []),
      ),
    ).toBe("irreversible")
  })
})

test("the tenant page renders it after the move, on the card that says there is no way out", () => {
  // A helper's own test cannot see a producer that stopped calling it.
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "tenants", "[slug]", "page.tsx"),
    "utf8",
  )
  expect(page).toContain('from "@/lib/purge-finality"')
  expect(page).toContain("purgeFinality(tenant.state)")
  expect(page).toContain('data-testid="purge-finality"')
  // The headline, the rebuild sentence and what the Parent keeps all reach the
  // page. Rendering only the headline would drop the half of the requirement
  // that says how a tenant comes back.
  expect(page).toContain("finality.headline")
  expect(page).toContain("finality.rebuild")
  expect(page).toContain("finality.parentRetains")
})
