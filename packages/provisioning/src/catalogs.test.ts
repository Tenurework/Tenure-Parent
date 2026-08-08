import {
  CATALOG_ENTRIES,
  RECERTIFICATION_WARNING_DAYS,
  RELAY_ANTHROPIC_CONNECTOR,
  acceleratorAvailabilityFor,
  authorizationRefusal,
  availabilityDecisions,
  availableToTenants,
  canAdvanceCatalog,
  certificationState,
  engineIsCompatible,
  isUsable,
  validatePackage,
  validateRange,
  type CatalogCertification,
  type CatalogLifecycle,
  type ConnectorEntry,
  type ExtensionEntry,
  type ModelEntry,
  type PackageVersion,
  type ProviderAuthorizationProfile,
} from "./catalogs"
import { PROVIDER_PACKS } from "./provider-packs"
import {
  CERTIFICATION_CLAUSES,
  NO_EVIDENCE,
  capabilityKey,
  capabilityProblems,
  type CertificationClause,
  type CertifiedDirection,
  type ClauseEvidence,
  type ConnectorCapability,
  type EvidenceRef,
} from "./connector-capability"
import { selectorDiff, selectorProblems, type ResourceSelector } from "./resource-selector"
import { WORK_ACCELERATORS } from "./work-accelerators"
import {
  MODEL_CATALOG,
  RELAY_ANTHROPIC_REVIEW,
  allowedModelIds,
  modelIsAllowed,
  type ModelLifecycle,
  type ProviderReview,
} from "@tenure/platform-config"

/**
 * GE-030-005 — the catalogs.
 *
 * Two things carry the weight. Revocation has to stop something working
 * everywhere, immediately, and be un-undoable. And "the marketplace is off" has
 * to be a property of the code rather than of nobody having clicked publish
 * yet — those look identical until the day they do not.
 */
const DIGEST = "a".repeat(64)

const pkg = (over: Partial<PackageVersion> = {}): PackageVersion => ({
  key: "tenure.finance-export",
  version: "1.2.0",
  digest: DIGEST,
  signatureRef: "arn:aws:kms:us-east-1:047385673922:key/abc",
  compatibility: { minEngine: "2026.7.0", maxEngine: null },
  publishedAt: "2026-07-01T00:00:00.000Z",
  ...over,
})

/**
 * A certification that is valid at `NOW` and lapses well outside the warning
 * window, so a test that means to exercise something else is not silently
 * exercising expiry.
 */
const CERTIFIED: CatalogCertification = {
  scope: ["region:us-east-1", "population:students"],
  evidenceRefs: ["review:sec-2026-014", "test-run:pack-suite-2026-07-30"],
  certifiedAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
}

const EXTENSION: ExtensionEntry = {
  kind: "extension",
  key: "tenure.finance-export",
  displayName: "Finance export",
  lifecycle: "PUBLISHED",
  publisher: "platform",
  certification: CERTIFIED,
  versions: [pkg()],
}

/**
 * A provider review that is current at `NOW`, so a test aimed at something else
 * is not silently exercising the activation gate.
 */
const PROVIDER_APPROVED: ProviderReview = {
  program: "Example SIS partner programme",
  state: "APPROVED",
  approvedScopes: ["sis:roster.read", "sis:enrollment.read"],
  verifiedAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
}

/**
 * WRK-100-004. Every clause cited, for the read direction — the shape a pack
 * that has actually been driven through the contract carries.
 *
 * Written as a helper rather than a literal because most tests here are aimed
 * at something else entirely and would otherwise be silently exercising the
 * clause gate. `only` narrows it to a subset, which is what the clause tests
 * need.
 */
const clauseMap = (
  refs: (clause: CertificationClause) => readonly EvidenceRef[],
): ClauseEvidence => ({
  // Spelled out rather than `Object.fromEntries`, which loses the key types and
  // needs a cast — and a cast is where a ninth clause would fail to arrive.
  golden: refs("golden"),
  negative: refs("negative"),
  volume: refs("volume"),
  "failure-outage": refs("failure-outage"),
  "throttling-and-deprecation": refs("throttling-and-deprecation"),
  "deletion-propagation": refs("deletion-propagation"),
  "acl-change-propagation": refs("acl-change-propagation"),
  "scope-exactness": refs("scope-exactness"),
})

const evidenceFor = (
  direction: CertifiedDirection,
  only: readonly CertificationClause[] = CERTIFICATION_CLAUSES,
): ClauseEvidence =>
  clauseMap((clause) =>
    only.includes(clause) ? [{ direction, ref: `test-run:${clause}-${direction}-2026-07` }] : [],
  )

/**
 * A connector authorization profile that holds up at the gate, so a test aimed
 * at certification or provider review is not silently exercising WRK-040-001.
 */
const AUTHORIZED: ProviderAuthorizationProfile = {
  authorizeEndpoint: "https://sis.example.invalid/oauth2/authorize",
  tokenEndpoint: "https://sis.example.invalid/oauth2/token",
  redirectPath: "/api/connections/tenure.sis/callback",
  responseType: "code",
  requiresPkce: true,
  requiresNonce: true,
  accountVerification: "id-token-claim",
  verifiedAccountClaim: "sub",
}

const CONNECTOR: ConnectorEntry = {
  kind: "connector",
  key: "tenure.sis",
  displayName: "Student information system",
  lifecycle: "PUBLISHED",
  publisher: "platform",
  certification: CERTIFIED,
  egressHosts: ["sis.example.invalid"],
  compatibility: { minEngine: "2026.7.0", maxEngine: null },
  capabilities: [
    {
      provider: "example-sis",
      product: "roster",
      capability: "student.list",
      direction: "read",
      status: "AVAILABLE",
      clauseEvidence: evidenceFor("read"),
    },
  ],
  requestedScopes: ["sis:roster.read"],
  providerReview: PROVIDER_APPROVED,
  authorization: AUTHORIZED,
}

const MODEL: ModelEntry = {
  kind: "model",
  key: "anthropic.haiku-4-5",
  displayName: "Claude Haiku 4.5",
  modelId: "claude-haiku-4-5-20251001",
  provider: "anthropic",
  lifecycle: "PUBLISHED",
  publisher: "platform",
  regions: ["us-east-1"],
}

const NOW = "2026-08-01T00:00:00.000Z"
const CTX = { engineVersion: "2026.8.0", region: "us-east-1", partition: "aws", now: NOW }

describe("revocation is terminal, and is checked first", () => {
  it("has no way out", () => {
    // Re-publishing a revoked package must be a NEW package with a new
    // identity, so the revocation stays true about the artifact that earned it.
    for (const to of [
      "DRAFT",
      "SUBMITTED",
      "CERTIFIED",
      "PUBLISHED",
      "DEPRECATED",
    ] as CatalogLifecycle[]) {
      expect(canAdvanceCatalog("REVOKED", to)).toBe(false)
    }
  })

  it("stops an entry working even on a perfectly compatible engine", () => {
    expect(isUsable({ ...EXTENSION, lifecycle: "REVOKED" }, CTX)).toEqual({
      usable: false,
      reason: "revoked",
    })
  })

  it("reports 'revoked' rather than 'incompatible' when both are true", () => {
    // Ordering the compatibility check first would report "incompatible" for a
    // revoked package, which reads as "upgrade and it will work".
    const revokedAndOld = {
      ...EXTENSION,
      lifecycle: "REVOKED" as const,
      versions: [pkg({ compatibility: { minEngine: "2099.1.0", maxEngine: null } })],
    }
    expect(isUsable(revokedAndOld, CTX).reason).toBe("revoked")
  })

  it("can be reached from every other state", () => {
    for (const from of [
      "DRAFT",
      "SUBMITTED",
      "CERTIFIED",
      "PUBLISHED",
      "DEPRECATED",
    ] as CatalogLifecycle[]) {
      expect(canAdvanceCatalog(from, "REVOKED")).toBe(true)
    }
  })

  it("does not let a deprecated entry come back", () => {
    // Bringing it back would silently re-list something somebody deliberately
    // retired.
    expect(canAdvanceCatalog("DEPRECATED", "PUBLISHED")).toBe(false)
    expect(canAdvanceCatalog("DEPRECATED", "CERTIFIED")).toBe(false)
  })
})

