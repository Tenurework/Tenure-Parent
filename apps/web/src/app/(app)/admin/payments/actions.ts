"use server"

import { revalidatePath } from "next/cache"
import {
  assertLiabilityApproved,
  chargeModelDigest,
  decideChargeModel,
  requiresLiabilityException,
  type ApprovalRecord,
  type ChargeModelInput,
  type FundsFlowConfig,
} from "@tenure/payments"

import { db } from "@/lib/db"
import { recordAuditEvent } from "@/lib/audit-record"
import { requireAdminContext } from "@/lib/admin/guard"
import { withTenantScope } from "@/lib/tenant-scope"

/**
 * PAY-040-003 / PAY-070-003 — the payments configuration writer, and its gate.
 *
 * This is the production caller `decideChargeModel` exists for, and the place
 * `requiresLiabilityException` is enforced rather than merely computed.
 *
 * The rule Bible §6 states — "Destination charges and separate charges and
 * transfers are exception-capable flows because they can place fees, refunds,
 * chargebacks and negative balances on the platform" — is implemented here as a
 * refusal to PERSIST. Not a warning, not a badge: a flow that shifts liability
 * onto Tenure cannot be written unless an APPROVED `ApprovalType.EXCEPTION`
 * request exists whose pinned decision digest equals the digest of the decision
 * being written.
 *
 * The digest is what makes the approval mean something. An approver who blessed
 * a destination charge on a $500 gross has not blessed the same flow at
 * $500,000, so changing the amount after approval produces a different digest,
 * the gate refuses again, and a NEW request is raised. `chargeModelDigest`
 * covers the amounts for exactly that reason.
 *
 * The refusal RAISES the request rather than telling the operator to go and
 * make one: a gate that hands somebody a form to fill in elsewhere is a gate
 * people route around.
 */

export type FundsFlowFormResult =
  | { ok: true; chargeModel: string; liableParty: string; reasons: string[] }
  | { ok: false; code: string; reason: string; blockers: string[]; approvalId: string | null }

function intField(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "").trim()
  const value = Number(raw)
  return Number.isInteger(value) ? value : Number.NaN
}

/**
 * Build the decision input from the form.
 *
 * Every axis is read from the request rather than defaulted. A default here
 * would be a decision nobody made, which is the failure `decideChargeModel`
 * refuses on: `lossBearer` is null when the operator left it blank, and that is
 * a named blocker rather than an assumption.
 */
function decisionInputFrom(
  formData: FormData,
  responsibility: FundsFlowConfig,
): ChargeModelInput {
  const lossBearerRaw = String(formData.get("lossBearer") ?? "").trim()
  return {
    useCase: String(formData.get("useCase") ?? "TENANT_CUSTOMER_SALE") as ChargeModelInput["useCase"],
    capabilityId: String(formData.get("capabilityId") ?? ""),
    seller: {
      legalEntityId: String(formData.get("legalEntityId") ?? ""),
      country: String(formData.get("sellerCountry") ?? ""),
      legalEntityType: String(
        formData.get("legalEntityType") ?? "NON_PROFIT",
      ) as ChargeModelInput["seller"]["legalEntityType"],
      businessType: String(
        formData.get("businessType") ?? "EDUCATION",
      ) as ChargeModelInput["seller"]["businessType"],
    },
    buyer: {
      country: String(formData.get("buyerCountry") ?? ""),
      kind: String(formData.get("buyerKind") ?? "INDIVIDUAL") as ChargeModelInput["buyer"]["kind"],
    },
    region: String(formData.get("region") ?? ""),
    currency: String(formData.get("currency") ?? ""),
    connectedAccount: {
      accountId: String(formData.get("connectedAccountId") ?? "").trim() || null,
      chargesEnabled: formData.get("chargesEnabled") === "on",
      payoutsEnabled: formData.get("payoutsEnabled") === "on",
      responsibility,
    },
    lossBearer: lossBearerRaw
      ? (lossBearerRaw as NonNullable<ChargeModelInput["lossBearer"]>)
      : null,
    amounts: {
      grossCents: intField(formData, "grossCents"),
      platformFeeCents: intField(formData, "platformFeeCents"),
    },
  }
}

/**
 * The responsibility answers, one select per axis, as the form posts them.
 *
 * Recorded as `defaults` rather than `overrides`: these are the platform's
 * answers for this merchant, which is what onboarding and legal set. A tenant
 * amending one later is the `overrides` layer, and keeping them separate is
 * what lets `resolveResponsibility` report which is which.
 */
function responsibilityFrom(formData: FormData): FundsFlowConfig {
  const config: FundsFlowConfig = {}
  for (const flow of ["direct", "destination", "separate_charges_and_transfers"] as const) {
    const defaults: Record<string, string> = {}
    for (const axis of [
      "merchantDisplay",
      "feePayer",
      "lossPayer",
      "refundPayer",
      "disputeOwner",
      "kycUpdateOwner",
      "accountCollectionOwner",
      "supportOwner",
    ]) {
      const value = String(formData.get(`${flow}.${axis}`) ?? "").trim()
      if (value) defaults[axis] = value
    }
    if (Object.keys(defaults).length > 0) {
      config[flow] = { defaults: defaults as FundsFlowConfig[typeof flow] extends undefined
        ? never
        : NonNullable<FundsFlowConfig[typeof flow]>["defaults"] }
    }
  }
  return config
}

