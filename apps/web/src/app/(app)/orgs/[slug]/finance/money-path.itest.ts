/**
 * The money write paths, against a real PostgreSQL.
 *
 * These drive the PRODUCTION server actions — `submitReimbursement`,
 * `postLedgerEntry`, `reverseLedgerEntry`, `actOnApproval` — not helpers they
 * happen to call. Everything below the session is real: the Prisma client and
 * its tenancy extension, the schema's unique indexes and foreign keys, the
 * authorization engine, the permission catalog, the role templates, the
 * workflow definition and the approval digest.
 *
 * Three things are stubbed and no more, each because it is a property of an
 * HTTP request rather than of the code under test:
 *
 *   - `@/lib/auth` — who is signed in. Mutable, because the interesting claims
 *     are about DIFFERENT people acting on the same row.
 *   - `next/cache` `revalidatePath` — needs a render store.
 *   - `next/navigation` `redirect` — throws a framework signal; here it throws
 *     a catchable one carrying the same URL, which the tests assert on.
 *
 * `withTenantScope` is NOT stubbed. It already tolerates having no cookie jar
 * ("a scheduled job, a script, a unit test" — tenant-scope.ts), so the actions
 * open a real tenant scope and every query below runs through the real
 * extension.
 *
 * Needs DATABASE_URL. Run with `npm run test:isolation --workspace apps/web`.
 */
const REDIRECT = Symbol("redirect")

let signedInUserId = ""

jest.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: signedInUserId } }),
}))
jest.mock("next/cache", () => ({ revalidatePath: () => {} }))
jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error(`redirect:${url}`) as Error & { [REDIRECT]?: string }
    error[REDIRECT] = url
    throw error
  },
  notFound: () => {
    throw new Error("notFound")
  },
}))

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { reimbursementSubmissionKey, utcDay } from "@/lib/approvals"
import { ledgerSignedCents } from "@/lib/finance"
import { actOnApproval, createApproval } from "@/app/(app)/approvals/actions"
import {
  postLedgerEntry,
  reverseLedgerEntry,
  submitReimbursement,
} from "./actions"

// Fixture setup plus four end-to-end approval flows against a real database.
jest.setTimeout(180_000)

const RUN = Date.now().toString(36)
const institutionId = `inst-money-${RUN}`
// The pilot's slug, because module enablement and entitlements are keyed by it:
// `budgeting` and `reimbursements` are only on for a bound tenant, and a made-up
// slug resolves to the front door and nothing else — every finance decision
// would then be MODULE_NOT_ENABLED and the tests would pass for the wrong
// reason.
const institutionSlug = "rochester"
const organizationId = `org-money-${RUN}`
const otherOrganizationId = `org-money2-${RUN}`

const memberId = `u-member-${RUN}`
const presidentId = `u-pres-${RUN}`
const financeId = `u-fin-${RUN}`
const oseId = `u-ose-${RUN}`

let budgetLineId = ""
let otherBudgetLineId = ""

/** Run a server action as somebody, catching the framework redirect it ends on. */
async function actingAs<T>(userId: string, fn: () => Promise<T>): Promise<string | null> {
  signedInUserId = userId
  try {
    await fn()
    return null
  } catch (error) {
    const url = (error as { [REDIRECT]?: string })[REDIRECT]
    if (typeof url === "string") return url
    throw error
  }
}