describe("deprecated still works; that is what makes it not revoked", () => {
  it("keeps working for whoever already has it", () => {
    // Collapsing deprecated into revoked turns a planned retirement into an
    // outage.
    expect(isUsable({ ...EXTENSION, lifecycle: "DEPRECATED" }, CTX).usable).toBe(true)
  })

  it("does not make an unpublished entry usable", () => {
    for (const lifecycle of ["DRAFT", "SUBMITTED", "CERTIFIED"] as CatalogLifecycle[]) {
      expect(isUsable({ ...EXTENSION, lifecycle }, CTX)).toEqual({
        usable: false,
        reason: "not-published",
      })
    }
  })
})

describe("the marketplace is off as a property of the code", () => {
  const thirdParty: ExtensionEntry = {
    ...EXTENSION,
    key: "acme.gradebook",
    publisher: "third-party",
    lifecycle: "PUBLISHED",
  }

  it("offers no third-party entry, whatever its lifecycle", () => {
    // The bible §0: no third-party publishing, purchasing, installation,
    // billing or executable package intake until certification, sandboxing,
    // entitlement, billing, security review, revocation and support are
    // complete. Gating on lifecycle instead would mean one mis-set PUBLISHED
    // opens third-party code intake.
    for (const lifecycle of [
      "DRAFT",
      "SUBMITTED",
      "CERTIFIED",
      "PUBLISHED",
      "DEPRECATED",
      "REVOKED",
    ] as CatalogLifecycle[]) {
      expect(
        availableToTenants([{ ...thirdParty, lifecycle }], {
          ...CTX,
          marketplaceEnabled: false,
        }),
      ).toEqual([])
    }
  })

  it("still offers first-party entries", () => {
    expect(
      availableToTenants([EXTENSION, CONNECTOR, MODEL], { ...CTX, marketplaceEnabled: false }).map(
        (e) => e.key,
      ),
    ).toEqual(["tenure.finance-export", "tenure.sis", "anthropic.haiku-4-5"])
  })

  it("would offer a certified third-party entry once the marketplace is on, and still not a revoked one", () => {
    // The shape of the eventual behaviour, so turning it on is a change to one
    // parameter rather than a redesign.
    expect(
      availableToTenants([thirdParty], { ...CTX, marketplaceEnabled: true }).map((e) => e.key),
    ).toEqual(["acme.gradebook"])
    expect(
      availableToTenants([{ ...thirdParty, lifecycle: "REVOKED" }], {
        ...CTX,
        marketplaceEnabled: true,
      }),
    ).toEqual([])
  })
})

describe("compatibility", () => {
  it("accepts an engine inside the range, inclusive at both ends", () => {
    const range = { minEngine: "2026.7.0", maxEngine: "2026.9.0" }
    expect(engineIsCompatible("2026.7.0", range)).toBe(true)
    expect(engineIsCompatible("2026.8.0", range)).toBe(true)
    expect(engineIsCompatible("2026.9.0", range)).toBe(true)
  })

  it("refuses an engine outside it", () => {
    const range = { minEngine: "2026.7.0", maxEngine: "2026.9.0" }
    expect(engineIsCompatible("2026.6.9", range)).toBe(false)
    expect(engineIsCompatible("2026.9.1", range)).toBe(false)
  })

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings, so a string compare calls 1.10.0 older than 1.9.0
    // — a bug that only shows on the tenth minor.
    expect(engineIsCompatible("1.10.0", { minEngine: "1.9.0", maxEngine: null })).toBe(true)
  })

  it("fails closed on an unparseable version, on either side", () => {
    expect(engineIsCompatible("unpinned", { minEngine: "2026.7.0", maxEngine: null })).toBe(false)
    expect(engineIsCompatible("2026.8.0", { minEngine: "whenever", maxEngine: null })).toBe(false)
    expect(engineIsCompatible("2026.8.0", { minEngine: "2026.7.0", maxEngine: "later" })).toBe(false)
  })

  it("refuses a range that ends before it begins", () => {
    // Matches no engine at all, so the package is uninstallable everywhere and
    // looks merely incompatible.
    expect(
      validateRange({ minEngine: "2026.9.0", maxEngine: "2026.7.0" }).map((p) => p.field),
    ).toContain("maxEngine")
  })

  it("picks the newest compatible version when none is named", () => {
    const many: ExtensionEntry = {
      ...EXTENSION,
      versions: [
        pkg({ version: "1.0.0", compatibility: { minEngine: "2026.1.0", maxEngine: "2026.6.0" } }),
        pkg({ version: "1.9.0", compatibility: { minEngine: "2026.7.0", maxEngine: null } }),
        pkg({ version: "1.10.0", compatibility: { minEngine: "2026.7.0", maxEngine: null } }),
      ],
    }
    // The NEWEST compatible one. Asserting only `usable` cannot tell
    // newest-from-oldest, and a mutation swapping the sort passed until this
    // named the version.
    expect(isUsable(many, CTX)).toMatchObject({ usable: true, resolvedVersion: "1.10.0" })
    // 1.10.0 over 1.9.0 is also the numeric-vs-string check: a string sort puts
    // "1.9.0" after "1.10.0".
    // And nothing at all when every version is out of range.
    expect(
      isUsable(
        {
          ...EXTENSION,
          versions: [pkg({ compatibility: { minEngine: "2099.1.0", maxEngine: null } })],
        },
        CTX,
      ).reason,
    ).toBe("engine-incompatible")
  })
})

describe("packages must be signed and digested", () => {
  it("accepts a well-formed package", () => {
    expect(validatePackage(pkg())).toEqual([])
  })

  it("refuses an unsigned package", () => {
    // "We trusted the registry we fetched it from" is the supply-chain
    // assumption that keeps failing.
    expect(validatePackage(pkg({ signatureRef: null })).map((p) => p.field)).toContain(
      "signatureRef",
    )
    expect(isUsable({ ...EXTENSION, versions: [pkg({ signatureRef: null })] }, CTX)).toMatchObject({
      usable: false,
      reason: "unsigned",
      // Named even in refusal: an operator needs to know WHICH version is
      // unsigned to go and sign it.
      resolvedVersion: "1.2.0",
    })
  })

  it("refuses a digest that is not sha256", () => {
    for (const bad of ["", "abc", DIGEST.toUpperCase(), "z".repeat(64)]) {
      expect(validatePackage(pkg({ digest: bad })).map((p) => p.field)).toContain("digest")
    }
  })

  it("refuses a version that is not a version", () => {
    expect(validatePackage(pkg({ version: "latest" })).map((p) => p.field)).toContain("version")
  })
})

