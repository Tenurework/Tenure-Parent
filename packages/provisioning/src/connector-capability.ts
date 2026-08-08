/**
 * WRK-000-002 — the classification the Bible actually asks for.
 *
 * "Classify each exact provider/product/capability/direction as `PLANNED`,
 * `DEVELOPMENT`, `CERTIFICATION_PENDING`, `AVAILABLE`, `DEGRADED`, `SUSPENDED`,
 * or `UNSUPPORTED` with evidence." Three parts of that sentence were missing
 * and each one mattered:
 *
 *   * **the vocabulary** — `CatalogLifecycle` is DRAFT/SUBMITTED/CERTIFIED/…,
 *     which is a publishing pipeline. It has no way to say `DEGRADED`, and
 *     "this connector is up but its delta sync is broken" is the single most
 *     common true statement about a workspace integration.
 *   * **the subject** — lifecycle is carried on a whole `CatalogEntry`. A
 *     Microsoft pack is not one fact: Outlook mail read can be `AVAILABLE`
 *     while calendar write is `CERTIFICATION_PENDING` and Teams is `PLANNED`.
 *     One word over the whole artifact is a word that is wrong about most of it.
 *   * **the direction** — read and write are separately certifiable and
 *     separately dangerous. A pack certified to read a mailbox has not been
 *     certified to send from it.
 *
 * ## Evidence, and the two ways a status lies
 *
 * A status is a claim, and `capabilityProblems` refuses the two claims that are
 * false by construction rather than by accident.
 *
 * The first: `AVAILABLE` or `DEGRADED` with no `evidenceRefs`. Both of those
 * say the capability runs against a real provider today, and a claim nobody can
 * retrace is an assertion — the same rule `certificationState` applies to a
 * certification record, called here rather than copied so there is one place to
 * change it. The other five states legitimately cite nothing: nobody has to
 * prove they have not built something.
 *
 * The second, and the reason this file exists at all: a status that disagrees
 * with the artifact it sits on. An `AVAILABLE` capability on an entry the
 * catalog gate calls `uncertified` is a green row on a console for a connector
 * the platform refuses to offer. That is the "false Available claim" the whole
 * WRK-000 section is written about, and it cannot be caught by looking at
 * either half alone.
 *
 * ## WRK-100-004 — the third way, and the one a happy path passes
 *
 * Those two checks are "somebody cited something" plus "the artifact gate
 * agrees". One citation of any kind satisfies the first, so a pack citing a
 * single smoke run passed the same gate as one that had been driven through
 * golden, negative, volume and failure suites. WRK-100-004 is titled "prove
 * every available secondary pack against the FULL certification contract, not a
 * generic happy path", and a list nobody enumerated is not a contract.
 *
 * `CERTIFICATION_CLAUSES` enumerates it: the eight things the Bible requires a
 * pack to have been driven through before it may say `AVAILABLE`. Evidence is
 * therefore a `Record` keyed on that list rather than a flat array, which is the
 * whole point of the shape — a missing clause is a missing KEY the compiler
 * names at every construction site, where a short array is something nobody
 * counts.
 *
 * And per direction, because the note above is not decoration: a pack certified
 * to READ a mailbox has not been certified to SEND from it, so every `ref`
 * records which direction the run exercised and a `bidirectional` capability has
 * to cite both. A write pack that cites only read evidence is precisely the
 * claim this section exists to refuse, and before this nothing looked.
 */

/**
 * The eight clauses a capability is certified against, named once.
 *
 * Transcribed from what the Bible actually asks for rather than invented here:
 * WRK-130-003 requires "provider-specific golden/negative/volume/failure
 * suites"; §7 requires throttling, deprecation and outage behaviour to be
 * exercised rather than assumed; §180 requires per-object tombstones, etags and
 * deleted timestamps to be observed propagating; §5 requires ACL changes to
 * reach the index; and §4 requires the scope set to be exactly the one the
 * provider approved.
 *
 * `as const` so the type below is the list, not a parallel union somebody has
 * to remember to extend. Deleting an entry is a visible edit to the one array
 * every construction site is keyed on, which is what makes the count assertion
 * in `catalogs.test.ts` load-bearing rather than decorative.
 */
export const CERTIFICATION_CLAUSES = [
  /** The provider's documented happy path, against the real API. */
  "golden",
  /** Malformed input, wrong ids, forbidden objects — refused, not crashed. */
  "negative",
  /** Enough objects and pages that cursors, batching and timeouts are real. */
  "volume",
  /** The provider is down, or slow, or lying. Recovery is observed. */
  "failure-outage",
  /** 429s, Retry-After, and an API version being deprecated under us. */
  "throttling-and-deprecation",
  /** A delete at the provider stops the object being reachable here. */
  "deletion-propagation",
  /** A permission change at the provider stops the object being reachable here. */
  "acl-change-propagation",
  /** The scopes asked for are exactly the scopes the capability needs. */
  "scope-exactness",
] as const

