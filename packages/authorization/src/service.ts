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
 *
 * ## GE-053-006 — a revocation is not a date change
 *
 * The horizon above bounds a decision by the *dated* facts it rested on, and
 * that is the whole answer only while every way authority ends is a date. It is
 * not. Deleting a role assignment, ending a membership out of band, withdrawing
 * a delegation and rewriting a policy all remove authority without moving any
 * `effectiveTo` the cache has already read — so a decision taken a second before
 * the revocation carries `validUntil: null` and keeps answering ALLOW until it
 * is evicted for being old.
 *
 * `revision()` covers one half of that: configuration. It does not cover the
 * other half, which is the per-principal facts — this person's memberships,
 * grants and delegations — because bumping a global revision on every role
 * change would void every decision in the tenant to revoke one.
 *
 * So there is a second stamp, `subjectRevision()`, read on every call exactly as
 * `revision()` is, and folded into the cache key. A bumped stamp is therefore a
 * **structural miss** rather than a hoped-for eviction: the old entry is not
 * consulted because the key is not the key any more. And because a miss under a
 * new stamp also drops that principal's entries recorded under the old one, the
 * revocation reclaims the space instead of leaving dead entries to push live
 * ones out of a bounded cache.
 *
 * The stamp is supplied by the caller and is deliberately **not** defined here.
 * REVIEW-FINDINGS §14 is explicit that the platform's per-membership
 * `authz_version` fan-out "is never specified", so this package does not pretend
 * to read a column that no migration creates. What it does is refuse to make
 * revocation depend on a date: it names the seam, reads it on every call, and
 * fails to a stable stamp when no source is wired.
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
  /**
   * Drop one entry.
   *
   * Needed because a revocation is narrower than a revision change: it voids
   * one principal's remembered decisions and must leave every other principal's
   * alone. `clear()` on a role edit would be correct and useless — it turns
   * every revocation in the tenant into a full cold start.
   */
  delete(key: string): void
  /**
   * The keys currently held.
   *
   * A targeted invalidation has to be able to find its own entries, and the
   * only thing that identifies them is the key. Exposed as an iterable rather
   * than an array so an implementation backed by something other than a Map
   * does not have to materialise the whole keyspace.
   */
  keys(): Iterable<string>
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
    delete: (key) => {
      entries.delete(key)
    },
    keys: () => entries.keys(),
    get size() {
      return entries.size
    },
  }
}

const SEPARATOR = "|"

/**
 * One field of the key.
 *
 * Percent-encoded, which for this purpose means one thing: the separator cannot
 * appear inside a field. That is not tidiness — `invalidatePrincipal` finds a
 * principal's entries by matching the head of the key, so with raw fields a
 * principal literally called `dana|finance.budget.read` would sit under a key
 * indistinguishable from dana's, and revoking one would silently revoke or spare
 * the other depending on which way the prefix happened to fall. Encoding makes
 * the format injective, which is what makes prefix matching a fact rather than a
 * guess.
 */
const field = (value: string): string => encodeURIComponent(value)

/**
 * The head of every key for one principal in one tenant, separator included.
 *
 * **This is a documented, load-bearing part of the key format.** Every key
 * produced by `decisionKey` begins with it, no key for any other
 * (tenant, principal) pair does, and `invalidatePrincipal` relies on both halves
 * of that. Reordering `decisionKey`'s fields without changing this function
 * would turn targeted invalidation into a no-op that still returns a plausible
 * count, which is the failure mode worth being loud about.
 */
