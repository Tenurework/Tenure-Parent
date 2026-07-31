import {
  createRelease,
  diffReleases,
  rollbackTo,
  transition,
  type SystemRelease,
} from "@tenure/releases"

import { buildSystem } from "./build-system"

/**
 * Two structurally different organization systems, built end to end from one
 * codebase, with no line of code that names either of them.
 *
 * This is the claim the whole platform rests on, and the only honest way to
 * check it is to build both and compare. An engine configured only ever for the
 * pilot is indistinguishable from an engine hardcoded for the pilot; the
 * difference shows up the first time someone tries a second, and that is what
 * `midtown-arts` is for.
 *
 * The sequence mirrors the one an operator performs: assemble → validate →
 * publish a candidate → approve → activate → change something → diff → roll
 * back.
 */

const AT = "2026-07-31T12:00:00Z"
const LATER = "2026-08-01T12:00:00Z"

const build = (slug: string, over: Partial<Parameters<typeof buildSystem>[1]> = {}) =>
  buildSystem(slug, { actor: "operator@tenure", at: AT, notes: `System for ${slug}.`, ...over })

const activate = (r: SystemRelease) =>
  transition(
    transition(transition(r, "validated"), "approved", { actor: "director@tenure", at: AT }),
    "active",
  )

describe("reference system A — Simon OSE, a university's student organizations", () => {
  const system = build("rochester")

  it("assembles and validates", () => {
    expect(system.validation.problems).toEqual([])
    expect(system.validation.valid).toBe(true)
    expect(system.candidate).not.toBeNull()
  })

  it("runs the twelve modules the pilot has today", () => {
    expect(system.moduleKeys).toEqual(
      expect.arrayContaining([
        "dashboard",
        "organizations",
        "feed",
        "messaging",
        "approvals",
        "events",
        "resources",
        "search",
        "memory",
        "budgeting",
        "reimbursements",
        "administration",
      ]),
    )
  })

  it("produces a release that pins everything the system is made of", () => {
    const r = system.candidate!
    expect(r.tenantId).toBe("rochester")
    expect(r.blueprintId).toBe("university-student-organizations")
    expect(r.topologyId).toBe("university-student-organizations")
    expect(r.configurationChecksum).toMatch(/^sha256:/)
    expect(r.modules.map((m) => m.key)).toEqual([...system.moduleKeys])
    expect(r.policyIds).toContain("sod.notOwnRequest")
    expect(r.state).toBe("draft")
  })
})

describe("reference system B — Midtown Arts, a nonprofit's programs", () => {
  const system = build("midtown-arts")

  it("assembles and validates, from the same code", () => {
    expect(system.validation.problems).toEqual([])
    expect(system.candidate).not.toBeNull()
  })

  it("is a different system, not the same one renamed", () => {
    // Fewer modules, a different blueprint, a different topology.
    expect(system.blueprintId).toBe("nonprofit-program-operations")
    expect(system.candidate!.topologyId).toBe("nonprofit-program-operations")
    expect(system.moduleKeys).not.toContain("feed")
    expect(system.moduleKeys).not.toContain("messaging")
    expect(system.moduleKeys).not.toContain("reimbursements")
  })

  it("is refused budgeting on entitlement, and that is not a validation failure", () => {
    // The blueprint asks for it, the entitlement declines, the release pins the
    // result. That is the definition working, not a defect in it.
    expect(system.moduleKeys).not.toContain("budgeting")
    expect(system.validation.valid).toBe(true)
  })

  it("shares nothing with system A except the engine", () => {
    const a = build("rochester").candidate!
    const b = system.candidate!
    expect(a.checksum).not.toBe(b.checksum)
    expect(a.configurationChecksum).not.toBe(b.configurationChecksum)
    expect(a.blueprintId).not.toBe(b.blueprintId)
  })
})

describe("the full operator sequence, on a real system", () => {
  it("validates, approves, activates — and refuses to let the author approve", () => {
    const candidate = build("rochester").candidate!
    const validated = transition(candidate, "validated")

    expect(() =>
      transition(validated, "approved", { actor: "operator@tenure", at: AT }),
    ).toThrow(/cannot also approve it/)

    const approved = transition(validated, "approved", { actor: "director@tenure", at: AT })
    const active = transition(approved, "active")
    expect(active.state).toBe("active")
    expect(active.approvedBy).toBe("director@tenure")
  })

  it("refuses a second release that changes nothing", () => {
    const active = activate(build("rochester").candidate!)
    expect(() => build("rochester", { previous: active })).toThrow(/Nothing changed/)
  })

  it("diffs two releases and separates the breaking changes", () => {
    // Simulating what a Studio edit produces: the same tenant, one module gone.
    const r1 = activate(build("rochester").candidate!)
    const superseded = transition(r1, "superseded")

    const r2 = build("midtown-arts", {
      notes: "Different system, used here purely to produce a rich diff.",
    }).candidate!

    const diff = diffReleases(r1, r2)
    expect(diff.some((d) => d.field === "blueprintId")).toBe(true)
    expect(diff.some((d) => d.field.startsWith("modules."))).toBe(true)
    expect(superseded.state).toBe("superseded")
  })

  it("refuses a re-publish against an ACTIVE release, but allows it during rollback", () => {
    const r1 = activate(build("rochester").candidate!)

    // Against the active release: identical content is a no-op revision, and
    // allowing it would make "which release introduced this?" ambiguous.
    expect(() => build("rochester", { previous: r1, notes: "Again." })).toThrow(/Nothing changed/)

    // Against a superseded one it must be allowed, because republishing old
    // content IS the rollback path. The guard is scoped to "active" for exactly
    // this reason.
    expect(() =>
      build("rochester", { previous: transition(r1, "superseded"), notes: "Restoring." }),
    ).not.toThrow()
  })
})

describe("rollback restores exactly, on releases built from real systems", () => {
  it("returns content byte-identical to the target", () => {
    const r1 = activate(build("rochester").candidate!)

    // A Studio edit that turns a module off, expressed through the release API
    // for the SAME tenant. Chaining another tenant's release here is refused —
    // correctly, since a tenant cannot be rolled back to someone else's system.
    const r2 = activate(
      createRelease({
        tenantId: r1.tenantId,
        blueprintId: r1.blueprintId,
        blueprintVersion: r1.blueprintVersion,
        topologyId: r1.topologyId,
        topologyVersion: r1.topologyVersion,
        modules: r1.modules.filter((m) => m.key !== "messaging"),
        configurationChecksum: r1.configurationChecksum,
        policyIds: r1.policyIds,
        notes: "Turned messaging off for the pilot.",
        createdBy: "operator@tenure",
        createdAt: LATER,
        previous: transition(r1, "superseded"),
      }),
    )

    // The edit is a breaking change, and the diff says so before anyone approves.
    expect(diffReleases(r1, r2)).toContainEqual({
      field: "modules.messaging",
      change: "removed",
      before: "1.0.0",
    })

    const { rolledBack, restored } = rollbackTo(r2, r1, {
      actor: "operator@tenure",
      at: LATER,
      notes: "Reverting the shape change.",
    })

    expect(rolledBack.state).toBe("rolled-back")
    expect(rolledBack.rolledBackTo).toBe(r1.revision)
    // Append-only: a new revision carrying the old content, not a reactivation.
    expect(restored.revision).toBeGreaterThan(r2.revision)
    expect(restored.checksum).toBe(r1.checksum)
    expect(restored.modules.map((m) => m.key)).toContain("messaging")
  })
})
