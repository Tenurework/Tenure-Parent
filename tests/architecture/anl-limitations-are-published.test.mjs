/**
 * ANL-040-005 — the published limitations are the measured ones.
 *
 * The Analytics Bible §17 asks for "exact metric/report/analytics limitations
 * and blocked sources" to be published, and §19 forbids claiming capability
 * beyond measured released scope. `docs/architecture/anl-analytics-limitations.md`
 * is the publication. This is what stops it becoming a sentence.
 *
 * A published limitation fails in a direction most guards do not look. A stale
 * inventory over-reports work; a stale limitation UNDER-reports it — the document
 * still lists yesterday's five gaps while the sixth has landed and nobody is
 * told. So every set below is asserted in BOTH directions: a limitation the code
 * no longer has must come out, and a gap the code has must be in.
 *
 * The colour-vision half of that document is not checked here. It needs the
 * TypeScript simulator in `apps/web/src/components/charts/cvd.ts`, so it is
 * checked by `cvd.test.ts` under jest, which is where the arithmetic lives. Two
 * copies of that arithmetic — one in `.mjs` for this file — is the defect this
 * repository already carries a note about.
 *
 * Plain `node --test`: `npm run test:platform` has no TypeScript and no jest.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { ROOT, ledgerStatuses } from '../../tools/document-graph.mjs'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const DOC = 'docs/architecture/anl-analytics-limitations.md'
const BIBLE = 'Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md'
const LEDGER = 'docs/implementation/analytics-reporting-execution-ledger.md'
const KIT = 'apps/web/src/components/charts'
const FRAME = `${KIT}/ChartFrame.tsx`
const ANALYTICS_LIB = 'apps/web/src/lib/analytics'

const doc = read(DOC)

/** The text between `<!-- name -->` and `<!-- /name -->`. */
function block(name) {
  const open = `<!-- ${name} -->`
  const close = `<!-- /${name} -->`
  const start = doc.indexOf(open)
  assert.notEqual(start, -1, `${DOC} has no ${open} block; the guard for it cannot read anything.`)
  const end = doc.indexOf(close, start)
  assert.ok(end > start, `${DOC} opens ${open} and never closes it.`)
  return doc.slice(start + open.length, end)
}

/** Table rows inside a marked block, as arrays of trimmed cells. */
function rows(name) {
  return block(name)
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
    .filter((cells) => !/^(Module|Vision|§7 slot|§7 family)$/i.test(cells[0]))
}

const unquote = (cell) => cell.replace(/`/g, '').trim()

// ── the derivations ─────────────────────────────────────────────────────────

/** §7 of the Bible, as its own slice, so a mark name cannot be invented. */
function section7() {
  const text = read(BIBLE)
  const start = text.indexOf('## 7. High-end visualization grammar')
  const end = text.indexOf('## 8. Domain visualization minimums')
  assert.ok(start !== -1 && end > start, 'The Analytics Bible no longer has a §7 between §6 and §8.')
  return text.slice(start, end)
}

/** The fourteen slots §7's opening sentence says a ChartFrame contains. */
function declaredFrameSlots() {
  const sentence = /Use a shared `ChartFrame` containing ([^.]+)\./.exec(section7())
  assert.ok(sentence, "§7 no longer states what a ChartFrame contains; the slot list cannot be derived.")
  return sentence[1]
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The props `ChartFrame` actually declares, from its own destructuring. */
function frameProps() {
  const source = read(FRAME)
  const open = source.indexOf('export function ChartFrame({')
  assert.notEqual(open, -1, `${FRAME} no longer declares ChartFrame as a destructuring component.`)
  const close = source.indexOf('}: {', open)
  assert.ok(close > open, `${FRAME}'s prop destructuring is not followed by its type literal.`)
  return source
    .slice(source.indexOf('{', open) + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z]\w*$/.test(s))
}

