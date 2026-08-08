import { validateReturnPath } from "@tenure/identity"
import {
  MODEL_CATALOG,
  RELAY_ANTHROPIC_REVIEW,
  RELAY_ANTHROPIC_SCOPES,
  compareVersions,
  parseVersion,
  providerActivation,
  type ModelEntry,
  type ProviderReview,
} from "@tenure/platform-config"

import {
  NO_EVIDENCE,
  claimIsUnproven,
  classifyCapabilities,
  type ClassifiedCapability,
  type ConnectorCapability,
} from "./connector-capability"
import { PROVIDER_PACKS } from "./provider-packs"
import { selectorProblems, type ResourceSelector } from "./resource-selector"
import {
  WORK_ACCELERATORS,
  acceleratorAvailability,
  type AcceleratorVerdict,
} from "./work-accelerators"

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
  /**
   * Intended, and nobody has started. WRK-100-003: "unbuilt packs remain
   * `PLANNED`".
   *
   * A different fact from `DRAFT`, which is "being written". The 24 provider
   * packs the WRK-080/090/100 requirements name are all in this state, and the
   * distinction is the whole reason they can be listed at all: a catalog row
   * saying "Jira, planned, WRK-100-001" is a commitment somebody can hold the
   * platform to, and the same row at `DRAFT` claims work that is not happening.
   */
  | "PLANNED"
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
  // Nothing transitions INTO planned. It is the entry point, and a pack that
  // has been started cannot become un-started.
  PLANNED: ["DRAFT", "REVOKED"],
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

/**
 * How a tenant would actually authorize this connector — WRK-040-001.
 *
 * The generic primitives were already right and already tested:
 * `@tenure/identity` owns PKCE (`CHALLENGE_METHOD = "S256"`, no parameter to
 * weaken it), state/nonce binding, single-use transactions and the
 * open-redirect defence. All of it written for the OIDC SIGN-IN flow, and
 * nothing bound any of it to a connector: before this, `grep -rl code_verifier`
 * across `packages`, `apps/web/src` and `modules` returned only files under
 * `packages/identity/src`, and not one pack said which endpoints it would talk
 * to, where the provider redirects back, or how the returning account is proved
 * to be the one the tenant asked for.
 *
 * Those last two are the clauses that CANNOT be inherited from the generic
 * flow, because they are per-provider facts: Microsoft's exact redirect is not
 * Google's, and "the id_token carries the account" is not the same rule as
 * "call userinfo" or "an administrator granted the app tenant-wide". So they
 * are data on the pack, and `authorizationRefusal` below is a gate that reads
 * them rather than a comment that describes them.
 */
export interface ProviderAuthorizationProfile {
  /** Where the person is sent. Its host must be one the pack declares. */
  authorizeEndpoint: string
  /** Where the backend redeems the code. Same rule. */
  tokenEndpoint: string
  /**
   * The exact path the provider redirects back to, on this site.
   *
   * Validated with `validateReturnPath` from `@tenure/identity` rather than a
   * second redirect rule written here. Two disagreeing redirect validators is
   * how an open redirect ships: the one nobody is looking at is the one that
   * accepts `//evil.example`.
   */
  redirectPath: string
  /**
   * Authorization Code, and only that. A literal type rather than a runtime
   * check, so an implicit-flow pack does not compile.
   */
  responseType: "code"
  /** Refused when false. See `authorizationRefusal`. */
  requiresPkce: boolean
  /** Whether a nonce is minted and checked inside the returned ID token. */
  requiresNonce: boolean
  /**
   * How the returning account is proved to be the account the tenant asked for.
   *
   * Three genuinely different mechanisms with three different failure modes,
   * which is why this is not a boolean: a claim inside a signed token, a call
   * back to the provider, or an administrator's tenant-wide grant.
   */
  accountVerification: "id-token-claim" | "userinfo-call" | "admin-consent-grant"
  /**
   * The claim that carries the verified account — `oid`, `sub`, `email`.
   *
   * Required to be non-empty when `accountVerification` is `id-token-claim`;
   * naming no claim is naming no verification.
   */
  verifiedAccountClaim: string
}