export type CertificationClause = (typeof CERTIFICATION_CLAUSES)[number]

/**
 * A direction a certification run actually exercised.
 *
 * Narrower than `CapabilityDirection` on purpose: `bidirectional` is a claim
 * about a capability, never about a test run. A run either read or wrote.
 */
export type CertifiedDirection = "read" | "write"

/**
 * One thing a reader can go and open, and which direction it proves.
 *
 * The direction is on the ref rather than inferred from the capability, because
 * inferring it is the bug: a `bidirectional` capability carrying four read runs
 * would otherwise look identically proven to one carrying two of each.
 */
export interface EvidenceRef {
  direction: CertifiedDirection
  /** A path, a review record, a test-run id. By reference, never inline. */
  ref: string
}

/** Every clause, each with what proved it. Every key required — see the header. */
export type ClauseEvidence = Readonly<Record<CertificationClause, readonly EvidenceRef[]>>

/**
 * Nothing cited, for every clause.
 *
 * The honest evidence of a `PLANNED` capability, written once rather than eight
 * empty arrays per row. Frozen because it is shared by every planned pack and a
 * mutation to it would silently evidence twenty-four of them.
 *
 * Spelled out rather than derived from `CERTIFICATION_CLAUSES` by
 * `Object.fromEntries`: that loses the key types and needs a cast, and a cast is
 * exactly where a ninth clause would fail to arrive here. Written this way, the
 * annotation makes the compiler name this constant the moment the list grows.
 */
export const NO_EVIDENCE: ClauseEvidence = Object.freeze({
  golden: Object.freeze([]),
  negative: Object.freeze([]),
  volume: Object.freeze([]),
  "failure-outage": Object.freeze([]),
  "throttling-and-deprecation": Object.freeze([]),
  "deletion-propagation": Object.freeze([]),
  "acl-change-propagation": Object.freeze([]),
  "scope-exactness": Object.freeze([]),
})

/**
 * Every ref cited under any clause, flattened, in clause order.
 *
 * The rendering shape, derived rather than stored: the System Studio prints one
 * "Evidence" cell per capability row, and a second stored field it could print
 * instead is a second answer to "what proved this" that drifts from the first.
 */
export function evidenceRefsOf(evidence: ClauseEvidence): readonly string[] {
  return CERTIFICATION_CLAUSES.flatMap((clause) => evidence[clause].map((e) => e.ref))
}

/**
 * The directions a capability's claim covers, and therefore must prove.
 *
 * `bidirectional` is two claims wearing one word, which is why it expands here
 * rather than at each call site that would otherwise have to remember.
 */
export function certifiedDirections(
  direction: CapabilityDirection,
): readonly CertifiedDirection[] {
  return direction === "bidirectional" ? ["read", "write"] : [direction]
}

/**
 * Whether a claim names what it covers and cites what proved it.
 *
 * ONE implementation, two callers: `certificationState` in `catalogs.ts` treats
 * a certification record failing this as `absent`, and `capabilityProblems`
 * below treats a running-status capability failing it as unevidenced. They were
 * about to be the same three-token expression written twice, and the copy that
 * drifts is whichever nobody is looking at.
 *
 * It lives here rather than in `catalogs.ts` only so the dependency runs one
 * way — `catalogs.ts` imports this module, and this module imports nothing.
 */
export function claimIsUnproven(
  scope: readonly string[],
  evidenceRefs: readonly string[],
): boolean {
  return scope.length === 0 || evidenceRefs.length === 0
}

export type ConnectorCapabilityStatus =
  /** Intended. Nobody has started. */
  | "PLANNED"
  /** Being built. Not offered to anyone. */
  | "DEVELOPMENT"
  /** Built, and waiting on certification. Still not offered. */
  | "CERTIFICATION_PENDING"
  /** Certified and running. The only status that is a promise. */
  | "AVAILABLE"
  /** Running, and not fully: partial coverage, stale data, reduced rate. */
  | "DEGRADED"
  /** Deliberately switched off — an incident, a provider dispute, a recall. */
  | "SUSPENDED"
  /** Will not be built, or has been withdrawn. */
  | "UNSUPPORTED"

/**
 * Which way data moves for this capability.
 *
 * Separate from the capability name because "read a calendar" and "write a
 * calendar" are separately reviewed by the provider, separately scoped, and
 * separately catastrophic.
 */
export type CapabilityDirection = "read" | "write" | "bidirectional"

