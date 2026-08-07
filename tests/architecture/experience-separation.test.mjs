/**
 * TTES-000-001 — the tenant experience and the deployer experience are two
 * things, and the repository has to be able to say which is which.
 *
 * ## What existed, and why it was not this
 *
 * Three inventories, none of which answered the question.
 *
 *   * `docs/architecture/entry-points.md` counted routes and pages — of
 *     `apps/web` only. `tools/entry-point-inventory.mjs` hard-coded a single
 *     `APP_ROOT`, so the System Studio's eight pages, its NextAuth route and
 *     its three server-action modules appeared in no inventory anywhere. The
 *     headline read "22 API routes · 36 pages" and was counting half a platform
 *     — while `tests/security/entry-points.test.mjs` asserted, against that
 *     half, that nothing was unguarded.
 *   * `docs/architecture/ownership.md` classified by platform DOMAIN, which is
 *     a different axis. It filed `apps/system-studio/src/components/` under
 *     "the shell and the design system — what every domain renders through",
 *     which was simply not true of six files no other app can even import.
 *   * Nothing inventoried design tokens at all, and the two stylesheets had
 *     diverged in silence: `--accent` is `#26364a` in the product and `#7a6440`
 *     in the console, `--border` and `--border-strong` differ, `--space-6` is
 *     24px against 28px, and `--ease-entry` differs too. One token name, two
 *     colours, and no record saying whether that was a decision.
 *
 * ## What makes this a ratchet rather than a snapshot
 *
 * A generated document that nothing checks is a photograph of the day it was
 * generated. Four properties are asserted instead, each of which fails on the
 * commit that introduces the drift rather than at the next review:
 *
 *   1. every page and route file in the repository belongs to a declared
 *      experience — so a third app cannot be added without deciding who sees
 *      it, and the class of gap that hid the Studio for this long cannot recur;
 *   2. every source file belongs to a declared experience;
 *   3. a token name declared by both experiences with different values has an
 *      entry in `SHARED_TOKENS`, and an entry only exists while its token
 *      actually diverges;
 *   4. the number of divergences nobody has decided about may not grow.
 *
 * (3) is the pair that matters. Requiring an entry stops silent drift; refusing
 * a stale entry stops the table becoming a list of claims about a stylesheet it
 * no longer describes — which is the failure the inventory it documents was
 * built to remove, arriving through the documentation of the fix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

import {
  EXPERIENCES,
  SHARED_TOKENS,
  UNRECONCILED_TOKEN_BUDGET,
  collect,
  collectTokens,
} from '../../tools/entry-point-inventory.mjs'
import { EXPERIENCE_OF_SOURCE, classify, experienceOf } from '../../tools/ownership-map.mjs'

const DOC = 'docs/architecture/entry-points.md'

/**
 * Tracked AND untracked-but-not-ignored, repository-wide.
 *
 * Repository-wide is the point: asking the inventory which pages exist and then
 * checking that those pages are inventoried is a question that cannot come back
 * "no". The whole defect being fixed here is a page the inventory never looked
 * at, so the list has to come from somewhere the inventory does not choose.
 */
const gitFiles = (...pathspecs) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...pathspecs], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => fs.existsSync(f))

/** Next.js surface files anywhere in the repo, excluding build output. */
function surfaceFiles() {
  return gitFiles('*/page.tsx', '*/route.ts', 'page.tsx', 'route.ts').filter(
    (f) => !f.includes('/.next/') && !f.includes('/node_modules/'),
  )
}

test('the readers found something to check', () => {
  // Every assertion below is of the form "nothing is wrong". Each one passes
  // trivially against an empty list, so the lists are floored first — a broken
  // reader must fail here rather than report a clean bill of health.
  const surfaces = surfaceFiles()
  assert.ok(
    surfaces.length >= 50,
    `found ${surfaces.length} page/route files repository-wide; expected at least 50. The reader is ` +
      `broken, not the repository — and a broken reader reports every surface as classified.`,
  )
  assert.equal(EXPERIENCES.length, 2, 'the experience list changed')
  assert.ok(collectTokens().tokens.length >= 100, 'the stylesheet reader found almost no tokens')
})

test('every page and route in the repository belongs to a declared experience', () => {
  const roots = EXPERIENCES.map((e) => `${e.appRoot}/`)
  const homeless = surfaceFiles().filter((f) => !roots.some((r) => f.startsWith(r)))

  assert.deepEqual(
    homeless,
    [],
    'These files serve a page or an API route and belong to neither the tenant experience nor the\n' +
      'deployer one. A surface nobody has assigned an audience to is a surface nobody has assigned\n' +
      'a guard model to. Add its app to EXPERIENCES in tools/entry-point-inventory.mjs:\n  ' +
      homeless.join('\n  '),
  )
})

