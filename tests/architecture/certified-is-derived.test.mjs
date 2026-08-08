import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * WRK-030-005 — `certified` is derived from a provider review, never asserted
 * by a component.
 *
 * The requirement opened because `resolveCapability` genuinely refuses a
 * connect action when `certified` is false, and NOTHING DERIVED IT: the literal
 * `certified: true` appeared at four call sites — three in
 * `app/(app)/settings/page.tsx` and one in `components/ai/TenureAIPanel.tsx` —
 * and for `ai.model` it was false. `RELAY_ANTHROPIC_REVIEW.state` is
 * `NOT_SUBMITTED`, `app/api/ai/chat/route.ts` refuses every vendor call because
 * of it, and the Connection Center said "connected and working" about a
 * capability the request path will not call.
 *
 * A unit test on `certifiedCapabilityState` cannot catch that coming back: the
 * failure mode is a JSX literal at a call site, which type-checks, renders, and
 * is invisible to every test that builds its own fixture. This is a lexical
 * guard for exactly that shape, and it is the reason it is lexical.
 *
 * It runs in seconds under `npm run test:platform`, beside the other
 * repository-property guards.
 */

const ROOTS = ["apps/web/src/app", "apps/web/src/components"]

/** Every `.tsx` under the surfaces that render a capability. */
function tsxFiles(dir, found = []) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return found
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) tsxFiles(rel, found)
    // Tests are excluded, and only tests. A fixture that pins `certified` to
    // both values is how the resolver's two directions are proven at all —
    // `MissingConnectionCard.test.tsx` renders a certified capability and an
    // uncertified one — and a guard that refused them would have to be
    // switched off to be satisfied. What it guards is SHIPPED surfaces, which
    // is where the four literals lived.
    else if (entry.name.endsWith(".tsx") && !/\.(test|itest|spec)\.tsx$/.test(entry.name)) {
      found.push(rel)
    }
  }
  return found
}

/**
 * Comments stripped, for the same reason `audit-writes.test.mjs` strips them:
 * this file's own explanation of what went wrong names the literal, and a guard
 * that fired on prose about itself would be unusable.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")

/** `certified: true`, `certified:false`, `certified : true` — any spelling. */
const ASSERTED = /\bcertified\s*:\s*(true|false)\b/

test("no .tsx surface asserts a capability's certification", () => {
  const offenders = []
  for (const root of ROOTS) {
    for (const file of tsxFiles(root)) {
      const text = code(fs.readFileSync(path.join(ROOT, file), "utf8"))
      for (const [index, line] of text.split("\n").entries()) {
        if (ASSERTED.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A component wrote `certified:` as a literal. Certification is a PROVIDER's answer, not a " +
      "call site's: use `certifiedCapabilityState(key)` from " +
      "apps/web/src/lib/connections/capability-resolution.ts, which reads the same " +
      "`providerActivation` record apps/web/src/app/api/ai/chat/route.ts refuses on.\n  " +
      offenders.join("\n  "),
  )
})

test("the resolver the surfaces must use exists and reads a provider review", () => {
  // Guards the test above: with no resolver, the assertion passes trivially on
  // a tree where nobody could have derived anything.
  const resolver = fs.readFileSync(
    path.join(ROOT, "apps/web/src/lib/connections/capability-resolution.ts"),
    "utf8",
  )
  assert.match(
    resolver,
    /export function certifiedCapabilityState\(/,
    "capability-resolution.ts no longer exports certifiedCapabilityState",
  )
  assert.match(
    resolver,
    /providerActivation\(/,
    "certifiedCapabilityState no longer derives from providerActivation, so `certified` is a " +
      "literal again — just one directory further from the surfaces.",
  )
})

test("both surfaces that render a capability call the resolver", () => {
  // A resolver nothing calls is the failure this requirement is about, and the
  // lexical guard above passes on a file that simply stopped setting the field.
  for (const file of [
    "apps/web/src/app/(app)/settings/page.tsx",
    "apps/web/src/components/ai/TenureAIPanel.tsx",
  ]) {
    const text = code(fs.readFileSync(path.join(ROOT, file), "utf8"))
    assert.match(
      text,
      /certifiedCapabilityState\(/,
      `${file} no longer derives \`certified\` from the provider review.`,
    )
  }
})
