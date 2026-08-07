import {
  ReleaseError,
  TRANSITIONS,
  breakingChanges,
  checksumOfRelease,
  createRelease,
  diffReleases,
  rollbackTo,
  signRelease,
  transition,
  validateSystem,
  verifyRelease,
  type ReleaseInput,
  type ReleaseState,
  type SystemRelease,
} from "./index"

const AT = "2026-07-31T12:00:00Z"
const CONFIG = "sha256:aaaa"
const CONFIG2 = "sha256:bbbb"
const SCHEMA = "20260806180000_activation_gates_serving"
const SCHEMA_OLDER = "20260803070000_seat_is_not_a_role"

const KEY = { keyId: "release-signing-2026", secret: "a-test-signing-secret" }
const KEYS: Record<string, string> = { [KEY.keyId]: KEY.secret }
const resolveKey = (keyId: string) => KEYS[keyId]

/**
 * A real `major.minor.patch` comparator, not a stand-in.
 *
 * Declared here rather than imported so this package keeps importing nothing;
 * the production caller injects `compareVersions` from
 * `@tenure/platform-config`, and `build-system.test.ts` is what holds THAT path
 * to the same ordering. A string compare would pass most of the assertions
 * below and fail the 1.9.0 → 1.10.0 one, which is why that case is here.
 */
const compare = (a: string, b: string): number => {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    if (!m) throw new Error(`not a version: ${JSON.stringify(v)}`)
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const [aMaj, aMin, aPatch] = parse(a)
  const [bMaj, bMin, bPatch] = parse(b)
  return aMaj - bMaj || aMin - bMin || aPatch - bPatch
}

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
  schemaVersion: SCHEMA,
  notes: "Initial system for Simon OSE.",
  createdBy: "operator@tenure",
  createdAt: AT,
  ...over,
})

/** A signed draft. Unsigned artifacts cannot be approved, so nothing else can start. */
const signed = (over: Partial<ReleaseInput> = {}) => signRelease(createRelease(input(over)), KEY)

/**
 * Draft → active, the whole way.
 *
 * Four moves rather than three: `approved → active` no longer exists, because
 * approval says a release may go out and not that the entire fleet takes it in
 * one step.
 */
const activate = (r: SystemRelease, approver = "approver@tenure") =>
  transition(
    transition(
      transition(
        transition(transition(r, "validated"), "approved", { actor: approver, at: AT }),
        "scheduled",
      ),
      "canary",
    ),
    "active",
  )

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
    const active = activate(signed())
    expect(() => createRelease(input({ previous: active }))).toThrow(/Nothing changed/)
  })

  it("refuses to follow another tenant's release", () => {
    const other = createRelease(input({ tenantId: "midtown-arts" }))
    expect(() => createRelease(input({ previous: other }))).toThrow(/belongs to tenant "midtown-arts"/)
  })
})

