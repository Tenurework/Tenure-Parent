/**
 * PAY-150-004 — the approval that no longer covers what it approved.
 *
 * The two-gate flow re-reads the money-bearing payload out of a Json column at
 * DECISION time. `actOnApproval` posts `reimbursement.amountCents` to the
 * ledger and increments the budget line by it, and the compare-and-swap on the
 * final write guards `status` and nothing else — so the president could approve
 * $50 and the staff office post $5,000, with an unbroken-looking trail.
 *
 * This runs the REAL server action against real Postgres: no fixture step rows,
 * no hand-built policy snapshots. The president's gate step is written by
 * `actOnApproval` itself, which is what makes this a test of the producer
 * rather than of a helper — a mutation that stops the producer recording the
 * digest reds it, and a mutation that stops the decision comparing it reds it
 * too.
 *
 * Needs a live database, so it is a `.itest.ts` and runs under
 * `npm run test:isolation`, not in the default jest run.
 */

// Real Postgres, a cold connection and a dozen fixture writes: the 5-second
// default is a flake, not a budget. The suite completes in under ten.
jest.setTimeout(60_000)

/** Whose session the action runs under. Reassigned between steps. */
let mockActorId = ""

jest.mock("next/cache", () => ({ revalidatePath: () => {} }))
jest.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: mockActorId } }),
}))

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { actOnApproval } from "@/app/(app)/approvals/actions"
import { approvalDigest, recordedPayloadDigest } from "@/lib/approvals"

/** Distinct per run: this suite writes rows and is not idempotent. */
const RUN = Date.now().toString(36)
const institutionId = `inst-digest-${RUN}`
const organizationId = `org-digest-${RUN}`
const filerId = `user-filer-${RUN}`
const presidentId = `user-pres-${RUN}`
const directorId = `user-dir-${RUN}`

const FILED_CENTS = 5_000

function act(actorId: string, approvalId: string, action: string) {
  mockActorId = actorId
  const form = new FormData()
  form.set("action", action)
  return actOnApproval(approvalId, form)
}

async function seedApproval(id: string) {
  await runUnscoped("seed", "digest fixture approval", async () => {
    await db.approvalRequest.create({
      data: {
        id,
        institutionId,
        organizationId,
        type: "EXCEPTION",
        title: "Reimbursement: catering",
        submittedById: filerId,
        status: "PENDING_PRESIDENT",
        metadata: {
          currency: "USD",
          reimbursement: {
            budgetLineId: `line-${RUN}`,
            amountCents: FILED_CENTS,
            documentId: null,
            category: "Catering",
            academicYear: "2026-2027",
          },
        },
      },
    })
    // The submission step, exactly as `fileReimbursement` writes it.
    await db.approvalStep.create({
      data: {
        approvalId: id,
        fromStatus: "DRAFT",
        toStatus: "PENDING_PRESIDENT",
        actorId: filerId,
        actorRoleContext: "Member",
        policySnapshot: {
          requesterIsPresident: false,
          payloadDigest: approvalDigest(
            {
              currency: "USD",
              reimbursement: {
                budgetLineId: `line-${RUN}`,
                amountCents: FILED_CENTS,
                documentId: null,
                category: "Catering",
                academicYear: "2026-2027",
              },
            },
            {
              organizationId,
              type: "EXCEPTION",
              amountMinorUnits: FILED_CENTS,
              currency: "USD",
            },
          ),
        },
        configRevision: "platform-defaults@0",
        configChecksum: "fixture",
        authority: "finance.reimbursement.create",
      },
    })
  })
}

/** Rewrite the amount on the row, the way an edit between gates would. */
async function retagAmount(id: string, amountCents: number) {
  await runUnscoped("seed", "mutate claim amount", async () => {
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { id } })
    const meta = row.metadata as {
      currency: string
      reimbursement: Record<string, unknown>
    }
    await db.approvalRequest.update({
      where: { id },
      data: {
        metadata: {
          ...meta,
          reimbursement: { ...meta.reimbursement, amountCents },
        },
      },
    })
  })
}

beforeAll(async () => {
  await runUnscoped("seed", "digest fixtures", async () => {
    await db.institution.create({
      data: {
        id: institutionId,
        name: `Digest fixture ${RUN}`,
        slug: institutionId,
        serving: true,
      },
    })
    await db.user.createMany({
      data: [
        { id: filerId, name: "Filer", email: `filer-${RUN}@example.invalid` },
        { id: presidentId, name: "Pres", email: `pres-${RUN}@example.invalid` },
        { id: directorId, name: "Dir", email: `dir-${RUN}@example.invalid` },
      ],
    })
    await db.organization.create({
      data: {
        id: organizationId,
        institutionId,
        name: `Digest club ${RUN}`,
        slug: organizationId,
        status: "ACTIVE",
      },
    })
    const memberRole = await db.role.create({
      data: {
        organizationId,
        name: "Member",
        scope: "FUNCTIONAL",
        templateKey: "unit.member",
      },
    })
    const presidentRole = await db.role.create({
      data: {
        organizationId,
        name: "President",
        scope: "PRESIDENT",
        templateKey: "unit.lead",
      },
    })
    await db.roleAssignment.createMany({
      data: [
        { userId: filerId, roleId: memberRole.id, status: "ACTIVE" },
        { userId: presidentId, roleId: presidentRole.id, status: "ACTIVE" },
      ],
    })
    await db.institutionMembership.create({
      data: { userId: directorId, institutionId, role: "OSE_DIRECTOR" },
    })
    await db.budgetLine.create({
      data: {
        id: `line-${RUN}`,
        organizationId,
        academicYear: "2026-2027",
        category: "Catering",
        budgetedCents: 100_000,
        actualCents: 0,
        currency: "USD",
      },
    })
  })
})

