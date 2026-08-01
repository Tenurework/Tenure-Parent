import {
  ContractViolation,
  parseCommand,
  replayable,
  type Command,
  type ContractError,
  type IdempotencyRecord,
  type TenantContext,
} from "@tenure/contracts"

/**
 * GE-021-004 — the one door business writes go through.
 *
 * The `Command` contract already refuses a malformed command. A bus is what
 * makes it unavoidable: as long as a handler can be called directly, the
 * contract is a convention, and the call site that skips it is the one written
 * under time pressure at 5pm.
 *
 * Four things happen here and nowhere else, in this order:
 *
 *   1. the command is parsed — a value from a browser or a queue was never
 *      seen by the compiler that believed its type
 *   2. the idempotency key is claimed, so a retry cannot execute twice
 *   3. authorization is rechecked **now**, not at whatever point the caller
 *      last looked
 *   4. optimistic concurrency is enforced against `expectedVersion`
 *
 * ── Why authorization is rechecked here ─────────────────────────────────────
 *
 * A page renders, a person's seat is revoked, they click the button that was
 * already on screen. Checking at render time answers a question that was true
 * a minute ago. The Bible calls for an authorization recheck at execution and
 * this is where it lives, so no handler can be reached without one.
 */

export interface CommandPorts {
  /**
   * Claim the key, or return the existing record.
   *
   * Must be atomic — a read-then-write races and two concurrent retries both
   * see nothing and both execute, which is the exact failure the key exists to
   * prevent.
   */
  claimIdempotency(input: {
    key: string
    tenantId: string
    requestDigest: string
    expiresAt: string
  }): Promise<{ claimed: true } | { claimed: false; existing: IdempotencyRecord }>

  /** Record the outcome so a replay can return it. */
  completeIdempotency(key: string, tenantId: string, resultRef: string): Promise<void>

  /** Release the claim so a failure can be retried rather than being stuck in-flight. */
  releaseIdempotency(key: string, tenantId: string): Promise<void>

  /** Re-check at execution time. Not at render time, not at request start. */
  authorize(context: TenantContext, command: Command): Promise<{ allowed: boolean; reason: string | null }>

  /** Current version of the target, or null when it does not exist. */
  currentVersion(resourceType: string, resourceId: string): Promise<number | null>
}

export type CommandOutcome<R = unknown> =
  | { ok: true; result: R; resultRef: string; replayed: boolean }
  | { ok: false; error: ContractError }

export type Handler<R> = (command: Command, context: TenantContext) => Promise<{ result: R; resultRef: string }>

const error = (
  kind: ContractError["kind"],
  code: string,
  safeDetail: string,
  correlationId: string,
  retryable = false,
): ContractError => ({ kind, code, safeDetail, retryable, correlationId })

/**
 * Dispatch a command.
 *
 * Returns a `ContractError` rather than throwing for anything a caller can act
 * on. A thrown exception at this boundary loses the distinction between "your
 * request was wrong" and "we failed", and the caller needs it to decide whether
 * to retry.
 */
export async function dispatch<R>(
  raw: unknown,
  handler: Handler<R>,
  ports: CommandPorts,
  options: { requestDigest: string; idempotencyTtlMs?: number } = { requestDigest: "" },
): Promise<CommandOutcome<R>> {
  // 1. Parse. Do this before anything else touches the value.
  let command: Command
  try {
    command = parseCommand(raw)
  } catch (err) {
    const violation = err instanceof ContractViolation ? err : null
    return {
      ok: false,
      error: error(
        "validation",
        violation ? `contract.${violation.field}` : "contract.malformed",
        violation?.message ?? "The command did not parse.",
        // No context to read a correlation id from — the command did not parse.
        "unknown",
      ),
    }
  }

  const { context } = command
  const ttl = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.parse(context.at) + ttl).toISOString()

  // 2. Claim the key BEFORE authorizing or executing. Claiming after the work
  //    means two concurrent retries both do the work and one loses the race to
  //    record it — the work having already happened twice.
  const claim = await ports.claimIdempotency({
    key: command.idempotencyKey,
    tenantId: context.tenantId,
    requestDigest: options.requestDigest,
    expiresAt,
  })

  if (!claim.claimed) {
    // A key reused for a DIFFERENT request throws inside `replayable`, which is
    // correct: returning the earlier result would tell the caller something
    // untrue about a request that never ran.
    let canReplay: boolean
    try {
      canReplay = replayable(claim.existing, options.requestDigest)
    } catch {
      return {
        ok: false,
        error: error(
          "conflict",
          "idempotency.key-reused",
          "That idempotency key was used for a different request.",
          context.correlationId,
        ),
      }
    }

    if (canReplay) {
      return {
        ok: true,
        result: undefined as R,
        resultRef: claim.existing.resultRef!,
        replayed: true,
      }
    }

    return {
      ok: false,
      error: error(
        "conflict",
        "idempotency.in-flight",
        "An identical request is already running.",
        context.correlationId,
        // Retryable: the in-flight one will finish and the replay will succeed.
        true,
      ),
    }
  }

  try {
    // 3. Authorize now. A page rendered a minute ago; the seat may be gone.
    const decision = await ports.authorize(context, command)
    if (!decision.allowed) {
      await ports.releaseIdempotency(command.idempotencyKey, context.tenantId)
      return {
        ok: false,
        error: error(
          "forbidden",
          "authorization.denied",
          decision.reason ?? "Not permitted.",
          context.correlationId,
        ),
      }
    }

    // 4. Optimistic concurrency.
    const actual = await ports.currentVersion(command.resourceType, command.resourceId ?? "")

    if (command.expectedVersion === null) {
      // A create. The target must not already exist, or two people creating the
      // same thing both succeed and one silently overwrites.
      if (actual !== null) {
        await ports.releaseIdempotency(command.idempotencyKey, context.tenantId)
        return {
          ok: false,
          error: error(
            "conflict",
            "concurrency.already-exists",
            "That already exists.",
            context.correlationId,
          ),
        }
      }
    } else if (actual === null) {
      await ports.releaseIdempotency(command.idempotencyKey, context.tenantId)
      return {
        ok: false,
        error: error("not-found", "concurrency.missing", "That no longer exists.", context.correlationId),
      }
    } else if (actual !== command.expectedVersion) {
      await ports.releaseIdempotency(command.idempotencyKey, context.tenantId)
      return {
        ok: false,
        error: error(
          "conflict",
          "concurrency.version-mismatch",
          "This changed while you were working on it. Reload and try again.",
          context.correlationId,
        ),
      }
    }

    const { result, resultRef } = await handler(command, context)
    await ports.completeIdempotency(command.idempotencyKey, context.tenantId, resultRef)
    return { ok: true, result, resultRef, replayed: false }
  } catch (err) {
    // Release rather than leaving the key in-flight forever: a handler that
    // threw did not complete, and a key stuck in-flight makes the operation
    // permanently unretryable, which is worse than the original failure.
    await ports.releaseIdempotency(command.idempotencyKey, context.tenantId).catch(() => {})

    // The message is not returned. It may name a row, a column or another
    // tenant, and this string is rendered to a user.
    console.error(`[command] ${command.action} failed:`, err)
    return {
      ok: false,
      error: error(
        "internal",
        "handler.failed",
        "That did not complete. Nothing was changed.",
        context.correlationId,
        true,
      ),
    }
  }
}
