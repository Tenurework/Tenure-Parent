/**
 * The Simon convergence inventory is checkable, and one of its checks is a
 * privacy control rather than a correctness one.
 *
 * SIMON-000-004 to -007 are analyses of two real trees, and three things can go
 * wrong with an analysis nobody can re-run:
 *
 *   1. It can describe files that do not exist. Every path any row cites is
 *      checked against the BASELINE inventory's own file list — a different
 *      artifact, produced by a different generator — and every target path is
 *      opened on disk. Neither check can be satisfied by the analysis agreeing
 *      with itself.
 *   2. It can doctor its own summary. Every roll-up — per assumption, per hiding
 *      place, per file — is recomputed here from the raw findings with code
 *      written independently of the generator's, and the disposition of every
 *      capability is re-derived from the baseline file lists by rebuilding the
 *      probe pattern out of the row and counting again. A generator bug that
 *      changed a verdict would have to change this file's arithmetic too.
 *   3. It can leak. The absorption ledger's rule 8 forbids Simon student, staff
 *      or applicant data appearing in any record, and this repository is public.
 *      Every probe declares how much of its match it may print, and the test
 *      below asserts that every finding from a `mask` probe carries nothing but
 *      `#`. That check exists to fail: it is the one thing here whose absence
 *      would not show up as a wrong number.
 *
 * WHY THE STRONG DISPOSITION CHECK RE-IMPLEMENTS THE RULE INSTEAD OF CALLING IT
 *
 * Calling `disposeCapability` and comparing would pass against a broken
 * `disposeCapability` — the mutation would move both sides at once, which is
 * exactly how two mutations mask each other. So the rule is written out again
 * here, from the counts each row carries, and the counts themselves are
 * re-derived from the baseline file lists.
 *
 * Runner: `npm run test:platform` (bare `node --test`, no jest globals).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { byCodepoint } from '../tools/simon-absorption-inventory.mjs'
import {
  BASELINE_SNAPSHOT,
  DISPOSITIONS,
  DOC_ASSUMPTIONS,
  DOC_CONCEPTS,
  DOC_DISPOSITION,
  DOC_IMPORT_RISK,
  FRAMEWORK_CONTRACT_EXPORTS,
  PLACES,
  ROOT,
  SECRET_INDICATOR_PATTERNS,
  SNAPSHOT,
  exportsOf,
  placeOf,
  renderAll,
} from '../tools/simon-convergence-inventory.mjs'

const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n')

const snapshot = JSON.parse(readText(SNAPSHOT))
const baseline = JSON.parse(readText(BASELINE_SNAPSHOT))

/** `/body/flags` back into a RegExp, so the test can recount with the row's own pattern. */
function reFromString(s) {
  const m = String(s).match(/^\/(.*)\/([a-z]*)$/s)
  assert.ok(m, `not a rendered RegExp: ${s}`)
  return new RegExp(m[1], m[2])
}

test('the four documents are exactly what the snapshot renders', () => {
  for (const [file, expected] of Object.entries(renderAll(snapshot))) {
    assert.equal(
      readText(file),
      expected,
      `${file} is not what tools/simon-convergence-inventory.mjs renders from ${SNAPSHOT}. ` +
        `Regenerate it: node tools/simon-convergence-inventory.mjs`,
    )
  }
})

test('the snapshot covers the four requirements it claims and is pinned to the baseline', () => {
  assert.deepEqual(snapshot.closes, ['SIMON-000-004', 'SIMON-000-005', 'SIMON-000-006', 'SIMON-000-007'])
  for (const doc of [DOC_ASSUMPTIONS, DOC_CONCEPTS, DOC_DISPOSITION, DOC_IMPORT_RISK]) {
    assert.ok(fs.existsSync(path.join(ROOT, doc)), `${doc} is missing`)
  }
  // The whole point of reading the commits out of the baseline artifact: the two
  // documents describe the same two trees, or this reds.
  assert.equal(snapshot.baseline.snapshot, BASELINE_SNAPSHOT)
  assert.equal(snapshot.baseline.source_commit, baseline.source.pinned_commit)
  assert.equal(snapshot.baseline.target_commit, baseline.target.head_commit)
  assert.equal(snapshot.baseline.source_files, baseline.source.files.length)
  assert.equal(snapshot.baseline.target_files, baseline.target.files.length)
  assert.match(snapshot.baseline.source_commit, /^[0-9a-f]{40}$/)
  assert.match(snapshot.baseline.target_commit, /^[0-9a-f]{40}$/)
})