/** The same, for actions expected to REFUSE. Returns the refusal message. */
async function refusalFrom(userId: string, fn: () => Promise<unknown>): Promise<string> {
  signedInUserId = userId
  try {
    await fn()
  } catch (error) {
    if ((error as { [REDIRECT]?: string })[REDIRECT]) {
      throw new Error("expected a refusal, got a redirect")
    }
    return (error as Error).message
  }
  throw new Error("expected a refusal, the action succeeded")
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

async function seat(opts: {
  userId: string
  name: string
  scope: "PRESIDENT" | "FUNCTIONAL"
  templateKey: string
  organizationId: string
}) {
  const role = await db.role.create({
    data: {
      organizationId: opts.organizationId,
      name: opts.name,
      scope: opts.scope,
      templateKey: opts.templateKey,
      seat: {
        create: {
          organizationId: opts.organizationId,
          positionCode: `SEAT-${RUN}-${opts.name}-${opts.organizationId}`.slice(0, 60),
          seatOrder: 0,
        },
      },
    },
  })
  await db.roleAssignment.create({
    data: { userId: opts.userId, roleId: role.id, status: "ACTIVE" },
  })
}

beforeAll(async () => {
  await runUnscoped("seed", "money-path fixture", async () => {
    // The pilot slug is unique, so a run whose teardown did not finish would
    // otherwise poison every later run with a constraint violation that has
    // nothing to do with the code under test.
    const stale = await db.institution.findUnique({ where: { slug: institutionSlug } })
    if (stale) {
      await db.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "institutionId" = $1`, stale.id)
      await db.outboxEvent.deleteMany({ where: { institutionId: stale.id } })
      const staleOrgs = await db.organization.findMany({
        where: { institutionId: stale.id },
        select: { id: true },
      })
      const ids = staleOrgs.map((o) => o.id)
      await db.ledgerEntry.deleteMany({ where: { organizationId: { in: ids }, reversesId: { not: null } } })
      await db.ledgerEntry.deleteMany({ where: { organizationId: { in: ids } } })
      await db.receiptAllocation.deleteMany({ where: { organizationId: { in: ids } } })
      await db.approvalRequest.deleteMany({ where: { organizationId: { in: ids } } })
      await db.budgetLine.deleteMany({ where: { organizationId: { in: ids } } })
      await db.roleAssignment.deleteMany({ where: { role: { organizationId: { in: ids } } } })
      await db.seat.deleteMany({ where: { organizationId: { in: ids } } })
      await db.role.deleteMany({ where: { organizationId: { in: ids } } })
      await db.organization.deleteMany({ where: { institutionId: stale.id } })
      await db.institutionMembership.deleteMany({ where: { institutionId: stale.id } })
      await db.institution.delete({ where: { id: stale.id } })
    }
    await db.institution.create({
      data: { id: institutionId, name: `Money ${RUN}`, slug: institutionSlug, serving: true },
    })
    await db.user.createMany({
      data: [
        { id: memberId, name: "Member", email: `${memberId}@x.test` },
        { id: presidentId, name: "President", email: `${presidentId}@x.test` },
        { id: financeId, name: "Finance", email: `${financeId}@x.test` },
        { id: oseId, name: "Oversight", email: `${oseId}@x.test` },
      ],
    })
    await db.institutionMembership.create({
      data: { userId: oseId, institutionId, role: "OSE_DIRECTOR" },
    })
    for (const [id, name] of [
      [organizationId, `Money club ${RUN}`],
      [otherOrganizationId, `Money club two ${RUN}`],
    ] as const) {
      await db.organization.create({
        data: { id, institutionId, name, slug: id, category: "PROFESSIONAL", status: "ACTIVE" },
      })
    }
    await seat({
      userId: memberId,
      name: "Member",
      scope: "FUNCTIONAL",
      templateKey: "unit.member",
      organizationId,
    })
    await seat({
      userId: presidentId,
      name: "President",
      scope: "PRESIDENT",
      templateKey: "unit.lead",
      organizationId,
    })
    await seat({
      userId: financeId,
      name: "VP Finance",
      scope: "FUNCTIONAL",
      templateKey: "finance.officer",
      organizationId,
    })
    await seat({
      userId: memberId,
      name: "Member",
      scope: "FUNCTIONAL",
      templateKey: "unit.member",
      organizationId: otherOrganizationId,
    })

    const line = await db.budgetLine.create({
      data: {
        organizationId,
        academicYear: "2026-2027",
        category: "Venue & Space",
        budgetedCents: 200_000,
        currency: "USD",
      },
    })
    budgetLineId = line.id
    const other = await db.budgetLine.create({
      data: {
        organizationId: otherOrganizationId,
        academicYear: "2026-2027",
        category: "Venue & Space",
        budgetedCents: 200_000,
        currency: "USD",
      },
    })
    otherBudgetLineId = other.id
  })
})

afterAll(async () => {
  await runUnscoped("seed", "money-path teardown", async () => {
    const orgs = [organizationId, otherOrganizationId]
    await db.ledgerEntry.deleteMany({ where: { organizationId: { in: orgs }, reversesId: { not: null } } })
    await db.ledgerEntry.deleteMany({ where: { organizationId: { in: orgs } } })
    await db.receiptAllocation.deleteMany({ where: { organizationId: { in: orgs } } })
    // ApprovalStep and AuditEvent are append-only through the client extension
    // (audit-append-only.ts) and refuse `deleteMany` — correctly. Steps go with
    // their request through the schema's own cascade; the audit rows are removed
    // by the raw statement below, which is the "reviewed database operation" the
    // extension's refusal points at, and is what a fixture teardown is.
    await db.approvalRequest.deleteMany({ where: { organizationId: { in: orgs } } })
    await db.budgetLine.deleteMany({ where: { organizationId: { in: orgs } } })
    await db.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "institutionId" = $1`, institutionId)
    await db.outboxEvent.deleteMany({ where: { institutionId } })
    await db.notification.deleteMany({ where: { userId: { in: [memberId, presidentId, financeId, oseId] } } })
    await db.roleAssignment.deleteMany({ where: { userId: { in: [memberId, presidentId, financeId, oseId] } } })
    await db.seat.deleteMany({ where: { organizationId: { in: orgs } } })
    await db.role.deleteMany({ where: { organizationId: { in: orgs } } })
    await db.organization.deleteMany({ where: { institutionId } })
    await db.institutionMembership.deleteMany({ where: { institutionId } })
    await db.institution.deleteMany({ where: { id: institutionId } })
    await db.user.deleteMany({ where: { id: { in: [memberId, presidentId, financeId, oseId] } } })
  })
  await db.$disconnect()
})

// ── PAY-060-007 ───────────────────────────────────────────────────────────────

describe("a double-submitted reimbursement raises ONE claim", () => {
  it("returns the existing claim instead of filing a second", async () => {
    const fields = () =>
      form({ budgetLineId, amount: "50", description: `Duplicate protection ${RUN}` })

    const first = await actingAs(memberId, () =>
      submitReimbursement(organizationId, fields()),
    )
    const second = await actingAs(memberId, () =>
      submitReimbursement(organizationId, fields()),
    )

    // Both submissions land on the same request, so the member who clicked
    // twice sees their claim rather than an error or a second claim.
    expect(first).toMatch(/^\/approvals\//)
    expect(second).toBe(first)

    const rows = await runUnscoped("migration", "assert", () =>
      db.approvalRequest.findMany({
        where: { organizationId, title: { contains: `Duplicate protection ${RUN}` } },
        select: { id: true, idempotencyKey: true },
      }),
    )
    expect(rows).toHaveLength(1)
    // The key on the row is the business key, not a client-supplied string.
    expect(rows[0].idempotencyKey).toBe(
      reimbursementSubmissionKey({
        organizationId,
        submittedById: memberId,
        budgetLineId,
        amountCents: 5000,
        description: `Duplicate protection ${RUN}`,
        submittedOn: utcDay(new Date()),
      }),
    )

    // One claim means one auto-post is possible, which is the reason the
    // duplicate mattered: each claim posts its own SPEND on final approval.
    const entries = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.count({ where: { approvalId: rows[0].id } }),
    )
    expect(entries).toBe(0)
  })

  it("does not collide across clubs, because the club is inside the key", async () => {
    const description = `Duplicate protection ${RUN}`
    const url = await actingAs(memberId, () =>
      submitReimbursement(otherOrganizationId, form({ budgetLineId: otherBudgetLineId, amount: "50", description })),
    )
    expect(url).toMatch(/^\/approvals\//)

    const both = await runUnscoped("migration", "assert", () =>
      db.approvalRequest.findMany({
        where: {
          organizationId: { in: [organizationId, otherOrganizationId] },
          title: { contains: description },
        },
        select: { organizationId: true, idempotencyKey: true },
      }),
    )
    expect(both).toHaveLength(2)
    expect(new Set(both.map((r) => r.idempotencyKey)).size).toBe(2)
  })

  it("scopes the unique index to the institution, not the platform", async () => {
    // Two tenants may legitimately hold the same literal key. A global
    // `@unique` — which is what this column carried before REVIEW-FINDINGS #7 —
    // would make tenant B's retry resolve onto tenant A's approval.
    const otherInstitutionId = `inst-money2-${RUN}`
    const key = `shared-key-${RUN}`
    await runUnscoped("migration", "assert", async () => {
      await db.institution.create({
        data: {
          id: otherInstitutionId,
          name: `Money two ${RUN}`,
          slug: `money-two-${RUN}`,
          serving: true,
        },
      })
      const org = await db.organization.create({
        data: {
          id: `org-money3-${RUN}`,
          institutionId: otherInstitutionId,
          name: `Elsewhere ${RUN}`,
          slug: `org-money3-${RUN}`,
          category: "PROFESSIONAL",
        },
      })
      const rowFor = (instId: string, orgId: string) => ({
        institutionId: instId,
        organizationId: orgId,
        type: "EXCEPTION" as const,
        title: `Shared key ${RUN}`,
        submittedById: memberId,
        idempotencyKey: key,
      })
      await db.approvalRequest.create({ data: rowFor(institutionId, organizationId) })
      await db.approvalRequest.create({ data: rowFor(otherInstitutionId, org.id) })

      const held = await db.approvalRequest.count({ where: { idempotencyKey: key } })
      expect(held).toBe(2)

      // …and within ONE institution it still refuses.
      await expect(
        db.approvalRequest.create({ data: rowFor(institutionId, organizationId) }),
      ).rejects.toMatchObject({ code: "P2002" })

      await db.approvalRequest.deleteMany({ where: { idempotencyKey: key } })
      await db.organization.deleteMany({ where: { institutionId: otherInstitutionId } })
      await db.institution.deleteMany({ where: { id: otherInstitutionId } })
    })
  })
})

describe("a double-submitted approval request raises ONE request", () => {
  it("covers the general create path, not only the reimbursement one", async () => {
    // The OTHER money-adjacent writer. `createApproval` also created
    // unconditionally, so a double-clicked BUDGET request put two decisions in
    // the queue for one ask.
    const title = `Double-clicked budget ask ${RUN}`
    const fields = () =>
      form({
        organizationId,
        type: "BUDGET",
        title,
        description: "Speaker fee",
        amount: "250",
        intent: "submit",
      })

    const first = await actingAs(memberId, () => createApproval(fields()))
    const second = await actingAs(memberId, () => createApproval(fields()))
    expect(first).toMatch(/^\/approvals\//)
    expect(second).toBe(first)

    const rows = await runUnscoped("migration", "assert", () =>
      db.approvalRequest.findMany({ where: { organizationId, title }, select: { id: true } }),
    )
    expect(rows).toHaveLength(1)

    // A DRAFT of the same content is a different act and is not swallowed by
    // the submission — `intent` is inside the key.
    const draft = await actingAs(memberId, () =>
      createApproval(
        form({
          organizationId,
          type: "BUDGET",
          title,
          description: "Speaker fee",
          amount: "250",
          intent: "draft",
        }),
      ),
    )
    expect(draft).not.toBe(first)
    const both = await runUnscoped("migration", "assert", () =>
      db.approvalRequest.findMany({ where: { organizationId, title }, select: { status: true } }),
    )
    expect(both).toHaveLength(2)
    expect(both.map((r) => r.status).sort()).toEqual(["DRAFT", "PENDING_PRESIDENT"])
  })
})

// ── PAY-070-005 (verification: implemented as PAY-150-004) ────────────────────

describe("an amount changed after a gate approved it is not posted", () => {
  it("sends the request back to NEEDS_CHANGES and posts nothing", async () => {
    const description = `Digest binding ${RUN}`
    const url = await actingAs(memberId, () =>
      submitReimbursement(organizationId, form({ budgetLineId, amount: "50", description })),
    )
    const approvalId = url!.split("/").pop()!

    await actingAs(presidentId, () => actOnApproval(approvalId, form({ action: "approve" })))
    const afterFirstGate = await runUnscoped("migration", "assert", () =>
      db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }),
    )
    expect(afterFirstGate.status).toBe("PENDING_OSE")

    // The mutation this control exists for: the JSON column is rewritten
    // between the gate that consented and the gate that posts.
    await runUnscoped("migration", "tamper", () =>
      db.approvalRequest.update({
        where: { id: approvalId },
        data: {
          metadata: {
            currency: "USD",
            reimbursement: {
              budgetLineId,
              amountCents: 500_000,
              documentId: null,
              category: "Venue & Space",
              academicYear: "2026-2027",
            },
          },
        },
      }),
    )

    const refusal = await refusalFrom(oseId, () =>
      actOnApproval(approvalId, form({ action: "approve" })),
    )
    expect(refusal).toMatch(/changed\s+after an earlier gate approved it/)

    const after = await runUnscoped("migration", "assert", async () => ({
      request: await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }),
      posted: await db.ledgerEntry.count({ where: { approvalId } }),
    }))
    expect(after.request.status).toBe("NEEDS_CHANGES")
    expect(after.request.status).not.toBe("APPROVED")
    expect(after.posted).toBe(0)
  })
})

