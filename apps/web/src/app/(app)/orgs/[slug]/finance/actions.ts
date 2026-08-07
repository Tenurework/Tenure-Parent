"use server"

import { randomUUID } from "node:crypto"
import { modulesFor, tiersFor } from "@tenure/platform-config"
import { allocateReceipt, type ReceiptTarget } from "@tenure/finops"
import {
  MANUAL_RECOVERY_TEMPLATE,
  MANUAL_SPEND_TEMPLATE,
  PROGRAM_EXPENSE_ACCOUNT,
  buildJournal,
  postingFor,
} from "@tenure/payments"
import type { PermissionKey } from "@tenure/authorization"
import type { ReceiptSource } from "@prisma/client"
import { decideFromSeats } from "@/lib/authz/seat-world"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { recordAuditEvent, txAuditLedger } from "@/lib/audit-record"
import { decideFinanceAction, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { configSnapshotForInstitution } from "@/lib/config/server"
import {
  approvalAuthorityFor,
  approvalDigest,
  exceedsApprovalThreshold,
  isDuplicateSubmission,
  nextStatus,
  reimbursementSubmissionKey,
  utcDay,
} from "@/lib/approvals"
import { fileRef, uploadDocument, storageConfigured } from "@/lib/s3"
import { notifyUsers, orgPresidentIds, oseMemberIds } from "@/lib/notify"
import {
  parseMoneyToCents,
  ledgerSignedCents,
  formatCents,
  LEDGER_KINDS,
  type LedgerKindName,
  type ParsedBudgetRow,
} from "@/lib/finance"

const CURRENT_YEAR = "2026-2027"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/**
 * The audit label for a finance write. A closed union, not free text: it is the
 * word the trail is read back in, and "Finance.PostLedgr" would be a row nobody
 * ever finds again.
 */
type FinanceAuditAction =
  | "Finance.EditLine"
  | "Finance.DeleteLine"
  | "Finance.SaveForecast"
  | "Finance.Import"
  | "Finance.PostLedger"
  | "Finance.ReverseLedger"

/**
 * PAY-150-001 — the capability this write needs, decided by the engine.
 *
 * `permission` is a `PermissionKey` from the catalog rather than the free-text
 * `action: string` this used to take, and it is what decides. Six finance
 * actions of wildly different risk — editing a line, replacing the whole budget
 * from a spreadsheet, posting to the ledger, correcting a posted transaction —
 * shared one answer: `canManageFinance(ctx, org)`, a role-SHAPE predicate that
 * never reached the catalog. The twelve finance capabilities the catalog
 * declares were consumed by navigation and by nothing else.
 *
 * `action` is still passed, and is deliberately NOT the permission key: the
 * audit trail has to say which of the four `finance.budget.update` actions was
 * taken, and collapsing them into one label would lose that. The write below is
 * unchanged; it already recorded the DENY, which is the half that matters.
 *
 * Reads the club and writes the audit row, so it runs inside the caller's
 * tenant scope; the caller has already resolved the session.
 */
async function requireFinanceManager(
  userId: string,
  slug: string,
  permission: PermissionKey,
  action: FinanceAuditAction,
) {
  const org = await db.organization.findUnique({
    where: { slug },
    // The slug, because module enablement and tier are properties of the
    // institution's system, and `decideFinanceAction` resolves both from it.
    include: { institution: { select: { slug: true } } },
  })
  if (!org) throw new Error("Organization not found")

  const ctx = await getUserContext(userId)
  const decision = decideFinanceAction(ctx, org, org.institution.slug, permission)

  await db.auditEvent.create({
    data: {
      institutionId: org.institutionId,
      organizationId: org.id,
      actorId: userId,
      action,
      resourceType: "BudgetLine",
      outcome: decision.allowed ? "ALLOW" : "DENY",
      // The reason was missing entirely: every DENY read the same, so the trail
      // could not distinguish "no such capability" from "the module is off"
      // from "this club is archived".
      reason: decision.allowed ? null : `${decision.reason}: ${decision.detail}`,
    },
  })

  // The catalog's own sentence, so the refusal names the capability that is
  // missing instead of answering six different questions with one line.
  if (!decision.allowed) throw new Error(decision.detail)
  return org
}

/** Create or update a single budget line (category, budgeted, actual). */
export async function upsertBudgetLine(slug: string, formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.budget.update", "Finance.EditLine")

    const category = String(formData.get("category") ?? "").trim()
    if (!category) throw new Error("Category is required")

    const budgetedCents = parseMoneyToCents(formData.get("budgeted")) ?? 0
    const actualCents = parseMoneyToCents(formData.get("actual")) ?? 0
    const note = String(formData.get("note") ?? "").trim() || null

    const existingCount = await db.budgetLine.count({
      where: { organizationId: org.id, academicYear: CURRENT_YEAR },
    })

    await db.budgetLine.upsert({
      where: {
        organizationId_academicYear_category: {
          organizationId: org.id,
          academicYear: CURRENT_YEAR,
          category,
        },
      },
      update: { budgetedCents, actualCents, note },
      create: {
        organizationId: org.id,
        academicYear: CURRENT_YEAR,
        category,
        budgetedCents,
        actualCents,
        note,
        sortOrder: existingCount,
        source: "manual",
      },
    })
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

export async function deleteBudgetLine(slug: string, formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.budget.update", "Finance.DeleteLine")
    const id = String(formData.get("id") ?? "")
    // Scope the delete to this org so an id from another club can't be removed.
    await db.budgetLine.deleteMany({ where: { id, organizationId: org.id } })
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

/**
 * Save a forecast projection across lines. Values arrive as
 * forecast-<lineId> = dollar string; an empty value clears the forecast.
 */
export async function saveForecast(slug: string, formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.budget.update", "Finance.SaveForecast")

    const lines = await db.budgetLine.findMany({
      where: { organizationId: org.id, academicYear: CURRENT_YEAR },
      select: { id: true },
    })

    await db.$transaction(
      lines.map((line) => {
        const raw = formData.get(`forecast-${line.id}`)
        const cents = raw == null || String(raw).trim() === "" ? null : parseMoneyToCents(raw)
        return db.budgetLine.update({
          where: { id: line.id },
          data: { forecastCents: cents },
        })
      })
    )
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

/**
 * Replace the club's budget with rows parsed from an uploaded spreadsheet.
 * The client parses the file (the xlsx dependency already ships) and posts
 * clean rows here; the server re-validates money and owns the write.
 */
export async function importBudget(
  slug: string,
  rows: ParsedBudgetRow[],
  mode: "replace" | "merge"
) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.budget.update", "Finance.Import")

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("No rows to import")
    }
    if (rows.length > 500) {
      throw new Error("That file has too many rows to import at once (max 500)")
    }

    await db.$transaction(async (tx) => {
      if (mode === "replace") {
        // Only clear imported lines; never destroy manually-entered ones.
        await tx.budgetLine.deleteMany({
          where: { organizationId: org.id, academicYear: CURRENT_YEAR, source: "import" },
        })
      }

      let sortOrder = await tx.budgetLine.count({
        where: { organizationId: org.id, academicYear: CURRENT_YEAR },
      })

      for (const row of rows) {
        const category = String(row.category ?? "").trim()
        if (!category) continue
        // Re-validate on the server: never trust client-computed cents.
        const budgetedCents = Math.round(Number(row.budgetedCents) || 0)
        const actualCents = Math.round(Number(row.actualCents) || 0)

        await tx.budgetLine.upsert({
          where: {
            organizationId_academicYear_category: {
              organizationId: org.id,
              academicYear: CURRENT_YEAR,
              category,
            },
          },
          update: { budgetedCents, actualCents, source: "import" },
          create: {
            organizationId: org.id,
            academicYear: CURRENT_YEAR,
            category,
            budgetedCents,
            actualCents,
            source: "import",
            sortOrder: sortOrder++,
          },
        })
      }
    })
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

/** Confirm an id belongs to this org before it's attached as a ledger source. */
async function orgScopedId(
  finder: (id: string) => Promise<{ id: string } | null>,
  raw: FormDataEntryValue | null
): Promise<string | null> {
  const id = String(raw ?? "").trim()
  if (!id) return null
  return (await finder(id))?.id ?? null
}

/**
 * Post a ledger entry against a budget line, then recompute that line's actual
 * from the ledger — so "spent" is always the sum of posted transactions, never
 * a hand-typed number that can drift. Source links (approval / vendor / receipt)
 * are validated to belong to this org so a foreign id can't be attached.
 */
export async function postLedgerEntry(slug: string, formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.ledger.post", "Finance.PostLedger")

    const budgetLineId = String(formData.get("budgetLineId") ?? "")
    const line = await db.budgetLine.findFirst({
      where: { id: budgetLineId, organizationId: org.id, academicYear: CURRENT_YEAR },
      // PAY-030-007. The line's currency is read because the amount is parsed
      // in it. Without it `parseMoneyToCents` fell back to USD's two minor
      // digits, so "1200" typed on a JPY line was stored as ¥12 — a
      // hundredfold error, on the write path, silently.
      select: { id: true, currency: true },
    })
    if (!line) throw new Error("Budget line not found")

    const kindRaw = String(formData.get("kind") ?? "SPEND")
    const kind: LedgerKindName = (LEDGER_KINDS as string[]).includes(kindRaw)
      ? (kindRaw as LedgerKindName)
      : "SPEND"

    const magnitude = parseMoneyToCents(formData.get("amount"), {
      locale: "en-US",
      currency: line.currency,
    })
    if (magnitude == null || magnitude === 0) throw new Error("Enter an amount")
    const amountCents = ledgerSignedCents(kind, magnitude)

    const description = String(formData.get("description") ?? "").trim()
    if (!description) throw new Error("Enter a description")
    const memo = String(formData.get("memo") ?? "").trim() || null

    const occurredRaw = String(formData.get("occurredAt") ?? "").trim()
    const occurredAt =
      /^\d{4}-\d{2}-\d{2}$/.test(occurredRaw) && !isNaN(new Date(occurredRaw).getTime())
        ? new Date(`${occurredRaw}T12:00:00.000Z`)
        : new Date()

    const approvalId = await orgScopedId(
      (id) => db.approvalRequest.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
      formData.get("approvalId")
    )
    const vendorId = await orgScopedId(
      (id) => db.vendor.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
      formData.get("vendorId")
    )
    const documentId = await orgScopedId(
      (id) => db.document.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
      formData.get("documentId")
    )
    // PAY-080-004. Attribution the entry carries in its own right, so it
    // survives a hop through a provider settlement instead of being
    // reconstructed from a bank line afterwards.
    const eventId = await orgScopedId(
      (id) => db.event.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
      formData.get("eventId")
    )
    const seatId = await orgScopedId(
      (id) => db.seat.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
      formData.get("seatId")
    )
    const fundCode = String(formData.get("fundCode") ?? "").trim() || null

    // PAY-030-007. The durable owner seat, alongside the raw user id. `postedById`
    // stops meaning anything the moment that person graduates; the seat does not.
    const posterSeat = await db.seat.findFirst({
      where: {
        organizationId: org.id,
        role: { assignments: { some: { userId, status: "ACTIVE" } } },
      },
      select: { id: true },
    })

    // PAY-230-004. A RECEIPT is inbound money that belongs to several things at
    // once, so it is split across its targets by the largest-remainder rule
    // rather than by three independent roundings. The split runs BEFORE the
    // transaction so a bad allocation refuses the whole post rather than
    // leaving an unallocated receipt behind.
    const allocations =
      kind === "RECEIPT"
        ? allocateReceipt({
            minorUnits: Math.abs(amountCents),
            currency: line.currency,
            targets: receiptTargetsFrom(formData, {
              organizationId: org.id,
              fundCode,
              eventId,
            }),
          })
        : []
    const receiptSource = receiptSourceFrom(formData)

    // PAY-130-002. The hand-posted entry is a JOURNAL too, not a single row.
    //
    // The template is chosen by direction, not by kind: a positive
    // `amountCents` is a debit to the expense account whatever kind produced it
    // (SPEND, an upward ADJUSTMENT), and a negative one is a credit to the same
    // account (REIMBURSEMENT, RECEIPT, a downward ADJUSTMENT). `buildJournal`
    // refuses an unbalanced result and takes non-negative magnitudes, so the
    // sign lives in the template's sides and never in the amount.
    const journal = buildJournal(
      postingFor(
        amountCents < 0 ? MANUAL_RECOVERY_TEMPLATE : MANUAL_SPEND_TEMPLATE,
        occurredAt.toISOString(),
      ),
      { gross: Math.abs(amountCents) },
      { journalId: randomUUID(), effectiveAt: occurredAt.toISOString() },
    )
    const budgetSide = journal.entries.find((e) => e.budgetDimensioned)
    const counterSides = journal.entries.filter((e) => !e.budgetDimensioned)

    await db.$transaction(async (tx) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          budgetLineId: line.id,
          academicYear: CURRENT_YEAR,
          kind,
          amountCents,
          currency: line.currency,
          journalId: journal.journalId,
          templateId: journal.templateId,
          account: budgetSide?.account ?? PROGRAM_EXPENSE_ACCOUNT,
          side: (budgetSide?.side ?? "debit") === "debit" ? "DEBIT" : "CREDIT",
          effectiveAt: occurredAt,
          description,
          memo,
          occurredAt,
          approvalId,
          vendorId,
          documentId,
          eventId,
          seatId,
          fundCode,
          postedById: userId,
          postedBySeatId: posterSeat?.id ?? null,
        },
      })
      // The other side. No `budgetLineId`: a payable or a cash-clearing balance
      // is an organization-level position, and dimensioning it by budget line
      // would double the line's actual — which is exactly why the column is
      // nullable rather than a flag every aggregate would have to learn about.
      for (const counter of counterSides) {
        await tx.ledgerEntry.create({
          data: {
            institutionId: org.institutionId,
            organizationId: org.id,
            budgetLineId: null,
            academicYear: CURRENT_YEAR,
            kind,
            amountCents: counter.signedMinorUnits,
            currency: line.currency,
            journalId: journal.journalId,
            templateId: journal.templateId,
            account: counter.account,
            side: counter.side === "debit" ? "DEBIT" : "CREDIT",
            effectiveAt: occurredAt,
            description,
            memo,
            occurredAt,
            approvalId,
            vendorId,
            documentId,
            eventId,
            seatId,
            fundCode,
            postedById: userId,
            postedBySeatId: posterSeat?.id ?? null,
          },
        })
      }
      if (allocations.length > 0) {
        await tx.receiptAllocation.createMany({
          data: allocations.map((slice) => ({
            institutionId: org.institutionId,
            ledgerEntryId: entry.id,
            source: receiptSource,
            organizationId: slice.organizationId,
            fundCode: slice.fundCode ?? null,
            eventId: slice.eventId ?? null,
            minorUnits: slice.minorUnits,
            currency: slice.currency,
          })),
        })
      }
      const agg = await tx.ledgerEntry.aggregate({
        where: { budgetLineId: line.id },
        _sum: { amountCents: true },
      })
      await tx.budgetLine.update({
        where: { id: line.id },
        data: { actualCents: agg._sum.amountCents ?? 0 },
      })
    })
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

