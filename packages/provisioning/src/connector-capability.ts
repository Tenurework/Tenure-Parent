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
 */

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
   * What proves the status. Paths, review records, test runs — by reference.
   *
   * Required for `AVAILABLE` and `DEGRADED` and refused when empty; see the
   * header. Everything else may legitimately be empty.
   */
  evidenceRefs: readonly string[]
}

/** The tuple, as one string. The identity of a row on an operator console. */
export function capabilityKey(c: ConnectorCapability): string {
  return `${c.provider}/${c.product}/${c.capability}/${c.direction}`
}

export interface CapabilityProblem {
  capability: string
  reason: "evidence-missing" | "disagrees-with-artifact"
  detail: string
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
    if (claimIsUnproven([key], capability.evidenceRefs)) {
      problems.push({
        capability: key,
        reason: "evidence-missing",
        detail:
          `${capability.status} says this runs against the provider today, and nothing is cited ` +
          `that a reader could go and check. A claim nobody can retrace is an assertion.`,
      })
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
}

export function classifyCapabilities(
  capabilities: readonly ConnectorCapability[],
  artifact: { usable: boolean; reason: string },
): readonly ClassifiedCapability[] {
  return capabilities.map((c) => ({ ...c, problems: capabilityProblems(c, artifact) }))
}