test('a masked probe leaks nothing — every token it produced is only “#”', () => {
  // The privacy control. `aws-account-id` and `resource-identifier` have open
  // captures, so their matches could be anything at all; they are declared
  // `reveal: 'mask'` and this asserts the declaration was honoured on every
  // single finding, on both sides, rather than on the ones somebody looked at.
  const masked = new Set(snapshot.assumptions.probes.filter((p) => p.reveal === 'mask').map((p) => p.id))
  assert.ok(masked.size > 0, 'no probe is declared as masking — the reveal discipline has been removed')
  const leaks = []
  for (const which of ['source', 'target']) {
    for (const g of snapshot.assumptions[which].groups) {
      if (!masked.has(g.probe)) continue
      for (const token of g.tokens) {
        if (!/^#+$/.test(token)) leaks.push(`${which} ${g.file} ${g.probe} emitted ${JSON.stringify(token)}`)
      }
    }
  }
  assert.deepEqual(leaks, [], `a masking probe printed its match:\n  ${leaks.join('\n  ')}`)
})

test('every probe declares one of the two reveal modes, and nothing else', () => {
  const bad = snapshot.assumptions.probes.filter((p) => p.reveal !== 'literal' && p.reveal !== 'mask')
  assert.deepEqual(bad, [], 'a probe declares a reveal mode this file has never audited')
})

test('every path a finding cites is in that side’s baseline file list', () => {
  for (const which of ['source', 'target']) {
    const known = new Set(which === 'source' ? baseline.source.files : baseline.target.files)
    const missing = [...new Set(snapshot.assumptions[which].groups.map((g) => g.file))]
      .filter((f) => !known.has(f))
      .sort(byCodepoint)
    assert.deepEqual(missing, [], `${which} findings cite paths the baseline inventory does not list: ${missing.join(', ')}`)
  }
})

test('every target path this analysis cites exists on disk', () => {
  const cited = new Set(snapshot.assumptions.target.groups.map((g) => g.file))
  for (const row of snapshot.disposition.capabilities) for (const p of row.source_only_paths) cited.add(p)
  const missing = [...cited].filter((p) => !fs.existsSync(path.join(ROOT, p))).sort(byCodepoint)
  // `source_only_paths` are by definition NOT in the target tree, so they are
  // excluded from the disk check rather than asserted to be there.
  const sourceOnly = new Set(snapshot.disposition.capabilities.flatMap((r) => r.source_only_paths))
  const real = missing.filter((p) => !sourceOnly.has(p))
  assert.deepEqual(real, [], `the analysis cites target paths that do not exist: ${real.join(', ')}`)
})

test('every roll-up re-adds from the raw findings', () => {
  for (const which of ['source', 'target']) {
    const side = snapshot.assumptions[which]
    const sum = (rows) => rows.reduce((n, r) => n + r.hits, 0)
    const total = sum(side.groups)
    assert.equal(side.total_hits, total, `${which}.total_hits disagrees with its own findings`)
    assert.equal(sum(side.by_kind), total, `${which}.by_kind does not add up to ${total}`)
    assert.equal(sum(side.by_place), total, `${which}.by_place does not add up to ${total}`)
    assert.equal(sum(side.by_file), total, `${which}.by_file does not add up to ${total}`)

    // Per row, not just in total: a summary can add up and still be wrong.
    for (const row of side.by_kind) {
      const mine = side.groups.filter((g) => g.kind === row.kind)
      assert.equal(row.hits, sum(mine), `${which} by_kind row ${row.kind} miscounts`)
      assert.equal(row.files, new Set(mine.map((g) => g.file)).size, `${which} by_kind row ${row.kind} miscounts files`)
    }
    for (const row of side.by_place) {
      const mine = side.groups.filter((g) => g.place === row.place)
      assert.equal(row.hits, sum(mine), `${which} by_place row ${row.place} miscounts`)
      assert.equal(row.files, new Set(mine.map((g) => g.file)).size, `${which} by_place row ${row.place} miscounts files`)
    }
  }
})

test('every finding’s place is the place its own path resolves to', () => {
  // The partition claim the document makes. `placeOf` is the generator's, but
  // the input is the path in the row — so a doctored `place` field reds, which
  // is the failure this catches. The ORDER of PLACES is asserted separately
  // below, because that is the part a refactor silently changes.
  for (const which of ['source', 'target']) {
    const wrong = snapshot.assumptions[which].groups
      .filter((g) => g.place !== placeOf(g.file))
      .map((g) => `${which} ${g.file} says ${g.place}, resolves to ${placeOf(g.file)}`)
    assert.deepEqual(wrong, [], wrong.slice(0, 10).join('; '))
  }
})

test('the hiding places stay specific-before-generic, and every one the requirement names has a row', () => {
  // `route names` matches every file under `src/app/`, which includes the report
  // pages and the permission-checking server actions. If it moves back above
  // them, both of those rows empty out and the document claims two of the
  // requirement's own hiding places are clean.
  const order = PLACES.map((p) => p.place)
  assert.deepEqual(order, ['fixtures', 'CSS', 'reports', 'permission checks', 'deployment scripts', 'route names', 'elsewhere'])
  for (const which of ['source', 'target']) {
    assert.deepEqual(
      snapshot.assumptions[which].by_place.map((p) => p.place),
      order,
      `${which}.by_place is not the declared partition`,
    )
  }
  // Each of the four the requirement names that this repository actually has
  // content for must be non-empty on the target side, or the scan has stopped
  // reaching them.
  for (const place of ['fixtures', 'CSS', 'reports', 'permission checks', 'deployment scripts', 'route names']) {
    const row = snapshot.assumptions.target.by_place.find((p) => p.place === place)
    assert.ok(row.hits > 0, `no assumption found in ${place} — the scan has stopped opening those files`)
  }
})

test('every disposition is a label the bible enumerates, and never one a file list cannot decide', () => {
  const known = new Set(DISPOSITIONS.map((d) => d.label))
  const forbidden = new Set(DISPOSITIONS.filter((d) => !d.assignable).map((d) => d.label))
  assert.ok(forbidden.size === 4, 'the four judgement labels are no longer marked unassignable')
  const bad = []
  for (const [kindName, rows] of [
    ['capability', snapshot.disposition.capabilities],
    ['package', snapshot.disposition.packages],
  ]) {
    for (const r of rows) {
      const subject = r.capability ?? r.package
      if (!known.has(r.disposition)) bad.push(`${kindName} ${subject} carries ${r.disposition}, not a bible label`)
      if (forbidden.has(r.disposition)) bad.push(`${kindName} ${subject} was auto-assigned the judgement label ${r.disposition}`)
      assert.ok(typeof r.why === 'string' && r.why.length > 0, `${kindName} ${subject} has no reason`)
    }
  }
  assert.deepEqual(bad, [], bad.join('; '))
})

test('every capability disposition re-derives from the baseline file lists', () => {
  // Independently: the counts are recounted from the pattern the row carries,
  // and the label is re-decided by a rule written out here rather than by
  // calling the generator's.
  const problems = []
  for (const row of snapshot.disposition.capabilities) {
    const re = reFromString(row.pattern)
    const ex = row.exclude ? reFromString(row.exclude) : null
    const hit = (files) => files.filter((f) => re.test(f) && !(ex && ex.test(f)))
    const s = hit(baseline.source.files)
    const t = new Set(hit(baseline.target.files))
    const sourceOnly = s.filter((f) => !t.has(f))

    if (s.length !== row.source_matches) problems.push(`${row.capability}: source ${row.source_matches} recounts as ${s.length}`)
    if (t.size !== row.target_matches) problems.push(`${row.capability}: target ${row.target_matches} recounts as ${t.size}`)
    if (sourceOnly.length !== row.source_only) problems.push(`${row.capability}: source_only ${row.source_only} recounts as ${sourceOnly.length}`)

    let expected
    if (s.length === 0 && t.size === 0) expected = 'UNKNOWN'
    else if (s.length > 0 && t.size === 0) expected = 'REIMPLEMENT_REQUIRED'
    else if (s.length === 0) expected = 'PARENT_CANONICAL'
    else if (sourceOnly.length === 0) expected = 'PARENT_CANONICAL'
    else expected = 'MERGE_REQUIRED'
    if (expected !== row.disposition) problems.push(`${row.capability}: says ${row.disposition}, the rule gives ${expected}`)

    const cited = new Set(row.source_only_paths)
    for (const p of cited) {
      if (!sourceOnly.includes(p)) problems.push(`${row.capability}: cites source-only path ${p} that is not source-only`)
    }
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join('\n  '))
})

test('every package disposition re-derives from the baseline workspace manifests', () => {
  const src = new Map(baseline.source.workspaces.map((w) => [w.name, w]))
  const tgt = new Map(baseline.target.workspaces.map((w) => [w.name, w]))
  const problems = []
  const names = new Set([...src.keys(), ...tgt.keys()])
  assert.equal(snapshot.disposition.packages.length, names.size, 'the package table does not cover every workspace on either side')
  for (const row of snapshot.disposition.packages) {
    const s = src.get(row.package)
    const t = tgt.get(row.package)
    let expected
    if (s && !t) expected = 'REIMPLEMENT_REQUIRED'
    else if (!s && t) expected = 'PARENT_CANONICAL'
    else {
      const missing =
        s.scripts.filter((x) => !t.scripts.includes(x)).length + s.declared_dependencies.filter((x) => !t.declared_dependencies.includes(x)).length
      expected = missing === 0 ? 'PARENT_CANONICAL' : 'MERGE_REQUIRED'
    }
    if (expected !== row.disposition) problems.push(`${row.package}: says ${row.disposition}, the rule gives ${expected}`)
    if ((s?.manifest ?? null) !== row.source_manifest) problems.push(`${row.package}: source manifest disagrees with the baseline`)
    if ((t?.manifest ?? null) !== row.target_manifest) problems.push(`${row.package}: target manifest disagrees with the baseline`)
    for (const dep of row.missing_dependencies ?? []) {
      if (t?.declared_dependencies.includes(dep)) problems.push(`${row.package}: ${dep} is called missing but the target declares it`)
      if (!s?.declared_dependencies.includes(dep)) problems.push(`${row.package}: ${dep} is called missing but the source does not declare it`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n  '))
})

test('a decided concept collision really is a difference, and a candidate really is above the threshold', () => {
  const c = snapshot.concepts
  const problems = []
  for (const row of c.same_name_different_shape) {
    if (row.only_in_source.length === 0 && row.only_in_target.length === 0) {
      problems.push(`${row.basename}: reported as a difference with nothing on either side`)
    }
    if (path.posix.basename(row.source_path) !== row.basename) problems.push(`${row.basename}: source path does not carry that name`)
    if (path.posix.basename(row.target_path) !== row.basename) problems.push(`${row.basename}: target path does not carry that name`)
    if (!row.verdict.startsWith('DECIDED')) problems.push(`${row.basename}: a decided row is not labelled DECIDED`)
  }
  for (const row of c.same_symbol_different_kind) {
    if (row.source_kind === row.target_kind) problems.push(`${row.symbol}: reported as a kind collision with the same kind`)
  }
  for (const row of c.candidate_synonyms) {
    if (row.jaccard < c.threshold) problems.push(`${row.source_path} -> ${row.target_path}: ${row.jaccard} is below ${c.threshold}`)
    if (path.posix.basename(row.source_path) === path.posix.basename(row.target_path)) {
      problems.push(`${row.source_path}: a "different names" row whose names are the same`)
    }
    if (!row.verdict.startsWith('CANDIDATE')) problems.push(`${row.source_path}: an undecided row is not labelled CANDIDATE`)
    for (const name of row.shared) {
      if (FRAMEWORK_CONTRACT_EXPORTS.has(name)) {
        problems.push(`${row.source_path}: scored on the framework-dictated name ${name}`)
      }
    }
  }
  assert.ok(c.candidate_synonyms.length <= c.candidate_synonyms_total, 'more candidates shown than counted')
  assert.deepEqual(problems, [], problems.join('\n  '))
})

test('the export scanner reads declarations rather than any word after “export”', () => {
  // A unit check, because every concept finding above is downstream of it and an
  // over-broad pattern here would invent collisions nobody can reproduce.
  const got = exportsOf(
    [
      'export function alpha() {}',
      'export async function beta() {}',
      'export const gamma = 1',
      'export class Delta {}',
      'export type Epsilon = string',
      'export interface Zeta { a: 1 }',
      'export enum Eta { A }',
      'export default function () {}',
      'export { theta, iota as kappa }',
      '// export function commentedOut() {}',
      'const notExported = 2',
      'exporting.lambda = 3',
    ].join('\n'),
  )
  assert.equal(got.get('alpha'), 'function')
  assert.equal(got.get('beta'), 'function')
  assert.equal(got.get('gamma'), 'value')
  assert.equal(got.get('Delta'), 'class')
  assert.equal(got.get('Epsilon'), 'type')
  assert.equal(got.get('Zeta'), 'interface')
  assert.equal(got.get('Eta'), 'enum')
  assert.equal(got.get('default'), 'default')
  assert.equal(got.get('theta'), 're-export')
  assert.equal(got.get('kappa'), 're-export')
  assert.equal(got.has('commentedOut'), false, 'a commented-out export was counted')
  assert.equal(got.has('notExported'), false)
  assert.equal(got.has('lambda'), false, '“exporting.lambda” was read as an export')
})

test('every import-risk path is in the source tree, or says why it is not', () => {
  const k = snapshot.import_risk
  const known = new Set(baseline.source.files)
  const problems = []
  const inTree = (paths, label) => {
    for (const p of paths) if (!known.has(p)) problems.push(`${label} cites ${p}, absent from the baseline source file list`)
  }
  inTree(k.licenses.license_files, 'licenses')
  inTree(
    k.licenses.manifests.map((m) => m.manifest),
    'license manifests',
  )
  inTree(
    k.generated_artifacts.map((x) => x.path),
    'generated artifacts',
  )
  inTree(
    k.vendored_code.map((x) => x.path),
    'vendored code',
  )
  inTree(
    k.binaries.files.map((x) => x.path),
    'binaries',
  )
  if (Array.isArray(k.large_files.files)) inTree(k.large_files.files.map((x) => x.path), 'large files')
  inTree(
    k.secret_history_indicators.at_pinned_commit.map((x) => x.path),
    'secret indicators at the pinned commit',
  )

  // The history list is the one that MAY name a path no longer in the tree —
  // that is its whole purpose — so it is checked the other way: the flag has to
  // agree with the file list.
  if (Array.isArray(k.secret_history_indicators.ever_added)) {
    for (const x of k.secret_history_indicators.ever_added) {
      if (x.present_at_pinned_commit !== known.has(x.path)) {
        problems.push(`${x.path}: present_at_pinned_commit=${x.present_at_pinned_commit} disagrees with the file list`)
      }
      if (!SECRET_INDICATOR_PATTERNS.some((s) => s.pattern.test(x.path))) {
        problems.push(`${x.path}: listed as a secret indicator but matches no declared indicator pattern`)
      }
      assert.match(x.first_added_commit, /^[0-9a-f]{40}$/)
    }
  }
  for (const x of k.secret_history_indicators.at_pinned_commit) {
    if (!SECRET_INDICATOR_PATTERNS.some((s) => s.pattern.test(x.path))) {
      problems.push(`${x.path}: listed as a secret indicator but matches no declared indicator pattern`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n  '))
})

test('the audit result is either a read with counts that add up, or UNKNOWN with its command', () => {
  const v = snapshot.import_risk.vulnerable_dependencies
  if (v.ok === true) {
    const c = v.counts
    assert.equal(
      c.critical + c.high + c.moderate + c.low + c.info,
      c.total,
      'the advisory severities do not add up to the total npm reported',
    )
    assert.equal(v.packages.length > 0, c.total > 0, 'the package list and the total disagree about whether anything was found')
    for (const p of v.packages) {
      assert.ok(['critical', 'high', 'moderate', 'low', 'info'].includes(p.severity), `${p.package} has severity ${p.severity}`)
    }
  } else {
    assert.equal(v.ok, false)
    assert.ok(typeof v.command === 'string' && v.command.length > 0, 'an UNKNOWN audit does not name the command that would answer it')
    assert.ok(typeof v.unknown_because === 'string' && v.unknown_because.length > 0)
  }
})

test('every UNKNOWN in the snapshot carries the command that would answer it', () => {
  // The codebase's central rule, asserted structurally: "we could not look" has
  // to be distinguishable from "we looked and found nothing", and the way this
  // programme distinguishes them is that the first one names its command.
  const bad = []
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${at}[${i}]`))
    if (!node || typeof node !== 'object') return
    if (node.ok === false) {
      if (!node.command) bad.push(`${at} is UNKNOWN with no command`)
      if (!node.unknown_because) bad.push(`${at} is UNKNOWN with no reason`)
      if (!node.of) bad.push(`${at} is UNKNOWN without saying what of`)
      return
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`)
  }
  walk(snapshot, 'snapshot')
  assert.deepEqual(bad, [], bad.join('; '))
})

test('the runtime table flags an end-of-life Node against a stated external source', () => {
  const rt = snapshot.import_risk.runtimes
  assert.match(rt.reference_table.as_of, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(rt.reference_table.source.startsWith('https://'), 'the end-of-life dates cite no source')
  const problems = []
  for (const which of ['source', 'target']) {
    assert.ok(rt[which].length > 0, `no declared runtime found for ${which} — the probes have stopped matching`)
    for (const row of rt[which]) {
      const eol = row.node_major === null ? null : rt.reference_table.end_of_life[String(row.node_major)] ?? null
      if (row.end_of_life !== eol) problems.push(`${which} ${row.file}: end_of_life ${row.end_of_life} is not the table's ${eol}`)
      const expected = eol !== null ? eol < rt.reference_table.as_of : false
      if (row.unsupported !== expected) problems.push(`${which} ${row.file}: unsupported=${row.unsupported}, the table gives ${expected}`)
      assert.ok(row.declarations >= 1, `${which} ${row.file} declares a runtime zero times`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n  '))
})