describe("models are checked against the region they would be invoked from", () => {
  it("refuses a model not available in this region", () => {
    // A European cell calling a us-east-1-only model either fails or, worse,
    // succeeds by routing tenant content out of the region residency promised.
    expect(isUsable(MODEL, { engineVersion: "2026.8.0", region: "eu-west-1", now: NOW })).toEqual({
      usable: false,
      reason: "region-not-allowed",
    })
    expect(isUsable(MODEL, CTX).usable).toBe(true)
  })

  it("treats '*' as every region, which is what a global endpoint is", () => {
    expect(modelIsAllowed(MODEL_CATALOG[0].modelId, "eu-west-1")).toBe(true)
  })

  it("refuses a region-limited model outside its regions", () => {
    // Every shipped entry is "*", so this branch is unreachable against the
    // real catalog — which is why the catalog is a parameter. A mutation
    // deleting the region check passed the whole suite until this existed.
    const limited = [{ ...MODEL, regions: ["us-east-1"] }]
    expect(modelIsAllowed(MODEL.modelId, "us-east-1", limited)).toBe(true)
    expect(modelIsAllowed(MODEL.modelId, "eu-west-1", limited)).toBe(false)
  })

  it("refuses a revoked model even though its id is in the catalog", () => {
    // Same reason: nothing shipped is revoked, so the branch needs a catalog a
    // test can supply.
    const revoked = [{ ...MODEL, lifecycle: "REVOKED" as const, regions: ["*"] }]
    expect(modelIsAllowed(MODEL.modelId, "us-east-1", revoked)).toBe(false)
  })

  it("refuses a model that is only draft or submitted", () => {
    // `ModelLifecycle[]`, not `CatalogLifecycle[]`: models have no `PLANNED`
    // state — a model nobody has integrated is simply not in the catalog —
    // and the two vocabularies stopped being the same list when packs gained
    // one (WRK-100-003).
    for (const lifecycle of ["DRAFT", "SUBMITTED", "CERTIFIED"] as ModelLifecycle[]) {
      expect(modelIsAllowed(MODEL.modelId, "us-east-1", [{ ...MODEL, lifecycle }])).toBe(false)
    }
    // Deprecated still answers, like every other deprecated entry.
    expect(
      modelIsAllowed(MODEL.modelId, "us-east-1", [{ ...MODEL, lifecycle: "DEPRECATED" }]),
    ).toBe(true)
  })

  it("refuses a model that is not in the catalog at all", () => {
    // The whole reason the catalog exists: ANTHROPIC_MODEL used to be sent
    // unchecked, so a typo, a plausible-but-wrong id, or an unreviewed model
    // all went on the wire against tenant content.
    expect(modelIsAllowed("claude-haiku-4-5-2025100", "us-east-1")).toBe(false)
    expect(modelIsAllowed("gpt-4", "us-east-1")).toBe(false)
    expect(modelIsAllowed("", "us-east-1")).toBe(false)
  })

  it("allows exactly what the catalog lists", () => {
    for (const id of allowedModelIds()) {
      expect(modelIsAllowed(id, "us-east-1")).toBe(true)
    }
    expect(allowedModelIds().length).toBeGreaterThan(0)
  })

  it("lists only first-party, published models", () => {
    // A catalog carrying models nobody reviewed is a wish list, and a wish list
    // that gates production looks like a control.
    for (const model of MODEL_CATALOG) {
      expect(model.publisher).toBe("platform")
      expect(model.lifecycle).toBe("PUBLISHED")
    }
  })
})

/* ------------------------------------------------------------ PACK-080-003 --
 * Certification is a dated fact with a scope and evidence, and it lapses.
 */
describe("certification has scope, evidence and an end", () => {
  const DAY = 24 * 60 * 60 * 1000
  const shift = (from: string, ms: number) => new Date(Date.parse(from) + ms).toISOString()

  it("refuses a published entry that nobody ever certified", () => {
    // `CERTIFIED` used to be a lifecycle word and nothing else, so an entry
    // could reach PUBLISHED carrying no record of what was reviewed.
    const { certification, ...uncertified } = EXTENSION
    expect(certification).toBeDefined() // the fixture really did carry one
    expect(isUsable(uncertified, CTX)).toMatchObject({ usable: false, reason: "uncertified" })
  })

  it("refuses one whose certification has lapsed", () => {
    const lapsed = {
      ...EXTENSION,
      certification: { ...CERTIFIED, expiresAt: shift(NOW, -1000) },
    }
    expect(isUsable(lapsed, CTX)).toMatchObject({
      usable: false,
      reason: "certification-expired",
      certification: "expired",
    })
  })

  it("expires at the instant, not the day after", () => {
    // A gate written `>` rather than `>=` leaves an entry usable for the whole
    // instant it expires, and every off-by-one in a credential check is that.
    const atExpiry = { ...EXTENSION, certification: { ...CERTIFIED, expiresAt: NOW } }
    expect(isUsable(atExpiry, CTX).usable).toBe(false)
  })

  it("treats a certification with no scope or no evidence as none at all", () => {
    // Both fields are required by the bible and would otherwise be decorative:
    // a record naming nothing certifies everything, and one citing nothing is
    // an assertion.
    expect(certificationState({ ...CERTIFIED, scope: [] }, NOW)).toBe("absent")
    expect(certificationState({ ...CERTIFIED, evidenceRefs: [] }, NOW)).toBe("absent")
    expect(certificationState(undefined, NOW)).toBe("absent")
  })

  it("fails closed on an expiry nobody can read", () => {
    expect(certificationState({ ...CERTIFIED, expiresAt: "soon" }, NOW)).toBe("expired")
    expect(certificationState(CERTIFIED, "whenever")).toBe("expired")
  })

  it("triggers re-certification before the lapse, not on it", () => {
    // A trigger that fires on expiry is an outage notice.
    const inside = shift(NOW, (RECERTIFICATION_WARNING_DAYS - 1) * DAY)
    const outside = shift(NOW, (RECERTIFICATION_WARNING_DAYS + 1) * DAY)
    expect(certificationState({ ...CERTIFIED, expiresAt: inside }, NOW)).toBe("expiring")
    expect(certificationState({ ...CERTIFIED, expiresAt: outside }, NOW)).toBe("current")
    // Still usable while expiring — a warning is not a refusal.
    expect(
      isUsable({ ...EXTENSION, certification: { ...CERTIFIED, expiresAt: inside } }, CTX),
    ).toMatchObject({ usable: true, certification: "expiring" })
  })

  it("decides from the `now` it is given rather than from a clock", () => {
    // The whole reason `now` is a parameter: "was this usable when we shipped
    // it?" has to be answerable, and a gate reading Date.now() cannot answer.
    const entry = { ...EXTENSION, certification: { ...CERTIFIED, expiresAt: "2026-09-01T00:00:00.000Z" } }
    expect(isUsable(entry, { ...CTX, now: "2026-07-15T00:00:00.000Z" }).usable).toBe(true)
    expect(isUsable(entry, { ...CTX, now: "2026-10-15T00:00:00.000Z" }).usable).toBe(false)
  })

  it("keeps a lapsed entry out of what a tenant is offered", () => {
    const lapsed = {
      ...EXTENSION,
      certification: { ...CERTIFIED, expiresAt: shift(NOW, -1000) },
    }
    expect(
      availableToTenants([lapsed], { ...CTX, marketplaceEnabled: false }).map((e) => e.key),
    ).toEqual([])
    expect(
      availableToTenants([EXTENSION], { ...CTX, marketplaceEnabled: false }).map((e) => e.key),
    ).toEqual(["tenure.finance-export"])
  })
})