test('the inventory covers both experiences, and covers each app-root page', () => {
  const { apiRoutes, pages, actions } = collect()

  for (const e of EXPERIENCES) {
    assert.ok(
      pages.some((p) => p.experience === e.key),
      `no page was inventoried for the ${e.key} experience — a root stopped being walked`,
    )
  }

  // The Studio, by name and by count. `apps/system-studio` was invisible to
  // this tool entirely; asserting only "more than one experience appears" would
  // have passed the day before the fix if a single Studio file had leaked in.
  const deployerPages = pages.filter((p) => p.experience === 'deployer')
  assert.ok(
    deployerPages.length >= 8,
    `${deployerPages.length} deployer pages inventoried; the console serves at least 8`,
  )
  assert.ok(
    actions.some((a) => a.experience === 'deployer'),
    'the console publishes server actions that compose and advance tenants; none was inventoried',
  )

  // The bug inside the tool: git's `**/` pathspec matches nothing at depth
  // zero, so `<app>/src/app/page.tsx` was never listed. Each app's own front
  // door is the single most-requested route it has.
  for (const e of EXPERIENCES) {
    assert.ok(
      pages.some((p) => p.experience === e.key && p.route === '/'),
      `${e.app} serves ${e.appRoot}/page.tsx and the inventory does not list it`,
    )
  }

  // Every entry carries the experience, on every kind. A row with an undefined
  // Experience column would render as an empty cell rather than fail.
  for (const entry of [...apiRoutes, ...pages, ...actions]) {
    assert.ok(
      EXPERIENCES.some((e) => e.key === entry.experience),
      `${entry.file} was inventoried with experience ${JSON.stringify(entry.experience)}`,
    )
    assert.ok(entry.id.startsWith(`${entry.experience}:`), `${entry.file} has an unprefixed id`)
  }
})

test('an allowlist entry cannot cross from one experience to the other', () => {
  // Both apps serve `/signin` and both serve `/api/auth/[...nextauth]`. Before
  // ids were prefixed, allowlisting the tenant sign-in page as public would
  // have allowlisted the operator console's by the same string.
  const { pages, apiRoutes } = collect()
  const collisions = [...pages, ...apiRoutes]
    .map((e) => e.route)
    .filter((route, i, all) => all.indexOf(route) !== i)

  assert.ok(
    collisions.length > 0,
    'no route path is served by both apps any more. If that is genuinely true this test has ' +
      'nothing left to prove and should be deleted rather than left green over nothing.',
  )

  const ids = new Set([...pages, ...apiRoutes].map((e) => e.id))
  assert.equal(ids.size, pages.length + apiRoutes.length, 'two entry points share an id')
})

test('every source file belongs to a declared experience', () => {
  const { unplaced, files } = classify()

  assert.ok(files.length > 200, `only ${files.length} files scanned — a root stopped being read`)
  assert.deepEqual(
    unplaced,
    [],
    'These source files are rendered to no declared audience. Add the tree to\n' +
      'EXPERIENCE_OF_SOURCE in tools/ownership-map.mjs:\n  ' + unplaced.join('\n  '),
  )

  // The classification is by prefix, so it can only be wrong by being absent.
  // Spot-check the two answers that were actually wrong before this item.
  assert.equal(experienceOf('apps/system-studio/src/components/Nav.tsx'), 'deployer')
  assert.equal(experienceOf('apps/web/src/components/ui/Button.tsx'), 'tenant')
  assert.equal(experienceOf('packages/authorization/src/index.ts'), 'engine')
  assert.equal(experienceOf('docs/architecture/ownership.md'), null)
  assert.equal(EXPERIENCE_OF_SOURCE.length, 3, 'the source-experience list changed')
})

test('the console components are owned, not filed as shared', () => {
  // `apps/system-studio/src/components/` sat in SHARED_PREFIXES under "what
  // every domain renders through". No domain outside the console renders
  // through them, and no file in apps/web can import them — the two apps are
  // separate origins on purpose (PD-007).
  const { byDomain } = classify()
  const owned = byDomain.get('control-plane') ?? []

  const consoleComponents = gitFiles('apps/system-studio/src/components/*')
  assert.ok(consoleComponents.length >= 5, 'the console component reader found almost nothing')

  const unowned = consoleComponents.filter((f) => !owned.includes(f))
  assert.deepEqual(
    unowned,
    [],
    `these console components are not owned by control-plane:\n  ${unowned.join('\n  ')}`,
  )
})

