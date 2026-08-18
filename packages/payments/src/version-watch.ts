import {
  PAYMENT_CAPABILITIES,
  STATES_REQUIRING_APPROVAL,
  providerApiCompatibility,
  type CapabilityState,
  type PaymentCapability,
} from "./capability-registry"
import {
  PROVIDER,
  PROVIDER_API_VERSION,
  SUPPORTED_EVENT_TYPES,
  normalizeProviderApiVersion,
} from "./api-version"
import { PAYMENTS_OPERATIONS_QUEUE } from "./refusal"

/**
 * PAY-010-007 — a provider version and feature watch that raises work, and
 * cannot perform any.
 *
 * Bible §16 asks for API versions to be pinned and "intentionally" upgraded,
 * and Bible §3's last line refuses availability inferred from a provider's
 * marketing. Put together they describe a watch process with one hard property:
 * seeing a change must produce a REVIEW TASK and never a production mutation.
 *
 * The failure mode this exists against is not laziness, it is helpfulness. A
 * watcher that notices the provider has moved to a newer API version and
 * "keeps the registry in step" has just certified thirty leaves against a
 * schema nobody read, and it will have done it at 3am on a schedule with no
 * approver in the loop.
 *
 * So everything here is a pure function over the registry. There is no writer
 * in this module, nothing it calls has one, and `capability-registry.ts`
 * enforces the other half: a leaf whose reviewed API window does not cover the
 * running pin resolves to `UNSUPPORTED` rather than keeping its stored state,
 * so the DEFAULT behaviour of a version change is withdrawal, not carry-forward.
 * The tasks below are what a human does about that.
 */

/** One thing a person has to decide before a provider change can be adopted. */
export interface ProviderVersionReviewTask {
  capabilityId: string
  program: string
  /** The state stored on the leaf today. */
  currentState: CapabilityState
  reviewedUnder: string
  compatibleThrough: string | null
  candidateVersion: string
  /** Where the task is worked. */
  queue: string
  /** What the reviewer has to establish, in the values that raised it. */
  question: string
  /**
   * True when adopting the candidate would withdraw a leaf that is money-facing
   * today. Those are the tasks that have a deadline attached to somebody's
   * money rather than to a backlog.
   */
  withdrawsMoneyFacingCapability: boolean
}

/** One thing the provider announced that this build has never heard of. */
export interface ProviderFeatureReviewTask {
  /** The provider's own name for it, echoed rather than interpreted. */
  announced: string
  kind: "event-type" | "capability"
  queue: string
  question: string
}

export interface ProviderVersionWatchReport {
  provider: string
  /** What production is pinned to right now. Unchanged by this call. */
  pinnedVersion: string
  candidateVersion: string
  /**
   * Always `false`, as a value rather than as a promise in a comment.
   *
   * A caller that logs or renders this report says, in the report itself, that
   * nothing was changed by producing it — which is the claim a scheduled job
   * most needs to be able to make and the one a comment cannot carry into a log.
   */
  mutatesProduction: false
  /** Leaf ids the candidate is already inside the reviewed window of. */
  alreadyReviewed: readonly string[]
  /** Leaf ids with no provider API behind them, so no version applies. */
  notApplicable: readonly string[]
  tasks: readonly ProviderVersionReviewTask[]
}

/**
 * What a move to `candidateVersion` would require somebody to review.
 *
 * Note the report is produced for the CURRENT registry against a CANDIDATE — it
 * never writes the candidate anywhere. Passing the same version production is
 * pinned to is meaningful and returns no tasks, which is the shape a scheduled
 * run has on a quiet day.
 */