/* ------------------------------------------------------------ PACK-050-004 --
 * Hard availability gates and the disclaimer that has to travel with them.
 */
describe("availability is decided per scope and carries its disclaimer", () => {
  const RESTRICTED: ConnectorEntry = {
    ...CONNECTOR,
    key: "tenure.restricted",
    restrictions: {
      region: ["us-east-1"],
      disclaimer: "Reviewed for us-east-1 only; no data-processing review exists for the EU.",
    },
  }

  it("refuses a connector outside the regions it was reviewed for", () => {
    // Region gating used to exist for models and for nothing else, so a
    // connector was offered in every jurisdiction whatever anybody had reviewed.
    expect(isUsable(RESTRICTED, { ...CTX, region: "eu-west-1" })).toMatchObject({
      usable: false,
      reason: "region-not-allowed",
    })
    expect(isUsable(RESTRICTED, CTX).usable).toBe(true)
  })

  it("drops it out of availableToTenants for that region", () => {
    expect(
      availableToTenants([RESTRICTED], {
        ...CTX,
        region: "eu-west-1",
        marketplaceEnabled: false,
      }),
    ).toEqual([])
  })

  it("carries the disclaimer on the decision whether or not it passed", () => {
    // So a surface cannot render an availability label without the text that
    // qualifies it — the label and the caveat are one object.
    for (const region of ["us-east-1", "eu-west-1"]) {
      const [decision] = availabilityDecisions([RESTRICTED], {
        ...CTX,
        region,
        marketplaceEnabled: false,
      })
      expect(decision.disclaimer).toBe(RESTRICTED.restrictions!.disclaimer)
    }
  })

  it("records the exact scope the decision was made for", () => {
    // Bible §5: a module can be available in the US and unavailable for one
    // German legal entity, and only a scoped decision can say both.
    const [decision] = availabilityDecisions([RESTRICTED], { ...CTX, marketplaceEnabled: false })
    expect(decision.scope).toEqual({
      region: "us-east-1",
      partition: "aws",
      engineVersion: "2026.8.0",
      at: NOW,
    })
  })

  it("refuses an egress in a partition it was never reviewed for", () => {
    // The real shape of the shipped restriction: `api.anthropic.com` does not
    // exist in GovCloud or China, and sending student records from a GovCloud
    // cell to a commercial SaaS endpoint is the failure GovCloud was chosen to
    // prevent.
    const commercialOnly: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.egress",
      restrictions: { partition: ["aws"], disclaimer: "Commercial partition only." },
    }
    expect(isUsable(commercialOnly, CTX).usable).toBe(true)
    expect(isUsable(commercialOnly, { ...CTX, partition: "aws-us-gov" })).toMatchObject({
      usable: false,
      reason: "partition-not-allowed",
    })
  })

  it("refuses it when the caller cannot say which partition it is in", () => {
    // Absent is not commercial. Defaulting here is the exact assumption
    // `partition-services.ts` exists to delete.
    const commercialOnly: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.egress",
      restrictions: { partition: ["aws"] },
    }
    const { partition: _dropped, ...noPartition } = CTX
    expect(isUsable(commercialOnly, noPartition)).toMatchObject({
      usable: false,
      reason: "partition-not-allowed",
    })
  })

  it("reports the partition before the region, because it is the coarser fact", () => {
    // "Not in this partition at all" and "not in this region of it" send an
    // operator to different places.
    const both: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.both",
      restrictions: { partition: ["aws"], region: ["us-east-1"] },
    }
    expect(
      isUsable(both, { ...CTX, partition: "aws-cn", region: "cn-north-1" }).reason,
    ).toBe("partition-not-allowed")
  })

  it("says marketplace-closed rather than pretending the entry does not exist", () => {
    const [decision] = availabilityDecisions(
      [{ ...EXTENSION, publisher: "third-party" as const }],
      { ...CTX, marketplaceEnabled: false },
    )
    expect(decision).toMatchObject({ available: false, reason: "marketplace-closed" })
  })

  it("reads a model's '*' as every region, the way modelIsAllowed does", () => {
    // The two gate the same catalog. A wildcard that means "everywhere" in one
    // and "a region literally called *" in the other silently stops offering a
    // model that is perfectly allowed.
    expect(isUsable({ ...MODEL, regions: ["*"] }, { ...CTX, region: "eu-west-1" }).usable).toBe(true)
  })
})

describe("the gate runs over a real catalog", () => {
  it("holds the connectors that have a call site, and no wish list", () => {
    // A filter with no list is a control that cannot be wrong. This is the list.
    expect(CATALOG_ENTRIES.length).toBeGreaterThan(0)
    expect(CATALOG_ENTRIES.map((e) => e.key)).toContain("tenure.relay-anthropic")
    expect(RELAY_ANTHROPIC_CONNECTOR.egressHosts).toEqual(["api.anthropic.com"])
  })

  it("restricts the Relay egress to the partition that can reach it", () => {
    // Not a region list. `partition-services.ts` is the decision this mirrors,
    // and an incomplete list of one partition's regions compiled into the
    // product is what `tests/security/no-hardcoded-estate.test.mjs` refuses.
    expect(RELAY_ANTHROPIC_CONNECTOR.restrictions?.partition).toEqual(["aws"])
    expect(RELAY_ANTHROPIC_CONNECTOR.restrictions?.region).toBeUndefined()
  })

  it("refuses the Relay connector as uncertified, because nobody has certified it", () => {
    // The honest state, not a placeholder: writing a certifiedAt here would be
    // a claim about a review that did not happen (PACK-000-004).
    const decision = availabilityDecisions(CATALOG_ENTRIES, {
      engineVersion: "2026.8.0",
      region: "us-east-1",
      partition: "aws",
      marketplaceEnabled: false,
      now: NOW,
    }).find((d) => d.entry.key === "tenure.relay-anthropic")!

    expect(decision.available).toBe(false)
    expect(decision.reason).toBe("uncertified")
    // And the operator is told where the data would go, in the same object.
    expect(decision.disclaimer).toMatch(/api\.anthropic\.com/)
  })

  it("still offers the reviewed models, so the gate is not refusing everything", () => {
    // A gate that refuses its whole catalog proves nothing about the gate.
    const offered = availableToTenants(CATALOG_ENTRIES, {
      engineVersion: "2026.8.0",
      region: "us-east-1",
      partition: "aws",
      marketplaceEnabled: false,
      now: NOW,
    })
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((e) => e.kind === "model")).toBe(true)
  })
})

/* ------------------------------------------------------------- WRK-000-002 --
 * Every provider/product/capability/direction classified in the seven-state
 * vocabulary, with evidence — and asserted on what `availabilityDecisions`
 * EMITS, because a helper called directly stays green when the production
 * caller stops calling it.
 */
