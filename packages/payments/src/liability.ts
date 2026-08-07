import { createHash } from "node:crypto"

import type { ChargeModelDecision } from "./charge-model"

/**
 * PAY-070-003 — a flow that moves liability to Tenure needs a human to say yes.
 *
 * Bible §6: "Destination charges and separate charges/transfers are
 * exception-capable flows because they can place fees, refunds, chargebacks and
 * negative balances on the platform." Bible §0.2: "Tenure must not accept
 * platform liability merely to unlock a convenient flow." The convenience is
 * real — those flows solve delayed recipients and splits — which is exactly why
 * the gate has to be structural rather than a note in a runbook.
 *
 * Two halves, and the second is the one that usually goes missing:
 *
 *   1. `requiresLiabilityException` says an approval is needed.
 *   2. `assertLiabilityApproved` refuses the WRITE until an APPROVED request
 *      exists whose pinned digest equals the decision being written.
 *
 * The digest is what stops the approval being a rubber stamp on a moving
 * target. Approving a destination charge on a £500 gross with Tenure carrying
 * loss is not approval of the same flow at £500,000 — so the digest covers the
 * amounts, and a change after approval produces a mismatch that forces a NEW
 * request instead of silently passing.
 */

export const LIABILITY_SHIFTING_MODELS = ["DESTINATION", "SEPARATE_CHARGE_AND_TRANSFER"] as const

/**
 * Does this decision put platform liability on Tenure?
 *
 * Both conditions, not either. A destination charge whose loss payer is the
 * connected account is an ordinary configuration; Tenure carrying loss on a
 * direct charge is refused upstream by `resolveResponsibility` and cannot reach
 * here. The pair is the case Bible §6 calls exception-capable.
 */
export function requiresLiabilityException(decision: ChargeModelDecision): boolean {
  if (decision.model === null) return false
  if (!(LIABILITY_SHIFTING_MODELS as readonly string[]).includes(decision.model)) return false
  return decision.liableParty === "TENURE"
}

/**
 * The decision, canonicalised.
 *
 * Every field an approver would have read, in a fixed order, so the same
 * decision always hashes the same and a different one never does. `amounts` is
 * in here deliberately — see the header.
 */
export function chargeModelDigest(decision: ChargeModelDecision): string {
  const canonical = JSON.stringify([
    decision.model,
    decision.liableParty,
    decision.capabilityId,
    decision.region,
    decision.sellerLegalEntityId,
    decision.useCase,
    decision.amounts.grossCents,
    decision.amounts.platformFeeCents,
    decision.fundsFlow.flow,
  ])
  return createHash("sha256").update(canonical).digest("hex")
}

export interface LiabilityExceptionRequest {
  /** Matches `ApprovalType.EXCEPTION` in apps/web/prisma/schema.prisma. */
  type: "EXCEPTION"
  title: string
  description: string
  metadata: {
    payments: {
      kind: "liability-exception"
      decisionDigest: string
      model: string
      liableParty: string
      capabilityId: string
      region: string
      sellerLegalEntityId: string
      grossCents: number
      platformFeeCents: number
    }
  }
}

/** The approval request a refused write should raise. */
export function liabilityExceptionRequest(
  decision: ChargeModelDecision,
): LiabilityExceptionRequest {
  if (!requiresLiabilityException(decision)) {
    throw new Error(
      "liabilityExceptionRequest called for a decision that shifts no liability to Tenure. " +
        "Raising an exception nobody needs teaches approvers to approve without reading.",
    )
  }
  const digest = chargeModelDigest(decision)
  return {
    type: "EXCEPTION",
    title: `Platform liability exception — ${decision.model} for ${decision.sellerLegalEntityId}`,
    description:
      `${decision.model} charges for ${decision.sellerLegalEntityId} (${decision.capabilityId}, ` +
      `acquired in ${decision.region}) place fees, refunds, chargebacks and negative balances on ` +
      `Tenure rather than on the tenant connected account. Gross ${decision.amounts.grossCents} ` +
      `minor units; platform fee ${decision.amounts.platformFeeCents}. ` +
      decision.reasons.join(" "),
    metadata: {
      payments: {
        kind: "liability-exception",
        decisionDigest: digest,
        model: decision.model as string,
        liableParty: decision.liableParty as string,
        capabilityId: decision.capabilityId,
        region: decision.region,
        sellerLegalEntityId: decision.sellerLegalEntityId,
        grossCents: decision.amounts.grossCents,
        platformFeeCents: decision.amounts.platformFeeCents,
      },
    },
  }
}

/** One approval as the writer sees it, reduced to what this gate reads. */
export interface ApprovalRecord {
  id: string
  type: string
  status: string
  /** The digest pinned when the request was raised. */
  decisionDigest: string | null
}

export type LiabilityGate =
  | { ok: true; reason: string; approvalId: string | null }
  | { ok: false; code: string; reason: string; raise: LiabilityExceptionRequest }

/**
 * May this decision be persisted?
 *
 * Fails closed in three distinct ways, and they are distinct because they need
 * different actions: no request at all (raise one), a request that is not
 * approved yet (wait for the approver), and an approved request pinned to a
 * DIFFERENT decision (raise a new one — the thing that was approved is not the
 * thing being written).
 */
export function assertLiabilityApproved(
  decision: ChargeModelDecision,
  approvals: readonly ApprovalRecord[],
): LiabilityGate {
  if (!requiresLiabilityException(decision)) {
    return {
      ok: true,
      reason:
        decision.model === null
          ? "No charge model was decided, so there is no liability to shift."
          : `${decision.model} with loss carried by ${decision.liableParty} places no platform ` +
            `liability on Tenure.`,
      approvalId: null,
    }
  }

  const digest = chargeModelDigest(decision)
  const raise = liabilityExceptionRequest(decision)
  const exceptions = approvals.filter((a) => a.type === "EXCEPTION")
  const matching = exceptions.filter((a) => a.decisionDigest === digest)
  const approved = matching.find((a) => a.status === "APPROVED")

  if (approved) {
    return {
      ok: true,
      reason: `Exception ${approved.id} is APPROVED and pinned to this exact decision (${digest.slice(0, 12)}).`,
      approvalId: approved.id,
    }
  }

  if (matching.length > 0) {
    return {
      ok: false,
      code: "liability-exception-not-decided",
      reason:
        `Exception ${matching.map((a) => a.id).join(", ")} is pinned to this decision but is ` +
        `${matching.map((a) => a.status).join(", ")}, not APPROVED.`,
      raise,
    }
  }

  if (exceptions.length > 0) {
    return {
      ok: false,
      code: "liability-exception-digest-mismatch",
      reason:
        `An exception exists for this configuration, but it was approved for a different ` +
        `decision — pinned ${exceptions.map((a) => (a.decisionDigest ?? "none").slice(0, 12)).join(", ")}, ` +
        `writing ${digest.slice(0, 12)}. What was approved is not what is being written, so it ` +
        `needs a new request rather than the old one's authority.`,
      raise,
    }
  }

  return {
    ok: false,
    code: "liability-exception-missing",
    reason:
      `${decision.model} charges carry loss on Tenure and no EXCEPTION approval exists. ` +
      `Bible §0.2: Tenure must not accept platform liability merely to unlock a convenient flow.`,
    raise,
  }
}
