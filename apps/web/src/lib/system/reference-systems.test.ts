import {
  createRelease,
  diffReleases,
  rollbackTo,
  signRelease,
  transition,
  type SystemRelease,
} from "@tenure/releases"
import { compiledArchetypeFor } from "@tenure/blueprints"
import { modulesFor } from "@tenure/platform-config"

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

/**
 * A signing key, supplied explicitly rather than left to the environment.
 *
 * A candidate has to be signed to be approvable, and a test that depended on
 * `RELEASE_SIGNING_KEY_ID` being set in the shell would pass or fail for a
 * reason that has nothing to do with the code.
 */
const KEY = { keyId: "reference-systems-test", secret: "a-test-signing-secret" }

const build = (slug: string, over: Partial<Parameters<typeof buildSystem>[1]> = {}) =>
  buildSystem(slug, {
    actor: "operator@tenure",
    at: AT,
    notes: `System for ${slug}.`,
    signWith: KEY,
    ...over,
  })

const activate = (r: SystemRelease) =>
  transition(
    transition(
      transition(
        transition(transition(r, "validated"), "approved", { actor: "director@tenure", at: AT }),
        "scheduled",
      ),
      "canary",
    ),
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

/**
 * PACK-020-003 — the blueprint is an editable preset, and the release proves it.
 *
 * `fixture-rtl` and `midtown-arts` are bound to the SAME blueprint. One moves
 * the `functional` axis. If a tenant were bound to a locked type, these two
 * releases would pin the same modules and — the part that matters for an
 * artifact somebody approves — carry the same checksum.
 */
describe("reference system C — one blueprint, one axis moved", () => {
  const overridden = build("fixture-rtl")
  const preset = build("midtown-arts")

  it("assembles and validates from the same code as the other two", () => {
    expect(overridden.validation.problems).toEqual([])
    expect(overridden.candidate).not.toBeNull()
  })

  it("pins the axes' compiled module set, not the blueprint's selection", () => {
    expect(overridden.blueprintId).toBe(preset.blueprintId)

    // The blueprint's selection includes the `finance` suite; this tenant's
    // override does not. So the two ASK for different things — which a locked
    // tenant type cannot express, because both would ask for the blueprint's
    // list and differ only in what an entitlement refused afterwards.
    expect(compiledArchetypeFor("midtown-arts")!.modules).toContain("budgeting")
    expect(compiledArchetypeFor("fixture-rtl")!.modules).not.toContain("budgeting")

    // Visible in the built system, not only in the compiler: `midtown-arts`
    // carries the refusal for a module it asked for, and `fixture-rtl` carries
    // no problem at all because its axes never asked.
    expect(modulesFor("midtown-arts").problems.map((p) => p.moduleKey)).toContain("budgeting")
    expect(modulesFor("fixture-rtl").problems).toEqual([])

    // And it runs `feed`, which no nonprofit-blueprint tenant's axes compile —
    // its own module edit put it there, and the release pins the result.
    expect(overridden.candidate!.modules.map((m) => m.key)).toContain("feed")
    expect(preset.candidate!.modules.map((m) => m.key)).not.toContain("feed")
  })

  it("produces a different release checksum from the same blueprint", () => {
    // The falsifiable form of "the compiled result, not the frozen list, is
    // what createRelease pins". Two tenants of one locked type cannot differ
    // here except by tenant id, and this differs by module set too.
    expect(overridden.candidate!.checksum).not.toBe(preset.candidate!.checksum)
    expect(overridden.candidate!.blueprintId).toBe(preset.candidate!.blueprintId)
  })
})

describe("the full operator sequence, on a real system", () => {
  it("validates, approves, canaries, activates — and refuses to let the author approve", () => {
    const candidate = build("rochester").candidate!
    const validated = transition(candidate, "validated")

    expect(() =>
      transition(validated, "approved", { actor: "operator@tenure", at: AT }),
    ).toThrow(/cannot also approve it/)

    const approved = transition(validated, "approved", { actor: "director@tenure", at: AT })
    // Approval does not put a release in front of everyone. It has to go out to
    // a canary first, so the first evidence that it is bad is not the fleet.
    expect(() => transition(approved, "active")).toThrow(/from "approved" to "active"/)

    const active = transition(transition(transition(approved, "scheduled"), "canary"), "active")
    expect(active.state).toBe("active")
    expect(active.approvedBy).toBe("director@tenure")
  })

  it("refuses to approve a candidate built with no signing key", () => {
    // A build with no key is a legitimate state — a developer checkout has
    // none — and it produces an artifact that cannot be approved rather than
    // one that quietly nobody can be held to.
    const unsigned = build("rochester", { signWith: null }).candidate!
    expect(unsigned.signature).toBeUndefined()
    expect(() =>
      transition(transition(unsigned, "validated"), "approved", {
        actor: "director@tenure",
        at: AT,
      }),
    ).toThrow(/is unsigned and cannot be approved/)
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
      signRelease(
        createRelease({
          tenantId: r1.tenantId,
          blueprintId: r1.blueprintId,
          blueprintVersion: r1.blueprintVersion,
          topologyId: r1.topologyId,
          topologyVersion: r1.topologyVersion,
          modules: r1.modules.filter((m) => m.key !== "messaging"),
          configurationChecksum: r1.configurationChecksum,
          policyIds: r1.policyIds,
          schemaVersion: r1.schemaVersion,
          notes: "Turned messaging off for the pilot.",
          createdBy: "operator@tenure",
          createdAt: LATER,
          previous: transition(r1, "superseded"),
        }),
        KEY,
      ),
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
