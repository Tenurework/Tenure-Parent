/**
 * The supported connector and capability matrix, checked in both directions.
 *
 * `tools/int-connector-capability-matrix.mjs` answers the integration Bible's
 * INT-100-005 — a final supported connector/capability matrix with every blocker
 * and limitation. The document says almost everything is unavailable, and a
 * document that says "nothing is supported" is the easiest kind to fake: a parser
 * that matches nothing produces exactly that page, and it would pass a byte
 * comparison against itself forever.
 *
 * So the length here is spent on the second failure mode. Every count is
 * re-derived from the source modules by code that shares nothing with the
 * generator, and every parser is driven with a fixture that DOES declare a
 * supported capability — so a parser blind to `AVAILABLE`, to `GA`, or to a
 * Bedrock model would red here rather than publishing a reassuringly empty
 * matrix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  BIBLE,
  CLAUSES,
  DECISIONS,
  MODELS,
  OUT,
  PACKS,
  PAYMENTS,
  ROOT,
  SUPPORTED_CONNECTOR_STATUSES,
  certificationClauses,
  capabilityFamilies,
  collect,
  connectorPacks,
  modelCatalog,
  parseModels,
  parsePacks,
  parsePayments,
  paymentCapabilities,
  read,
  render,
  statesRequiringApproval,
} from '../../tools/int-connector-capability-matrix.mjs'

const doc = () => fs.readFileSync(path.join(ROOT, OUT), 'utf8').replace(/\r\n/g, '\n')

test('the committed matrix matches the registries', () => {
  const out = execFileSync('node', ['tools/int-connector-capability-matrix.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

test('every connector pack in the registry has a row, counted independently', () => {
  // `grep -c '^  pack({$'` is the count the ledger for INT-000-001 already
  // records, re-derived here rather than trusted: the generator splits on the
  // same construction site, so a change to that shape must fail loudly instead
  // of quietly halving the matrix.
  const text = read(PACKS)
  const constructionSites = (text.match(/^ {2}pack\(\{$/gm) ?? []).length
  const packs = connectorPacks()
  assert.equal(packs.length, constructionSites)
  assert.ok(packs.length >= 24, `only ${packs.length} connector packs parsed`)

  // Every key the file declares, found a completely different way.
  const keys = [...text.matchAll(/^ {4}key: "([^"]+)",$/gm)].map((m) => m[1]).sort()
  assert.deepEqual(
    packs.map((p) => p.key),
    keys,
  )

  const rendered = doc()
  for (const p of packs) {
    assert.ok(rendered.includes(`\`${p.key}\``), `${OUT} has no row for connector ${p.key}`)
    assert.ok(p.provider && p.product && p.capability && p.direction, `${p.key} parsed with a null field`)
    assert.ok(p.requirementIds.length > 0, `${p.key} parsed with no requirement binding`)
  }
})

test('every payment capability leaf has a row, and its state comes from one place', () => {
  const text = read(PAYMENTS)
  const array = text.match(
    /export const PAYMENT_CAPABILITIES: readonly PaymentCapability\[\] = \[([\s\S]*?)\n\]\n/,
  )[1]
  const constructors = (array.match(/\b(?:planned|unsupported)\(/g) ?? []).length
  const leaves = paymentCapabilities()
  assert.equal(leaves.length, constructors)
  assert.ok(leaves.length >= 31, `only ${leaves.length} payment capabilities parsed`)

  // The matrix reads the state off which constructor built the leaf. That is only
  // sound while no leaf overrides it — an override would make a GA capability
  // read as PLANNED, which is the direction that matters.
  assert.doesNotMatch(
    array,
    /\bstate:\s*"/,
    `a leaf in ${PAYMENTS} overrides state:. The matrix reads state from the constructor and would report it wrongly.`,
  )

  const rendered = doc()
  for (const leaf of leaves) assert.ok(rendered.includes(`\`${leaf.id}\``), `${OUT} has no row for ${leaf.id}`)
})

test('every model in the catalog has a row', () => {
  const models = modelCatalog()
  const declared = (read(MODELS).match(/^ {4}modelId: "/gm) ?? []).length
  assert.equal(models.length, declared)
  assert.ok(models.length > 0, 'no model parsed out of the catalog')
  for (const m of models) assert.ok(doc().includes(`\`${m.modelId}\``), `${OUT} has no row for ${m.modelId}`)
})

test('every capability family the Bible names has a row', () => {
  // Re-derived from the Bible by a different traversal: slice §7 out and count
  // the bullets. 67 today, and the assertion is the equality rather than the
  // number so a Bible edit moves both together.
  const text = read(BIBLE)
  const section = text.split('\n## 7. Integration capability registry\n')[1].split('\n## 8.')[0]
  const bullets = section.split('\n').filter((l) => /^- /.test(l))

  const families = capabilityFamilies()
  assert.equal(families.length, bullets.length)
  assert.ok(families.length > 50, `only ${families.length} capability families parsed`)

  const rendered = doc()
  for (const f of families) {
    assert.ok(rendered.includes(`| ${f.family} | no |`), `${OUT} does not list capability family "${f.family}"`)
  }
})

test('the eight certification clauses are read from the module that declares them', () => {
  const clauses = certificationClauses()
  assert.equal(clauses.length, 8, `${CLAUSES} declares ${clauses.length} certification clauses`)
  assert.ok(clauses.includes('golden') && clauses.includes('scope-exactness'))
  for (const c of clauses) assert.ok(doc().includes(c), `${OUT} does not name the ${c} clause`)
})

test('a supported connector capability would be seen, and named', () => {
  // The mutation this whole file exists for, applied as a fixture instead of to
  // the registry: a pack that says AVAILABLE. If the parser could not read
  // `capabilityStatus`, the real matrix's "0 of 24 supported" would be an
  // artefact of the parser rather than a fact about the packs.
  const fixture = `
  pack({
    key: "fixture.provider",
    displayName: "Fixture Provider",
    provider: "fixture",
    product: "thing",
    capability: "thing.sync",
    direction: "read",
    capabilityStatus: "AVAILABLE",
    lifecycle: "PUBLISHED",
    egressHosts: ["api.fixture.test"],
    requirementIds: ["INT-100-005"],
  }),
`
  const [parsed] = parsePacks(fixture)
  assert.equal(parsed.key, 'fixture.provider')
  assert.equal(parsed.status, 'AVAILABLE')
  assert.equal(parsed.lifecycle, 'PUBLISHED')
  assert.ok(SUPPORTED_CONNECTOR_STATUSES.includes(parsed.status))

  // And it reaches §1, so the headline count is wired to the parser.
  const c = collect()
  const page = render({ ...c, packs: [...c.packs, parsed], supportedConnectors: [parsed] })
  assert.match(page, /1 of \d+ connector capabilities supported/)
  assert.match(page, /`fixture\.provider`/)
})

test('a transactable payment capability and a Bedrock model would both be seen', () => {
  const payments = parsePayments(`
export const PAYMENT_CAPABILITIES: readonly PaymentCapability[] = [
  planned("acceptance.card-and-wallet", "payments", "x", []),
  unsupported("acceptance.in-person-terminal", "terminal", "x", []),
]
`)
  assert.deepEqual(
    payments.map((p) => `${p.id}:${p.state}`),
    ['acceptance.card-and-wallet:PLANNED', 'acceptance.in-person-terminal:UNSUPPORTED'],
  )
  // The states that mean money is moving are read from the registry, not from
  // this test — and there is at least one, or "0 transactable" is vacuous.
  const approval = statesRequiringApproval()
  assert.ok(approval.includes('GA'), `STATES_REQUIRING_APPROVAL is ${approval.join(', ')}`)

  const models = parseModels(`
export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    kind: "model",
    key: "bedrock.fixture",
    displayName: "Fixture",
    modelId: "anthropic.fixture-v1",
    provider: "bedrock",
    lifecycle: "PUBLISHED",
    publisher: "platform",
    regions: ["us-east-1"],
  },
]
`)
  assert.equal(models.length, 1)
  assert.equal(models[0].endpoint, 'in-account (Bedrock)')
  // And the real catalog is NOT that, which is the matrix's largest limitation.
  assert.ok(
    modelCatalog().every((m) => m.endpoint !== 'in-account (Bedrock)'),
    'a Bedrock model appeared in the catalog — §6 of the matrix needs rewriting, and INT-080-004 revisiting',
  )
})

test('every blocker names a subject that exists in a registry', () => {
  const c = collect()
  assert.ok(c.blockers.length > 40, `only ${c.blockers.length} blockers derived`)

  const known = new Set([
    ...c.packs.map((p) => `connector \`${p.key}\``),
    ...c.payments.map((p) => `payments \`${p.id}\``),
    ...c.models.map((m) => `model \`${m.key}\``),
  ])
  for (const b of c.blockers) {
    assert.ok(known.has(b.subject), `blocker names ${b.subject}, which is in no registry`)
    assert.ok(b.blocker.length > 40, `blocker for ${b.subject} says nothing checkable`)
  }
  // One blocker per unavailable thing, and nothing unavailable without one.
  const unavailable =
    c.packs.filter((p) => !SUPPORTED_CONNECTOR_STATUSES.includes(p.status)).length +
    c.payments.length +
    c.models.filter((m) => m.endpoint !== 'in-account (Bedrock)').length
  assert.equal(c.blockers.length, unavailable)
})

test('the matrix cites the decision directory a payments approval needs', () => {
  assert.ok(fs.existsSync(path.join(ROOT, DECISIONS)), `${DECISIONS} does not exist`)
  assert.ok(doc().includes(DECISIONS))
})

test('no secret-shaped value reaches the matrix', () => {
  // The Bible's §2 forbids a credential in any evidence, and a generated document
  // is evidence. The packs carry endpoints and hosts; if one ever carries a token
  // this refuses to publish it.
  for (const pattern of [/sk_(?:live|test)_[A-Za-z0-9]/, /whsec_[A-Za-z0-9]/, /AKIA[0-9A-Z]{8}/, /-----BEGIN/]) {
    assert.doesNotMatch(doc(), pattern, `${OUT} contains a token-shaped value`)
  }
})

test('every path the matrix cites exists', () => {
  const cited = [...doc().matchAll(/`((?:apps|packages|tools|tests|docs)\/[^`\s]+?)`/g)].map((m) => m[1])
  assert.ok(cited.length > 3, `only ${cited.length} paths cited`)
  for (const p of new Set(cited)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${OUT} cites ${p}, which does not exist`)
  }
})

test('the matrix does not take a requirement away from the Bible', () => {
  for (const line of doc().split('\n')) {
    assert.doesNotMatch(
      line,
      /^\**[A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+)\**\s+—/,
      `${OUT} states a requirement id at the start of a line: ${line}`,
    )
  }
})
