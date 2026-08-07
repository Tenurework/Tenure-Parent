import { AuditRecordError, CHAIN_METADATA_KEYS, verifyChain } from "@tenure/audit"

import {
  CHANGE_METADATA_KEY,
  SEAT_METADATA_KEY,
  changeBlockFor,
  recordAuditEvent,
  rehydrateAuditRecord,
  seatFor,
  type AuditEventRow,
  type AuditLedger,
  type StoredAuditEvent,
} from "@/lib/audit-record"
import { runInTenantScope } from "@/lib/tenancy/context"
import type { UserContext } from "@/lib/rbac"

/**
 * The ledger a test writes into, standing in for the `AuditEvent` table.
 *
 * It is not a spy returning a canned predecessor: it implements the two
 * behaviours the chain depends on — "the latest row for this institution that
 * carries a chain position" and "append" — and it round-trips `metadata`
 * through JSON, because that is what a JSONB column does and a chain that only
 * verifies before serialization verifies nothing. `rehydrateAuditRecord` is the
 * production function, not a test copy, so the read path under test here is the
 * read path production runs.
 */
class FakeLedger implements AuditLedger {
  readonly rows: StoredAuditEvent[] = []

  async appendChained(
    institutionId: string,
    next: (previous: Parameters<Parameters<AuditLedger["appendChained"]>[1]>[0]) => AuditEventRow,
  ): Promise<void> {
    const previous =
      this.rows
        .filter(
          (r) =>
            r.institutionId === institutionId &&
            typeof (r.metadata as Record<string, unknown>)?.[CHAIN_METADATA_KEYS.sequence] ===
              "number",
        )
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .at(-1) ?? null

    const row = next(rehydrateAuditRecord(previous))

    this.rows.push({
      ...row,
      // The JSONB round trip: key order is not preserved, `undefined` is
      // dropped, and a Date inside metadata would come back a string.
      metadata: JSON.parse(JSON.stringify(row.metadata)) as unknown,
      occurredAt: new Date(row.occurredAt.getTime()),
    })
  }

  /** Every row as a canonical record, for `verifyChain`. */
  records() {
    return this.rows.map((r) => rehydrateAuditRecord(r)!).filter(Boolean)
  }

  metadataOf(index: number): Record<string, unknown> {
    return this.rows[index].metadata as Record<string, unknown>
  }
}

const INSTITUTION = "inst_1"

/** Minimal input; each test overrides only what it is about. */
const base = {
  institutionId: INSTITUTION,
  actor: { principalId: "user_1" },
  action: "Event.Rescheduled",
  resourceType: "Event",
  resourceId: "evt_1",
  outcome: "ALLOW" as const,
}

describe("a recorded event goes through the validated builder", () => {
  it("writes the row the table has columns for", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(
      { ...base, organizationId: "org_1", occurredAt: new Date("2026-08-01T12:00:00.000Z") },
      ledger,
    )

    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]).toMatchObject({
      institutionId: INSTITUTION,
      organizationId: "org_1",
      actorId: "user_1",
      action: "Event.Rescheduled",
      resourceType: "Event",
      resourceId: "evt_1",
      outcome: "ALLOW",
    })
    expect(ledger.rows[0].occurredAt.toISOString()).toBe("2026-08-01T12:00:00.000Z")
  })

  it("redacts a credential the caller put in metadata without thinking", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(
      { ...base, metadata: { venue: "Schlegel 203", sessionToken: "eyJhbGciOi..." } },
      ledger,
    )

    expect(ledger.metadataOf(0).venue).toBe("Schlegel 203")
    expect(ledger.metadataOf(0).sessionToken).toBe("[redacted]")
  })

  // The builder's refusal has to stay a refusal. Swallowing it here would turn
  // "this row is not evidence" into "this row is missing", which is worse:
  // nobody looks for a row that was never written.
  it("refuses an unattributable record instead of storing one", async () => {
    const ledger = new FakeLedger()

    await expect(
      recordAuditEvent({ ...base, outcome: "DENY" }, ledger),
    ).rejects.toBeInstanceOf(AuditRecordError)
    expect(ledger.rows).toHaveLength(0)
  })

  it("stamps the release the code was running under", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent({ ...base, releaseId: "sha-abc1234" }, ledger)

    expect(ledger.metadataOf(0)._releaseId).toBe("sha-abc1234")
  })

  it("takes the release from IMAGE_TAG when the caller does not supply one", async () => {
    const ledger = new FakeLedger()
    const before = process.env.IMAGE_TAG
    process.env.IMAGE_TAG = "sha-deadbee"
    try {
      await recordAuditEvent(base, ledger)
    } finally {
      if (before === undefined) delete process.env.IMAGE_TAG
      else process.env.IMAGE_TAG = before
    }

    expect(ledger.metadataOf(0)._releaseId).toBe("sha-deadbee")
  })
})

