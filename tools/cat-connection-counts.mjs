#!/usr/bin/env node
/**
 * CAT-010-005 — the Bible's own worked examples, run through the count engine.
 *
 * The checklist item is "Prove examples with multi-Microsoft/Google tenants,
 * Slack workspaces, Salesforce environments, ERP entities, banks, Stripe
 * accounts, plants, and partners." Those eight are not decoration: each one is a
 * different way of miscounting, and §1 names three of them outright — "Do not
 * count one SharePoint site as one Microsoft tenant, one Slack channel as one
 * workspace connection, or one Stripe connected account as one tenant."
 *
 * So the scenarios below are declared here, ONCE, and read twice: this generator
 * writes `docs/architecture/cat-connection-count-examples.md`, and
 * `tests/architecture/cat-connection-counting.test.mjs` asserts both the engine's
 * verdicts on them and that the committed document is what the engine produces
 * today. A worked example that lives only in a document is a claim; one a test
 * re-runs is evidence.
 *
 * These are SPECIFICATION scenarios, not tenant data. Every slug is prefixed
 * `example-` and no scenario names a real customer, a real provider account or a
 * real credential — the identities are shapes ("entra-tenant-a"), because the
 * thing being proven is arithmetic over a portfolio, not any portfolio.
 *
 *   node tools/cat-connection-counts.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  CARDINALITY_MODES,
  COUNT_DIMENSIONS,
  COUNT_KINDS,
  DETECTIONS,
  DETECTIONS_DEFERRED,
  assessPortfolio,
} from "../packages/provisioning/src/connection-cardinality.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const OUTPUT = "docs/architecture/cat-connection-count-examples.md"

/** Shared shape helpers, so each scenario shows only what it is about. */
const conn = (over) => ({
  grant: "organization",
  regions: [],
  legalEntities: [],
  environments: [],
  dimensionValues: {},
  selectedResources: [],
  entitledUnits: null,
  provisionedUnits: null,
  activeUnits: null,
  ...over,
})

const separated = (over = {}) => ({
  separation: { byRegion: true, byLegalEntity: false, byEnvironment: true, ...over },
})

/**
 * Eight subjects, ten scenarios. Each `why` names the miscount it rules out.
 */
