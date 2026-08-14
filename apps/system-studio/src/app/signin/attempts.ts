/**
 * The lock-out. STUDIO-030-006's `retrying` state, and the reason it is real.
 *
 * ── What this is defending ──────────────────────────────────────────────────
 *
 * One shared secret, presented at one unauthenticated endpoint, standing
 * between the internet and every tenant's configuration. `lib/operators.ts`
 * says so itself, in the message it prints when the secret is too short. A
 * secret with no rate limit in front of it is a secret that will be found by
 * whoever is willing to spend the requests, and nothing in this console counted
 * attempts before this file.
 *
 * ── Everything wrong with it, said plainly ──────────────────────────────────
 *
 * **It is in memory, so it is per instance.** Two tasks behind the load
 * balancer keep two counters and an attacker gets both budgets. The correct
 * home is a shared store — a DynamoDB item with a TTL, which this console
 * already has the client for. It is not that today because the registry table
 * belongs to another surface and a write path added to it from the
 * unauthenticated sign-in page is a bigger decision than a rate limiter should
 * make on its own. Two tasks halve the cost of an attack; they do not remove
 * the brake.
 *
 * **The key can be spoofed.** Behind CloudFront and an ALB the client address
 * arrives in `x-forwarded-for`, which any client can also simply write. The
 * leftmost entry is therefore attacker-controlled, and an attacker who varies
 * it gets a fresh budget per request. That is why what follows is a *brake* and
 * not a *gate*: it converts a naive spray into a slow one, and it does not
 * pretend to stop a determined one. The honest fix is a WAF rate rule on the
 * sign-in path, which `lib/aws/waf.ts` can already read and which
 * `infrastructure/` would have to declare.
 *
 * **There is deliberately no global lock.** A counter that locks the FORM
 * rather than the client would let any stranger take the console away from
 * Tenure's own staff with a hundred requests. Locking the abuser and leaving
 * everybody else able to sign in is the right side of that trade, even though
 * it is the side that can be evaded.
 *
 * ── Why the key is never the email ──────────────────────────────────────────
 *
 * This is the property that would otherwise undo the whole page. `page.tsx`
 * refuses a wrong address and a wrong secret with one sentence precisely so
 * that nobody can learn which addresses are Tenure staff. A lock-out keyed on
 * the submitted address would hand that back: lock `a@x`, then observe whether
 * `a@x` is now refused faster than `b@x`, and the allowlist is enumerable one
 * address at a time. So the address never enters a key, is never counted, and
 * is never stored. `signin.spec.ts` asserts that the store's own contents
 * contain no address after a refusal.
 */

/** Refusals a client may make before the first lock. */
export const FREE_ATTEMPTS = 5

/** How long a refusal is remembered. Idle this long and the count is gone. */
export const WINDOW_MS = 15 * 60_000

/** The first lock. Doubles with each further refusal. */
export const BASE_LOCK_MS = 15_000

/**
 * The ceiling. Fifteen minutes rather than "until an operator intervenes",
 * because an unbounded lock on a spoofable key is a self-inflicted outage
 * waiting for the day somebody's corporate NAT is the key.
 */
export const MAX_LOCK_MS = 15 * 60_000

/**
 * The most clients tracked at once.
 *
 * Without it, an attacker varying `x-forwarded-for` allocates one Map entry per
 * request and the brake becomes a memory-exhaustion primitive — the rate
 * limiter as the outage. At the cap the least recently seen entries are dropped
 * first, which is exactly the wrong entry to drop for an attacker rotating keys
 * and exactly the right one for a legitimate client that stopped attacking.
 */
export const MAX_TRACKED = 10_000

export interface Attempt {
  failures: number
  /** Epoch ms of the most recent refusal. Decides window expiry and eviction. */
  lastFailureAt: number
  /** Epoch ms before which no attempt is accepted. */
  lockedUntil: number
}

export type AttemptStore = Map<string, Attempt>

export interface LockVerdict {
  locked: boolean
  /** Epoch ms the lock lifts, or null when not locked. */
  retryAt: number | null
  failures: number
  /** Refusals left before the next lock. Zero while locked. */
  remaining: number
}

/**
 * How long a lock lasts after `n` refusals.
 *
 * Exponential from the first lock, capped. The shape matters more than the
 * numbers: the first mistake costs fifteen seconds, which a person who mistyped
 * will barely notice, and the twentieth costs a quarter of an hour, which makes
 * an online search for the secret cost more time than it is worth.
 */