/**
 * PAY-000-007 — evidence can say which money-mode an action happened in.
 *
 * The mode is taken from the ambient tenant scope, which resolves it from the
 * tenant's published `platform.payments.mode`. These drive the PRODUCTION
 * writer (`recordAuditEvent`) inside a real `runInTenantScope`, not the helper
 * that reads the scope — a test that called `currentEnvironment()` directly
 * would stay green the day `recordAuditEvent` stopped calling it.
 */
describe("the money-mode on the row", () => {
  it("reads back the mode of the scope the action ran in", async () => {
    const ledger = new FakeLedger()

    await runInTenantScope(
      {
        institutionId: INSTITUTION,
        environment: "live",
        purpose: "interactive",
        actor: { principalId: "user_1", principalType: "user" },
      },
      () => recordAuditEvent(base, ledger),
    )

    expect(ledger.rows[0].mode).toBe("live")
    // Mirrored inside the hash-covered metadata too, so the column cannot be
    // rewritten around the application without breaking the chain.
    expect(ledger.metadataOf(0)._mode).toBe("live")
  })

  it("records a test-mode action as test, in the same code path", async () => {
    const ledger = new FakeLedger()

    await runInTenantScope(
      {
        institutionId: INSTITUTION,
        environment: "test",
        purpose: "interactive",
        actor: { principalId: "user_1", principalType: "user" },
      },
      () => recordAuditEvent(base, ledger),
    )

    expect(ledger.rows[0].mode).toBe("test")
    expect(ledger.metadataOf(0)._mode).toBe("test")
  })

  it("claims the least when there is no scope to read a mode from", async () => {
    // Outside a tenant scope entirely. `test` is the honest default: a row
    // saying `live` is one somebody will read as "real money moved".
    const ledger = new FakeLedger()
    await recordAuditEvent(base, ledger)
    expect(ledger.rows[0].mode).toBe("test")
  })

  it("lets the reconciler state a mode it has no scope for", async () => {
    // `reconcile` materialises the tenant, so it runs before a scope can be
    // opened for one. It says `test` outright rather than inheriting a default.
    const ledger = new FakeLedger()
    await recordAuditEvent({ ...base, mode: "test" }, ledger)
    expect(ledger.rows[0].mode).toBe("test")
  })

  it("keeps two tenants' modes apart within one process", async () => {
    // The separation, stated as the thing it is for: one deployment, one
    // process, two tenants, different modes. Nothing derived from NODE_ENV
    // could produce two different answers here.
    const ledger = new FakeLedger()

    await runInTenantScope(
      {
        institutionId: "inst_live",
        environment: "live",
        purpose: "interactive",
        actor: { principalId: "user_1", principalType: "user" },
      },
      () => recordAuditEvent({ ...base, institutionId: "inst_live" }, ledger),
    )
    await runInTenantScope(
      {
        institutionId: "inst_test",
        environment: "test",
        purpose: "interactive",
        actor: { principalId: "user_2", principalType: "user" },
      },
      () => recordAuditEvent({ ...base, institutionId: "inst_test" }, ledger),
    )

    expect(ledger.rows.map((r) => [r.institutionId, r.mode])).toEqual([
      ["inst_live", "live"],
      ["inst_test", "test"],
    ])
  })
})

