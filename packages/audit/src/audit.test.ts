import {
  AuditRecordError,
  REDACTED,
  buildAuditRecord,
  redactMetadata,
  type AuditRecordInput,
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