describe("the lifecycle is a state machine, not a status field", () => {
  it("walks draft → validated → approved → scheduled → canary → active", () => {
    const r = signed()
    const validated = transition(r, "validated")
    const approved = transition(validated, "approved", { actor: "approver@tenure", at: AT })
    const scheduled = transition(approved, "scheduled")
    const canary = transition(scheduled, "canary")
    const active = transition(canary, "active")

    expect([validated.state, approved.state, scheduled.state, canary.state, active.state]).toEqual([
      "validated",
      "approved",
      "scheduled",
      "canary",
      "active",
    ])
    expect(approved.approvedBy).toBe("approver@tenure")
  })

  it("makes active reachable ONLY through canary", () => {
    // Approval says a release may go out. It does not say the whole fleet takes
    // it at the same instant — which is what `approved → active` meant, and is
    // why the first evidence a release was bad was everyone having it.
    const reachActive = (Object.keys(TRANSITIONS) as ReleaseState[]).filter((from) =>
      TRANSITIONS[from].includes("active"),
    )
    expect(reachActive).toEqual(["canary"])

    const approved = transition(transition(signed(), "validated"), "approved", {
      actor: "approver@tenure",
      at: AT,
    })
    expect(() => transition(approved, "active")).toThrow(/from "approved" to "active"/)
    expect(() => transition(transition(approved, "scheduled"), "active")).toThrow(
      /Legal from "scheduled": canary, rejected/,
    )
  })

  it("refuses a transition that skips the gates, naming both states", () => {
    const r = signed()
    expect(() => transition(r, "active")).toThrow(/from "draft" to "active"/)
    expect(() => transition(r, "active")).toThrow(/Legal from "draft": validated, rejected/)
  })

  it("refuses to move out of a terminal state", () => {
    const superseded = transition(activate(signed()), "superseded")
    expect(() => transition(superseded, "active")).toThrow(/\(terminal\)/)
  })

  it("will not let the author approve their own release", () => {
    // The same separation of duties the approvals module enforces for spend. A
    // release only one person has seen has not been reviewed.
    const r = transition(signed(), "validated")
    expect(() => transition(r, "approved", { actor: "operator@tenure", at: AT })).toThrow(
      /created this release and cannot also approve it/,
    )
  })

  it("requires an approver at all", () => {
    const r = transition(signed(), "validated")
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
  const r1 = activate(signed())
  const r2 = activate(
    signed({
      previous: transition(r1, "superseded"),
      configurationChecksum: CONFIG2,
      notes: "Renamed the staff office.",
    }),
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
  const before = signed()
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
    const breaking = breakingChanges(diffReleases(before, after), compare)
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

describe("a release says who produced it, not only that it is self-consistent", () => {
  it("signs over exactly the bytes the checksum covers, and verifies", () => {
    const r = signRelease(createRelease(input()), KEY)
    expect(r.signature).toEqual({
      keyId: KEY.keyId,
      algorithm: "hmac-sha256",
      value: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(verifyRelease(r, resolveKey)).toEqual({ valid: true, keyId: KEY.keyId })
  })

  it("refuses a release whose content changed after signing", () => {
    // The mutation this whole field exists for: anyone able to alter the
    // artifact can recompute a CHECKSUM over their alteration, so a checksum
    // proves consistency and not provenance. A MAC they cannot recompute is
    // what makes "these are the versions adoption bound" a checkable claim.
    const r = signRelease(createRelease(input()), KEY)
    const tampered = { ...r, modules: [{ key: "dashboard", version: "9.9.9" }] }

    const verdict = verifyRelease(tampered, resolveKey)
    expect(verdict.valid).toBe(false)
    expect(verdict).toMatchObject({ reason: "content-altered" })
  })

  it("refuses a signature from a key it cannot resolve, rather than passing", () => {
    const r = signRelease(createRelease(input()), { keyId: "someone-elses-key", secret: "s" })
    expect(verifyRelease(r, resolveKey)).toMatchObject({ reason: "unknown-key" })
  })

  it("reports an unsigned release as unsigned rather than throwing", () => {
    expect(verifyRelease(createRelease(input()), resolveKey)).toMatchObject({ reason: "unsigned" })
  })

  it("will not sign with an empty key", () => {
    // A signature anyone can reproduce is worse than being visibly unsigned.
    expect(() => signRelease(createRelease(input()), { keyId: "k", secret: "" })).toThrow(
      /Refusing to sign with an empty key/,
    )
  })

  it("refuses to APPROVE an unsigned release — the gate is in the state machine", () => {
    // In the state machine rather than in a caller, because a gate in a caller
    // is a gate the next caller does not have.
    const unsigned = transition(createRelease(input()), "validated")
    expect(() => transition(unsigned, "approved", { actor: "approver@tenure", at: AT })).toThrow(
      /is unsigned and cannot be approved/,
    )
  })

  it("does not mutate the release it signs", () => {
    const r = createRelease(input())
    const s = signRelease(r, KEY)
    expect(r.signature).toBeUndefined()
    expect(s).not.toBe(r)
  })
})

describe("a release pins the database shape it runs on", () => {
  it("binds the schema INSIDE the checksum, not beside it", () => {
    // The assertion that proves it is bound rather than merely attached: two
    // systems identical in every other respect, running against different
    // migration states, are not the same system and must not hash alike.
    const a = createRelease(input())
    const b = createRelease(input({ schemaVersion: SCHEMA_OLDER }))
    expect(a.schemaVersion).toBe(SCHEMA)
    expect(a.checksum).not.toBe(b.checksum)
  })

  it("refuses a release that pins no schema at all", () => {
    expect(() => createRelease(input({ schemaVersion: "   " }))).toThrow(/must pin the schema/)
  })

  it("shows a schema move to the approver the diff exists to inform", () => {
    const before = createRelease(input({ schemaVersion: SCHEMA_OLDER }))
    const after = createRelease(input({ notes: "Migrated." }))
    expect(diffReleases(before, after)).toContainEqual({
      field: "schemaVersion",
      change: "changed",
      before: SCHEMA_OLDER,
      after: SCHEMA,
    })
  })

  it("treats a schema moving BACKWARDS as breaking", () => {
    const forward = createRelease(input())
    const backward = createRelease(input({ schemaVersion: SCHEMA_OLDER, notes: "Reverted." }))
    expect(breakingChanges(diffReleases(forward, backward), compare).map((b) => b.field)).toContain(
      "schemaVersion",
    )
    // ...and forwards is not.
    expect(breakingChanges(diffReleases(backward, forward), compare).map((b) => b.field)).not.toContain(
      "schemaVersion",
    )
  })

  it("still restores byte-identical content through a rollback", () => {
    // rollbackTo asserts this itself and throws if a field was dropped in the
    // copy; the new field has to survive that.
    const r1 = activate(signed({ schemaVersion: SCHEMA_OLDER }))
    const r2 = activate(
      signed({ previous: transition(r1, "superseded"), notes: "Migrated forward." }),
    )
    const { restored } = rollbackTo(r2, r1, { actor: "op", at: AT, notes: "back" })
    expect(restored.schemaVersion).toBe(SCHEMA_OLDER)
    expect(restored.checksum).toBe(r1.checksum)
  })
})

describe("a release cannot silently downgrade a pinned module", () => {
  const clean = {
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: ["dashboard", "organizations", "approvals"],
  }

  const at = (version: string) =>
    input({
      modules: [
        { key: "dashboard", version: "1.0.0" },
        { key: "organizations", version: "1.0.0" },
        { key: "approvals", version },
      ],
    })

  const previousAt = (version: string) => [
    { key: "dashboard", version: "1.0.0" },
    { key: "organizations", version: "1.0.0" },
    { key: "approvals", version },
  ]

  it("refuses a pin below the active release's, and says what to do instead", () => {
    const r = validateSystem({
      ...clean,
      input: at("1.0.0"),
      previousModules: previousAt("2.0.0"),
      compare,
    })
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "release",
      detail:
        `Module "approvals" is pinned at 1.0.0, below the active release's 2.0.0. ` +
        `A downgrade must be an explicit rollback, not a validated candidate.`,
    })
  })

  it("ACCEPTS 1.9.0 → 1.10.0, which a string compare would reject", () => {
    // The assertion that proves the ordering is numeric rather than merely
    // present. "1.10.0" < "1.9.0" as strings, so a lexicographic check would
    // refuse a legitimate tenth minor and nobody would notice until then.
    const r = validateSystem({
      ...clean,
      input: at("1.10.0"),
      previousModules: previousAt("1.9.0"),
      compare,
    })
    expect(r.problems.filter((p) => p.detail.includes("below the active release"))).toEqual([])
  })

  it("says so loudly when a previous release arrives with no comparator", () => {
    // Fails loud rather than open: silently skipping the check is exactly the
    // inert guard this replaced.
    const r = validateSystem({ ...clean, input: at("1.0.0"), previousModules: previousAt("2.0.0") })
    expect(r.valid).toBe(false)
    expect(r.problems[0].detail).toMatch(/without a version comparator/)
  })

  it("refuses a pin the catalog no longer ships", () => {
    const r = validateSystem({
      ...clean,
      input: at("1.0.0"),
      catalogVersions: { dashboard: "1.0.0", organizations: "1.0.0", approvals: "2.0.0" },
    })
    expect(r.problems).toContainEqual({
      area: "release",
      detail:
        `Module "approvals" is pinned at 1.0.0, but the catalog ships 2.0.0. ` +
        `The artifact would name a version this engine cannot produce.`,
    })
  })

  it("flags a module pin moving backwards as a breaking change", () => {
    const before = createRelease(at("2.0.0"))
    const after = createRelease(at("1.0.0"))
    expect(breakingChanges(diffReleases(before, after), compare)).toContainEqual({
      field: "modules.approvals",
      change: "changed",
      before: "2.0.0",
      after: "1.0.0",
    })
    // A forward move is a change, not a break.
    expect(breakingChanges(diffReleases(after, before), compare)).toEqual([])
  })
})

describe("a release names the schema the target is actually at", () => {
  const clean = {
    input: input(),
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: ["dashboard", "organizations", "approvals"],
  }

  it("refuses a schema the target reports as unapplied, naming the migration", () => {
    const r = validateSystem({ ...clean, appliedMigrations: [SCHEMA_OLDER] })
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "release",
      detail:
        `The release pins schema "${SCHEMA}", which the target reports as unapplied. ` +
        `Applied: ${SCHEMA_OLDER}.`,
    })
  })

  it("passes when the migration is applied", () => {
    expect(validateSystem({ ...clean, appliedMigrations: [SCHEMA_OLDER, SCHEMA] }).valid).toBe(true)
  })
})

describe("modules have to form a system that can finish its work", () => {
  const CHAIN = {
    chainId: "request-to-approval-to-memory",
    name: "Request → approval → memory",
    steps: [
      { module: "approvals", consumes: null, emits: "ApprovalRequested" },
      { module: "approvals", consumes: "ApprovalRequested", emits: "ApprovalDecided" },
      { module: "memory", consumes: "ApprovalDecided", emits: null },
    ],
  }

  const system = (keys: readonly string[]) => ({
    input: input({ modules: keys.map((key) => ({ key, version: "1.0.0" })) }),
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: keys,
    chains: [CHAIN],
  })

  it("refuses a system that starts a chain it cannot finish, naming the missing step", () => {
    const r = validateSystem(system(["dashboard", "organizations", "approvals"]))
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "coherence",
      detail:
        `The "Request → approval → memory" chain (request-to-approval-to-memory) starts in module ` +
        `"approvals" but cannot finish: step 3 handles "ApprovalDecided" and needs module ` +
        `"memory", which this system does not enable. Enable "memory", or take "approvals" out ` +
        `of this system — a step that accepts work it can never hand on fails in front of whoever ` +
        `raised it, not whoever composed it.`,
    })
  })

  it("passes the same system once the last step has somewhere to run", () => {
    expect(validateSystem(system(["dashboard", "organizations", "approvals", "memory"])).valid).toBe(
      true,
    )
  })

  it("does not hold a system to a chain it never starts", () => {
    // A tenant that does not run approvals has not left the chain half-built;
    // it is not in the chain. A check that fires on correct systems is one
    // people learn to route around.
    expect(validateSystem(system(["dashboard", "organizations"])).valid).toBe(true)
  })
})

describe("errors are typed", () => {
  it("throws ReleaseError, not a bare Error", () => {
    expect(() => createRelease(input({ modules: [] }))).toThrow(ReleaseError)
  })
})

describe("a release states what its modules were, not only which versions", () => {
  const base = {
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: ["dashboard", "organizations", "approvals"],
  }

  const pins = (over: Record<string, { lifecycle?: string; mode?: string }> = {}) =>
    input({
      modules: [
        { key: "dashboard", version: "1.0.0", lifecycle: "certified-limited", ...over.dashboard },
        {
          key: "organizations",
          version: "1.0.0",
          lifecycle: "certified-limited",
          ...over.organizations,
        },
        { key: "approvals", version: "1.0.0", lifecycle: "certified-limited", ...over.approvals },
      ],
    })

  it("passes a release whose pins are all enableable", () => {
    expect(validateSystem({ ...base, input: pins() })).toEqual({ valid: true, problems: [] })
  })

  it("refuses a release that pins a retired module", () => {
    // PACK-030-004. A version number cannot express "and nobody may run it".
    // The resolver refuses a retired module at resolution; an ARTIFACT outlives
    // the resolution that produced it, so it has to carry the refusal itself.
    const r = validateSystem({ ...base, input: pins({ approvals: { lifecycle: "retired" } }) })
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "release",
      detail:
        `Module "approvals" is pinned at 1.0.0 and its lifecycle is "retired". A release may not ` +
        `carry a module nobody may enable.`,
    })
  })

  it("refuses a release that pins an UNAVAILABLE capability", () => {
    const r = validateSystem({ ...base, input: pins({ approvals: { mode: "UNAVAILABLE" } }) })
    expect(r.problems.map((p) => p.detail).join(" ")).toContain("declared UNAVAILABLE")
  })

  it("carries the lifecycle into the checksum, so a deprecation is a new system", () => {
    // Two releases pinning the same versions of the same modules are not the
    // same system if one of those modules was deprecated in between — and
    // `createRelease` refuses a candidate identical to the active release, so a
    // checksum that ignored this would make the deprecation unrecordable.
    expect(checksumOfRelease(pins())).not.toBe(
      checksumOfRelease(pins({ approvals: { lifecycle: "deprecated" } })),
    )
  })
})

