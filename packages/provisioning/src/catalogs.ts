import { compareVersions, parseVersion, type ModelEntry } from "@tenure/platform-config"

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
  | "unsigned"

/**
 * `resolvedVersion` is the version an installer would actually take.
 *
 * Returned rather than left implicit because "usable" and "usable at which
 * version" are different answers, and a caller that has to re-derive the
 * second will re-derive it differently. A mutation swapping newest-compatible
 * for oldest-compatible passed every test until this was exposed.
 */
export function isUsable(
  entry: AnyCatalogEntry,
  context: { engineVersion: string; region: string; version?: string },
): { usable: boolean; reason: UsabilityReason; resolvedVersion?: string } {
  if (entry.lifecycle === "REVOKED") return { usable: false, reason: "revoked" }

  // DEPRECATED is still usable for those who already have it — that is what
  // distinguishes it from revoked, and collapsing the two would turn a planned
  // retirement into an outage.
  if (entry.lifecycle !== "PUBLISHED" && entry.lifecycle !== "DEPRECATED") {
    return { usable: false, reason: "not-published" }
  }

  if (entry.kind === "model") {
    return entry.regions.includes(context.region)
      ? { usable: true, reason: "usable" }
      : { usable: false, reason: "region-not-allowed" }
  }

  if (entry.kind === "connector") {
    return engineIsCompatible(context.engineVersion, entry.compatibility)
      ? { usable: true, reason: "usable" }
      : { usable: false, reason: "engine-incompatible" }
  }

  const version = context.version
    ? entry.versions.find((v) => v.version === context.version)
    : // Newest compatible, which is what an installer wants.
      [...entry.versions]
        .filter((v) => engineIsCompatible(context.engineVersion, v.compatibility))
        .sort((a, b) => compareVersions(parseVersion(b.version), parseVersion(a.version)))[0]

  if (!version) return { usable: false, reason: "engine-incompatible" }
  if (!version.signatureRef) {
    return { usable: false, reason: "unsigned", resolvedVersion: version.version }
  }
  if (!engineIsCompatible(context.engineVersion, version.compatibility)) {
    return { usable: false, reason: "engine-incompatible", resolvedVersion: version.version }
  }
  return { usable: true, reason: "usable", resolvedVersion: version.version }
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
export function availableToTenants(
  entries: readonly AnyCatalogEntry[],
  context: { engineVersion: string; region: string; marketplaceEnabled: boolean },
): readonly AnyCatalogEntry[] {
  return entries.filter((entry) => {
    if (entry.publisher === "third-party" && !context.marketplaceEnabled) return false
    return isUsable(entry, context).usable
  })
}