/** Every account-verification mechanism, for a console that lists them. */
export const ACCOUNT_VERIFICATIONS = [
  "id-token-claim",
  "userinfo-call",
  "admin-consent-grant",
] as const

/**
 * Whether an authorization profile could be driven at all, and if not, why.
 *
 * Returns the first refusal rather than a list, because each one is a different
 * remedy and an operator acts on one at a time: the redirect is wrong, or the
 * endpoint is not egressed, or PKCE is off. `null` means the contract holds.
 *
 * Exported so a pack author can run it before advancing a row rather than
 * discovering the refusal through `isUsable`.
 */
export function authorizationRefusal(
  profile: ProviderAuthorizationProfile,
  egressHosts: readonly string[],
): UsabilityReason | null {
  // PKCE first: it is the only clause with no legitimate exception. RFC 7636
  // `plain` and no-PKCE-at-all both mean the party redeeming the code is not
  // proved to be the party that started it, and a connector authorization is
  // exactly where a stolen code is worth stealing.
  if (!profile.requiresPkce) return "authorization-pkce-required"

  for (const endpoint of [profile.authorizeEndpoint, profile.tokenEndpoint]) {
    let host
    try {
      const url = new URL(endpoint)
      // An `http:` authorize endpoint hands the code to anyone on the path, and
      // an endpoint nobody can parse cannot be checked against anything. Both
      // fail closed, under one reason, because both have one remedy: write a
      // real https URL.
      if (url.protocol !== "https:") return "authorization-endpoint-insecure"
      host = url.hostname
    } catch {
      return "authorization-endpoint-insecure"
    }
    // The pack's OWN egress list. An authorization endpoint on a host the pack
    // never declared is an egress nobody reviewed — the connector would be
    // approved to talk to `graph.microsoft.com` and would in fact first talk to
    // somewhere else entirely.
    if (!egressHosts.includes(host)) return "authorization-endpoint-not-egressed"
  }

  // The identity package's validator, not a second one. `//evil.example` looks
  // like a path, starts with a slash, and browsers navigate to another origin.
  if (!validateReturnPath(profile.redirectPath).ok) return "authorization-redirect-refused"

  if (profile.accountVerification === "id-token-claim") {
    // A claim nobody named is no verification, and a claim inside a token that
    // was never bound to this request proves nothing about who started it —
    // that binding is exactly what the nonce is for.
    if (profile.verifiedAccountClaim.trim() === "") return "authorization-account-unverified"
    if (!profile.requiresNonce) return "authorization-account-unverified"
  }

  return null
}

