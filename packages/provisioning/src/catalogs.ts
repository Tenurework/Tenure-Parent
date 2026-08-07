import { MODEL_CATALOG, compareVersions, parseVersion, type ModelEntry } from "@tenure/platform-config"

/**
 * GE-030-005 — extension, package, connector and model catalogs.
 *
 * The item says "even when features are not yet externally enabled", and that
 * clause is the design. From the bible §0: the Marketplace is "an intentionally
 * empty, polished Coming soon surface behind a feature flag. No third-party
 * publishing, purchasing, installation, billing, or executable package intake
 * is enabled until certification, sandboxing, entitlement, billing, security
 * review, revocation, and support controls are complete."
 *
 * So the catalogs exist, carry lifecycle and compatibility, and refuse to hand
 * anything to a tenant. `availableToTenants` is the single place that decides,
 * and it returns nothing for third-party entries regardless of their state —
 * which is the difference between "not built yet" and "built and deliberately
 * closed". The second is auditable; the first is a promise.
 *
 * ## Revocation is terminal, and it is the point
 *
 * Everything else here is bookkeeping. Revocation is the control: a package
 * found to be malicious must stop resolving everywhere, at every version,
 * immediately, and must not be undoable by re-publishing. `REVOKED` has no
 * outgoing transitions and `isUsable` checks it before anything else.
 *
 * ## Certification is a dated fact, not a lifecycle word (PACK-080-003)
 *
 * `CERTIFIED` used to be the whole of certification: a state somebody moved an
 * entry into, carrying no scope, no evidence and no end. A certification like
 * that is permanent by construction — nothing in the type can lapse — which is
 * the same defect `break-glass.ts` refuses for grants: "break-glass with no end
 * is a standing key".
 *
 * So `certification` is an effective-dated record with the scope it covered and
 * the evidence that proved it, and `isUsable` refuses a published entry that
 * has none or whose expiry has passed. `now` is a parameter rather than a clock
 * read, so the same inputs always produce the same decision.
 *
 * ## Availability is decided per scope, and carries its disclaimer
 * (PACK-050-004)
 *
 * Bible §5: "System Studio may show `Available` only when a
 * `CapabilityAvailabilityDecision` passes for the exact
 * tenant/environment/legal entity/population/country/region/provider/mode/
 * version… UI labels and APIs must expose exact scope and reasons."
 *
 * `availabilityDecisions` is that object. It returns one decision per entry —
 * available or not, the reason, the scope it was decided for, and the entry's
 * disclaimer where it has one — and `availableToTenants` is the filter over it.
 * The disclaimer rides on the decision rather than sitting beside it in the UI,
 * so a surface cannot render an availability label without the text that
 * qualifies it.
 */

export type CatalogLifecycle =
  /** Being written. Not offered, not certified. */
  | "DRAFT"
  /** Submitted for certification. */
  | "SUBMITTED"
  /** Passed review. Installable, but not yet listed. */
  | "CERTIFIED"
  /** Listed. The only state a tenant could ever be offered. */
  | "PUBLISHED"
  /** Still works for those who have it; not offered to anyone new. */
  | "DEPRECATED"
  /** Withdrawn for cause. Stops working everywhere, immediately. */
  | "REVOKED"

const LIFECYCLE_TRANSITIONS: Readonly<Record<CatalogLifecycle, readonly CatalogLifecycle[]>> = {
  DRAFT: ["SUBMITTED", "REVOKED"],
  SUBMITTED: ["CERTIFIED", "DRAFT", "REVOKED"],
  CERTIFIED: ["PUBLISHED", "DEPRECATED", "REVOKED"],
  PUBLISHED: ["DEPRECATED", "REVOKED"],
  // A deprecated package can be revoked but never un-deprecated: bringing it
  // back would silently re-list something somebody deliberately retired.
  DEPRECATED: ["REVOKED"],
  // Terminal. Re-publishing a revoked package must be a NEW package with a new
  // identity, so the revocation stays true about the artifact that earned it.
  REVOKED: [],
}

