import {
  ReleaseError,
  breakingChanges,
  createRelease,
  diffReleases,
  rollbackTo,
  transition,
  validateSystem,
  type ReleaseInput,
  type SystemRelease,
} from "./index"

const AT = "2026-07-31T12:00:00Z"
const CONFIG = "sha256:aaaa"
const CONFIG2 = "sha256:bbbb"

const input = (over: Partial<ReleaseInput> = {}): ReleaseInput => ({
  tenantId: "rochester",
  blueprintId: "university-student-organizations",
  blueprintVersion: "1.0.0",
  topologyId: "university-student-organizations",
  topologyVersion: "1.0.0",
  modules: [
    { key: "dashboard", version: "1.0.0" },
    { key: "organizations", version: "1.0.0" },
    { key: "approvals", version: "1.0.0" },
  ],
  configurationChecksum: CONFIG,
  policyIds: ["sod.notOwnRequest"],
  notes: "Initial system for Simon OSE.",
  createdBy: "operator@tenure",
  createdAt: AT,
  ...over,
})

const activate = (r: SystemRelease, approver = "approver@tenure") =>
  transition(transition(transition(r, "validated"), "approved", { actor: approver, at: AT }), "active")

describe("a release is an immutable statement of what a system is", () => {
  it("records the whole combination and hashes it", () => {
    const r = createRelease(input())
    expect(r.releaseId).toBe("rochester@r1")
    expect(r.revision).toBe(1)
    expect(r.state).toBe("draft")
    expect(r.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(r)).toBe(true)
  })

  it("hashes by content, not by the order modules were listed in", () => {
    const a = createRelease(input())
    const b = createRelease(
      input({
        modules: [
          { key: "approvals", version: "1.0.0" },
          { key: "dashboard", version: "1.0.0" },
          { key: "organizations", version: "1.0.0" },
        ],
      }),
    )
    expect(a.checksum).toBe(b.checksum)
  })

  it("changes the checksum when any part of the system changes", () => {
    const base = createRelease(input())
    expect(createRelease(input({ configurationChecksum: CONFIG2 })).checksum).not.toBe(base.checksum)
    expect(
      createRelease(input({ modules: [{ key: "dashboard", version: "2.0.0" }] })).checksum,
    ).not.toBe(base.checksum)
    expect(createRelease(input({ policyIds: [] })).checksum).not.toBe(base.checksum)
  })

  it("refuses a release that would produce a system doing nothing", () => {
    expect(() => createRelease(input({ modules: [] }))).toThrow(/no modules/)
  })

  it("requires notes, a creator and a tenant", () => {
    expect(() => createRelease(input({ notes: "  " }))).toThrow(/needs notes/)
    expect(() => createRelease(input({ createdBy: "" }))).toThrow(/who created it/)
    expect(() => createRelease(input({ tenantId: "" }))).toThrow(/must name a tenant/)
  })

  it("refuses a configuration checksum that is not one", () => {
    expect(() => createRelease(input({ configurationChecksum: "latest" }))).toThrow(
      /must be a resolved configuration's checksum/,
    )
  })

  it("refuses a candidate identical to the active release", () => {
    // Otherwise "which release introduced this?" stops having one answer.
    const active = activate(createRelease(input()))
    expect(() => createRelease(input({ previous: active }))).toThrow(/Nothing changed/)
  })

  it("refuses to follow another tenant's release", () => {
    const other = createRelease(input({ tenantId: "midtown-arts" }))
    expect(() => createRelease(input({ previous: other }))).toThrow(/belongs to tenant "midtown-arts"/)
  })
})

describe("the lifecycle is a state machine, not a status field", () => {
  it("walks draft → validated → approved → active", () => {
    const r = createRelease(input())
    const validated = transition(r, "validated")
    const approved = transition(validated, "approved", { actor: "approver@tenure", at: AT })
    const active = transition(approved, "active")

    expect([validated.state, approved.state, active.state]).toEqual(["validated", "approved", "active"])
    expect(approved.approvedBy).toBe("approver@tenure")
  })

  it("refuses a transition that skips the gates, naming both states", () => {
    const r = createRelease(input())
    expect(() => transition(r, "active")).toThrow(/from "draft" to "active"/)
    expect(() => transition(r, "active")).toThrow(/Legal from "draft": validated, rejected/)
  })

  it("refuses to move out of a terminal state", () => {
    const superseded = transition(activate(createRelease(input())), "superseded")
    expect(() => transition(superseded, "active")).toThrow(/\(terminal\)/)
  })

  it("will not let the author approve their own release", () => {
    // The same separation of duties the approvals module enforces for spend. A
    // release only one person has seen has not been reviewed.
    const r = transition(createRelease(input()), "validated")
    expect(() => transition(r, "approved", { actor: "operator@tenure", at: AT })).toThrow(
      /created this release and cannot also approve it/,
    )
  })

  it("requires an approver at all", () => {
    const r = transition(createRelease(input()), "validated")
    expect(() => transition(r, "approved")).toThrow(/requires an approver/)
  })

  it("never mutates — a reference held elsewhere keeps meaning what it meant", () => {
    const r = createRelease(input())
    const validated = transition(r, "validated")
    expect(r.state).toBe("draft")
    expect(validated).not.toBe(r)
  })
})

