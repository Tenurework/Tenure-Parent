import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  DETECTIONS,
  assessPortfolio,
  cardinalityVerdict,
  countLedger,
  requirementFindings,
} from "../../packages/provisioning/src/connection-cardinality.mjs"
import { OUTPUT, ROOT, SCENARIOS, render, results } from "../../tools/cat-connection-counts.mjs"

/**
 * CAT-010-002 / -003 / -004 / -005 — what a count means, what a limit means,
 * what §4.2 catches, and the Bible's eight worked subjects.
 *
 * The property that matters most in this file is the one in `countLedger`: five
 * counts, five readings, and a resource never counted as a connection. §1 ends
 * with three prohibitions in a row — a SharePoint site is not a Microsoft
 * tenant, a Slack channel is not a workspace connection, a Stripe connected
 * account is not a tenant — and each of them is a real bill somebody paid for.
 *
 * The second property is that an undeclared capacity is not zero. A portfolio
 * total that sums the instances that declared and ignores the ones that did not
 * reports an unsized connector as free, and that is exactly the collapse of
 * "found nothing" into "could not look" this repository exists to refuse.
 */

const base = (over) => ({
  grant: "organization",
  regions: ["us"],
  legalEntities: ["e1"],
  environments: ["production"],
  dimensionValues: {},
  selectedResources: [],
  entitledUnits: null,
  provisionedUnits: null,
  activeUnits: null,
  ...over,
})

const req = (over) => ({
  id: "req-1",
  capability: "collaboration.email",
  grantRequirement: "organization",
  scope: { separation: { byRegion: true, byLegalEntity: false, byEnvironment: true } },
  providerPolicy: { eligibleProviderProducts: ["microsoft.outlook-mail"], mixedProvidersAllowed: true },
  ...over,
})

const codes = (findings) => findings.map((f) => f.code).sort()

// ── CAT-010-002: five counts, kept apart ────────────────────────────────────

test("forty mailboxes under one connection are one connection and forty resources", () => {
  // MUTATION TARGET: make countLedger add selectedResources.length into
  // connection_instances. This assertion is the SharePoint prohibition.
  const ledger = countLedger([
    base({
      id: "conn-a",
      capabilities: ["collaboration.email"],
      providerProduct: "microsoft.outlook-mail",
      providerIdentity: "entra-a",
      selectedResources: Array.from({ length: 40 }, (_, n) => `mailbox-${n}`),
    }),
  ])
  assert.deepEqual(ledger.connection_instances, { known: true, value: 1 })
  assert.deepEqual(ledger.selected_resources, { known: true, value: 40 })
})

test("an undeclared resource selection is unknown, and a declared empty one is zero", () => {
  const declared = countLedger([
    base({ id: "c1", providerIdentity: "i1", providerProduct: "p", capabilities: [], selectedResources: [] }),
  ])
  assert.deepEqual(declared.selected_resources, { known: true, value: 0 })

  const undeclared = countLedger([
    { id: "c2", providerIdentity: "i2", providerProduct: "p", capabilities: [] },
  ])
  assert.equal(undeclared.selected_resources.known, false)
  assert.match(undeclared.selected_resources.why, /c2/)
  assert.match(undeclared.selected_resources.why, /An empty selection and an unmade selection are different facts/)
})

test("one unsized instance makes the portfolio's capacity unknown, not the sum of the rest", () => {
  // MUTATION TARGET: change sumDeclared to skip the undeclared instances and sum
  // the rest. That returns { known: true, value: 7 } and this fails.
  const ledger = countLedger([
    base({ id: "sized", providerIdentity: "i1", providerProduct: "p", entitledUnits: 7 }),
    base({ id: "unsized", providerIdentity: "i2", providerProduct: "p" }),
  ])
  assert.equal(ledger.entitled_capacity.known, false)
  assert.match(ledger.entitled_capacity.why, /1 of 2 connection instance\(s\) declare no entitled capacity: unsized/)
})