export function canAdvanceCatalog(from: CatalogLifecycle, to: CatalogLifecycle): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

/** Engine versions an artifact declares it works with. Inclusive at both ends. */
export interface CompatibilityRange {
  minEngine: string
  /** `null` for "no known upper bound", which is a claim, not an absence. */
  maxEngine: string | null
}

/**
 * What a certification actually covered, what proved it, and when it lapses.
 *
 * Bible §4 names `PackCertificationScope` and `CertificationEvidence` and
 * requires every object to be "versioned and effective-dated". All four fields
 * are required together on purpose:
 *
 *   * `scope` — a certification with no scope certifies everything, which is
 *     the claim nobody reviewed. "Certified for the US" and "certified" are
 *     different facts and only one of them is checkable.
 *   * `evidenceRefs` — a certification nobody can retrace is an assertion.
 *   * `certifiedAt` / `expiresAt` — a fact with no end never becomes false, so
 *     nothing ever triggers a re-certification.
 */
export interface CatalogCertification {
  /**
   * Exactly what was certified, as scope tokens the reviewer wrote down —
   * `region:us-east-1`, `population:students`, `mode:read-only`.
   */
  scope: readonly string[]
  /** The review record, the test run, the report. By reference, never inline. */
  evidenceRefs: readonly string[]
  certifiedAt: string
  /** When it lapses. Required: see the header. */
  expiresAt: string
}

/**
 * Where an entry may be offered, and what has to be said when it is.
 *
 * `region` is a hard gate — the same one models have always had, extended to
 * the artifacts that were exempt from it. `disclaimer` is carried on every
 * availability decision for the entry, so an operator surface cannot show
 * "available" without it.
 */
export interface CatalogRestrictions {
  /** Regions this entry may be offered in. Absent means no region limit. */
  region?: readonly string[]
  /**
   * AWS partitions this entry may be offered in — `aws`, `aws-us-gov`,
   * `aws-cn`. Absent means no partition limit.
   *
   * A separate axis from `region` and the more important one for an egress:
   * `apps/web/src/lib/partition-services.ts` records, per partition, which
   * services this application can actually reach, and a public-internet SaaS
   * endpoint is not reachable from GovCloud or China as a matter of both
   * partition isolation and the law of the jurisdiction. Naming regions instead
   * would be an incomplete list of one partition's regions, compiled into the
   * product — which is the estate literal `GE-012-001` forbids.
   */
  partition?: readonly string[]
  /**
   * What has to be shown alongside any availability label — where the data
   * goes, which jurisdictions were reviewed, what was not.
   */
  disclaimer?: string
}

export interface CatalogEntry {
  /** Stable across versions. `tenure.finance-export`, `acme.sis-connector`. */
  key: string
  displayName: string
  lifecycle: CatalogLifecycle
  /**
   * Who published it. `platform` is Tenure's own; anything else is third party
   * and cannot reach a tenant until the marketplace controls are complete.
   */
  publisher: "platform" | "third-party"
  /**
   * The certification record, if one was ever granted.
   *
   * Optional in the type and refused at the gate: an entry that reached
   * `PUBLISHED` without one is not usable, and `isUsable` says `uncertified`
   * rather than letting the lifecycle word stand in for the fact.
   */
  certification?: CatalogCertification
  restrictions?: CatalogRestrictions
}

export interface PackageVersion {
  key: string
  version: string
  /** sha256 of the artifact. What a cell verifies before running anything. */
  digest: string
  /**
   * Signature over the digest, by reference.
   *
   * `null` means unsigned, which is refused. An unsigned package is one nobody
   * can prove came from its publisher, and "we trusted the registry we fetched
   * it from" is the supply-chain assumption that keeps failing.
   */
  signatureRef: string | null
  compatibility: CompatibilityRange
  publishedAt: string
}

export interface ExtensionEntry extends CatalogEntry {
  kind: "extension"
  versions: readonly PackageVersion[]
}

export interface ConnectorEntry extends CatalogEntry {
  kind: "connector"
  /** Where it talks to. Recorded because an outbound integration is an egress. */
  egressHosts: readonly string[]
  compatibility: CompatibilityRange
}

