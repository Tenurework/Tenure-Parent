#!/usr/bin/env node
/**
 * WRK-000-004 — bind the Work Graph authority to the Integration, Tenant UX,
 * Configurator, Relay, security, lifecycle, release and owning-domain
 * authorities.
 *
 * A binding is a claim that two documents correspond. Written as a paragraph it
 * is worth nothing: the eight counterparts the requirement names are eight
 * names, and a document that lists eight plausible names is indistinguishable
 * from one that lists the right ones until somebody opens every path. So the
 * table below is generated, and the two halves that can go wrong are derived
 * from the tree rather than typed:
 *
 *   * the LIST of bindings is parsed out of WRK-000-004's own statement in the
 *     Work Graph authority. Drop a binding from the table and the generator
 *     still emits its name with no row, and the guard reds. Invent a ninth and
 *     it reds the other way. That is what makes this a mapping instead of a
 *     paragraph.
 *   * the READ-ORDER contract in section 0 of that document is parsed out the
 *     same way, and each of its eight numbered entries is resolved to a file
 *     that exists — or recorded, explicitly, as not present in this repository.
 *     Entry 8 is the interesting one and it is why this half is here at all.
 *
 * What cannot be derived is what each counterpart OWNS and where the boundary
 * between it and the Work Graph runs. That is a reading of the documents, it is
 * written out per binding below, and every path it cites is opened by
 * `tests/architecture/wrk-authority-bindings.test.mjs`.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Output is committed, so it must be byte-identical on Linux and Windows: every
 * file is read with CRLF normalised to LF, every list is emitted in a declared
 * order rather than a discovered one, the document is joined with `\n`, and
 * `.gitattributes` pins `* eol=lf`. Nothing here reads a directory.
 *
 * ── What this does NOT claim ───────────────────────────────────────────────
 *
 * A binding says where work is jointly owned. It does not say the work is done.
 * Every WRK requirement except the ones this wave closed is `FAIL`, and the
 * binding is what makes it possible to say precisely whose FAIL it is.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/wrk-authority-bindings.md'

const WRK_DOC = 'Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md'
const WRK_LEDGER = 'docs/implementation/universal-work-graph-execution-ledger.md'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const exists = (p) => fs.existsSync(path.join(ROOT, p))

// ── Derived half 1: the bindings the requirement itself names ───────────────

/**
 * The binding names, parsed out of WRK-000-004's statement.
 *
 * "Bind this Bible to Integration, Tenant UX, Configurator, Relay, security,
 * lifecycle, release, and owning domain Bibles." — eight names, in the
 * document's own words and order. Parsed rather than transcribed so that a
 * table which quietly drops one cannot pass, and so a reader can see that the
 * left-hand column of the table below is not a list somebody chose.
 */
export function namedBindings() {
  const line = read(WRK_DOC)
    .split('\n')
    .find((l) => /\bWRK-000-004\b/.test(l) && /Bind this/.test(l))
  if (!line) throw new Error(`WRK-000-004 is not stated in ${WRK_DOC}`)
  const m = /Bind this Bible to (.+?) Bibles\./.exec(line)
  if (!m) throw new Error(`WRK-000-004's statement does not have the expected shape: ${line}`)
  return (
    m[1]
      .split(/,\s*|\s+and\s+/)
      .map((s) => s.trim())
      // The statement uses an Oxford comma — "release, and owning domain" — so
      // splitting on the comma first leaves the conjunction attached to the last
      // name. Stripping it here rather than adding `and` to the split keeps a
      // binding legitimately named "… and …" from being cut in half.
      .map((s) => s.replace(/^and\s+/i, ''))
      .filter(Boolean)
  )
}

// ── Derived half 2: the read-order contract ─────────────────────────────────

/**
 * Section 0's numbered read-order list, in the document's own words.
 *
 * Bounded to the list itself — `## 0.` to the next blank-line-separated
 * paragraph — so prose that happens to start with a digit cannot be read as an
 * entry.
 */
export function readOrder() {
  const text = read(WRK_DOC)
    const start = text.indexOf('## 0. Constitutional relationship and ownership')
  if (start === -1) throw new Error(`${WRK_DOC} has no section 0`)
  const section = text.slice(start, text.indexOf('\n## ', start + 4))
  return [...section.matchAll(/^(\d+)\.\s+(.+?)\s*$/gm)].map((m) => ({
    n: Number(m[1]),
    title: m[2].replace(/\.$/, ''),
  }))
}