/**
 * Where a receipt is split to.
 *
 * `allocation` arrives as repeated `allocation` form fields shaped
 * `organizationId:fundCode:eventId:weight`, which is what the receipt form
 * posts. With none, the whole receipt lands on the posting club under whatever
 * fund and event the entry itself names — one target, weight 1, so the split
 * still goes through `allocateReceipt` and there is not a second code path that
 * writes an allocation a different way.
 */
function receiptTargetsFrom(
  formData: FormData,
  fallback: { organizationId: string; fundCode: string | null; eventId: string | null }
): ReceiptTarget[] {
  const raw = formData.getAll("allocation").map((v) => String(v).trim()).filter(Boolean)
  if (raw.length === 0) {
    return [
      {
        organizationId: fallback.organizationId,
        fundCode: fallback.fundCode,
        eventId: fallback.eventId,
        weight: 1,
      },
    ]
  }
  return raw.map((entry) => {
    const [organizationId, fundCode, eventId, weight] = entry.split(":")
    const parsed = Number(weight)
    if (!organizationId) throw new Error("Every receipt allocation needs a club")
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`"${weight}" is not a share this receipt can be split by`)
    }
    return {
      organizationId,
      fundCode: fundCode || null,
      eventId: eventId || null,
      weight: parsed,
    }
  })
}