test("the five counts move independently — none is derived from another", () => {
  const ledger = countLedger([
    base({
      id: "conn-stripe",
      providerIdentity: "acct-1",
      providerProduct: "stripe.connect",
      capabilities: ["payments.charge"],
      selectedResources: ["charge", "refund", "payout"],
      entitledUnits: 9,
      provisionedUnits: 4,
      activeUnits: 1,
    }),
  ])
  assert.deepEqual(
    Object.fromEntries(Object.entries(ledger).map(([k, v]) => [k, v.value])),
    {
      connection_instances: 1,
      selected_resources: 3,
      entitled_capacity: 9,
      provisioned_capacity: 4,
      active_usage: 1,
    },
  )
})

// ── CAT-010-001: the modes decide, and boundaries are boundaries ────────────

test("EXACTLY_N is exact on both sides", () => {
  const instances = (n) =>
    Array.from({ length: n }, (_, i) =>
      base({
        id: `c${i}`,
        capabilities: ["collaboration.email"],
        providerProduct: "microsoft.outlook-mail",
        providerIdentity: `entra-${i}`,
      }),
    )
  const r = req({ cardinality: { mode: "EXACTLY_N", n: 2 } })
  assert.equal(cardinalityVerdict(r, instances(1)).satisfied, false)
  assert.equal(cardinalityVerdict(r, instances(2)).satisfied, true)
  assert.equal(cardinalityVerdict(r, instances(3)).satisfied, false)
})

test("a mode missing its parameter is undeterminable, and names the field", () => {
  // MUTATION TARGET: default `n` to 1 in the EXACTLY_N branch. The verdict
  // becomes determinable and this fails — which is the point: a requirement that
  // never said how many is not a requirement for one.
  const verdict = cardinalityVerdict(req({ cardinality: { mode: "EXACTLY_N" } }), [])
  assert.equal(verdict.determinable, false)
  assert.match(verdict.why, /EXACTLY_N needs `cardinality\.n`/)
})

test("ONE_PER_DIMENSION_VALUE names the uncovered values rather than a shortfall", () => {
  const r = req({
    capability: "finance.generalLedger",
    cardinality: {
      mode: "ONE_PER_DIMENSION_VALUE",
      countBy: "legal_entity",
      dimensionValues: ["entity-us", "entity-de", "entity-br"],
    },
    providerPolicy: { eligibleProviderProducts: ["sap.s4hana"], mixedProvidersAllowed: false },
  })
  const instances = ["entity-us", "entity-de"].map((e) =>
    base({
      id: `c-${e}`,
      capabilities: ["finance.generalLedger"],
      providerProduct: "sap.s4hana",
      providerIdentity: `sap-${e}`,
      dimensionValues: { legal_entity: [e] },
    }),
  )
  const verdict = cardinalityVerdict(r, instances)
  assert.equal(verdict.satisfied, false)
  assert.deepEqual(verdict.uncovered, ["entity-br"])
})

test("a countBy outside §1.1's sixteen dimensions is refused, not counted", () => {
  const verdict = cardinalityVerdict(
    req({ cardinality: { mode: "ONE_PER_DIMENSION_VALUE", countBy: "sales_territory", dimensionValues: ["x"] } }),
    [],
  )
  assert.equal(verdict.determinable, false)
  assert.match(verdict.why, /"sales_territory" is not one of the sixteen count dimensions/)
})

test("PRIMARY_PLUS_BACKUP refuses a backup on the primary's own identity", () => {
  const primary = base({
    id: "primary",
    capabilities: ["treasury.paymentInitiation"],
    providerProduct: "bank.one",
    providerIdentity: "bank-account-0001",
    role: "primary",
  })
  const sameAccount = { ...primary, id: "backup", role: "backup" }
  const otherAccount = { ...primary, id: "backup", providerIdentity: "bank-account-0002", role: "backup" }
  const r = req({ capability: "treasury.paymentInitiation", cardinality: { mode: "PRIMARY_PLUS_BACKUP" } })

  assert.equal(cardinalityVerdict(r, [primary, sameAccount]).satisfied, false)
  assert.equal(cardinalityVerdict(r, [primary, otherAccount]).satisfied, true)
})

