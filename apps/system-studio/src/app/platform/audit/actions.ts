"use server"

import { revalidatePath } from "next/cache"

import type { LegalHold } from "@tenure/audit"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import {
  AuditUnavailable,
  PLATFORM_PARTITION,
  appendIntent,
  appendOutcome,
  auditedAct,
  placeLegalHold,
  releaseLegalHold,
} from "@/lib/audit-ledger"

/**
 * STUDIO-110-005 — placing and lifting a legal hold.
 *
 * `applyRetention` takes a hold list, and a hold list nothing can write is a
 * parameter that is always empty: the retention plan would then be computed as
 * though no preservation order existed anywhere, which is the one way a
 * retention plan can be actively dangerous. These are the writers.
 *
 * Both are audited acts in their own right, through the same chained ledger they
 * protect. Placing a hold is a decision about what evidence survives, so a hold
 * placed by nobody, for no reason, is exactly the kind of act an audit trail is
 * for.
 */

export interface HoldResult {
  error?: string
  message?: string
}

/**
 * The same refusal for "not signed in" and "signed in, not an operator".
 *
 * Telling them apart tells an unauthenticated caller that an address is an
 * operator's, which is the fact worth protecting.
 */
async function requireOperator(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!isOperator(email)) throw new Error("Not found")
  return email!
}

const now = () => new Date().toISOString()

export async function placeHold(_prev: HoldResult | null, form: FormData): Promise<HoldResult> {
  let principalId: string
  try {
    principalId = await requireOperator()
  } catch {
    // Recorded on the platform chain, then refused. A denial nobody wrote down
    // is the one an incident review most needs and the one that is never there.
    const at = now()
    try {
      const intent = await appendIntent({
        subject: PLATFORM_PARTITION,
        action: "audit.hold.place",
        target: String(form.get("partition") ?? "unknown"),
        actor: "unauthenticated",
        at,
        detail: "A caller without operator permission tried to place a legal hold.",
      })
      await appendOutcome({
        subject: PLATFORM_PARTITION,
        resolves: intent.seq,
        action: "audit.hold.place",
        target: String(form.get("partition") ?? "unknown"),
        actor: "unauthenticated",
        at: now(),
        outcome: "REFUSED_NOT_AN_OPERATOR",
        detail: "Refused: the caller is not on the operator allowlist.",
      })
    } catch (err) {
      if (!(err instanceof AuditUnavailable)) throw err
    }
    return { error: "Not found" }
  }

  const partition = String(form.get("partition") ?? "").trim()
  const id = String(form.get("holdId") ?? "").trim()
  const reason = String(form.get("reason") ?? "").trim()
  const actionScope = String(form.get("actionScope") ?? "").trim()

  if (!partition) return { error: "A hold must name the chain it preserves." }
  if (!id) return { error: "A hold must have an id; an anonymous hold cannot be released." }
  if (!reason) return { error: "A hold must say why it exists, or it cannot be released with confidence." }

  const hold: LegalHold = {
    id,
    tenantId: partition,
    reason,
    placedAt: now(),
    // An omitted scope does not constrain, which is what a litigation hold
    // usually is. Written as `undefined` rather than `{}` so "no scope" and "a
    // scope somebody filled in and left empty" are not the same record.
    ...(actionScope ? { scope: { action: actionScope } } : {}),
  }

  try {
    await auditedAct(
      {
        subject: partition,
        action: "audit.hold.place",
        target: id,
        actor: principalId,
        at: now(),
        detail: `Place legal hold "${id}"${actionScope ? ` over ${actionScope}` : ""}: ${reason}`,
      },
      () => placeLegalHold(hold),
      () => ({ outcome: "APPLIED", detail: `Legal hold "${id}" is in force over ${partition}.` }),
    )
  } catch (err) {
    if (err instanceof AuditUnavailable) return { error: err.message }
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return { error: `A hold with id "${id}" already exists on ${partition}. Ids are not reused.` }
    }
    throw err
  }

  revalidatePath("/platform/audit")
  return { message: `Legal hold "${id}" placed over ${partition}.` }
}

export async function releaseHold(_prev: HoldResult | null, form: FormData): Promise<HoldResult> {
  const principalId = await requireOperator()

  const partition = String(form.get("partition") ?? "").trim()
  const id = String(form.get("holdId") ?? "").trim()
  const reason = String(form.get("reason") ?? "").trim()
  if (!partition || !id) return { error: "Which hold, on which chain?" }
  if (!reason) return { error: "Releasing a hold needs a reason as much as placing one did." }

  const releasedAt = now()
  try {
    await auditedAct(
      {
        subject: partition,
        action: "audit.hold.release",
        target: id,
        actor: principalId,
        at: releasedAt,
        detail: `Release legal hold "${id}": ${reason}`,
      },
      () => releaseLegalHold(partition, id, releasedAt, principalId),
      () => ({
        outcome: "APPLIED",
        detail:
          `Legal hold "${id}" no longer preserves ${partition}. Records it was holding back ` +
          "become eligible for the retention plan from this instant.",
      }),
    )
  } catch (err) {
    if (err instanceof AuditUnavailable) return { error: err.message }
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return { error: `Hold "${id}" has already been released. A release is written once.` }
    }
    throw err
  }

  revalidatePath("/platform/audit")
  return { message: `Legal hold "${id}" released.` }
}
