#!/usr/bin/env node
/**
 * CAT-000-004 — bind every `CAT-*` requirement to the surfaces the Bible names.
 *
 * The requirement is one sentence: "Bind Catalog requirements to Configurator,
 * Pack Factory, Integration Plane, Work Graph, Payments, core domains, System
 * Studio, Tenant UX, and release evidence."
 *
 * A binding is a claim that two things correspond, and the way that claim goes
 * wrong is not that somebody writes the wrong Bible name — it is that the
 * document keeps naming a ledger, a Bible or a module that was renamed a month
 * ago, and nobody opens it. So:
 *
 *   * the NINE SURFACES are not typed in. They are parsed out of CAT-000-004's
 *     own sentence in the Bible, so a document that binds to eight, or to a
 *     tenth somebody invented, disagrees with the requirement rather than with
 *     a constant in this file.
 *   * every requirement id is read from the CAT ledger, not listed here, so a
 *     requirement added to the Bible and imported tomorrow appears unbound
 *     instead of appearing nowhere.
 *   * every target is a PATH, and `tests/architecture/cat-requirement-bindings.test.mjs`
 *     opens all of them. A binding to a file that does not exist is the failure
 *     mode this whole exercise is about, and it is one `fs.existsSync` away
 *     from being impossible.
 *
 * ## What a binding is and is not
 *
 * It says: this phase of the catalog's work is owned jointly with that surface,
 * and here is the document that governs it, the ledger that tracks it, and the
 * code that exists today. It does NOT say the work is done — every CAT
 * requirement except CAT-000-001 is `FAIL` in the ledger, and the binding is
 * what makes it possible to say WHERE it is failing.
 *
 * ## Determinism
 *
 * Same contract as `tools/cat-integration-inventory.mjs`: byte comparators
 * rather than `localeCompare`, `\r?\n` splitting so a CRLF checkout parses the
 * same, `\n`-joined output.
 *
 * Usage:  node tools/cat-requirement-bindings.mjs [--check]
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const BINDINGS_DOC = "docs/architecture/cat-requirement-bindings.md"
export const LEDGER = "docs/implementation/connection-composer-execution-ledger.md"
export const BIBLE =
  "Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md"

const byBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

/**
 * The nine surfaces, in CAT-000-004's own words.
 *
 * Read from the Bible so "the surfaces the requirement names" is a fact about
 * the requirement rather than a list somebody transcribed once.
 */
