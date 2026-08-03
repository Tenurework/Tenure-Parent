import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * An e2e assertion that proves a decision landed must not be satisfiable by the
 * page that was already on screen.
 *
 * `reimbursement.spec.ts` asserted `getByText("Approved")` immediately after
 * submitting the final approval. `getByText` with a plain string is a
 * case-insensitive *substring* match, and the confirmation dialog that click
 * submits reads "The request is approved for good" — so the assertion was
 * satisfied by the dialog's own copy, before the form was submitted at all.
 *
 * The test therefore never waited for the approval. It navigated away while the
 * server action was still in flight, signed in as the finance officer, and read
 * the budget line before the transaction had committed. The page is rendered
 * once per navigation with no polling, so the stale figure it read was never
 * going to change: Playwright waited out the full 45-second timeout on a number
 * that had already been superseded in the database. Locally the write won the
 * race and the suite was green; on a loaded CI runner it lost, and the failure
 * pointed at the ledger — four steps downstream of the assertion that was
 * actually wrong.
 *
 * A status label is exactly the text that invites this. Every one of them is a
 * short word or phrase that also occurs in ordinary prose describing the
 * transition — which is what confirmation copy is. So an assertion naming a
 * status label must either be `exact`, matching only the badge, or be scoped to
 * a locator that excludes the surrounding page.
 *
 * The rule is about the shape of the assertion, not about whether prose happens
 * to co-occur today. The reimbursement assertion was correct on the day it was
 * written and became wrong when somebody added a confirmation dialog four
 * commits later, without touching the test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const BADGE = "apps/web/src/components/ui/Badge.tsx"
const E2E_DIRS = ["apps/web/e2e"]

/**
 * A floor, not a count. It may only be raised — a scan that silently stops
 * finding files reports no violations and passes, which is the one way a guard
 * like this fails without saying so.
 */
const MIN_SPECS_SCANNED = 20

/** Read the labels out of the badge itself, so a new status is covered on sight. */
function statusLabels() {
  const source = fs.readFileSync(path.join(ROOT, BADGE), "utf8")
  return [...new Set([...source.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]))]
}

function specFiles() {
  const out = []
  for (const dir of E2E_DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".spec.ts")) out.push(full)
      }
    }
    walk(abs)
  }
  return out
}

/**
 * The detector, shared by the real scan and the self-test below so that a
 * change which stops it detecting anything fails a test rather than passing
 * quietly.
 */
function findViolations(lines, where, labels) {
  const found = []
  lines.forEach((line, i) => {
    for (const label of labels) {
      // `page.getByText("Approved")` — unscoped and non-exact. A scoped call
      // (`row.getByText(...)`, `dialog.getByText(...)`) is fine: the scope is
      // what excludes the prose. So is any call passing `exact`.
      const loose = `page.getByText("${label}")`
      if (line.includes(loose)) {
        found.push(`${where}:${i + 1} — ${loose} matches any prose containing "${label}"`)
      }
    }
  })
  return found
}

test("the badge still declares status labels", () => {
  const labels = statusLabels()
  assert.ok(
    labels.length >= 15,
    `Read ${labels.length} status labels out of ${BADGE}. This guard reads them from the badge so ` +
      `a new status is covered without editing the guard; if the badge moved, point BADGE at it.`,
  )
  assert.ok(labels.includes("Approved"), `"Approved" is no longer a status label in ${BADGE}.`)
})

test("the detector flags the loose form and only the loose form", () => {
  const labels = ["Approved"]
  const flagged = findViolations(
    [
      'await expect(page.getByText("Approved")).toBeVisible()',
      'await expect(page.getByText("Approved", { exact: true })).toBeVisible()',
      'await expect(row.getByText("Approved")).toBeVisible()',
      'await expect(page.getByText("Approved elsewhere in a sentence")).toBeVisible()',
    ],
    "synthetic",
    labels,
  )
  assert.deepEqual(flagged, [
    'synthetic:1 — page.getByText("Approved") matches any prose containing "Approved"',
  ])
})

test("an e2e assertion naming a status label is exact or scoped", () => {
  const labels = statusLabels()
  const files = specFiles()

  assert.ok(
    files.length >= MIN_SPECS_SCANNED,
    `Scanned ${files.length} spec files, expected at least ${MIN_SPECS_SCANNED}. A scan that ` +
      `stops finding files reports no violations and passes. Raise MIN_SPECS_SCANNED when the ` +
      `suite grows; never lower it to make this pass.`,
  )

  const violations = []
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    const lines = fs.readFileSync(file, "utf8").split(String.fromCharCode(10))
    violations.push(...findViolations(lines, rel, labels))
  }

  assert.deepEqual(
    violations,
    [],
    "Status-label assertions that a page's own copy can satisfy:" +
      String.fromCharCode(10) +
      violations.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "Use { exact: true } so only the status badge matches, or scope the call to the row or " +
      "dialog you mean. Do not delete the assertion — it is the one proving the write landed.",
  )
})
