"use server";

import { randomUUID } from "node:crypto";
import { mayBorrowAuthority } from "@/lib/authz/borrowed-authority";
import { outboxEventRow } from "@/lib/outbox/outbox";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ApprovalType, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserContext } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-record";
import { withTenantScope } from "@/lib/tenant-scope";
import { configSnapshotForInstitution, institutionSlugFor } from "@/lib/config/server";
import { effectiveApprovalContext } from "@/lib/delegation";
import { standingDeclarationsFor } from "@/lib/approvals-world";
import {
  REIMBURSEMENT_TEMPLATE,
  buildJournal,
  classifyMovementCommand,
  classifyRequest,
  postingFor,
} from "@tenure/payments";
import { fxEvidenceRecord } from "@tenure/finops";
import { gateMoneyMovement } from "@/lib/payments/movement-gate";
import { localizationFor } from "@tenure/platform-config";
import {
  approvalAuthorityFor,
  approvalDigest,
  approvalMoney,
  approvalSubmissionKey,
  availableActions,
  exceedsApprovalThreshold,
  isConcurrentDecision,
  isDuplicateSubmission,
  isGateStep,
  nextStatus,
  recordedPayloadDigest,
  toMinorUnits,
  utcDay,
  APPROVAL_DIGEST_MISMATCH_REASON,
  type ApprovalActionName,
} from "@/lib/approvals";
import {
  notifyUsers,
  orgCurrentMemberIds,
  orgPresidentIds,
  oseMemberIds,
} from "@/lib/notify";

/** Alert whoever owns the next gate of this request. */
async function notifyGate(
  approval: {
    id: string;
    title: string;
    organizationId: string;
    institutionId: string;
  },
  target: "PENDING_PRESIDENT" | "PENDING_OSE",
  actorId: string,
) {
  const gateUsers =
    target === "PENDING_PRESIDENT"
      ? await orgPresidentIds(approval.organizationId)
      : await oseMemberIds(approval.institutionId);
  await notifyUsers(gateUsers, {
    title: `${approval.title} needs your approval`,
    body:
      target === "PENDING_PRESIDENT"
        ? "It's now with you for a club-level decision."
        : "It's now with the OSE team for a final decision.",
    href: `/approvals/${approval.id}`,
    excludeUserId: actorId,
  });
}

const APPROVAL_TYPES: ApprovalType[] = [
  "EVENT",
  "BUDGET",
  "VENDOR",
  "COMMUNICATION",
  "DOCUMENT",
  "EXCEPTION",
  "ROSTER",
];

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

/**
 * PAY-150-003 — who prepared this request, if it was not the submitter.
 *
 * Returns null for "nobody else", which is the common case and the one the
 * SELF_APPROVAL arm already covers. Naming yourself is also null: a submitter
 * who prepared their own request is already refused the gate for having raised
 * it, and recording it twice would make the SAME_MAKER refusal the one the user
 * sees, which is the less informative of the two.
 *
 * A preparer who holds no active seat in the club is refused rather than
 * recorded. Otherwise a submitter could name any user id and permanently deny
 * that person the gate on a request they never saw — a denial-of-authority
 * written by the person the control exists to constrain.
 */
async function resolvePreparer(
  raw: string,
  { userId, organizationId }: { userId: string; organizationId: string },
): Promise<string | null> {
  if (!raw || raw === userId) return null;
  const seat = await db.roleAssignment.findFirst({
    where: { userId: raw, status: "ACTIVE", role: { organizationId } },
    select: { id: true },
  });
  if (!seat) {
    throw new Error("The person you named as preparer has no active role in this club");
  }
  return raw;
}

/** Is this user the club's ACTIVE president? (Determines gate routing.) */
async function isActivePresident(userId: string, organizationId: string) {
  const seat = await db.roleAssignment.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      role: { organizationId, scope: "PRESIDENT" },
    },
  });
  return !!seat;
}