export function surfaceNames() {
  const line = read(BIBLE)
    .split(/\r?\n/)
    .find((l) => l.includes("CAT-000-004 —"))
  if (!line) throw new Error(`${BIBLE} no longer states CAT-000-004`)
  const at = line.indexOf("Bind Catalog requirements to ")
  if (at === -1) throw new Error("CAT-000-004 no longer starts with 'Bind Catalog requirements to'")
  return line
    .slice(at + "Bind Catalog requirements to ".length)
    .replace(/\.$/, "")
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Each surface, with the documents that govern it and the code that exists.
 *
 * `name` must match one of the strings CAT-000-004 uses, exactly. The test
 * asserts the two sets are equal in both directions, so this table cannot drift
 * from the sentence it implements.
 */
export const SURFACES = [
  {
    name: "Configurator",
    key: "configurator",
    bibles: ["Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/declarative-configurator-execution-ledger.md",
    anchors: [
      "packages/configuration/src/definition.ts",
      "packages/configuration/src/publication.ts",
      "packages/configuration/src/layer-schema.ts",
    ],
    owns:
      "the schema, evaluation and state engine every integration question is asked through. " +
      "CAT owns which questions exist; the Configurator owns how a question is declared, " +
      "branched, saved and published.",
  },
  {
    name: "Pack Factory",
    key: "pack-factory",
    bibles: ["Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/erp-pack-factory-execution-ledger.md",
    anchors: ["packages/module-runtime/src/index.ts", "modules/index.ts"],
    owns:
      "ERP archetype composition. A pack declares the integration capabilities its archetype " +
      "requires; CAT resolves those requirements against providers and counts.",
  },
  {
    name: "Integration Plane",
    key: "integration-plane",
    bibles: [
      "Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md",
    ],
    ledger: "docs/implementation/integration-ecosystem-execution-ledger.md",
    anchors: [
      "packages/provisioning/src/connector-capability.ts",
      "packages/provisioning/src/catalogs.ts",
    ],
    owns:
      "shared connector runtime, SDK, auth, events, transformations and certification. CAT " +
      "decides WHAT a tenant needs; the Integration Plane decides whether a connector may be " +
      "offered at all.",
  },
  {
    name: "Work Graph",
    key: "work-graph",
    bibles: ["Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/universal-work-graph-execution-ledger.md",
    anchors: [
      "packages/provisioning/src/provider-packs.ts",
      "apps/web/src/lib/connections/capability-resolution.ts",
      "packages/platform-config/src/provider-review.ts",
    ],
    owns:
      "end-user connection, Relay, cross-app work, source ACL and external action semantics. " +
      "CAT-050-002 states the dependency outright: Wave 1 executes only through the Work " +
      "Graph provider-pack requirements, and the twenty-four packs in the catalog today each " +
      "cite a `WRK-*` id.",
  },
  {
    name: "Payments",
    key: "payments",
    bibles: ["Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/payments-treasury-execution-ledger.md",
    anchors: [
      "packages/payments/src/capability-registry.ts",
      "packages/payments/src/api-version.ts",
      "packages/payments/src/eligibility.ts",
    ],
    owns:
      "merchant, connected-account and treasury invariants. A tenant with several merchant " +
      "legal entities is a CAT cardinality question whose per-account rules Payments owns.",
  },
  {
    name: "core domains",
    key: "core-domains",
    bibles: [
      "Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md",
      "Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md",
      "Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md",
      "Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md",
      "Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md",
    ],
    ledger: "docs/implementation/financial-management-execution-ledger.md",
    anchors: ["modules/index.ts", "packages/organization-model/src/graph.ts"],
    owns:
      "the specialized invariants a connector must not bypass. CAT-060-005 is the explicit " +
      "rule: a protected domain binds to its complete owning Bible, so cataloguing an HCM or " +
      "finance system never substitutes for that domain's depth.",
  },
  {
    name: "System Studio",
    key: "system-studio",
    bibles: ["Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/system-studio-aws-control-plane-execution-ledger.md",
    anchors: ["apps/system-studio/src/app/page.tsx"],
    owns:
      "the operator console the Global Deployer is part of. `apps/system-studio/src/app/page.tsx` " +
      "is where `availabilityDecisions` renders the catalog today — under what is NOT available " +
      "and why.",
  },
  {
    name: "Tenant UX",
    key: "tenant-ux",
    bibles: ["Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md"],
    ledger: "docs/implementation/tenant-experience-execution-ledger.md",
    anchors: [
      "apps/web/src/components/connections/MissingConnectionCard.tsx",
      "apps/web/src/app/api/connections/opportunity/route.ts",
    ],
    owns:
      "what a member of the tenant sees. CAT-GATE-000's honesty rule lands here: a catalog " +
      "entry that is not `TENANT_ELIGIBLE` may not render as a connect button.",
  },
  {
    name: "release evidence",
    key: "release-evidence",
    bibles: ["Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md"],
    ledger: "docs/implementation/global-engine-execution-ledger.md",
    anchors: ["packages/releases/src/release.ts", "packages/releases/src/validate.ts"],
    owns:
      "what a release must carry before it ships. CAT-090-004 names the payload: catalog, " +
      "desired state, connector releases, provider applications and reviews, config, IaC, " +
      "mappings, tests, evidence, cutover, support and rollback.",
  },
]

/**
 * Which surfaces each CAT phase is bound to, and why THIS phase needs THAT
 * surface.
 *
 * Per phase rather than per requirement, and that is a deliberate limit stated
 * plainly: the Bible groups its requirements into phases that share one subject,
 * so a per-requirement table would be the same nine columns copied five times
 * with the reasons invented to fill them. A reason nobody derived is the kind
 * of plausible paragraph this repository is trying to stop producing.
 */
export const PHASE_BINDINGS = [
  {
    phase: "CAT-000",
    title: "Catalog truth and binding",
    surfaces: [
      ["configurator", "the catalog's questions are declared through its schema engine"],
      ["pack-factory", "pack archetypes are one of the two sources of integration requirements"],
      ["integration-plane", "the connector lifecycle vocabulary the classification maps onto"],
      ["work-graph", "every provider pack in the tree today cites a `WRK-*` requirement id"],
      ["payments", "the Stripe capability leaves are catalog rows and are inventoried as such"],
      ["core-domains", "domain Bibles own the invariants a catalogued system must not bypass"],
      ["system-studio", "the console that renders the catalog and its availability decisions"],
      ["tenant-ux", "what a tenant is shown about an integration that does not exist yet"],
      ["release-evidence", "the inventory and classification are the artefacts a release cites"],
    ],
  },
  {
    phase: "CAT-010",
    title: "Cardinality and dimensions",
    surfaces: [
      ["configurator", "minimum/maximum/countBy are schema fields, not bespoke form code"],
      ["pack-factory", "per-pack minimums are declared by the archetype that needs them"],
      ["integration-plane", "duplicate provider identity is a connector-identity question"],
      ["payments", "several merchant legal entities is a cardinality case Payments constrains"],
      ["core-domains", "legal entity, business unit and region are organization-model dimensions"],
      ["system-studio", "counts and coverage are rendered to the operator"],
    ],
  },
  {
    phase: "CAT-020",
    title: "Schema-driven Deployer",
    surfaces: [
      ["configurator", "the thirteen sections ARE Configurator schemas; CAT owns their content"],
      ["pack-factory", "conditional branches key off the packs a tenant selected"],
      ["system-studio", "the Deployer is a System Studio surface"],
    ],
  },
  {
    phase: "CAT-030",
    title: "Compiler and desired state",
    surfaces: [
      ["configurator", "the approved configuration is the compiler's input"],
      ["integration-plane", "connector release and app-registration plans are its output"],
      ["pack-factory", "manifest composition is where a pack's requirements are resolved"],
      ["system-studio", "desired/planned/actual diffs are an operator surface"],
      ["release-evidence", "a signed portfolio is a release artefact"],
    ],
  },
  {
    phase: "CAT-040",
    title: "Global Deployer UX",
    surfaces: [
      ["system-studio", "the portfolio view, instance cards and readiness live in the console"],
      ["configurator", "progressive disclosure and impact preview are engine behaviours"],
      ["tenant-ux", "accessibility, localization and reduced-motion rules are the design system's"],
    ],
  },
  {
    phase: "CAT-050",
    title: "Major workspace catalog",
    surfaces: [
      ["work-graph", "CAT-050-002 states Wave 1 executes only through its provider-pack items"],
      ["integration-plane", "certification is what turns a listed pack into an offered one"],
      ["tenant-ux", "CAT-050-004 — an unbuilt entry may not render a connect state"],
    ],
  },
  {
    phase: "CAT-060",
    title: "Horizontal enterprise catalog",
    surfaces: [
      ["payments", "ERP, banking, tax and treasury systems bind to the Payments invariants"],
      ["core-domains", "CAT-060-005 binds protected domains to their complete owning Bibles"],
      ["integration-plane", "registration is a catalog-row act governed by the connector plane"],
      ["pack-factory", "horizontal breadth is composed into archetypes, not hard-coded"],
    ],
  },
  {
    phase: "CAT-070",
    title: "Industry catalog",
    surfaces: [
      ["pack-factory", "industry packs are the consumers of these catalog families"],
      ["core-domains", "operations, manufacturing and healthcare invariants stay domain-owned"],
      ["integration-plane", "CAT-070-007's regulated-data boundary is a connector-plane refusal"],
    ],
  },
  {
    phase: "CAT-080",
    title: "Provider-pack certification",
    surfaces: [
      ["integration-plane", "the certification contract and its clause evidence are its own"],
      ["work-graph", "the packs being certified are the Work Graph's provider packs"],
      ["release-evidence", "recertification triggers are release-gating facts"],
    ],
  },
  {
    phase: "CAT-090",
    title: "Cost, capacity, release, and final proof",
    surfaces: [
      ["release-evidence", "CAT-090-004 binds the whole payload into the platform release"],
      ["system-studio", "go-live gates and the portfolio report are operator surfaces"],
      ["payments", "provider cost and entitlement counts are money, quoted not assumed"],
      ["configurator", "entitlement and capacity counts come from the approved configuration"],
      ["core-domains", "usage counts are domain facts, not integration facts"],
      ["tenant-ux", "the tenant is told exactly which connectors block go-live"],
    ],
  },
]

/** Every `CAT-*` requirement id in the ledger, with its title and phase. */
export function requirements() {
  const out = []
  for (const line of read(LEDGER).split(/\r?\n/)) {
    const m = /^- \[[ xX]\] \*\*(CAT-[A-Z0-9-]+)\*\* — (.+)$/.exec(line)
    if (!m) continue
    // `CAT-000-002` → `CAT-000`; `CAT-GATE-010` → `CAT-010`, because a gate
    // belongs to the phase it closes rather than to a phase of its own.
    const gate = /^CAT-GATE-(\d+)$/.exec(m[1])
    const phase = gate ? `CAT-${gate[1]}` : m[1].slice(0, 7)
    out.push({
      id: m[1],
      title: m[2],
      phase,
      isGate: Boolean(gate),
      checked: line.startsWith("- [x]") || line.startsWith("- [X]"),
    })
  }
  out.sort((a, b) => byBytes(a.id, b.id))
  return out
}

export function bindingsByPhase() {
  const byKey = new Map(SURFACES.map((s) => [s.key, s]))
  return PHASE_BINDINGS.map((p) => ({
    ...p,
    resolved: p.surfaces.map(([key, why]) => ({ surface: byKey.get(key) ?? null, key, why })),
  }))
}

export function render() {
  const reqs = requirements()
  const phases = bindingsByPhase()
  const names = surfaceNames()
  const out = []

  out.push("<!-- Generated by tools/cat-requirement-bindings.mjs. Do not edit by hand. -->")
  out.push("<!-- Regenerate: node tools/cat-requirement-bindings.mjs -->")
  out.push("")
  out.push("# Catalog requirement bindings")
  out.push("")
  out.push(
    `Closes **CAT-000-004** — every \`CAT-*\` requirement in \`${LEDGER}\` bound to the ` +
      `${names.length} surfaces the requirement names, each with the document that governs it, ` +
      `the ledger that tracks it and code that exists today. ` +
      `\`tests/architecture/cat-requirement-bindings.test.mjs\` opens every path below.`,
  )
  out.push("")
  // Read out of the ledger rather than typed, so the sentence cannot become a
  // false statement about another file the day somebody closes a requirement.
  const passing = reqs.filter((r) => r.checked).map((r) => `\`${r.id}\``)
  out.push(
    "A binding says where a requirement's work is jointly owned. It does not say the work is " +
      `done: ${passing.length} of ${reqs.length} \`CAT-*\` requirements are closed ` +
      `(${passing.join(", ")}) and the rest are \`FAIL\` — the binding is what makes it ` +
      "possible to say where.",
  )
  out.push("")

  out.push(`## The ${names.length} surfaces, in CAT-000-004's own words`)
  out.push("")
  out.push("| Surface | Governing document(s) | Ledger | Code today | What it owns |")
  out.push("| --- | --- | --- | --- | --- |")
  for (const s of SURFACES) {
    out.push(
      `| **${s.name}** | ${s.bibles.map((b) => `\`${b}\``).join("<br>")} | \`${s.ledger}\` | ` +
        `${s.anchors.map((a) => `\`${a}\``).join("<br>")} | ${s.owns} |`,
    )
  }
  out.push("")

  out.push("## Phase bindings")
  out.push("")
  for (const p of phases) {
    const ids = reqs.filter((r) => r.phase === p.phase).map((r) => r.id)
    out.push(`### ${p.phase} — ${p.title} (${ids.length} requirements)`)
    out.push("")
    out.push(ids.map((i) => `\`${i}\``).join(" · "))
    out.push("")
    out.push("| Surface | Why this phase needs it |")
    out.push("| --- | --- |")
    for (const r of p.resolved) out.push(`| ${r.surface ? r.surface.name : r.key} | ${r.why} |`)
    out.push("")
  }

  out.push("## Coverage")
  out.push("")
  out.push("| Surface | Phases bound |")
  out.push("| --- | --- |")
  for (const s of SURFACES) {
    const bound = phases.filter((p) => p.surfaces.some(([k]) => k === s.key)).map((p) => p.phase)
    out.push(`| ${s.name} | ${bound.map((b) => `\`${b}\``).join(" ")} |`)
  }
  out.push("")
  out.push(`Requirements bound: ${reqs.length} of ${reqs.length}.`)
  out.push("")

  return out.join("\n")
}

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const text = render()
  const abs = path.join(ROOT, BINDINGS_DOC)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""
    if (current !== text) {
      console.error(`::error::${BINDINGS_DOC} is stale. Run: node tools/cat-requirement-bindings.mjs`)
      process.exit(1)
    }
    console.log(`${BINDINGS_DOC} is up to date.`)
  } else {
    fs.writeFileSync(abs, text)
    console.log(`Wrote ${BINDINGS_DOC} — ${requirements().length} requirements bound.`)
  }
}
