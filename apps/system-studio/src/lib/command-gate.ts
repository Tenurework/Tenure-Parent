import "server-only"

import { createHash } from "node:crypto"

import {
  ContractViolation,
  parseCommand,
  replayable,
  type Command,
  type IdempotencyRecord,
} from "@tenure/contracts"
import { approvalFor, fromMinorUnits, toDecimal, type ApprovalLevel } from "@tenure/finops"

import { authorizeCommand, decisionLine, type StudioCommand } from "./authorize"
import { claimIdempotency, type StoredIdempotencyClaim } from "./registry"

/**
 * STUDIO-060-002 — everything that must be true at EXECUTION time, in one
 * place, in front of every mutating path.
 *
 * ## What was already there, and what was not
 *
 * Authentication was re-checked inside the action, separation of duties was
 * enforced by the lifecycle engine, and optimistic concurrency existed on the
 * tenant's STATE row. Absent — and it is the absent half that matters for a
 * mutating control plane:
 *
 *   * **No expected version.** Nothing compared the manifest an approver read
 *     against the one that executed. `advanceState` recomputed the step from
 *     whatever `getTenant` returned at the moment it ran, so an approval given
 *     against one plan could execute a different one.
 *   * **No idempotency of any kind.** A double-submit produced a second real
 *     attempt, or a `TransactionCanceledException` reported as "this tenant
 *     moved while the page was open" — which is a race message, not idempotency.
 *   * **No budget assessment.** `approvalFor` and `previewPlanCost` were
 *     published and computable and had no caller; the ledger says so at
 *     `system-studio-aws-control-plane-execution-ledger.md:211-214`.
 *
 * The contract to enforce against already existed and the Studio did not use
 * it: `@tenure/contracts` defines `Command` with `expectedVersion` and
 * `idempotencyKey` BOTH REQUIRED (`packages/contracts/src/index.ts:215`),
 * `IdempotencyRecord` (`:573`) and `replayable` (`:611`). Its only caller in
 * the repository was `apps/web/src/lib/commands/bus.ts`, which this app may not
 * import — `tests/security/operator-plane-content.test.mjs` forbids depending
 * on the cell app. So this is a second construction site for the same contract,
 * not a second contract.
 *
 * ## Order, and why the claim is last
 *
 * parse → operator → semantic authorization → expected version → budget →
 * idempotency claim.
 *
 * The claim is written after the refusals rather than before them, deliberately.
 * A key burned by a command that was going to be refused anyway turns the
 * operator's corrected retry into an `idempotency-conflict` — the digest
 * changed, so it is not a replay — and they would be told their fix collided
 * with their mistake. Concurrency is still safe: the claim is a conditional
 * write, so two identical valid submissions race at the database and exactly
 * one proceeds.
 *
 * ## Honest gap
 *
 * There is no step-up check here. STUDIO-020-008 is not implemented anywhere in
 * this repository — a grep for `step-up` over `apps/system-studio/src` returns
 * nothing — and a call to a function that does not exist, or a boolean that
 * always says "stepped up", would be worse than the gap. It goes in when the
 * check exists, at the line marked below.
 */

export type RefusalCode =
  | "invalid-command"
  | "not-authorized"
  | "version-conflict"
  | "idempotency-conflict"
  | "approval-required"

export interface Refusal {
  code: RefusalCode
  detail: string
  /** So the HTTP face maps a refusal without maintaining a second table. */
  status: number
}

export interface Replay {
  operationId: string
  resultRef: string | null
  status: IdempotencyRecord["status"]
}

export type GateOutcome<P> =
  | {
      kind: "proceed"
      command: Command<P>
      /** The operation id this claim reserved. */
      operationId: string
      /** What the budget policy said, when the command carried an estimate. */
      approval: { level: ApprovalLevel; detail: string; amount: string } | null
    }
  | { kind: "replay"; command: Command<P>; replay: Replay }
  | { kind: "refused"; refusal: Refusal }

export interface GateChecks {
  /** The authenticated operator. */
  actor: string
  /**
   * The named command this is, from the Studio's own command table
   * (`STUDIO_COMMANDS` in `./authorize`). A name rather than a resource/verb
   * pair, so what a command is allowed to be stays reviewable in one screen.
   */
  command: StudioCommand
  /**
   * Where the target lives, when the target is somewhere.
   *
   * Passed through to `authorizeCommand`, which refuses an account or region
   * this control plane has no business in — so a tenant placed in another
   * region is refused by the gate rather than by the SDK.
   */
  placement?: { accountId?: string; region?: string; environment?: string }
  /**
   * The version and digest the target is at RIGHT NOW.
   *
   * `null` means the target does not exist. Returned by the caller rather than
   * read here, because "what is the current version of this thing" is a
   * question only the caller's own store can answer.
   */
  current: () => Promise<{ version: number; digest: string } | null>
  /**
   * The digest of the artifact the approver was shown.
   *
   * `expectedVersion` on its own catches a concurrent move; this catches a
   * SILENT one — the same version number over a manifest that has been
   * rewritten. Both are needed, and the contract only carries the first.
   */
  expectedDigest: string | null
  /**
   * A recurring monthly commitment this command makes, in whole minor units of
   * `currency` (cents for USD), or null when it commits to nothing new.
   */
  recurringMonthly: { minorUnits: number; currency: string; change: string } | null
  /** Who approved it, when anybody did. Cost bands above NONE require one. */
  approvedBy: string | null
  /** The operation id to reserve for this command. */
  operationId: string
  /** How long a claim stays replayable. */
  ttlHours?: number
}

