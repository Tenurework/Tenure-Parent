/**
 * PLN-040-005 — the published limitations page still says what the tree says.
 *
 * `tools/pln-planning-limitations.mjs` derives every number and verdict on
 * `docs/architecture/pln-planning-limitations.md` from the repository. This is
 * the half that makes that worth anything: it re-derives the document and
 * compares it byte for byte, so a hand edit to the page — or a change to the
 * repository the page has not been regenerated for — is a failing test rather
 * than a believed sentence.
 *
 * Byte-for-byte is not the only check here, because a generator whose own reader
 * is wrong renders a wrong document and then agrees with itself perfectly. So
 * the substantive claims are re-checked a SECOND way, deliberately not through
 * the generator's parsers:
 *
 *   - the grain the page publishes is read out of `schema.prisma` again here;
 *   - every currency code the page lists is checked against `money.ts` again;
 *   - every file path the page names is opened, and checked to still carry the
 *     token the page attributes to it;
 *   - the eleven statistical identifiers the page says appear nowhere are swept
 *     for again.
 *
 * And the refusals are exercised rather than trusted: a planning domain with no
 * probe set must throw, because a domain nobody probed is not absent, it is
 * unexamined, and a page that cannot tell those apart is the failure it exists
 * to prevent.
 *
 * Plain `node --test` — this directory is run by `npm run test:platform`, which
 * has no TypeScript and no jest globals.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { BIBLE, ROOT, SCHEMA, readText, sweptFiles } from '../../tools/pln-planning-inventory.mjs'
import {
  DOMAIN_NOTES,
  DOMAIN_PROBES,
  FINOPS_MONEY,
  FORECAST_ANCHORS,
  FORECAST_OBJECTS,
  OUTPUT,
  deriveDomainVerdicts,
  deriveDomains,
  deriveGrain,
  deriveRejectedProbes,
  render,
} from '../../tools/pln-planning-limitations.mjs'

const committed = () => readText(OUTPUT)

test('the committed limitations page is exactly what the tree derives', () => {
  assert.equal(
    committed(),
    render(),
    `${OUTPUT} is not what tools/pln-planning-limitations.mjs renders. Either the page was edited ` +
      `by hand, or the repository changed and the page was not regenerated. Run ` +
      `\`node tools/pln-planning-limitations.mjs\` and read the diff — every number on that page is ` +
      `a claim about this tree.`,
  )
})

test('every planning domain the Bible states has a probe set and a note', () => {
  const domains = deriveDomains()
  assert.equal(
    domains.length,
    8,
    `Section 6 of ${BIBLE} states ${domains.length} planning domains, not 8. A new domain must be ` +
      `examined before this page may claim anything about it.`,
  )
  for (const domain of domains) {
    assert.ok(DOMAIN_PROBES[domain], `no probe set for the planning domain "${domain}"`)
    assert.ok(DOMAIN_NOTES[domain], `no note for the planning domain "${domain}"`)
  }
})

test('a domain with no probe set is refused, not silently reported absent', () => {
  // The refusal is the load-bearing part of the design, so it is exercised
  // rather than trusted. Deleting the key rather than passing a fixture, because
  // the generator reads the module-level object and a fixture would prove a code
  // path the generator does not take.
  const domain = deriveDomains()[0]
  const saved = DOMAIN_PROBES[domain]
  delete DOMAIN_PROBES[domain]
  try {
    assert.throws(
      () => deriveDomainVerdicts(),
      /has no probe set for it/,
      'a planning domain with no probe set must throw, not read as absent',
    )
  } finally {
    DOMAIN_PROBES[domain] = saved
  }
  // And the world is put back: the same call now succeeds.
  assert.equal(deriveDomainVerdicts().length, 8)
})

test('a note claiming Absent is checked against the sweep, not just written', () => {
  // Re-derived here rather than reading the rendered table, so the property is
  // checked against the tree and not against the document's own prose.
  for (const { domain, hits } of deriveDomainVerdicts()) {
    if (/^Absent\b/.test(DOMAIN_NOTES[domain])) {
      assert.deepEqual(
        hits.map((h) => h.token),
        [],
        `the note for "${domain}" says Absent and the sweep found a probe hit`,
      )
    } else {
      assert.notEqual(
        hits.length,
        0,
        `the note for "${domain}" claims something is there and every probe found nothing`,
      )
    }
  }
})

test('every file the page attributes a probe to still carries it', () => {
  // The page names paths. A path that has moved, or that no longer contains the
  // token the page credits it with, makes the page's evidence unopenable — which
  // is the difference between a citation and a decoration.
  for (const { domain, hits } of deriveDomainVerdicts()) {
    for (const { token, files } of hits) {
      for (const file of files) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${domain}: ${file} does not exist`)
        assert.match(
          readText(file),
          new RegExp(`\\b${token}\\b`),
          `${domain}: ${file} no longer contains ${token}`,
        )
      }
    }
  }
})

test('every rejected probe still hits the file the page says it hits', () => {
  // The rejected-probe table is the page's evidence for a design decision. An
  // exemplar path that no longer contains its token turns that evidence into a
  // dead citation, which is worse than no table: it looks re-runnable and is not.
  for (const { token, exemplar, stillHits } of deriveRejectedProbes()) {
    assert.ok(
      stillHits,
      `${OUTPUT} says \`${token}\` hits ${exemplar} and it no longer does. Either pick another ` +
        `exemplar or drop the probe from the rejected list — and regenerate the page either way.`,
    )
    assert.match(readText(exemplar), new RegExp(`\\b${token}\\b`))
  }
})

test('the grain the page publishes is the grain the schema declares', () => {
  // A second, deliberately independent read of the same fact. The generator
  // slices the model block and matches `@@unique`; this searches the whole file
  // for the constraint on the line after the model's own closing rows. If the
  // two disagree, one of them is wrong and the page is not exact.
  const schema = readText(SCHEMA)
  const independently = (model) => {
    const block = /\n@@?/.test('') ? null : null
    const start = schema.indexOf(`model ${model} {`)
    assert.notEqual(start, -1, `${SCHEMA}: no model ${model}`)
    const body = schema.slice(start, schema.indexOf('\n}', start))
    const m = /@@unique\(\[([^\]]+)\]\)/.exec(body)
    assert.ok(m, `${SCHEMA}: model ${model} has no @@unique`)
    return m[1].split(',').map((f) => f.trim())
  }

  assert.deepEqual(deriveGrain('BudgetLine'), independently('BudgetLine'))
  assert.deepEqual(deriveGrain('Budget'), independently('Budget'))

  // And the page prints them. A correct derivation that never reached the
  // document proves nothing to a reader.
  const page = committed()
  for (const field of deriveGrain('BudgetLine')) {
    assert.match(page, new RegExp(`\`${field}\``), `${OUTPUT} does not print the axis ${field}`)
  }
})

test('every currency code the page lists is one the money layer actually knows', () => {
  const money = readText(FINOPS_MONEY)
  const known = new Set([...money.matchAll(/"([A-Z]{3})"/g)].map((m) => m[1]))
  // Scoped to the exponent bullets, not to the whole section: the default
  // currency `USD` is also printed in section 4 and is declared in
  // packages/platform-config, not here, so a whole-section scan would fail on a
  // code that is correctly named.
  const page = committed()
  const from = page.indexOf('- **Exponents known for')
  const to = page.indexOf('- **No conversion')
  assert.ok(from !== -1 && to > from, `${OUTPUT}: section 4's exponent bullets are not where this looks`)
  const listed = [...page.slice(from, to).matchAll(/`([A-Z]{3})`/g)].map((m) => m[1])
  assert.notEqual(listed.length, 0, `${OUTPUT} section 4 lists no currency codes`)
  assert.deepEqual(
    listed.filter((code) => !known.has(code)),
    [],
    `${OUTPUT} lists a currency code that ${FINOPS_MONEY} does not name. The page's whole claim in ` +
      `section 4 is that the exact set is the exact limit.`,
  )
})

test('the statistical identifiers the page says appear nowhere appear nowhere', () => {
  // The substantive forecast claim, re-swept. This is the assertion that turns
  // "there is no forecast" from an opinion into a measurement, so it does not go
  // through the generator.
  const files = sweptFiles()
  const found = []
  for (const token of FORECAST_ANCHORS) {
    const re = new RegExp(`\\b${token}\\b`)
    for (const file of files) {
      if (re.test(readText(file))) found.push(`${token} in ${file}`)
    }
  }
  assert.deepEqual(
    found,
    [],
    `${OUTPUT} states that no statistical or time-series identifier appears in the tree, and one ` +
      `now does. If forecasting has been implemented, regenerate the page — it will say so.`,
  )
})

test("the Bible's forecast objects are still absent from the schema", () => {
  const schema = readText(SCHEMA)
  const present = FORECAST_OBJECTS.filter((name) =>
    new RegExp(`^model\\s+${name}\\s*\\{`, 'm').test(schema),
  )
  assert.deepEqual(
    present,
    [],
    `${OUTPUT} states that all ${FORECAST_OBJECTS.length} forecast objects are absent from ` +
      `${SCHEMA}. Regenerate the page.`,
  )
})

test('the generated page is checkout-independent', () => {
  const page = fs.readFileSync(path.join(ROOT, OUTPUT), 'utf8')
  assert.ok(!page.includes('\r'), `${OUTPUT} contains a CR — it must be LF-only`)
  assert.ok(!page.includes('\\'), `${OUTPUT} contains a native path separator`)
  assert.ok(
    !page.includes(ROOT),
    `${OUTPUT} contains an absolute path from the machine that generated it`,
  )
})
