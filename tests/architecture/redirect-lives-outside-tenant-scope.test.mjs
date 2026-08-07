/**
 * WRK-P1-16. `redirect()` and `revalidatePath()` live OUTSIDE the tenant scope.
 *
 * `docs/architecture/REVIEW-FINDINGS.md:53` states the defect and nothing in the
 * tree stated the rule. `redirect()` is not a function that navigates — it is a
 * *throw* carrying a `NEXT_REDIRECT` digest that the framework catches at the
 * request boundary. `withTenantScope` (apps/web/src/lib/tenant-scope.ts) runs
 * its body inside `runInTenantScope`, and the bodies in this application open
 * `db.$transaction`. A redirect reached while one is open aborts it: the writes
 * roll back, nothing throws anywhere the user can see, and the browser follows a
 * 307 to a page that reports success.
 *
 * There are two halves to the fence and this is the lexical one.
 *
 *   * RUNTIME: `runInTenantScope` rewrites an escaping `NEXT_REDIRECT` into a
 *     `TenantContextError` (apps/web/src/lib/tenancy/context.ts,
 *     `isNextControlFlowError`). That catches a redirect reached through a
 *     helper, which no lexical scan can see.
 *   * LEXICAL (here): the runtime guard only fires on the request that hits it.
 *     This one fires in CI, before anybody's transaction rolls back, and it
 *     covers `revalidatePath` / `revalidateTag` too — which do NOT throw, so the
 *     runtime guard is blind to them. They are still wrong inside the body: a
 *     scope that is about to be re-entered by a revalidated render is a scope
 *     doing cache work with a tenant filter attached, and the rule is easier to
 *     hold when it has no exceptions.
 *
 * `notFound()` is deliberately NOT on the forbidden list. It throws as well, but
 * it appears only in page reads that open no transaction — there is nothing in
 * flight for it to roll back — and rejecting it would turn a 404 into a 500.
 *
 * Parsed with the TypeScript compiler rather than brace-matched by hand. Half of
 * these files are `.tsx` returning JSX, and JSX text is full of apostrophes and
 * braces that no regular-expression scanner survives; a scanner that quietly
 * mis-parses a page is a test that passes because it found nothing to look at.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

const ROOT = path.join('apps', 'web', 'src')

/** The wrappers that open a tenant scope. Every one runs its callback inside `runInTenantScope`. */
const SCOPE_OPENERS = new Set([
  'withTenantScope',
  'withSystemTenantScope',
  'forEachInstitution',
  'runInTenantScope',
])

/** Next.js entry points that must not be reached from inside a scope body. */
const FORBIDDEN = new Set(['redirect', 'permanentRedirect', 'revalidatePath', 'revalidateTag'])

/**
 * Files this test does not police yet, each with the run that owns them.
 *
 * Stated rather than silently skipped: a directory missing from a walk is
 * indistinguishable from a directory with nothing in it, and the next reader
 * cannot tell which. An entry here is a debt with a name on it.
 */
const DEFERRED = [
  {
    prefix: path.join('apps', 'web', 'src', 'app', '(app)', 'approvals'),
    since: '2026-08-07',
    owner: 'the run holding WRK-P1-16-APPROVALS (approvals/** is its file allowlist)',
    note:
      'Its `redirect()` has already been hoisted out, because the runtime guard in ' +
      'runInTenantScope would otherwise 500 the submit flow. The remaining ' +
      '`revalidatePath` calls inside the scope bodies are that run to move.',
  },
]

function isDeferred(file) {
  return DEFERRED.some((d) => file.startsWith(d.prefix + path.sep) || file === d.prefix)
}

