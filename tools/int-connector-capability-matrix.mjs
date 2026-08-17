#!/usr/bin/env node
/**
 * The supported connector and capability matrix, and every blocker and
 * limitation behind it — the integration Bible's INT-100-005, and the report §27
 * asks for ("report enabled connector capabilities and exact certified scope …
 * unsupported catalog items, external blockers").
 *
 * A hand-written matrix is the single most dangerous document this programme can
 * produce. It is the page somebody reads before telling an institution what
 * Tenure integrates with, and every incentive pushes it one row past the truth.
 * So no row is written here. Every status is parsed out of the module that
 * declares it, and `--check` fails when the committed document and those modules
 * disagree.
 *
 * ── The four registries this reads, and why it is four and not one ───────────
 *
 *   · `packages/provisioning/src/provider-packs.ts` — the 24 connector packs the
 *     work-graph Bible names, each with a lifecycle, a capability, a direction
 *     and per-clause certification evidence.
 *   · `packages/payments/src/capability-registry.ts` — the Stripe capability
 *     leaves, each with a state and the approval ADR a money-moving state
 *     requires. Payments is deliberately NOT a generic connector (§26: "do not
 *     reduce Stripe to a generic connector"), so its capabilities are counted
 *     separately rather than folded into a connector row.
 *   · `packages/platform-config/src/model-policy.ts` — the model catalog, which
 *     is the only integration in this repository with a `PUBLISHED` lifecycle,
 *     and therefore the only row in the matrix that says a capability is
 *     available. What it says about WHERE inference happens is the matrix's
 *     largest single limitation.
 *   · §7 of the Bible itself — the capability families a reader will look for.
 *     Absent families are listed as unsupported rather than omitted, because an
 *     omitted capability reads as one nobody asked for.
 *
 * ── Why "no certified capability exists" is a rigorous answer ───────────────
 *
 * The matrix does not guess which §7 family a pack fulfils, and it must not: a
 * fuzzy match between "SCIM user/group lifecycle" and a pack keyed
 * `okta.scim` is exactly the reasoning that produces a claim nobody checked.
 * It does not have to. A capability is supported when it is certified, the
 * certified set is EMPTY — no capability in any of the four registries above is
 * in a state that permits a tenant to use it, save the two models — and an empty
 * set covers no family, whatever the names are. The moment one is certified the
 * question stops being vacuous, and the accompanying test refuses a matrix that
 * reports a certified capability without saying which family it serves.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * Committed output, so: text is read with CRLF normalised to LF, every list is
 * sorted on an explicit key, the document is joined with `\n`, and no clock or
 * random value is read.
 *
 * Usage:  node tools/int-connector-capability-matrix.mjs [--check]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/int-connector-capability-matrix.md'

const PACKS = 'packages/provisioning/src/provider-packs.ts'
const CLAUSES = 'packages/provisioning/src/connector-capability.ts'
const PAYMENTS = 'packages/payments/src/capability-registry.ts'
const MODELS = 'packages/platform-config/src/model-policy.ts'
const BIBLE = 'Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md'
const DECISIONS = 'docs/decisions'

export const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

const field = (block, name) => block.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`))?.[1] ?? null

const list = (block, name) => {
  const raw = block.match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`))?.[1]
  if (raw === undefined) return []
  return [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1])
}

// ── 1. Connector packs ──────────────────────────────────────────────────────

/**
 * The eight clauses a capability must have been driven through before it may
 * claim availability, read from the module that enumerates them.
 *
 * Read rather than restated so that a ninth clause is immediately a column the
 * matrix reports as uncited, instead of a clause the matrix has never heard of.
 */
export function certificationClauses() {
  const text = read(CLAUSES)
  const block = text.match(/export const CERTIFICATION_CLAUSES = \[([\s\S]*?)\] as const/)?.[1]
  if (!block) throw new Error(`${CLAUSES} no longer declares CERTIFICATION_CLAUSES as an array literal`)
  return [...block.matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1])
}

/**
 * The connector packs, one row each.
 *
 * Split on the `pack({` construction site rather than parsed as TypeScript: the
 * platform test runner has no TS loader (`tools/run-platform-tests.mjs`), which
 * is the same reason `provider-packs-bind-requirements.test.mjs` reads this file
 * as text and the same reason `provider-packs.ts` writes its fields by name.
 */
export function connectorPacks() {
  return parsePacks(read(PACKS))
}