/**
 * Every `*.tsx` in the chart kit itself (not its panels, and not its tests).
 *
 * The test exclusion is the same rule `tools/anl-analytics-inventory.mjs` states
 * in its own header — "a test is evidence ABOUT an artefact, never one" — and it
 * was missing here only because every test beside the kit happened to be `.ts`
 * until one arrived as `.tsx`. Without it, `chart-integrity.test.tsx` is derived
 * as a kit module and the disposition table is asked to classify a test file as
 * a mark or as frame chrome, which it is neither of.
 */
function kitModules() {
  return fs
    .readdirSync(path.join(ROOT, KIT))
    .filter((f) => f.endsWith('.tsx') && !/\.(i?test|spec)\.tsx$/.test(f))
    .sort()
}

/**
 * Modules that render a chart mark, and whether the mark sits in a `ChartFrame`.
 *
 * `ChartFrame.tsx` is excluded by name: it names `<LineAreaChart>` in its own
 * header prose, which is a mention rather than a render, and it IS the frame.
 */
function markRenderers() {
  const marks = kitModules()
    .map((f) => f.replace(/\.tsx$/, ''))
    .filter((n) => /Chart$|^Sparkline$|^Meter$|^LiveStats$/.test(n))
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) files.push(rel)
    }
  }
  walk('apps/web/src')
  walk('apps/system-studio/src')

  const out = []
  for (const file of files) {
    if (file === FRAME) continue
    const text = read(file)
    const used = marks.filter((m) => new RegExp(`<${m}[\\s/>]`).test(text))
    if (used.length === 0) continue
    out.push({ file, used, framed: /<ChartFrame[\s/>]/.test(text) })
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1))
}

/** Exports in the analytics library whose doc comment declares a limitation. */
function declaredMetricLimitations() {
  const out = []
  for (const name of fs.readdirSync(path.join(ROOT, ANALYTICS_LIB)).sort()) {
    if (!name.endsWith('.ts') || /\.(test|spec)\.ts$/.test(name)) continue
    const file = `${ANALYTICS_LIB}/${name}`
    const text = read(file)
    const re = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g
    for (const m of text.matchAll(re)) {
      if (/\*\*Limitation\.\*\*/.test(m[1])) out.push(`${file} ${m[2]}`)
    }
  }
  return out.sort()
}

/** ANL requirements the ledger does not record as PASS, with their status. */
function undecided() {
  const statuses = ledgerStatuses()
  const out = []
  for (const [id, entry] of statuses) {
    if (!id.startsWith('ANL-')) continue
    if (entry.source_ledger !== LEDGER) continue
    if (entry.status === 'PASS') continue
    out.push(`${id}  ${entry.status}`)
  }
  return out.sort()
}

// ── the assertions ──────────────────────────────────────────────────────────

test('the derivations are not empty', () => {
  // Every check below is a set comparison, and a derivation that returned
  // nothing would agree with a document that published nothing.
  assert.ok(declaredFrameSlots().length === 14, `§7 names ${declaredFrameSlots().length} frame slots, not 14.`)
  assert.ok(frameProps().length >= 8, `ChartFrame declares only ${frameProps().length} props.`)
  assert.ok(kitModules().length >= 10, `The chart kit has ${kitModules().length} components.`)
  assert.ok(markRenderers().length >= 5, `Only ${markRenderers().length} modules render a mark.`)
  assert.ok(declaredMetricLimitations().length >= 1, 'No analytics export declares a limitation at all.')
  assert.ok(undecided().length >= 5, `Only ${undecided().length} ANL requirements are undecided.`)
  assert.ok(rows('grammar').length >= 40, `The grammar table has ${rows('grammar').length} rows.`)
})

test('every metric limitation declared in code is published', () => {
  const published = rows('metric-limitations').map((r) => `${unquote(r[0])} ${unquote(r[1])}`)
  assert.deepEqual(
    published.sort(),
    declaredMetricLimitations(),
    `${DOC} and the analytics library disagree about which metrics declare a limitation. A caveat ` +
      `that exists in code and not in the publication is the failure this requirement is about.`,
  )
})