export interface ConnectorEntry extends CatalogEntry {
  kind: "connector"
  /** Where it talks to. Recorded because an outbound integration is an egress. */
  egressHosts: readonly string[]
  compatibility: CompatibilityRange
  /**
   * WRK-000-002 — every provider/product/capability/direction this connector
   * claims, each classified in the seven-state vocabulary with its evidence.
   *
   * Required rather than optional, deliberately. Optional would mean a
   * connector that says nothing about what it does compiles, and "no
   * capabilities declared" would render identically to "nothing works" — which
   * is the invisible-reads-like-done failure the whole WRK-000 section exists
   * to stop. Making it required means `tsc` names every construction site that
   * has not answered.
   */
  capabilities: readonly ConnectorCapability[]
  /**
   * WRK-040-003 — the scopes this connector asks the provider for.
   *
   * Required for the same reason: the subset check against `providerReview`
   * cannot mean anything if one side of it may be absent. An empty list is a
   * connector that asks for nothing, which is a statement; a missing list is
   * nobody having considered the question.
   */
  requestedScopes: readonly string[]
  /**
   * Where the PROVIDER's own review stands — Google OAuth app verification,
   * Microsoft publisher verification, a Slack app-directory listing.
   *
   * Optional in the type and refused at the gate, exactly like `certification`
   * above: a connector that reached PUBLISHED without one is refused with
   * `provider-review-missing` rather than passing by omission. Every other
   * lifecycle state legitimately has none — nobody submits a pack for provider
   * review before building it.
   */
  providerReview?: ProviderReview
  /**
   * WRK-040-001 — how a tenant would authorize this connector.
   *
   * Required, and `null` is a legitimate answer that has to be written down:
   * the Relay egress authenticates with a platform credential and has no
   * user-delegated flow at all, which is a different fact from nobody having
   * considered the question. The same reason `maxEngine` and `signatureRef` are
   * `T | null` rather than optional — an absence that means something is a
   * claim, and a claim is stated.
   */
  authorization: ProviderAuthorizationProfile | null
  /**
   * WRK-020-002 — which resources inside the connected workspace are in scope.
   *
   * Optional, and deliberately: the twenty-four `PLANNED` packs select nothing
   * yet because nobody has connected them to a workspace, and a required field
   * would force twenty-four rows to invent a selection. The gate below is on
   * the VALUE — a selector that is present and does not parse is refused — so
   * absence never passes by omission for a connector that has one.
   */
  selector?: ResourceSelector
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
  /**
   * Declared and not started (WRK-100-003).
   *
   * Distinct from `not-published`, which covers DRAFT/SUBMITTED/CERTIFIED — a
   * pack somebody is working on. Collapsing the two would tell an operator
   * asking "when do we get Jira?" the same thing as one asking "when does the
   * finished Jira pack list?", and only one of those has an answer.
   */
  | "planned"
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
   * WRK-040-003. Tenure certified it; the PROVIDER has not — no record, or one
   * that is NOT_SUBMITTED, IN_REVIEW or REJECTED.
   */
  | "provider-review-missing"
  /** The provider approved it once and the approval has lapsed. */
  | "provider-review-expired"
  /**
   * The provider approved it, and this connector asks for scopes the approval
   * does not cover.
   *
   * A separate reason because it is a separate remedy: the first three are
   * "go and get reviewed", this one is "stop asking for that scope". A
   * connector can be fully Tenure-certified and fully provider-approved and
   * still be requesting `https://www.googleapis.com/auth/drive` when the
   * approval covers `drive.file` — which is the difference between reading one
   * folder and reading everything.
   */
  | "scopes-exceed-provider-approval"
  /**
   * WRK-040-001. The pack's authorization profile does not hold up, and each of
   * these is a different remedy — which is why they are four reasons and not
   * one `authorization-invalid`.
   *
   * PKCE is off, so the party redeeming the code is not proved to be the party
   * that started it.
   */
  | "authorization-pkce-required"
  /** An authorize or token endpoint that is not https, or is not a URL at all. */
  | "authorization-endpoint-insecure"
  /** An authorization endpoint on a host the pack's own egress list omits. */
  | "authorization-endpoint-not-egressed"
  /** A redirect path `@tenure/identity`'s open-redirect defence refuses. */
  | "authorization-redirect-refused"
  /** ID-token account verification naming no claim, or with no nonce to bind it. */
  | "authorization-account-unverified"
  /**
   * WRK-020-002. The connector declares a resource selection that does not
   * parse — an empty include set, a dead exclude rule, or a version that did
   * not increase. A connection whose scope nobody can read is one nobody can
   * show an impact diff for.
   */
  | "selector-invalid"

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
  // `claimIsUnproven` rather than the expression: the identical rule governs a
  // capability's `AVAILABLE` claim in `connector-capability.ts`, and one
  // implementation is what stops the two answers drifting apart.
  if (claimIsUnproven(certification.scope, certification.evidenceRefs)) return "absent"

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
  /**
   * The provider's own review record, carried on the verdict for the same
   * reason `disclaimer` is: an operator told `provider-review-missing` needs to
   * know whether that means NOT_SUBMITTED or REJECTED, and those send them to
   * completely different places. Only connectors have one.
   */
  providerReview?: ProviderReview
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

