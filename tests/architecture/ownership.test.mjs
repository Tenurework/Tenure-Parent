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
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

import { DOMAINS, SHARED, SHARED_PREFIXES, classify } from '../../tools/ownership-map.mjs'

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

test('the map covers the app, the studio and the packages', () => {
  // A map that silently stopped scanning a root would report zero orphans
  // forever. Asserting the file count is non-trivial is what stops that being
  // indistinguishable from success.
  const { files } = classify()
  assert.ok(files.length > 200, `only ${files.length} files scanned — a root stopped being read`)

  for (const root of ['apps/web/src/', 'apps/system-studio/src/', 'packages/']) {
    assert.ok(
      files.some((f) => f.startsWith(root)),
      `no file scanned under ${root}`,
    )
  }
})