const RECEIPT_SOURCES: ReceiptSource[] = ["DUES", "EVENT", "SPONSORSHIP"]

function receiptSourceFrom(formData: FormData): ReceiptSource {
  const raw = String(formData.get("receiptSource") ?? "").trim().toUpperCase()
  return (RECEIPT_SOURCES as string[]).includes(raw) ? (raw as ReceiptSource) : "DUES"
}

/**
 * PAY-120-001 — correct a posted entry by REVERSING it, never by deleting it.
 *
 * What this replaces was `tx.ledgerEntry.delete({ where: { id: entry.id } })`.
 * A transaction the institution had recognised was erased: no opposite entry,
 * no reason, no record that money had ever been recognised, nothing for a bank
 * statement to reconcile against, and no way to answer "what changed" six
 * months later. The budget line's actual was then recomputed from whatever
 * survived, so the number looked right and the history did not exist.
 *
 * A reversal is an entry: same line, same currency, the exact negation of the
 * original's SIGNED amount (`ledgerSignedCents("REVERSAL", …)`), pointing at
 * what it answers through `reversesId` and carrying the reason in its own
 * column. Two rows survive and sum to zero. The `actualCents` recomputation is
 * unchanged and now needs no special case: the pair cancels in the same
 * aggregate everything else is summed by.
 *
 * Three refusals, in the order somebody would ask them:
 *
 *   - A reversal cannot be reversed. Correcting a correction is posting again,
 *     not unwinding twice.
 *   - A posting can be reversed once. `reversesId` is `@unique`, so a
 *     double-submitted correction is refused by PostgreSQL; this check is what
 *     turns that into a sentence rather than a constraint violation.
 *   - An entry posted under a still-APPROVED request is not reversed on its
 *     own. That approval is the authority the money moved on, and reversing
 *     underneath it leaves an approved claim with no posting — the mirror image
 *     of the hole this closes, where a request cancelled AFTER final approval
 *     left its SPEND standing forever. Cancel or reject the request, then
 *     reverse.
 */