/**
 * Re-exported, not redefined.
 *
 * The shape lives in `@tenure/platform-config` so a cell can read model policy
 * without importing this package — see `model-entry.ts` there. One definition,
 * two importers.
 */
export type { ModelEntry }

export type AnyCatalogEntry = ExtensionEntry | ConnectorEntry | ModelEntry

export interface CatalogProblem {
  field: string
  reason: string
  detail: string
}

export function validateRange(range: CompatibilityRange): readonly CatalogProblem[] {
  const problems: CatalogProblem[] = []
  let min
  try {
    min = parseVersion(range.minEngine)
  } catch {
    problems.push({ field: "minEngine", reason: "invalid", detail: "not a version" })
  }
  if (range.maxEngine !== null) {
    try {
      const max = parseVersion(range.maxEngine)
      if (min && compareVersions(max, min) < 0) {
        problems.push({
          field: "maxEngine",
          reason: "invalid",
          // A range that ends before it starts matches no engine, so the
          // package is uninstallable everywhere and looks merely incompatible.
          detail: "the range ends before it begins",
        })
      }
    } catch {
      problems.push({ field: "maxEngine", reason: "invalid", detail: "not a version" })
    }
  }
  return problems
}

/**
 * Whether an engine is inside a declared range.
 *
 * Fails closed on anything unparseable — on either side. An artifact whose
 * range nobody can read is not one that can promise to work, and an engine that
 * cannot say what version it is cannot be inside anything.
 */
export function engineIsCompatible(engineVersion: string, range: CompatibilityRange): boolean {
  let engine
  let min
  try {
    engine = parseVersion(engineVersion)
    min = parseVersion(range.minEngine)
  } catch {
    return false
  }
  if (compareVersions(engine, min) < 0) return false
  if (range.maxEngine === null) return true
  try {
    return compareVersions(engine, parseVersion(range.maxEngine)) <= 0
  } catch {
    return false
  }
}

export function validatePackage(pkg: PackageVersion): readonly CatalogProblem[] {
  const problems: CatalogProblem[] = [...validateRange(pkg.compatibility)]

  if (!/^[0-9a-f]{64}$/.test(pkg.digest)) {
    problems.push({
      field: "digest",
      reason: "invalid",
      detail: "a sha256 digest is 64 lowercase hex characters",
    })
  }

  if (!pkg.signatureRef) {
    problems.push({
      field: "signatureRef",
      reason: "required",
      // "We trusted the registry we fetched it from" is the supply-chain
      // assumption that keeps failing.
      detail: "an unsigned package is one nobody can prove came from its publisher",
    })
  }

  try {
    parseVersion(pkg.version)
  } catch {
    problems.push({ field: "version", reason: "invalid", detail: "not a version" })
  }

  return problems
}

/**
 * Whether an entry may be used at all, on this engine, right now.
 *
 * Revocation is checked first and unconditionally. Everything after it is a
 * reason something is *not yet* usable; revocation is the reason it must stop
 * being usable, and ordering it after a compatibility check would mean a
 * revoked package on an incompatible engine reports "incompatible" — which
 * reads as "upgrade and it will work".
 */
export type UsabilityReason =
  | "usable"
  | "revoked"
  | "not-published"
  | "engine-incompatible"
  | "region-not-allowed"
  /** The partition this cell runs in is not one the entry was reviewed for. */
  | "partition-not-allowed"
  | "unsigned"
  /** Published, and nobody ever certified it. */
  | "uncertified"
  /** Certified once. The certification has lapsed and nobody renewed it. */
  | "certification-expired"

/**
 * How long before expiry a certification is reported as needing renewal.
 *
 * A re-certification trigger that fires on the day of expiry is an outage
 * notice, not a trigger. Thirty days is the same warning window
 * `identity-registry.ts` uses for expiring credentials, kept identical so an
 * operator learns one number rather than two.
 */