describe("the hash chain", () => {
  it("starts at sequence 0 with nothing before it", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(base, ledger)

    expect(ledger.metadataOf(0)[CHAIN_METADATA_KEYS.sequence]).toBe(0)
    expect(ledger.metadataOf(0)[CHAIN_METADATA_KEYS.previousHash]).toBeNull()
    expect(ledger.metadataOf(0)[CHAIN_METADATA_KEYS.recordHash]).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("links each record to the one before it", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:00:00Z") }, ledger)
    await recordAuditEvent(
      { ...base, action: "Event.Edited", occurredAt: new Date("2026-08-01T12:05:00Z") },
      ledger,
    )
    await recordAuditEvent(
      { ...base, action: "Event.Cancelled", occurredAt: new Date("2026-08-01T12:10:00Z") },
      ledger,
    )

    expect(ledger.rows.map((_, i) => ledger.metadataOf(i)[CHAIN_METADATA_KEYS.sequence])).toEqual([
      0, 1, 2,
    ])
    expect(ledger.metadataOf(1)[CHAIN_METADATA_KEYS.previousHash]).toBe(
      ledger.metadataOf(0)[CHAIN_METADATA_KEYS.recordHash],
    )
    expect(ledger.metadataOf(2)[CHAIN_METADATA_KEYS.previousHash]).toBe(
      ledger.metadataOf(1)[CHAIN_METADATA_KEYS.recordHash],
    )
  })

  it("survives the round trip a JSONB column performs", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:00:00Z") }, ledger)
    await recordAuditEvent(
      { ...base, metadata: { hardConflicts: 2 }, occurredAt: new Date("2026-08-01T12:05:00Z") },
      ledger,
    )

    // Read back out of storage, rehydrated, and checked by the package's own
    // verifier — the same path a support console or an export would take.
    const verdict = verifyChain(ledger.records())

    expect(verdict).toMatchObject({ ok: true, checked: 2, unchained: 0, tampered: [], gaps: [] })
  })

  it("makes an edit performed around the application detectable", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(
      { ...base, outcome: "DENY", reason: "Not your event.", occurredAt: new Date("2026-08-01T12:00:00Z") },
      ledger,
    )
    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:05:00Z") }, ledger)

    // The rewrite the append-only extension refuses through Prisma and a psql
    // session does not: soften a denial after the fact.
    ledger.rows[0].reason = "Routine change."

    const verdict = verifyChain(ledger.records())

    expect(verdict.ok).toBe(false)
    expect(verdict.tampered).toHaveLength(1)
    expect(verdict.tampered[0]).toMatchObject({ sequence: 0, reason: "CONTENT_ALTERED" })
  })

  it("refuses to extend a chain whose last link has already been rewritten", async () => {
    const ledger = new FakeLedger()
    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:00:00Z") }, ledger)

    ledger.rows[0].reason = "Routine change."

    await expect(
      recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:05:00Z") }, ledger),
    ).rejects.toBeInstanceOf(AuditRecordError)
    expect(ledger.rows).toHaveLength(1)
  })

  it("keeps a chain per institution", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:00:00Z") }, ledger)
    await recordAuditEvent(
      { ...base, institutionId: "inst_2", occurredAt: new Date("2026-08-01T12:01:00Z") },
      ledger,
    )
    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:02:00Z") }, ledger)

    expect(ledger.metadataOf(1)[CHAIN_METADATA_KEYS.sequence]).toBe(0)
    expect(ledger.metadataOf(2)[CHAIN_METADATA_KEYS.sequence]).toBe(1)
    expect(ledger.metadataOf(2)[CHAIN_METADATA_KEYS.previousHash]).toBe(
      ledger.metadataOf(0)[CHAIN_METADATA_KEYS.recordHash],
    )
    expect(verifyChain(ledger.records()).ok).toBe(true)
  })

  // The condition that holds for as long as the other writers are unmigrated.
  it("steps over an unchained row from a writer that has not been migrated", async () => {
    const ledger = new FakeLedger()
    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:00:00Z") }, ledger)

    ledger.rows.push({
      institutionId: INSTITUTION,
      organizationId: null,
      actorId: "user_9",
      actorRole: null,
      action: "Document.Viewed",
      resourceType: "Document",
      resourceId: "doc_1",
      outcome: "ALLOW",
      reason: null,
      metadata: {},
      traceId: null,
      // The column's DEFAULT, which is what an unmigrated writer's row carries:
      // it never passes a mode, so the database supplies "test".
      mode: "test",
      occurredAt: new Date("2026-08-01T12:03:00Z"),
    })

    await recordAuditEvent({ ...base, occurredAt: new Date("2026-08-01T12:05:00Z") }, ledger)

    expect(ledger.metadataOf(2)[CHAIN_METADATA_KEYS.sequence]).toBe(1)
    expect(ledger.metadataOf(2)[CHAIN_METADATA_KEYS.previousHash]).toBe(
      ledger.metadataOf(0)[CHAIN_METADATA_KEYS.recordHash],
    )
  })
})

