import { MODULE_CATALOG } from "@tenure/modules"
import { compareVersions, parseVersion } from "@tenure/platform-config"
import { transition, validateSystem, verifyRelease, type SystemRelease } from "@tenure/releases"

import { ROLLOUT_PATH, buildSystem, planPromotion, systemUnderValidation } from "./build-system"

/**
 * The gates a release passes on the way out, exercised through the one function
 * that assembles a system rather than through a hand-built fixture.
 *
 * `reference-systems.test.ts` beside this holds the claim that two different
 * organizations come out of one codebase. This file holds the claim that the
 * artifact that comes out is signed, pins the schema it runs on, cannot quietly
 * move a version backwards, and cannot reach every tenant without a canary
 * first — each through `buildSystem` and `planPromotion`, which are what the
 * System Studio calls.
 */

const AT = "2026-07-31T12:00:00Z"
const KEY = { keyId: "build-system-test", secret: "a-test-signing-secret" }
const COMPATIBLE = { compatible: true, problems: [] as const }

const build = (slug: string, over: Partial<Parameters<typeof buildSystem>[1]> = {}) =>
  buildSystem(slug, {
    actor: "system-studio@tenure",
    at: AT,
    notes: `System for ${slug}.`,
    signWith: KEY,
    ...over,
  })

const promote = (candidate: SystemRelease, over: Partial<Parameters<typeof planPromotion>[0]> = {}) =>
  planPromotion({
    candidate,
    validation: { valid: true, problems: [] },
    compatibility: COMPATIBLE,
    approver: "director@tenure",
    at: AT,
    ...over,
  })

describe("the assembled candidate is signed, and verifiably so", () => {
  const system = build("rochester")

  it("signs the artifact with the key it was given", () => {
    expect(system.candidate!.signature).toMatchObject({
      keyId: KEY.keyId,
      algorithm: "hmac-sha256",
    })
    expect(verifyRelease(system.candidate!, (id) => (id === KEY.keyId ? KEY.secret : undefined))).toEqual(
      { valid: true, keyId: KEY.keyId },
    )
  })

  it("produces a signature that does not verify once the artifact is altered", () => {
    // The property a checksum cannot supply: anyone who can alter the artifact
    // can recompute a checksum over their alteration.
    const altered = { ...system.candidate!, modules: [{ key: "dashboard", version: "9.9.9" }] }
    expect(
      verifyRelease(altered, (id) => (id === KEY.keyId ? KEY.secret : undefined)).valid,
    ).toBe(false)
  })
})

describe("the assembled candidate pins the schema it runs on", () => {
  it("carries the schema into the artifact and into its checksum", () => {
    const a = build("rochester", { schemaVersion: "20260806180000_activation_gates_serving" })
    const b = build("rochester", { schemaVersion: "20260803070000_seat_is_not_a_role" })

    expect(a.candidate!.schemaVersion).toBe("20260806180000_activation_gates_serving")
    // Identical systems, different database shapes, therefore different
    // artifacts. Before the schema was inside the content these hashed alike.
    expect(a.candidate!.checksum).not.toBe(b.candidate!.checksum)
  })

  it("refuses a candidate pinning a migration the target has not applied", () => {
    const system = build("rochester", {
      schemaVersion: "20260806180000_activation_gates_serving",
      appliedMigrations: ["20260730000000_baseline"],
    })
    expect(system.validation.valid).toBe(false)
    expect(system.validation.problems.map((p) => p.detail).join(" ")).toContain(
      `pins schema "20260806180000_activation_gates_serving", which the target reports as unapplied`,
    )
    // ...and therefore produces nothing to promote.
    expect(system.candidate).toBeNull()
  })

  it("accepts the same candidate once the target reports the migration applied", () => {
    const system = build("rochester", {
      schemaVersion: "20260806180000_activation_gates_serving",
      appliedMigrations: ["20260730000000_baseline", "20260806180000_activation_gates_serving"],
    })
    expect(system.validation.problems).toEqual([])
    expect(system.candidate).not.toBeNull()
  })
})

describe("the production assembler orders module versions numerically", () => {
  const system = build("rochester")

  /** The candidate's own pins, with one module moved to `version`. */
  const previousWith = (key: string, version: string) =>
    system.candidate!.modules.map((m) => (m.key === key ? { key, version } : m))

  it("refuses a pin below the release it would replace", () => {
    const previous = {
      ...system.candidate!,
      modules: previousWith("approvals", "2.0.0"),
    } as SystemRelease

    const downgraded = build("rochester", { previous, notes: "Rolling approvals back quietly." })
    expect(downgraded.validation.valid).toBe(false)
    expect(downgraded.validation.problems).toContainEqual({
      area: "release",
      detail:
        `Module "approvals" is pinned at 1.0.0, below the active release's 2.0.0. ` +
        `A downgrade must be an explicit rollback, not a validated candidate.`,
    })
  })

  it("accepts 1.10.0 over 1.9.0 — the case a string compare gets wrong", () => {
    // Proves the comparator the assembler injects is the numeric one. This is
    // the assertion that fails if `compare` is dropped in favour of `<`.
    const previous = {
      ...system.candidate!,
      modules: previousWith("approvals", "0.9.0"),
    } as SystemRelease

    expect(compareVersions(parseVersion("1.9.0"), parseVersion("1.10.0"))).toBeLessThan(0)
    const forward = build("rochester", { previous, notes: "Approvals moved forward." })
    expect(forward.validation.problems.filter((p) => p.detail.includes("below the active"))).toEqual(
      [],
    )
  })
})