export async function reverseLedgerEntry(slug: string, formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const org = await requireFinanceManager(userId, slug, "finance.ledger.reverse", "Finance.ReverseLedger")
    const id = String(formData.get("id") ?? "")
    const entry = await db.ledgerEntry.findFirst({
      where: { id, organizationId: org.id },
      select: {
        id: true,
        budgetLineId: true,
        academicYear: true,
        kind: true,
        amountCents: true,
        currency: true,
        description: true,
        approvalId: true,
        vendorId: true,
        documentId: true,
        eventId: true,
        seatId: true,
        fundCode: true,
        // PAY-130-002. The journal coordinates, so the reversal hits the same
        // account on the opposite side rather than guessing one.
        templateId: true,
        account: true,
        side: true,
        reversesId: true,
        reversedBy: { select: { id: true } },
        approval: { select: { id: true, title: true, status: true } },
      },
    })
    if (!entry) throw new Error("That transaction is not on this club's ledger")

    const reason = String(formData.get("reason") ?? "").trim()
    if (!reason) throw new Error("Say why this transaction is being reversed")
    if (reason.length > 500) throw new Error("Keep the reason under 500 characters")

    if (entry.kind === "REVERSAL") {
      throw new Error(
        "That entry is itself a reversal. Correcting a correction is a new posting, not a second reversal.",
      )
    }
    if (entry.reversedBy) {
      throw new Error("That transaction has already been reversed.")
    }
    if (entry.approval && entry.approval.status === "APPROVED") {
      throw new Error(
        `“${entry.approval.title}” is still approved, and this posting is what that approval ` +
          `authorised. Cancel or reject the request first, then reverse its posting.`,
      )
    }

    const posterSeat = await db.seat.findFirst({
      where: {
        organizationId: org.id,
        role: { assignments: { some: { userId, status: "ACTIVE" } } },
      },
      select: { id: true },
    })

    await db.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          budgetLineId: entry.budgetLineId,
          academicYear: entry.academicYear,
          kind: "REVERSAL",
          // The exact negation of what was posted, whatever kind it was. A
          // magnitude would get the sign wrong for every inbound kind.
          amountCents: ledgerSignedCents("REVERSAL", entry.amountCents),
          currency: entry.currency,
          // PAY-130-002. The reversal answers ONE posted row, so it is its own
          // journal hitting the same account on the opposite side. Reversing a
          // whole journal in one action is a different operation from the one
          // this function performs, and pretending otherwise by reusing the
          // original `journalId` would make the original journal stop summing
          // to zero.
          journalId: randomUUID(),
          templateId: entry.templateId,
          account: entry.account,
          side: entry.side === "DEBIT" ? "CREDIT" : "DEBIT",
          effectiveAt: new Date(),
          description: `Reversal — ${entry.description}`.slice(0, 140),
          memo: reason,
          occurredAt: new Date(),
          // The same source links the original carried. A reversal that pointed
          // at nothing would be an unattributed movement on the line, which is
          // the thing the original was posted with links to avoid.
          approvalId: entry.approvalId,
          vendorId: entry.vendorId,
          documentId: entry.documentId,
          eventId: entry.eventId,
          seatId: entry.seatId,
          fundCode: entry.fundCode,
          postedById: userId,
          postedBySeatId: posterSeat?.id ?? null,
          reversesId: entry.id,
          reversalReason: reason,
        },
      })
      // PAY-130-002. Only the budget-dimensioned half of a journal moves a
      // line's actual, and only that half has a `budgetLineId`. Reversing the
      // counter-half — an organization-level payable — correctly changes no
      // line, so there is nothing to recompute and no line to name.
      if (entry.budgetLineId !== null) {
        const budgetLineId = entry.budgetLineId
        const agg = await tx.ledgerEntry.aggregate({
          where: { budgetLineId },
          _sum: { amountCents: true },
        })
        await tx.budgetLine.update({
          where: { id: budgetLineId },
          data: { actualCents: agg._sum.amountCents ?? 0 },
        })
      }
      // Through the builder, on this transaction's own ledger. A reversal is
      // the one finance event whose trail matters most, and a hand-built row
      // gets neither the hash chain nor metadata redaction — it lands unchained,
      // which is exactly the state `verifyChain` reports as tampered-with.
      await recordAuditEvent(
        {
          institutionId: org.institutionId,
          organizationId: org.id,
          actor: { principalId: userId },
          action: "Finance.LedgerReversed",
          resourceType: "LedgerEntry",
          resourceId: entry.id,
          outcome: "ALLOW",
          reason,
          metadata: { reversedAmountCents: entry.amountCents, kind: entry.kind },
        },
        txAuditLedger(tx),
      )
    })
  })

  revalidatePath(`/orgs/${slug}/finance`)
}