test("DISCOVERED_THEN_APPROVED counts approved instances only", () => {
  // MUTATION TARGET: count `carried` instead of `approved`. Four discovered
  // partners then satisfy a minimum of three without anybody approving one.
  const partners = [true, true, false, false].map((approved, i) =>
    base({
      id: `p${i}`,
      capabilities: ["supplyChain.purchaseOrder"],
      providerProduct: "edi.as2-endpoint",
      providerIdentity: `as2-${i}`,
      approved,
    }),
  )
  const verdict = cardinalityVerdict(
    req({ capability: "supplyChain.purchaseOrder", cardinality: { mode: "DISCOVERED_THEN_APPROVED", minimum: 3 } }),
    partners,
  )
  assert.equal(verdict.satisfied, false)
  assert.deepEqual(verdict.pending, ["p2", "p3"])
})

test("PER_USER_REQUIRED without a population is undeterminable, not failed", () => {
  const r = req({ cardinality: { mode: "PER_USER_REQUIRED" } })
  const verdict = cardinalityVerdict(r, [])
  assert.equal(verdict.determinable, false)
  assert.match(verdict.why, /population\.users/)

  const sized = cardinalityVerdict(
    { ...r, population: { users: 50, connectedUsers: 50 } },
    [],
  )
  assert.equal(sized.satisfied, true)
})

// ── CAT-010-004: the §4.2 detections ────────────────────────────────────────

test("two Entra tenants are not duplicates; the same tenant twice is", () => {
  // MUTATION TARGET: key the duplicate map on providerProduct. The first
  // assertion then reports the legitimate multi-tenant portfolio as a duplicate.
  const twoTenants = ["entra-a", "entra-b"].map((identity) =>
    base({
      id: `c-${identity}`,
      capabilities: ["collaboration.email"],
      providerProduct: "microsoft.outlook-mail",
      providerIdentity: identity,
      dimensionValues: { external_organization: [identity] },
    }),
  )
  const r = req({
    cardinality: {
      mode: "ONE_PER_DIMENSION_VALUE",
      countBy: "external_organization",
      dimensionValues: ["entra-a", "entra-b"],
    },
  })
  assert.deepEqual(codes(requirementFindings(r, twoTenants).findings), [])

  // The same tenant connected twice is a duplicate — and `entra-b` is then
  // uncovered, which is the second finding.
  const sameTwice = [twoTenants[0], { ...twoTenants[0], id: "c-again" }]
  const found = requirementFindings(r, sameTwice).findings
  assert.deepEqual(codes(found), ["duplicate_provider_identity", "missing_dimension_coverage"])
  assert.deepEqual(
    found.find((f) => f.code === "duplicate_provider_identity").instances,
    ["c-again", "c-entra-a"],
  )
})

