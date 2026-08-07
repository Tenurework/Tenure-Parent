/**
 * REVIEW-FINDINGS #16, the half that destroys data: navigation lives OUTSIDE the
 * transaction.
 *
 * `redirect()` and `notFound()` do not return — they throw an Error carrying a
 * `digest` that Next.js catches at the request boundary. Everything between the
 * throw and that boundary sees an exception, including `db.$transaction`, which
 * rolls back. A server action shaped
 *
 *     const convo = await db.$transaction(async (tx) => {
 *       const c = await tx.conversation.create({ ... })
 *       await tx.message.create({ ... })
 *       redirect(`/messages/${c.id}`)              // <- everything above is gone
 *     })
 *
 * commits nothing and navigates anyway. The request succeeds, the rows do not
 * exist, and no audit row was written either — because that write was in the
 * transaction too. There is no signal, anywhere, afterwards.
 *
 * ## Why this file exists beside redirect-lives-outside-tenant-scope.test.mjs
 *
 * That test is the broader rule and this one is the sharper one; neither
 * contains the other.
 *
 *   * It forbids `redirect` / `revalidatePath` inside a **tenant scope body**,
 *     which is where those calls were all found. It deliberately permits
 *     `notFound()` anywhere, because a 404 raised from a page read has nothing
 *     in flight to abort, and rejecting it would turn a 404 into a 500.
 *   * This one forbids every navigation call — `notFound()` included — inside a
 *     **transaction callback**, wherever that transaction is: inside a scope,
 *     outside one, in `lib/`, in the approvals directory that test defers. The
 *     permission it grants `notFound()` is safe exactly until a transaction is
 *     open, and nothing else states where that line is.
 *
 * The runtime half is `guardedTransaction` in `apps/web/src/lib/db.ts`, which
 * turns such a throw into a `TenantContextError` instead of a silent rollback
 * plus a successful navigation. Its proof against a real database is
 * `apps/web/src/lib/tenancy/isolation.itest.ts`. This file is the lexical half,
 * and it fires in CI rather than on the request that loses somebody's data.
 *
 * It is green today, and that is the point. Every surveyor of #16 checked and
 * found no navigation call inside a transaction; what was open was that the
 * codebase was one edit away from one with nothing to say so.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/* ------------------------------------------------------------------ scope -- */

const SCAN_ROOT = 'apps/web/src'
const SOURCE = /\.tsx?$/

/**
 * Every source file under apps/web/src, tracked or merely present.
 *
 * `--others --exclude-standard` matters: a plain `git ls-files` sees only what
 * has been `git add`ed, so a brand-new action with a redirect in the wrong place
 * would pass locally right up until the commit that puts it in CI's reach. The
 * same reasoning as `forbidden-clients.test.mjs`, and the same call.
 */
function sourceFiles() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', SCAN_ROOT],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE.test(f))

  assert.ok(
    files.length > 100,
    `only ${files.length} source files found under ${SCAN_ROOT} — the scan is broken, not the code`
  )
  return files
}

/**
 * A source file's text, or "" if it has vanished.
 *
 * `sourceFiles()` lists untracked files too, and an untracked file can vanish
 * between the listing and the read — an editor, a build, a generator running
 * beside this one. Same tolerance, same reason, as `forbidden-clients.test.mjs`.
 */
function readSource(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Comments removed, line numbering and string literals preserved.
 *
 * Lifted from `forbidden-clients.test.mjs` for the reason it exists there, and
 * for one of this file's own: the doc block above contains `redirect(` inside a
 * `$transaction(` several times over, and every action file explains its
 * transactions in prose. A rule that reads comments reports the explanation as
 * the violation.
 */
function code(text) {
  let out = ''
  let state = 'code'
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c; i += 1; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c }
      i += 1; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; continue }
      if (c === '\n') out += c
      i += 1; continue
    }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '\n' && state !== 'tpl') { state = 'code'; out += c; i += 1; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'
    }
    out += c; i += 1
  }
  return out
}

/* ------------------------------------------------------------------ rules -- */