/** Every .ts/.tsx under apps/web/src that is production code. */
function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(p, found)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    // Tests build their own scopes and assert on them; they are not call sites.
    if (/\.(test|itest)\.tsx?$/.test(entry.name)) continue
    found.push(p)
  }
  return found
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function walk(node, visit) {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

/** The name a call expression is calling, for the plain-identifier case. */
function calleeName(node) {
  if (!ts.isCallExpression(node)) return undefined
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined
}

/**
 * Same-file helpers that wrap a forbidden call.
 *
 * `revalidateAdmin()` in admin/actions.ts and `bumpProfile()` in
 * settings/actions.ts are `revalidatePath` under another name. Without this, a
 * file could satisfy the rule by renaming the violation, which is the failure
 * mode a purely name-based check always has.
 */
function localWrappers(sourceFile) {
  const wrappers = new Set()
  walk(sourceFile, (node) => {
    let name
    let body
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text
      body = node.body
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text
      body = node.initializer.body
    }
    if (!name || !body) return
    let hit = false
    walk(body, (inner) => {
      if (FORBIDDEN.has(calleeName(inner))) hit = true
    })
    if (hit) wrappers.add(name)
  })
  return wrappers
}

/** Every `redirect(...)`-shaped call lexically inside a scope-opening callback. */
function violationsIn(file) {
  const sourceFile = parse(file)
  const wrappers = localWrappers(sourceFile)
  const banned = new Set([...FORBIDDEN, ...wrappers])
  const found = []

  walk(sourceFile, (node) => {
    if (!SCOPE_OPENERS.has(calleeName(node))) return
    for (const arg of node.arguments) {
      if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue
      walk(arg.body, (inner) => {
        const name = calleeName(inner)
        if (!banned.has(name)) return
        const { line } = sourceFile.getLineAndCharacterOfPosition(inner.getStart(sourceFile))
        found.push(
          `${file.split(path.sep).join('/')}:${line + 1} — ${name}(...) inside ` +
            `${calleeName(node)}(...)` +
            (wrappers.has(name) ? ` [${name} wraps revalidatePath/redirect in this file]` : ''),
        )
      })
    }
  })
  return found
}

test('no redirect() or revalidatePath() runs inside a tenant scope body', () => {
  const files = sourceFiles(ROOT).filter((f) => !isDeferred(f))
  assert.ok(files.length > 200, `only ${files.length} files walked — the walk is broken`)

  const violations = files.flatMap(violationsIn).sort()

  assert.deepEqual(
    violations,
    [],
    'redirect() is a throw, and inside a tenant scope it aborts any open transaction — the ' +
      'writes roll back while the browser sees a 307 to a success page. Hoist the value out ' +
      'and redirect after the scope closes:\n' +
      '  const id = await withTenantScope(userId, async () => { ...; return x.id })\n' +
      '  revalidatePath("/x"); redirect(`/x/${id}`)\n\n  ' +
      violations.join('\n  '),
  )
})

test('the walk actually reaches the call sites it is meant to police', () => {
  // Guards the test above. If `sourceFiles` or the TS parse silently produced
  // nothing, `violations` would be empty and this file would pass forever while
  // enforcing nothing. So: assert the openers are found at all, in the file that
  // has the most of them.
  const file = path.join(ROOT, 'app', '(app)', 'admin', 'actions.ts')
  const sourceFile = parse(file)
  let openers = 0
  walk(sourceFile, (node) => {
    if (SCOPE_OPENERS.has(calleeName(node))) openers += 1
  })
  assert.ok(openers > 15, `expected many scope openers in ${file}, found ${openers}`)

  // And that the local-wrapper detection is live, not a no-op.
  assert.ok(
    localWrappers(sourceFile).has('revalidateAdmin'),
    'revalidateAdmin() wraps revalidatePath and must be recognised as a forbidden call',
  )
})

test('every deferred directory names the run that owns it and the date it was deferred', () => {
  // A silent exclusion is how an allowlist becomes permanent. Each entry has to
  // carry enough for the next reader to chase it.
  for (const d of DEFERRED) {
    assert.ok(fs.existsSync(d.prefix), `deferred path no longer exists: ${d.prefix}`)
    assert.match(d.since, /^\d{4}-\d{2}-\d{2}$/, `${d.prefix} has no ISO date`)
    assert.ok(d.owner.length > 20, `${d.prefix} does not name an owning run`)
    assert.ok(d.note.length > 40, `${d.prefix} does not say what is left to do`)
  }
  assert.equal(DEFERRED.length, 1, 'a new directory was deferred — that is a review question')
})