describe("rehydrating a stored row", () => {
  const stored: StoredAuditEvent = {
    institutionId: INSTITUTION,
    organizationId: null,
    actorId: "user_1",
    actorRole: null,
    action: "Document.Viewed",
    resourceType: "Document",
    resourceId: "doc_1",
    outcome: "ALLOW",
    reason: null,
    metadata: {},
    traceId: null,
    mode: "test",
    occurredAt: new Date("2026-08-01T12:00:00Z"),
  }

  it("returns null for a row carrying no chain position", () => {
    expect(rehydrateAuditRecord(stored)).toBeNull()
  })

  it("returns null for a row whose chain position is not a number", () => {
    expect(
      rehydrateAuditRecord({
        ...stored,
        metadata: { [CHAIN_METADATA_KEYS.sequence]: "0", [CHAIN_METADATA_KEYS.recordHash]: "x" },
      }),
    ).toBeNull()
  })

  it("returns null for nothing at all", () => {
    expect(rehydrateAuditRecord(null)).toBeNull()
  })
})

describe("the change block", () => {
  it("names the fields that changed, and only those", () => {
    const block = changeBlockFor({
      before: { title: "Case Prep", venue: "Schlegel 203", capacity: 40 },
      after: { title: "Case Prep", venue: "off campus", capacity: 40 },
    })

    expect(block.changedKeys).toEqual(["venue"])
  })

  it("counts a key that appears or disappears as a change", () => {
    const block = changeBlockFor({ before: { venue: "Schlegel 203" }, after: { venue: null } })

    expect(block.changedKeys).toEqual(["venue"])
  })

  // The property worth having and the one easiest to lose: a change to a
  // sensitive field must still be *recorded* as a change, even though the value
  // is not stored. Computing changedKeys after redaction would make both sides
  // "[redacted]" and report nothing changed.
  it("records that a credential changed without recording the credential", () => {
    const block = changeBlockFor({
      before: { passphrase: "hunter2", venue: "Schlegel 203" },
      after: { passphrase: "correct-horse", venue: "Schlegel 203" },
    })

    expect(block.changedKeys).toEqual(["passphrase"])
    expect(block.before.passphrase).toBe("[redacted]")
    expect(block.after.passphrase).toBe("[redacted]")
  })

  // The other side of that trade: the digest must not be a brute-forcible
  // commitment to a low-entropy secret, so it covers the redacted values only —
  // which makes two different secrets produce the same digest, deliberately.
  it("digests what is stored, not what was redacted away", () => {
    const a = changeBlockFor({ before: { passphrase: "hunter2" }, after: { passphrase: "a" } })
    const b = changeBlockFor({ before: { passphrase: "swordfish" }, after: { passphrase: "b" } })

    expect(a.digest).toBe(b.digest)
    expect(a.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("changes the digest when a stored value changes", () => {
    const a = changeBlockFor({ before: { venue: "Schlegel 203" }, after: { venue: "off campus" } })
    const b = changeBlockFor({ before: { venue: "Schlegel 203" }, after: { venue: "Rand 101" } })

    expect(a.digest).not.toBe(b.digest)
  })

  it("is stored on the row and covered by the record hash", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(
      {
        ...base,
        change: {
          before: { venue: "Schlegel 203" },
          after: { venue: "off campus" },
        },
      },
      ledger,
    )

    const block = ledger.metadataOf(0)[CHANGE_METADATA_KEY] as Record<string, unknown>
    expect(block.changedKeys).toEqual(["venue"])
    expect(block.after).toEqual({ venue: "off campus" })

    // Altering the recorded change breaks the record's own hash.
    ;(ledger.metadataOf(0)[CHANGE_METADATA_KEY] as Record<string, unknown>).after = {
      venue: "Schlegel 203",
    }
    expect(verifyChain(ledger.records()).ok).toBe(false)
  })
})

describe("the acting seat", () => {
  const ctx = (over: Partial<UserContext> = {}): UserContext => ({
    userId: "user_1",
    institutionRoles: [],
    orgRoles: [],
    ...over,
  })

  const seat = (over: Partial<UserContext["orgRoles"][number]> = {}) => ({
    organizationId: "org_1",
    roleId: "role_1",
    roleName: "Member",
    scope: "MEMBER",
    status: "ACTIVE",
    templateKey: "member",
    ...over,
  }) as UserContext["orgRoles"][number]

  it("prefers the seat that carries the authority", () => {
    const found = seatFor(
      ctx({ orgRoles: [seat(), seat({ roleId: "role_2", roleName: "President", scope: "PRESIDENT", templateKey: "president" })] }),
      { organizationId: "org_1", institutionId: INSTITUTION },
    )

    expect(found).toMatchObject({ roleId: "role_2", scope: "PRESIDENT", templateKey: "president" })
  })

  it("ignores a seat the actor no longer actively holds", () => {
    const found = seatFor(ctx({ orgRoles: [seat({ status: "ALUMNI" })] }), {
      organizationId: "org_1",
      institutionId: INSTITUTION,
    })

    expect(found).toBeUndefined()
  })

  it("ignores a seat in a different organization", () => {
    const found = seatFor(ctx({ orgRoles: [seat({ organizationId: "org_2" })] }), {
      organizationId: "org_1",
      institutionId: INSTITUTION,
    })

    expect(found).toBeUndefined()
  })

  it("records an institution-level role", () => {
    const found = seatFor(
      ctx({ institutionRoles: [{ institutionId: INSTITUTION, role: "OSE_DIRECTOR" }] }),
      { organizationId: "org_1", institutionId: INSTITUTION },
    )

    expect(found).toEqual({ institutionRole: "OSE_DIRECTOR" })
  })

  it("lands on the row, and supplies the role the actor held", async () => {
    const ledger = new FakeLedger()

    await recordAuditEvent(
      {
        ...base,
        seat: { roleId: "role_2", roleName: "President", templateKey: "president", scope: "PRESIDENT" },
      },
      ledger,
    )

    expect(ledger.metadataOf(0)[SEAT_METADATA_KEY]).toMatchObject({ roleId: "role_2" })
    // actorRole is what the audit console prints next to the name; it must say
    // the authority, not the surface the write happened to come from.
    expect(ledger.rows[0].actorRole).toBe("president")
  })
})