/** The interactive-transaction boundary, in the one shape this codebase uses. */
const TRANSACTIONS = /(?<![\w$])\$transaction\s*\(/g

/**
 * The Next.js navigation calls, plus the revalidations that belong beside them.
 *
 * `notFound` is on this list and is deliberately NOT on the list in
 * `redirect-lives-outside-tenant-scope.test.mjs`; the difference is the whole
 * reason both files exist. See the header.
 *
 * The negative lookbehind on `.` is load-bearing and was found by a false
 * positive: `apps/web/src/app/api/org-image/[orgId]/route.ts` *returns*
 * `NextResponse.redirect(url)`, which is a Response object and not a throw at
 * all. A rule that cannot tell those apart demands a rewrite that makes the
 * route worse, and teaches everyone reading it to distrust the rule.
 */
const NAVIGATION =
  /(?<![.\w$])(redirect|permanentRedirect|notFound|revalidatePath|revalidateTag)\s*\(/g

/** 1-indexed line number of `index` within `text`. */
function lineAt(text, index) {
  let n = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++
  return n
}

/**
 * The body of the call whose opening `(` is at `open`, by paren balance.
 *
 * Parens rather than braces because the body is an *argument*:
 * `db.$transaction(async (tx) => { ... })` nests the callback inside the call's
 * parentheses, and a brace walk would stop at the first `}` of an object literal
 * in an earlier argument. Comments and string literals are gone by the time this
 * runs, so a `)` inside a message cannot unbalance it.
 *
 * This also means the array form — `db.$transaction([ ... ])` — is covered by
 * the same walk, which matters: those calls hold `db.auditEvent.create(...)`
 * beside the write they record.
 */
function callBody(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return { body: text.slice(open, i), end: i }
    }
  }
  return { body: text.slice(open), end: text.length }
}

/**
 * Module-local helpers that navigate, so calling one counts as navigating.
 *
 * Without this the rule is defeated by a rename, and would have been: at the
 * time this was written `admin/actions.ts` wrapped five `revalidatePath` calls
 * in `revalidateAdmin()` and `settings/actions.ts` wrapped two in
 * `bumpProfile()`. A scanner matching only the literal token found neither.
 *
 * One level of indirection, deliberately. A helper calling a helper that
 * navigates is not something this codebase does, and a call graph inside a
 * static guard is a second compiler nobody maintains. The runtime guard in
 * `lib/db.ts` is what covers the depths this cannot see.
 */