describe("each provider/product/capability/direction carries a status and its evidence", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  const relayDecision = () =>
    availabilityDecisions(CATALOG_ENTRIES, SCOPE).find(
      (d) => d.entry.key === "tenure.relay-anthropic",
    )!

  it("classifies the one capability that actually ships, and does not overstate it", () => {
    // CERTIFICATION_PENDING, not AVAILABLE. The code is written and reachable
    // and nobody has certified it, which is a state the old DRAFT/SUBMITTED/
    // CERTIFIED vocabulary could not say at all.
    expect(relayDecision().capabilities).toEqual([
      {
        provider: "anthropic",
        product: "messages-api",
        capability: "completion",
        direction: "write",
        status: "CERTIFICATION_PENDING",
        clauseEvidence: NO_EVIDENCE,
        // Derived from the clause map by `classifyCapabilities`, which is the
        // only place it is computed — the System Studio prints this and there
        // is no second stored copy for it to drift from.
        evidenceRefs: [],
        problems: [],
      },
    ])
  })

  it("covers the whole vocabulary, so nothing the Bible names is unsayable", () => {
    // Seven states, exactly. A missing one is a fact somebody will express by
    // picking the nearest word, which is how DEGRADED becomes AVAILABLE.
    const declared: ConnectorCapability["status"][] = [
      "PLANNED",
      "DEVELOPMENT",
      "CERTIFICATION_PENDING",
      "AVAILABLE",
      "DEGRADED",
      "SUSPENDED",
      "UNSUPPORTED",
    ]
    for (const status of declared) {
      const cap: ConnectorCapability = {
        provider: "p",
        product: "q",
        capability: "c",
        direction: "read",
        status,
        // The full contract, so this test is about the seven-state vocabulary
        // and not about WRK-100-004's clause gate — which has its own suite.
        clauseEvidence: evidenceFor("read"),
      }
      // Only the two running statuses are held to anything; the other five are
      // claims about work not done and prove nothing by construction.
      expect(capabilityProblems(cap, { usable: true, reason: "usable" })).toEqual([])
    }
  })

  it("refuses an AVAILABLE claim nobody can retrace", () => {
    const entry: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.unevidenced",
      capabilities: [{ ...CONNECTOR.capabilities[0], clauseEvidence: NO_EVIDENCE }],
    }
    const [decision] = availabilityDecisions([entry], SCOPE)

    expect(decision.available).toBe(true)
    // The artifact passes and the capability's own claim does not. Both facts
    // in one object, because a console holding only the first shows a green row.
    const reasons = decision.capabilities?.[0].problems.map((p) => p.reason) ?? []
    expect(reasons[0]).toBe("evidence-missing")
    // And every clause under it, because "nothing is cited" and "the volume
    // suite is missing" are different findings with different remedies.
    expect(reasons.filter((r) => r === "clause-unproven")).toHaveLength(
      CERTIFICATION_CLAUSES.length,
    )
  })

  it("refuses a status that disagrees with the artifact-level verdict", () => {
    // The failure this whole requirement exists to stop: a green capability row
    // on a connector the catalog gate refuses.
    const entry: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.disagrees",
      certification: undefined,
    }
    const [decision] = availabilityDecisions([entry], SCOPE)

    expect(decision.available).toBe(false)
    expect(decision.reason).toBe("uncertified")
    expect(decision.capabilities?.[0].problems.map((p) => p.reason)).toEqual([
      "disagrees-with-artifact",
    ])
    expect(decision.capabilities?.[0].problems[0].detail).toContain("uncertified")
  })

  it("does not complain about a PLANNED capability on a refused connector", () => {
    // Nobody has to prove they have not built something. Every planned pack
    // would otherwise emit a problem apiece, which is 24 findings that mean
    // nothing and hide the one that does.
    const planned = availabilityDecisions(CATALOG_ENTRIES, SCOPE).filter(
      (d) => d.reason === "planned",
    )
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.flatMap((d) => d.capabilities ?? []).flatMap((c) => c.problems)).toEqual([])
  })
})

/* ------------------------------------------------------------- WRK-100-003 --
 * Unbuilt packs are PLANNED, and PLANNED is refused with its own reason.
 */
describe("planned packs are listed, bound to a requirement, and refused as planned", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  it("returns `planned` for a planned pack, not `not-published`", () => {
    // Two different answers to "when do we get Jira?". `not-published` covers
    // DRAFT/SUBMITTED/CERTIFIED — work somebody is doing — and collapsing them
    // tells an operator the pack is nearly ready when nobody has started.
    const jira = availabilityDecisions(CATALOG_ENTRIES, SCOPE).find(
      (d) => d.entry.key === "atlassian.jira",
    )!
    expect(jira.available).toBe(false)
    expect(jira.reason).toBe("planned")
    expect(jira.disclaimer).toMatch(/No connector code/)
  })

  it("lists every named provider, and offers none of them", () => {
    expect(PROVIDER_PACKS).toHaveLength(24)
    const decisions = availabilityDecisions(CATALOG_ENTRIES, SCOPE)
    for (const pack of PROVIDER_PACKS) {
      const decision = decisions.find((d) => d.entry.key === pack.key)!
      expect(decision.available).toBe(false)
      expect(decision.reason).toBe("planned")
      expect(pack.requirementIds.length).toBeGreaterThan(0)
    }
  })

  it("keeps PLANNED out of the middle of the pipeline", () => {
    // Entered from nowhere, left only for DRAFT or REVOKED. A pack that has
    // been started must not be able to become un-started.
    expect(canAdvanceCatalog("PLANNED", "DRAFT")).toBe(true)
    expect(canAdvanceCatalog("PLANNED", "REVOKED")).toBe(true)
    expect(canAdvanceCatalog("PLANNED", "PUBLISHED")).toBe(false)
    expect(canAdvanceCatalog("PLANNED", "CERTIFIED")).toBe(false)
    for (const from of ["DRAFT", "SUBMITTED", "CERTIFIED", "PUBLISHED", "DEPRECATED"] as CatalogLifecycle[]) {
      expect(canAdvanceCatalog(from, "PLANNED")).toBe(false)
    }
  })
})

/* ------------------------------------------------------------- WRK-040-003 --
 * The PROVIDER's review, as an activation gate.
 */
describe("a provider's own review gates activation", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  it("refuses a published connector the provider never reviewed", () => {
    // Passing by omission is the failure: a connector Tenure certified, with no
    // record at all of what the provider said, used to be `usable`.
    const { providerReview: _none, ...unreviewed } = CONNECTOR
    expect(isUsable(unreviewed, CTX)).toMatchObject({
      usable: false,
      reason: "provider-review-missing",
    })
  })

  it("refuses scopes the provider's approval does not cover", () => {
    // The reason this is separate from the one above: a connector can be fully
    // Tenure-certified and fully provider-approved and still be asking for
    // `drive` when the approval covers `drive.file`.
    const overreaching: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.overreach",
      requestedScopes: ["sis:roster.read", "sis:grades.write"],
    }
    expect(isUsable(overreaching, CTX)).toMatchObject({
      usable: false,
      reason: "scopes-exceed-provider-approval",
    })

    // Widen the approval and the same connector passes, so the refusal is the
    // subset test and not the connector being broken some other way.
    expect(
      isUsable(
        {
          ...overreaching,
          providerReview: {
            ...PROVIDER_APPROVED,
            approvedScopes: [...PROVIDER_APPROVED.approvedScopes, "sis:grades.write"],
          },
        },
        CTX,
      ).usable,
    ).toBe(true)
  })

  it("refuses an approval that has lapsed, and says so distinctly", () => {
    const lapsed: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.lapsed",
      providerReview: { ...PROVIDER_APPROVED, expiresAt: "2026-07-31T00:00:00.000Z" },
    }
    expect(isUsable(lapsed, CTX).reason).toBe("provider-review-expired")
  })

  it("carries the review record onto the decision, so NOT_SUBMITTED and REJECTED are told apart", () => {
    const rejected: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.rejected",
      providerReview: { ...PROVIDER_APPROVED, state: "REJECTED" },
    }
    const [decision] = availabilityDecisions([rejected], SCOPE)
    expect(decision.reason).toBe("provider-review-missing")
    // Both are "not approved" and they send an operator to completely
    // different places. The reason alone cannot say which.
    expect(decision.providerReview?.state).toBe("REJECTED")
  })

  it("records honestly that nobody has reviewed the Relay egress", () => {
    expect(RELAY_ANTHROPIC_REVIEW.state).toBe("NOT_SUBMITTED")
    expect(RELAY_ANTHROPIC_REVIEW.approvedScopes).toEqual([])
    // Certification is still the first thing wrong with it, and the gate says
    // the first thing rather than the most recently added one.
    expect(isUsable(RELAY_ANTHROPIC_CONNECTOR, CTX).reason).toBe("uncertified")
  })
})

