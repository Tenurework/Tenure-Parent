import type { AuthorizationRequest, AuthorizationWorld } from "./decide"
import {
  authorizationService,
  decisionKey,
  memoryCache,
  validUntil,
  type PolicyRevision,
} from "./service"

/**
 * GE-051-004 — one decision interface, and one rule for when a remembered
 * decision stops being true.
 */

const PAST = "2020-01-01T00:00:00Z"
const NOON = "2026-08-03T12:00:00Z"
const TENANT = "t1"

const world = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "dana" }],
  memberships: [{ principalId: "dana", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST }],
  roles: [{ key: "r", permissions: ["finance.budget.read"] }],
  grants: [
    {
      principalId: "dana",
      tenantId: TENANT,
      roleKey: "r",
      scope: { kind: "tenant" },
      state: "CONFIRMED",
      effectiveFrom: PAST,
    },
  ],
  enabledModules: ["budgeting"],
  ...over,
})

const request = (over: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  principalId: "dana",
  tenantId: TENANT,
  permission: "finance.budget.read",
  at: NOON,
  ...over,
})

const revision = (id: string): PolicyRevision => ({ id, recordedAt: PAST })

/* ──────────────────────────────────────────────────────────── the horizon ── */

describe("a decision knows when it could change", () => {
  it("is unbounded when nothing dated is in front of it", () => {
    expect(validUntil(world(), request())).toBeNull()
  })

  it("takes the end of a grant", () => {
    const ends = world({
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T15:00:00Z",
        },
      ],
    })
    expect(validUntil(ends, request())).toBe("2026-08-03T15:00:00.000Z")
  })

  it("takes the earliest boundary, not the first one found", () => {
    const many = world({
      memberships: [
        {
          principalId: "dana",
          tenantId: TENANT,
          state: "ACTIVE",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T18:00:00Z",
        },
      ],
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T13:00:00Z",
        },
      ],
    })
    expect(validUntil(many, request())).toBe("2026-08-03T13:00:00.000Z")
  })

  it("takes a grant that has not started yet", () => {
    // A grant beginning at 14:00 changes the answer at 14:00 just as surely as
    // one ending then. A horizon that only looked at ends would keep a denial
    // past the moment it became an allowance.
    const later = world({
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: "2026-08-03T14:00:00Z",
        },
      ],
    })
    expect(validUntil(later, request())).toBe("2026-08-03T14:00:00.000Z")
  })

  it("takes the end of a membership when nothing else is dated", () => {
    // A membership that ends is a decision that changes, whether or not any
    // grant does. The earliest-boundary test below would still pass with
    // memberships ignored entirely, because a grant happened to be sooner.
    const leaving = world({
      memberships: [
        {
          principalId: "dana",
          tenantId: TENANT,
          state: "ACTIVE",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T16:00:00Z",
        },
      ],
    })
    expect(validUntil(leaving, request())).toBe("2026-08-03T16:00:00.000Z")
  })

  it("takes the end of a relationship", () => {
    const advised = world({
      relationships: [
        {
          type: "ADVISES",
          fromPrincipalId: "dana",
          tenantId: TENANT,
          toOrgUnitId: "club1",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T12:30:00Z",
        },
      ],
    })
    expect(validUntil(advised, request())).toBe("2026-08-03T12:30:00.000Z")
  })

  it("ignores a malformed relationship's dates", () => {
    // The decision already refuses it, so letting its window shorten the
    // horizon would make a broken row control how long real ones are trusted.
    const broken = world({
      relationships: [
        {
          type: "ADVISES",
          fromPrincipalId: "dana",
          tenantId: TENANT,
          toOrgUnitId: "club1",
          toPrincipalId: "someone",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T12:01:00Z",
        },
      ],
    })
    expect(validUntil(broken, request())).toBeNull()
  })

  it("ignores another principal's dates", () => {
    const other = world({
      grants: [
        ...world().grants,
        {
          principalId: "someone-else",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T12:01:00Z",
        },
      ],
    })
    expect(validUntil(other, request())).toBeNull()
  })

  it("ignores another tenant's dates", () => {
    const elsewhere = world({
      grants: [
        ...world().grants,
        {
          principalId: "dana",
          tenantId: "other",
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T12:01:00Z",
        },
      ],
    })
    expect(validUntil(elsewhere, request())).toBeNull()
  })

  it("ignores a boundary already behind it", () => {
    const done = world({
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
          effectiveTo: "2026-01-01T00:00:00Z",
        },
      ],
    })
    expect(validUntil(done, request())).toBeNull()
  })

  it("takes the moment a session's assurance goes stale", () => {
    const stepUp = world({
      assuranceRequirements: [
        { permission: "finance.budget.read", minimum: "STEP_UP", maxAgeSeconds: 300 },
      ],
    })
    const r = request({ session: { level: "STEP_UP", establishedAt: "2026-08-03T11:58:00Z" } })
    expect(validUntil(stepUp, r)).toBe("2026-08-03T12:03:00.000Z")
  })
})