describe("a claim whose amount changed between the gates", () => {
  const approvalId = `ap-tampered-${RUN}`

  it("is refused at the final gate, and posts nothing to the ledger", async () => {
    await seedApproval(approvalId)

    // 1. The president approves the claim as filed: $50.00.
    await act(presidentId, approvalId, "approve")
    const afterPresident = await runUnscoped("migration", "read", () =>
      db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }),
    )
    expect(afterPresident.status).toBe("PENDING_OSE")

    // The producer recorded what it consented to. Without this the rest of the
    // test would pass for the wrong reason — there would be nothing to compare.
    const presidentStep = await runUnscoped("migration", "read step", () =>
      db.approvalStep.findFirstOrThrow({
        where: { approvalId, toStatus: "PENDING_OSE" },
        orderBy: { occurredAt: "desc" },
      }),
    )
    expect(recordedPayloadDigest(presidentStep.policySnapshot)).toMatch(
      /^[0-9a-f]{64}$/,
    )

    // 2. The claim is re-tagged to $5,000.00 — a hundredfold — after that
    //    consent and before the money moves.
    await retagAmount(approvalId, 500_000)

    // 3. The staff office gives what looks like the final approval.
    await expect(act(directorId, approvalId, "approve")).rejects.toThrow(
      /changed after an earlier gate approved it/i,
    )

    const [after, entries, line, steps] = await runUnscoped(
      "migration",
      "read outcome",
      async () =>
        Promise.all([
          db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }),
          db.ledgerEntry.findMany({ where: { approvalId } }),
          db.budgetLine.findUniqueOrThrow({ where: { id: `line-${RUN}` } }),
          db.approvalStep.findMany({
            where: { approvalId },
            orderBy: { occurredAt: "asc" },
          }),
        ]),
    )

    // The money did not move. This is the assertion the requirement is for.
    expect(entries).toEqual([])
    expect(line.actualCents).toBe(0)

    // The request went back for changes rather than being approved…
    expect(after.status).toBe("NEEDS_CHANGES")
    // …with a step that says why, naming both digests.
    const last = steps[steps.length - 1]
    expect(last.toStatus).toBe("NEEDS_CHANGES")
    expect(last.authority).toBe("approvals.digest.invalidated")
    expect(last.reason).toMatch(/no longer covers what is on it/i)
    const snapshot = last.policySnapshot as {
      payloadDigest?: string
      approvedDigest?: string
    }
    expect(snapshot.approvedDigest).toBe(
      recordedPayloadDigest(presidentStep.policySnapshot),
    )
    expect(snapshot.payloadDigest).not.toBe(snapshot.approvedDigest)

    // And the decision was published as one event, in the same transaction.
    const published = await runUnscoped("migration", "read outbox", () =>
      db.outboxEvent.findMany({ where: { resourceId: approvalId } }),
    )
    expect(
      published.some(
        (e) =>
          (e.payload as { reason?: string }).reason ===
          "payload-digest-mismatch",
      ),
    ).toBe(true)
  })
})

describe("an untouched claim", () => {
  const approvalId = `ap-clean-${RUN}`

  it("passes both gates and posts exactly what was filed", async () => {
    // The control. A digest check that refused everything would satisfy the
    // case above and break reimbursements entirely.
    await seedApproval(approvalId)

    await act(presidentId, approvalId, "approve")
    await act(directorId, approvalId, "approve")

    const [after, entries, line] = await runUnscoped(
      "migration",
      "read outcome",
      async () =>
        Promise.all([
          db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }),
          db.ledgerEntry.findMany({ where: { approvalId } }),
          db.budgetLine.findUniqueOrThrow({ where: { id: `line-${RUN}` } }),
        ]),
    )

    expect(after.status).toBe("APPROVED")
    // The posting is a balanced journal, not one row (PAY-030 posting
    // templates), so this asserts the two facts that are about THIS control:
    // the leg that hits the club's budget line carries exactly what was filed,
    // and the line moved by exactly that.
    const budgetLeg = entries.filter((e) => e.budgetLineId === `line-${RUN}`)
    expect(budgetLeg).toHaveLength(1)
    expect(budgetLeg[0].amountCents).toBe(FILED_CENTS)
    expect(entries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0)
    expect(line.actualCents).toBe(FILED_CENTS)
  })
})
