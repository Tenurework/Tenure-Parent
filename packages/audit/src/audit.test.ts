import {
  AuditRecordError,
  CHAIN_METADATA_KEYS,
  REDACTED,
  RetentionError,
  applyRetention,
  buildAuditRecord,
  hashRecord,
  projectForQuery,
  redactMetadata,
  verifyChain,
  type AuditRecord,
  type AuditRecordInput,
  type LegalHold,
} from "./index"

const AT = "2026-07-31T12:00:00Z"

const input = (over: Partial<AuditRecordInput> = {}): AuditRecordInput => ({
  tenantId: "rochester",
  actor: { principalId: "u1", role: "OSE_DIRECTOR" },
  action: "Admin.role.assign",
  resourceType: "RoleAssignment",
  outcome: "ALLOW",
  occurredAt: AT,
  ...over,
})

describe("a record that cannot be attributed is refused", () => {
  it("builds a valid one", () => {
    const r = buildAuditRecord(input())
    expect(r.tenantId).toBe("rochester")
    expect(r.actorId).toBe("u1")
    expect(r.outcome).toBe("ALLOW")
    expect(Object.isFrozen(r)).toBe(true)
  })

  it("refuses a record with no tenant", () => {
    // It would occupy a row that looks like evidence and is not.
    expect(() => buildAuditRecord(input({ tenantId: "" }))).toThrow(/tenantId is required/)
  })

  it("refuses a record with no actor, action or resource type", () => {
    expect(() => buildAuditRecord(input({ actor: { principalId: "" } }))).toThrow(/principalId/)
    expect(() => buildAuditRecord(input({ action: "" }))).toThrow(/action is required/)
    expect(() => buildAuditRecord(input({ resourceType: "" }))).toThrow(/resourceType is required/)
  })

  it("refuses an outcome that is neither ALLOW nor DENY", () => {
    // The column is NOT NULL with no default; the architecture's own worked
    // INSERT never supplies it.
    expect(() => buildAuditRecord(input({ outcome: undefined as never }))).toThrow(/outcome must be/)
    expect(() => buildAuditRecord(input({ outcome: "MAYBE" as never }))).toThrow(/outcome must be/)
  })

  it("refuses a DENY that does not say why", () => {
    // A denial with no reason cannot answer the only question anyone asks
    // about one.
    expect(() => buildAuditRecord(input({ outcome: "DENY" }))).toThrow(/needs a reason/)
    expect(() => buildAuditRecord(input({ outcome: "DENY", reason: "not permitted" }))).not.toThrow()
    expect(() =>
      buildAuditRecord(input({ outcome: "DENY", policyDecision: { reason: "NO_ROLE_GRANTING" } })),
    ).not.toThrow()
  })

  it("refuses a timestamp that is not one", () => {
    expect(() => buildAuditRecord(input({ occurredAt: "yesterday" }))).toThrow(/ISO timestamp/)
  })

  it("collects every problem rather than only the first", () => {
    try {
      buildAuditRecord({ ...input(), tenantId: "", action: "", outcome: "X" as never })
      throw new Error("expected a throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AuditRecordError)
      expect((err as AuditRecordError).problems.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("sensitive values never reach the table", () => {
  it("redacts by key name, whatever the caller passed", () => {
    const r = buildAuditRecord(
      input({ metadata: { targetEmail: "a@b.com", sessionToken: "abc", password: "hunter2" } }),
    )
    expect(r.metadata.sessionToken).toBe(REDACTED)
    expect(r.metadata.password).toBe(REDACTED)
    // Not everything is a secret — an audit row with nothing in it is useless.
    expect(r.metadata.targetEmail).toBe("a@b.com")
  })

  it("redacts nested values, not only top-level ones", () => {
    // The value that matters is usually nested — a before/after pair, or a
    // request body copied wholesale.
    const r = buildAuditRecord(
      input({ metadata: { before: { apiKey: "k1" }, after: { apiKey: "k2", name: "ok" } } }),
    )
    const after = r.metadata.after as Record<string, unknown>
    expect((r.metadata.before as Record<string, unknown>).apiKey).toBe(REDACTED)
    expect(after.apiKey).toBe(REDACTED)
    expect(after.name).toBe("ok")
  })

  it("redacts inside arrays", () => {
    const r = buildAuditRecord(input({ metadata: { grants: [{ token: "t1" }, { token: "t2" }] } }))
    for (const g of r.metadata.grants as Record<string, unknown>[]) {
      expect(g.token).toBe(REDACTED)
    }
  })

  it("matches case-insensitively and on substrings", () => {
    const out = redactMetadata({ SessionID: "x", userPassphrase: "y", AUTHORIZATION: "z" })
    expect(Object.values(out).every((v) => v === REDACTED)).toBe(true)
  })

  it("takes extra keys from the caller", () => {
    const r = buildAuditRecord(input({ metadata: { homeAddress: "1 Road" }, sensitiveKeys: ["homeAddress"] }))
    expect(r.metadata.homeAddress).toBe(REDACTED)
  })

  it("bounds depth rather than letting a pathological object take out the write", () => {
    let deep: Record<string, unknown> = { value: "bottom" }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    expect(() => buildAuditRecord(input({ metadata: deep }))).not.toThrow()
  })

  it("survives a cyclic object", () => {
    const cyclic: Record<string, unknown> = { name: "loop" }
    cyclic.self = cyclic
    expect(() => buildAuditRecord(input({ metadata: cyclic }))).not.toThrow()
  })
})

describe("a record carries the context an incident review needs", () => {
  it("keeps the actor's role AT THE TIME, separate from who they are", () => {
    // Read six months later against a roster that has changed, this is the
    // difference between "the president approved it" and "someone who is no
    // longer president, and whose authority then is unknowable, approved it".
    const r = buildAuditRecord(input({ actor: { principalId: "u1", role: "PRESIDENT" } }))
    expect(r.actorId).toBe("u1")
    expect(r.actorRole).toBe("PRESIDENT")
  })

  it("distinguishes an impersonated action from the user's own", () => {
    const r = buildAuditRecord(
      input({ actor: { principalId: "student", impersonatedBy: "support@tenure" } }),
    )
    expect(r.actorId).toBe("student")
    expect(r.impersonatedBy).toBe("support@tenure")
    expect(r.metadata._impersonatedBy).toBe("support@tenure")
  })

  it("records the release and configuration a decision was made under", () => {
    const r = buildAuditRecord(
      input({ releaseId: "rochester@r7", configurationChecksum: "sha256:abc" }),
    )
    expect(r.metadata._releaseId).toBe("rochester@r7")
    expect(r.metadata._configurationChecksum).toBe("sha256:abc")
  })

  it("carries an authorization decision's reason onto a denial", () => {
    const r = buildAuditRecord(
      input({
        outcome: "DENY",
        policyDecision: { reason: "SEPARATION_OF_DUTIES", detail: "own request", viaRoles: [] },
      }),
    )
    expect(r.metadata._policyDecision).toMatchObject({ reason: "SEPARATION_OF_DUTIES" })
  })

  it("namespaces its own keys so a caller's metadata cannot be shadowed", () => {
    const r = buildAuditRecord(input({ metadata: { releaseId: "caller's own" }, releaseId: "r7" }))
    expect(r.metadata.releaseId).toBe("caller's own")
    expect(r.metadata._releaseId).toBe("r7")
  })
})

// ---------------------------------------------------------------------------
// The read side: the chain, the export, the schedule.
// ---------------------------------------------------------------------------

/** Build `n` linked records for one tenant, each extending the last. */
const chainOf = (n: number, tenantId = "rochester"): AuditRecord[] => {
  const out: AuditRecord[] = []
  for (let i = 0; i < n; i++) {
    out.push(
      buildAuditRecord({
        ...input({ tenantId, action: `Admin.step${i}` }),
        occurredAt: new Date(Date.parse(AT) + i * 1000).toISOString(),
        ...(i === 0 ? { sequence: 0 } : { previous: out[i - 1] }),
      }),
    )
  }
  return out
}

/** Copy a frozen record with one field changed — what an UPDATE would do. */
const altered = (record: AuditRecord, over: Partial<AuditRecord>): AuditRecord =>
  ({ ...record, ...over }) as AuditRecord

describe("every record commits to its own content", () => {
  it("hashes the record it built, and mirrors the hash where the writers persist it", () => {
    // Both production writers (admin/guard.ts, provisioning/reconcile.ts) store
    // `record.metadata` wholesale as JSONB and have no column for a hash, so the
    // mirror is what makes the hash survive a round trip with no migration.
    const r = buildAuditRecord(input())
    expect(r.recordHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(r.metadata[CHAIN_METADATA_KEYS.recordHash]).toBe(r.recordHash)
    expect(hashRecord(r)).toBe(r.recordHash)
  })

  it("hashes content, not the spelling of a timestamp", () => {
    // A database round trip returns `…T12:00:00.000Z` for what was written as
    // `…T12:00:00Z`. Hashing the caller's spelling would fail a record for
    // having been stored.
    const a = buildAuditRecord(input({ occurredAt: "2026-07-31T12:00:00Z" }))
    const b = buildAuditRecord(input({ occurredAt: "2026-07-31T12:00:00.000Z" }))
    expect(a.occurredAt).toBe("2026-07-31T12:00:00.000Z")
    expect(a.recordHash).toBe(b.recordHash)
  })

  it("gives different content different hashes", () => {
    const a = buildAuditRecord(input({ reason: "denied by policy" }))
    const b = buildAuditRecord(input({ reason: "denied by policy." }))
    expect(a.recordHash).not.toBe(b.recordHash)
  })

  it("is unchained unless a position is given, and says so", () => {
    // 34 of 35 audit writes still hand-build their payload; pretending they sit
    // at sequence 0 of a chain would be a lie the verifier reports as a
    // duplicate. Null is the honest answer.
    expect(buildAuditRecord(input()).sequence).toBeNull()
    expect(buildAuditRecord(input()).previousHash).toBeNull()
  })
})

describe("a chain cannot be extended from a broken link", () => {
  it("derives sequence and previousHash from the record before it", () => {
    const [first, second] = chainOf(2)
    expect(first.sequence).toBe(0)
    expect(first.previousHash).toBeNull()
    expect(second.sequence).toBe(1)
    expect(second.previousHash).toBe(first.recordHash)
  })

  it("refuses to extend a record whose content no longer hashes to its hash", () => {
    // Otherwise the tamper is buried under a valid-looking suffix.
    const [first] = chainOf(1)
    const tampered = altered(first, { reason: "quietly softened" })
    expect(() => buildAuditRecord({ ...input(), previous: tampered })).toThrow(
      /chain it would extend is already broken/,
    )
  })

  it("refuses to chain across tenants", () => {
    const [other] = chainOf(1, "syracuse")
    expect(() => buildAuditRecord({ ...input({ tenantId: "rochester" }), previous: other })).toThrow(
      /chains are per-tenant/,
    )
  })

  it("refuses a position it cannot prove", () => {
    expect(() => buildAuditRecord(input({ sequence: 7 }))).toThrow(/must name the previousHash/)
    expect(() => buildAuditRecord(input({ sequence: 0, previousHash: "sha256:x" }))).toThrow(
      /head of a chain/,
    )
    expect(() => buildAuditRecord(input({ previousHash: "sha256:x" }))).toThrow(
      /does not place the record/,
    )
    expect(() => buildAuditRecord(input({ sequence: -1, previousHash: "sha256:x" }))).toThrow(
      /non-negative integer/,
    )
  })
})

describe("verifyChain answers what a findMany cannot", () => {
  it("passes an untouched chain, in any order", () => {
    const records = chainOf(5)
    const result = verifyChain([...records].reverse())
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(5)
    expect(result.unchained).toBe(0)
    expect(result.tenants).toEqual(["rochester"])
    expect(result.firstSequence.rochester).toBe(0)
  })

  it("catches a record whose content was edited after it was written", () => {
    const records = chainOf(4)
    const result = verifyChain([
      ...records.slice(0, 2),
      altered(records[2], { metadata: { ...records[2].metadata, note: "added later" } }),
      records[3],
    ])
    expect(result.ok).toBe(false)
    expect(result.tampered).toHaveLength(1)
    expect(result.tampered[0]).toMatchObject({ sequence: 2, reason: "CONTENT_ALTERED" })
    expect(result.tampered[0].actualHash).not.toBe(result.tampered[0].expectedHash)
  })

  it("catches an attacker who recomputed the hash too", () => {
    // The case a per-row hash alone cannot answer, and the whole reason records
    // are chained: anyone who can edit a row can usually recompute that row's
    // own hash. Keeping the chain consistent needs every later row as well.
    const records = chainOf(4)
    const edited = altered(records[1], { reason: "authorised after all" })
    const forged = altered(edited, { recordHash: hashRecord(edited) })

    const result = verifyChain([records[0], forged, records[2], records[3]])
    expect(result.tampered.filter((t) => t.reason === "CONTENT_ALTERED")).toHaveLength(0)
    expect(result.ok).toBe(false)
    expect(result.tampered).toHaveLength(1)
    expect(result.tampered[0]).toMatchObject({ sequence: 2, reason: "BROKEN_LINK" })
    expect(result.tampered[0].expectedHash).toBe(forged.recordHash)
  })

  it("catches a deleted record as a gap and a broken link", () => {
    const records = chainOf(5)
    const result = verifyChain([records[0], records[1], records[3], records[4]])
    expect(result.ok).toBe(false)
    expect(result.gaps).toEqual([{ tenantId: "rochester", after: 1, before: 3, missing: 1 }])
    expect(result.tampered.map((t) => t.reason)).toContain("BROKEN_LINK")
  })

  it("catches two records claiming the same position", () => {
    const records = chainOf(3)
    const rewrite = buildAuditRecord({
      ...input({ action: "Admin.rewritten" }),
      previous: records[0],
    })
    const result = verifyChain([...records, rewrite])
    expect(result.ok).toBe(false)
    expect(result.duplicates).toEqual([{ tenantId: "rochester", sequence: 1, count: 2 }])
  })

  it("keeps each tenant's chain separate", () => {
    const result = verifyChain([...chainOf(3, "rochester"), ...chainOf(3, "syracuse")])
    expect(result.ok).toBe(true)
    expect(result.tenants).toEqual(["rochester", "syracuse"])
  })

  it("reports how much of the log the chain does not cover", () => {
    // The honest measure while 34 writers still hand-build rows: their records
    // are hash-checked individually, but nothing proves a neighbour was not
    // deleted.
    const result = verifyChain([...chainOf(2), buildAuditRecord(input())])
    expect(result.unchained).toBe(1)
    expect(result.ok).toBe(true)
  })

  it("still catches an edit to an unchained record", () => {
    const loose = buildAuditRecord(input())
    const result = verifyChain([altered(loose, { outcome: "DENY" })])
    expect(result.ok).toBe(false)
    expect(result.tampered[0]).toMatchObject({ sequence: null, reason: "CONTENT_ALTERED" })
  })

  it("does not invent a gap before the first record it was given", () => {
    // A truncated chain is what legitimate retention leaves behind; the array
    // alone cannot say whether the missing prefix was expired or removed.
    const result = verifyChain(chainOf(5).slice(2))
    expect(result.gaps).toEqual([])
    expect(result.firstSequence.rochester).toBe(2)
  })
})

describe("an export cannot leak what the write redacted", () => {
  it("re-redacts on read, so a key that became sensitive later is caught", () => {
    // The 34 hand-built writes never went through the builder at all. A record
    // read back from one of those rows still gets redacted on the way out.
    const rawRow = {
      ...buildAuditRecord(input()),
      metadata: { sessionToken: "st-live-abc", targetEmail: "a@b.com" },
    } as AuditRecord
    const [out] = projectForQuery([rawRow], { sensitivity: "secret" })
    expect(out.metadata.sessionToken).toBe(REDACTED)
    expect(out.metadata.targetEmail).toBe("a@b.com")
  })

  it("takes extra keys for one particular export", () => {
    const r = buildAuditRecord(input({ metadata: { homeAddress: "1 Road" } }))
    expect(r.metadata.homeAddress).toBe("1 Road")
    const [out] = projectForQuery([r], { sensitivity: "secret", redactKeys: ["homeAddress"] })
    expect(out.metadata.homeAddress).toBe(REDACTED)
  })

  it("withholds by clearance, and names what it withheld", () => {
    const r = buildAuditRecord(
      input({
        organizationId: "org1",
        traceId: "t1",
        reason: "capability not held",
        actor: { principalId: "u1", role: "OSE_DIRECTOR", impersonatedBy: "support@tenure" },
        metadata: { detail: "sensitive-ish" },
      }),
    )

    const [pub] = projectForQuery([r], { sensitivity: "public" })
    expect(pub.actorId).toBeNull()
    expect(pub.organizationId).toBeNull()
    expect(pub.reason).toBeNull()
    expect(pub.impersonatedBy).toBeNull()
    expect(pub.metadata).toEqual({})
    expect(pub.withheld).toContain("actorId")
    expect(pub.withheld).toContain("metadata")
    // What is left is still an audit line: who-less, but what, when and outcome.
    expect(pub.action).toBe("Admin.role.assign")
    expect(pub.outcome).toBe("ALLOW")

    const [internal] = projectForQuery([r], { sensitivity: "internal" })
    expect(internal.organizationId).toBe("org1")
    expect(internal.actorRole).toBe("OSE_DIRECTOR")
    expect(internal.actorId).toBeNull()

    const [conf] = projectForQuery([r], { sensitivity: "confidential" })
    expect(conf.actorId).toBe("u1")
    expect(conf.reason).toBe("capability not held")
    expect(conf.impersonatedBy).toBeNull()
    expect(conf.metadata).toEqual({})

    const [secret] = projectForQuery([r], { sensitivity: "secret" })
    expect(secret.impersonatedBy).toBe("support@tenure")
    expect(secret.metadata.detail).toBe("sensitive-ish")
    expect(secret.withheld).toEqual([])
  })

  it("defaults to the quieter clearance when none is stated", () => {
    const r = buildAuditRecord(input({ reason: "because" }))
    expect(projectForQuery([r])[0].reason).toBeNull()
  })

  it("carries the chain fields at every clearance", () => {
    // So a redacted export can still be matched against a verified chain by
    // someone holding the full records.
    const records = chainOf(2)
    for (const level of ["public", "internal", "confidential", "secret"] as const) {
      const out = projectForQuery(records, { sensitivity: level })
      expect(out.map((p) => p.recordHash)).toEqual(records.map((r) => r.recordHash))
      expect(out[1].previousHash).toBe(records[0].recordHash)
      expect(out[1].sequence).toBe(1)
    }
  })
})

describe("retention plans a deletion, and a legal hold always wins", () => {
  const ASOF = "2027-01-01T00:00:00.000Z"
  const day = (n: number) => new Date(Date.parse(ASOF) - n * 86_400_000).toISOString()

  const loose = (over: Partial<AuditRecordInput> = {}) => buildAuditRecord(input(over))

  /** A chain for one tenant whose records occurred `offsets[i]` days before ASOF. */
  const chainAgedIn = (offsets: readonly number[]): AuditRecord[] => {
    const out: AuditRecord[] = []
    offsets.forEach((d, i) => {
      out.push(
        buildAuditRecord({
          ...input({ action: `Admin.step${i}` }),
          occurredAt: day(d),
          ...(i === 0 ? { sequence: 0 } : { previous: out[i - 1] }),
        }),
      )
    })
    return out
  }

  const hold = (over: Partial<LegalHold> = {}): LegalHold => ({
    id: "H1",
    tenantId: "rochester",
    reason: "Doe v. University — preservation order",
    placedAt: day(400),
    ...over,
  })

  it("keeps what is inside the window and expires what is past it", () => {
    const young = loose({ occurredAt: day(10) })
    const old = loose({ occurredAt: day(400) })
    const plan = applyRetention([young, old], { retainDays: 365, asOf: ASOF })
    expect(plan.retain).toEqual([young])
    expect(plan.expire).toEqual([old])
  })

  it("never expires a record under an active hold", () => {
    // The entire point of a hold: preservation that survives the routine
    // process which would otherwise destroy the evidence.
    const old = loose({ occurredAt: day(400) })
    const plan = applyRetention([old], { retainDays: 365, asOf: ASOF }, [hold()])
    expect(plan.expire).toEqual([])
    expect(plan.heldBack).toEqual([{ record: old, holds: ["H1"] }])
  })

  it("scopes a hold to what it names, and reports every hold that matched", () => {
    const target = loose({ occurredAt: day(400), action: "Admin.role.assign", resourceId: "r9" })
    const other = loose({ occurredAt: day(400), action: "Payments.refund" })
    const plan = applyRetention([target, other], { retainDays: 365, asOf: ASOF }, [
      hold({ id: "BY_PREFIX", scope: { action: "Admin." } }),
      hold({ id: "BY_RESOURCE", scope: { resourceId: "r9" } }),
      hold({ id: "OTHER_TENANT", tenantId: "syracuse" }),
    ])
    expect(plan.expire).toEqual([other])
    expect(plan.heldBack[0].holds).toEqual(["BY_PREFIX", "BY_RESOURCE"])
  })

  it("stops protecting once released, and does not protect before it was placed", () => {
    const old = loose({ occurredAt: day(400) })
    const released = applyRetention([old], { retainDays: 365, asOf: ASOF }, [
      hold({ releasedAt: day(30) }),
    ])
    expect(released.expire).toEqual([old])

    const notYet = applyRetention([old], { retainDays: 365, asOf: ASOF }, [
      hold({ placedAt: "2027-06-01T00:00:00.000Z" }),
    ])
    expect(notYet.expire).toEqual([old])
  })

  it("cuts only a prefix of a chain, because a hole is indistinguishable from a tamper", () => {
    const [a, b, c, d] = chainAgedIn([400, 399, 398, 397])
    const plan = applyRetention([d, c, b, a], { retainDays: 365, asOf: ASOF }, [
      hold({ scope: { action: "Admin.step1" } }),
    ])
    expect(plan.expire).toEqual([a])
    expect(plan.heldBack.map((h) => h.record)).toEqual([b])
    // Past retention, unheld — and kept anyway, because deleting them would
    // orphan the held record's successors from anything verifiable.
    expect(plan.chainBlocked).toEqual([c, d])
    expect(plan.retain).toEqual([])
  })

  it("returns the anchor that keeps the surviving chain provable", () => {
    const records = chainAgedIn([400, 399, 10])
    const plan = applyRetention(records, { retainDays: 365, asOf: ASOF })
    expect(plan.expire).toEqual([records[0], records[1]])
    expect(plan.retain).toEqual([records[2]])
    expect(plan.anchors).toEqual([
      { tenantId: "rochester", throughSequence: 1, anchorHash: records[1].recordHash },
    ])
  })

  it("accounts for every record it was given", () => {
    const records = [loose({ occurredAt: day(10) }), loose({ occurredAt: day(400) })]
    const plan = applyRetention(records, { retainDays: 365, asOf: ASOF }, [
      hold({ scope: { resourceType: "Nothing" } }),
    ])
    expect(
      plan.expire.length + plan.retain.length + plan.heldBack.length + plan.chainBlocked.length,
    ).toBe(records.length)
  })

  it("refuses a hold or a policy it cannot act on safely", () => {
    const old = loose({ occurredAt: day(400) })
    const policy = { retainDays: 365, asOf: ASOF }
    expect(() => applyRetention([old], policy, [{ ...hold(), tenantId: "" }])).toThrow(RetentionError)
    expect(() => applyRetention([old], policy, [{ ...hold(), reason: "  " }])).toThrow(/must say why/)
    expect(() => applyRetention([old], policy, [hold({ releasedAt: day(500) })])).toThrow(
      /released before it was placed/,
    )
    expect(() => applyRetention([old], { retainDays: -1, asOf: ASOF })).toThrow(/non-negative/)
    expect(() => applyRetention([old], { retainDays: 365, asOf: "soon" })).toThrow(/ISO timestamp/)
  })
})