describe("a system must be able to finish the work it accepts", () => {
  const system = build("rochester")

  it("declares chains whose every step names a module the catalog ships", () => {
    const keys = new Set(MODULE_CATALOG.all().map((m) => m.key))
    for (const chain of MODULE_CATALOG.chains()) {
      for (const step of chain.steps) {
        expect(keys.has(step.module)).toBe(true)
      }
    }
    expect(MODULE_CATALOG.chains().length).toBeGreaterThan(0)
  })

  it("passes the pilot, which enables every step of every chain it starts", () => {
    expect(system.validation.problems).toEqual([])
  })

  it("refuses the same system with a chain's later step removed, naming the step", () => {
    // Driven through the real assembler's inputs rather than a fixture: the
    // pins, the chains and the enabled set are the ones `buildSystem` produced,
    // with exactly one module taken out of the enabled set — a system whose
    // approvals module accepts requests nothing can finish.
    const chain = MODULE_CATALOG.chains()[0]
    const dropped = chain.steps[chain.steps.length - 1].module
    const kept = system.moduleKeys.filter((k) => k !== dropped)

    // Through `systemUnderValidation` — the same function `buildSystem` uses to
    // put its question — so this fails if the chains stop being attached there,
    // rather than passing because the test remembered to attach them itself.
    const result = validateSystem(
      systemUnderValidation({
        input: {
          tenantId: system.tenantId,
          blueprintId: system.blueprintId,
          blueprintVersion: system.blueprintVersion,
          topologyId: system.candidate!.topologyId,
          topologyVersion: system.candidate!.topologyVersion,
          modules: system.candidate!.modules.filter((m) => m.key !== dropped),
          configurationChecksum: system.configurationChecksum!,
          policyIds: system.policyIds,
          schemaVersion: system.schemaVersion,
          notes: "One chain step removed.",
          createdBy: "operator@tenure",
          createdAt: AT,
        },
        moduleProblems: [],
        configurationProblems: [],
        topologyValid: true,
        topologyProblems: [],
        enabledModuleKeys: kept,
      }),
    )

    expect(result.valid).toBe(false)

    // Asserted on the chain problem specifically, not merely on "invalid": a
    // dependency rule could refuse this set on its own, and a test that only
    // checked `valid === false` would pass with the chain check deleted.
    const coherence = result.problems.filter((p) => p.area === "coherence")
    expect(coherence.map((p) => p.detail).join(" ")).toContain(`needs module "${dropped}"`)
    expect(coherence.map((p) => p.detail).join(" ")).toContain(chain.chainId)
  })
})

describe("promotion walks the real gates and stops where they stop it", () => {
  const system = build("rochester")

  it("reaches active only by going through canary", () => {
    const plan = promote(system.candidate!)
    expect(plan.blocked).toBeNull()
    expect(plan.reachable).toBe("active")
    expect(plan.steps.map((s) => s.to)).toEqual([
      "validated",
      "approved",
      "scheduled",
      "canary",
      "active",
    ])
    expect(ROLLOUT_PATH).toContain("canary")
    // The state machine, not this plan, is what makes that true.
    expect(() =>
      transition(
        transition(transition(system.candidate!, "validated"), "approved", {
          actor: "director@tenure",
          at: AT,
        }),
        "active",
      ),
    ).toThrow(/from "approved" to "active"/)
  })

  it("blocks the promotion when the cell cannot honour a configuration key", () => {
    const plan = promote(system.candidate!, {
      compatibility: {
        compatible: false,
        problems: [
          {
            key: "platform.terminology.staffOfficeName",
            requires: "2026.8.0",
            running: "2026.7.0",
            reason: "unknown-key" as const,
          },
        ],
      },
    })

    expect(plan.reachable).toBe("validated")
    expect(plan.blocked).toContain("platform.terminology.staffOfficeName")
    expect(plan.steps.find((s) => s.to === "approved")!.reached).toBe(false)
  })

  it("blocks the promotion when the system did not validate", () => {
    const plan = promote(system.candidate!, {
      validation: { valid: false, problems: [{ area: "modules", detail: "budgeting: unknown" }] },
    })
    expect(plan.reachable).toBe("draft")
    expect(plan.blocked).toContain("budgeting: unknown")
  })

  it("stops at approval when the release removes capability nobody acknowledged", () => {
    // `breakingChanges` had no production caller at all; this is the gate that
    // gives it one. A module disappearing takes its routes and data surfaces
    // with it, which is not something to discover after promotion.
    const previous = {
      ...system.candidate!,
      modules: [...system.candidate!.modules, { key: "somethingRetired", version: "1.0.0" }],
    } as SystemRelease

    const blockedPlan = promote(system.candidate!, { previous })
    expect(blockedPlan.breaking.map((b) => b.field)).toContain("modules.somethingRetired")
    expect(blockedPlan.reachable).toBe("validated")
    expect(blockedPlan.blocked).toContain("removes capability")

    const acknowledged = promote(system.candidate!, { previous, acknowledgeBreaking: true })
    expect(acknowledged.reachable).toBe("active")
  })

  it("refuses to promote an unsigned candidate, at the approval gate", () => {
    const unsigned = build("rochester", { signWith: null }).candidate!
    const plan = promote(unsigned)
    expect(plan.reachable).toBe("validated")
    expect(plan.blocked).toMatch(/is unsigned and cannot be approved/)
  })
})