export const RECERTIFICATION_WARNING_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export type CertificationState =
  /** No certification record at all, or one that certifies nothing. */
  | "absent"
  /** Valid, and not close enough to expiry to act on. */
  | "current"
  /** Valid, and inside the re-certification window. The trigger. */
  | "expiring"
  /** Lapsed. Treated exactly as uncertified at the gate. */
  | "expired"

/**
 * Where a certification stands at an instant.
 *
 * Fails closed twice over. A record with no scope or no evidence is `absent`,
 * not `current` — it names nothing and proves nothing, so treating it as a
 * certification would make the two required fields decorative. An unparseable
 * date is `expired`, because a certification whose end nobody can read is one
 * nobody can renew on time.
 */
export function certificationState(
  certification: CatalogCertification | undefined,
  now: string,
): CertificationState {
  if (!certification) return "absent"
  if (certification.scope.length === 0 || certification.evidenceRefs.length === 0) return "absent"

  const expires = Date.parse(certification.expiresAt)
  const at = Date.parse(now)
  if (Number.isNaN(expires) || Number.isNaN(at)) return "expired"

  if (at >= expires) return "expired"
  if (expires - at <= RECERTIFICATION_WARNING_DAYS * DAY_MS) return "expiring"
  return "current"
}

/**
 * `resolvedVersion` is the version an installer would actually take.
 *
 * Returned rather than left implicit because "usable" and "usable at which
 * version" are different answers, and a caller that has to re-derive the
 * second will re-derive it differently. A mutation swapping newest-compatible
 * for oldest-compatible passed every test until this was exposed.
 */
export interface UsabilityVerdict {
  usable: boolean
  reason: UsabilityReason
  resolvedVersion?: string
  /**
   * Present whenever the entry declares one, whether or not it is usable.
   *
   * Returned from the decision rather than looked up separately by the UI, so
   * an availability label and the text qualifying it cannot come apart.
   */
  disclaimer?: string
  /** Where the certification stands. `undefined` for entries that need none. */
  certification?: CertificationState
}