/**
 * A member files a reimbursement: pick a budget line, an amount, and (in prod) a
 * receipt. It rides the normal approval chain as an EXCEPTION request carrying a
 * `reimbursement` metadata payload; on final APPROVAL the approval engine
 * auto-posts a SPEND ledger entry linked to this request + receipt (three-way
 * match). The submitter needs only canContribute — they are NOT a finance
 * manager (that is the point: members request, approvers post).
 */
export async function submitReimbursement(slug: string, formData: FormData) {
  const userId = await requireUserId()
  // The approval id comes out of the scope; the cache bump and the navigation
  // both happen after it has closed. This body opens a `db.$transaction` that
  // writes the ApprovalRequest, its first ApprovalStep and the receipt Document
  // — a `redirect()` reached from inside it aborts all three, and the browser
  // still follows a 307 to an approval that was rolled back. The idempotent
  // early exit below returns the same shape rather than redirecting in place,
  // for the same reason.
  const approvalId = await withTenantScope(userId, async () => {
    const org = await db.organization.findUnique({
      where: { slug },
      include: { institution: { select: { slug: true } } },
    })
    if (!org) throw new Error("Organization not found")

    // GE-051-005. A permission decision, not a row count.
    //
    // Still a seat in THIS club and not OSE — a requester then never sits on
    // their own approval gate, which is what closes the self-approval path. What
    // changed is that "may I file" is now answered by the authorization engine
    // from the bundle the seat carries, so the club that gives somebody a
    // read-only advisory seat gets a refusal instead of a claim.
    //
    // The refusal also says which one it is. The old check answered every case
    // with "you need an active role in this club", including the SHADOW holder
    // whose term has not begun and the system that does not run reimbursements
    // at all.
    const ctx = await getUserContext(userId)
    const decision = decideFromSeats(ctx, {
      permission: "finance.reimbursement.create",
      organizationId: org.id,
      tenantId: org.institutionId,
      enabledModules: modulesFor(org.institution.slug).keys,
      // What each enabled module sells and what this tenant bought. Without it
      // the engine's tier gate cannot fire at all — `tierRank` returns null for
      // a world with no entitlements, so every `minTier` on every role is
      // skipped (REVIEW-FINDINGS P0 #5).
      tiers: tiersFor(org.institution.slug),
    })
    if (!decision.allowed) throw new Error(decision.detail)

    const budgetLineId = String(formData.get("budgetLineId") ?? "")
    const line = await db.budgetLine.findFirst({
      where: { id: budgetLineId, organizationId: org.id, academicYear: CURRENT_YEAR },
      // PAY-080-004. The line's currency, for the same reason `postLedgerEntry`
      // reads it: the amount is parsed in it, and falling back to USD's two
      // minor digits stores "1200" on a JPY line as ¥12.
      select: { id: true, category: true, currency: true },
    })
    if (!line) throw new Error("Pick a budget line")

    const amountCents = parseMoneyToCents(formData.get("amount"), {
      locale: "en-US",
      currency: line.currency,
    })
    if (amountCents == null || amountCents <= 0) throw new Error("Enter a positive amount")

    const description = String(formData.get("description") ?? "").trim()
    if (!description) throw new Error("Describe what this reimburses")

    // PAY-060-007 — the business identity of this claim, computed BEFORE the
    // receipt is uploaded.
    //
    // Order is the point. A double-submitted form posts the file twice; running
    // the upload first would create a second S3 object and a second Document
    // row before anything noticed the claim was a repeat, and then de-duplicate
    // a claim whose receipt had already been duplicated. Deriving the key here
    // means the replay is answered without touching storage at all.
    //
    // This read is an optimisation, not the control. Two requests can both find
    // nothing; the unique index below is what actually decides.
    const submissionKey = reimbursementSubmissionKey({
      organizationId: org.id,
      submittedById: userId,
      budgetLineId: line.id,
      amountCents,
      description,
      submittedOn: utcDay(new Date()),
    })
    const alreadyFiled = await db.approvalRequest.findFirst({
      where: { institutionId: org.institutionId, idempotencyKey: submissionKey },
      select: { id: true },
    })
    if (alreadyFiled) return alreadyFiled.id

    // Receipt is required once storage is configured (production); optional when
    // it is not (local / CI have no S3) so the flow stays end-to-end testable.
    let documentId: string | null = null
    const file = formData.get("receipt")
    const hasFile = file instanceof File && file.size > 0
    if (storageConfigured() && !hasFile) throw new Error("Attach a receipt")
    if (hasFile && storageConfigured()) {
      const f = file as File
      if (f.size > 15 * 1024 * 1024) throw new Error("Receipt is larger than the 15 MB limit")
      const safeName = f.name.replace(/[^\w.\-]+/g, "_")
      const objectKey = `${org.institutionId}/${org.id}/${Date.now()}-${safeName}`
      const bytes = Buffer.from(await f.arrayBuffer())
      await uploadDocument(
        fileRef({
          tenantId: org.institutionId,
          objectKey,
          mimeType: f.type || "application/octet-stream",
          body: bytes,
        }),
        bytes,
      )
      const doc = await db.document.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          title: `Receipt — ${description}`.slice(0, 200),
          objectKey,
          mimeType: f.type || "application/octet-stream",
          sizeBytes: f.size,
          createdById: userId,
        },
      })
      documentId = doc.id
    }

    // The seat is read again here for two facts the decision above does not
    // carry: whether this requester is the club's president (which changes the
    // approval chain) and what to record as their role on the immutable trail.
    // Authorization is the engine's answer; these are attributes of the seat.
    const seat = await db.roleAssignment.findFirst({
      where: { userId, status: "ACTIVE", role: { organizationId: org.id } },
      include: { role: true },
    })
    const isPresident =
      seat?.role.scope === "PRESIDENT" ||
      (await db.roleAssignment.findFirst({
        where: { userId, status: "ACTIVE", role: { organizationId: org.id, scope: "PRESIDENT" } },
        select: { id: true },
      })) != null
    // PAY-150-002. Which gate this claim needs is priced, not fixed: a claim
    // over the institution's ceiling for this currency goes to the Director's
    // gate. Read from the same ladder `actOnApproval` reads, so the route the
    // request is put on at submission is the route it is decided on.
    const exceedsThreshold = exceedsApprovalThreshold(
      { amountMinorUnits: amountCents, currency: line.currency },
      approvalAuthorityFor(org.institution.slug),
    )
    const target =
      nextStatus("submit", "DRAFT", { requesterIsPresident: isPresident, exceedsThreshold }) ??
      "PENDING_PRESIDENT"
    const title = `Reimbursement: ${description}`.slice(0, 200)
    const configSnapshot = await configSnapshotForInstitution(org.institutionId)

    // PAY-150-002 / PAY-150-004. Built ONCE and used both as the stored blob
    // and as the digest input. Two constructions of "the same" object is how a
    // digest recorded at submission stops matching the digest recomputed from
    // the row at the gate — every claim would then be refused, by a control
    // that was supposed to be invisible until something really changed.
    //
    // `currency` is at the top level, beside the amount it denominates, because
    // `approvalMoney` — the one parser every producer of an ApprovalView goes
    // through — reads it from there. Without it the gate would price the claim
    // in the institution's default currency instead of the line's.
    const reimbursementMetadata = {
      currency: line.currency,
      reimbursement: {
        budgetLineId: line.id,
        amountCents,
        documentId,
        category: line.category,
        academicYear: CURRENT_YEAR,
      },
    }

    let replayed = false
    const approval = await db.$transaction(async (tx) => {
      const a = await tx.approvalRequest.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          type: "EXCEPTION",
          title,
          description: `Reimbursement against "${line.category}" for ${formatCents(amountCents)}.`,
          submittedById: userId,
          status: target,
          // PAY-060-007. The column existed and nothing wrote to it, so the
          // `@@unique([institutionId, idempotencyKey])` index it is covered by
          // was decorative: every row's key was NULL, and PostgreSQL treats
          // NULLs as distinct. Writing the business key is what makes the
          // constraint load-bearing.
          idempotencyKey: submissionKey,
          metadata: reimbursementMetadata,
        },
      })
      await tx.approvalStep.create({
        data: {
          approvalId: a.id,
          fromStatus: "DRAFT",
          toStatus: target,
          actorId: userId,
          actorRoleContext: seat?.role.name ?? "Requester",
          policySnapshot: {
            requesterIsPresident: isPresident,
            reimbursement: true,
            // PAY-150-004 / PAY-070-005. The baseline every later gate compares
            // against, recorded on the SUBMISSION step and not only on the
            // approving ones — so a mutation between filing and the FIRST gate
            // is caught as well as one between the two gates.
            //
            // One digest, not two. `recordedPayloadDigest` reads this key and
            // `actOnApproval` refuses on it; a second, narrower "allocation"
            // digest stored beside it would be a value nothing compares, and a
            // digest nothing compares refuses nothing.
            payloadDigest: approvalDigest(reimbursementMetadata, {
              organizationId: org.id,
              type: "EXCEPTION",
              amountMinorUnits: amountCents,
              currency: line.currency,
            }),
          },
          // PAY-030-005. Which configuration this reimbursement was raised
          // against, and the receipt backing it.
          configRevision: configSnapshot.revision,
          configChecksum: configSnapshot.checksum,
          authority: "finance.reimbursement.create",
          evidenceDocumentId: documentId,
        },
      })
      await tx.auditEvent.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          actorId: userId,
          actorRole: seat?.role.name ?? null,
          action: "Reimbursement.Submitted",
          resourceType: "ApprovalRequest",
          resourceId: a.id,
          outcome: "ALLOW",
          metadata: { amountCents, budgetLineId: line.id },
        },
      })
      return a
    }).catch(async (error) => {
      // PAY-060-007. The race the pre-check above cannot win: two submissions
      // of one claim reach the create, and PostgreSQL refuses the second on
      // `@@unique([institutionId, idempotencyKey])`. P2002 here is not a
      // failure — it is the duplicate being caught, and the honest answer is
      // the claim that already exists rather than an error page in front of a
      // member who clicked twice.
      if (!isDuplicateSubmission(error)) throw error
      const existing = await db.approvalRequest.findFirst({
        where: { institutionId: org.institutionId, idempotencyKey: submissionKey },
      })
      if (!existing) throw error
      replayed = true
      return existing
    })

    // A replay raised nothing, so it alerts nobody. Notifying again would tell
    // the president a second claim needs deciding when there is one.
    if (!replayed) {
      const gateUsers =
        target === "PENDING_PRESIDENT"
          ? await orgPresidentIds(org.id)
          : await oseMemberIds(org.institutionId)
      await notifyUsers(gateUsers, {
        title: `Reimbursement request: ${description}`,
        body: `${formatCents(amountCents)} against ${line.category} needs your approval.`,
        href: `/approvals/${approval.id}`,
        excludeUserId: userId,
      })
    }

    return approval.id
  })

  revalidatePath(`/orgs/${slug}/finance`)
  redirect(`/approvals/${approvalId}`)
}