export const SCENARIOS = Object.freeze([
  {
    id: "example-multi-microsoft-tenant",
    subject: "multi-Microsoft tenants",
    why:
      "Two Entra tenants are two connection instances. The 52 mailboxes under them are selected " +
      "resources, and §1 forbids counting one of them as one Microsoft tenant.",
    requirements: [
      {
        id: "req-collaboration-email",
        capability: "collaboration.email",
        module: "collaboration",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "external_organization",
          dimensionValues: ["entra-tenant-a", "entra-tenant-b"],
        },
        providerPolicy: {
          eligibleProviderProducts: ["microsoft.outlook-mail", "google.gmail"],
          mixedProvidersAllowed: true,
        },
      },
    ],
    instances: [
      conn({
        id: "conn-outlook-a",
        capabilities: ["collaboration.email"],
        providerProduct: "microsoft.outlook-mail",
        providerIdentity: "entra-tenant-a",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { external_organization: ["entra-tenant-a"] },
        selectedResources: Array.from({ length: 40 }, (_, n) => `mailbox-a-${n}`),
      }),
      conn({
        id: "conn-outlook-b",
        capabilities: ["collaboration.email"],
        providerProduct: "microsoft.outlook-mail",
        providerIdentity: "entra-tenant-b",
        regions: ["eu"],
        environments: ["production"],
        dimensionValues: { external_organization: ["entra-tenant-b"] },
        selectedResources: Array.from({ length: 12 }, (_, n) => `mailbox-b-${n}`),
      }),
    ],
  },
  {
    id: "example-multi-google-tenant",
    subject: "multi-Google tenants",
    why:
      "Two Workspace organizations satisfy AT_LEAST_N 2 on the arithmetic, and one of them is a " +
      "personal grant — which §4.2 refuses for an organization-wide requirement because it ends " +
      "when that person's account does.",
    requirements: [
      {
        id: "req-collaboration-calendar",
        capability: "collaboration.calendar",
        module: "collaboration",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: { mode: "AT_LEAST_N", n: 2 },
        providerPolicy: { eligibleProviderProducts: ["google.calendar"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      conn({
        id: "conn-google-primary",
        capabilities: ["collaboration.calendar"],
        providerProduct: "google.calendar",
        providerIdentity: "workspace-org-a",
        regions: ["us"],
        environments: ["production"],
      }),
      conn({
        id: "conn-google-personal",
        capabilities: ["collaboration.calendar"],
        providerProduct: "google.calendar",
        providerIdentity: "workspace-org-b",
        grant: "personal",
        regions: ["us"],
        environments: ["production"],
      }),
    ],
  },
  {
    id: "example-slack-workspaces",
    subject: "Slack workspaces",
    why:
      "Three workspace connections, twenty-three channels. §1 forbids counting one Slack channel " +
      "as one workspace connection, so the channels appear only under selected resources.",
    requirements: [
      {
        id: "req-collaboration-chat",
        capability: "collaboration.chat",
        module: "collaboration",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "provider_workspace",
          dimensionValues: ["workspace-corp", "workspace-field", "workspace-partner"],
        },
        providerPolicy: { eligibleProviderProducts: ["slack.workspace"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      conn({
        id: "conn-slack-corp",
        capabilities: ["collaboration.chat"],
        providerProduct: "slack.workspace",
        providerIdentity: "T-corp",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { provider_workspace: ["workspace-corp"] },
        selectedResources: Array.from({ length: 12 }, (_, n) => `channel-corp-${n}`),
      }),
      conn({
        id: "conn-slack-field",
        capabilities: ["collaboration.chat"],
        providerProduct: "slack.workspace",
        providerIdentity: "T-field",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { provider_workspace: ["workspace-field"] },
        selectedResources: Array.from({ length: 8 }, (_, n) => `channel-field-${n}`),
      }),
      conn({
        id: "conn-slack-partner",
        capabilities: ["collaboration.chat"],
        providerProduct: "slack.workspace",
        providerIdentity: "T-partner",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { provider_workspace: ["workspace-partner"] },
        selectedResources: ["channel-partner-0", "channel-partner-1", "channel-partner-2"],
      }),
    ],
  },
  {
    id: "example-salesforce-environments",
    subject: "Salesforce environments",
    why:
      "One connection assigned to production AND a UAT sandbox is the §4.2 reuse bullet, and the " +
      "developer sandbox has no connection at all. Two different findings from one portfolio.",
    requirements: [
      {
        id: "req-crm-account",
        capability: "crm.account",
        module: "revenue",
        grantRequirement: "organization",
        scope: separated({ byEnvironment: true }),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "environment",
          dimensionValues: ["production", "sandbox-uat", "sandbox-dev"],
        },
        providerPolicy: { eligibleProviderProducts: ["salesforce.sales-cloud"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      conn({
        id: "conn-salesforce-shared",
        capabilities: ["crm.account"],
        providerProduct: "salesforce.sales-cloud",
        providerIdentity: "sf-org-00D1",
        regions: ["us"],
        environments: ["production", "sandbox-uat"],
        dimensionValues: { environment: ["production", "sandbox-uat"] },
        selectedResources: ["Account", "Contact", "Opportunity"],
      }),
    ],
  },
  {
    id: "example-erp-legal-entities",
    subject: "ERP entities",
    why:
      "Four legal entities are in scope and three have a general-ledger connection. The fourth is " +
      "missing dimension coverage, which is a blocker rather than a rounding difference.",
    requirements: [
      {
        id: "req-finance-general-ledger",
        capability: "finance.generalLedger",
        module: "finance",
        grantRequirement: "organization",
        scope: separated({ byLegalEntity: true }),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "legal_entity",
          dimensionValues: ["entity-us", "entity-de", "entity-sg", "entity-br"],
        },
        providerPolicy: { eligibleProviderProducts: ["sap.s4hana"], mixedProvidersAllowed: false },
      },
    ],
    instances: ["entity-us", "entity-de", "entity-sg"].map((entity) =>
      conn({
        id: `conn-sap-${entity}`,
        capabilities: ["finance.generalLedger"],
        providerProduct: "sap.s4hana",
        providerIdentity: `sap-client-${entity}`,
        legalEntities: [entity],
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { legal_entity: [entity] },
        selectedResources: ["GL", "AP", "AR"],
      }),
    ),
  },
  {
    id: "example-bank-channels",
    subject: "banks",
    why:
      "A backup payment channel on the SAME bank identity as the primary is not a second path. " +
      "§4.2 calls it unsafe concentration, and the mode's own verdict refuses it too.",
    requirements: [
      {
        id: "req-treasury-payment-initiation",
        capability: "treasury.paymentInitiation",
        module: "treasury",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: { mode: "PRIMARY_PLUS_BACKUP" },
        providerPolicy: {
          eligibleProviderProducts: ["bank.jpmorgan-access", "bank.citi-connect"],
          mixedProvidersAllowed: true,
        },
      },
    ],
    instances: [
      conn({
        id: "conn-bank-primary",
        capabilities: ["treasury.paymentInitiation"],
        providerProduct: "bank.jpmorgan-access",
        providerIdentity: "bank-account-0001",
        role: "primary",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { bank_account: ["bank-account-0001"] },
      }),
      conn({
        id: "conn-bank-backup",
        capabilities: ["treasury.paymentInitiation"],
        providerProduct: "bank.jpmorgan-access",
        providerIdentity: "bank-account-0001",
        role: "backup",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { bank_account: ["bank-account-0001"] },
      }),
    ],
  },
  {
    id: "example-stripe-connected-accounts",
    subject: "Stripe accounts",
    why:
      "Three connected accounts for three merchant entities, all five counts declared. §1 forbids " +
      "counting one connected account as one tenant, so the tenant count is nowhere in this ledger.",
    requirements: [
      {
        id: "req-payments-charge",
        capability: "payments.charge",
        module: "payments",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "merchant_entity",
          dimensionValues: ["merchant-us", "merchant-gb", "merchant-au"],
        },
        providerPolicy: { eligibleProviderProducts: ["stripe.connect"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      ["merchant-us", 4, 2, 1],
      ["merchant-gb", 2, 1, 1],
      ["merchant-au", 2, 1, 0],
    ].map(([merchant, entitled, provisioned, active]) =>
      conn({
        id: `conn-stripe-${merchant}`,
        capabilities: ["payments.charge"],
        providerProduct: "stripe.connect",
        providerIdentity: `acct-${merchant}`,
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { merchant_entity: [merchant] },
        selectedResources: ["charge", "refund"],
        entitledUnits: entitled,
        provisionedUnits: provisioned,
        activeUnits: active,
      }),
    ),
  },
  {
    id: "example-plants",
    subject: "plants",
    why:
      "Two separate MES identities serve the same plant. Coverage is complete and the count still " +
      "costs twice — two token renewals, two quotas, two workers for one unit of coverage.",
    requirements: [
      {
        id: "req-manufacturing-work-order",
        capability: "manufacturing.workOrder",
        module: "manufacturing",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "warehouse",
          dimensionValues: ["plant-hamburg", "plant-monterrey"],
        },
        providerPolicy: { eligibleProviderProducts: ["siemens.opcenter"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      conn({
        id: "conn-mes-hamburg-a",
        capabilities: ["manufacturing.workOrder"],
        providerProduct: "siemens.opcenter",
        providerIdentity: "mes-site-hamburg-a",
        regions: ["eu"],
        environments: ["production"],
        dimensionValues: { warehouse: ["plant-hamburg"] },
      }),
      conn({
        id: "conn-mes-hamburg-b",
        capabilities: ["manufacturing.workOrder"],
        providerProduct: "siemens.opcenter",
        providerIdentity: "mes-site-hamburg-b",
        regions: ["eu"],
        environments: ["production"],
        dimensionValues: { warehouse: ["plant-hamburg"] },
      }),
      conn({
        id: "conn-mes-monterrey",
        capabilities: ["manufacturing.workOrder"],
        providerProduct: "siemens.opcenter",
        providerIdentity: "mes-site-monterrey",
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { warehouse: ["plant-monterrey"] },
      }),
    ],
  },
  {
    id: "example-partners",
    subject: "partners",
    why:
      "Four trading partners were discovered and two approved. DISCOVERED_THEN_APPROVED counts the " +
      "approved ones only, so a discovery sweep cannot satisfy a requirement by itself.",
    requirements: [
      {
        id: "req-supply-chain-purchase-order",
        capability: "supplyChain.purchaseOrder",
        module: "supply-chain",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: { mode: "DISCOVERED_THEN_APPROVED", minimum: 3 },
        providerPolicy: { eligibleProviderProducts: ["edi.as2-endpoint"], mixedProvidersAllowed: false },
      },
    ],
    instances: [
      ["partner-alpha", true],
      ["partner-bravo", true],
      ["partner-charlie", false],
      ["partner-delta", false],
    ].map(([partner, approved]) =>
      conn({
        id: `conn-edi-${partner}`,
        capabilities: ["supplyChain.purchaseOrder"],
        providerProduct: "edi.as2-endpoint",
        providerIdentity: `as2-${partner}`,
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { partner: [partner] },
        approved,
      }),
    ),
  },
  {
    id: "example-unsupported-provider-mix",
    subject: "ERP entities on incompatible ERPs",
    why:
      "Three legal entities, three different ERPs, and a capability that does not allow a mix. " +
      "One of the three is not in the eligible set at all — §4.2 separates 'unsupported mix' from " +
      "'provider nobody certified', and both fire here.",
    requirements: [
      {
        id: "req-finance-general-ledger-mixed",
        capability: "finance.generalLedger",
        module: "finance",
        grantRequirement: "organization",
        scope: separated({ byLegalEntity: true }),
        cardinality: {
          mode: "ONE_PER_DIMENSION_VALUE",
          countBy: "legal_entity",
          dimensionValues: ["entity-us", "entity-de", "entity-sg"],
        },
        providerPolicy: {
          eligibleProviderProducts: ["sap.s4hana", "oracle.fusion-erp"],
          mixedProvidersAllowed: false,
        },
      },
    ],
    instances: [
      ["entity-us", "sap.s4hana"],
      ["entity-de", "oracle.fusion-erp"],
      ["entity-sg", "netsuite.erp"],
    ].map(([entity, product]) =>
      conn({
        id: `conn-erp-${entity}`,
        capabilities: ["finance.generalLedger"],
        providerProduct: product,
        providerIdentity: `${product}-${entity}`,
        legalEntities: [entity],
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { legal_entity: [entity] },
        selectedResources: ["GL"],
      }),
    ),
  },
  {
    id: "example-portfolio-limits",
    subject: "portfolio limits at every grain",
    why:
      "CAT-010-003 asks for minimums and maximums per tenant, module, pack, capability, provider " +
      "and dimension. One portfolio breaching all six, so each grain has a finding of its own.",
    limits: {
      tenant: { maximum: 2 },
      byModule: { collaboration: { maximum: 1 } },
      byPack: { "workspace-pack": { minimum: 4 } },
      byCapability: { "collaboration.email": { maximum: 1 } },
      byProvider: { "microsoft.outlook-mail": { maximum: 1 } },
      byDimension: { external_organization: { maximumPerValue: 1 } },
    },
    requirements: [
      {
        id: "req-limits-email",
        capability: "collaboration.email",
        module: "collaboration",
        pack: "workspace-pack",
        grantRequirement: "organization",
        scope: separated(),
        cardinality: { mode: "ZERO_OR_MORE", countBy: "external_organization" },
        providerPolicy: { eligibleProviderProducts: ["microsoft.outlook-mail"], mixedProvidersAllowed: false },
      },
    ],
    instances: [1, 2, 3].map((n) =>
      conn({
        id: `conn-limits-${n}`,
        capabilities: ["collaboration.email"],
        providerProduct: "microsoft.outlook-mail",
        providerIdentity: `entra-tenant-${n}`,
        regions: ["us"],
        environments: ["production"],
        dimensionValues: { external_organization: ["shared-org"] },
        selectedResources: [],
      }),
    ),
  },
])

/** Every scenario, assessed. Pure — the document and the test read the same call. */
export function results() {
  return SCENARIOS.map((scenario) => ({
    scenario,
    assessment: assessPortfolio({
      requirements: scenario.requirements,
      instances: scenario.instances,
      limits: scenario.limits ?? {},
    }),
  }))
}

function readingText(reading) {
  return reading.known ? String(reading.value) : `not known — ${reading.why}`
}

export function render() {
  const lines = []
  lines.push("# CAT-010 — connection counts, on the Bible's own examples")
  lines.push("")
  lines.push(
    "Generated by `tools/cat-connection-counts.mjs` from " +
      "`packages/provisioning/src/connection-cardinality.mjs`. Do not edit by hand: " +
      "`tests/architecture/cat-connection-counting.test.mjs` regenerates it and fails if the " +
      "committed bytes differ, so an edit here is reverted by CI rather than believed.",
  )
  lines.push("")
  lines.push(
    "Every number below is computed. Nothing is transcribed, and no scenario names a real " +
      "customer, provider account or credential — they are specification shapes, prefixed " +
      "`example-`, for the eight subjects CAT-010-005 names.",
  )
  lines.push("")
  lines.push(
    `The engine implements ${CARDINALITY_MODES.length} cardinality modes, ` +
      `${COUNT_DIMENSIONS.length} count dimensions, ${COUNT_KINDS.length} count kinds and ` +
      `${DETECTIONS.length} of §4.2's detections; ${DETECTIONS_DEFERRED.length} more are deferred to ` +
      "CAT-030-003 and named at the end of this document.",
  )
  lines.push("")

  for (const { scenario, assessment } of results()) {
    lines.push(`## ${scenario.subject} — \`${scenario.id}\``)
    lines.push("")
    lines.push(scenario.why)
    lines.push("")
    lines.push("| count kind | value |")
    lines.push("| --- | --- |")
    for (const kind of COUNT_KINDS) {
      lines.push(`| ${kind.name} — ${kind.definition} | ${readingText(assessment.ledger[kind.id])} |`)
    }
    lines.push("")
    for (const requirement of assessment.requirements) {
      const v = requirement.verdict
      const verdict = v.determinable
        ? `${v.satisfied ? "satisfied" : "NOT satisfied"} — ${v.sentence}`
        : `undeterminable — ${v.why}`
      lines.push(`- \`${requirement.id}\` (${requirement.capability}, ${requirement.mode}): ${verdict}`)
      lines.push(
        `  - fragmentation: ${
          requirement.fragmentation.assessed ? "assessed" : `not assessed — ${requirement.fragmentation.reason}`
        }`,
      )
    }
    lines.push("")
    if (assessment.findings.length === 0) {
      lines.push("No §4.2 finding. Every condition this engine decides was checked and none fired.")
    } else {
      lines.push(`${assessment.findings.length} finding(s):`)
      lines.push("")
      for (const f of assessment.findings) {
        const grain = f.grain ? ` [${f.grain}]` : ""
        lines.push(`- **${f.code}**${grain} (§4.2 "${f.bullet}", ${f.closes}) — ${f.detail}`)
      }
    }
    lines.push("")
  }

  lines.push("## §4.2 conditions this engine does not decide")
  lines.push("")
  lines.push(
    "Named rather than omitted. Each needs a fact the count engine is never given, and each is " +
      "owned by the requirement in the last column.",
  )
  lines.push("")
  lines.push("| §4.2 bullet | needs | owner |")
  lines.push("| --- | --- | --- |")
  for (const d of DETECTIONS_DEFERRED) {
    lines.push(`| ${d.bullet} | ${d.needs} | ${d.requirement} |`)
  }
  lines.push("")
  return lines.join("\n")
}

// Writes ONLY when this file is the entry point. `file://${argv[1]}` does not
// compare equal on Windows (drive letter, backslashes), and a generator that
// wrote on import would have every tree-scanning guard reading a repository that
// does not match the committed one — which is what
// `tests/architecture/guards-do-not-write-into-the-tree.test.mjs` exists to
// catch. Resolving both sides to a filesystem path is exact on either platform.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(ROOT, OUTPUT)
  fs.writeFileSync(target, render(), "utf8")
  console.log(`Wrote ${OUTPUT} — ${SCENARIOS.length} scenarios.`)
}