export async function createApproval(formData: FormData) {
  const userId = await requireUser();
  // WRK-P1-16. The approval id comes out of the scope; the navigation happens
  // after it closes. `redirect()` is a throw, and this body opens a
  // `db.$transaction` writing the ApprovalRequest, its first ApprovalStep and an
  // OutboxEvent — reached from inside, it aborts all three while the browser
  // follows a 307 to a request that was rolled back. `runInTenantScope` now
  // refuses an escaping redirect outright, so this is required for the flow to
  // work at all. The `revalidatePath` calls still inside this file belong to the
  // run that owns the approvals directory; they do not throw, so they work.
  const approvalId = await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "");
    const type = String(formData.get("type") ?? "") as ApprovalType;
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const amount = String(formData.get("amount") ?? "").trim();
    const asDraft = formData.get("intent") === "draft";

    if (!title) throw new Error("Title is required");
    if (!APPROVAL_TYPES.includes(type)) throw new Error("Invalid request type");

    // Must hold an ACTIVE seat in the org to submit requests from it
    const membership = await db.roleAssignment.findFirst({
      where: { userId, status: "ACTIVE", role: { organizationId } },
      include: { role: { include: { organization: true } } },
    });
    if (!membership) throw new Error("You need an active role in this club");

    const org = membership.role.organization;
    const requesterIsPresident =
      membership.role.scope === "PRESIDENT" ||
      (await isActivePresident(userId, organizationId));

    // PAY-150-002. The amount stops being free text at the moment it is
    // written. `amount` arrives from the form as whatever the requester typed;
    // it is normalised to integer minor units of the institution's own currency
    // and stored ALONGSIDE the currency, so every later reader — the authority
    // check, the digest, the detail page — reads one number with one meaning
    // instead of re-parsing a string and guessing at the currency.
    const slug = await institutionSlugFor(org.institutionId);
    const currency = localizationFor(slug).currency.toUpperCase();
    const authority = approvalAuthorityFor(slug);
    const amountMinorUnits = amount ? toMinorUnits(amount, currency) : null;
    if (amount && amountMinorUnits === null) {
      throw new Error("That amount is not a number");
    }
    const metadata = amount
      ? { amount, amountMinorUnits, currency }
      : { currency };
    const money = approvalMoney(metadata, currency);

    const target = asDraft
      ? null
      : nextStatus("submit", "DRAFT", {
          requesterIsPresident,
          exceedsThreshold: exceedsApprovalThreshold(money, authority),
        });

    // PAY-150-003. Who PREPARED this, when that is not the person submitting
    // it. Only accepted for someone who actually holds a seat in this club —
    // an arbitrary id here would let a submitter name anybody and hand them a
    // SAME_MAKER refusal on a request they never touched.
    const preparedById = await resolvePreparer(
      String(formData.get("preparedById") ?? "").trim(),
      { userId, organizationId },
    );

    // PAY-030-005. The configuration in force at the moment this is raised.
    const configSnapshot = await configSnapshotForInstitution(org.institutionId);

    // PAY-060-007 — the business identity of this request.
    //
    // This path created unconditionally, so a double-submitted form raised two
    // requests for one thing: two rows in the approval queue, two decisions to
    // make, and — for the money-bearing types — two chances to authorise the
    // same spend. The key is derived from what the request IS rather than from
    // anything the client supplies, so a retry with the same content lands on
    // the same row and a genuinely different request cannot collide with it.
    //
    // `intent` distinguishes a draft from a submission of the same content: a
    // draft is not the request, and collapsing them would make "save draft"
    // then "submit" hand back the draft.
    const submissionKey = approvalSubmissionKey({
      organizationId,
      submittedById: userId,
      type,
      title,
      description,
      amount,
      intent: asDraft ? "draft" : "submit",
      submittedOn: utcDay(new Date()),
    });
    // An optimisation, not the control — two requests can both find nothing
    // here. The unique index below is what actually decides.
    const alreadyRaised = await db.approvalRequest.findFirst({
      where: { institutionId: org.institutionId, idempotencyKey: submissionKey },
      select: { id: true },
    });
    if (alreadyRaised) return alreadyRaised.id;

    let replayed = false;
    const approval = await db.$transaction(async (tx) => {
      const a = await tx.approvalRequest.create({
        data: {
          institutionId: org.institutionId,
          organizationId,
          type,
          title,
          description: description || null,
          submittedById: userId,
          preparedById,
          status: target ?? "DRAFT",
          // PAY-060-007. The column existed and nothing wrote to it, so the
          // `@@unique([institutionId, idempotencyKey])` index covering it was
          // decorative: every row's key was NULL and PostgreSQL treats NULLs as
          // distinct. Writing the business key is what makes it load-bearing.
          idempotencyKey: submissionKey,
          metadata,
        },
      });
      if (target) {
        await tx.approvalStep.create({
          data: {
            approvalId: a.id,
            fromStatus: "DRAFT",
            toStatus: target,
            actorId: userId,
            actorRoleContext: membership.role.name,
            // PAY-150-004. What the request SAID when it entered the chain.
            // The next gate recomputes this and refuses if it has moved — see
            // `actOnApproval`. Without it the first gate consents to a payload
            // nothing ever recorded, and the second gate's consent is to
            // whatever the row says by then.
            policySnapshot: {
              requesterIsPresident,
              payloadDigest: approvalDigest(metadata, {
                organizationId,
                type,
                ...money,
              }),
            },
            configRevision: configSnapshot.revision,
            configChecksum: configSnapshot.checksum,
            authority: "approvals.requester",
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          institutionId: org.institutionId,
          organizationId,
          actorId: userId,
          actorRole: membership.role.name,
          action: target ? "Approval.Submitted" : "Approval.DraftCreated",
          resourceType: "ApprovalRequest",
          resourceId: a.id,
          outcome: "ALLOW",
        },
      });
      // A draft is not a request. It has been raised for nobody, can be edited
      // freely, and publishing an `ApprovalRequested` for one would tell every
      // downstream step to start work on something that has not been asked for
      // yet — which is the same defect as emitting before committing, one level
      // up.
      if (target) {
        await tx.outboxEvent.create({
          data: outboxEventRow({
            eventId: randomUUID(),
            tenantId: org.institutionId,
            type: "ApprovalRequested",
            schemaVersion: 1,
            resourceType: "ApprovalRequest",
            resourceId: a.id,
            occurredAt: new Date().toISOString(),
            correlationId: a.id,
            causationId: null,
            // PAY-020-006. This platform built every field below out of its own
            // columns; nothing here came from a provider. Stated rather than
            // defaulted, because the writer who does not think about it is
            // exactly the one forwarding somebody else's webhook body.
            origin: "tenure",
            payload: {
              type,
              organizationId,
              submittedById: userId,
              toStatus: target,
            },
          }) as Prisma.OutboxEventUncheckedCreateInput,
        });
      }
      return a;
    }).catch(async (error) => {
      // The race the pre-check above cannot win: two submissions of one request
      // reach the create and PostgreSQL refuses the second. P2002 here is the
      // duplicate being caught, not a failure, and the honest answer is the
      // request that already exists rather than an error page in front of
      // somebody who clicked twice.
      if (!isDuplicateSubmission(error)) throw error;
      const existing = await db.approvalRequest.findFirst({
        where: { institutionId: org.institutionId, idempotencyKey: submissionKey },
      });
      if (!existing) throw error;
      replayed = true;
      return existing;
    });

    // A replay raised nothing, so it alerts nobody: notifying again would tell
    // the gate a second request needs deciding when there is one.
    if (!replayed && (target === "PENDING_PRESIDENT" || target === "PENDING_OSE")) {
      await notifyGate(approval, target, userId);
    }

    return approval.id;
  });

  revalidatePath("/approvals");
  redirect(`/approvals/${approvalId}`);
}