/* ────────────────────────────────────────────────────────────────── the key ── */

describe("the cache key separates questions that are not the same", () => {
  it("separates two resources in different units", () => {
    // Scope is checked against the unit, so these are different questions.
    const a = decisionKey(request({ resource: { type: "B", id: "b1", orgUnitId: "u1" } }))
    const b = decisionKey(request({ resource: { type: "B", id: "b1", orgUnitId: "u2" } }))
    expect(a).not.toBe(b)
  })

  it("separates a stepped-up session from an ordinary one", () => {
    // Sharing a key is how a step-up requirement is satisfied once and then
    // never again.
    const a = decisionKey(request({ session: { level: "MFA", establishedAt: NOON } }))
    const b = decisionKey(request({ session: { level: "STEP_UP", establishedAt: NOON } }))
    expect(a).not.toBe(b)
  })

  it("separates two sessions of the same level established at different times", () => {
    const a = decisionKey(request({ session: { level: "STEP_UP", establishedAt: NOON } }))
    const b = decisionKey(request({ session: { level: "STEP_UP", establishedAt: PAST } }))
    expect(a).not.toBe(b)
  })

  it("separates resources raised by different people", () => {
    // Separation-of-duties policies read exactly this.
    const a = decisionKey(request({ resource: { type: "R", id: "1", createdByPrincipalId: "x" } }))
    const b = decisionKey(request({ resource: { type: "R", id: "1", createdByPrincipalId: "y" } }))
    expect(a).not.toBe(b)
  })

  it("separates principals, tenants and permissions", () => {
    const base = decisionKey(request())
    expect(decisionKey(request({ principalId: "other" }))).not.toBe(base)
    expect(decisionKey(request({ tenantId: "other" }))).not.toBe(base)
    expect(decisionKey(request({ permission: "finance.budget.update" }))).not.toBe(base)
  })

  it("gives the same question the same key", () => {
    expect(decisionKey(request())).toBe(decisionKey(request()))
  })
})

/* ──────────────────────────────────────────────────────────────── the cache ── */

