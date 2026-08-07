import { PrismaClient, Prisma } from "@prisma/client"

/**
 * The payments schema, proved against a real PostgreSQL database.
 *
 * Five claims, and every one of them is invisible to a unit test because every
 * one is a property of the DDL rather than of any function:
 *
 *   1. REVIEW-FINDINGS #7 / PAY-020-004 / PAY-140-005 — `idempotencyKey` is
 *      unique PER TENANT, not globally. Two institutions may submit the same
 *      client key; one institution may not reuse it.
 *   2. PAY-030-007 — LedgerEntry is filterable by `institutionId` with NO join,
 *      and carries the currency it is denominated in.
 *   3. PAY-080-004 — event / seat / fund attribution round-trips, and survives
 *      being linked to a Settlement.
 *   4. PAY-030-006 — deleting an Organization is REFUSED while financial
 *      history points at it.
 *   5. PAY-130-004 — the provider balance-transaction key is qualified by mode
 *      and account, so the same external id in test and live coexists.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 *
 * A plain client, deliberately: the tenancy extension is proved in
 * tenancy/isolation.itest.ts, and mixing it in here would mean a failure could
 * be either the constraint or the scope. These are statements about the
 * database.
 */

const db = new PrismaClient({ log: ["error"] })

/**
 * Both hooks seed or tear down about a dozen rows across two tenants, over a
 * connection that may be shared with the rest of the suite. Jest's 5-second
 * default is a coin flip on a loaded machine, and a fixture that times out
 * intermittently is worse than no fixture: it teaches a reader to re-run rather
 * than to look.
 */
const HOOK_TIMEOUT_MS = 60_000