describe("connectors record where they send data", () => {
  it("carries its egress hosts", () => {
    // An outbound integration is an egress, and "which hosts does this tenant's
    // data reach" is asked in every security review.
    expect(CONNECTOR.egressHosts).toEqual(["sis.example.invalid"])
  })

  it("is refused on an engine outside its range", () => {
    expect(
      isUsable({ ...CONNECTOR, compatibility: { minEngine: "2099.1.0", maxEngine: null } }, CTX)
        .reason,
    ).toBe("engine-incompatible")
  })
})

/* ------------------------------------------------------------- WRK-100-004 --
 * The FULL certification contract, not a generic happy path.
 *
 * The gate used to check two things: somebody cited something, and the artifact
 * gate agreed. One citation of any kind satisfied the first, so a pack citing a
 * single smoke run passed the same gate as one driven through golden, negative,
 * volume and failure suites. These assert on what `availabilityDecisions`
 * EMITS, not on `capabilityProblems` called directly, so a production path that
 * stopped calling it would red here.
 */
describe("a pack must prove every certification clause, in every direction it claims", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  const withCapability = (capability: ConnectorCapability): ConnectorEntry => ({
    ...CONNECTOR,
    key: "tenure.clause-gate",
    capabilities: [capability],
  })

  it("declares the eight clauses the Bible asks for", () => {
    // A count, and the names. Deleting one is how the contract quietly becomes
    // a happy path again — and the mutation that proves this assertion is
    // load-bearing is exactly that deletion.
    expect(CERTIFICATION_CLAUSES).toHaveLength(8)
    expect([...CERTIFICATION_CLAUSES]).toEqual([
      "golden",
      "negative",
      "volume",
      "failure-outage",
      "throttling-and-deprecation",
      "deletion-propagation",
      "acl-change-propagation",
      "scope-exactness",
    ])
    // And the "nothing cited" constant answers for all of them, so a planned
    // pack states each clause rather than omitting keys.
    expect(Object.keys(NO_EVIDENCE).sort()).toEqual([...CERTIFICATION_CLAUSES].sort())
  })

  it("emits seven clause problems for a pack that ran only the golden suite", () => {
    const entry = withCapability({
      ...CONNECTOR.capabilities[0],
      status: "AVAILABLE",
      clauseEvidence: evidenceFor("read", ["golden"]),
    })
    const [decision] = availabilityDecisions([entry], SCOPE)

    const problems = decision.capabilities?.[0].problems ?? []
    // Something IS cited, so the old gate is silent — which is the whole point.
    expect(problems.filter((p) => p.reason === "evidence-missing")).toEqual([])
    const unproven = problems.filter((p) => p.reason === "clause-unproven")
    expect(unproven).toHaveLength(7)
    expect(unproven.map((p) => p.clause)).toEqual([
      "negative",
      "volume",
      "failure-outage",
      "throttling-and-deprecation",
      "deletion-propagation",
      "acl-change-propagation",
      "scope-exactness",
    ])
    // Named, so a console can say which suite is missing rather than "evidence".
    expect(unproven.every((p) => p.direction === "read")).toBe(true)
  })

  it("says nothing when all eight clauses are cited", () => {
    const entry = withCapability({
      ...CONNECTOR.capabilities[0],
      status: "AVAILABLE",
      clauseEvidence: evidenceFor("read"),
    })
    expect(availabilityDecisions([entry], SCOPE)[0].capabilities?.[0].problems).toEqual([])
  })

  it("refuses a write claim proved only by read runs", () => {
    // The file's own note: read and write are separately certifiable, and a
    // pack certified to read a mailbox has not been certified to send from it.
    // Nothing checked this before — the array was flat and a direction was not
    // a thing an evidence ref could carry.
    const entry = withCapability({
      ...CONNECTOR.capabilities[0],
      direction: "bidirectional",
      status: "AVAILABLE",
      clauseEvidence: evidenceFor("read"),
    })
    const problems = availabilityDecisions([entry], SCOPE)[0].capabilities?.[0].problems ?? []

    expect(problems.filter((p) => p.reason === "evidence-missing")).toEqual([])
    const unproven = problems.filter((p) => p.reason === "clause-unproven")
    expect(unproven).toHaveLength(CERTIFICATION_CLAUSES.length)
    expect(new Set(unproven.map((p) => p.direction))).toEqual(new Set(["write"]))
  })

  it("passes a bidirectional pack that proved both directions", () => {
    const both: ClauseEvidence = clauseMap((clause) => [
      { direction: "read", ref: `test-run:${clause}-read` },
      { direction: "write", ref: `test-run:${clause}-write` },
    ])

    const entry = withCapability({
      ...CONNECTOR.capabilities[0],
      direction: "bidirectional",
      status: "AVAILABLE",
      clauseEvidence: both,
    })
    expect(availabilityDecisions([entry], SCOPE)[0].capabilities?.[0].problems).toEqual([])
  })

  it("holds a DEGRADED claim to the same contract, and asks nothing of the other five", () => {
    // DEGRADED also says this runs against the provider today. The other five
    // states are claims about work not done and prove nothing by construction.
    const degraded = withCapability({
      ...CONNECTOR.capabilities[0],
      status: "DEGRADED",
      clauseEvidence: evidenceFor("read", ["golden"]),
    })
    expect(
      availabilityDecisions([degraded], SCOPE)[0]
        .capabilities?.[0].problems.filter((p) => p.reason === "clause-unproven"),
    ).toHaveLength(7)

    for (const status of ["PLANNED", "DEVELOPMENT", "CERTIFICATION_PENDING", "SUSPENDED", "UNSUPPORTED"] as const) {
      const entry = withCapability({
        ...CONNECTOR.capabilities[0],
        status,
        clauseEvidence: NO_EVIDENCE,
      })
      expect(availabilityDecisions([entry], SCOPE)[0].capabilities?.[0].problems).toEqual([])
    }
  })

  it("keeps one implementation of the evidence rule, and derives the flat list from it", () => {
    // `claimIsUnproven` is called by `certificationState` for a certification
    // record and by `capabilityProblems` for a capability. The flat
    // `evidenceRefs` a console prints is derived here rather than stored, so
    // there is no second copy to drift.
    const entry = withCapability({
      ...CONNECTOR.capabilities[0],
      status: "AVAILABLE",
      clauseEvidence: evidenceFor("read", ["golden", "negative"]),
    })
    expect(availabilityDecisions([entry], SCOPE)[0].capabilities?.[0].evidenceRefs).toEqual([
      "test-run:golden-read-2026-07",
      "test-run:negative-read-2026-07",
    ])
  })

  it("leaves every declared pack citing nothing, which is the honest state", () => {
    // Not one of the twenty-four has been built, so not one of them cites a
    // clause. This reds the day somebody advances a pack without the runs.
    for (const pack of PROVIDER_PACKS) {
      for (const capability of pack.capabilities) {
        expect(capability.status).toBe("PLANNED")
        expect(capability.clauseEvidence).toEqual(NO_EVIDENCE)
      }
    }
  })
})

