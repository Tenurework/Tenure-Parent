/**
 * GE-020-001. Module ownership, enforced rather than described.
 *
 * The execution prompt asks that ownership across fourteen platform domains be
 * *defined and enforced*. A table in a document is the definition; this is the
 * enforcement, and without it the table is a snapshot of the day someone wrote
 * it.
 *
 * The property is deliberately absolute: every source file belongs to exactly
 * one domain. Not "most files" and not "files we remembered" — an orphan means
 * code was added that nobody decided the ownership of, which is how a codebase
 * stops having boundaries. One unclaimed file at a time, each individually
 * defensible.
 *
 * ── The half that was missing ───────────────────────────────────────────────
 *
 * "Every source file" was only ever true of the files the map looked at, and
 * the map looked at three hard-coded paths. `blueprints/` and `modules/` are
 * declared npm workspaces holding seven tracked TypeScript files — including
 * the module catalog that decides what a tenant may switch on — and they were
 * in none of the three. No domain owned them, and `docs/architecture/ownership.md`
 * reported zero unclaimed files, because a guard that enumerates where it looks
 * is clean about everywhere it forgot.
 *
 * The universe is therefore built HERE, from the workspaces `package.json`
 * declares, and every file in it must be either governed by the map or excused
 * by a named rule. That is the check the enumerated version could not perform:
 * the map no longer gets to choose the question it is asked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  DOMAINS,
  NON_SOURCE,
  SHARED,
  SHARED_PREFIXES,
  classify,
  nonSourceFiles,
} from '../../tools/ownership-map.mjs'

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..',
)

/**
 * The workspaces `package.json` declares, resolved HERE rather than imported
 * from the map.
 *
 * The map resolves the same list to decide where to look, and asking it which
 * workspaces exist and then checking that it covered those is a question that
 * cannot come back "no". The whole defect this guards is a tree the map never
 * looked at, so the list of trees has to come from somewhere the map does not
 * choose. `tests/architecture/lockfile-knows-every-workspace.test.mjs` resolves
 * it the same way against the lock file, for the same reason.
 */
function declaredWorkspaces() {
  const { workspaces = [] } = JSON.parse(
    fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'),
  )
  const dirs = []
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) {
      if (fs.existsSync(path.join(REPO, pattern, 'package.json'))) dirs.push(pattern)
      continue
    }
    const parent = pattern.slice(0, -2)
    if (!fs.existsSync(path.join(REPO, parent))) continue
    for (const entry of fs.readdirSync(path.join(REPO, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const rel = `${parent}/${entry.name}`
      if (fs.existsSync(path.join(REPO, rel, 'package.json'))) dirs.push(rel)
    }
  }
  return dirs.sort()
}

/**
 * Every file inside a declared workspace that could carry behaviour.
 *
 * Deliberately a WIDER extension set than the map's own. If the map narrows its
 * filter — which is the other way it can stop looking at something — the files
 * it dropped are still in this list and still have to be accounted for.
 */
function sourceShapedFilesInWorkspaces() {
  return declaredWorkspaces().flatMap((ws) =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', `${ws}/**`],
      { encoding: 'utf8', cwd: REPO },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|css|scss)$/.test(f))
      .map((file) => ({ file, workspace: ws })),
  )
}

test('every source file belongs to a domain', () => {
  const { orphans } = classify()

  assert.deepEqual(
    orphans,
    [],
    `these files belong to no domain. Add each to the domain that owns it in\n` +
      `tools/ownership-map.mjs, or to SHARED with a reason if it genuinely belongs to none:\n  ` +
      orphans.join('\n  '),
  )
})

test('no file is claimed by two domains', () => {
  const { ambiguous } = classify()

  // Two domains claiming one file is not a tie to be broken by iteration order.
  // It means the boundary between them is wrong, and quietly picking the first
  // match would hide that.
  assert.deepEqual(ambiguous, [], `ambiguous ownership:\n  ${ambiguous.join('\n  ')}`)
})

test('all fourteen domains the prompt names are declared', () => {
  // Ten with code and four without. The four are the point: a map showing ten
  // would read as a complete map of a ten-domain system.
  assert.equal(DOMAINS.length, 14, 'the domain list changed')

  const unbuilt = DOMAINS.filter((d) => d.unbuilt)
  assert.ok(unbuilt.length > 0, 'no domain is declared unbuilt — that would be a claim, not a map')

  for (const d of unbuilt) {
    assert.match(d.unbuilt, /^GE-/, `${d.key} is unbuilt with no item that builds it`)
    assert.ok(
      (d.note ?? '').length > 40,
      `${d.key} is declared unbuilt without saying what exists instead`,
    )
    assert.deepEqual(d.owns, [], `${d.key} is marked unbuilt but owns files`)
  }
})