export interface ConnectorCapability {
  /** The vendor. `microsoft`, `google`, `anthropic`. */
  provider: string
  /** The product inside that vendor. `outlook-mail`, `drive`, `messages-api`. */
  product: string
  /** The operation. `message.list`, `event.create`, `completion`. */
  capability: string
  direction: CapabilityDirection
  status: ConnectorCapabilityStatus
  /**
   * What proves the status, per certification clause and per direction.
   *
   * A `Record` rather than a list, so a clause nobody ran is a key the compiler
   * points at rather than a short array nobody counts — WRK-100-004, and the
   * header explains why one citation of any kind used to be enough. Required
   * for `AVAILABLE` and `DEGRADED`, clause by clause; everything else may
   * legitimately cite nothing and `NO_EVIDENCE` is that state written once.
   */
  clauseEvidence: ClauseEvidence
}

/** The tuple, as one string. The identity of a row on an operator console. */
export function capabilityKey(c: ConnectorCapability): string {
  return `${c.provider}/${c.product}/${c.capability}/${c.direction}`
}

export interface CapabilityProblem {
  capability: string
  reason: "evidence-missing" | "disagrees-with-artifact" | "clause-unproven"
  detail: string
  /** Set on `clause-unproven`, so a console can say which suite is missing. */
  clause?: CertificationClause
  /** Set on `clause-unproven`. Read and write are separately certifiable. */
  direction?: CertifiedDirection
}

/**
 * What is wrong with a capability's classification, given the artifact-level
 * verdict for the entry that carries it.
 *
 * Takes the verdict rather than recomputing one: the artifact gate already
 * decided, with a scope and an instant, and a second evaluation here would be a
 * second answer to one question. `usable`/`reason` is the shape both
 * `UsabilityVerdict` and a `marketplace-closed` decision have, so a third-party
 * connector behind the closed marketplace is checked the same way.
 */
export function capabilityProblems(
  capability: ConnectorCapability,
  artifact: { usable: boolean; reason: string },
): readonly CapabilityProblem[] {
  const problems: CapabilityProblem[] = []
  const key = capabilityKey(capability)
  const claimsToRun = capability.status === "AVAILABLE" || capability.status === "DEGRADED"

  if (claimsToRun) {
    // The same predicate the certification gate uses. The scope is the tuple
    // itself, which is never empty, so what this actually tests here is the
    // evidence — and it tests it through the one implementation rather than a
    // copy that can drift from it.
    if (claimIsUnproven([key], evidenceRefsOf(capability.clauseEvidence))) {
      problems.push({
        capability: key,
        reason: "evidence-missing",
        detail:
          `${capability.status} says this runs against the provider today, and nothing is cited ` +
          `that a reader could go and check. A claim nobody can retrace is an assertion.`,
      })
    }

    // WRK-100-004. The full contract, clause by clause and direction by
    // direction. Kept beneath `evidence-missing` rather than replacing it: an
    // entirely uncited capability is a different mistake from one that ran the
    // golden suite and stopped, and an operator reading eight identical clause
    // findings would not learn that nobody cited anything at all.
    //
    // `claimIsUnproven` again — the one implementation, called a third time
    // rather than copied. The scope names the clause and the direction, so what
    // it tests here is once more the evidence.
    for (const clause of CERTIFICATION_CLAUSES) {
      for (const direction of certifiedDirections(capability.direction)) {
        const cited = capability.clauseEvidence[clause]
          .filter((e) => e.direction === direction)
          .map((e) => e.ref)
        if (!claimIsUnproven([`${key}#${clause}:${direction}`], cited)) continue
        problems.push({
          capability: key,
          reason: "clause-unproven",
          clause,
          direction,
          detail:
            `${capability.status} claims the full certification contract, and the ${clause} ` +
            `clause cites nothing for the ${direction} direction. A pack that ran one smoke ` +
            `test would otherwise pass the same gate as one driven through golden, negative, ` +
            `volume and failure suites — and a pack certified to read has not been certified ` +
            `to write.`,
        })
      }
    }

    if (!artifact.usable) {
      problems.push({
        capability: key,
        reason: "disagrees-with-artifact",
        detail:
          `${capability.status} claims this capability is offered, and the catalog gate refuses ` +
          `the connector carrying it: ${artifact.reason}. A console showing both would show a ` +
          `green row for something the platform will not hand to a tenant.`,
      })
    }
  }

  return problems
}

/** A capability with the problems found in its classification. */
export interface ClassifiedCapability extends ConnectorCapability {
  problems: readonly CapabilityProblem[]
  /**
   * Every ref cited under any clause, flattened — the shape a console prints.
   *
   * Computed here rather than stored on `ConnectorCapability`, so there is one
   * place evidence is written down and one derivation from it. A stored flat
   * copy beside the clause map is two answers to "what proved this", and the
   * copy that drifts is whichever nobody is looking at.
   */
  evidenceRefs: readonly string[]
}

export function classifyCapabilities(
  capabilities: readonly ConnectorCapability[],
  artifact: { usable: boolean; reason: string },
): readonly ClassifiedCapability[] {
  return capabilities.map((c) => ({
    ...c,
    problems: capabilityProblems(c, artifact),
    evidenceRefs: evidenceRefsOf(c.clauseEvidence),
  }))
}