/* ------------------------------------------------------------- WRK-040-001 --
 * Provider-specific authorization profiles, gated rather than merely declared.
 */
describe("a pack states how it would be authorized, and the gate reads it", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  const withAuthorization = (over: Partial<ProviderAuthorizationProfile>): ConnectorEntry => ({
    ...CONNECTOR,
    key: "tenure.authorization",
    authorization: { ...AUTHORIZED, ...over },
  })

  it("refuses a pack whose authorize endpoint is on a host it never declared", () => {
    // An authorization host outside the pack's own egress list is an egress
    // nobody reviewed: the connector would be approved to talk to the API and
    // would in fact first talk to somewhere else entirely.
    const [decision] = availabilityDecisions(
      [withAuthorization({ authorizeEndpoint: "https://idp.elsewhere.invalid/authorize" })],
      SCOPE,
    )
    expect(decision.available).toBe(false)
    expect(decision.reason).toBe("authorization-endpoint-not-egressed")
  })

  it("refuses a pack with PKCE off", () => {
    const [decision] = availabilityDecisions([withAuthorization({ requiresPkce: false })], SCOPE)
    expect(decision.available).toBe(false)
    expect(decision.reason).toBe("authorization-pkce-required")
  })

  it("refuses a redirect the identity package's open-redirect defence rejects", () => {
    // `//evil.example` looks like a path, starts with a slash, and browsers
    // navigate to another origin. This is `validateReturnPath` from
    // `@tenure/identity` doing the work — not a second redirect rule written
    // in this package, because two disagreeing validators is how an open
    // redirect ships.
    for (const redirectPath of [
      "https://evil.example/cb",
      "//evil.example/cb",
      "/\\evil.example/cb",
      "/api/../../etc/passwd",
      "javascript:alert(1)",
    ]) {
      const [decision] = availabilityDecisions([withAuthorization({ redirectPath })], SCOPE)
      expect(decision.reason).toBe("authorization-redirect-refused")
    }
  })

  it("refuses an http endpoint, and one that is not a URL at all", () => {
    for (const authorizeEndpoint of ["http://sis.example.invalid/authorize", "sis.example.invalid"]) {
      expect(availabilityDecisions([withAuthorization({ authorizeEndpoint })], SCOPE)[0].reason).toBe(
        "authorization-endpoint-insecure",
      )
    }
  })

  it("refuses ID-token verification that names no claim, or has no nonce to bind it", () => {
    expect(
      availabilityDecisions([withAuthorization({ verifiedAccountClaim: "  " })], SCOPE)[0].reason,
    ).toBe("authorization-account-unverified")
    expect(
      availabilityDecisions([withAuthorization({ requiresNonce: false })], SCOPE)[0].reason,
    ).toBe("authorization-account-unverified")
  })

  it("lets a profile that holds up through to the checks after it", () => {
    // The refusals above are the authorization contract and not the connector
    // being broken some other way: unmodified, the same entry is usable.
    expect(availabilityDecisions([withAuthorization({})], SCOPE)[0].available).toBe(true)
  })

  it("accepts `null` for a connector with no user-delegated flow, and states it", () => {
    // The Relay egress presents a platform credential. There is no person, no
    // consent screen and no callback — a profile here would describe a flow
    // nobody drives, and omitting the field would make "there is no flow"
    // indistinguishable from "nobody wrote one down".
    expect(RELAY_ANTHROPIC_CONNECTOR.authorization).toBeNull()
    expect(isUsable(RELAY_ANTHROPIC_CONNECTOR, CTX).reason).toBe("uncertified")
  })

  it("holds every one of the twenty-four packs to the contract today", () => {
    // Each is PLANNED, so `isUsable` reports `planned` and never reaches the
    // authorization branch — which is exactly why this calls the gate function
    // directly on the declared data. A pack that could not be advanced without
    // failing the contract is one nobody would discover until the day they
    // tried.
    const offenders = PROVIDER_PACKS.map((pack) => ({
      key: pack.key,
      refusal: authorizationRefusal(pack.authorization, pack.egressHosts),
    })).filter((p) => p.refusal !== null)

    expect(offenders).toEqual([])
  })

  it("gives every pack an exact redirect of its own", () => {
    // "Exact redirects" is one of the two clauses that cannot be inherited from
    // the generic flow. Two packs sharing a callback path is a callback that
    // cannot say which connection it belongs to.
    const paths = PROVIDER_PACKS.map((p) => p.authorization.redirectPath)
    expect(new Set(paths).size).toBe(paths.length)
    for (const pack of PROVIDER_PACKS) {
      expect(pack.authorization.redirectPath).toBe(`/api/connections/${pack.key}/callback`)
      expect(pack.authorization.responseType).toBe("code")
    }
  })
})

/* ------------------------------------------------------------- WRK-020-002 --
 * Versioned include/exclude resource selectors, and impact diffs.
 */