  // Before the generic not-published branch, because "we intend to build this"
  // and "somebody is building this" are different answers to the one question
  // an operator is asking, and the second branch cannot tell them apart.
  if (entry.lifecycle === "PLANNED") {
    return {
      usable: false,
      reason: "planned",
      // Carried even here. A planned pack's disclaimer is the one sentence that
      // stops the row reading as a product — "no connector code, no app
      // registration, no certification exists" — and a refusal that drops it
      // leaves a console showing a vendor name and a status word.
      //
      // Read directly: `ModelLifecycle` has no `PLANNED`, so this branch has
      // already narrowed `entry` to a pack, and `tsc` refuses a `kind ===
      // "model"` guard here as unreachable. A model nobody has integrated is
      // simply absent from the catalog rather than planned in it.
      disclaimer: entry.restrictions?.disclaimer,
    }
  }

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
    // WRK-040-001. The pack's own authorization contract, first among the
    // connector checks. Ordered ahead of the provider's review deliberately: a
    // pack whose redirect is an open redirect, or whose PKCE is off, is broken
    // whatever the provider decided, and reporting `provider-review-missing`
    // for it would send somebody to file a partner application over a defect
    // that lives in this repository.
    //
    // `null` is not a hole. It is the connector saying it has no user-delegated
    // authorization flow, which is true of a platform-credential egress and is
    // refused for a provider pack by the type — `ProviderPackEntry` narrows
    // this field to a required profile, so `tsc` names any pack that omits it.
    if (entry.authorization) {
      const refusal = authorizationRefusal(entry.authorization, entry.egressHosts)
      if (refusal) {
        return { usable: false, reason: refusal, disclaimer, certification }
      }
    }

    // WRK-020-002. What this connection would actually reach. A selection with
    // an empty include set means "everything" to one reader and "nothing" to
    // another, and neither of them can be shown an impact diff — so a selector
    // that does not parse stops the connector reaching an availability decision
    // rather than being rendered beside a green row.
    if (entry.selector && selectorProblems(entry.selector).length > 0) {
      return { usable: false, reason: "selector-invalid", disclaimer, certification }
    }

    // WRK-040-003. The provider's own answer, before the engine range —
    // an integration the provider never approved is not one a newer engine
    // fixes, and reporting `engine-incompatible` would send somebody to
    // upgrade a cell over a problem that lives at Google.
    //
    // `providerActivation` is the single implementation of this rule and lives
    // in `@tenure/platform-config` so `apps/web` can call it too; see the
    // header there. Reusing it means the console and the request path cannot
    // disagree about whether an egress is authorised.
    const activation = providerActivation(
      entry.requestedScopes,
      entry.providerReview,
      context.now,
    )
    if (!activation.activated) {
      return {
        usable: false,
        reason: activation.reason,
        disclaimer,
        certification,
        providerReview: entry.providerReview,
      }
    }