/**
 * A stable digest of what was asked for.
 *
 * This is what makes an idempotency key safe. Without it, a client reusing a
 * key for a DIFFERENT request receives the first request's result and believes
 * the second succeeded — silent corruption. With it, that case is a conflict.
 *
 * The payload is serialised with sorted keys so that a caller that builds the
 * same request with its fields in a different order gets the same digest, and
 * a caller that changes a value does not.
 */
export function requestDigest(command: Command<unknown>): string {
  const canonical = stable({
    action: command.action,
    resourceType: command.resourceType,
    resourceId: command.resourceId,
    expectedVersion: command.expectedVersion,
    payload: command.payload,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`
}

const refuse = (code: RefusalCode, detail: string, status: number): GateOutcome<never> => ({
  kind: "refused",
  refusal: { code, detail, status },
})

export async function gate<P>(raw: unknown, checks: GateChecks): Promise<GateOutcome<P>> {
  // ── 1. The command itself ────────────────────────────────────────────────
  //
  // `parseCommand` enforces the semantic `Resource.Action` shape, a non-empty
  // idempotency key, and an EXPLICIT expectedVersion — refusing a missing one
  // rather than defaulting it. A default would be a value nobody chose being
  // recorded as though somebody had.
  let command: Command<P>
  try {
    command = parseCommand<P>(raw)
  } catch (err) {
    if (err instanceof ContractViolation) {
      return refuse("invalid-command", err.message, 400)
    }
    throw err
  }

  // ── 2. Who is asking ─────────────────────────────────────────────────────
  //
  // Semantic authorization (STUDIO-020-006), not the membership boolean.
  // `authorizeCommand` decides on all six axes — principal, role, resource,
  // action, tenant, and the account/region/environment the command targets —
  // and denies by default.
  const decision = authorizeCommand(checks.command, {
    principalId: checks.actor,
    tenantId: command.resourceId,
    ...checks.placement,
  })
  if (!decision.allowed) {
    return refuse(
      "not-authorized",
      // The reason and the policy that produced it. "Denied" alone cannot
      // answer the only question anyone asks about a denial, and the decision
      // line is the shape STUDIO-020-012 wants in an audit row.
      decisionLine(checks.actor, checks.command, decision),
      403,
    )
  }

  // STUDIO-020-008 — the step-up check goes here, once one exists. See the
  // honest gap in this module's header.

  // ── 3. What the approver was looking at ──────────────────────────────────
  const current = await checks.current()
  if (current === null) {
    return refuse("version-conflict", `No "${command.resourceId}" to act on.`, 404)
  }
  if (command.expectedVersion !== null && command.expectedVersion !== current.version) {
    return refuse(
      "version-conflict",
      `This was decided against version ${command.expectedVersion} and the target is at ` +
        `${current.version}. Something moved between the page rendering and this submission; ` +
        `reload and decide again against what is there now.`,
      409,
    )
  }
  if (checks.expectedDigest !== null && checks.expectedDigest !== current.digest) {
    return refuse(
      "version-conflict",
      `The artifact changed since it was reviewed (approved ${checks.expectedDigest}, current ` +
        `${current.digest}). An approval is for what was read, not for whatever is there when it runs.`,
      409,
    )
  }

  // ── 4. What it costs to say yes ──────────────────────────────────────────
  let approval: { level: ApprovalLevel; detail: string; amount: string } | null = null
  if (checks.recurringMonthly) {
    const estimated = fromMinorUnits(
      checks.recurringMonthly.minorUnits,
      checks.recurringMonthly.currency,
    )
    const band = approvalFor({ change: checks.recurringMonthly.change, estimated })
    approval = {
      level: band.level,
      detail: band.detail,
      amount: `${toDecimal(estimated, "half-up")} ${checks.recurringMonthly.currency}`,
    }
    // Assessed on RECURRING MONTHLY cost, not one-off price — a threshold
    // applied to the creation charge approves the annual one without anyone
    // seeing it (STUDIO-120-010).
    if (band.level !== "NONE" && !checks.approvedBy) {
      return refuse(
        "approval-required",
        `${band.detail} Estimated ${approval.amount} per month, which is the ${band.level} band. ` +
          `Record who approved it.`,
        403,
      )
    }
  }

  // ── 5. The claim ─────────────────────────────────────────────────────────
  const digest = requestDigest(command)
  const claim: StoredIdempotencyClaim = {
    key: command.idempotencyKey,
    tenantId: command.resourceId ?? command.resourceType,
    requestDigest: digest,
    status: "in-flight",
    resultRef: null,
    expiresAt: new Date(
      Date.parse(command.effectiveAt) + (checks.ttlHours ?? 24) * 3_600_000,
    ).toISOString(),
    operationId: checks.operationId,
  }

  const claimed = await claimIdempotency(claim.tenantId, claim)
  if (claimed.claimed) {
    return { kind: "proceed", command, operationId: checks.operationId, approval }
  }

  // Somebody got here first with this key. `replayable` decides whether that is
  // the same request — same key and same digest returns the stored result, same
  // key and a different digest is a conflict and NEVER a replay.
  const existing = claimed.existing
  try {
    replayable(
      {
        key: existing.key,
        tenantId: existing.tenantId,
        requestDigest: existing.requestDigest,
        status: existing.status,
        resultRef: existing.resultRef,
        expiresAt: existing.expiresAt,
      },
      digest,
    )
  } catch (err) {
    if (err instanceof ContractViolation) {
      return refuse(
        "idempotency-conflict",
        `${err.message} Use a new idempotency key for a different command.`,
        409,
      )
    }
    throw err
  }

  return {
    kind: "replay",
    command,
    replay: {
      operationId: existing.operationId,
      resultRef: existing.resultRef,
      status: existing.status,
    },
  }
}