export function isUsable(
  entry: AnyCatalogEntry,
  context: {
    engineVersion: string
    region: string
    /**
     * The AWS partition this decision is for. Never defaulted — see the
     * `partition-not-allowed` branch.
     */
    partition?: string
    version?: string
    /**
     * The instant this decision is for.
     *
     * A parameter, not `Date.now()`: a certification gate that reads a clock
     * cannot be replayed, and "was this usable when we shipped it?" is exactly
     * the question an audit asks.
     */
    now: string
  },
): UsabilityVerdict {
  if (entry.lifecycle === "REVOKED") return { usable: false, reason: "revoked" }

  // DEPRECATED is still usable for those who already have it — that is what
  // distinguishes it from revoked, and collapsing the two would turn a planned
  // retirement into an outage.
  if (entry.lifecycle !== "PUBLISHED" && entry.lifecycle !== "DEPRECATED") {
    return { usable: false, reason: "not-published" }
  }

  if (entry.kind === "model") {
    // `"*"` is a global endpoint, which the Anthropic API is and Bedrock is
    // not. Read the same way `modelIsAllowed` reads it — the two gate the same
    // catalog, and a wildcard that means "everywhere" in one and "a region
    // literally called *" in the other is a disagreement nobody would notice
    // until a model silently stopped being offered.
    return entry.regions.includes("*") || entry.regions.includes(context.region)
      ? { usable: true, reason: "usable" }
      : { usable: false, reason: "region-not-allowed" }
  }

  // Everything below is a pack: an artifact the factory certifies and ships.
  // The disclaimer travels with every verdict from here on, including the
  // usable one.
  const disclaimer = entry.restrictions?.disclaimer
  const certification = certificationState(entry.certification, context.now)

  // Certification before region, because an uncertified pack is uncertified
  // everywhere; reporting a region problem for it would read as "offer it
  // somewhere else and it will work".
  if (certification === "absent") {
    return { usable: false, reason: "uncertified", disclaimer, certification }
  }
  if (certification === "expired") {
    return { usable: false, reason: "certification-expired", disclaimer, certification }
  }

  // The hard availability gate. Models have always had this; connectors and
  // extensions were exempt, which meant a pack could be offered in a
  // jurisdiction nobody reviewed it for.
  //
  // Partition first, because it is the coarser fact: a pack that cannot exist
  // in this partition at all is not a pack that would work in some other region
  // of it, and reporting a region problem would send an operator looking for
  // one.
  const allowedPartitions = entry.restrictions?.partition
  if (allowedPartitions && !allowedPartitions.includes(context.partition ?? "")) {
    // Absent counts as refused. A caller that cannot say which partition it is
    // in has not established that this entry may be offered there, and the one
    // thing an egress restriction must not do is default to the commercial
    // partition (`apps/web/src/lib/partition-services.ts` states the same rule
    // for the same reason).
    return { usable: false, reason: "partition-not-allowed", disclaimer, certification }
  }

  const allowedRegions = entry.restrictions?.region
  if (allowedRegions && !allowedRegions.includes(context.region)) {
    return { usable: false, reason: "region-not-allowed", disclaimer, certification }
  }

  if (entry.kind === "connector") {
    return engineIsCompatible(context.engineVersion, entry.compatibility)
      ? { usable: true, reason: "usable", disclaimer, certification }
      : { usable: false, reason: "engine-incompatible", disclaimer, certification }
  }

  const version = context.version
    ? entry.versions.find((v) => v.version === context.version)
    : // Newest compatible, which is what an installer wants.
      [...entry.versions]
        .filter((v) => engineIsCompatible(context.engineVersion, v.compatibility))
        .sort((a, b) => compareVersions(parseVersion(b.version), parseVersion(a.version)))[0]

  if (!version) return { usable: false, reason: "engine-incompatible", disclaimer, certification }
  if (!version.signatureRef) {
    return {
      usable: false,
      reason: "unsigned",
      resolvedVersion: version.version,
      disclaimer,
      certification,
    }
  }
  if (!engineIsCompatible(context.engineVersion, version.compatibility)) {
    return {
      usable: false,
      reason: "engine-incompatible",
      resolvedVersion: version.version,
      disclaimer,
      certification,
    }
  }
  return {
    usable: true,
    reason: "usable",
    resolvedVersion: version.version,
    disclaimer,
    certification,
  }
}

/**
 * What a tenant may actually be offered.
 *
 * Third-party entries are excluded **unconditionally**, whatever their
 * lifecycle, until the marketplace controls in the bible §0 are complete —
 * certification, sandboxing, entitlement, billing, security review, revocation
 * and support. Gating this on a lifecycle state instead would mean one
 * mis-set `PUBLISHED` opens third-party code intake, and the control that was
 * supposed to be "the marketplace is off" turns out to be "nobody clicked
 * publish yet".
 *
 * `marketplaceEnabled` exists so the shape of the eventual behaviour is real
 * and testable, and it is a parameter rather than a flag lookup so that turning
 * it on is a deliberate act at a call site somebody has to write.
 */
export interface AvailabilityContext {
  engineVersion: string
  region: string
  /** The AWS partition the decision is for. Absent refuses a partition-limited entry. */
  partition?: string
  marketplaceEnabled: boolean
  /** The instant the decision is for. Never a clock read inside the gate. */
  now: string
}

/**
 * One `CapabilityAvailabilityDecision` per entry — Bible §5.
 *
 * Both halves of the answer, together: what is offered, and what is not and
 * why. A filter alone cannot say "unavailable because its certification lapsed
 * on the 3rd", and an operator surface that can only render the survivors
 * reports a missing connector identically to a refused one.
 *
 * `scope` records what the decision was made *for*. A decision with no scope is
 * the "generally available" claim the bible refuses: a module can be available
 * in the US and unavailable for one German legal entity, and only a scoped
 * decision can say both.
 */
export interface CapabilityAvailabilityDecision {
  entry: AnyCatalogEntry
  available: boolean
  reason: UsabilityReason | "marketplace-closed"
  resolvedVersion?: string
  disclaimer?: string
  certification?: CertificationState
  scope: { region: string; partition?: string; engineVersion: string; at: string }
}