export async function saveFundsFlowConfiguration(
  organizationId: string,
  formData: FormData,
): Promise<FundsFlowFormResult> {
  const { userId, institutionId } = await requireAdminContext()

  const result = await withTenantScope(userId, async (): Promise<FundsFlowFormResult> => {
    const org = await db.organization.findFirst({
      where: { id: organizationId, institutionId },
      select: { id: true },
    })
    if (!org) {
      return {
        ok: false,
        code: "organization-out-of-scope",
        reason: "That club is not in this institution.",
        blockers: [],
        approvalId: null,
      }
    }

    const decision = decideChargeModel(decisionInputFrom(formData, responsibilityFrom(formData)))

    if (decision.model === null) {
      // Refused before the gate is even reached: there is no decision to
      // approve. Returning the blockers rather than a generic failure is the
      // same discipline `simulateEligibility` holds — an operator who fixes one
      // and is handed the next runs the loop four times.
      return {
        ok: false,
        code: "charge-model-undecidable",
        reason: "No charge model follows from these inputs.",
        blockers: decision.blockers,
        approvalId: null,
      }
    }

    const digest = chargeModelDigest(decision)

    // Only EXCEPTION requests, and only this club's. An approval from another
    // organization is not authority here whatever its digest says.
    const approvals: ApprovalRecord[] = (
      await db.approvalRequest.findMany({
        where: { organizationId: org.id, type: "EXCEPTION" },
        select: { id: true, type: true, status: true, metadata: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      })
    ).map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      decisionDigest:
        (row.metadata as { payments?: { decisionDigest?: unknown } } | null)?.payments
          ?.decisionDigest instanceof String ||
        typeof (row.metadata as { payments?: { decisionDigest?: unknown } } | null)?.payments
          ?.decisionDigest === "string"
          ? String(
              (row.metadata as { payments: { decisionDigest: string } }).payments.decisionDigest,
            )
          : null,
    }))

    const gate = assertLiabilityApproved(decision, approvals)

    if (!gate.ok) {
      // Raise the request the gate says is missing, idempotently: a second
      // attempt while one is pending must not create a second request, or the
      // approver is handed a queue of identical items and approves the wrong one.
      let raised: string | null = null
      const alreadyPinned = approvals.find((a) => a.decisionDigest === digest)
      if (!alreadyPinned) {
        const created = await db.approvalRequest.create({
          data: {
            institutionId,
            organizationId: org.id,
            type: "EXCEPTION",
            title: gate.raise.title,
            description: gate.raise.description,
            submittedById: userId,
            status: "PENDING_OSE",
            metadata: gate.raise.metadata,
          },
          select: { id: true },
        })
        raised = created.id
      }
      return {
        ok: false,
        code: gate.code,
        reason: gate.reason,
        blockers: decision.blockers,
        approvalId: raised ?? alreadyPinned?.id ?? null,
      }
    }

    await db.paymentsFundsFlowConfig.upsert({
      where: {
        organizationId_legalEntityId_capabilityId: {
          organizationId: org.id,
          legalEntityId: decision.sellerLegalEntityId,
          capabilityId: decision.capabilityId,
        },
      },
      create: {
        institutionId,
        organizationId: org.id,
        legalEntityId: decision.sellerLegalEntityId,
        capabilityId: decision.capabilityId,
        chargeModel: decision.model,
        liableParty: decision.liableParty ?? "TENANT",
        region: decision.region,
        currency: String(formData.get("currency") ?? ""),
        grossCents: decision.amounts.grossCents,
        platformFeeCents: decision.amounts.platformFeeCents,
        decisionDigest: digest,
        exceptionApprovalId: gate.approvalId,
        createdById: userId,
      },
      update: {
        chargeModel: decision.model,
        liableParty: decision.liableParty ?? "TENANT",
        region: decision.region,
        currency: String(formData.get("currency") ?? ""),
        grossCents: decision.amounts.grossCents,
        platformFeeCents: decision.amounts.platformFeeCents,
        decisionDigest: digest,
        exceptionApprovalId: gate.approvalId,
      },
    })

    // Through the builder. This row says who is liable for a club's money and
    // under which charge model, so it is one of the rows an incident review
    // reads first — and a hand-built one joins no hash chain, which is the
    // property that makes a later edit detectable.
    await recordAuditEvent({
      institutionId,
      organizationId: org.id,
      actor: { principalId: userId },
      action: "Payments.FundsFlowConfigured",
      resourceType: "PaymentsFundsFlowConfig",
      resourceId: decision.sellerLegalEntityId,
      outcome: "ALLOW",
      reason: gate.reason,
      metadata: {
        chargeModel: decision.model,
        liableParty: decision.liableParty,
        decisionDigest: digest,
        requiredException: requiresLiabilityException(decision),
        exceptionApprovalId: gate.approvalId,
      },
    })

    return {
      ok: true,
      chargeModel: decision.model,
      liableParty: decision.liableParty ?? "TENANT",
      reasons: decision.reasons,
    }
  })

  // Outside the scope, deliberately. `revalidatePath` throws a Next control-flow
  // error, and thrown inside `withTenantScope` it aborts the transaction the
  // scope holds open — rolling back the configuration write and its audit row
  // while the browser is told the save succeeded. Silent data loss behind a
  // success screen, which is the whole of REVIEW-FINDINGS #16.
  if (result.ok) revalidatePath("/admin/payments")

  return result
}