/**
 * Which repository file each read-order entry resolves to.
 *
 * The mapping is by a distinctive substring of the entry's own words against
 * the candidate filenames, so it is a resolution rather than an assertion — and
 * an entry that resolves to nothing stays unresolved instead of being quietly
 * dropped. Entry 8, "Tenure Major App and Industry Connector Catalog and
 * Certification Matrix", is the one that resolves to nothing: no file in this
 * repository has that title, and a read-order contract that names a document
 * nobody has is a gap worth a row rather than a silence.
 */
const READ_ORDER_KEYS = [
  { match: /Constitution and Mandatory Document Graph/i, file: 'Tenure_Claude_Code_Global_Engine_Constitution_and_Document_Graph_v1.0.md' },
  { match: /Unified Global Engine Master Prompt/i, file: 'Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md' },
  { match: /Integration Ecosystem and Connector Certification/i, file: 'Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md' },
  { match: /Tenant Experience System and Product UI\/UX/i, file: 'Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md' },
  { match: /Declarative Tenant Configurator and Deployer UX/i, file: 'Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md' },
  { match: /Global System Architecture/i, file: 'docs/architecture/Tenure_Global_System_Architecture_Bible_v1.0.md' },
  { match: /People, Finance, Planning, Operations, Analytics, Payments/i, file: null, note: 'eight documents — see the `owning domain` binding below' },
  { match: /Major App and Industry Connector Catalog/i, file: null, note: 'NOT PRESENT in this repository. No file carries this title; `git grep` finds the phrase only in this read-order line itself.' },
]

export function resolvedReadOrder() {
  return readOrder().map((entry) => {
    const key = READ_ORDER_KEYS.find((k) => k.match.test(entry.title))
    return {
      ...entry,
      file: key?.file ?? null,
      note: key?.note ?? null,
      resolved: Boolean(key),
      present: key?.file ? exists(key.file) : null,
    }
  })
}

// ── The bindings themselves ────────────────────────────────────────────────

/**
 * What each counterpart owns, where the boundary is stated, and what exists
 * today.
 *
 * `name` must equal one of `namedBindings()`, which is checked rather than
 * assumed — the guard compares the two sets in both directions.
 *
 * `documents` is empty for exactly one binding, `Relay`, and that is a finding
 * rather than an omission: no Relay authority exists. Section 0 of the Work
 * Graph document lists "Relay missing-connection cards and resumable connect
 * links" and "cross-app discovery, citation, drafting, action, and follow-up
 * semantics" under what THIS document owns, so Relay's counterpart is this
 * document's own sections 5 and 7 plus the modules that implement them.
 * Recording an invented Relay Bible would be the fabrication this programme
 * fails on.
 */
