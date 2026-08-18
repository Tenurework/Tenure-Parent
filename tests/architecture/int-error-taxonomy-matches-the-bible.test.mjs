import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * INT-060-002 — "stable error taxonomy", made checkable.
 *
 * The Bible states a minimum set of error classes in a fenced block in §14, and
 * `apps/web/src/lib/connections/integration-errors.ts` declares them as a
 * TypeScript union. Two lists of twenty-two strings in two files is exactly the
 * arrangement that drifts: somebody adds a class to the code because a provider
 * needed one, or renames one because it read badly, and the authority and the
 * implementation quietly stop being the same vocabulary. An alert written
 * against `TRANSIENT_PROVIDER` stops firing the day it becomes
 * `PROVIDER_TRANSIENT`, and nothing fails.
 *
 * So the guard reads the Bible's own fence and compares it to the code's own
 * array — content AND order — and it is deliberately run by the platform suite
 * rather than by jest, so it fails in CI on a Bible edit as well as on a code
 * edit. `tools/run-platform-tests.mjs` discovers this file and
 * `.github/workflows/ci.yml` runs `npm run test:platform`.
 *
 * The source is read as TEXT rather than imported: this runner has no
 * TypeScript loader, which is the same reason every other file in this
 * directory reads its subject as a string.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n")

const BIBLE = "Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md"
const SOURCE = "apps/web/src/lib/connections/integration-errors.ts"

/**
 * The §14 fence, sliced by its heading rather than by a line number.
 *
 * A line number would be right until somebody adds a paragraph above it, and
 * then it would silently read a different fence — the JSON envelope in §9, say,
 * which has no class names in it at all and would make this test pass by
 * comparing nothing.
 */
function bibleClasses() {
  const text = read(BIBLE)
  const heading = text.indexOf("## 14. Error taxonomy and exception management")
  assert.notEqual(heading, -1, "§14 is not in the Bible under the heading this test slices on")

  const open = text.indexOf("```text", heading)
  assert.notEqual(open, -1, "§14 has no fenced class list")
  const bodyStart = text.indexOf("\n", open) + 1
  const close = text.indexOf("```", bodyStart)
  assert.notEqual(close, -1, "§14's fence is not closed")

  return text
    .slice(bodyStart, close)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** The declared array, read out of the source as text. */
function declaredClasses() {
  const text = read(SOURCE)
  const marker = "export const INTEGRATION_ERROR_CLASSES = ["
  const open = text.indexOf(marker)
  assert.notEqual(open, -1, `${SOURCE} does not export INTEGRATION_ERROR_CLASSES`)
  const close = text.indexOf("] as const", open)
  assert.notEqual(close, -1, "INTEGRATION_ERROR_CLASSES is not a const-asserted array literal")

  return [...text.slice(open + marker.length, close).matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
}

test("the taxonomy is exactly the Bible's, in the Bible's order", () => {
  const bible = bibleClasses()
  const declared = declaredClasses()

  // Both directions and the order, not a subset test: a subset test passes for
  // an implementation that dropped half the vocabulary.
  assert.deepEqual(declared, bible)
})

test("the fence this test reads really is the class list", () => {
  // A detector that matched nothing would make the comparison above vacuous.
  // These four are named because they are the ones every other integration
  // vocabulary also has, so their presence is evidence the right block was cut.
  const bible = bibleClasses()
  assert.equal(bible.length, 22)
  for (const expected of [
    "AUTHENTICATION_FAILED",
    "RATE_LIMITED",
    "RECONCILIATION_VARIANCE",
    "UNKNOWN_OUTCOME",
  ]) {
    assert.ok(bible.includes(expected), `§14's fence does not contain ${expected}`)
  }
})

test("every class has a retry disposition declared beside it", () => {
  const text = read(SOURCE)
  const open = text.indexOf("export const RETRY_DISPOSITION: Record<IntegrationErrorClass, RetryDisposition> = {")
  assert.notEqual(open, -1, "RETRY_DISPOSITION is not declared as a total Record")
  const close = text.indexOf("\n}", open)
  const body = text.slice(open, close)

  for (const cls of bibleClasses()) {
    assert.ok(
      new RegExp(`^\\s*${cls}: "`, "m").test(body),
      `${cls} has no disposition. A class with no decision falls into whatever a default would be.`,
    )
  }
})

test("the two classes that mean 'we do not know' are never automatically retried", () => {
  // The property INT-060-005 turns on, asserted against the source rather than
  // only in jest: a future edit that made UNKNOWN_OUTCOME "retry-automatically"
  // would turn an unknown provider outcome into a duplicate business action,
  // and this file runs in the platform suite where that change is reviewed.
  const text = read(SOURCE)
  for (const cls of ["UNKNOWN_OUTCOME", "RECONCILIATION_VARIANCE"]) {
    const line = text.split("\n").find((l) => new RegExp(`^\\s*${cls}: "`).test(l))
    assert.ok(line, `${cls} has no disposition line`)
    assert.match(
      line,
      /"reconcile-before-retry"/,
      `${cls} must be reconcile-before-retry. ${line.trim()}`,
    )
  }
})

test("the taxonomy module is imported by production code, not only by its test", () => {
  // A vocabulary nothing uses is a document with a .ts extension.
  const importers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      const text = fs.readFileSync(full, "utf8")
      if (text.includes("@/lib/connections/integration-errors")) {
        importers.push(path.relative(ROOT, full).split(path.sep).join("/"))
      }
    }
  }
  walk(path.join(ROOT, "apps/web/src"))

  assert.ok(
    importers.length > 0,
    "nothing in production imports the taxonomy. A module nothing calls is not shipped.",
  )
})