// ── PAY-120-001 ───────────────────────────────────────────────────────────────

describe("a posted entry is corrected by a reversal, not a delete", () => {
  it("keeps both rows and returns the line's actual to where it started", async () => {
    const before = await runUnscoped("migration", "assert", () =>
      db.budgetLine.findUniqueOrThrow({ where: { id: budgetLineId }, select: { actualCents: true } }),
    )

    await actingAs(financeId, () =>
      postLedgerEntry(
        organizationId,
        form({
          budgetLineId,
          kind: "SPEND",
          amount: "125",
          description: `Reversible spend ${RUN}`,
          occurredAt: "2026-08-01",
        }),
      ),
    )

    const posted = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.findFirstOrThrow({
        where: { budgetLineId, description: `Reversible spend ${RUN}` },
      }),
    )
    expect(posted.amountCents).toBe(12_500)

    const afterPost = await runUnscoped("migration", "assert", () =>
      db.budgetLine.findUniqueOrThrow({ where: { id: budgetLineId }, select: { actualCents: true } }),
    )
    expect(afterPost.actualCents).toBe(before.actualCents + 12_500)

    await actingAs(financeId, () =>
      reverseLedgerEntry(
        organizationId,
        form({ id: posted.id, reason: "Posted against the wrong line" }),
      ),
    )

    const after = await runUnscoped("migration", "assert", async () => ({
      original: await db.ledgerEntry.findUnique({ where: { id: posted.id } }),
      reversal: await db.ledgerEntry.findFirst({ where: { reversesId: posted.id } }),
      line: await db.budgetLine.findUniqueOrThrow({
        where: { id: budgetLineId },
        select: { actualCents: true },
      }),
      pair: await db.ledgerEntry.count({
        where: { budgetLineId, OR: [{ id: posted.id }, { reversesId: posted.id }] },
      }),
    }))

    // Two rows survive: the original is still readable, exactly as posted.
    expect(after.pair).toBe(2)
    expect(after.original?.amountCents).toBe(12_500)
    expect(after.original?.description).toBe(`Reversible spend ${RUN}`)

    // The reversal is an entry in its own right: opposite sign, its own kind,
    // its reason, and a link to what it answers.
    expect(after.reversal?.kind).toBe("REVERSAL")
    expect(after.reversal?.amountCents).toBe(ledgerSignedCents("REVERSAL", 12_500))
    expect(after.reversal?.amountCents).toBe(-12_500)
    expect(after.reversal?.reversalReason).toBe("Posted against the wrong line")
    expect(after.reversal?.postedById).toBe(financeId)
    expect(after.reversal?.currency).toBe("USD")

    // And the line is back where it was — through the same aggregate, with no
    // special case for reversals.
    expect(after.line.actualCents).toBe(before.actualCents)
  })

  it("refuses a reversal with no reason, and refuses to reverse twice", async () => {
    await actingAs(financeId, () =>
      postLedgerEntry(
        organizationId,
        form({
          budgetLineId,
          kind: "SPEND",
          amount: "40",
          description: `Twice-reversed ${RUN}`,
          occurredAt: "2026-08-02",
        }),
      ),
    )
    const posted = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.findFirstOrThrow({
        where: { budgetLineId, description: `Twice-reversed ${RUN}` },
      }),
    )

    const noReason = await refusalFrom(financeId, () =>
      reverseLedgerEntry(organizationId, form({ id: posted.id, reason: "  " })),
    )
    expect(noReason).toMatch(/say why/i)

    await actingAs(financeId, () =>
      reverseLedgerEntry(organizationId, form({ id: posted.id, reason: "First correction" })),
    )
    const twice = await refusalFrom(financeId, () =>
      reverseLedgerEntry(organizationId, form({ id: posted.id, reason: "Second correction" })),
    )
    expect(twice).toMatch(/already been reversed/i)

    const reversals = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.count({ where: { reversesId: posted.id } }),
    )
    expect(reversals).toBe(1)
  })
})