describe("rollback is append-only", () => {
  const r1 = activate(createRelease(input()))
  const r2 = activate(
    createRelease(
      input({
        previous: transition(r1, "superseded"),
        configurationChecksum: CONFIG2,
        notes: "Renamed the staff office.",
      }),
    ),
  )

  it("publishes the old content as a NEW revision", () => {
    // Reactivating r1 would make revisions non-monotonic and leave two periods
    // sharing one number, so "what was live at 14:05?" would have two answers.
    const { rolledBack, restored } = rollbackTo(r2, r1, {
      actor: "operator@tenure",
      at: AT,
      notes: "The rename confused everyone; going back.",
    })

    expect(rolledBack.state).toBe("rolled-back")
    expect(rolledBack.rolledBackTo).toBe(1)
    expect(restored.revision).toBe(3)
    expect(restored.supersedes).toBe(2)
  })

  it("restores content byte-identical to the target", () => {
    const { restored } = rollbackTo(r2, r1, { actor: "op", at: AT, notes: "back" })
    expect(restored.checksum).toBe(r1.checksum)
    expect(restored.configurationChecksum).toBe(CONFIG)
  })

  it("refuses to roll back to something not earlier", () => {
    expect(() => rollbackTo(r2, r2, { actor: "op", at: AT, notes: "x" })).toThrow(/not earlier/)
  })

  it("refuses to roll back a release that is not active", () => {
    const draft = createRelease(input({ notes: "draft" }))
    expect(() => rollbackTo(draft, r1, { actor: "op", at: AT, notes: "x" })).toThrow(
      /Only an active release can be rolled back/,
    )
  })

  it("refuses to roll back across tenants", () => {
    const foreign = { ...r1, tenantId: "midtown-arts" }
    expect(() => rollbackTo(r2, foreign, { actor: "op", at: AT, notes: "x" })).toThrow(
      /across tenants/,
    )
  })
})

describe("a diff is what an approver reads before saying yes", () => {
  const before = createRelease(input())
  const after = createRelease(
    input({
      previous: transition(activate(before), "superseded"),
      configurationChecksum: CONFIG2,
      modules: [
        { key: "dashboard", version: "1.0.0" },
        { key: "organizations", version: "2.0.0" },
        { key: "events", version: "1.0.0" },
      ],
      policyIds: [],
      notes: "Second release.",
    }),
  )

  it("reports added, removed and changed modules by key", () => {
    const diff = diffReleases(before, after)
    expect(diff).toEqual(
      expect.arrayContaining([
        { field: "modules.events", change: "added", after: "1.0.0" },
        { field: "modules.approvals", change: "removed", before: "1.0.0" },
        { field: "modules.organizations", change: "changed", before: "1.0.0", after: "2.0.0" },
        { field: "configurationChecksum", change: "changed", before: CONFIG, after: CONFIG2 },
        { field: "policies.sod.notOwnRequest", change: "removed", before: "sod.notOwnRequest" },
      ]),
    )
  })

  it("separates the changes that remove capability from a running system", () => {
    // These are the ones that break a tenant rather than merely change it: a
    // removed module takes its routes with it, a removed policy silently widens
    // who can do what.
    const breaking = breakingChanges(diffReleases(before, after))
    expect(breaking.map((b) => b.field).sort()).toEqual([
      "modules.approvals",
      "policies.sod.notOwnRequest",
    ])
  })

  it("reports nothing for two identical systems", () => {
    expect(diffReleases(before, createRelease(input({ notes: "same content" })))).toEqual([])
  })
})

describe("validation checks the combination, not just the parts", () => {
  const clean = {
    input: input(),
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: ["dashboard", "organizations", "approvals"],
  }

  it("passes a coherent system", () => {
    expect(validateSystem(clean)).toEqual({ valid: true, problems: [] })
  })

  it("refuses a release pinning a module the resolver refused", () => {
    // Four valid parts, one broken system: the manifest and the behaviour would
    // disagree, and the manifest is what everything downstream cites.
    const r = validateSystem({ ...clean, enabledModuleKeys: ["dashboard", "organizations"] })
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "coherence",
      detail: `Release pins module "approvals", which the resolver did not enable.`,
    })
  })

  it("refuses a module that is enabled but not pinned", () => {
    const r = validateSystem({
      ...clean,
      enabledModuleKeys: [...clean.enabledModuleKeys, "events"],
    })
    expect(r.problems).toContainEqual({
      area: "coherence",
      detail: `Module "events" is enabled but not pinned in the release. An unpinned module can change under a released system.`,
    })
  })

  it("surfaces module, configuration and topology problems together", () => {
    // An operator fixing a system wants the list, not a sequence of
    // single-problem rejections.
    const r = validateSystem({
      ...clean,
      moduleProblems: [{ moduleKey: "budgeting", reason: "missing-entitlement", detail: "no finance" }],
      configurationProblems: [{ key: "platform.x", reason: "unknown-key", detail: "no definition" }],
      topologyValid: false,
      topologyProblems: ["Type 'ghost' is unreachable."],
    })
    expect(r.valid).toBe(false)
    expect(r.problems.map((p) => p.area).sort()).toEqual(["configuration", "modules", "topology"])
  })

  it("refuses a module pinned without a version", () => {
    const r = validateSystem({
      ...clean,
      input: input({ modules: [{ key: "dashboard", version: "" }] }),
      enabledModuleKeys: ["dashboard"],
    })
    expect(r.problems).toContainEqual({
      area: "release",
      detail: `Module "dashboard" is pinned with no version.`,
    })
  })

  it("refuses duplicate policy ids", () => {
    const r = validateSystem({
      ...clean,
      input: input({ policyIds: ["sod.notOwnRequest", "sod.notOwnRequest"] }),
    })
    expect(r.problems).toContainEqual({ area: "release", detail: `Duplicate policy ids in the release.` })
  })
})

describe("errors are typed", () => {
  it("throws ReleaseError, not a bare Error", () => {
    expect(() => createRelease(input({ modules: [] }))).toThrow(ReleaseError)
  })
})
