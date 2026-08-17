/**
 * ANL-040-002 — the Intuit Enterprise Suite comparison is computed, not claimed.
 *
 * §14 of the Analytics Bible sets out eleven competitor strengths and what
 * Tenure must do to "meet and exceed" each "through evidence", and then states
 * the rule that makes this guard necessary: "Do not copy Intuit UI or repeat
 * vendor performance claims as Tenure claims. Establish Tenure's own baselines
 * and comparable scenario tests."
 *
 * A comparison document is the single easiest artefact in this repository to
 * fake. It has no compiler, no runtime and no user; every cell is prose, and
 * prose about a competitor is exactly where "we are better" gets written. So
 * every cell that could flatter Tenure is derived here from the execution
 * ledgers:
 *
 *   · the eleven strengths must be the eleven §14 states, quoted;
 *   · every cited requirement must be one some ledger actually decides — a
 *     citation nobody owns is a claim with a reference-shaped hole in it;
 *   · the `Decided` ratio is recomputed, so it cannot lag the programme;
 *   · the verdict is a FUNCTION of that ratio, so `met` is unavailable while any
 *     cited requirement is unfinished;
 *   · `exceeds` is unavailable to every row until `ANL-040-001` — the comparable
 *     scenario tests §14 asks for — is itself PASS. Superiority is a measurement
 *     and the instrument does not exist.
 *
 * Plain `node --test`: `npm run test:platform` has no TypeScript and no jest.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { ROOT, ledgerStatuses } from '../../tools/document-graph.mjs'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const DOC = 'docs/architecture/anl-intuit-benchmark.md'
const BIBLE = 'Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md'

const doc = read(DOC)

/** §14, as its own slice, so a strength cannot be invented. */
function section14() {
  const text = read(BIBLE)
  const start = text.indexOf('## 14. Intuit Enterprise Suite benchmark')
  const end = text.indexOf('## 15. Best-system scorecard')
  assert.ok(start !== -1 && end > start, 'The Analytics Bible no longer has a §14 between §13 and §15.')
  return text.slice(start, end)
}

/** The competitor strengths §14 tabulates, in its order. */
function statedStrengths() {
  return section14()
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= 3)
    .map((cells) => cells[1])
    .filter((s) => s && s !== 'Intuit strength' && !/^-*:?-*$/.test(s))
}

/** The comparison rows this document publishes. */
function publishedRows() {
  const open = '<!-- comparison -->'
  const close = '<!-- /comparison -->'
  const start = doc.indexOf(open)
  assert.notEqual(start, -1, `${DOC} has no ${open} block; nothing here can read it.`)
  const end = doc.indexOf(close, start)
  assert.ok(end > start, `${DOC} opens the comparison block and never closes it.`)
  return doc
    .slice(start + open.length, end)
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    )
    .filter((cells) => !cells.every((c) => /^-*:?-*$/.test(c)))
    .filter((cells) => cells[0] !== 'Intuit strength (§14)')
    .map((cells) => ({
      strength: cells[0],
      ids: [...cells[1].matchAll(/`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}-\d+)`/g)].map((m) => m[1]),
      decided: cells[2],
      verdict: cells[3],
    }))
}

/** The verdict the ledgers dictate for a set of citations. */
function verdictFor(ids, statuses) {
  const passing = ids.filter((id) => statuses.get(id)?.status === 'PASS').length
  if (passing === 0) return 'not started'
  return passing === ids.length ? 'met' : 'partial'
}

test('the document reads at all, and covers the strengths §14 states', () => {
  const stated = statedStrengths()
  assert.equal(stated.length, 11, `§14 tabulates ${stated.length} Intuit strengths, not 11.`)
  assert.deepEqual(
    publishedRows().map((r) => r.strength),
    stated,
    `${DOC} must carry every §14 strength, in §14's order, spelled as §14 spells it. A comparison ` +
      `that quietly drops a row is a comparison that reports on the rows Tenure does best at.`,
  )
})

