import type { AuthorizationRequest, AuthorizationWorld } from "./decide"
import {
  authorizationService,
  decisionKey,
  decisionKeyPrefix,
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

  it("separates two subject stamps", () => {
    // GE-053-006. The stamp in the key is what makes a revocation a structural
    // miss instead of a hoped-for eviction.
    expect(decisionKey(request(), "s1")).not.toBe(decisionKey(request(), "s2"))
  })

  it("begins with the documented tenant/principal prefix", () => {
    // invalidatePrincipal finds a principal's entries by matching this head.
    // If decisionKey's field order drifts from decisionKeyPrefix, targeted
    // invalidation becomes a no-op that still returns a plausible count.
    const prefix = decisionKeyPrefix(TENANT, "dana")
    expect(decisionKey(request(), "s1").startsWith(prefix)).toBe(true)
    expect(decisionKey(request(), "s2").startsWith(prefix)).toBe(true)
    expect(decisionKey(request()).startsWith(prefix)).toBe(true)
  })

  it("cannot be made to forge another principal's prefix with a separator", () => {
    // Raw fields would put a principal called "dana|finance.budget.read" under
    // a key that begins exactly like dana's, and revoking one would revoke or
    // spare the other by accident. Encoding is what makes the prefix a fact.
    const impostor = decisionKey(request({ tenantId: "t1", principalId: "dana|x" }))
    expect(impostor.startsWith(decisionKeyPrefix("t1", "dana"))).toBe(false)
    expect(impostor.startsWith(decisionKeyPrefix("t1", "dana|x"))).toBe(true)
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

  it("deletes one entry and leaves the rest", () => {
    // A revocation is narrower than a revision change: clear() on a role edit
    // would be correct and useless.
    const cache = memoryCache()
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("b", { decision: {} as never, revision: "r1", validUntil: null })
    cache.delete("a")
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBeDefined()
    expect(cache.size).toBe(1)
  })

  it("lists the keys it holds, so a targeted invalidation can find its own", () => {
    const cache = memoryCache()
    cache.set("a", { decision: {} as never, revision: "r1", validUntil: null })
    cache.set("b", { decision: {} as never, revision: "r1", validUntil: null })
    expect([...cache.keys()].sort()).toEqual(["a", "b"])
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

/* ────────────────────────────── borrowed authority and the horizon ── */

describe("a borrowed decision expires when the lender's grant does", () => {
  // WF-16 finding, confirmed by execution. `decide()` resolves a delegated
  // answer from the DELEGATOR's grants, but the horizon only looked at the
  // requester's — and a borrower holds none, so it came back null and the
  // decision was cached forever. Alice's grant ends at 13:00; Bob kept her
  // authority at 23:00 and every hour after.
  const lent = (over = {}) => ({
    principals: [{ id: "alice" }, { id: "bob" }],
    memberships: [
      { principalId: "alice", tenantId: TENANT, state: "ACTIVE" as const, effectiveFrom: PAST },
      { principalId: "bob", tenantId: TENANT, state: "ACTIVE" as const, effectiveFrom: PAST },
    ],
    roles: [{ key: "r", permissions: ["finance.budget.read"] }],
    grants: [
      {
        principalId: "alice",
        tenantId: TENANT,
        roleKey: "r",
        scope: { kind: "tenant" as const },
        state: "CONFIRMED" as const,
        effectiveFrom: PAST,
        effectiveTo: "2026-08-03T13:00:00Z",
      },
    ],
    delegations: [
      { fromPrincipalId: "alice", toPrincipalId: "bob", tenantId: TENANT, effectiveFrom: PAST },
    ],
    enabledModules: ["budgeting"],
    ...over,
  })

  const asBob = (over = {}) => ({
    principalId: "bob",
    tenantId: TENANT,
    permission: "finance.budget.read",
    at: NOON,
    ...over,
  })

  it("bounds the horizon by the lender's grant, not the borrower's absence", () => {
    expect(validUntil(lent(), asBob())).toBe("2026-08-03T13:00:00.000Z")
  })

  it("stops trusting the remembered decision the moment the lender's grant ends", () => {
    let builds = 0
    const service = authorizationService({
      worldFor: () => {
        builds += 1
        return lent()
      },
      revision: () => revision("rev-1"),
    })

    const borrowed = service.authorize(asBob())
    expect(borrowed.allowed).toBe(true)
    expect(borrowed.validUntil).toBe("2026-08-03T13:00:00.000Z")

    const after = service.authorize(asBob({ at: "2026-08-03T23:00:00Z" }))
    expect(after.cached).toBe(false)
    expect(after.allowed).toBe(false)
    expect(builds).toBe(2)
  })

  it("takes a lender's grant that has not started yet", () => {
    // The same hole in the other direction: a cached DENY outliving the moment
    // it should have become an allow.
    const later = lent({
      grants: [
        {
          principalId: "alice",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" as const },
          state: "CONFIRMED" as const,
          effectiveFrom: "2026-08-03T14:00:00Z",
        },
      ],
    })
    expect(validUntil(later, asBob())).toBe("2026-08-03T14:00:00.000Z")
  })

  it("ignores a delegation recorded in another tenant", () => {
    // A delegation is scoped to a tenant. Reading one from elsewhere would let
    // an unrelated tenant's grant window shorten — or extend — this decision.
    const elsewhere = lent({
      delegations: [
        { fromPrincipalId: "alice", toPrincipalId: "bob", tenantId: "other", effectiveFrom: PAST },
      ],
    })
    expect(validUntil(elsewhere, asBob())).toBeNull()
  })

  it("ignores the grants of somebody who lends this principal nothing", () => {
    const stranger = lent({
      grants: [
        ...lent().grants,
        {
          principalId: "carol",
          tenantId: TENANT,
          roleKey: "r",
          scope: { kind: "tenant" as const },
          state: "CONFIRMED" as const,
          effectiveFrom: PAST,
          effectiveTo: "2026-08-03T12:30:00Z",
        },
      ],
    })
    // Carol's earlier boundary must not shorten Bob's horizon: she lends to
    // nobody, so her dates cannot change this answer.
    expect(validUntil(stranger, asBob())).toBe("2026-08-03T13:00:00.000Z")
  })
})

/* ─────────────────────────────────── revocation, which is not a date ── */

describe("GE-053-006 — a revocation invalidates a remembered decision", () => {
  /**
   * The horizon bounds a decision by the dated facts it rested on, and that is
   * the whole answer only while every way authority ends is a date. A revocation
   * is not: the role assignment row is DELETED, so no `effectiveTo` the cache
   * already read moves, `validUntil` stays `null`, and the clock alone can never
   * notice. Every case below revokes that way — by removing the grant, never by
   * dating it.
   */
  const grantFor = (principalId: string) => ({
    principalId,
    tenantId: TENANT,
    roleKey: "r",
    scope: { kind: "tenant" as const },
    state: "CONFIRMED" as const,
    effectiveFrom: PAST,
  })

  const build = ({ stamped }: { stamped: boolean }) => {
    let grants = [grantFor("dana"), grantFor("eve")]
    const stamps: Record<string, string> = { dana: "s1", eve: "s1" }
    let builds = 0
    let stampReads = 0

    const service = authorizationService({
      worldFor: (): AuthorizationWorld => {
        builds += 1
        return {
          principals: [{ id: "dana" }, { id: "eve" }],
          memberships: [
            { principalId: "dana", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST },
            { principalId: "eve", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST },
          ],
          roles: [{ key: "r", permissions: ["finance.budget.read", "finance.budget.update"] }],
          grants,
          enabledModules: ["budgeting"],
        }
      },
      revision: () => revision("rev-1"),
      ...(stamped
        ? {
            subjectRevision: (r: AuthorizationRequest) => {
              stampReads += 1
              return stamps[r.principalId] ?? "s0"
            },
          }
        : {}),
    })

    return {
      service,
      builds: () => builds,
      stampReads: () => stampReads,
      revoke: (principalId: string) => {
        grants = grants.filter((g) => g.principalId !== principalId)
      },
      bump: (principalId: string, to: string) => {
        stamps[principalId] = to
      },
    }
  }

  const asEve = () => request({ principalId: "eve" })

  it("serves the revoked decision stale when no stamp source is wired", () => {
    // The defect, executed rather than asserted about. This is what the dated
    // horizon alone buys you, and it is why the stamp exists.
    const h = build({ stamped: false })
    expect(h.service.authorize(request()).allowed).toBe(true)

    h.revoke("dana")

    const after = h.service.authorize(request())
    expect(after.cached).toBe(true)
    expect(after.allowed).toBe(true)
    expect(h.builds()).toBe(1)
  })

  it("still serves it stale when the stamp is wired but not bumped", () => {
    // The fact that makes the stamp load-bearing rather than decorative: it is
    // the bump that lands the revocation, not the revocation itself. A source
    // that forgets to move the stamp has changed nothing.
    const h = build({ stamped: true })
    h.service.authorize(request())

    h.revoke("dana")

    const after = h.service.authorize(request())
    expect(after.cached).toBe(true)
    expect(after.allowed).toBe(true)
  })

  it("stops serving it on the very next call once the stamp is bumped", () => {
    const h = build({ stamped: true })
    const first = h.service.authorize(request())
    expect(first.allowed).toBe(true)
    expect(first.cached).toBe(false)
    expect(first.subjectRevision).toBe("s1")
    expect(h.service.authorize(request()).cached).toBe(true)

    h.revoke("dana")
    h.bump("dana", "s2")

    const after = h.service.authorize(request())
    expect(after.cached).toBe(false)
    expect(after.allowed).toBe(false)
    expect(after.subjectRevision).toBe("s2")
    expect(h.builds()).toBe(2)
  })

  it("reads the stamp on every call, hit and miss, not at construction", () => {
    // A stamp captured once is a revocation that never arrives — the same
    // failure `revision()` is read per-call to avoid.
    const h = build({ stamped: true })
    h.service.authorize(request())
    h.service.authorize(request())
    expect(h.stampReads()).toBe(2)
  })

  it("voids the principal's other remembered answers, not just the one asked again", () => {
    // A revocation removes authority, not one answer. Leaving the rest to age
    // out would also let dead entries evict live ones from a bounded cache.
    const h = build({ stamped: true })
    h.service.authorize(request())
    h.service.authorize(request({ permission: "finance.budget.update" }))
    expect(h.service.cacheSize).toBe(2)

    h.revoke("dana")
    h.bump("dana", "s2")
    h.service.authorize(request())

    expect(h.service.cacheSize).toBe(1)
    const other = h.service.authorize(request({ permission: "finance.budget.update" }))
    expect(other.cached).toBe(false)
    expect(other.allowed).toBe(false)
  })

  it("leaves every other principal's answers alone", () => {
    // The reason this is not `invalidate()`. Revoking one person's role must not
    // turn every decision in the tenant into a cold start.
    const h = build({ stamped: true })
    h.service.authorize(request())
    h.service.authorize(asEve())
    expect(h.service.cacheSize).toBe(2)

    h.revoke("dana")
    h.bump("dana", "s2")

    const dana = h.service.authorize(request())
    expect(dana.cached).toBe(false)
    expect(dana.allowed).toBe(false)

    const eve = h.service.authorize(asEve())
    expect(eve.cached).toBe(true)
    expect(eve.allowed).toBe(true)
  })

  it("drops one principal's entries out of band, and reports how many", () => {
    // The other door: a revocation known at the moment it happens, on a machine
    // that can be told. Returns a count so a caller that expected to revoke
    // something can tell it revoked nothing.
    const h = build({ stamped: false })
    h.service.authorize(request())
    h.service.authorize(asEve())
    expect(h.service.cacheSize).toBe(2)

    expect(h.service.invalidatePrincipal(TENANT, "dana")).toBe(1)
    expect(h.service.cacheSize).toBe(1)
    expect(h.service.authorize(asEve()).cached).toBe(true)
    expect(h.service.authorize(request()).cached).toBe(false)
  })

  it("does not reach the same principal id in another tenant", () => {
    const h = build({ stamped: false })
    h.service.authorize(request())
    expect(h.service.invalidatePrincipal("other-tenant", "dana")).toBe(0)
    expect(h.service.authorize(request()).cached).toBe(true)
  })

  it("reaches the principal's entries under every stamp they have held", () => {
    // The stamp sits after the tenant/principal prefix precisely so that an
    // out-of-band invalidation does not have to know which stamp is current.
    const h = build({ stamped: true })
    h.service.authorize(request())
    h.bump("dana", "s2")
    h.service.authorize(asEve())
    // dana's s1 entry is still there — nothing of dana's has been asked since
    // the bump, so nothing has reclaimed it.
    expect(h.service.cacheSize).toBe(2)

    expect(h.service.invalidatePrincipal(TENANT, "dana")).toBe(1)
    expect(h.service.authorize(asEve()).cached).toBe(true)
  })

  it("records the stamp on the decision, so an audit can name every input", () => {
    const unstamped = build({ stamped: false })
    expect(unstamped.service.authorize(request()).subjectRevision).toBeNull()
  })
})
