/**
 * The Simon absorption baseline inventory is checkable, not prose.
 *
 * SIMON-000-001, -002 and -003 are inventories, and an inventory is a claim
 * about the repository. This programme's measured history is roughly forty-five
 * claims against eleven confirmations, and the cheapest way to add a false one
 * is to write a plausible document describing code nobody has. So every row of
 * `docs/architecture/simon-*.md` has to be attached to something that reds.
 *
 * WHAT EACH CHECK CATCHES
 *
 *   1. The three documents are re-rendered from the snapshot and compared byte
 *      for byte. Corrupt a row in a document and this reds; corrupt a row in the
 *      snapshot and this reds too, because the document stops matching.
 *   2. Every path either side cites — workflow, manifest, capability evidence —
 *      must appear in that side's own file list, which was read out of a real
 *      tree. Invent a path and it is not in the list.
 *   3. Every TARGET path cited is opened on disk. The non-circular one: it
 *      compares the inventory against the filesystem rather than against itself.
 *   4. The target's workflow set and workspace set are re-derived from the tree
 *      and compared as SETS, so the repository GAINING one the inventory does
 *      not mention reds too. That is the difference between a mapping and a
 *      paragraph.
 *   5. Where the pinned commits are present, both file lists are re-derived from
 *      `git ls-tree -r` and compared exactly.
 *
 * WHY CHECK 5 IS CONDITIONAL, STATED PLAINLY RATHER THAN HIDDEN
 *
 * `.github/workflows/ci.yml` checks out with `actions/checkout@v4` and no
 * `fetch-depth`, which is a depth-1 clone: no `live` remote, and no commit
 * object older than the tip. Neither pinned commit is reachable there. Making
 * check 5 mandatory would therefore red every CI run for a reason that has
 * nothing to do with the inventory, and making the whole suite depend on it
 * would be the "current here, stale in CI" failure this repository has shipped
 * before. So it is the STRONGER form of a check that already exists
 * unconditionally: checks 1-4 red on any single-entry corruption without git,
 * which mutations A-E demonstrate. Check 5 is not load-bearing on its own and
 * this comment exists so nobody mistakes it for a guard that cannot fail.
 *
 * WHY THE FILE LISTS ARE A PINNED BASELINE AND NOT A LIVE `git ls-files`
 *
 * The bible calls §4.1-§4.3 a baseline artifact, taken before any import
 * begins, and this repository is worked by many agents at once — an inventory
 * asserting equality with the live index would red on somebody else's unrelated
 * commit. Both sides are pinned to a commit the snapshot records. The sets that
 * MUST stay live — workflows and workspaces — are the ones check 4 re-derives,
 * and both live in files the collision rules keep stable.
 *
 * Runner: `npm run test:platform` (bare `node --test`, no jest globals).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  DOC_MAPS,
  DOC_REPOSITORIES,
  DOC_STACK,
  ROOT,
  SNAPSHOT,
  SOURCE_REF,
  byCodepoint,
  declaredWorkspaceManifests,
  moduleAreaOf,
  posix,
  renderAll,
} from '../tools/simon-absorption-inventory.mjs'

const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n')

const snapshot = JSON.parse(readText(SNAPSHOT))

/** Every path any row of one side cites, deduplicated. */
function citedPaths(side) {
  const out = new Set()
  for (const row of side.stack) for (const e of row.evidence) out.add(e)
  for (const w of side.workflows) out.add(w.file)
  for (const w of side.workspaces) out.add(w.manifest)
  return [...out].sort(byCodepoint)
}

/** `git ls-tree -r --name-only <sha>`, or null when the object is not here. */
function treeAt(sha) {
  try {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', sha], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\r\n')
      .join('\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(posix)
      .sort(byCodepoint)
  } catch {
    return null
  }
}

test('the three documents are exactly what the snapshot renders', () => {
  for (const [file, expected] of Object.entries(renderAll(snapshot))) {
    assert.equal(
      readText(file),
      expected,
      `${file} is not what tools/simon-absorption-inventory.mjs renders from ${SNAPSHOT}. ` +
        `Regenerate it: node tools/simon-absorption-inventory.mjs`,
    )
  }
})

test('the snapshot covers all three requirements it claims to', () => {
  assert.deepEqual(snapshot.closes, ['SIMON-000-001', 'SIMON-000-002', 'SIMON-000-003'])
  for (const doc of [DOC_REPOSITORIES, DOC_MAPS, DOC_STACK]) {
    assert.ok(fs.existsSync(path.join(ROOT, doc)), `${doc} is missing`)
  }
  assert.match(snapshot.source.pinned_commit, /^[0-9a-f]{40}$/)
  assert.match(snapshot.target.head_commit, /^[0-9a-f]{40}$/)
})

test('every path either side cites is in that side’s own file list', () => {
  for (const which of ['source', 'target']) {
    const side = snapshot[which]
    const known = new Set(side.files)
    const missing = citedPaths(side).filter((p) => !known.has(p))
    assert.deepEqual(missing, [], `${which} cites paths absent from ${which}.files: ${missing.join(', ')}`)
  }
})