const BINDINGS = [
  {
    name: 'Integration',
    documents: ['Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md'],
    prefixes: ['INT'],
    ledgers: ['docs/implementation/integration-ecosystem-execution-ledger.md'],
    code: [
      'packages/provisioning/src/connector-capability.ts',
      'packages/provisioning/src/catalogs.ts',
      'packages/platform-config/src/provider-review.ts',
    ],
    boundary:
      'Section 0 states it outright: the Integration authority "continues to own the shared connector SDK/runtime, canonical delivery envelope, authentication broker, webhooks, queues, mapping, retries, reconciliation, certification, and Integration Studio operator surfaces." The Work Graph owns what a tenant experiences of a connection — selection, consent, the graph, citation, action — and may never let a provider write a domain table directly.',
    wrkRequirements: ['WRK-000-002', 'WRK-040-004', 'WRK-060-001'],
  },
  {
    name: 'Tenant UX',
    documents: ['Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md'],
    prefixes: ['TTES'],
    ledgers: ['docs/implementation/tenant-experience-execution-ledger.md'],
    code: [
      'apps/web/src/components/connections/MissingConnectionCard.tsx',
      'apps/web/src/app/api/connections/opportunity/route.ts',
    ],
    boundary:
      'Section 13 ("Tenant and nontechnical user experience") is the Work Graph\'s content; the experience system owns the shell, the components, the accessibility contract and the status language they are rendered in. The honesty rule lands on this seam: a capability that is not certified may not produce a working-looking Connect button, which is a UX assertion about a Work Graph fact.',
    wrkRequirements: ['WRK-030-005', 'WRK-110-001'],
  },
  {
    name: 'Configurator',
    documents: ['Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md'],
    prefixes: ['CFG'],
    ledgers: ['docs/implementation/declarative-configurator-execution-ledger.md'],
    code: ['packages/configuration/src/definition.ts', 'packages/provisioning/src/resource-selector.ts'],
    boundary:
      'Resource selectors, scope choices, retention and AI-use decisions (section 4.2) are questions asked through the Configurator\'s schema engine. The Work Graph owns WHICH questions exist and what an answer means for access; the Configurator owns how a question is declared, branched, versioned, saved and published.',
    wrkRequirements: ['WRK-020-002', 'WRK-020-005'],
  },
  {
    name: 'Relay',
    documents: [],
    prefixes: ['WRK'],
    ledgers: [WRK_LEDGER],
    code: [
      'apps/web/src/lib/relay-tools.ts',
      'apps/web/src/lib/relay/action-plan.ts',
      'apps/web/src/lib/relay/citation.ts',
      'apps/web/src/app/api/ai/chat/route.ts',
    ],
    boundary:
      'There is no Relay authority to bind to. Section 0 lists Relay missing-connection cards, resumable connect links, and cross-app discovery/citation/drafting/action/follow-up semantics under what THIS document owns, and sections 5 and 7 state them. The counterpart is therefore internal, and the binding that matters is the invariant that keeps it from becoming an authority of its own: "Relay is not an authorization authority. It proposes typed actions. Server-side policy decides whether an action is allowed."',
    wrkRequirements: ['WRK-050-001', 'WRK-030-002'],
  },
  {
    name: 'security',
    documents: ['Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md'],
    prefixes: ['GE'],
    ledgers: ['docs/implementation/global-engine-execution-ledger.md'],
    code: ['packages/authorization/src/index.ts', 'apps/web/src/lib/relay/untrusted-content.ts'],
    boundary:
      'GE-150 to GE-153 own the threat model, privacy and retention, compliance evidence and security acceptance for the whole engine. Section 14 of the Work Graph document does not restate them; it names the provider-specific threats the generic model does not reach — OAuth mix-up and confused deputy, webhook forgery and replay, indirect prompt injection through retrieved content, and cross-tenant leakage through a queue, cache, index, token, graph or action.',
    wrkRequirements: ['WRK-040-006', 'WRK-010-006'],
  },
  {
    name: 'lifecycle',
    documents: [
      'Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md',
      'Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md',
    ],
    prefixes: ['GE', 'SIMON'],
    ledgers: [
      'docs/implementation/global-engine-execution-ledger.md',
      'docs/implementation/simon-ose-absorption-execution-ledger.md',
    ],
    code: ['packages/provisioning/src/lifecycle.ts', 'packages/provisioning/src/tenant-registry.ts'],
    boundary:
      'Two different lifecycles meet here and conflating them is the error. GE-103 owns the TENANT fleet — suspension, hibernation, purge, migration, export, offboarding — and section 15.3 of the Work Graph document says what each of those states means for tokens, subscriptions, cursors and indexes. Section 15.1 owns the PROVIDER lifecycle instead: API version, scope, event schema, rate limit, review status and deprecation, which no tenant state machine has an opinion about.',
    wrkRequirements: ['WRK-120-004', 'WRK-060-005'],
  },
  {
    name: 'release',
    documents: ['Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md'],
    prefixes: ['GE'],
    ledgers: ['docs/implementation/global-engine-execution-ledger.md'],
    code: ['packages/releases/src/release.ts', 'packages/releases/src/validate.ts'],
    boundary:
      'GE-171 and GE-430 own release, migration and the document/release graph. The Work Graph contributes gate content, not a second release process: section 18 is an evidence-gated checklist whose gates ("no existing connector or AI capability is overstated") are conditions a release must satisfy, and provider policy — verification, marketplace approval, restricted scopes, app-review status, deprecation — is named in invariant 17 as a release gate rather than a launch preference.',
    wrkRequirements: ['WRK-130-004', 'WRK-000-002'],
  },
  {
    name: 'owning domain',
    documents: [
      'Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md',
      'Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md',
      'Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md',
      'Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md',
      'Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md',
      'Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md',
      'Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md',
      'Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md',
    ],
    prefixes: ['HCM', 'FIN', 'PLN', 'OPS', 'ANL', 'PAY', 'PACK', 'SIMON'],
    ledgers: [
      'docs/implementation/people-hr-workforce-execution-ledger.md',
      'docs/implementation/financial-management-execution-ledger.md',
      'docs/implementation/planning-epm-execution-ledger.md',
      'docs/implementation/operations-cloud-execution-ledger.md',
      'docs/implementation/analytics-reporting-execution-ledger.md',
      'docs/implementation/payments-treasury-execution-ledger.md',
      'docs/implementation/erp-pack-factory-execution-ledger.md',
      'docs/implementation/simon-ose-absorption-execution-ledger.md',
    ],
    code: ['modules/index.ts', 'packages/organization-model/src/graph.ts'],
    boundary:
      'Section 0: "Domain Bibles own the meaning and invariants of Finance, HCM, Planning, Operations, Payments, CRM, and other business records. This Bible may never let an external provider write a domain table or ledger directly." A Work Graph write into a domain is a domain operation that happens to have been proposed from outside, and it obeys that domain\'s invariants and approval rules, not the connector\'s.',
    wrkRequirements: ['WRK-050-004', 'WRK-070-005'],
  },
]

