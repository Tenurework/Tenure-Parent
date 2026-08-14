import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  OUT,
  ROOT,
  nonproductionEvidence,
  render,
  trackedFiles,
} from "../../tools/cfg-configuration-truth.mjs"

/**
 * CFG-000-001 — the configuration-surface inventory says what is in the tree,
 * and reds when it stops being true.
 *
 * An inventory is a claim about the repository, and the cheapest way to fail
 * this programme is to write a plausible document assembled from a Bible's own
 * wording that describes code nobody has. The defence is not care, it is this
 * file: it re-derives the whole document from `git ls-files` and compares, and
 * it separately opens every path the committed copy names. A row naming a file
 * that does not exist fails here rather than sitting in a document looking
 * authoritative for a year.
 *
 * The mutation that proves it is not prose: corrupt one path in
 * `docs/architecture/cfg-configuration-truth.md` and both
 * `the committed inventory is what the tree produces` and
 * `every path the inventory names exists` go red.
 */

const DOC = path.join(ROOT, OUT)

/** Normalised, because a Windows checkout stores this file with CRLF. */
const committed = () => fs.readFileSync(DOC, "utf8").replace(/\r\n/g, "\n")

/** Every path the committed document names, in the first column of a table row. */
function citedPaths(text) {
  return [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1])
}

test("the committed inventory is what the tree produces", () => {
  assert.equal(
    committed(),
    render(trackedFiles()),
    `${OUT} is stale. Regenerate it: node tools/cfg-configuration-truth.mjs`,
  )
})

test("every path the inventory names exists", () => {
  const missing = citedPaths(committed()).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(
    missing,
    [],
    `these rows name paths that are not in the tree: ${missing.join(", ")}. ` +
      `An inventory row that cannot be opened is the shape of a fabricated inventory.`,
  )
})

test("the inventory covers all nine things the requirement names", () => {
  const text = committed()
  // The requirement's own list, in its own words, mapped onto the headings this
  // document uses. A heading that disappears is a part of the inspection that
  // quietly stopped happening.
  const headings = [
    "## System Studio routes",
    "## Authentication and authorization modules",
    "## Configuration and form code",
    "## Databases",
    "## Infrastructure as code",
    "## Workflows",
    "## Tests over the configuration surface",
    "## Deployed nonproduction behaviour",
    "## Finding on the ninth axis",
  ]
  const absent = headings.filter((h) => !text.includes(h))
  assert.deepEqual(absent, [], `missing sections: ${absent.join(", ")}`)

  // And each one has rows. An empty section reads as "inspected, found nothing"
  // and is far more often "the matcher broke".
  for (const heading of headings.slice(0, 8)) {
    const start = text.indexOf(heading)
    const rest = text.slice(start + heading.length)
    const end = rest.indexOf("\n## ")
    const section = end === -1 ? rest : rest.slice(0, end)
    const rows = [...section.matchAll(/^\| `/gm)].length
    assert.ok(rows > 0, `${heading} has no rows`)
  }
})

test("the nonproduction finding is derived, not asserted", () => {
  const e = nonproductionEvidence(trackedFiles())
  const text = committed()

  if (e.nonProdEnvironments.length === 0 && e.nonProdWorkflows.length === 0) {
    assert.ok(
      text.includes("**There is no deployed nonproduction environment in this estate.**"),
      "the tree shows no nonproduction deployment target and the document does not say so",
    )
    // The claim rests on the two derivations above and on the estate inventory
    // being a real read-only run rather than something this generator invented.
    assert.ok(
      fs.existsSync(path.join(ROOT, "docs/architecture/aws-current-state.md")),
      "the finding cites an estate inventory that is not in the tree",
    )
    assert.ok(
      fs.existsSync(path.join(ROOT, ".github/workflows/aws-inventory.yml")),
      "the finding cites a workflow that is not in the tree",
    )
  } else {
    // The moment somebody vends a nonproduction account, the finding must stop
    // claiming there is nothing to inspect. This is the half that reds then.
    assert.ok(
      text.includes("**A nonproduction deployment target now exists**"),
      "a nonproduction deployment target exists and the document still says none does; " +
        "CFG-000-001 has to be re-evidenced against the running environment",
    )
  }
})

test("the document is byte-identical on Linux and Windows", () => {
  const doc = render(trackedFiles())

  assert.ok(!doc.includes("\r"), "a carriage return in the output makes the file checkout-dependent")
  assert.ok(!doc.includes("\\"), "a backslash means a native path leaked in; paths must be POSIX")
  assert.ok(
    !/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(doc),
    "a generated timestamp makes every regeneration a diff, so the guard stops meaning anything",
  )
  assert.ok(!doc.includes(ROOT), "an absolute path leaked into the document")

  // And the row order is the sort this claims it is: codepoint order on POSIX
  // strings. `readdirSync` order and `localeCompare` both differ across
  // platforms, and either would make the committed file current here and stale
  // in CI.
  const heading = "## System Studio routes"
  const rest = doc.slice(doc.indexOf(heading) + heading.length)
  const section = rest.slice(0, rest.indexOf("\n## "))
  const studio = citedPaths(section)
  assert.ok(studio.length > 0, "the Studio route section produced no rows")
  assert.deepEqual(studio, [...studio].sort(), "the Studio route rows are not in codepoint order")
})
