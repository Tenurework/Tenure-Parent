import { requirementFor } from "./assurance"
import { decide, type AuthorizationRequest, type AuthorizationWorld, type Decision } from "./decide"
import type { ISODate } from "./model"
import { relationshipProblems } from "./relationships"

/**
 * GE-051-004 — one place decisions are made, and one rule for when a remembered
 * one stops being true.
 *
 * Bible §9.2: "Authorization is centralized as a service boundary." What that
 * buys is not tidiness. It is that when the rule changes there is one place to
 * change it, and when somebody asks "why was this allowed on Tuesday" there is
 * one thing that knows.
 *
 * ## Caching a decision is dangerous, and that is the interesting part
 *
 * Authority in this platform is computed from the clock rather than stored — a
 * grant that ends at noon confers nothing at 12:00:01, with no revocation job
 * and nothing to forget to run. A cache is the one thing that can undo that: a
 * decision remembered at 11:59 is a stored grant with a different name.
 *
 * So a cached decision carries **the instant at which it could change**, and
 * that instant is computed from the facts the decision actually rested on:
 * every effective-date boundary in front of it, and the moment the session's
 * assurance goes stale. Never a fixed TTL. A TTL is a guess about how long the
 * world stays still, and this world has exact answers.
 *
 * The horizon is deliberately **conservative**: it takes the earliest boundary
 * among the relevant facts, whether or not that boundary would have changed the
 * answer. Working out which boundaries actually matter is the same reasoning as
 * the decision itself, done twice, and the second copy is the one that goes
 * wrong quietly.
 */

/**
 * The revision of everything a decision was made under.
 *
 * Policies, role definitions and assurance requirements are configuration. When
 * any of it changes, every remembered decision made under the old version is
 * void — not stale, void, because the rule it applied no longer exists.
 *
 * An opaque string rather than a number: it is compared for equality and never
 * ordered, and a number invites somebody to write `>=`.
 */
export interface PolicyRevision {
  id: string
  recordedAt: ISODate
}

export interface CachedDecision {
  decision: Decision
  /** The revision this was decided under. */
  revision: string
  /** The instant it stops being trustworthy. */
  validUntil: ISODate | null
}

export interface DecisionCache {
  get(key: string): CachedDecision | undefined
  set(key: string, value: CachedDecision): void
  /** Everything, because a revision change voids everything. */
  clear(): void
  readonly size: number
}

/**
 * A bounded in-memory cache.
 *
 * Bounded because an unbounded one keyed by principal × permission × resource
 * is a memory leak with a hit rate. Oldest-inserted is evicted first: a
 * least-recently-used policy would keep whichever entry a loop happens to touch,
 * which on an authorization cache means the hottest principal never expires.
 */
export function memoryCache(maxEntries = 5000): DecisionCache {
  const entries = new Map<string, CachedDecision>()
  return {
    get: (key) => entries.get(key),
    set(key, value) {
      // Delete first so a re-set moves the key to the end of the insertion
      // order; without it a refreshed entry keeps its original eviction slot
      // and is thrown away while still valid.
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size
    },
  }
}

/**
 * The key.
 *
 * Includes the resource *and* its owning unit, because scope is checked against
 * the unit: two resources in different units are different questions with the
 * same permission. The session's assurance level is in it too — the same
 * request from a stepped-up session and an ordinary one are different
 * questions, and sharing a key between them is how a step-up requirement is
 * satisfied once and then never again.
 */
export function decisionKey(request: AuthorizationRequest): string {
  return [
    request.tenantId,
    request.principalId,
    request.permission,
    request.resource?.id ?? "-",
    request.resource?.orgUnitId ?? "-",
    request.resource?.createdByPrincipalId ?? "-",
    request.session?.level ?? "-",
    request.session?.establishedAt ?? "-",
  ].join("|")
}

