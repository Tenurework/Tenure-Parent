import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * The approver on a destructive transition is looked up, not asserted.
 *
 * `advance()` refuses unless the caller passes `approverIsOperator: true`. That
 * makes forgetting to check fail closed — but it does nothing about a caller
 * that passes a literal `true`, which is the shortest path from this guard to
 * no guard at all, and a mutation doing exactly that survived the package's own
 * tests.
 *
 * The transitions this protects are the three that cannot be undone by trying
 * again: provisioning spends money, activating routes real users, and purging
 * deletes a tenant.
 *
 * ## Why the call site is derived and no longer named
 *
 * This file used to hold `const CALL_SITE = "apps/system-studio/src/app/tenants/
 * actions.ts"`, because that is where `advanceState` called `advanceTenant`
 * inline when the lookup was added. STUDIO-130-005 then lifted the executor out
 * of the server action into `runAdvance`
 * (`apps/system-studio/src/lib/command-handlers.ts`), so that a poller, an
 * operator's curl and the control-plane API could advance a tenant without
 * duplicating a hundred lines of it. The call moved and the lookup moved with
 * it — `command-handlers.ts:506` computes `approverIsOperator` from
 * `isOperator(input.approvedBy)` — but this guard stayed pointed at a file that
 * no longer advances anything.
 *
 * That is the failure mode a hardcoded path always has: it can only be right
 * about where the call WAS. So the call site is now found the way a reviewer
 * would find it — the modules that import the lifecycle's `advance` /
 * `advanceTenant` and call it — and the three assertions are made against each
 * one. A second call site is covered on the day it is written rather than on
 * the day somebody remembers to add it here.
 */

/** Trees a caller could live in. `tests/` cannot: nothing there is production. */
const ROOTS = ["apps", "packages"]

/**
 * Source text with comment-only lines removed.
 *
 * Line-prefix only — a line whose first non-space characters are `//`, `/*` or
 * `*` — deliberately, rather than a real comment parser. It cannot touch a line
 * that begins with code, so it cannot truncate a string literal containing
 * `//`, and it removes exactly the thing that made this sweep report two false
 * offenders: `apps/system-studio/src/lib/tenant-state.ts` names `advance()` in
 * a JSDoc paragraph explaining which refusals the lifecycle engine owns, and it
 * calls nothing.
 *
 * It also makes the guard STRICTER in the direction that matters: a file whose
 * only mention of `approverIsOperator` is in a comment no longer counts as
 * having done the lookup.
 */
function codeOf(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n")
}

/**
 * A module that can actually call the lifecycle, as opposed to one that says
 * the word.
 *
 * The old sweep asked only whether `advance(` appeared anywhere in the text,
 * and by the time three cluster runs had landed that matched a Playwright spec
 * whose local helper is `async function advance(page, slug, to)` — a browser
 * driver that reaches the real action through a form POST, and therefore
 * through the one lookup, rather than around it. Requiring the symbol to be
 * IMPORTED is what separates a caller from a coincidence of naming.
 */
function importsLifecycle(code) {
  return (
    /import\s*(?:type\s+)?\{[^}]*\b(?:advance|advanceTenant)\b[^}]*\}\s*from\s*"[^"]+"/.test(code) ||
    /import\s*\*\s*as\s+\w+\s*from\s*"(?:@tenure\/provisioning|[^"]*\/registry)"/.test(code)
  )
}

/** Every non-test source file under `apps/` and `packages/`. */
function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", "dist"].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) out.push(full)
    }
  }
  for (const root of ROOTS) {
    const abs = path.join(ROOT, root)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out
}

/** `{ file, code }` for every module that imports the lifecycle and calls it. */
function lifecycleCallers() {
  const out = []
  for (const full of sourceFiles()) {
    const code = codeOf(fs.readFileSync(full, "utf8"))
    if (!importsLifecycle(code)) continue
    if (!/\b(?:advance|advanceTenant)\(/.test(code)) continue
    out.push({ file: path.relative(ROOT, full).split(path.sep).join("/"), code })
  }
  return out
}

/**
 * `approverIsOperator: <expr> ? isOperator(<expr>) : …`, where both `<expr>`
 * are the SAME expression.
 *
 * The back-reference is the point. `approvedBy ? isOperator(somethingElse)` is
 * a lookup of a value nobody is approving with, and it would satisfy a pattern
 * that merely required the two words to appear near each other.
 */
const DERIVED = /approverIsOperator:\s*((?:\w+\.)?approvedBy)\s*\?\s*isOperator\(\1\)/

/** A literal in that position is the mutation this guard was written for. */
const LITERAL = /approverIsOperator:\s*(true|Boolean\(1\)|1)\b/

/** `isOperator` from the operator registry, under either import spelling. */
const IMPORTS_IS_OPERATOR = /import\s*\{[^}]*\bisOperator\b[^}]*\}\s*from\s*"(?:@\/lib\/operators|[.\/]*operators)"/

test("the call site derives the answer from the operator allowlist", () => {
  const callers = lifecycleCallers()
  // Floor: every assertion below is a loop, and a loop over nothing passes. A
  // walker that stopped finding files would otherwise report a clean bill of
  // health on the guard whose absence let one operator approve their own purge.
  assert.ok(
    callers.length >= 2,
    `only ${callers.length} lifecycle callers found; the walker is broken, not the code. ` +
      `At minimum apps/system-studio/src/lib/registry.ts calls advance() and ` +
      `apps/system-studio/src/lib/command-handlers.ts calls advanceTenant().`,
  )

  // The ones that actually carry an approver. `registry.ts` forwards an opaque
  // `AdvanceOptions` and never names the field, so it has nothing to look up.
  const approvers = callers.filter((c) => /\bapprovedBy\b/.test(c.code))
  assert.ok(
    approvers.length >= 1,
    "no lifecycle caller passes approvedBy at all, so nothing here is being checked",
  )

  for (const { file, code } of approvers) {
    assert.match(
      code,
      DERIVED,
      `${file} must compute approverIsOperator from isOperator(approvedBy). A literal, or a ` +
        `value taken from the request, turns the lifecycle's refusal into a formality.`,
    )
    assert.ok(!LITERAL.test(code), `${file} passes a literal for approverIsOperator.`)
    assert.match(code, IMPORTS_IS_OPERATOR, `${file} does not import isOperator from the operator registry`)
  }
})

test("no other caller of advance() skips the lookup", () => {
  // A second call site that forgot would fail closed at runtime rather than
  // silently pass — but it would fail closed in production, on a purge, which
  // is a worse place to find out than here.
  const offenders = lifecycleCallers()
    .filter((c) => /\bapprovedBy\b/.test(c.code) && !/\bapproverIsOperator\b/.test(c.code))
    .map((c) => c.file)

  assert.deepEqual(offenders, [], "A caller passes approvedBy to advance() without a verified lookup.")
})