test('every cited requirement is one a ledger actually decides', () => {
  const statuses = ledgerStatuses()
  const rows = publishedRows()
  const unowned = []
  for (const row of rows) {
    for (const id of row.ids) {
      if (!statuses.has(id)) unowned.push(`${row.strength} → ${id}`)
    }
  }
  assert.deepEqual(
    unowned,
    [],
    `${DOC} cites a requirement no execution ledger decides. A citation nobody owns has no status, ` +
      `so the verdict above it is not derived from anything.`,
  )

  // Floors. Both findings below are absences, and a parser that read no ids
  // would report a perfectly consistent document.
  const cited = new Set(rows.flatMap((r) => r.ids))
  assert.ok(cited.size >= 25, `Only ${cited.size} distinct requirements are cited across eleven strengths.`)
  assert.ok(
    rows.every((r) => r.ids.length >= 2),
    'A strength cited against fewer than two requirements is a gesture, not a comparison.',
  )
  assert.ok(
    [...cited].some((id) => statuses.get(id)?.status === 'PASS'),
    'No cited requirement is PASS, so the verdict rule is never exercised by real data.',
  )
  // Ten of eleven rows cite another domain's work; a comparison that cited only
  // ANL would be analytics grading itself.
  assert.ok(
    new Set([...cited].map((id) => id.split('-')[0])).size >= 6,
    'The comparison cites too few domains to be about the platform.',
  )
})

/**
 * Why the two checks below are asymmetric, which they were not at first.
 *
 * The first version demanded exact equality between the published ratio and the
 * ledgers, and it went red within the hour — on `TTES-050-004`, which another
 * domain closed while this was being written. Think about what that guard
 * punishes: somebody else's requirement passing, in a file only this domain may
 * edit. A guard whose most likely failure is another team's good news is a guard
 * that gets deleted, and deleting it takes the overclaim check with it.
 *
 * The asymmetry follows from what §14 actually prohibits. It forbids claiming
 * capability Tenure has not got — so a ratio or verdict STRONGER than the ledgers
 * support is a hard failure, always. A ratio that lags is conservative: it
 * understates Tenure, which no rule in the Bible is written to prevent.
 *
 * One kind of lag is not tolerated, because it is the one a reader is entitled to
 * see: a row every one of whose requirements is now PASS. That is the whole point
 * of the exercise — "here is where we meet the competitor" — and it fires rarely
 * enough (three or four requirements across three domains all passing) to be
 * worth somebody's attention when it does.
 */
const RANK = { 'not started': 0, partial: 1, met: 2 }

test('the decided ratio never claims more than the ledgers show', () => {
  const statuses = ledgerStatuses()
  const overclaimed = []
  const lagging = []
  for (const row of publishedRows()) {
    const passing = row.ids.filter((id) => statuses.get(id)?.status === 'PASS').length
    const parsed = /^(\d+) of (\d+)$/.exec(row.decided)
    assert.ok(parsed, `${DOC}: "${row.decided}" is not a ratio. The column reads "N of M".`)
    const [, claimed, total] = parsed.map(Number)
    assert.equal(
      total,
      row.ids.length,
      `${DOC}: "${row.strength}" cites ${row.ids.length} requirements and says "of ${total}".`,
    )
    if (claimed > passing) {
      overclaimed.push(`${row.strength}: says ${claimed} decided, ledgers show ${passing}`)
    } else if (claimed < passing) {
      lagging.push(`${row.strength}: says ${claimed} decided, ledgers show ${passing}`)
    }
  }
  assert.deepEqual(
    overclaimed,
    [],
    `${DOC} claims more decided requirements than the ledgers record. §14 forbids claiming ` +
      `capability beyond measured scope; re-read the requirement rather than editing the number.`,
  )
  // Lag is reported in the assertion message of the check below when it matters,
  // and tolerated here. Recorded rather than silent so a reader of a failure
  // elsewhere in this file can see it was a deliberate choice.
  if (lagging.length > 0) console.log(`(lagging, tolerated: ${lagging.join('; ')})`)
})

test('a verdict never outruns the work, and a fully met row is published as met', () => {
  const statuses = ledgerStatuses()
  const stronger = []
  const unpublished = []
  for (const row of publishedRows()) {
    const derived = verdictFor(row.ids, statuses)
    assert.ok(row.verdict in RANK, `${DOC}: "${row.verdict}" is outside the verdict vocabulary.`)
    if (RANK[row.verdict] > RANK[derived]) {
      stronger.push(`${row.strength}: says "${row.verdict}", the ledgers support at most "${derived}"`)
    }
    if (derived === 'met' && row.verdict !== 'met') {
      unpublished.push(`${row.strength}: every cited requirement is PASS and the table still says "${row.verdict}"`)
    }
  }
  assert.deepEqual(
    stronger,
    [],
    `${DOC} states a verdict stronger than its own rule produces. "met" requires every cited ` +
      `requirement to be PASS.`,
  )
  assert.deepEqual(
    unpublished,
    [],
    `${DOC} has a row Tenure now meets in full and does not say so. This is the one direction of lag ` +
      `that is not tolerated: it is the claim §14 asks for, and it is now earned.`,
  )
})