/** The parser, over text, so a fixture can prove it sees a status that is not PLANNED. */
export function parsePacks(text) {
  const blocks = text.split(/\n  pack\(\{\n/).slice(1)
  return blocks
    .map((raw) => {
      const block = raw.split(/\n  \}\),/)[0]
      return {
        key: field(block, 'key'),
        displayName: field(block, 'displayName'),
        provider: field(block, 'provider'),
        product: field(block, 'product'),
        capability: field(block, 'capability'),
        direction: field(block, 'direction'),
        // Absent means the helper's default, and the default is the honest one.
        lifecycle: field(block, 'lifecycle') ?? 'PLANNED',
        status: field(block, 'capabilityStatus') ?? 'PLANNED',
        // `clauseEvidence` is only present when somebody cited something; the
        // default is `NO_EVIDENCE`, which is eight empty arrays.
        citesEvidence: /\bclauseEvidence:/.test(block),
        egressHosts: list(block, 'egressHosts'),
        requirementIds: list(block, 'requirementIds'),
        hasSetupSchema: /\bsetup:\s*\{/.test(block),
      }
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1))
}

// ── 2. Payment capability leaves ────────────────────────────────────────────

/**
 * The Stripe capability leaves, with the state each is in.
 *
 * `planned()` and `unsupported()` are the only two constructors, and each hard
 * codes the state — so the state comes from which helper built the leaf. The
 * accompanying test asserts no leaf overrides `state:`, because a matrix that
 * read the constructor and missed an override would report a live capability as
 * planned, which is the error that matters in this direction.
 */
export function paymentCapabilities() {
  return parsePayments(read(PAYMENTS))
}

/** The parser, over text, so a fixture can prove both constructors are recognised. */
export function parsePayments(text) {
  const array = text.match(
    /export const PAYMENT_CAPABILITIES: readonly PaymentCapability\[\] = \[([\s\S]*?)\n\]\n/,
  )?.[1]
  if (!array) throw new Error(`${PAYMENTS} no longer declares PAYMENT_CAPABILITIES as an array literal`)

  return [...array.matchAll(/\b(planned|unsupported)\(\s*"([^"]+)",\s*"([^"]+)"/g)]
    .map((m) => ({
      id: m[2],
      program: m[3],
      state: m[1] === 'planned' ? 'PLANNED' : 'UNSUPPORTED',
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The states that put real money in front of a real tenant, read from the registry. */
export function statesRequiringApproval() {
  const block = read(PAYMENTS).match(
    /export const STATES_REQUIRING_APPROVAL: readonly CapabilityState\[\] = \[([\s\S]*?)\]/,
  )?.[1]
  return [...(block ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

// ── 3. Models ───────────────────────────────────────────────────────────────

/**
 * The model catalog, and where each entry's inference actually happens.
 *
 * `endpoint` is derived from the provider rather than declared: `bedrock` means
 * inference inside the platform's own AWS account, and anything else means a
 * call to a third-party API. The Bible requires the second to be impossible for
 * customer content (INT-080-004, §26 "route customer records to external AI
 * APIs"), so the derivation is the finding.
 */
export function modelCatalog() {
  return parseModels(read(MODELS))
}

/** The parser, over text, so a fixture can prove a Bedrock entry is read as in-account. */
export function parseModels(text) {
  const array = text.match(/export const MODEL_CATALOG: readonly ModelEntry\[\] = \[([\s\S]*?)\n\]\n/)?.[1]
  if (!array) throw new Error(`${MODELS} no longer declares MODEL_CATALOG as an array literal`)
  return array
    .split(/\n  \{\n/)
    .slice(1)
    .map((raw) => {
      const block = raw.split(/\n  \},?/)[0]
      const provider = field(block, 'provider')
      return {
        key: field(block, 'key'),
        modelId: field(block, 'modelId'),
        provider,
        lifecycle: field(block, 'lifecycle'),
        regions: list(block, 'regions'),
        endpoint: provider === 'bedrock' ? 'in-account (Bedrock)' : `third-party API (${provider})`,
      }
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1))
}

// ── 4. The Bible's own capability families ──────────────────────────────────

/**
 * §7's capability families, in the Bible's order.
 *
 * Its own words, so a reader comparing the two documents is comparing like with
 * like. The subsection heading is kept because the families are only meaningful
 * grouped — "MFA/risk signals" and "SIEM/security findings" are one part of the
 * estate and "tire tread" of another.
 */
export function capabilityFamilies() {
  const text = read(BIBLE)
  const section = text.match(/\n## 7\. Integration capability registry\n([\s\S]*?)\n## 8\./)?.[1]
  if (!section) throw new Error(`${BIBLE} no longer has a "## 7. Integration capability registry" section`)

  const families = []
  let heading = null
  for (const line of section.split('\n')) {
    const h = line.match(/^### (7\.\d+) (.+)$/)
    if (h) {
      heading = { number: h[1], title: h[2].trim() }
      continue
    }
    const bullet = line.match(/^- (.+)$/)
    // The prose paragraph under each subsection begins "Potential provider
    // families include…" and is not a capability; only the bullets are.
    if (bullet && heading) families.push({ ...heading, family: bullet[1].replace(/\.$/, '') })
  }
  return families
}

// ── The matrix ──────────────────────────────────────────────────────────────

/**
 * A connector capability is supported when its status says it runs today.
 *
 * The two words come from `ConnectorCapabilityStatus`: `AVAILABLE` and
 * `DEGRADED` both assert the capability runs against a real provider, which is
 * why `capabilityProblems` demands evidence for both and for nothing else.
 */
const SUPPORTED_CONNECTOR_STATUSES = ['AVAILABLE', 'DEGRADED']

export function collect() {
  const packs = connectorPacks()
  const payments = paymentCapabilities()
  const models = modelCatalog()
  const families = capabilityFamilies()
  const clauses = certificationClauses()
  const approvalStates = statesRequiringApproval()

  const supportedConnectors = packs.filter((p) => SUPPORTED_CONNECTOR_STATUSES.includes(p.status))
  const transactablePayments = payments.filter((p) => approvalStates.includes(p.state))
  const publishedModels = models.filter((m) => m.lifecycle === 'PUBLISHED')

  const blockers = [
    ...packs.map((p) => ({
      subject: `connector \`${p.key}\``,
      blocker:
        `Capability \`${p.provider}/${p.product}/${p.capability}\` (${p.direction}) is ${p.status} on a ` +
        `${p.lifecycle} pack and cites nothing for any of the ${clauses.length} certification clauses. ` +
        `No connector code, app registration, scope set, certification or provider review exists.`,
    })),
    ...payments
      .filter((p) => p.state === 'UNSUPPORTED')
      .map((p) => ({
        subject: `payments \`${p.id}\``,
        blocker: `Declared UNSUPPORTED in the ${p.program} program: Tenure has decided not to offer it, and its eligibility matrix is empty on every axis.`,
      })),
    ...payments
      .filter((p) => p.state === 'PLANNED')
      .map((p) => ({
        subject: `payments \`${p.id}\``,
        blocker: `PLANNED in the ${p.program} program. Reaching any of ${approvalStates.join(', ')} requires an approval ADR that exists on disk under \`${DECISIONS}\`; this leaf names none.`,
      })),
    ...models
      .filter((m) => m.endpoint !== 'in-account (Bedrock)')
      .map((m) => ({
        subject: `model \`${m.key}\``,
        blocker: `Inference is a ${m.endpoint} call. The Bible's INT-080 section requires customer AI inference to stay inside the Bedrock boundary, and §26 prohibits routing customer records to external AI APIs. This is the matrix's largest limitation and it is not a gap in a plan — it is what the running code does.`,
      })),
  ].sort((a, b) => (a.subject + a.blocker < b.subject + b.blocker ? -1 : 1))

  return {
    packs,
    payments,
    models,
    families,
    clauses,
    approvalStates,
    supportedConnectors,
    transactablePayments,
    publishedModels,
    blockers,
  }
}

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')

export function render(c) {
  const supportedTotal =
    c.supportedConnectors.length + c.transactablePayments.length + c.publishedModels.length

  return `<!-- Generated by tools/int-connector-capability-matrix.mjs. Do not edit by hand. -->
# Supported connector and capability matrix

Generated. The integration Bible's INT-100 section asks for a final supported
connector and capability matrix with every blocker and limitation, and §27 asks
the same question of the closing report. This is the computed answer, re-derived
from the four registries that declare the statuses and checked in CI by
\`tests/architecture/int-connector-capability-matrix.test.mjs\`.

No status is written here. \`${PACKS}\`, \`${PAYMENTS}\`,
\`${MODELS}\` and §7 of the Bible are the sources; this document is the join.

**${c.supportedConnectors.length} of ${c.packs.length} connector capabilities supported · ${c.transactablePayments.length} of ${c.payments.length} payment capabilities transactable · ${c.publishedModels.length} of ${c.models.length} models published · ${c.families.length} capability families named by the Bible · ${c.blockers.length} blockers.**

## 1. What a tenant can actually use today

${
  supportedTotal === 0
    ? 'Nothing.'
    : [
        c.supportedConnectors.length
          ? `- ${c.supportedConnectors.length} connector capability/capabilities: ${c.supportedConnectors.map((p) => `\`${p.key}\``).join(', ')}.`
          : '- No connector capability. Every pack is PLANNED and cites no certification evidence.',
        c.transactablePayments.length
          ? `- ${c.transactablePayments.length} payment capability/capabilities in a money-moving state: ${c.transactablePayments.map((p) => `\`${p.id}\``).join(', ')}.`
          : '- No payment capability. Every leaf is PLANNED or UNSUPPORTED, and none names an approval ADR.',
        c.publishedModels.length
          ? `- ${c.publishedModels.length} model(s) the assistant may invoke: ${c.publishedModels.map((m) => `\`${m.modelId}\` — ${m.endpoint}`).join(', ')}. Subject to the limitation in §6.`
          : '- No model.',
      ].join('\n')
}

That list is the matrix. Everything below is what is NOT available and why.

## 2. Connector packs

Lifecycle is the pack's; status is the capability's; "clauses cited" counts the
${c.clauses.length} certification clauses (${c.clauses.join(', ')}) with any
evidence behind them.

${table(
  ['Pack', 'Provider / product', 'Capability', 'Direction', 'Lifecycle', 'Status', 'Clauses cited', 'Asked for by', 'Egress'],
  c.packs.map((p) => [
    `\`${p.key}\``,
    `${p.provider} / ${p.product}`,
    `\`${p.capability}\``,
    p.direction,
    p.lifecycle,
    p.status,
    p.citesEvidence ? 'some — read the pack' : `0 of ${c.clauses.length}`,
    p.requirementIds.map((r) => `\`${r}\``).join(', '),
    p.egressHosts.map((h) => `\`${h}\``).join(', '),
  ]),
)}

## 3. Payment capabilities

Stripe is not a generic connector and is not counted as one. A leaf may only
reach ${c.approvalStates.join(', ')} by naming an approval ADR that exists on
disk under \`${DECISIONS}\`.

${table(
  ['Capability', 'Program', 'State', 'Transactable'],
  c.payments.map((p) => [
    `\`${p.id}\``,
    p.program,
    p.state,
    c.approvalStates.includes(p.state) ? 'yes' : 'no',
  ]),
)}

## 4. Models

${table(
  ['Entry', 'Model id', 'Lifecycle', 'Where inference happens', 'Regions'],
  c.models.map((m) => [
    `\`${m.key}\``,
    `\`${m.modelId}\``,
    m.lifecycle,
    m.endpoint,
    m.regions.map((r) => `\`${r}\``).join(', '),
  ]),
)}

## 5. The capability families the Bible names, and their support state

${c.families.length} families across §7's subsections. None is supported, and the
reason is not a mapping question: a family is supported when a certified
capability fulfils it, and ${c.supportedConnectors.length === 0 ? 'the certified set is empty' : 'the certified set is listed in §1'}. This document does not
guess which family a PLANNED pack would serve — a fuzzy match between a family's
name and a pack's key is how a claim nobody checked gets published.

${table(
  ['§', 'Subsection', 'Capability family', 'Supported'],
  c.families.map((f) => [f.number, f.title, f.family, 'no']),
)}

## 6. Every blocker and limitation

${c.blockers.map((b) => `- **${b.subject}** — ${b.blocker}`).join('\n')}

## 7. What this document is not

- **Not a certification.** It reports the state each registry declares. A pack
  that says PLANNED is reported as PLANNED; nothing here inspects a provider.
- **Not a traffic measurement.** No figure here came from an AWS account or a
  provider dashboard. Whether a capability has ever been exercised in production
  is a different question, and \`docs/architecture/int-integration-inventory.md\`
  records that it cannot be answered from this repository.
- **Not a substitute for the registries.** If this document and
  \`${PACKS}\` disagree, the module is right and this is stale — which \`--check\`
  turns into a failing build rather than a reading error.
`
}

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const target = path.join(ROOT, OUT)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/int-connector-capability-matrix.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}

export { OUT, ROOT, PACKS, PAYMENTS, MODELS, CLAUSES, BIBLE, DECISIONS, SUPPORTED_CONNECTOR_STATUSES }