export function availabilityDecisions(
  entries: readonly AnyCatalogEntry[],
  context: AvailabilityContext,
): readonly CapabilityAvailabilityDecision[] {
  const scope = {
    region: context.region,
    partition: context.partition,
    engineVersion: context.engineVersion,
    at: context.now,
  }

  return entries.map((entry) => {
    if (entry.publisher === "third-party" && !context.marketplaceEnabled) {
      return {
        entry,
        available: false,
        reason: "marketplace-closed" as const,
        disclaimer: entry.kind === "model" ? undefined : entry.restrictions?.disclaimer,
        scope,
      }
    }
    const verdict = isUsable(entry, context)
    return {
      entry,
      available: verdict.usable,
      reason: verdict.reason,
      resolvedVersion: verdict.resolvedVersion,
      disclaimer: verdict.disclaimer,
      certification: verdict.certification,
      scope,
    }
  })
}

export function availableToTenants(
  entries: readonly AnyCatalogEntry[],
  context: AvailabilityContext,
): readonly AnyCatalogEntry[] {
  return availabilityDecisions(entries, context)
    .filter((d) => d.available)
    .map((d) => d.entry)
}

/**
 * The catalog the gate actually runs over.
 *
 * Everything above decided nothing until this existed: `availableToTenants` was
 * a filter with no list, which is a control that cannot be wrong.
 *
 * ## Only what has a call site
 *
 * The same rule `model-policy.ts` states for models, for the same reason.
 * Listing connectors nobody has built would make this a wish list, and a wish
 * list that gates production looks like a control. Today that is exactly one
 * outbound integration — `api.anthropic.com`, reached from
 * `apps/web/src/lib/ai.ts` — plus the models, which already carry their own
 * region policy and are re-exported here so one surface answers "what may this
 * tenant be offered?" rather than two.
 *
 * ## The connector carries no certification, and that is the honest state
 *
 * Nobody has performed a certification of the Relay egress. Writing a
 * `certifiedAt` and an `expiresAt` here would be a claim about a review that
 * did not happen — the precise failure PACK-000-004 ("remove or relabel false
 * `Available` claims") exists to stop. So it has none, the gate refuses it
 * `uncertified`, and the Studio renders it under what is *not* available with
 * that reason. When somebody does the review, the record goes here and the
 * entry starts passing.
 */
export const RELAY_ANTHROPIC_CONNECTOR: ConnectorEntry = {
  kind: "connector",
  key: "tenure.relay-anthropic",
  displayName: "Relay — Anthropic API",
  lifecycle: "PUBLISHED",
  publisher: "platform",
  egressHosts: ["api.anthropic.com"],
  // The engine range this integration is written against. `lib/ai.ts` ships
  // with the cell, so any engine that has the call site has a compatible one.
  compatibility: { minEngine: "2026.1.0", maxEngine: null },
  restrictions: {
    // The partition, not a list of regions. `apps/web/src/lib/partition-services.ts`
    // records that `api.anthropic.com` exists in the commercial partition and
    // not in GovCloud or China — sending student records from a GovCloud cell
    // to a commercial SaaS endpoint is the failure an operator chose GovCloud
    // to prevent. Writing out "the regions of the commercial partition" instead
    // would be an incomplete estate list compiled into the product, which is
    // what `tests/security/no-hardcoded-estate.test.mjs` refuses.
    partition: ["aws"],
    disclaimer:
      "Prompts, and any tenant records quoted inside them, leave the AWS partition for " +
      "api.anthropic.com — a public-internet endpoint operated by a third party. It does not " +
      "exist in the GovCloud or China partitions and is refused there " +
      "(apps/web/src/lib/partition-services.ts). No data-processing review has been recorded " +
      "for any regulated population, so this connector is not certified and is not offered.",
  },
}

export const CATALOG_ENTRIES: readonly AnyCatalogEntry[] = [
  RELAY_ANTHROPIC_CONNECTOR,
  ...MODEL_CATALOG,
]