test('each file list is well formed and its area map accounts for every file', () => {
  for (const which of ['source', 'target']) {
    const side = snapshot[which]
    const sorted = [...side.files].sort(byCodepoint)
    assert.deepEqual(side.files, sorted, `${which}.files is not in codepoint order`)
    assert.equal(new Set(side.files).size, side.files.length, `${which}.files has duplicates`)
    assert.equal(
      side.files.filter((f) => f.includes('\\')).length,
      0,
      `${which}.files contains a native-separator path, which would sort differently on Linux`,
    )
    assert.equal(side.tracked_files, side.files.length, `${which}.tracked_files disagrees with ${which}.files`)
    const rolled = side.areas.reduce((n, a) => n + a.files, 0)
    assert.equal(rolled, side.files.length, `the ${which} area map does not add up to the ${which} file list`)
  }
})

test('every target path the inventory cites exists on disk', () => {
  const missing = citedPaths(snapshot.target).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(missing, [], `the inventory cites target paths that do not exist: ${missing.join(', ')}`)
})

test('the target workflow and workspace sets are exactly what the tree holds', () => {
  const onDisk = fs
    .readdirSync(path.join(ROOT, '.github/workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `.github/workflows/${f}`)
    .sort(byCodepoint)
  assert.deepEqual(
    snapshot.target.workflows.map((w) => w.file).sort(byCodepoint),
    onDisk,
    'the workflow inventory and .github/workflows disagree',
  )

  assert.deepEqual(
    snapshot.target.workspaces.map((w) => w.manifest).sort(byCodepoint),
    declaredWorkspaceManifests(),
    'the workspace inventory and the workspaces the root package.json declares disagree',
  )
})

test('both file lists re-derive from their pinned commits where the objects are present', (t) => {
  let checked = 0
  for (const [which, sha] of [
    ['source', snapshot.source.pinned_commit],
    ['target', snapshot.target.head_commit],
  ]) {
    const files = treeAt(sha)
    if (files === null) {
      t.diagnostic(
        `${which}: ${sha} is not in this clone (CI checks out at depth 1, and ${SOURCE_REF} ` +
          `is only present where \`git fetch live\` has run). Re-derivation skipped here; the ` +
          `unconditional checks above still red on a corrupted row.`,
      )
      continue
    }
    assert.deepEqual(snapshot[which].files, files, `${which}.files does not match ${sha}`)
    checked += 1
  }
  t.diagnostic(`${checked} of 2 file lists re-derived from git in this environment`)
})

test('every node of both import graphs is an area that really contains files', () => {
  for (const which of ['source', 'target']) {
    const side = snapshot[which]
    const areas = new Set(side.files.map(moduleAreaOf))
    const bad = []
    for (const e of side.import_graph.internal_edges) {
      if (!areas.has(e.from)) bad.push(`${which} edge from unknown area ${e.from}`)
      if (!areas.has(e.to)) bad.push(`${which} edge to unknown area ${e.to}`)
      if (e.from === e.to) bad.push(`${which} self-edge on ${e.from}`)
      if (!(e.imports > 0)) bad.push(`${which} edge ${e.from}->${e.to} counts ${e.imports}`)
    }
    for (const e of side.import_graph.external_edges) {
      if (!areas.has(e.from)) bad.push(`${which} external edge from unknown area ${e.from}`)
    }
    assert.deepEqual(bad, [], bad.join('; '))
  }
})

test('the declared/undeclared verdict on every external import is recomputable', () => {
  // The point of the flag is that it names a defect — an import resolving only
  // through npm's flat node_modules. A flag the generator asserts and nobody can
  // recheck is exactly the kind of claim this ledger exists to stop, so it is
  // recomputed here from the manifests' own declared dependency lists.
  for (const which of ['source', 'target']) {
    const side = snapshot[which]
    const byDir = new Map(side.workspaces.map((w) => [w.directory === '.' ? '' : w.directory, new Set(w.declared_dependencies)]))
    const declaredFor = (area) => {
      const parts = area.split('/')
      for (let i = parts.length; i > 0; i -= 1) {
        const dir = parts.slice(0, i).join('/')
        if (byDir.has(dir)) return byDir.get(dir)
      }
      return byDir.get('') ?? new Set()
    }
    const wrong = side.import_graph.external_edges
      .filter((e) => e.declared !== declaredFor(e.from).has(e.package))
      .map((e) => `${which} ${e.from} -> ${e.package} says declared=${e.declared}`)
    assert.deepEqual(wrong, [], wrong.join('; '))
  }
})

test('the inventory records the production-guard state of every deployment workflow', () => {
  // The reason this column exists at all. Every AWS-touching job in THIS
  // repository carries `if: github.repository == '...'`, and the pilot's carry
  // none — which is exactly why importing a workflow from the pilot is not a
  // copy. If the inventory stopped recording the guard, the absorption plan
  // would lose the one fact that makes it safe to do at all.
  for (const w of [...snapshot.source.workflows, ...snapshot.target.workflows]) {
    assert.ok(Array.isArray(w.repository_guards), `${w.file} has no repository_guards field`)
    assert.equal(typeof w.is_deployment, 'boolean', `${w.file} has no is_deployment verdict`)
    assert.equal(typeof w.reaches_aws, 'boolean', `${w.file} has no reaches_aws verdict`)
  }
  assert.ok(
    snapshot.target.workflows.some((w) => w.repository_guards.length > 0),
    'no target workflow carries a repository guard — the inventory has stopped reading them',
  )
})