test('the frame-slot table lists §7 slots, in §7 order, and nothing else', () => {
  const published = rows('frame-slots').map((r) => r[0])
  assert.deepEqual(
    published,
    declaredFrameSlots(),
    `${DOC}'s frame-slot table is not the list §7 states. It must be quoted from the Bible, in order.`,
  )
})

test('a carried frame slot names a prop ChartFrame really has, and an absent one names none', () => {
  const props = frameProps()
  const cited = new Map(rows('frame-slots').map((r) => [r[0], unquote(r[1])]))

  const invented = [...cited].filter(([, prop]) => prop !== '—' && !props.includes(prop))
  assert.deepEqual(
    invented.map(([slot, prop]) => `${slot} → ${prop}`),
    [],
    `${DOC} claims a §7 slot is carried by a prop ChartFrame does not declare.`,
  )

  // The other direction, which is the one that goes stale: a prop lands, the
  // slot it fills is still published as missing, and the document under-reports
  // the frame. `children` is the mark itself, not a slot.
  const uncited = props.filter((p) => p !== 'children' && ![...cited.values()].includes(p))
  assert.deepEqual(
    uncited,
    [],
    `ChartFrame declares props no §7 slot in ${DOC} accounts for: ${uncited.join(', ')}. Either the ` +
      `slot is now carried and the table must say so, or the prop is not a §7 slot and the document ` +
      `must say what it is.`,
  )

  const carried = [...cited.values()].filter((v) => v !== '—').length
  assert.ok(
    doc.includes(`carries ${carried} of the ${cited.size} slots`),
    `${DOC} must state the ratio it derives: "carries ${carried} of the ${cited.size} slots".`,
  )
})

test('the unframed mark renderers are exactly the ones published', () => {
  const derived = markRenderers()
  const bare = derived.filter((m) => !m.framed).map((m) => m.file)
  const published = block('bare-marks')
    .split('\n')
    .filter((l) => l.trim().startsWith('- `'))
    .map((l) => unquote(l.replace(/^\s*-\s*/, '')))

  assert.deepEqual(
    published.sort(),
    [...bare].sort(),
    `${DOC} and the tree disagree about which chart-rendering modules ship no accessible table, ` +
      `no export and no provenance. A module that gains a ChartFrame must leave this list; one that ` +
      `renders a new bare mark must join it.`,
  )
  const framed = derived.length - bare.length
  assert.ok(
    doc.includes(`${framed} of ${derived.length}`),
    `${DOC} must state the adoption ratio it derives, in digits so it can be checked: ` +
      `"${framed} of ${derived.length}".`,
  )
})

test('the kit-module dispositions cover the kit exactly', () => {
  const published = rows('kit-modules').map((r) => unquote(r[0]))
  assert.deepEqual(
    published.sort(),
    kitModules(),
    `${DOC} must give every chart-kit component a disposition — a mark or frame chrome — and invent ` +
      `none. A new mark nobody classified is a grammar claim nobody made.`,
  )
  const dispositions = new Set(rows('kit-modules').map((r) => r[1]))
  assert.deepEqual([...dispositions].sort(), ['chrome', 'mark'], 'The disposition vocabulary is mark | chrome.')
})

