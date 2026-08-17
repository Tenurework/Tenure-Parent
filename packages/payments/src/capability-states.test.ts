import fs from "node:fs"
import path from "node:path"

import { modulesFor } from "@tenure/platform-config"

import {
  CAPABILITY_STATES,
  PAYMENT_CAPABILITIES,
  PaymentCapabilityError,
  STATES_REQUIRING_APPROVAL,
  assertRegistry,
  capabilityState,
  isTransactable,
  type CapabilityState,
  type PaymentCapability,
} from "./capability-registry"

/**
 * PAY-010-004 — the ten lifecycle states, checked against the line that asks for them.
 *
 * `CAPABILITY_STATES` was written for PAY-000-008 and nothing ever compared it
 * to the requirement. That is the failure mode this file removes: a vocabulary
 * that looks right in review is a vocabulary nobody can refute, and a state
 * quietly dropped from the array — `INTERNAL_PREVIEW` is the one somebody would
 * drop, because nothing in the shipped registry uses it — takes every guard that
 * switches on it with it.
 *
 * So the ten names are READ OUT OF THE BIBLE'S PAY-010-004 LINE and compared, in
 * order, to the array. A rename in either place reds. A copied list here could
 * only ever fail in one direction.
 *
 * The rest is the part "add the states" has to mean if it is to mean anything:
 * an eleventh state is refused rather than stored, the effective window beats
 * the stored word for every one of the ten, exactly three of them are
 * transactable, and the production read path reports one of the ten to the
 * module list rather than a boolean.
 */

const BIBLE = "Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md"

function repoRoot(): string {
  let dir = process.cwd()
  for (;;) {
    if (fs.existsSync(path.join(dir, "docs", "decisions"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`no ancestor of ${process.cwd()} contains docs/decisions`)
    dir = parent
  }
}

/** The states PAY-010-004 names, in the order its own sentence names them. */
function statesTheBibleAsksFor(): string[] {
  const text = fs.readFileSync(path.join(repoRoot(), BIBLE), "utf8")
  const line = text.split(/\r?\n/).find((l) => l.includes("PAY-010-004"))
  if (!line) throw new Error(`PAY-010-004 is not in ${BIBLE}.`)
  return [...line.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])
}

const base: PaymentCapability = PAYMENT_CAPABILITIES[0]

describe("the state vocabulary is the requirement's, in the requirement's order", () => {
  it("reads ten states out of PAY-010-004's own sentence", () => {
    // Pinned by value first: a parser returning [] would make the comparison
    // below pass against anything at all.
    expect(statesTheBibleAsksFor()).toEqual([
      "DISCOVERED",
      "ARCHITECTED",
      "PLANNED",
      "BUILDING",
      "INTERNAL_PREVIEW",
      "TENANT_PILOT",
      "GA_LIMITED",
      "GA",
      "DEPRECATED",
      "UNSUPPORTED",
    ])
  })

  it("declares exactly those ten, in that order", () => {
    // MUTATION TARGET: deleting "INTERNAL_PREVIEW" from CAPABILITY_STATES, or
    // reordering the array, reds here.
    expect([...CAPABILITY_STATES]).toEqual(statesTheBibleAsksFor())
  })

  it("refuses an eleventh state rather than storing it", () => {
    let error: unknown
    try {
      assertRegistry([{ ...base, state: "LIVE" as CapabilityState }], { adrExists: () => true })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentCapabilityError)
    expect((error as PaymentCapabilityError).code).toBe("capability-unknown-state")
  })

  it("accepts every one of the ten as a state a leaf may hold", () => {
    for (const state of CAPABILITY_STATES) {
      expect(() =>
        assertRegistry([{ ...base, state, approvedBy: { adr: "docs/decisions/x.md" } }], {
          adrExists: () => true,
        }),
      ).not.toThrow()
    }
  })
})

describe("the states are load-bearing, not labels", () => {
  it("puts exactly three of the ten in front of a tenant's money", () => {
    const transactable = CAPABILITY_STATES.filter((state) => isTransactable(state))
    expect(transactable).toEqual(["TENANT_PILOT", "GA_LIMITED", "GA"])
    expect([...STATES_REQUIRING_APPROVAL]).toEqual(transactable)
    // DEPRECATED is deliberately NOT transactable. A capability being wound
    // down may not take a new payment; the wind-down of payments already taken
    // is a different question, and one this registry does not answer.
    expect(isTransactable("DEPRECATED")).toBe(false)
  })

  it("lets the effective window overrule the stored word, whichever of the ten it is", () => {
    const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === "acceptance.card-and-wallet")!
    const original = leaf.state
    try {
      for (const state of CAPABILITY_STATES) {
        ;(leaf as { state: CapabilityState }).state = state
        // Before `effectiveFrom` (2026-01-01) every state reads UNSUPPORTED: an
        // uncommenced certification is exactly as unavailable as none.
        expect(capabilityState(leaf.id, "2025-06-01T00:00:00.000Z")).toBe("UNSUPPORTED")
        expect(capabilityState(leaf.id, "2026-06-01T00:00:00.000Z")).toBe(state)
      }
    } finally {
      ;(leaf as { state: CapabilityState }).state = original
    }
    expect(capabilityState("acceptance.card-and-wallet", "2026-06-01T00:00:00.000Z")).toBe(original)
  })

  it("gives every shipped leaf one of the ten, and none of them a transactable one", () => {
    for (const cap of PAYMENT_CAPABILITIES) {
      expect(CAPABILITY_STATES).toContain(cap.state)
      expect(isTransactable(cap.state)).toBe(false)
    }
  })
})

describe("the module list reads a state, not a boolean", () => {
  it("carries one of the ten onto every payments row a tenant's modules produce", () => {
    // The production consumer: `packages/platform-config/src/modules.ts` calls
    // `capabilityAvailabilityForModules` at both of its return sites, and
    // `modulesFor` is what the app asks for a tenant's modules. Driving it here
    // is what makes the vocabulary shipped rather than exported.
    const { paymentCapabilities } = modulesFor("rochester")
    expect(paymentCapabilities.length).toBeGreaterThan(0)
    for (const row of paymentCapabilities) {
      expect(CAPABILITY_STATES).toContain(row.state)
      expect(row.transactable).toBe(isTransactable(row.state))
      expect(row.transactable).toBe(false)
    }
  })
})