export function lockDurationMs(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0
  const doublings = failures - FREE_ATTEMPTS - 1
  // `2 ** doublings` overflows into Infinity long before it matters; Math.min
  // handles that correctly and returns the cap.
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS)
}

/** The verdict for a key, without changing anything. */
export function verdictFor(store: AttemptStore, key: string, now: number): LockVerdict {
  const record = store.get(key)
  if (!record) return { locked: false, retryAt: null, failures: 0, remaining: FREE_ATTEMPTS }

  // An expired window is an absent record. Checked on read as well as on write
  // so a client that stops attacking is forgiven without needing another
  // request to sweep it.
  if (now - record.lastFailureAt >= WINDOW_MS) {
    return { locked: false, retryAt: null, failures: 0, remaining: FREE_ATTEMPTS }
  }

  if (record.lockedUntil > now) {
    return { locked: true, retryAt: record.lockedUntil, failures: record.failures, remaining: 0 }
  }

  return {
    locked: false,
    retryAt: null,
    failures: record.failures,
    remaining: Math.max(0, FREE_ATTEMPTS - record.failures),
  }
}

/** Record one refusal and return the verdict that follows it. */
export function recordFailure(store: AttemptStore, key: string, now: number): LockVerdict {
  prune(store, now)

  const existing = store.get(key)
  const fresh = !existing || now - existing.lastFailureAt >= WINDOW_MS
  const failures = (fresh ? 0 : existing.failures) + 1
  const duration = lockDurationMs(failures)

  store.set(key, {
    failures,
    lastFailureAt: now,
    lockedUntil: duration > 0 ? now + duration : 0,
  })

  return verdictFor(store, key, now)
}

/**
 * Forget a client.
 *
 * Called on a SUCCESSFUL sign-in, which is what stops an operator who mistyped
 * twice from carrying those two refusals for the next quarter of an hour. It is
 * also why the console's own end-to-end suite does not slowly lock itself out.
 */
export function clearKey(store: AttemptStore, key: string): void {
  store.delete(key)
}

/**
 * Drop expired records, then enforce the cap.
 *
 * Scoped to what this module created: it deletes from the store it was handed,
 * by keys it wrote, and it has no other reach.
 */
export function prune(store: AttemptStore, now: number): void {
  for (const [key, record] of store) {
    if (now - record.lastFailureAt >= WINDOW_MS && record.lockedUntil <= now) store.delete(key)
  }
  if (store.size < MAX_TRACKED) return

  // Map iterates in insertion order, and `recordFailure` re-`set`s a key it
  // already holds — which does NOT move it in that order. So oldest-first here
  // means "first seen", not "least recently seen"; both are bounded and the
  // difference only decides which entry an attacker at the cap displaces.
  const excess = store.size - MAX_TRACKED + 1
  let dropped = 0
  for (const key of store.keys()) {
    if (dropped >= excess) break
    store.delete(key)
    dropped += 1
  }
}

/**
 * The process-wide store.
 *
 * A module-scoped Map, and in development it is hung off `globalThis` because
 * Next's dev server re-evaluates a module on edit and a fresh Map on every save
 * would make the lock-out untestable by hand. `server-only` is deliberately NOT
 * imported: `signin.spec.ts` exercises this module directly at node level, and
 * the pure functions above are the whole of the logic — the singleton below is
 * the only part that has to run inside the server, and it touches nothing.
 */
const GLOBAL_KEY = "__tenureSignInAttempts"

type WithStore = typeof globalThis & { [GLOBAL_KEY]?: AttemptStore }

export function attemptStore(): AttemptStore {
  const holder = globalThis as WithStore
  if (!holder[GLOBAL_KEY]) holder[GLOBAL_KEY] = new Map()
  return holder[GLOBAL_KEY]
}

/**
 * Which client this is, from the request headers.
 *
 * Exported and pure so its behaviour is testable without a request. The
 * leftmost `x-forwarded-for` entry is the client as reported by the first proxy
 * that saw it; see the header comment for why "as reported" is the honest
 * wording. Everything with no forwarding header at all shares one bucket, which
 * is correct for a direct connection and is what the local harness uses.
 */
export function clientKeyFrom(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const real = get("x-real-ip")?.trim()
  if (real) return real
  return "direct"
}