const SUFFIX = "itest-payments"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`
const SHARED_KEY = `retry-key-${SUFFIX}`

async function cleanup() {
  // Order matters now: Restrict means the children have to go first, which is
  // itself a small demonstration of the property under test.
  const orgs = await db.organization.findMany({
    where: { institutionId: { in: [INST_A, INST_B] } },
    select: { id: true },
  })
  const orgIds = orgs.map((o) => o.id)
  await db.receiptAllocation.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.ledgerEntry.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.settlement.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.externalReference.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.providerBalanceTransaction.deleteMany({
    where: { institutionId: { in: [INST_A, INST_B] } },
  })
  await db.approvalStep.deleteMany({ where: { approval: { institutionId: { in: [INST_A, INST_B] } } } })
  await db.approvalRequest.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.event.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.budgetLine.deleteMany({ where: { organizationId: { in: orgIds } } })
  await db.transaction.deleteMany({ where: { budget: { organizationId: { in: orgIds } } } })
  await db.budget.deleteMany({ where: { organizationId: { in: orgIds } } })
  await db.vendor.deleteMany({ where: { organizationId: { in: orgIds } } })
  await db.seat.deleteMany({ where: { organizationId: { in: orgIds } } })
  await db.role.deleteMany({ where: { organizationId: { in: orgIds } } })
  await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
  await db.organization.deleteMany({ where: { id: `org-solo-${SUFFIX}` } })
  await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
}

/** Ids built from the suffix, so a re-run is idempotent and two suites cannot collide. */
const ORG_A = `org-a-${SUFFIX}`
const ORG_B = `org-b-${SUFFIX}`
const LINE_A = `line-a-${SUFFIX}`
const LINE_JPY = `line-jpy-${SUFFIX}`
const EVENT_A = `event-a-${SUFFIX}`
const SEAT_A = `seat-a-${SUFFIX}`
const ROLE_A = `role-a-${SUFFIX}`

beforeAll(async () => {
  await cleanup()

  await db.institution.createMany({
    data: [
      { serving: true, id: INST_A, name: "Tenant A", slug: `pay-a-${SUFFIX}` },
      { serving: true, id: INST_B, name: "Tenant B", slug: `pay-b-${SUFFIX}` },
    ],
  })
  await db.organization.createMany({
    data: [
      { id: ORG_A, institutionId: INST_A, name: "A Club", slug: `pay-a-club-${SUFFIX}` },
      { id: ORG_B, institutionId: INST_B, name: "B Club", slug: `pay-b-club-${SUFFIX}` },
    ],
  })
  await db.role.create({
    data: { id: ROLE_A, organizationId: ORG_A, name: `Treasurer ${SUFFIX}` },
  })
  await db.seat.create({ data: { id: SEAT_A, organizationId: ORG_A, roleId: ROLE_A } })
  await db.event.create({
    data: {
      id: EVENT_A,
      institutionId: INST_A,
      organizationId: ORG_A,
      title: "Spring Formal",
      startAt: new Date("2026-04-01T18:00:00.000Z"),
      endAt: new Date("2026-04-01T22:00:00.000Z"),
    },
  })
  await db.budgetLine.createMany({
    data: [
      {
        id: LINE_A,
        organizationId: ORG_A,
        academicYear: "2026-2027",
        category: "Events",
        currency: "USD",
      },
      {
        id: LINE_JPY,
        organizationId: ORG_A,
        academicYear: "2026-2027",
        category: "Tokyo trip",
        currency: "JPY",
      },
    ],
  })
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
}, HOOK_TIMEOUT_MS)

// ── 1. The P0: the idempotency key is scoped to its tenant ──────────────────

describe("ApprovalRequest.idempotencyKey", () => {
  it("lets two institutions use the SAME client key", async () => {
    // The leak this replaced: one global unique index, so tenant B's retry of
    // "retry-key" resolved onto tenant A's approval — a cross-tenant handle
    // handed to whoever guessed a key.
    const a = await db.approvalRequest.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        type: "BUDGET",
        title: "A's request",
        submittedById: "user-a",
        idempotencyKey: SHARED_KEY,
      },
    })
    const b = await db.approvalRequest.create({
      data: {
        institutionId: INST_B,
        organizationId: ORG_B,
        type: "BUDGET",
        title: "B's request",
        submittedById: "user-b",
        idempotencyKey: SHARED_KEY,
      },
    })

    expect(a.id).not.toBe(b.id)
    const both = await db.approvalRequest.findMany({
      where: { idempotencyKey: SHARED_KEY },
      select: { id: true, institutionId: true },
      orderBy: { institutionId: "asc" },
    })
    expect(both.map((r) => r.institutionId)).toEqual([INST_A, INST_B])
  })

  it("still refuses the same key twice inside ONE institution", async () => {
    // The half that has to keep working: scoping the index must not turn the
    // idempotency guarantee off.
    await expect(
      db.approvalRequest.create({
        data: {
          institutionId: INST_A,
          organizationId: ORG_A,
          type: "BUDGET",
          title: "A's retry",
          submittedById: "user-a",
          idempotencyKey: SHARED_KEY,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("leaves un-keyed requests free — NULLs are distinct in a unique index", async () => {
    const first = await db.approvalRequest.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        type: "EVENT",
        title: "No key 1",
        submittedById: "user-a",
      },
    })
    const second = await db.approvalRequest.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        type: "EVENT",
        title: "No key 2",
        submittedById: "user-a",
      },
    })
    expect(first.id).not.toBe(second.id)
  })

  it("resolves a tenant's own key back to that tenant's approval", async () => {
    const resolved = await db.approvalRequest.findUnique({
      where: {
        institutionId_idempotencyKey: { institutionId: INST_B, idempotencyKey: SHARED_KEY },
      },
      select: { title: true, institutionId: true },
    })
    expect(resolved).toMatchObject({ title: "B's request", institutionId: INST_B })
  })
})

// ── 2/3. The ledger carries its tenant, its currency and its attribution ────

describe("LedgerEntry", () => {
  it("is filterable by institutionId with no join", async () => {
    await db.ledgerEntry.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        budgetLineId: LINE_A,
        academicYear: "2026-2027",
        // PAY-130-002 added double entry: every posting is one SIDE of a
        // journal. These are set explicitly rather than defaulted — a row that
        // does not say which journal it belongs to has no other half.
        journalId: `journal-spend-${SUFFIX}`,
        templateId: "manual.spend",
        account: "5000-program-expense",
        side: "DEBIT",
        kind: "SPEND",
        amountCents: 12_500,
        currency: "USD",
        description: "Venue deposit",
      },
    })

    // No `organization: { institutionId }` relation filter anywhere: the tenant
    // is on the row. Before this column, "every posting in this institution"
    // could not be expressed without a join.
    const rows = await db.ledgerEntry.findMany({
      where: { institutionId: INST_A },
      select: { description: true, currency: true },
    })
    expect(rows).toEqual([{ description: "Venue deposit", currency: "USD" }])
  })

  it("round-trips event, seat and fund attribution, and a settlement link", async () => {
    const reference = await db.externalReference.create({
      data: {
        institutionId: INST_A,
        provider: "stripe",
        mode: "live",
        connectedAccountId: "acct_1",
        objectType: "payout",
        externalId: "po_1",
        canonicalId: `canonical-${SUFFIX}`,
      },
    })
    const settlement = await db.settlement.create({
      data: {
        institutionId: INST_A,
        externalReferenceId: reference.id,
        occurredAt: new Date("2026-04-05T00:00:00.000Z"),
        currency: "USD",
        grossMinorUnits: 30_000,
        feeMinorUnits: 900,
        netMinorUnits: 29_100,
      },
    })

    const entry = await db.ledgerEntry.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        budgetLineId: LINE_A,
        academicYear: "2026-2027",
        journalId: `journal-receipt-${SUFFIX}`,
        templateId: "manual.recovery",
        account: "5000-program-expense",
        side: "CREDIT",
        kind: "RECEIPT",
        amountCents: -30_000,
        currency: "USD",
        description: "Formal ticket sales",
        eventId: EVENT_A,
        seatId: SEAT_A,
        postedBySeatId: SEAT_A,
        fundCode: "GEN",
        settlementId: settlement.id,
      },
    })

    // The property PAY-080-004 asks for: attribution SURVIVES the hop through
    // settlement, rather than being reconstructed from a bank line afterwards.
    const readBack = await db.ledgerEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { event: { select: { title: true } }, settlement: true, seat: true },
    })
    expect(readBack.event?.title).toBe("Spring Formal")
    expect(readBack.seat?.id).toBe(SEAT_A)
    expect(readBack.postedBySeatId).toBe(SEAT_A)
    expect(readBack.fundCode).toBe("GEN")
    expect(readBack.settlement?.netMinorUnits).toBe(29_100)
    expect(readBack.kind).toBe("RECEIPT")
  })

  it("holds a JPY entry alongside a USD one, each saying which it is", async () => {
    await db.ledgerEntry.create({
      data: {
        institutionId: INST_A,
        organizationId: ORG_A,
        budgetLineId: LINE_JPY,
        academicYear: "2026-2027",
        journalId: `journal-jpy-${SUFFIX}`,
        templateId: "manual.spend",
        account: "5000-program-expense",
        side: "DEBIT",
        kind: "SPEND",
        amountCents: 120_000,
        currency: "JPY",
        description: "Shinkansen",
      },
    })
    const byCurrency = await db.ledgerEntry.groupBy({
      by: ["currency"],
      where: { institutionId: INST_A },
      _count: { _all: true },
    })
    expect(byCurrency.map((g) => g.currency).sort()).toEqual(["JPY", "USD"])
  })

  it("splits a receipt into allocations that sum back to it", async () => {
    const receipt = await db.ledgerEntry.findFirstOrThrow({
      where: { institutionId: INST_A, kind: "RECEIPT" },
    })
    await db.receiptAllocation.createMany({
      data: [
        {
          institutionId: INST_A,
          ledgerEntryId: receipt.id,
          source: "EVENT",
          organizationId: ORG_A,
          eventId: EVENT_A,
          fundCode: "GEN",
          minorUnits: 20_000,
          currency: "USD",
        },
        {
          institutionId: INST_A,
          ledgerEntryId: receipt.id,
          source: "EVENT",
          organizationId: ORG_A,
          eventId: EVENT_A,
          fundCode: "TRAVEL",
          minorUnits: 10_000,
          currency: "USD",
        },
      ],
    })
    const total = await db.receiptAllocation.aggregate({
      where: { ledgerEntryId: receipt.id },
      _sum: { minorUnits: true },
    })
    expect(total._sum.minorUnits).toBe(Math.abs(receipt.amountCents))
  })
})

// ── 4. Financial history is not cascade-deleted ─────────────────────────────

describe("deleting an Organization", () => {
  it("is REFUSED while a LedgerEntry points at it", async () => {
    const before = await db.ledgerEntry.count({ where: { organizationId: ORG_A } })
    expect(before).toBeGreaterThan(0)

    await expect(db.organization.delete({ where: { id: ORG_A } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    )

    // The point of the whole requirement: the history is still there.
    expect(await db.ledgerEntry.count({ where: { organizationId: ORG_A } })).toBe(before)
    expect(await db.organization.findUnique({ where: { id: ORG_A } })).not.toBeNull()
  })

  it("is refused for a budget line too, not only the ledger", async () => {
    await expect(db.organization.delete({ where: { id: ORG_B } })).resolves.toBeTruthy()
    // ORG_B had no financial rows, so it CAN go — restricting is not the same as
    // freezing. Re-create it for teardown symmetry.
    await db.organization.create({
      data: { id: ORG_B, institutionId: INST_B, name: "B Club", slug: `pay-b-club-${SUFFIX}` },
    })
    await db.budgetLine.create({
      data: {
        organizationId: ORG_B,
        academicYear: "2026-2027",
        category: "Anything",
        currency: "USD",
      },
    })
    await expect(db.organization.delete({ where: { id: ORG_B } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    )
  })

  it("is refused by the LEDGER's own foreign key, not merely by a sibling", async () => {
    // The sharp version. The case above passes while five of the six relations
    // restrict and one cascades — some other FK refuses first and the ledger
    // survives for the wrong reason. Here the club has ONE financial row and it
    // is a LedgerEntry with no budget line, so the only constraint that can
    // refuse is LedgerEntry_organizationId_fkey.
    const orgId = `org-solo-${SUFFIX}`
    await db.organization.create({
      data: { id: orgId, institutionId: INST_A, name: "Solo", slug: `pay-solo-${SUFFIX}` },
    })
    await db.ledgerEntry.create({
      data: {
        institutionId: INST_A,
        organizationId: orgId,
        academicYear: "2026-2027",
        journalId: `journal-solo-${SUFFIX}`,
        templateId: "manual.spend",
        account: "2000-reimbursement-payable",
        side: "CREDIT",
        kind: "SPEND",
        amountCents: 500,
        currency: "USD",
        description: "Payable, no budget dimension",
      },
    })
    expect(await db.budgetLine.count({ where: { organizationId: orgId } })).toBe(0)

    await expect(db.organization.delete({ where: { id: orgId } })).rejects.toMatchObject({
      code: "P2003",
    })
    expect(await db.ledgerEntry.count({ where: { organizationId: orgId } })).toBe(1)
  })

  it("declares RESTRICT on all six financial relations in the live DDL", async () => {
    // Read off pg_constraint rather than inferred from behaviour: five of the
    // six can be flipped to Cascade without any behavioural case noticing,
    // because a sibling constraint refuses first. `confdeltype` is the
    // referential action — 'r' is RESTRICT, 'c' is CASCADE.
    const rows = await db.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype::text
        FROM pg_constraint
       WHERE conname IN (
         'Budget_organizationId_fkey',
         'Transaction_budgetId_fkey',
         'BudgetLine_organizationId_fkey',
         'Vendor_organizationId_fkey',
         'LedgerEntry_organizationId_fkey',
         'LedgerEntry_budgetLineId_fkey'
       )
       ORDER BY conname
    `
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(`${row.conname}=${row.confdeltype}`).toBe(`${row.conname}=r`)
    }
  })

  it("leaves archiving as the removal path that works", async () => {
    const archived = await db.organization.update({
      where: { id: ORG_A },
      data: { status: "ARCHIVED" },
    })
    expect(archived.status).toBe("ARCHIVED")
    expect(await db.ledgerEntry.count({ where: { organizationId: ORG_A } })).toBeGreaterThan(0)
    await db.organization.update({ where: { id: ORG_A }, data: { status: "ACTIVE" } })
  })
})

