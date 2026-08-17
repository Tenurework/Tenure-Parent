import {
  DENY_REASONS,
  NON_DELEGABLE_PERMISSIONS,
  decide,
  isDelegable,
  lookupPermission,
  type AuthorizationWorld,
  type Delegation,
} from "./index"

/**
 * GE-053-003 — "Delegation cannot exceed source authority, scope, time,
 * resource, action, or non-delegable rules."
 *
 * Six bounds. The engine enforced three of them (authority, time, action) and
 * had no way to express the other three.
 *
 *   **Scope and resource.** A `Delegation` carried a permission list and two
 *   dates and nothing else, so its reach was exactly its source's reach. "Cover
 *   for me on the Northern division for a fortnight" was unwritable: the only
 *   delegation the model could express handed over everything the delegator
 *   could reach anywhere. `scope` and `resourceIds` are the narrowing, and they
 *   can only narrow — the intersection with the delegator's own grants is still
 *   taken afterwards.
 *
 *   **Non-delegable.** Nothing was, and one of the permissions that had to be is
 *   `org.delegation.grant`: borrowed, a delegate writes themselves a fresh
 *   delegation with a later end date and every bound on the original is gone,
 *   with every write authorized. That is not a widening the intersection rule
 *   can catch, because each step of it is legitimate.
 */

const T = "2026-08-17T00:00:00Z"
const PAST = "2020-01-01T00:00:00Z"
const FUTURE = "2030-01-01T00:00:00Z"

/** club1 and club2 sit under school1; school2 is a separate branch. */
const ANCESTORS: Record<string, string[]> = {
  club1: ["school1", "root"],
  club2: ["school1", "root"],
  club3: ["school2", "root"],
  school1: ["root"],
  school2: ["root"],
}

const ROLES = [
  {
    key: "director",
    permissions: [
      "approvals.request.decide",
      "org.unit.read",
      "org.delegation.grant",
      "admin.override.execute",
      "identity.membership.suspend",
      "identity.connection.configure",
      "config.release.promote",
      "org.delegation.revoke",
      "finance.ledger.reverse",
    ],
  },
  { key: "clubPresident", permissions: ["approvals.request.decide", "org.unit.read"] },
]

/**
 * `chris` is a director with tenant-wide authority. `sam` holds one club.
 * `robin` holds nothing at all and only ever acts on borrowed authority.
 */
const world = (delegations: readonly Delegation[], over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "chris" }, { id: "sam" }, { id: "robin" }],
  memberships: [
    { principalId: "chris", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "sam", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "robin", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
  ],
  roles: ROLES,
  grants: [
    {
      principalId: "chris",
      tenantId: "t1",
      roleKey: "director",
      scope: { kind: "tenant" },
      state: "CONFIRMED",
      effectiveFrom: PAST,
    },
    {
      principalId: "sam",
      tenantId: "t1",
      roleKey: "clubPresident",
      scope: { kind: "orgUnit", orgUnitId: "club1" },
      state: "CONFIRMED",
      effectiveFrom: PAST,
    },
  ],
  delegations,
  ancestorsOf: (id) => ANCESTORS[id] ?? [],
  enabledModules: ["approvals", "organizations", "administration", "budgeting"],
  ...over,
})

const from = (fromPrincipalId: string, over: Partial<Delegation> = {}): Delegation => ({
  fromPrincipalId,
  toPrincipalId: "robin",
  tenantId: "t1",
  effectiveFrom: PAST,
  ...over,
})

const ask = (
  w: AuthorizationWorld,
  principalId: string,
  permission: string,
  orgUnitId?: string,
  resourceId = "r1",
) =>
  decide(w, {
    principalId,
    tenantId: "t1",
    permission,
    resource: orgUnitId ? { type: "Request", id: resourceId, orgUnitId } : undefined,
    at: T,
  })

/* ──────────────────────────────────────────────────────────── 1. authority ── */