export function watchProviderApiVersion(
  candidateVersion: string,
  capabilities: readonly PaymentCapability[] = PAYMENT_CAPABILITIES,
): ProviderVersionWatchReport {
  // Refuses rather than defaulting: a candidate that is not a provider date
  // version would compare as older than everything and produce an empty task
  // list, which reads exactly like "nothing to review".
  normalizeProviderApiVersion(candidateVersion)

  const alreadyReviewed: string[] = []
  const notApplicable: string[] = []
  const tasks: ProviderVersionReviewTask[] = []

  for (const cap of capabilities) {
    const verdict = providerApiCompatibility(cap.id, candidateVersion)
    if (verdict.code === "api-version-not-applicable") {
      notApplicable.push(cap.id)
      continue
    }
    if (verdict.compatible) {
      alreadyReviewed.push(cap.id)
      continue
    }

    // `apiVersions` is non-null here: a null one produces the not-applicable
    // code above and was skipped.
    const window = cap.apiVersions as NonNullable<PaymentCapability["apiVersions"]>
    tasks.push({
      capabilityId: cap.id,
      program: cap.program,
      currentState: cap.state,
      reviewedUnder: window.reviewedUnder,
      compatibleThrough: window.compatibleThrough,
      candidateVersion,
      queue: PAYMENTS_OPERATIONS_QUEUE,
      question:
        `Does the certification of "${cap.id}" (${cap.program}, ${cap.state}) still hold under ` +
        `provider API version ${candidateVersion}? It was reviewed under ${window.reviewedUnder}` +
        (window.compatibleThrough === null ? `` : ` through ${window.compatibleThrough}`) +
        `. Widening the reviewed window is a decision with a document behind it; until one is ` +
        `made this leaf resolves to UNSUPPORTED under ${candidateVersion}.`,
      withdrawsMoneyFacingCapability: (STATES_REQUIRING_APPROVAL as readonly string[]).includes(
        cap.state,
      ),
    })
  }

  return {
    provider: PROVIDER,
    pinnedVersion: PROVIDER_API_VERSION,
    candidateVersion,
    mutatesProduction: false,
    alreadyReviewed,
    notApplicable,
    tasks,
  }
}

/**
 * Provider features this build has never heard of, as review tasks.
 *
 * The input is whatever a provider announcement names — event types, product
 * capabilities — echoed rather than interpreted. Nothing here adds an event
 * type to `SUPPORTED_EVENT_TYPES` or a leaf to the registry, and the reason is
 * the same as above: an event type registered by a watcher is an event type
 * with no parser and no reviewer, and `parseProviderEvent` would then accept a
 * shape nobody has read.
 *
 * An announcement naming something already supported produces no task, so a
 * scheduled run over an unchanged announcement list is silent.
 */
export function watchProviderFeatures(
  announcedEventTypes: readonly string[],
  announcedCapabilityIds: readonly string[] = [],
): readonly ProviderFeatureReviewTask[] {
  const knownEvents = new Set(SUPPORTED_EVENT_TYPES.map((e) => e.type))
  const knownCapabilities = new Set(PAYMENT_CAPABILITIES.map((c) => c.id))
  const tasks: ProviderFeatureReviewTask[] = []

  for (const type of announcedEventTypes) {
    if (knownEvents.has(type)) continue
    tasks.push({
      announced: type,
      kind: "event-type",
      queue: PAYMENTS_OPERATIONS_QUEUE,
      question:
        `The provider announces event type "${type}", which this build has no reader for. ` +
        `Deciding whether Tenure consumes it means writing the field contract in ` +
        `SUPPORTED_EVENT_TYPES and a parser for it; until then the inbox refuses the event, ` +
        `which is the correct behaviour and not a bug to route around.`,
    })
  }

  for (const id of announcedCapabilityIds) {
    if (knownCapabilities.has(id)) continue
    tasks.push({
      announced: id,
      kind: "capability",
      queue: PAYMENTS_OPERATIONS_QUEUE,
      question:
        `The provider announces "${id}", which is not a registered Tenure payments capability. ` +
        `A provider supporting something is not Tenure having approved it (Bible §2); ` +
        `registering it is an ADR and a certification, not an import.`,
    })
  }

  return tasks
}