function navigatingHelpers(text) {
  const names = new Set()
  const declaration = /(?<![.\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = declaration.exec(text))) {
    const { end } = callBody(text, m.index + m[0].length - 1)
    const brace = text.indexOf('{', end)
    if (brace === -1) continue
    let depth = 0
    let close = brace
    for (; close < text.length; close++) {
      if (text[close] === '{') depth++
      else if (text[close] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    NAVIGATION.lastIndex = 0
    if (NAVIGATION.test(text.slice(brace, close))) names.add(m[1])
  }
  return names
}

/** Every navigation call lexically inside a `$transaction(...)` in `file`. */
function violationsIn(file) {
  const text = code(readSource(file))
  if (!text) return []
  const helpers = navigatingHelpers(text)
  const patterns = [NAVIGATION]
  if (helpers.size) {
    patterns.push(new RegExp(String.raw`(?<![.\w$])(${[...helpers].join('|')})\s*\(`, 'g'))
  }

  const found = []
  TRANSACTIONS.lastIndex = 0
  let tx
  while ((tx = TRANSACTIONS.exec(text))) {
    const open = tx.index + tx[0].length - 1
    const { body } = callBody(text, open)
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let hit
      while ((hit = pattern.exec(body))) {
        found.push(
          `${file}:${lineAt(text, open + hit.index)} — ${hit[1]}() inside the ` +
            `$transaction opened at line ${lineAt(text, tx.index)}`
        )
      }
    }
  }
  return found
}

/* ------------------------------------------------------------------ tests -- */

test('no navigation call runs inside a database transaction', () => {
  const offenders = sourceFiles().flatMap(violationsIn).sort()

  assert.deepEqual(
    offenders,
    [],
    `a navigation call inside a transaction callback:\n  ${offenders.join('\n  ')}\n\n` +
      `redirect() and notFound() are throws. Raised from inside $transaction they abort it, so ` +
      `every write in that callback is rolled back while the browser follows the navigation and ` +
      `the user is told it worked. Nothing detects that afterwards: the request succeeded, the ` +
      `rows are gone, and the audit row that would have recorded them was in the same ` +
      `transaction. Return what the navigation needs from the transaction, then navigate:\n\n` +
      `  const row = await db.$transaction(async (tx) => { ...; return created })\n` +
      `  redirect(\`/x/\${row.id}\`)\n`
  )
})

/* ------------------------------------------- the rule cannot rot quietly -- */

test('the scan reaches the transactions it claims to police', () => {
  // The assertion above is `deepEqual([], [])` when the scan finds nothing, and
  // a broken regex, a renamed method and a moved directory all look exactly like
  // that. This states the floor the scan must clear to be worth reading.
  let transactions = 0
  let withCallbacks = 0
  for (const file of sourceFiles()) {
    const text = code(readSource(file))
    TRANSACTIONS.lastIndex = 0
    let tx
    while ((tx = TRANSACTIONS.exec(text))) {
      transactions++
      const { body } = callBody(text, tx.index + tx[0].length - 1)
      if (/=>/.test(body)) withCallbacks++
    }
  }

  assert.ok(
    transactions > 20,
    `only ${transactions} transactions found — the rule is scanning nothing, so it cannot fail`
  )
  assert.ok(
    withCallbacks > 10,
    `only ${withCallbacks} interactive transactions found — the rollback case is the callback form`
  )
})

test('the scanner sees a navigation call inside a transaction when there is one', () => {
  // The tree is clean, so the rule above passes on an empty list — which is what
  // a rule that can never fire also does. This drives the scanner over a module
  // that violates it, so "green" is a finding and not a shrug.
  const violating = [
    'import { redirect } from "next/navigation"',
    'export async function compose(userId) {',
    '  const convo = await db.$transaction(async (tx) => {',
    '    const c = await tx.conversation.create({ data: {} })',
    '    redirect(`/messages/${c.id}`)',
    '  })',
    '  return convo',
    '}',
  ].join('\n')

  const text = code(violating)
  TRANSACTIONS.lastIndex = 0
  const tx = TRANSACTIONS.exec(text)
  assert.ok(tx, 'the transaction opener was not found in the constructed module')
  const open = tx.index + tx[0].length - 1
  const { body } = callBody(text, open)
  NAVIGATION.lastIndex = 0
  const hit = NAVIGATION.exec(body)
  assert.ok(hit, 'redirect() inside the transaction callback was not reported')
  assert.equal(hit[1], 'redirect')

  // Line 5 is the `redirect(...)` call. Line 1 is `import { redirect } from
  // "next/navigation"` — outside the transaction, and the thing a scan that
  // reported an import as a violation would land on instead.
  assert.equal(lineAt(text, open + hit.index), 5)
})

test('the scanner recognises a navigating helper, not only the literal call', () => {
  // The defeat this rule survived once already, kept live: the helper form is
  // how sixty of these calls were written when #16 was filed.
  const module = [
    'function bumpProfile() { revalidatePath("/settings") }',
    'export async function act(userId) {',
    '  await db.$transaction(async (tx) => {',
    '    await tx.user.update({ where: { id: userId }, data: {} })',
    '    bumpProfile()',
    '  })',
    '}',
  ].join('\n')

  assert.ok(
    navigatingHelpers(module).has('bumpProfile'),
    'a helper whose body revalidates was not recognised'
  )
  TRANSACTIONS.lastIndex = 0
  const tx = TRANSACTIONS.exec(module)
  const { body } = callBody(module, tx.index + tx[0].length - 1)
  assert.match(
    body,
    new RegExp(String.raw`(?<![.\w$])bumpProfile\s*\(`),
    'the helper call is not inside the transaction body the scanner extracted'
  )
})

test('the calls this rule is about are the calls it names', () => {
  // The token list IS the rule. Dropping an entry is the cheapest way to keep
  // this suite green and the hardest to notice, because the assertion stays
  // `deepEqual([], [])` either way. Pinning the list makes that edit a decision.
  for (const call of ['redirect', 'permanentRedirect', 'notFound', 'revalidatePath', 'revalidateTag']) {
    NAVIGATION.lastIndex = 0
    assert.match(`${call}(`, NAVIGATION, `${call}() is meant to be governed here and no longer matches`)
  }
  NAVIGATION.lastIndex = 0
  assert.doesNotMatch(
    'NextResponse.redirect(url)',
    NAVIGATION,
    'a returned Response is not a control-flow throw and must not be reported'
  )
  TRANSACTIONS.lastIndex = 0
  assert.match(
    'await db.$transaction(async (tx) => {',
    TRANSACTIONS,
    'the transaction pattern no longer matches the shape this codebase writes'
  )
})

test('the runtime half of this rule is still attached to the client', () => {
  // A lexical rule cannot see a redirect reached through an imported helper, so
  // the claim in this file's header — that `lib/db.ts` catches those — has to be
  // true. If the wrapper is removed, the header becomes a lie and the depths go
  // unguarded; either way this is the wrong pair of files to find that out in.
  // The assertion is on the EXPORT, not on the definition. Checking that
  // `guardedTransaction` merely exists in the file passed while `db` was
  // exported unwrapped — the function was still there, defined, called by
  // nobody, and this test said the guard was attached. The integration proof
  // reds either way; a static rule that could not tell a live wrapper from a
  // dead one has no business claiming to be the second line.
  const dbModule = code(readSource('apps/web/src/lib/db.ts'))
  assert.match(
    dbModule,
    /export\s+const\s+db\s*=[^\n]*withTransactionGuard\s*\(/,
    'the exported `db` is no longer built through withTransactionGuard — the runtime half of ' +
      'this rule is gone, and this file cannot see a navigation call that reaches a transaction ' +
      'through an imported helper'
  )
  assert.match(
    dbModule,
    /function\s+guardedTransaction\s*\(/,
    'lib/db.ts no longer defines the transaction guard the export above claims to use'
  )
})