describe("a release is checked against the ranges its modules declare", () => {
  // PACK-010-002. The key-set check proves the release pins what resolved. It
  // says nothing about VERSIONS: a release could pin every required key and
  // still pin a ledger three major versions below what the module needing it
  // declares, and validate clean.
  /**
   * Expressed over this file's own `compare`, so there is one ordering here and
   * it is the numeric one. The production pairing — `satisfiesRange` from
   * `@tenure/module-runtime` over `compareVersions` from
   * `@tenure/platform-config` — is injected by
   * `packages/platform-config/src/build-system.ts` and held to this behaviour by
   * `build-system.test.ts`, the same split the comparator at the top uses.
   */
  const satisfiesRange = (version: string, range: string) => {
    const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(range)
    if (!m) return false
    const cmp = compare(version, m[2])
    return m[1] === ">=" ? cmp >= 0 : m[1] === "<=" ? cmp <= 0 : cmp === 0
  }

  const withVersions = (approvalsVersion: string) =>
    input({
      modules: [
        { key: "dashboard", version: "1.0.0" },
        { key: "organizations", version: "1.0.0" },
        { key: "approvals", version: approvalsVersion },
      ],
    })

  const base = {
    moduleProblems: [],
    configurationProblems: [],
    topologyValid: true,
    enabledModuleKeys: ["dashboard", "organizations", "approvals"],
    moduleDependencies: [{ module: "dashboard", dependsOn: "approvals", range: ">=2.0.0" }],
    satisfiesRange,
  }

  it("refuses a pin below the range the depending module declares", () => {
    const r = validateSystem({ ...base, input: withVersions("1.0.0") })
    expect(r.valid).toBe(false)
    expect(r.problems).toContainEqual({
      area: "coherence",
      detail: `Module "dashboard" needs "approvals" >=2.0.0, and the release pins approvals@1.0.0.`,
    })
  })

  it("accepts the same system once the pin satisfies it", () => {
    expect(validateSystem({ ...base, input: withVersions("2.1.0") }).valid).toBe(true)
  })

  it("refuses rather than passing when no range predicate was supplied", () => {
    // An unchecked range is not a satisfied one. Passing silently here is how
    // the check would exist and never run.
    const r = validateSystem({ ...base, satisfiesRange: undefined, input: withVersions("1.0.0") })
    expect(r.valid).toBe(false)
    expect(r.problems.map((p) => p.detail).join(" ")).toContain("no range predicate was supplied")
  })

  it("resolves a capability to whatever provides it", () => {
    const r = validateSystem({
      ...base,
      moduleDependencies: [
        {
          module: "dashboard",
          dependsOn: "finance.ledger",
          range: ">=1.0.0",
          satisfiedBy: ["approvals"],
        },
      ],
      input: withVersions("1.0.0"),
    })
    expect(r.valid).toBe(true)
  })
})