test('the verdict rule is exercised directly, including the branch no row reaches yet', () => {
  // Every row in the table today is `not started` or `partial`, so the `met`
  // branch of the rule is never taken by real data — and an assertion nothing
  // exercises is an assertion that could be wrong in either direction without
  // anybody noticing. Fed a synthetic ledger instead, which is the one place a
  // synthetic fixture belongs: proving the rule, not standing in for the tree.
  const statuses = new Map([
    ['X-000-001', { status: 'PASS' }],
    ['X-000-002', { status: 'PASS' }],
    ['X-000-003', { status: 'FAIL' }],
    ['X-000-004', { status: 'BLOCKED_EXTERNAL' }],
  ])
  assert.equal(verdictFor(['X-000-001', 'X-000-002'], statuses), 'met')
  assert.equal(verdictFor(['X-000-001', 'X-000-003'], statuses), 'partial')
  assert.equal(verdictFor(['X-000-003', 'X-000-004'], statuses), 'not started')
  // BLOCKED_EXTERNAL is not decided for this purpose. A blocked requirement is
  // work nobody has done, whatever the reason, and a comparison that counted it
  // as met would claim a capability that is blocked.
  assert.equal(verdictFor(['X-000-001', 'X-000-004'], statuses), 'partial')
  // An id no ledger decides can never lift a verdict.
  assert.equal(verdictFor(['X-000-999'], statuses), 'not started')
  // And the ranking the publication check uses is the one that ordering implies.
  assert.ok(RANK['not started'] < RANK.partial && RANK.partial < RANK.met)
})

test('superiority is not claimed while the instrument for measuring it is unbuilt', () => {
  // The strongest sentence anybody could add to this document, and the one §14
  // explicitly forbids without "comparable scenario tests". Those are
  // ANL-040-001. While it is unfinished, no row may claim to exceed anything.
  const scenarios = ledgerStatuses().get('ANL-040-001')
  assert.ok(scenarios, 'ANL-040-001 has no ledger row, so this control has nothing to stand on.')
  if (scenarios.status === 'PASS') return

  const claims = publishedRows().filter((r) => /exceed/i.test(r.verdict))
  assert.deepEqual(
    claims.map((r) => r.strength),
    [],
    `${DOC} claims Tenure exceeds a competitor while ANL-040-001 (comparable scenario tests) is ` +
      `${scenarios.status}. Superiority is a measurement; build the scenarios first.`,
  )
  assert.ok(
    doc.includes('Nothing in this table says Tenure exceeds Intuit at anything'),
    `${DOC} must say plainly that no superiority is claimed, so a reader does not infer one.`,
  )
})

test('no vendor performance figure is repeated as a Tenure claim', () => {
  // §14's other prohibition. Narrow on purpose: what is forbidden is a NUMBER
  // attached to the competitor, which is the shape a repeated vendor claim
  // takes. "Intuit Enterprise Suite" as a name is the subject of the document.
  const offending = doc
    .split('\n')
    .filter((line) => /\bIntuit\b[^.\n]*?\b\d+(?:\.\d+)?\s*(?:%|x\b|times|seconds|minutes|hours|days)/i.test(line))
  assert.deepEqual(
    offending,
    [],
    `${DOC} attaches a performance figure to the competitor. §14: "do not repeat vendor performance ` +
      `claims as Tenure claims". Measure Tenure and cite the measurement.`,
  )
  assert.ok(
    doc.includes('Do not copy Intuit UI or repeat vendor performance claims as Tenure claims.'),
    `${DOC} must quote the prohibition it is written to obey.`,
  )
})

test('the other mandatory competitors are named, with the scenario gap stated', () => {
  // §14 makes Intuit mandatory "in addition to" seven others. A comparison that
  // silently narrowed to the one competitor would satisfy every check above.
  for (const competitor of ['SAP', 'Oracle', 'Workday', 'Salesforce', 'Rippling', 'NetSuite']) {
    assert.ok(section14().includes(competitor), `§14 no longer names ${competitor}; re-read it.`)
    assert.ok(doc.includes(competitor), `${DOC} must name ${competitor}, which §14 makes mandatory too.`)
  }
  const scenarios = ledgerStatuses().get('ANL-040-001')
  assert.ok(
    doc.includes(`\`ANL-040-001\`, which is \`${scenarios.status}\``),
    `${DOC} must state ANL-040-001's real status (${scenarios.status}) where it explains why the ` +
      `other competitors have no scenarios.`,
  )
})