// ── PAY-150-001 ───────────────────────────────────────────────────────────────

describe("posting and reversing are separate capabilities", () => {
  it("lets the president post but refuses the reversal, in the catalog's words", async () => {
    // The president's seat carries `finance.ledger.post` and deliberately not
    // `finance.ledger.reverse` (packages/authorization/src/role-templates.ts).
    // Under the coarse `canManageFinance` boolean this person could do both.
    await actingAs(presidentId, () =>
      postLedgerEntry(
        organizationId,
        form({
          budgetLineId,
          kind: "SPEND",
          amount: "70",
          description: `President posting ${RUN}`,
          occurredAt: "2026-08-03",
        }),
      ),
    )
    const posted = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.findFirstOrThrow({
        where: { budgetLineId, description: `President posting ${RUN}` },
      }),
    )
    expect(posted.postedById).toBe(presidentId)

    const refusal = await refusalFrom(presidentId, () =>
      reverseLedgerEntry(organizationId, form({ id: posted.id, reason: "Changed my mind" })),
    )
    // The engine's own sentence, naming the capability — not "you do not have
    // permission to manage this club's finances" for six different reasons.
    expect(refusal).toContain("finance.ledger.reverse")
    expect(refusal).toMatch(/No role held in this tenant confers/)

    const reversals = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.count({ where: { reversesId: posted.id } }),
    )
    expect(reversals).toBe(0)

    // The DENY is on the trail, with the reason that produced it.
    const denied = await runUnscoped("migration", "assert", () =>
      db.auditEvent.findFirst({
        where: { organizationId, actorId: presidentId, action: "Finance.ReverseLedger" },
        orderBy: { occurredAt: "desc" },
      }),
    )
    expect(denied?.outcome).toBe("DENY")
    expect(denied?.reason).toContain("finance.ledger.reverse")

    // …and the finance officer, who holds the capability, can.
    await actingAs(financeId, () =>
      reverseLedgerEntry(organizationId, form({ id: posted.id, reason: "Correcting the president's posting" })),
    )
    const now = await runUnscoped("migration", "assert", () =>
      db.ledgerEntry.count({ where: { reversesId: posted.id } }),
    )
    expect(now).toBe(1)
  })

  it("records the ALLOW with the action that was taken, not the capability", async () => {
    // Four actions share `finance.budget.update`; the trail still has to say
    // which one happened.
    const rows = await runUnscoped("migration", "assert", () =>
      db.auditEvent.findMany({
        where: { organizationId, action: { startsWith: "Finance." } },
        select: { action: true, outcome: true },
      }),
    )
    expect(rows.some((r) => r.action === "Finance.PostLedger" && r.outcome === "ALLOW")).toBe(true)
    expect(rows.some((r) => r.action === "Finance.ReverseLedger" && r.outcome === "ALLOW")).toBe(true)
  })
})
