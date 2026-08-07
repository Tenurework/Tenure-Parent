import {
  CATALOG_ENTRIES,
  RECERTIFICATION_WARNING_DAYS,
  RELAY_ANTHROPIC_CONNECTOR,
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
} from "./catalogs"
import { PROVIDER_PACKS } from "./provider-packs"
import { capabilityProblems, type ConnectorCapability } from "./connector-capability"
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
      evidenceRefs: ["review:sis-2026-004"],
    },
  ],
  requestedScopes: ["sis:roster.read"],
  providerReview: PROVIDER_APPROVED,
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
        evidenceRefs: ["apps/web/src/lib/ai.ts", "apps/web/src/lib/partition-services.ts"],
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
        evidenceRefs: ["evidence:1"],
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
      capabilities: [{ ...CONNECTOR.capabilities[0], evidenceRefs: [] }],
    }
    const [decision] = availabilityDecisions([entry], SCOPE)

    expect(decision.available).toBe(true)
    // The artifact passes and the capability's own claim does not. Both facts
    // in one object, because a console holding only the first shows a green row.
    expect(decision.capabilities?.[0].problems.map((p) => p.reason)).toEqual(["evidence-missing"])
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