export async function actOnApproval(approvalId: string, formData: FormData) {
  const userId = await requireUser();
  await withTenantScope(userId, async () => {
    const action = String(formData.get("action") ?? "") as ApprovalActionName;
    const reason = String(formData.get("reason") ?? "").trim() || null;

    const row = await db.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { organization: { select: { status: true } } },
    });
    if (!row) throw new Error("Request not found");

    // PAY-150-002. The view now carries money, so the rules can see it. Both
    // facts are resolved BEFORE the first authority question rather than after
    // it: `requesterIsPresident` used to be read six statements below, once the
    // decision had already been made, and the amount was not read at all.
    const slug = await institutionSlugFor(row.institutionId);
    const authority = approvalAuthorityFor(slug);
    const money = approvalMoney(
      row.metadata,
      localizationFor(slug).currency,
    );
    const requesterIsPresident = await isActivePresident(
      row.submittedById,
      row.organizationId,
    );
    // PAY-150-003. The standing declarations in force for THIS actor on THIS
    // request. Loaded here, on the deciding path, because this is the one place
    // it changes an answer: a recusal or a declared interest removes the gate
    // role, and until this existed `mayDecide` was handed a hardcoded `{}` so
    // neither could ever fire.
    const controlWorld = await standingDeclarationsFor({
      institutionId: row.institutionId,
      principalId: userId,
      resourceId: row.id,
    });
    // Every action below is a write to the club, and an archived club takes
    // none of them. Carried on the view so the rules decide it, not this
    // function.
    const approval = {
      ...row,
      organizationStatus: row.organization.status,
      requesterIsPresident,
      controlWorld,
      ...money,
    };

    const ctx = await getUserContext(userId);
    let allowed = availableActions(ctx, approval, authority).includes(action);
    let onBehalfOf: { id: string; name: string } | null = null;

    // Delegation: if the actor can't act directly, they may hold an active backup
    // grant from someone who can — borrow that authority and record on whose behalf.
    //
    // Never on your own request. `effectiveApprovalContext` concatenates the
    // delegator's seats onto the borrower's context while keeping their identity,
    // and `workflowRolesFor` then pushes BOTH `requester` and the borrowed
    // `president` — roles are additive and the engine matches with `some()`, so
    // acquiring an approving role cannot be cancelled by also being the person
    // who asked.
    //
    // That made a normal, encouraged action into a self-approval: any ACTIVE
    // member of a club is an eligible backup, so a president naming one hands
    // that member the ability to approve their own reimbursement at the
    // president gate. This branch is reached ONLY when the direct check already
    // refused, so it fired precisely in the case the direct rules had denied.
    //
    // Delegation lends authority, not the standing to use it on yourself.
    const borrow = mayBorrowAuthority({
      actorId: userId,
      requestedByPrincipalId: approval.submittedById,
    });
    if (!allowed && borrow.ok) {
      const { ctx: effCtx, delegators } = await effectiveApprovalContext(
        userId,
        ctx,
        approval.institutionId,
      );
      if (
        delegators.length > 0 &&
        availableActions(effCtx, approval, authority).includes(action)
      ) {
        allowed = true;
        onBehalfOf = delegators[0];
      }
    }

    if (!allowed) {
      await db.auditEvent.create({
        data: {
          institutionId: approval.institutionId,
          organizationId: approval.organizationId,
          actorId: userId,
          action: `Approval.${action}`,
          resourceType: "ApprovalRequest",
          resourceId: approval.id,
          outcome: "DENY",
          reason: `Not permitted from ${approval.status}`,
        },
      });
      throw new Error("You cannot take this action on this request");
    }

    const target = nextStatus(action, approval.status, {
      requesterIsPresident,
      exceedsThreshold: exceedsApprovalThreshold(money, authority),
    });
    if (!target)
      throw new Error(`Illegal transition: ${action} from ${approval.status}`);

    // Actor's role label for the immutable step record
    const actorSeat = await db.roleAssignment.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        role: { organizationId: approval.organizationId },
      },
      include: { role: { include: { seat: { select: { id: true } } } } },
    });
    // PAY-030-007. The durable seat behind the actor, for the ledger entry this
    // decision may post. Null for an OSE approver, who holds no club seat.
    const posterSeatId = actorSeat?.role.seat?.id ?? null;
    const oseRole = ctx.institutionRoles.find(
      (m) => m.institutionId === approval.institutionId,
    )?.role;
    const baseRole = actorSeat?.role.name ?? oseRole ?? "Requester";
    const roleContext = onBehalfOf
      ? `${baseRole}, on behalf of ${onBehalfOf.name}`
      : baseRole;

    // PAY-030-005. The configuration this decision is made against, recorded on
    // the immutable step. Read here rather than inside the transaction array so
    // one await covers both step writes below.
    const configSnapshot = await configSnapshotForInstitution(approval.institutionId);
    // Which gate conferred the decision. Derived from the status the request
    // was AT, which is what defines the gate — not from the actor's roles,
    // which under delegation belong to somebody else. `onBehalfOf` names
    // borrowed authority explicitly: "approvals.gate.ose" and
    // "approvals.gate.ose (delegated)" are different answers to "what allowed
    // this", and a trail that cannot tell them apart is missing the fact an
    // auditor came for.
    const gateAuthority = `${
      approval.status === "PENDING_OSE"
        ? "approvals.gate.ose"
        : approval.status === "PENDING_PRESIDENT"
          ? "approvals.gate.president"
          : "approvals.requester"
    }${onBehalfOf ? " (delegated)" : ""}`;

    // Approval-linked publishing: an EVENT approval drives its event's lifecycle
    const linkedEvent = await db.event.findUnique({
      where: { approvalId: approval.id },
    });
    const eventUpdates =
      linkedEvent == null
        ? []
        : target === "APPROVED"
          ? [
              db.event.update({
                where: { id: linkedEvent.id },
                data: { status: "PUBLISHED" },
              }),
            ]
          : target === "REJECTED" || target === "CANCELLED"
            ? [
                db.event.update({
                  where: { id: linkedEvent.id },
                  data: { status: "CANCELLED" },
                }),
              ]
            : [];

    // ── PAY-150-004 — is this still the request the last gate approved? ──────
    //
    // What the money-bearing payload says NOW, against what it said when a gate
    // last consented. `metadata` is a Json column that `syncApprovalSnapshot`
    // (calendar-write.ts) and any future editor can rewrite between the two
    // gates, and the compare-and-swap below guards `status` and nothing else —
    // so the president could approve $50 and the staff office post $5,000, with
    // an unbroken-looking trail. Recomputed from the row that was just read, so
    // it is the same bytes the ledger write below is about to use.
    //
    // Only on `approve`. A cancel or a reject needs no payload to still be
    // valid — refusing them would trap a request whose details moved — and a
    // `resubmit` from NEEDS_CHANGES is the requester legitimately changing it,
    // which writes a fresh gate step with a fresh digest.
    const currentDigest = approvalDigest(approval.metadata, {
      organizationId: approval.organizationId,
      type: approval.type,
      ...money,
    });
    let approvedDigest: string | null = null;
    if (action === "approve") {
      const recentGateSteps = await db.approvalStep.findMany({
        where: {
          approvalId: approval.id,
          toStatus: { in: ["PENDING_PRESIDENT", "PENDING_OSE"] },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 10,
        select: { fromStatus: true, toStatus: true, policySnapshot: true },
      });
      // `isGateStep` drops the same-status amendment steps the calendar appends,
      // which is the point: an amendment rewrites the payload, so letting its
      // step count as a gate would let a reschedule re-bless itself.
      const lastGate = recentGateSteps.find(isGateStep);
      approvedDigest = recordedPayloadDigest(lastGate?.policySnapshot);
    }

    if (approvedDigest !== null && approvedDigest !== currentDigest) {
      // Refuse, and say so on the record — in ONE transaction, so a request can
      // never be sent back without the step that explains why, and the
      // compare-and-swap on `status` still applies: a concurrent decision loses
      // here exactly as it would on the normal path.
      //
      // No hand-built AuditEvent: `tests/security/audit-writes.test.mjs` holds
      // a ratchet at the exact current count and raising it to admit a new raw
      // write would be weakening a guard to make a build pass. The ApprovalStep
      // written here IS the append-only decision trail for approvals (enforced
      // by audit-append-only.ts), it carries the actor, the named reason and
      // both digests, and the outbox event publishes the same fact.
      try {
        await db.$transaction([
          db.approvalRequest.update({
            where: { id: approval.id, status: approval.status },
            data: { status: "NEEDS_CHANGES" },
          }),
          db.approvalStep.create({
            data: {
              approvalId: approval.id,
              fromStatus: approval.status,
              toStatus: "NEEDS_CHANGES",
              actorId: userId,
              actorRoleContext: roleContext,
              reason: APPROVAL_DIGEST_MISMATCH_REASON,
              policySnapshot: {
                action,
                requesterIsPresident,
                payloadDigest: currentDigest,
                approvedDigest,
                payloadInvalidated: true,
              },
              configRevision: configSnapshot.revision,
              configChecksum: configSnapshot.checksum,
              authority: "approvals.digest.invalidated",
              evidenceDocumentId: null,
            },
          }),
          db.outboxEvent.create({
            data: outboxEventRow({
              eventId: randomUUID(),
              tenantId: approval.institutionId,
              type: "ApprovalDecided",
              schemaVersion: 1,
              resourceType: "ApprovalRequest",
              resourceId: approval.id,
              occurredAt: new Date().toISOString(),
              correlationId: approval.id,
              causationId: null,
              origin: "tenure",
              payload: {
                action: "request_changes",
                fromStatus: approval.status,
                toStatus: "NEEDS_CHANGES",
                organizationId: approval.organizationId,
                decidedById: userId,
                reason: "payload-digest-mismatch",
              },
            }) as Prisma.OutboxEventUncheckedCreateInput,
          }),
        ]);
      } catch (error) {
        if (isConcurrentDecision(error)) {
          throw new Error(
            "Someone else decided this request first. Reload to see where it stands.",
          );
        }
        throw error;
      }

      await notifyUsers([approval.submittedById], {
        title: `Your request “${approval.title}” needs approving again`,
        body: APPROVAL_DIGEST_MISMATCH_REASON,
        href: `/approvals/${approval.id}`,
        excludeUserId: userId,
      });
      revalidatePath("/approvals");
      revalidatePath(`/approvals/${approval.id}`);
      revalidatePath("/dashboard");
      throw new Error(APPROVAL_DIGEST_MISMATCH_REASON);
    }

    // Reimbursement auto-post: on FINAL approval, post the club spend to the ledger
    // — linking this approval + the receipt document — and recompute the budget
    // line's actual (three-way match: request ↔ approval ↔ receipt). A member
    // reimbursement is real club outflow, so it posts as kind SPEND (+), NOT the
    // REIMBURSEMENT kind (which is money the club RECOVERS). Idempotent: never
    // post twice for one request. Authority is the approval gate, not finance
    // manager rights — so the OSE approver can post without canManageFinance.
    const reimb = (
      approval.metadata as {
        reimbursement?: {
          budgetLineId?: string;
          amountCents?: number;
          /**
           * PAY-130-002. Recoverable tax inside `amountCents`, when the request
           * separated it. The fiscal-2027 revision of the posting template
           * splits it off the budget line; absent, it is zero and net equals
           * gross, which is what every pilot request carries today.
           */
          taxCents?: number;
          documentId?: string | null;
        };
      } | null
    )?.reimbursement;
    let reimbursementOps: Prisma.PrismaPromise<unknown>[] = [];
    // PAY-190-002 / PAY-200-004. The conversion and the ceilings this posting
    // was cleared against, recorded on the decision step below. Null when the
    // decision posted nothing, which is not the same as a posting with no
    // evidence.
    let movementEvidence: Record<string, unknown> | null = null;
    if (
      target === "APPROVED" &&
      reimb?.budgetLineId &&
      typeof reimb.amountCents === "number" &&
      reimb.amountCents > 0
    ) {
      const [already, line] = await Promise.all([
        db.ledgerEntry.findFirst({
          where: { approvalId: approval.id },
          select: { id: true },
        }),
        db.budgetLine.findFirst({
          where: {
            id: reimb.budgetLineId,
            organizationId: approval.organizationId,
          },
          // PAY-030-007. The entry is denominated in the LINE's currency, so
          // the line has to say what that is.
          select: { id: true, academicYear: true, currency: true },
        }),
      ]);
      if (!already && line) {
        // ── PAY-180-006 — refusal and escalation, BEFORE the write ───────────
        //
        // NEXT-SESSION §0.3 forbids executing money movement outright, and
        // until this gate existed nothing in the codebase could tell an
        // internal allocation apart from a disbursement: this function posted a
        // LedgerEntry with no predicate distinguishing a memo from a payout.
        //
        // The classification is refused and audited rather than silently
        // dropped. A request whose effect leaves the platform never reaches the
        // ledger, and one that is merely ambiguous — an internal allocation
        // naming a beneficiary outside the institution — is escalated to a
        // human instead of being guessed at in either direction.
        const paymentIntent = (
          approval.metadata as {
            payment?: {
              kind?: string;
              destinationLegalEntityId?: string | null;
              beneficiary?: { external?: boolean; name?: string } | null;
            };
          } | null
        )?.payment;

        const movement = classifyRequest({
          // Absent a `payment` block this is what a club reimbursement is: a
          // posting between dimensions under one legal owner (Bible §0.10).
          kind: paymentIntent?.kind ?? "ledger-allocation",
          sourceLegalEntityId: approval.institutionId,
          destinationLegalEntityId:
            paymentIntent?.destinationLegalEntityId ?? approval.institutionId,
          beneficiary: paymentIntent?.beneficiary
            ? {
                external: paymentIntent.beneficiary.external === true,
                name: paymentIntent.beneficiary.name ?? "unnamed",
              }
            : null,
          amountMinorUnits: reimb.amountCents,
          currency: line.currency,
        });

        // ── PAY-080-001 — WHICH of Bible §10's four this command is ──────────
        //
        // A second, different question from the one above. `classifyRequest`
        // says whether the request may proceed; this says what it IS — a memo
        // allocation that posts nothing, a balanced journal inside one legal
        // entity, a due-to/due-from across two, or money leaving the platform.
        // Before this, all four reached the same `db.ledgerEntry.create`.
        //
        // It runs BEFORE the refusal is thrown so that a refused movement's
        // audit row carries the type as well as the verdict: "we refused a
        // payout" and "we refused an EXTERNAL_PROVIDER_MOVEMENT whose Bible §11
        // verb is SETTLEMENT_PAYOUT" are different amounts of evidence.
        //
        // `postsJournal: true` is a fact about this path, not a default: what
        // follows a clearance here is `buildJournal` and two `LedgerEntry`
        // rows. A `kind: "memo"` request is therefore refused as unclassifiable
        // rather than posted, because a memo allocation is defined by making no
        // accounting posting.
        const command = classifyMovementCommand({
          kind: paymentIntent?.kind ?? "ledger-allocation",
          sourceLegalEntityId: approval.institutionId,
          destinationLegalEntityId:
            paymentIntent?.destinationLegalEntityId ?? approval.institutionId,
          beneficiary: paymentIntent?.beneficiary
            ? {
                external: paymentIntent.beneficiary.external === true,
                name: paymentIntent.beneficiary.name ?? "unnamed",
              }
            : null,
          postsJournal: true,
        });

        if (movement.verdict !== "ALLOWED") {
          // A refused money movement is precisely the row an attacker would
          // want unchained, so it goes through the builder: hash chain, release
          // id, money-mode, and the DENY-needs-a-reason rule enforced rather
          // than remembered.
          await recordAuditEvent({
            institutionId: approval.institutionId,
            organizationId: approval.organizationId ?? undefined,
            actor: { principalId: userId },
            action: `Payments.${movement.verdict}`,
            resourceType: "ApprovalRequest",
            resourceId: approval.id,
            outcome: "DENY",
            reason: `${movement.code}: ${movement.reason}`,
            metadata: {
              verdict: movement.verdict,
              code: movement.code,
              escalateTo: movement.escalateTo,
              // PAY-080-001. What was refused, not only that something was.
              commandType: command.commandType,
              commandCode: command.code,
              payoutCommand: command.payoutCommand,
            },
          });
          throw new Error(
            movement.verdict === "REFUSED"
              ? `This request cannot be posted: ${movement.reason}`
              : `This request needs ${movement.escalateTo} to decide it first: ${movement.reason}`,
          );
        }

        // An ALLOWED movement whose §10 type nobody could determine does not
        // post. "We could not classify it" is not "it is internal", and the
        // journal below is written under a command type that is recorded with
        // it — so an unclassified posting is a row nobody can later explain.
        if (!command.decided) {
          await recordAuditEvent({
            institutionId: approval.institutionId,
            organizationId: approval.organizationId ?? undefined,
            actor: { principalId: userId },
            action: "Payments.COMMAND_UNCLASSIFIED",
            resourceType: "ApprovalRequest",
            resourceId: approval.id,
            outcome: "DENY",
            reason: `${command.code}: ${command.reason}`,
            metadata: { commandCode: command.code },
          });
          throw new Error(`This request cannot be posted: ${command.reason}`);
        }

        // ── PAY-190-002 and PAY-200-004 — the currency, then the ceilings ────
        //
        // Two questions the path did not ask. The claim's currency was never
        // compared with the LINE's: `amountCents` went into an entry denominated
        // in `line.currency` whatever the requester filed it in, so a €100.00
        // claim posted $100.00. And nothing bounded the amount, the tempo or the
        // day's total, so two requests each under the approval ladder's ceiling
        // summed to whatever their author chose.
        //
        // Both fail closed, and both refuse BEFORE the journal is built rather
        // than after it is posted. `taxCents` is read here because the gate has
        // to convert it with the same quote as the gross — converting the net
        // separately would round twice and produce a journal that does not add
        // up to the claim.
        const taxCents = typeof reimb.taxCents === "number" ? reimb.taxCents : 0;
        // The currency the request was FILED in, resolved once at the top of
        // this function by the same parser authority was decided on — never
        // re-read here, so the gate and the ladder cannot disagree about it.
        const claimCurrency = money.currency.toUpperCase();
        const gate = await gateMoneyMovement({
          institutionId: approval.institutionId,
          actorPrincipalId: userId,
          // The person who fronted the cash is the person being paid back, and
          // is therefore the subject the per-recipient ceiling sums over.
          recipientKey: approval.submittedById,
          accountKey: line.id,
          presentmentMinorUnits: reimb.amountCents,
          presentmentCurrency: claimCurrency,
          presentmentTaxMinorUnits: taxCents,
          settlementCurrency: line.currency,
          declaredQuote:
            (
              approval.metadata as {
                payment?: { fx?: Record<string, unknown> | null } | null;
              } | null
            )?.payment?.fx ?? null,
        });

        if (!gate.ok) {
          await recordAuditEvent({
            institutionId: approval.institutionId,
            organizationId: approval.organizationId ?? undefined,
            actor: { principalId: userId },
            action: `Payments.${gate.gate}_REFUSED`,
            resourceType: "ApprovalRequest",
            resourceId: approval.id,
            outcome: "DENY",
            reason: `${gate.code}: ${gate.reason}`,
            metadata: { gate: gate.gate, code: gate.code },
          });
          throw new Error(`This request cannot be posted: ${gate.reason}`);
        }

        movementEvidence = {
          ...fxEvidenceRecord(gate.fx),
          ...(gate.taxFx
            ? { taxSettlementMinorUnits: gate.taxFx.settlement.minorUnits }
            : {}),
          limitsVerdict: gate.limits.verdict,
          limitsCode: gate.limits.code,
          limitsNotApplicable: gate.limits.notApplicable.join(","),
          // PAY-080-001. The §10 command type this journal was posted as, on
          // the decision step, so the row can be read back as one of four acts
          // rather than as "a ledger entry".
          commandType: command.commandType,
          commandCode: command.code,
          requiresIntercompanyPolicy: command.requiresIntercompanyPolicy,
        };

        // ── PAY-130-002 — a balanced journal, from an effective-dated template
        //
        // `postingFor` refuses when no revision is effective at `effectiveAt`
        // rather than falling back to the newest, and `buildJournal` refuses an
        // unbalanced result. Both halves are persisted: the expense against the
        // budget line, and the payable to the member who fronted the cash. The
        // payable carries no `budgetLineId` — it is an organization-level
        // liability, and dimensioning it would double the line's actual.
        //
        // The amounts are the gate's SETTLEMENT figures, in `line.currency`,
        // which for a same-currency claim are the filed ones to the unit.
        const effectiveAt = new Date();
        const journal = buildJournal(
          postingFor(REIMBURSEMENT_TEMPLATE, effectiveAt.toISOString()),
          {
            gross: gate.settlementGrossMinorUnits,
            net: gate.settlementGrossMinorUnits - gate.settlementTaxMinorUnits,
            tax: gate.settlementTaxMinorUnits,
          },
          { journalId: randomUUID(), effectiveAt: effectiveAt.toISOString() },
        );

        const description =
          approval.title.replace(/^Reimbursement:\s*/i, "").slice(0, 140) ||
          "Reimbursement";

        // Zero-amount lines are dropped AFTER the balance check, never before:
        // `buildJournal` has already proven the journal balances with them in,
        // and a row of zero moves nothing while adding a line every reader of
        // the drawer has to dismiss. The fiscal-2027 revision posts recoverable
        // tax, which is zero on every pilot request.
        reimbursementOps = journal.entries
          .filter((entry) => entry.amountMinorUnits !== 0)
          .map((entry) =>
          db.ledgerEntry.create({
            data: {
              institutionId: approval.institutionId,
              organizationId: approval.organizationId,
              // Only the budget-dimensioned side carries the line.
              budgetLineId: entry.budgetDimensioned ? line.id : null,
              academicYear: line.academicYear,
              // The KIND is the business event and is the same on both halves;
              // the SIDE is the accounting direction and is not. Collapsing the
              // two is what made the old single-sided row look complete.
              kind: "SPEND",
              journalId: journal.journalId,
              templateId: journal.templateId,
              account: entry.account,
              side: entry.side === "debit" ? "DEBIT" : "CREDIT",
              effectiveAt,
              // Debit-positive, unchanged in meaning: this is still the signed
              // effect `ledgerSignedCents` projects for display, and for the
              // expense half of a SPEND it is still +magnitude.
              amountCents: entry.signedMinorUnits,
              currency: line.currency,
              description,
              approvalId: approval.id,
              documentId: reimb.documentId ?? null,
              postedById: userId,
              // The approver's seat in the club they are deciding for, when
              // they hold one. An OSE approver holds none, and null is the
              // honest answer there rather than a borrowed seat id.
              postedBySeatId: posterSeatId,
            },
          }),
        );

        // The budget line moves by the budget-dimensioned side only. Summing
        // the whole journal would move it by zero, which is what a balanced
        // journal means and is not what a line's actual is.
        const budgetSide = journal.entries.find((e) => e.budgetDimensioned);
        if (budgetSide) {
          reimbursementOps.push(
            db.budgetLine.update({
              where: { id: line.id },
              // Relative, not a precomputed total. Reading the ledger sum first and
              // writing back sum+signed loses one of two concurrent spends: both
              // callers read the same sum before either commits, so the second write
              // overwrites the first with a value that never included it. The line
              // then sits under its own ledger until some later operation recomputes
              // it, and the club is charged twice, disconnected from the approval
              // that caused it. `increment` emits SET actualCents = actualCents + $1,
              // which PostgreSQL re-evaluates against the committed row.
              data: { actualCents: { increment: budgetSide.signedMinorUnits } },
            }),
          );
        }
      }
    }

    // The status this decision was based on was read at the top of this function,
    // six round-trips ago and outside the transaction below. Both approval gates
    // are held by more than one person — PENDING_OSE is open to every institution
    // membership, and delegation widens it further — so two approvers can observe
    // the same PENDING request and both write. Naming the observed status in the
    // `where` makes that a compare-and-swap: the second writer matches no row,
    // Prisma raises P2025, and the whole batch rolls back instead of appending a
    // second ApprovalStep and AuditEvent to a trail the schema declares immutable,
    // or posting a SPEND against a request the other approver just rejected.
    try {
      await db.$transaction([
        ...eventUpdates,
        ...reimbursementOps,
        db.approvalRequest.update({
          where: { id: approval.id, status: approval.status },
          data: { status: target },
        }),
        db.approvalStep.create({
          data: {
            approvalId: approval.id,
            fromStatus: approval.status,
            toStatus: target,
            actorId: userId,
            actorRoleContext: roleContext,
            reason,
            policySnapshot: {
              action,
              requesterIsPresident,
              // PAY-150-004. What this decision was ABOUT, not only who took
              // it. When this step lands on PENDING_OSE it becomes the digest
              // the final gate is checked against, which is what makes the
              // president's consent specific to an amount.
              payloadDigest: currentDigest,
              ...(onBehalfOf ? { onBehalfOf: onBehalfOf.id } : {}),
              // PAY-190-002 / PAY-200-004. What the posted amount was converted
              // from, at whose rate, and which ceilings cleared it. On the step
              // rather than only in a log: this is the row a restatement reads.
              ...(movementEvidence ? { movement: movementEvidence } : {}),
            },
            // PAY-030-005. WHICH policy this was decided against, and what
            // conferred the authority. `policySnapshot` above carries ad-hoc
            // booleans about this one request; these two say which definition
            // and which resolved values were in force, which is the question
            // "was this allowed at the time" actually needs.
            configRevision: configSnapshot.revision,
            configChecksum: configSnapshot.checksum,
            authority: gateAuthority,
            // The receipt behind a reimbursement decision, when there is one.
            evidenceDocumentId: reimb?.documentId ?? null,
          },
        }),
        db.auditEvent.create({
          data: {
            institutionId: approval.institutionId,
            organizationId: approval.organizationId,
            actorId: userId,
            action: `Approval.${action}`,
            resourceType: "ApprovalRequest",
            resourceId: approval.id,
            outcome: "ALLOW",
            reason,
            metadata: onBehalfOf ? { onBehalfOf: onBehalfOf.id } : {},
          },
        }),
        // GE-021-006 / PACK-060-001 — the decision, published.
        //
        // In this array and not after it, which is the whole property: the
        // status change and the event either both commit or neither does. An
        // insert after the transaction leaves a window where the request moved
        // and nothing downstream can ever learn it did, and the compare-and-swap
        // above makes that window exactly as wide as a concurrent decision.
        //
        // `ApprovalDecided` is what `modules/index.ts` declares the approvals
        // module emits, and what the `request-to-approval-to-memory` chain
        // joins on. `outboxEventRow` runs `parseDomainEvent`, so the spelling
        // in the manifest and the spelling in the row cannot drift apart.
        db.outboxEvent.create({
          data: outboxEventRow({
            eventId: randomUUID(),
            tenantId: approval.institutionId,
            type: "ApprovalDecided",
            schemaVersion: 1,
            resourceType: "ApprovalRequest",
            resourceId: approval.id,
            occurredAt: new Date().toISOString(),
            // No inbound request id to correlate on, so the request this is
            // about is the correlation. It is what a support question about
            // this decision would be asked in terms of.
            correlationId: approval.id,
            causationId: null,
            // Built from this platform's own columns — see the note on the
            // ApprovalRequested event above.
            origin: "tenure",
            payload: {
              action,
              fromStatus: approval.status,
              toStatus: target,
              organizationId: approval.organizationId,
              decidedById: userId,
              ...(onBehalfOf ? { onBehalfOf: onBehalfOf.id } : {}),
            },
          }) as Prisma.OutboxEventUncheckedCreateInput,
        }),
      ]);
    } catch (error) {
      if (isConcurrentDecision(error)) {
        throw new Error(
          "Someone else decided this request first. Reload to see where it stands.",
        );
      }
      throw error;
    }

    // ── Notifications (BP: notification system across all RBAC flows) ────────
    const label =
      action === "approve" && target === "APPROVED"
        ? "is approved"
        : action === "approve"
          ? "passed the president's review"
          : action === "reject"
            ? "was declined"
            : action === "request_changes"
              ? "needs a few changes"
              : action === "cancel"
                ? "was cancelled"
                : "moved forward";
    await notifyUsers([approval.submittedById], {
      title: `Your request “${approval.title}” ${label}`,
      body: reason ?? undefined,
      href: `/approvals/${approval.id}`,
      excludeUserId: userId,
    });
    if (target === "PENDING_OSE" || target === "PENDING_PRESIDENT") {
      await notifyGate(approval, target, userId);
    }
    if (linkedEvent && target === "APPROVED") {
      await notifyUsers(await orgCurrentMemberIds(approval.organizationId), {
        title: `${linkedEvent.title} is approved and now on the calendar`,
        href: `/calendar/${linkedEvent.id}`,
        excludeUserId: userId,
      });
    }

    revalidatePath("/approvals");
    revalidatePath(`/approvals/${approval.id}`);
    revalidatePath("/dashboard");
    if (linkedEvent) {
      revalidatePath("/calendar");
      revalidatePath(`/calendar/${linkedEvent.id}`);
    }
  });
}
