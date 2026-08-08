/**
 * STUDIO-030-006 — telling "the service asked us to slow down" apart from
 * "this read is broken".
 *
 * The tenants page catches everything `listTenants()` throws and renders one
 * `ErrorState` saying, in as many words, *"most likely: the task role is missing
 * an action on the table, or the table does not exist in this region"*. That
 * sentence is a good guess for a `ResourceNotFoundException` and a bad one for a
 * `ProvisionedThroughputExceededException`: the first is an IAM or a region
 * problem, and the second is a capacity problem that resolves itself in
 * milliseconds. Sending an operator to the IAM console because DynamoDB was busy
 * is not a cosmetic defect — it is twenty minutes spent looking at a policy that
 * was never wrong.
 *
 * So a read that fails is classified, and the two answers render as two states.
 *
 * ## This sits on top of the SDK's own retries, not instead of them
 *
 * `@aws-sdk/*` already retries a throttled request with backoff before it throws
 * (`maxAttempts`, three by default). What it cannot do is decide what a PAGE
 * should say once that budget is spent, and that is the part that was wrong. The
 * extra attempts here are deliberately few and deliberately cheap: this is a
 * server render with a person waiting, not a background job.
 *
 * ## No jitter, on purpose
 *
 * The usual reason for jitter is a thundering herd — many clients backing off in
 * lockstep and colliding again. There is one Studio process reading one registry
 * table on behalf of one operator at a time, so the herd does not exist, and a
 * schedule that changes run to run would make "how long until it tries again"
 * untestable. Deterministic, and stated rather than assumed.
 */

/**
 * The error names AWS uses to mean "slow down", across the services this
 * console reads.
 *
 * Names rather than status codes because the SDK surfaces the name and hides the
 * response. `InternalServerError` and `ServiceUnavailable` are in here for the
 * same reason the SDK treats them as retryable: they are transient by
 * definition, and telling an operator to check their IAM policy because
 * DynamoDB had a bad second is the same wrong answer as for a throttle.
 */
export const TRANSIENT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ThrottlingException",
  "Throttling",
  "ThrottledException",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "TooManyRequestsException",
  "LimitExceededException",
  "ServiceUnavailable",
  "InternalServerError",
  "TransactionInProgressException",
])

/** Whether the service asked us to try again rather than reporting a fault. */
export function isTransient(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return typeof name === "string" && TRANSIENT_ERROR_NAMES.has(name)
}

/** How many times a read is attempted before the page reports it. */
export const READ_ATTEMPTS = 3

/**
 * How long to wait before attempt `n`. 1-based, so `backoffMs(2)` is the pause
 * after the first failure.
 *
 * Exponential from 200ms. `backoffMs(1)` is zero because the first attempt is
 * not a retry.
 */
export function backoffMs(attempt: number): number {
  return attempt <= 1 ? 0 : 200 * 2 ** (attempt - 2)
}

export type ReadOutcome<T> =
  | { state: "ok"; value: T }
  /**
   * Transient, and still transient after the budget. Not an error: the right
   * response is to wait and look again, which is what `nextAttemptAt` is for.
   */
  | { state: "retrying"; attempt: number; of: number; nextAttemptAt: string; why: string }
  /** Something is actually wrong, and the message is the operator's only lead. */
  | { state: "failed"; why: string }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Run a read, retrying only what is worth retrying.
 *
 * `read` is the real function — `listTenants` on the tenants page — passed in
 * rather than imported so this module holds no AWS client and no knowledge of
 * the registry. That is not indirection for its own sake: `forbidden-clients`
 * permits exactly one module in this app to touch the SDK.
 *
 * `now` and `wait` are injectable so a test can assert the SCHEDULE rather than
 * spend it. They default to the real clock and a real sleep, so the production
 * call site passes neither and cannot accidentally get a fake one.
 */
export async function readWithBackoff<T>(
  read: () => Promise<T>,
  options: {
    attempts?: number
    now?: () => number
    wait?: (ms: number) => Promise<void>
  } = {},
): Promise<ReadOutcome<T>> {
  const attempts = options.attempts ?? READ_ATTEMPTS
  const now = options.now ?? Date.now
  const wait = options.wait ?? sleep

  let last: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await wait(backoffMs(attempt))
    try {
      return { state: "ok", value: await read() }
    } catch (err) {
      last = err
      // A fault does not get a second attempt. Retrying a missing table three
      // times makes the page slower and the answer no better.
      if (!isTransient(err)) {
        return { state: "failed", why: describe(err) }
      }
    }
  }

  return {
    state: "retrying",
    attempt: attempts,
    of: attempts,
    // The moment the NEXT attempt would run if the budget had one more in it.
    // That is what an operator needs in order to decide whether to wait: the
    // number is the schedule's, not a guess.
    nextAttemptAt: new Date(now() + backoffMs(attempts + 1)).toISOString(),
    why: describe(last),
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}