test('every domain with code actually has some', () => {
  const { byDomain } = classify()

  const empty = DOMAINS.filter((d) => !d.unbuilt && byDomain.get(d.key).length === 0).map(
    (d) => d.key,
  )

  // A domain declared as built and owning nothing is either unbuilt and
  // mislabelled, or its prefixes are wrong. Both are worth failing on.
  assert.deepEqual(empty, [], `declared as built, owning no files: ${empty.join(', ')}`)
})

test('the shared list stays small', () => {
  // Every entry here is a file the map cannot describe, so the count is the
  // measure of how well the domains fit. Pinned at what is actually there
  // rather than at a round number, and it may only FALL: adding a file here is
  // the easy way out of classifying it, and this is what makes that a decision
  // rather than a reflex.
  //
  // The eighteen are the root document and its error boundaries, the load
  // balancer probe, the boot-time environment check, and the UI primitives
  // that live at the top of components/ rather than in components/ui/. None
  // belongs to a platform domain, and forcing them into one to make a number
  // smaller would be worse than the number.
  //
  // 16 -> 18, argued rather than adjusted, because this is the direction the
  // number is not supposed to move. Eleven previously-unclassified files were
  // classified in the same commit — payments into `billing-metering`,
  // connections and the relay projection policy into `integrations`, the
  // approval digest into `workflow`, the gallery into `files` — and these two
  // are what was left after that:
  //
  //   · `DensitySwitcher.tsx` sets how tightly every domain renders. It sits at
  //     the top of components/ beside `ThemeSwitcher.tsx`, which is already
  //     here for exactly this reason. Its only importer is the settings page,
  //     but being rendered from one place does not make a control that changes
  //     every surface the property of that place.
  //   · `design-contracts.test.ts` asserts design contracts ACROSS surfaces —
  //     it reads the shell, the settings page and the switchers in one test.
  //     Scoping it to a domain would mean the surfaces outside that domain
  //     stopped being checked, which is the opposite of what it is for.
  //
  // 18 -> 19, argued the same way, and for a reason the ratchet did not
  // anticipate: the classified UNIVERSE grew rather than a file being moved
  // into shelter. `listFiles` matched `.ts|.tsx|.mjs` only, so no stylesheet
  // had an owner — invisible until the console shell landed four of them in
  // `apps/system-studio/src/components/` and `the console components are owned,
  // not filed as shared` failed on files the map could not even see. Widening
  // it to `.css` classified 22 of the 23 stylesheets straight into
  // `control-plane`, which is a net gain of 22 owned files for one shared one.
  //
  //   · `apps/web/src/app/globals.css` is the twenty-third. It is the tenant
  //     application's entire stylesheet and every domain in that app renders
  //     through it, so handing it to one domain would make the others its
  //     tenants — the identical argument that already puts
  //     `apps/web/src/app/layout.tsx`, the root document, on this list.
  assert.equal(
    SHARED.size,
    19,
    `${SHARED.size} files are owned by no domain, expected 19. This may only fall — if a file ` +
      `was classified into a domain, lower this in the same commit.`,
  )
  assert.ok(SHARED_PREFIXES.length <= 5, 'too many shared directories')

  for (const [file, why] of SHARED) {
    assert.ok(fs.existsSync(file), `${file} is in SHARED but does not exist`)
    assert.ok(why.length > 10, `${file} is shared without a reason`)
  }
})