describe("GE-053-003 — a delegation cannot exceed the source's authority", () => {
  it("confers what the delegator holds", () => {
    const d = ask(world([from("chris")]), "robin", "approvals.request.decide", "club1")
    expect(d.allowed).toBe(true)
    expect(d.viaDelegationFrom).toBe("chris")
  })

  it("confers nothing when the delegator does not hold the permission", () => {
    // `sam` has no `admin.override.execute`, so borrowing everything sam has
    // still yields nothing here.
    expect(ask(world([from("sam")]), "robin", "admin.override.execute", "club1").allowed).toBe(false)
  })

  it("ends the instant the delegator's own grant is revoked, with no second write", () => {
    const revoked = world([from("chris")], {
      grants: [
        {
          principalId: "chris",
          tenantId: "t1",
          roleKey: "director",
          scope: { kind: "tenant" },
          state: "REVOKED",
          effectiveFrom: PAST,
        },
      ],
    })
    expect(ask(revoked, "robin", "approvals.request.decide", "club1").allowed).toBe(false)
  })

  it("does not chain: a delegate's borrowed authority is not itself delegable", () => {
    // robin borrows from chris; pat tries to borrow from robin. Borrowing from a
    // borrower would make the first delegation's bounds unenforceable, because
    // the second one is written against authority nobody granted.
    const chained = world([from("chris"), { ...from("robin"), toPrincipalId: "pat" }], {
      principals: [{ id: "chris" }, { id: "sam" }, { id: "robin" }, { id: "pat" }],
      memberships: [
        { principalId: "chris", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
        { principalId: "sam", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
        { principalId: "robin", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
        { principalId: "pat", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
      ],
    })
    expect(ask(chained, "pat", "approvals.request.decide", "club1").allowed).toBe(false)
  })
})

/* ──────────────────────────────────────────────────────────────── 2. scope ── */

describe("GE-053-003 — a delegation's scope narrows and never widens", () => {
  it("bounds a tenant-wide delegator to the one unit delegated", () => {
    // chris may decide anywhere. The delegation says club1, so club2 is refused
    // even though the source authority reaches it.
    const scoped = world([from("chris", { scope: { kind: "orgUnit", orgUnitId: "club1" } })])
    expect(ask(scoped, "robin", "approvals.request.decide", "club1").allowed).toBe(true)

    const d = ask(scoped, "robin", "approvals.request.decide", "club2")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("DELEGATION_OUT_OF_SCOPE")
    expect(d.detail).toMatch(/club2/)
  })

  it("inherits downward exactly as a grant does", () => {
    // A delegation of a school covers its clubs — the same rule scope already
    // has, reused rather than restated, so there is one answer to "where".
    const scoped = world([from("chris", { scope: { kind: "orgUnit", orgUnitId: "school1" } })])
    expect(ask(scoped, "robin", "approvals.request.decide", "club1").allowed).toBe(true)
    expect(ask(scoped, "robin", "approvals.request.decide", "club3").allowed).toBe(false)
  })

  it("cannot widen a delegator who holds only one club", () => {
    // THE WIDENING TEST. sam holds club1; the delegation claims the tenant.
    // The intersection is still taken, so club2 is refused.
    const wide = world([from("sam", { scope: { kind: "tenant" } })])
    expect(ask(wide, "robin", "approvals.request.decide", "club1").allowed).toBe(true)
    expect(ask(wide, "robin", "approvals.request.decide", "club2").allowed).toBe(false)
  })

  it("refuses an unplaced resource under an org-scoped delegation", () => {
    const scoped = world([from("chris", { scope: { kind: "orgUnit", orgUnitId: "club1" } })])
    const d = ask(scoped, "robin", "approvals.request.decide")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("DELEGATION_OUT_OF_SCOPE")
  })
})

/* ───────────────────────────────────────────────────────────── 3. resource ── */

describe("GE-053-003 — a delegation can be bounded to named resources", () => {
  const one = world([from("chris", { resourceIds: ["req-7"] })])

  it("allows the resource it names", () => {
    expect(ask(one, "robin", "approvals.request.decide", "club1", "req-7").allowed).toBe(true)
  })

  it("denies every other resource, in the same unit", () => {
    const d = ask(one, "robin", "approvals.request.decide", "club1", "req-8")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("DELEGATION_OUT_OF_SCOPE")
    expect(d.detail).toMatch(/req-8/)
  })

  it("denies a request that identifies no resource at all", () => {
    // "We could not tell which resource" is not "the one that was delegated".
    expect(ask(one, "robin", "approvals.request.decide").reason).toBe("DELEGATION_OUT_OF_SCOPE")
  })
})

/* ───────────────────────────────────────────────────────────────── 4. time ── */

describe("GE-053-003 — a delegation is bounded in time at both ends", () => {
  it("denies before it starts", () => {
    expect(
      ask(world([from("chris", { effectiveFrom: FUTURE })]), "robin", "approvals.request.decide", "club1").allowed,
    ).toBe(false)
  })

  it("denies after it ends", () => {
    expect(
      ask(
        world([from("chris", { effectiveTo: "2026-01-01T00:00:00Z" })]),
        "robin",
        "approvals.request.decide",
        "club1",
      ).allowed,
    ).toBe(false)
  })

  it("is half-open: the end instant itself is already outside", () => {
    // Two delegations that meet at an instant must not both hold, or "who held
    // this at 09:00" has two answers.
    const endsNow = world([from("chris", { effectiveTo: T })])
    expect(ask(endsNow, "robin", "approvals.request.decide", "club1").allowed).toBe(false)

    const startsNow = world([from("chris", { effectiveFrom: T })])
    expect(ask(startsNow, "robin", "approvals.request.decide", "club1").allowed).toBe(true)
  })
})

/* ─────────────────────────────────────────────────────────────── 5. action ── */

describe("GE-053-003 — a delegation is bounded to the actions it names", () => {
  const narrowed = world([from("chris", { permissions: ["org.unit.read"] })])

  it("allows the action named", () => {
    expect(ask(narrowed, "robin", "org.unit.read", "club1").allowed).toBe(true)
  })

  it("denies an action it does not name, however wide the source", () => {
    expect(ask(narrowed, "robin", "approvals.request.decide", "club1").allowed).toBe(false)
  })

  it("an empty permission list delegates nothing, rather than everything", () => {
    // `[]` and `undefined` must not mean the same thing: one is "these
    // permissions" with none listed, the other is "whatever you hold".
    const none = world([from("chris", { permissions: [] })])
    expect(ask(none, "robin", "org.unit.read", "club1").allowed).toBe(false)
    expect(ask(world([from("chris")]), "robin", "org.unit.read", "club1").allowed).toBe(true)
  })
})

/* ────────────────────────────────────────────────────── 6. non-delegable ── */

describe("GE-053-003 — some authorities cannot be borrowed at all", () => {
  it("every non-delegable key is a real catalog key", () => {
    // A list of strings nothing recognises is a control that protects nothing.
    for (const key of NON_DELEGABLE_PERMISSIONS) {
      expect(lookupPermission(key)).not.toBeNull()
    }
  })

  for (const key of NON_DELEGABLE_PERMISSIONS) {
    it(`refuses "${key}" through a delegation the delegator could otherwise lend`, () => {
      // chris genuinely holds all of these at tenant scope, and the delegation
      // is effective and unbounded. The refusal is about the authority.
      const d = ask(world([from("chris")]), "robin", key, "club1")
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe("DELEGATION_NOT_PERMITTED")
      expect(isDelegable(key)).toBe(false)
    })

    it(`still lets the holder of "${key}" exercise it directly`, () => {
      // The bound is on borrowing, not on the permission. A control that also
      // disabled the real holder would be an outage wearing a policy's clothes.
      expect(ask(world([]), "chris", key, "club1").allowed).toBe(true)
    })
  }

  it("does not refuse it when the delegation names other permissions", () => {
    // The non-delegable check must not fire on a delegation that never claimed
    // the authority: the answer there is "no role confers this", which is the
    // truth, and DELEGATION_NOT_PERMITTED would be a story about a delegation
    // that has nothing to do with the question.
    const other = world([from("chris", { permissions: ["org.unit.read"] })])
    expect(ask(other, "robin", "admin.override.execute", "club1").reason).toBe("NO_ROLE_GRANTING")
  })

  it("leaves an ordinary finance authority delegable", () => {
    // The list is authorities where borrowing defeats a control, not a general
    // suspicion of delegation. A treasurer on leave whose deputy cannot correct
    // a posting is a control that costs more than it buys.
    expect(isDelegable("finance.ledger.reverse")).toBe(true)
    expect(ask(world([from("chris")]), "robin", "finance.ledger.reverse", "club1").allowed).toBe(true)
  })

  it("answers delegable for an unknown key, which decide refuses earlier anyway", () => {
    // Answering false here would report a typo as a delegation policy, which is
    // how support ends up explaining a misspelling as a governance decision.
    expect(isDelegable("made.up.key")).toBe(true)
    expect(ask(world([from("chris")]), "robin", "made.up.key", "club1").reason).toBe("UNKNOWN_PERMISSION")
  })
})

/* ─────────────────────────────────────────────────── reasons and ordering ── */

describe("GE-053-003 — the refusals are declared, and the specific one wins", () => {
  it("declares both new reasons", () => {
    expect(DENY_REASONS).toContain("DELEGATION_NOT_PERMITTED")
    expect(DENY_REASONS).toContain("DELEGATION_OUT_OF_SCOPE")
  })

  it("prefers the principal's own unconfirmed grant over a story about a delegation", () => {
    // sam's own grant is PENDING and a delegation is also bounded out. "Your
    // term has not begun" is the answer sam can act on.
    const pending = world([from("chris", { scope: { kind: "orgUnit", orgUnitId: "club3" } })], {
      grants: [
        {
          principalId: "sam",
          tenantId: "t1",
          roleKey: "clubPresident",
          scope: { kind: "orgUnit", orgUnitId: "club1" },
          state: "PENDING",
          effectiveFrom: PAST,
        },
      ],
      delegations: [{ ...from("chris", { scope: { kind: "orgUnit", orgUnitId: "club3" } }), toPrincipalId: "sam" }],
    })
    expect(ask(pending, "sam", "approvals.request.decide", "club1").reason).toBe("GRANT_NOT_CONFIRMED")
  })

  it("reports the delegation refusal rather than a generic one when there is no direct role", () => {
    const scoped = world([from("chris", { scope: { kind: "orgUnit", orgUnitId: "club3" } })])
    expect(ask(scoped, "robin", "approvals.request.decide", "club1").reason).toBe("DELEGATION_OUT_OF_SCOPE")
  })
})