describe("the memory cache is bounded and evicts the oldest", () => {
  it("keeps what fits", () => {
    const cache = memoryCache(3)
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("b", { decision: {} as never, revision: "r1", validUntil: null })
    expect(cache.size).toBe(2)
    expect(cache.get("a")).toBeDefined()
  })

  it("evicts the oldest insertion, not the least recently read", () => {
    // Least-recently-used on an authorization cache means the hottest principal
    // never expires, which is the one you least want kept.
    const cache = memoryCache(2)
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("b", { decision: {} as never, revision: "r1", validUntil: null })
    cache.get("a")
    cache.set("c", { decision: {} as never, revision: "r1", validUntil: null })
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("c")).toBeDefined()
  })

  it("moves a refreshed entry to the back of the queue", () => {
    // Without this a re-set keeps its original eviction slot and is thrown away
    // while still valid.
    const cache = memoryCache(2)
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("b", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("a", { decision: {} as never, revision: "r2", validUntil: null })
    cache.set("c", { decision: {} as never, revision: "r1", validUntil: null })
    expect(cache.get("a")).toBeDefined()
    expect(cache.get("b")).toBeUndefined()
  })

  it("clears", () => {
    const cache = memoryCache()
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

/* ────────────────────────────────────────────────────────────── the service ── */

describe("the service decides once and remembers correctly", () => {
  const build = (over: Partial<AuthorizationWorld> = {}, rev = "rev-1") => {
    let builds = 0
    let current = rev
    const service = authorizationService({
      worldFor: () => {
        builds += 1
        return world(over)
      },
      revision: () => revision(current),
    })
    return {
      service,
      builds: () => builds,
      setRevision: (id: string) => {
        current = id
      },
    }
  }

  it("answers, and records the revision it answered under", () => {
    const { service } = build()
    const decision = service.authorize(request())
    expect(decision.allowed).toBe(true)
    expect(decision.revision).toBe("rev-1")
    expect(decision.cached).toBe(false)
  })

  it("does not rebuild the world for the same question", () => {
    const { service, builds } = build()
    service.authorize(request())
    const second = service.authorize(request())
    expect(second.cached).toBe(true)
    expect(builds()).toBe(1)
  })

  it("rebuilds for a different question", () => {
    const { service, builds } = build()
    service.authorize(request())
    service.authorize(request({ permission: "finance.budget.update" }))
    expect(builds()).toBe(2)
  })

  it("caches a denial too", () => {
    // Not caching denials sounds cautious and is the opposite: an unauthorized
    // caller in a retry loop then costs a full world build every attempt.
    const { service, builds } = build({ grants: [] })
    expect(service.authorize(request()).allowed).toBe(false)
    expect(service.authorize(request()).cached).toBe(true)
    expect(builds()).toBe(1)
  })

  it("stops trusting a remembered decision at its horizon", () => {
    // The whole reason authority is computed rather than stored. A decision
    // remembered past its boundary is a stored grant with a different name.
    const ends = {
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" as const },
          state: "CONFIRMED" as const,
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T13:00:00Z",
        },
      ],
    }
    const { service, builds } = build(ends)

    const first = service.authorize(request())
    expect(first.allowed).toBe(true)
    expect(first.validUntil).toBe("2026-08-03T13:00:00.000Z")

    expect(service.authorize(request({ at: "2026-08-03T12:59:59Z" })).cached).toBe(true)

    const after = service.authorize(request({ at: "2026-08-03T13:00:00Z" }))
    expect(after.cached).toBe(false)
    expect(after.allowed).toBe(false)
    expect(builds()).toBe(2)
  })

  it("is half-open at the horizon, like every other window here", () => {
    const { service } = build({
      grants: [
        {
          principalId: "dana",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" as const },
          state: "CONFIRMED" as const,
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T13:00:00Z",
        },
      ],
    })
    service.authorize(request())
    expect(service.authorize(request({ at: "2026-08-03T13:00:00Z" })).cached).toBe(false)
  })

  it("voids everything when the revision changes", () => {
    // Void, not stale. The rule a remembered decision applied no longer exists.
    const { service, builds, setRevision } = build()
    service.authorize(request())
    service.authorize(request({ permission: "finance.budget.update" }))
    expect(builds()).toBe(2)

    setRevision("rev-2")
    service.authorize(request())
    expect(builds()).toBe(3)
    expect(service.cacheSize).toBe(1)
  })

  it("reads the revision on every call, not at construction", () => {
    // A service that captured it once keeps answering under the old rules until
    // something restarts it, which is an emergency deny that does not take
    // effect.
    const { service, setRevision } = build()
    expect(service.authorize(request()).revision).toBe("rev-1")
    setRevision("rev-9")
    expect(service.authorize(request()).revision).toBe("rev-9")
  })

  it("can be told to forget out of band", () => {
    const { service, builds } = build()
    service.authorize(request())
    service.invalidate()
    service.authorize(request())
    expect(builds()).toBe(2)
  })

  it("does not serve an entry recorded under another revision", () => {
    // The service clears on a revision change, so this cannot normally happen
    // in one process — and that is exactly why it needs its own test. A shared
    // cache is the ordinary reason two revisions meet: another process wrote
    // the entry, and its rules are not these rules.
    const shared = memoryCache()
    let builds = 0
    const service = authorizationService({
      worldFor: () => {
        builds += 1
        return world()
      },
      revision: () => revision("rev-current"),
      cache: shared,
    })
    shared.set(decisionKey(request()), {
      decision: { allowed: true, reason: "ALLOWED", detail: "from elsewhere", trace: [], viaRoles: [] },
      revision: "rev-elsewhere",
      validUntil: null,
    })

    const decision = service.authorize(request())
    expect(decision.cached).toBe(false)
    expect(decision.revision).toBe("rev-current")
    expect(builds).toBe(1)
  })

  it("does not serve an entry whose horizon cannot be read", () => {
    // Fails closed. An unreadable date is a fact nobody can check, and treating
    // it as "no expiry" turns one corrupt entry into a permanent grant.
    const shared = memoryCache()
    let builds = 0
    const service = authorizationService({
      worldFor: () => {
        builds += 1
        return world()
      },
      revision: () => revision("rev-1"),
      cache: shared,
    })
    shared.set(decisionKey(request()), {
      decision: { allowed: true, reason: "ALLOWED", detail: "corrupt", trace: [], viaRoles: [] },
      revision: "rev-1",
      validUntil: "not a date",
    })

    expect(service.authorize(request()).cached).toBe(false)
    expect(builds).toBe(1)
  })

  it("does not serve one principal's decision to another", () => {
    const { service } = build()
    service.authorize(request())
    const other = service.authorize(request({ principalId: "nobody" }))
    expect(other.cached).toBe(false)
    expect(other.allowed).toBe(false)
  })
})