export function decisionKeyPrefix(tenantId: string, principalId: string): string {
  return `${field(tenantId)}${SEPARATOR}${field(principalId)}${SEPARATOR}`
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
 *
 * `subjectRevision` (GE-053-006) is the stamp on the principal's own authority
 * facts, and it sits immediately after the tenant/principal prefix so that a
 * prefix match finds a principal's entries under *every* stamp they have ever
 * held. Absent, it is a constant, and the key is what it always was plus one
 * fixed field: a service with no stamp source behaves exactly as before rather
 * than pretending to a protection it does not have.
 */
export function decisionKey(
  request: AuthorizationRequest,
  subjectRevision?: string | null,
): string {
  return (
    decisionKeyPrefix(request.tenantId, request.principalId) +
    [
      subjectRevision ?? "-",
      request.permission,
      request.resource?.id ?? "-",
      request.resource?.orgUnitId ?? "-",
      request.resource?.createdByPrincipalId ?? "-",
      request.session?.level ?? "-",
      request.session?.establishedAt ?? "-",
    ]
      .map(field)
      .join(SEPARATOR)
  )
}

/**
 * The subject stamp a key was recorded under, or `null` if the key is not this
 * principal's. The inverse of the field order documented above.
 */
function stampOf(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  const end = rest.indexOf(SEPARATOR)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Drop one principal's entries, optionally sparing those under one stamp.
 *
 * Keys are collected before anything is deleted. Deleting while iterating a Map
 * happens to be safe in JavaScript, but `DecisionCache` is an interface and the
 * next implementation of it is not obliged to be a Map.
 */
function dropPrincipal(cache: DecisionCache, prefix: string, spare: string | null): number {
  const doomed: string[] = []
  for (const key of cache.keys()) {
    const stamp = stampOf(key, prefix)
    if (stamp === null) continue
    if (spare !== null && stamp === spare) continue
    doomed.push(key)
  }
  for (const key of doomed) cache.delete(key)
  return doomed.length
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
  // Whose grants can change this answer: the requester's, and — when they are
  // borrowing — the grants of everyone lending to them.
  //
  // This used to be the requester's alone, and that is wrong for exactly the
  // case delegation exists for. `decide()` resolves a borrowed decision from the
  // DELEGATOR's grants (`matchesFor(d.fromPrincipalId)`), so the delegator's
  // window is a load-bearing input to the answer — but the borrower by
  // construction holds nothing, so the horizon came back `null` and the decision
  // was cached forever. Alice's grant ends at 13:00; Bob, delegated from Alice,
  // kept her authority at 23:00 and every hour after.
  //
  // That broke the promise this package makes twice in its own comments as the
  // reason delegation is safe — "revoking the delegator's role revokes the
  // delegate's borrowed authority in the same instant, with no second write."
  // The cache was the second write.
  const lenders = new Set([request.principalId])
  for (const d of world.delegations ?? []) {
    if (d.tenantId !== request.tenantId) continue
    if (d.toPrincipalId === request.principalId) lenders.add(d.fromPrincipalId)
  }
  for (const g of world.grants) {
    if (!lenders.has(g.principalId) || g.tenantId !== request.tenantId) continue
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
  /**
   * GE-053-006 — the stamp on this principal's own authority facts, read on
   * **every** call, hit or miss, exactly as `revision()` is.
   *
   * Any opaque string that changes when this principal's memberships, role
   * assignments or delegations change. It is compared for equality and never
   * ordered or parsed, so a monotonic counter, the `updatedAt` of the newest
   * row, or a hash of the set all work equally well.
   *
   * Omitting it is legal and leaves the cache bounded by dates and the global
   * revision alone — which is to say, blind to revocation. It is optional
   * because REVIEW-FINDINGS §14 records that the platform has no per-principal
   * stamp specified yet, and a required option nobody can satisfy would be
   * satisfied with a lie.
   */
  subjectRevision?: (request: AuthorizationRequest) => string
  cache?: DecisionCache
}

export interface ServiceDecision extends Decision {
  /** The revision it was decided under. Recorded so an audit can be replayed. */
  revision: string
  /**
   * The subject stamp it was decided under, or `null` if no source is wired.
   * Recorded for the same reason as `revision`: "why was this allowed on
   * Tuesday" is answerable only if the answer names every input.
   */
  subjectRevision: string | null
  /** When it stops being trustworthy. */
  validUntil: ISODate | null
  /** Whether this came from the cache. For metrics and for tests. */
  cached: boolean
}

export interface AuthorizationService {
  authorize(request: AuthorizationRequest): ServiceDecision
  /** Drop everything. Called when configuration changes out of band. */
  invalidate(): void
  /**
   * GE-053-006 — drop one principal's remembered decisions in this tenant, and
   * nobody else's. Returns how many entries went, so a caller that expected to
   * revoke something can tell it revoked nothing.
   *
   * The out-of-band door for a revocation that is known at the moment it
   * happens. The in-band one is `subjectRevision`, which needs no notification
   * to reach a machine that was not listening — this is the same eviction,
   * reached the other way.
   */
  invalidatePrincipal(tenantId: string, principalId: string): number
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

      // GE-053-006. Read on every call, hit or miss, for the same reason
      // `revision()` is: a stamp captured once is a revocation that never
      // arrives. It goes into the key rather than being compared against
      // something remembered, so a bumped stamp cannot be *missed* — the old
      // entry is not consulted, because its key is no longer the key.
      const stamp = options.subjectRevision?.(request) ?? null
      const key = decisionKey(request, stamp)
      const hit = cache.get(key)
      if (hit && hit.revision === revision.id && stillValid(hit, request.at)) {
        return {
          ...hit.decision,
          revision: hit.revision,
          subjectRevision: stamp,
          validUntil: hit.validUntil,
          cached: true,
        }
      }

      const world = options.worldFor(request)
      const decision = decide(world, request)
      const horizon = validUntil(world, request)

      if (stamp !== null) {
        // The entries this principal holds under any *other* stamp are dead:
        // their facts have been superseded and no future key will name them.
        // Leaving them to age out would be correct and still wrong — the cache
        // is bounded, so dead entries evict live ones, and a principal whose
        // roles change often would quietly starve everyone else's.
        //
        // Skipped entirely when no stamp source is wired: there is then exactly
        // one stamp in play, nothing is ever superseded, and this would be a
        // full scan of the cache on every miss to delete nothing.
        dropPrincipal(cache, decisionKeyPrefix(request.tenantId, request.principalId), stamp)
      }

      // A denial is cached like an allowance. Not caching denials sounds
      // cautious and is the opposite: an unauthorized caller in a retry loop
      // then costs a full world build every attempt, which is a denial-of-
      // service the authorization layer performs on itself.
      cache.set(key, { decision, revision: revision.id, validUntil: horizon })

      return {
        ...decision,
        revision: revision.id,
        subjectRevision: stamp,
        validUntil: horizon,
        cached: false,
      }
    },
    invalidate() {
      cache.clear()
    },
    invalidatePrincipal(tenantId, principalId) {
      return dropPrincipal(cache, decisionKeyPrefix(tenantId, principalId), null)
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