const parse = (iso: ISODate | null | undefined): number | null => {
  if (iso == null) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * The instant this decision could change, or `null` if nothing bounds it.
 *
 * Every dated fact about this principal in this tenant contributes its next
 * boundary — a membership that ends, a grant that starts or ends, a delegation,
 * a relationship. Assurance contributes the moment the session's level goes
 * stale.
 *
 * A fact whose date cannot be read contributes nothing, which is the unsafe
 * direction. That is why `relationshipProblems` runs here as well: an
 * unreadable window is a malformed relationship, and a malformed relationship
 * is already refused by the decision itself.
 */
export function validUntil(
  world: AuthorizationWorld,
  request: AuthorizationRequest,
): ISODate | null {
  const now = parse(request.at)
  if (now === null) return null

  const boundaries: number[] = []
  const consider = (iso: ISODate | null | undefined) => {
    const t = parse(iso)
    if (t !== null && t > now) boundaries.push(t)
  }

  for (const m of world.memberships) {
    if (m.principalId !== request.principalId || m.tenantId !== request.tenantId) continue
    consider(m.effectiveFrom)
    consider(m.effectiveTo)
  }
  for (const g of world.grants) {
    if (g.principalId !== request.principalId || g.tenantId !== request.tenantId) continue
    consider(g.effectiveFrom)
    consider(g.effectiveTo)
  }
  for (const d of world.delegations ?? []) {
    if (d.tenantId !== request.tenantId) continue
    // Both directions: a delegation *to* this principal can start or end, and
    // one *from* them changes what they can lend, which changes nothing here —
    // but a delegation they hold from somebody else is what they are using.
    if (d.toPrincipalId !== request.principalId && d.fromPrincipalId !== request.principalId) {
      continue
    }
    consider(d.effectiveFrom)
    consider(d.effectiveTo)
  }
  for (const r of world.relationships ?? []) {
    if (r.fromPrincipalId !== request.principalId || r.tenantId !== request.tenantId) continue
    if (relationshipProblems(r).length > 0) continue
    consider(r.effectiveFrom)
    consider(r.effectiveTo)
  }

  const requirement = requirementFor(world.assuranceRequirements, request.permission)
  if (requirement?.maxAgeSeconds != null && request.session) {
    const established = parse(request.session.establishedAt)
    if (established !== null) consider(new Date(established + requirement.maxAgeSeconds * 1000).toISOString())
  }

  if (boundaries.length === 0) return null
  return new Date(Math.min(...boundaries)).toISOString()
}

export interface AuthorizationServiceOptions {
  /** Builds the facts for a request. Called on a miss, never on a hit. */
  worldFor: (request: AuthorizationRequest) => AuthorizationWorld
  /** The revision the current configuration is at. Read on every call. */
  revision: () => PolicyRevision
  cache?: DecisionCache
}

export interface ServiceDecision extends Decision {
  /** The revision it was decided under. Recorded so an audit can be replayed. */
  revision: string
  /** When it stops being trustworthy. */
  validUntil: ISODate | null
  /** Whether this came from the cache. For metrics and for tests. */
  cached: boolean
}

export interface AuthorizationService {
  authorize(request: AuthorizationRequest): ServiceDecision
  /** Drop everything. Called when configuration changes out of band. */
  invalidate(): void
  readonly cacheSize: number
}

/**
 * The service boundary.
 *
 * `revision()` is read on **every** call, not at construction. A service that
 * captured the revision once would keep answering under the old rules until
 * something restarted it, which is the failure this exists to prevent: an
 * emergency deny that does not take effect.
 */
export function authorizationService(
  options: AuthorizationServiceOptions,
): AuthorizationService {
  const cache = options.cache ?? memoryCache()
  let lastRevision: string | null = null

  return {
    authorize(request) {
      const revision = options.revision()

      if (lastRevision !== null && lastRevision !== revision.id) {
        // Void, not stale. The rule a remembered decision applied no longer
        // exists, and there is no version of it worth keeping.
        cache.clear()
      }
      lastRevision = revision.id

      const key = decisionKey(request)
      const hit = cache.get(key)
      if (hit && hit.revision === revision.id && stillValid(hit, request.at)) {
        return { ...hit.decision, revision: hit.revision, validUntil: hit.validUntil, cached: true }
      }

      const world = options.worldFor(request)
      const decision = decide(world, request)
      const horizon = validUntil(world, request)

      // A denial is cached like an allowance. Not caching denials sounds
      // cautious and is the opposite: an unauthorized caller in a retry loop
      // then costs a full world build every attempt, which is a denial-of-
      // service the authorization layer performs on itself.
      cache.set(key, { decision, revision: revision.id, validUntil: horizon })

      return { ...decision, revision: revision.id, validUntil: horizon, cached: false }
    },
    invalidate() {
      cache.clear()
    },
    get cacheSize() {
      return cache.size
    },
  }
}

function stillValid(entry: CachedDecision, at: ISODate): boolean {
  if (entry.validUntil === null) return true
  const until = parse(entry.validUntil)
  const now = parse(at)
  if (until === null || now === null) return false
  // Half-open, like every other window here: an entry valid until noon is not
  // valid at noon.
  return now < until
}