export { BINDINGS, OUT, ROOT, WRK_DOC, WRK_LEDGER }

// ── Render ─────────────────────────────────────────────────────────────────

const cell = (v) => String(v).replace(/\|/g, '\\|')

function table(headers, rows) {
  if (rows.length === 0) return '_None._'
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => r.map(cell).join(' | ')).map((r) => `| ${r} |`),
  ].join('\n')
}

const paths = (list) => (list.length === 0 ? '—' : list.map((p) => `\`${p}\``).join('<br>'))

export function render() {
  const named = namedBindings()
  const order = resolvedReadOrder()
  const missing = order.filter((e) => e.resolved && e.file === null && e.note?.startsWith('NOT PRESENT'))

  return `<!-- Generated by tools/wrk-authority-bindings.mjs. Do not edit by hand. -->
<!-- Regenerate: node tools/wrk-authority-bindings.mjs -->

# Work Graph authority bindings

Closes **WRK-000-004** — the Work Graph authority bound to the ${named.length}
counterparts its own statement names, each with the governing document, the
ledger that tracks it, the code that exists today, and where the boundary
between the two runs.
\`tests/architecture/wrk-authority-bindings.test.mjs\` opens every path below and
compares this table against the requirement's own wording in both directions.

A binding says where work is jointly owned. It does not say the work is done:
almost every \`WRK-*\` requirement in \`${WRK_LEDGER}\`
is \`FAIL\`, and the binding is what makes it possible to say whose.

## 1. The ${named.length} bindings, in WRK-000-004's own words

Parsed from the requirement's statement, not transcribed:
${named.map((n) => `\`${n}\``).join(' · ')}

${table(
  ['Binding', 'Governing document(s)', 'Prefix', 'Ledger(s)', 'Code today'],
  BINDINGS.map((b) => [
    `**${b.name}**`,
    b.documents.length ? paths(b.documents) : '— (no such authority exists; see below)',
    b.prefixes.join(', '),
    paths(b.ledgers),
    paths(b.code),
  ]),
)}

## 2. Where each boundary runs

${BINDINGS.map((b) => `### ${b.name}\n\n${b.boundary}\n\nWork Graph requirements that sit on this seam: ${b.wrkRequirements.map((r) => `\`${r}\``).join(' · ')}`).join('\n\n')}

## 3. The read-order contract in section 0

The ${order.length} documents section 0 requires be read "completely before
material implementation", each resolved to a file in this repository.

${table(
  ['#', 'As stated', 'Resolves to', 'Present'],
  order.map((e) => [
    e.n,
    e.title,
    e.file ? `\`${e.file}\`` : (e.note ?? 'unresolved'),
    e.file ? (e.present ? 'yes' : 'NO') : '—',
  ]),
)}

${
  missing.length
    ? `**Finding.** ${missing.length} read-order ${missing.length === 1 ? 'entry names a document' : 'entries name documents'} this repository does not contain: ${missing
        .map((e) => `#${e.n} "${e.title}"`)
        .join(', ')}. A read-order contract that requires a document nobody has is not satisfiable, and the requirements that depend on it cannot be closed by reading. This is recorded rather than resolved: producing the document is not this domain's to do.`
    : '**Finding.** Every read-order entry resolves to a file in this repository.'
}

## 4. What this binding does not do

- It does not duplicate a counterpart's requirements into the Work Graph ledger.
  Section 0 assigns ownership; a requirement appears in exactly one ledger, and
  \`tests/architecture/wrk-requirements-are-imported.test.mjs\` fails if a
  \`WRK-*\` row is filed anywhere else.
- It does not record agreement from another domain's owner. Nobody has approved
  this mapping; it is a reading of the documents named above, and every claim it
  makes is checkable against a path.
- It does not assert that any bound counterpart's work is complete.
`
}

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render()
  const target = path.join(ROOT, OUT)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
      : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/wrk-authority-bindings.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}