test("an ineligible provider and a forbidden mix are both unsupported mixes", () => {
  const r = req({ providerPolicy: { eligibleProviderProducts: ["microsoft.outlook-mail"], mixedProvidersAllowed: false } })
  const found = requirementFindings(r, [
    base({
      id: "c1",
      capabilities: ["collaboration.email"],
      providerProduct: "microsoft.outlook-mail",
      providerIdentity: "i1",
    }),
    base({ id: "c2", capabilities: ["collaboration.email"], providerProduct: "google.gmail", providerIdentity: "i2" }),
  ]).findings
  const mixes = found.filter((f) => f.code === "unsupported_provider_mix")
  assert.equal(mixes.length, 2)
  assert.match(mixes[0].detail, /google\.gmail is not in collaboration\.email's eligible provider set/)
  assert.match(mixes[1].detail, /does not allow mixed providers/)
})

test("undeclared separation reports that reuse could not be assessed — it does not pass", () => {
  // MUTATION TARGET: default `separation` to `{}` when absent. The finding
  // disappears and a portfolio nobody made a residency decision about reads as
  // clean.
  const r = req({ scope: undefined, cardinality: { mode: "ONE_OR_MORE" } })
  const found = requirementFindings(r, [
    base({
      id: "c1",
      capabilities: ["collaboration.email"],
      providerProduct: "microsoft.outlook-mail",
      providerIdentity: "i1",
      regions: ["us", "eu"],
    }),
  ]).findings
  const reuse = found.find((f) => f.code === "unsafe_reuse_across_boundary")
  assert.equal(reuse.determinable, false)
  assert.match(reuse.detail, /declares no `scope\.separation`/)
  assert.match(reuse.detail, /undeterminable, not safe/)
})

test("one connection spanning two separated regions is unsafe reuse", () => {
  const r = req({ cardinality: { mode: "ONE_OR_MORE" } })
  const found = requirementFindings(r, [
    base({
      id: "c-shared",
      capabilities: ["collaboration.email"],
      providerProduct: "microsoft.outlook-mail",
      providerIdentity: "i1",
      regions: ["eu", "us"],
    }),
  ]).findings
  const reuse = found.find((f) => f.code === "unsafe_reuse_across_boundary")
  assert.equal(reuse.determinable, true)
  assert.deepEqual(reuse.spanned, ["eu", "us"])
  assert.equal(reuse.boundary, "regions")
})

test("a personal grant cannot satisfy an organization-wide requirement", () => {
  const r = req({ cardinality: { mode: "ONE_OR_MORE" } })
  const personal = base({
    id: "c-personal",
    capabilities: ["collaboration.email"],
    providerProduct: "microsoft.outlook-mail",
    providerIdentity: "i1",
    grant: "personal",
  })
  const found = requirementFindings(r, [personal]).findings
  assert.ok(found.some((f) => f.code === "personal_grant_for_organization_requirement" && f.key === "c-personal"))

  // The same connection under a requirement that allows a personal grant is clean.
  const permitted = requirementFindings({ ...r, grantRequirement: "personal_allowed" }, [personal]).findings
  assert.equal(permitted.filter((f) => f.code === "personal_grant_for_organization_requirement").length, 0)
})

test("fragmentation fires on two identities serving one dimension value, and not on two values", () => {
  const r = req({
    capability: "manufacturing.workOrder",
    cardinality: { mode: "ONE_PER_DIMENSION_VALUE", countBy: "warehouse", dimensionValues: ["plant-a", "plant-b"] },
    providerPolicy: { eligibleProviderProducts: ["siemens.opcenter"], mixedProvidersAllowed: false },
  })
  const at = (plant, suffix) =>
    base({
      id: `c-${plant}-${suffix}`,
      capabilities: ["manufacturing.workOrder"],
      providerProduct: "siemens.opcenter",
      providerIdentity: `mes-${plant}-${suffix}`,
      dimensionValues: { warehouse: [plant] },
    })

  const oneEach = requirementFindings(r, [at("plant-a", "1"), at("plant-b", "1")])
  assert.equal(oneEach.fragmentation.assessed, true)
  assert.deepEqual(codes(oneEach.findings), [])

  const doubledUp = requirementFindings(r, [at("plant-a", "1"), at("plant-a", "2"), at("plant-b", "1")])
  const frag = doubledUp.findings.find((f) => f.code === "excessive_fragmentation")
  assert.deepEqual(frag.identities, ["mes-plant-a-1", "mes-plant-a-2"])
})

test("fragmentation says it did not assess rather than guessing a threshold", () => {
  const r = req({ cardinality: { mode: "AT_LEAST_N", n: 1 } })
  const assessment = requirementFindings(r, [])
  assert.equal(assessment.fragmentation.assessed, false)
  assert.match(assessment.fragmentation.reason, /no `cardinality\.countBy` is declared/)
})

// ── CAT-010-003: limits at every grain the checklist names ──────────────────

test("minimums and maximums bind at all six grains, each with its own finding", () => {
  const scenario = SCENARIOS.find((s) => s.id === "example-portfolio-limits")
  const { findings } = assessPortfolio({
    requirements: scenario.requirements,
    instances: scenario.instances,
    limits: scenario.limits,
  })
  const grains = findings.filter((f) => f.grain).map((f) => f.grain)
  assert.deepEqual(
    [...new Set(grains)].sort(),
    ["capability", "dimension", "module", "pack", "provider", "tenant"],
  )
})

test("a limit on a dimension the Bible does not name is refused rather than applied", () => {
  const { findings } = assessPortfolio({
    requirements: [req({ cardinality: { mode: "ZERO_OR_MORE" } })],
    instances: [],
    limits: { byDimension: { sales_territory: { maximumPerValue: 1 } } },
  })
  const refused = findings.find((f) => f.determinable === false && f.key === "sales_territory")
  assert.ok(refused, "an unknown dimension limit was silently ignored")
  assert.match(refused.detail, /not one of the sixteen count dimensions/)
})

test("a per-grain count is of instances, not of requirements", () => {
  // Two requirements sharing a capability must not double-count the one
  // connection that serves it.
  const instance = base({
    id: "c1",
    capabilities: ["collaboration.email"],
    providerProduct: "microsoft.outlook-mail",
    providerIdentity: "i1",
  })
  const { findings } = assessPortfolio({
    requirements: [
      req({ id: "r1", module: "collaboration", cardinality: { mode: "ZERO_OR_MORE" } }),
      req({ id: "r2", module: "collaboration", cardinality: { mode: "ZERO_OR_MORE" } }),
    ],
    instances: [instance],
    limits: { byModule: { collaboration: { maximum: 1 } } },
  })
  assert.equal(findings.filter((f) => f.code === "above_maximum").length, 0)
})

// ── Determinism, and the committed document ─────────────────────────────────

test("the same portfolio assesses to the same bytes twice", () => {
  const scenario = SCENARIOS.find((s) => s.id === "example-plants")
  const once = assessPortfolio({ requirements: scenario.requirements, instances: scenario.instances })
  const twice = assessPortfolio({ requirements: scenario.requirements, instances: scenario.instances })
  assert.equal(JSON.stringify(once), JSON.stringify(twice))
})

test("CAT-010-005's eight subjects are all present, and each is decided", () => {
  const subjects = SCENARIOS.map((s) => s.subject)
  for (const named of [
    "multi-Microsoft tenants",
    "multi-Google tenants",
    "Slack workspaces",
    "Salesforce environments",
    "ERP entities",
    "banks",
    "Stripe accounts",
    "plants",
    "partners",
  ]) {
    assert.ok(subjects.includes(named), `CAT-010-005 names ${named}; no scenario covers it`)
  }
  for (const { scenario, assessment } of results()) {
    assert.equal(
      assessment.undeterminable,
      0,
      `${scenario.id} has an undeterminable requirement; a worked example must decide`,
    )
  }
})

test("each worked example produces exactly the findings it was written to produce", () => {
  const expected = {
    "example-multi-microsoft-tenant": [],
    "example-multi-google-tenant": ["personal_grant_for_organization_requirement"],
    "example-slack-workspaces": [],
    "example-salesforce-environments": ["missing_dimension_coverage", "unsafe_reuse_across_boundary"],
    "example-erp-legal-entities": ["missing_dimension_coverage"],
    "example-bank-channels": ["duplicate_provider_identity", "unsafe_concentration"],
    "example-stripe-connected-accounts": [],
    "example-plants": ["excessive_fragmentation"],
    "example-partners": ["below_minimum"],
    "example-unsupported-provider-mix": ["unsupported_provider_mix", "unsupported_provider_mix"],
    "example-portfolio-limits": [
      "above_maximum",
      "above_maximum",
      "above_maximum",
      "above_maximum",
      "above_maximum",
      "below_minimum",
      "excessive_fragmentation",
    ],
  }
  for (const { scenario, assessment } of results()) {
    assert.deepEqual(
      codes(assessment.findings),
      expected[scenario.id],
      `${scenario.id} findings changed`,
    )
  }
})

test("every detection this engine claims to decide is exercised by a worked example", () => {
  // MUTATION TARGET: delete a scenario. The code it was the only witness for is
  // then claimed in DETECTIONS and demonstrated nowhere.
  const fired = new Set(results().flatMap(({ assessment }) => assessment.findings.map((f) => f.code)))
  const claimed = DETECTIONS.map((d) => d.code)
  const never = claimed.filter((c) => !fired.has(c))
  assert.deepEqual(
    never,
    [],
    `these detections are declared but no worked example produces them: ${never.join(", ")}`,
  )
})

test("the committed examples document is what the engine produces today", () => {
  const committed = fs.readFileSync(path.join(ROOT, OUTPUT), "utf8")
  assert.equal(
    committed,
    render(),
    `${OUTPUT} is stale. Regenerate with \`node tools/cat-connection-counts.mjs\`.`,
  )
})