    return engineIsCompatible(context.engineVersion, entry.compatibility)
      ? {
          usable: true,
          reason: "usable",
          disclaimer,
          certification,
          providerReview: entry.providerReview,
        }
      : {
          usable: false,
          reason: "engine-incompatible",
          disclaimer,
          certification,
          providerReview: entry.providerReview,
        }
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
  providerReview?: ProviderReview
  /**
   * WRK-000-002 — the per-(provider, product, capability, direction) rows, each
   * with its seven-state status and whatever is wrong with the classification.
   *
   * On the decision rather than looked up separately by a console, for the same
   * reason `disclaimer` is: one entry-level row saying "not available —
   * uncertified" cannot say that three of this pack's capabilities are
   * `PLANNED`, one is `CERTIFICATION_PENDING` and none is `AVAILABLE`, and a
   * surface that has to join two sources to find out will render whichever it
   * has. Present for connectors, absent for models and extensions, which
   * declare no capabilities.
   */
  capabilities?: readonly ClassifiedCapability[]
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
        // Classified against the closed marketplace too. A third-party pack
        // whose author marked every capability AVAILABLE is making a false
        // claim whether or not the marketplace is open, and hiding the rows
        // until it opens would mean the claim is only checked on the day it
        // starts mattering.
        capabilities:
          entry.kind === "connector"
            ? classifyCapabilities(entry.capabilities, {
                usable: false,
                reason: "marketplace-closed",
              })
            : undefined,
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
      providerReview: verdict.providerReview,
      capabilities:
        entry.kind === "connector"
          ? classifyCapabilities(entry.capabilities, {
              usable: verdict.usable,
              reason: verdict.reason,
            })
          : undefined,
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
 * WRK-130-001 — which of the ten work accelerators the capabilities SELECTED
 * FOR RELEASE actually support, at this scope and this instant.
 *
 * The requirement's checkable clause is "for the exact connector capabilities
 * selected for release", and this is the only place that set is computed: the
 * classified capabilities of every entry, decided through the same gate that
 * decides everything else, rather than a list somebody maintains beside it.
 *
 * Every capability is passed, not only those on offered entries. A capability
 * marked `AVAILABLE` on a connector the gate refuses already carries a
 * `disagrees-with-artifact` problem, and `acceleratorAvailability` counts only
 * capabilities whose classification holds up — so filtering here would be a
 * second, weaker copy of a rule that already exists one function away.
 */
export function acceleratorAvailabilityFor(
  entries: readonly AnyCatalogEntry[],
  context: AvailabilityContext,
): readonly AcceleratorVerdict[] {
  const classified = availabilityDecisions(entries, context).flatMap((d) => d.capabilities ?? [])
  return acceleratorAvailability(WORK_ACCELERATORS, classified)
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
  /**
   * WRK-000-002 — the one thing that actually ships, classified.
   *
   * Not `AVAILABLE`. The code is written, reachable and exercised, and nobody
   * has certified it — which is precisely `CERTIFICATION_PENDING`, and is the
   * status the seven-state vocabulary exists to make sayable. The old
   * vocabulary could only say PUBLISHED, which is what the entry's lifecycle
   * says, and that is the overstatement WRK-GATE-000 is about.
   *
   * `NO_EVIDENCE`, and that is not information lost. The call site
   * (`apps/web/src/lib/ai.ts`) and the partition matrix
   * (`apps/web/src/lib/partition-services.ts`) are what a reader opens to check
   * that the code exists and where it may run — they are not a golden, negative,
   * volume or failure suite, and filing two source paths under a certification
   * clause is how a pack that ran nothing comes to look certified. The status
   * says `CERTIFICATION_PENDING` for exactly this reason; the clause map says
   * the same thing in the shape the gate reads.
   */
  capabilities: [
    {
      provider: "anthropic",
      product: "messages-api",
      capability: "completion",
      // Outbound only. Tenure sends a prompt and reads a response; nothing at
      // Anthropic is read or written as a system of record.
      direction: "write",
      status: "CERTIFICATION_PENDING",
      clauseEvidence: NO_EVIDENCE,
    },
  ],
  // Declared in `@tenure/platform-config` so the cell's request path checks the
  // same list this gate does.
  requestedScopes: RELAY_ANTHROPIC_SCOPES,
  providerReview: RELAY_ANTHROPIC_REVIEW,
  /**
   * WRK-040-001. `null`, stated rather than omitted.
   *
   * No tenant authorizes this connector: `lib/ai.ts` presents a platform
   * credential, and there is no person, no consent screen and no callback. An
   * authorization profile here would describe a flow nobody drives, which is
   * the dead declaration this requirement's whole point is to avoid — and
   * leaving the field off would make "there is no flow" indistinguishable from
   * "nobody wrote one down".
   */
  authorization: null,
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
  // WRK-100-003. The twenty-four packs the Bible names, every one `PLANNED`.
  //
  // This is not the wish list the header above refuses. A wish list is a row
  // that reads as available; these read as `planned` through the same gate that
  // decides everything else, they carry the requirement id that asks for them,
  // and `tests/architecture/provider-packs-bind-requirements.test.mjs` fails if
  // one of them advances past PLANNED while its requirement is still FAIL. The
  // alternative — leaving them out — is what the tree had, and a named
  // requirement with no row anywhere is invisible, which reads exactly like
  // done.
  ...PROVIDER_PACKS,
  ...MODEL_CATALOG,
]