test('a token declared by both experiences with different values is recorded', () => {
  const { tokens } = collectTokens()
  const divergent = tokens.filter((t) => t.shared && !t.agree)

  assert.ok(
    divergent.length > 0,
    'no token diverges between the two stylesheets. If they were genuinely unified, delete ' +
      'SHARED_TOKENS with this test rather than leaving both green over nothing.',
  )

  const undeclared = divergent.filter((t) => !SHARED_TOKENS.has(t.name))
  assert.deepEqual(
    undeclared.map((t) => `${t.name}: ${Object.entries(t.values).map(([k, v]) => `${k}=${v}`).join(' vs ')}`),
    [],
    'These token names mean two different things across the two experiences and nothing says\n' +
      'whether that is intended. Either unify the value, or add an entry to SHARED_TOKENS in\n' +
      'tools/entry-point-inventory.mjs saying why the difference is right:\n  ' +
      undeclared.map((t) => t.name).join('\n  '),
  )
})

test('a SHARED_TOKENS entry cannot outlive the divergence it describes', () => {
  // The half that keeps the table honest in the other direction. Without it,
  // unifying two tokens leaves behind a paragraph explaining why they differ —
  // which is the drifting-documentation failure this whole item is about,
  // reintroduced by the document that fixes it.
  const { tokens } = collectTokens()
  const byName = new Map(tokens.map((t) => [t.name, t]))

  const stale = [...SHARED_TOKENS.keys()].filter((name) => {
    const token = byName.get(name)
    return !token || !token.shared || token.agree
  })

  assert.deepEqual(
    stale,
    [],
    'SHARED_TOKENS explains a divergence that no longer exists. Delete the entry:\n  ' +
      stale.join('\n  '),
  )

  for (const [name, record] of SHARED_TOKENS) {
    assert.ok(
      ['deliberate', 'unreconciled'].includes(record.status),
      `${name} has status ${JSON.stringify(record.status)}`,
    )
    assert.ok(
      (record.why ?? '').length > 80,
      `${name} diverges without saying why — a one-line reason is how this becomes a rubber stamp`,
    )
  }
})

test('divergences nobody has decided about do not accumulate', () => {
  // `unreconciled` is an honest status, not a parking space. It exists because
  // a table offering only "deliberate" would have turned --ease-entry into a
  // justification the moment someone needed the build green. The budget is what
  // stops that being free the second time.
  const unreconciled = [...SHARED_TOKENS]
    .filter(([, record]) => record.status === 'unreconciled')
    .map(([name]) => name)

  assert.ok(
    unreconciled.length <= UNRECONCILED_TOKEN_BUDGET,
    `${unreconciled.length} token divergences are recorded as unreconciled and the budget is ` +
      `${UNRECONCILED_TOKEN_BUDGET}: ${unreconciled.join(', ')}. Decide one of them — either the ` +
      `two experiences should differ here and the entry says why, or they should not and the ` +
      `values unify. Raising the budget is not a third option.`,
  )
})

test('the committed inventory names both experiences and every divergent token', () => {
  const doc = fs.readFileSync(DOC, 'utf8')
  const { pages } = collect()
  const { tokens } = collectTokens()

  for (const e of EXPERIENCES) assert.ok(doc.includes(`\`${e.app}\``), `${DOC} does not name ${e.app}`)

  for (const page of pages.filter((p) => p.experience === 'deployer')) {
    assert.ok(doc.includes(`\`${page.route}\``), `${DOC} does not mention the console's ${page.route}`)
  }

  for (const t of tokens.filter((t) => t.shared && !t.agree)) {
    assert.ok(doc.includes(`\`${t.name}\``), `${DOC} does not mention the divergent token ${t.name}`)
  }
})

test('the committed documents match what the generators produce now', () => {
  // Both, in one place. The token section and the experience section are
  // generated from the stylesheets and the tree, so a change to either that
  // nobody regenerated leaves a document asserting yesterday's shape.
  for (const tool of ['tools/entry-point-inventory.mjs', 'tools/ownership-map.mjs']) {
    const result = execFileSync('node', [tool, '--check'], { encoding: 'utf8', stdio: 'pipe' })
    assert.match(result, /up to date/, `${tool} reported something other than up to date`)
  }
})