// ── 5. The provider key is qualified ────────────────────────────────────────

describe("ProviderBalanceTransaction", () => {
  const common = {
    institutionId: INST_A,
    provider: "stripe",
    providerAccountId: "acct_1",
    externalId: "txn_1",
    currency: "USD",
    grossMinorUnits: 10_000,
    feeMinorUnits: 320,
    netMinorUnits: 9_680,
    occurredAt: new Date("2026-04-06T00:00:00.000Z"),
  }

  it("holds the same external id in test and in live", async () => {
    await db.providerBalanceTransaction.create({
      data: { ...common, mode: "live", payloadDigest: "digest-live" },
    })
    await db.providerBalanceTransaction.create({
      data: { ...common, mode: "test", payloadDigest: "digest-test" },
    })
    expect(
      await db.providerBalanceTransaction.count({ where: { externalId: "txn_1" } }),
    ).toBe(2)
  })

  it("refuses the same id twice within one mode and account", async () => {
    await expect(
      db.providerBalanceTransaction.create({
        data: { ...common, mode: "live", payloadDigest: "digest-live" },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })
})

// ── ExternalReference: the qualified uniqueness PAY-030-003 needs ───────────

describe("ExternalReference", () => {
  it("qualifies by provider, mode, account and object type", async () => {
    const base = {
      institutionId: INST_A,
      provider: "stripe",
      connectedAccountId: "acct_9",
      objectType: "customer",
      externalId: "cus_1",
    }
    await db.externalReference.create({
      data: { ...base, mode: "live", canonicalId: `cust-live-${SUFFIX}` },
    })
    await db.externalReference.create({
      data: { ...base, mode: "test", canonicalId: `cust-test-${SUFFIX}` },
    })
    await expect(
      db.externalReference.create({
        data: { ...base, mode: "live", canonicalId: `cust-dupe-${SUFFIX}` },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("keeps the canonical id unique within a tenant", async () => {
    await expect(
      db.externalReference.create({
        data: {
          institutionId: INST_A,
          provider: "adyen",
          mode: "live",
          connectedAccountId: "acct_other",
          objectType: "customer",
          externalId: "shopper_1",
          canonicalId: `cust-live-${SUFFIX}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })
})