describe("a connection's scope is a versioned selection with an impact diff", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  const known = [
    { externalId: "root", kind: "container" as const, ancestors: [] },
    { externalId: "finance", kind: "container" as const, ancestors: ["root"] },
    { externalId: "payroll", kind: "container" as const, ancestors: ["root", "finance"] },
    { externalId: "budget.xlsx", kind: "object" as const, ancestors: ["root", "finance"] },
    { externalId: "salaries.xlsx", kind: "object" as const, ancestors: ["root", "finance", "payroll"] },
  ]

  const VALID: ResourceSelector = {
    version: 1,
    include: [{ kind: "container", externalId: "finance", recursive: true }],
    exclude: [{ kind: "container", externalId: "payroll", recursive: true }],
  }

  it("lets exclude beat include wherever the two overlap", () => {
    // Stated once, here. A surface that re-derived it would eventually derive
    // it the other way round, and the direction it gets wrong is the one where
    // an excluded folder is indexed anyway.
    const diff = selectorDiff(null, VALID, known)
    expect(diff.added).toEqual(["finance", "budget.xlsx"])
    expect(diff.added).not.toContain("salaries.xlsx")
    expect(diff.added).not.toContain("payroll")
  })

  it("reports the removals when a folder leaves the include set", () => {
    // "If I remove this folder from the selection, which indexed objects stop
    // being reachable" — answered before somebody clicks Save, not after.
    const narrowed: ResourceSelector = {
      version: 2,
      include: [{ kind: "object", externalId: "budget.xlsx", recursive: false }],
      exclude: [],
    }
    const diff = selectorDiff(VALID, narrowed, known)
    expect(diff.removed).toEqual(["finance"])
    expect(diff.unchanged).toEqual(["budget.xlsx"])
    expect(diff.added).toEqual([])
  })

  it("refuses an empty include set", () => {
    expect(
      selectorProblems({ version: 1, include: [], exclude: [] }).map((p) => p.reason),
    ).toEqual(["include-empty"])
  })

  it("refuses an exclude rule no include could ever have matched", () => {
    const dead: ResourceSelector = {
      version: 1,
      include: [{ kind: "object", externalId: "budget.xlsx", recursive: false }],
      exclude: [{ kind: "object", externalId: "salaries.xlsx", recursive: false }],
    }
    expect(selectorProblems(dead).map((p) => p.reason)).toEqual(["exclude-matches-nothing"])
  })

  it("does not call a sub-folder exclusion dead just because nobody listed it", () => {
    // The conservative half of the rule, pinned. A recursive include COULD
    // contain a folder nothing here names, so an exclude under it is live —
    // and a validator that deleted real protections would be worse than one
    // that kept a redundant rule.
    expect(selectorProblems(VALID)).toEqual([])
  })

  it("refuses a version that did not increase, and one that cannot be ordered", () => {
    expect(selectorProblems({ ...VALID, version: 1 }, VALID).map((p) => p.reason)).toEqual([
      "version-not-increased",
    ])
    expect(selectorProblems({ ...VALID, version: 2 }, VALID)).toEqual([])
    expect(selectorProblems({ ...VALID, version: 0 }).map((p) => p.reason)).toEqual([
      "version-invalid",
    ])
  })

  it("stops a connector whose selection does not parse reaching an availability decision", () => {
    // The caller. `availabilityDecisions` is what the System Studio renders per
    // connector, so this asserts on what the production path EMITS rather than
    // on `selectorProblems` alone.
    const broken: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.bad-selection",
      selector: { version: 1, include: [], exclude: [] },
    }
    const [decision] = availabilityDecisions([broken], SCOPE)
    expect(decision.available).toBe(false)
    expect(decision.reason).toBe("selector-invalid")

    // And the same entry with a selection that parses is offered, so the
    // refusal is the selector and not the connector being broken some other way.
    expect(
      availabilityDecisions([{ ...broken, selector: VALID }], SCOPE)[0].available,
    ).toBe(true)
  })

  it("leaves a connector that selects nothing yet alone", () => {
    // Optional in the type and gated on the VALUE: the twenty-four planned
    // packs select nothing because nobody has connected them to a workspace.
    expect(CONNECTOR.selector).toBeUndefined()
    expect(availabilityDecisions([CONNECTOR], SCOPE)[0].available).toBe(true)
  })
})

/* ------------------------------------------------------------- WRK-130-001 --
 * The ten accelerators, and the set selected for release.
 */
describe("the ten work accelerators are declared, and none of them is available", () => {
  const SCOPE = {
    engineVersion: "2026.8.0",
    region: "us-east-1",
    partition: "aws",
    marketplaceEnabled: false,
    now: NOW,
  }

  it("declares exactly ten, each resting on at least one capability", () => {
    expect(WORK_ACCELERATORS).toHaveLength(10)
    expect(WORK_ACCELERATORS.map((a) => a.key)).toEqual([
      "cross-app-answer-with-citations",
      "inbox-to-governed-work",
      "meeting-lifecycle",
      "approval-notification",
      "document-to-process",
      "work-tracking-synchronization",
      "customer-service-continuity",
      "transition-briefing",
      "exception-command-center",
      "connection-on-demand",
    ])
    for (const accelerator of WORK_ACCELERATORS) {
      expect(accelerator.requiresCapabilities.length).toBeGreaterThan(0)
      expect(accelerator.title.length).toBeGreaterThan(40)
    }
  })

  it("names only capability keys the catalog actually declares", () => {
    // A typo here would make an accelerator permanently unavailable for a
    // reason nobody could see, which reads exactly like an honest verdict.
    const declared = new Set(
      CATALOG_ENTRIES.filter((e) => e.kind === "connector").flatMap((e) =>
        e.capabilities.map(capabilityKey),
      ),
    )
    for (const accelerator of WORK_ACCELERATORS) {
      for (const key of accelerator.requiresCapabilities) {
        expect([accelerator.key, key, declared.has(key)]).toEqual([accelerator.key, key, true])
      }
    }
  })

  it("returns ten unavailable verdicts against the catalog as it stands", () => {
    // The honest state of the platform, written where it can go red the moment
    // somebody overstates it. Every pack is PLANNED, so the set of capabilities
    // selected for release is EMPTY and every accelerator is missing all of its.
    const verdicts = acceleratorAvailabilityFor(CATALOG_ENTRIES, SCOPE)
    expect(verdicts).toHaveLength(10)
    expect(verdicts.filter((v) => v.available)).toEqual([])
    for (const verdict of verdicts) {
      expect(verdict.missing).toEqual([...verdict.accelerator.requiresCapabilities])
    }
  })

  it("does not count an AVAILABLE capability whose certification does not hold up", () => {
    // The two gates composing in the right order: advancing the capabilities
    // behind accelerator 1 to AVAILABLE without the clause evidence trips
    // WRK-100-004 first, so the accelerator stays unavailable.
    const accelerator = WORK_ACCELERATORS[0]
    const unevidenced = accelerator.requiresCapabilities.map(fabricate("smoke-only"))
    const entry: ConnectorEntry = {
      ...CONNECTOR,
      key: "tenure.overclaimed",
      capabilities: unevidenced,
    }
    const overclaimed = acceleratorAvailabilityFor([entry], SCOPE).find(
      (v) => v.accelerator.key === accelerator.key,
    )!
    expect(overclaimed.available).toBe(false)
    expect(overclaimed.missing).toEqual([...accelerator.requiresCapabilities])

    // And with the full contract cited, the same accelerator flips.
    const proven: ConnectorEntry = {
      ...entry,
      capabilities: accelerator.requiresCapabilities.map(fabricate("full")),
    }
    const flipped = acceleratorAvailabilityFor([proven], SCOPE).find(
      (v) => v.accelerator.key === accelerator.key,
    )!
    expect(flipped.available).toBe(true)
    expect(flipped.missing).toEqual([])
  })
})

/**
 * A capability row for a `provider/product/capability/direction` key, either
 * citing one smoke run or the whole contract.
 *
 * Built from the key so the fabricated rows and the accelerator's requirement
 * cannot drift — a fixture that spelled the four fields again would pass while
 * naming something the accelerator does not require.
 */
function fabricate(depth: "smoke-only" | "full") {
  return (key: string): ConnectorCapability => {
    const [provider, product, capability, direction] = key.split("/")
    const claimed = direction as ConnectorCapability["direction"]
    const directions: readonly CertifiedDirection[] =
      claimed === "bidirectional" ? ["read", "write"] : [claimed]
    return {
      provider,
      product,
      capability,
      direction: claimed,
      status: "AVAILABLE",
      clauseEvidence:
        depth === "smoke-only"
          ? { ...NO_EVIDENCE, golden: [{ direction: "read", ref: "test-run:smoke" }] }
          : clauseMap((clause) =>
              directions.map((d) => ({ direction: d, ref: `test-run:${clause}-${d}` })),
            ),
    }
  }
}