test('the grammar table covers every §7 family the Bible states', () => {
  const families = [...section7().matchAll(/^###\s+(7\.\d+.*?)\s*$/gm)].map((m) => m[1])
  const published = [...new Set(rows('grammar').map((r) => r[0]))]
  assert.deepEqual(
    published,
    families,
    `${DOC}'s grammar table must carry every §7 subsection, in order, spelled as the Bible spells it.`,
  )
})

test('the grammar table invents no mark and no implementation', () => {
  const text = section7().toLowerCase()
  const invented = rows('grammar')
    .map((r) => r[1])
    .filter((mark) => !text.includes(mark.toLowerCase()))
  assert.deepEqual(
    invented,
    [],
    `${DOC} lists a mark §7 does not name: ${invented.join(', ')}. The list is quoted from the ` +
      `authority, not compiled from opinion.`,
  )

  const marks = new Set(rows('kit-modules').filter((r) => r[1] === 'mark').map((r) => unquote(r[0])))
  const cited = new Set()
  for (const row of rows('grammar')) {
    if (row[2] === '—') continue
    for (const module of row[2].split(',').map(unquote)) {
      cited.add(module)
      assert.ok(
        marks.has(module),
        `${DOC} says ${module} ships "${row[1]}", and the kit-module table does not call it a mark.`,
      )
    }
  }
  // Both directions: a mark module nothing cites is a component the document
  // forgot to place in the grammar, which is how coverage gets under-reported.
  assert.deepEqual(
    [...marks].filter((m) => !cited.has(m)).sort(),
    [],
    `${DOC} calls a kit component a mark and no §7 row says which mark it draws.`,
  )
})

test('the grammar coverage ratio is the one the table adds up to', () => {
  const all = rows('grammar')
  const shipped = all.filter((r) => r[2] !== '—').length
  assert.ok(
    doc.includes(`${shipped} of the ${all.length} marks`),
    `${DOC} must state the coverage it derives: "${shipped} of the ${all.length} marks".`,
  )
  // A ratio nobody can inflate by adding rows: the not-shipped rows must state
  // the em dash and nothing else, so "shipped" is a citation or an absence.
  const vague = all.filter((r) => r[2] !== '—' && !r[2].includes('`'))
  assert.deepEqual(vague.map((r) => `${r[0]} / ${r[1]}`), [], 'A shipped mark cites a module in backticks.')
})

test('a blocked source is still blocked, in the code that says so', () => {
  // A blocker is a claim about the world and the world moves. Both entries in the
  // published table point at something re-checkable.
  const cost = read('apps/system-studio/src/lib/cost-source.ts')
  assert.match(cost, /NOT_CONFIGURED/, 'The FinOps source no longer reports a NOT_CONFIGURED arm.')
  for (const env of ['FINOPS_CUR_BUCKET', 'FINOPS_CUR_PREFIX']) {
    assert.ok(cost.includes(env), `${DOC} names ${env} as the missing configuration and the module does not.`)
    assert.ok(doc.includes(env), `${DOC} must name the environment the blocked source needs.`)
  }

  const schema = read('apps/web/prisma/schema.prisma')
  for (const model of ['MetricDefinition', 'MetricVersion', 'SemanticModel', 'ReportDefinition']) {
    assert.equal(
      new RegExp(`^model ${model}\\b`, 'm').test(schema),
      false,
      `${DOC} publishes the absent semantic layer as a blocked source, and \`model ${model}\` now ` +
        `exists. Re-decide ANL-000-003 rather than leaving the limitation standing.`,
    )
  }
})

test('the undecided list is exactly what the ledger has not decided', () => {
  const published = block('undecided')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^ANL-/.test(l))
    .map((l) => l.replace(/\s+/g, '  '))
  assert.deepEqual(
    published.sort(),
    undecided(),
    `${DOC} and ${LEDGER} disagree about which ANL requirements are undecided. Closing one means ` +
      `publishing that it closed: an unclaimed capability that stays on this list reads as a ` +
      `limitation the platform no longer has.`,
  )
})

test('the document says which command re-checks it', () => {
  // A publication a reader cannot re-run is a claim. Both guards are named.
  assert.ok(doc.includes('anl-limitations-are-published.test.mjs'), `${DOC} must name this guard.`)
  assert.ok(doc.includes('cvd.test.ts'), `${DOC} must name the guard that holds its colour-vision half.`)
})