test('the committed map matches the code', () => {
  const result = execFileSync('node', ['tools/ownership-map.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(result, /up to date/)
})

test('the reader found the workspaces, so a clean result means something', () => {
  // Every assertion below is of the form "nothing escaped". An empty universe
  // satisfies all of them, and a map read from an empty glob reports perfect
  // ownership. This is what separates the two.
  const workspaces = declaredWorkspaces()
  assert.ok(
    workspaces.length >= 10,
    `resolved ${workspaces.length} workspaces from package.json, expected at least 10 — the ` +
      `globs stopped matching and "nothing escaped the map" would be vacuous`,
  )

  const universe = sourceShapedFilesInWorkspaces()
  assert.ok(
    universe.length > 1000,
    `found ${universe.length} source-shaped files across the workspaces, expected over 1000 — ` +
      `the reader is broken, and a broken reader reports every file as owned`,
  )

  const contributing = new Set(universe.map((u) => u.workspace))
  assert.ok(
    contributing.size >= 10,
    `only ${contributing.size} of ${workspaces.length} workspaces contain any source at all: ` +
      `${[...contributing].join(', ')}`,
  )

  const { files } = classify()
  assert.ok(files.length > 200, `only ${files.length} files scanned — a root stopped being read`)
})

test('no source inside a declared workspace escapes the map', () => {
  // THE property, and the one the old version of this test could not express.
  //
  // It used to assert that at least one file was scanned under each of
  // `apps/web/src/`, `apps/system-studio/src/` and `packages/` — the three
  // paths the map had hard-coded as its roots. That is a floor under the places
  // it already looked, and it says nothing about the places it did not: two
  // whole npm workspaces (`blueprints/`, `modules/` — seven tracked TypeScript
  // files, one of them the module catalog) sat outside all three, owned by
  // nobody, while the generated document reported zero unclaimed files.
  //
  // So the question is asked from the other end. The universe is every
  // source-shaped file in every declared workspace, read here; each one must be
  // either governed by the map (and therefore owned by exactly one domain or
  // explicitly shared, which the tests above enforce) or excused by a named
  // NON_SOURCE rule. A tree the map stops looking at does not go quiet — it
  // appears in this list, by name.
  const accounted = new Set([
    ...classify().files,
    ...nonSourceFiles().map((f) => f.file),
  ])

  const escaped = sourceShapedFilesInWorkspaces()
    .map((u) => u.file)
    .filter((f) => !accounted.has(f))

  assert.deepEqual(
    escaped,
    [],
    `${escaped.length} source file(s) live inside a declared npm workspace and the ownership map
` +
      `neither classifies nor excuses them. The map is not looking there, so it reports them as
` +
      `neither owned nor unclaimed — it reports nothing at all. Either widen ROOTS/SOURCE_EXTENSIONS
` +
      `in tools/ownership-map.mjs so a domain has to claim them, or add a NON_SOURCE rule saying
` +
      `why they ship nothing:\n  ` + escaped.join('\n  '),
  )
})

test('the map does not claim to govern anything outside a workspace', () => {
  // The other direction. A root pointing at a tree that is not a declared
  // workspace would inflate every count in the document and put files under a
  // domain's name that `npm ci` never installs.
  const inside = new Set(sourceShapedFilesInWorkspaces().map((u) => u.file))
  const outside = classify().files.filter((f) => !inside.has(f))

  assert.deepEqual(
    outside,
    [],
    `the map governs ${outside.length} file(s) that are in no declared workspace:\n  ` +
      outside.join('\n  '),
  )
})

test('every NON_SOURCE rule still excuses something, and says why', () => {
  // A rule matching nothing is either dead or has quietly stopped matching, and
  // the second is indistinguishable from the first until a subtree it used to
  // cover shows up unclaimed. Both are worth failing on while the list is three
  // entries long.
  const excused = nonSourceFiles()
  assert.ok(excused.length > 0, 'no file is excused as non-source at all — the rules match nothing')

  const dead = NON_SOURCE.filter((rule) => !excused.some((f) => rule.matches(f.rest))).map(
    (r) => r.key,
  )
  assert.deepEqual(dead, [], `these NON_SOURCE rules excuse no file: ${dead.join(', ')}`)

  for (const rule of NON_SOURCE) {
    assert.ok(
      rule.why.length > 40,
      `the ${rule.key} rule excuses files without saying why — a one-line reason is how this ` +
        `becomes the easy way out of classifying a directory`,
    )
  }

  // An excused file is excused BY a rule, never by falling through both lists.
  for (const f of excused) {
    assert.ok(
      NON_SOURCE.some((rule) => rule.matches(f.rest)),
      `${f.file} is reported as non-source and no rule matches it`,
    )
  }

  // And a rule may only reach OUTSIDE a workspace's shipped source. Broadening
  // one until it swallows `src/` is the one way an exclusion list can shrink
  // the map without any of the checks above noticing: "every source file is
  // owned" would go on being true, of fewer and fewer files.
  const swallowed = excused.filter((f) => f.rest.startsWith('src/')).map((f) => f.file)
  assert.deepEqual(
    swallowed,
    [],
    `a NON_SOURCE rule excuses ${swallowed.length} file(s) under a workspace's src/, which is ` +
      `shipped source and has to be owned:\n  ` + swallowed.join('\n  '),
  )
})
