import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * The approval action asks whether borrowed authority may be used at all.
 *
 * `mayBorrowAuthority` is pure and well tested, and that is worth exactly
 * nothing if the one caller stops calling it — a mutation deleting the check
 * from the action survived every unit test, because the action talks to a
 * database and has none.
 *
 * What it guards: a backup approver approving their own request. The borrowing
 * branch runs ONLY when the direct check has already refused, so removing this
 * re-opens the path precisely where the ordinary rules had just said no.
 */

const ACTION = "apps/web/src/app/(app)/approvals/actions.ts"

test("the approval action gates borrowing on mayBorrowAuthority", () => {
  const source = fs.readFileSync(path.join(ROOT, ACTION), "utf8")

  assert.match(source, /import \{ mayBorrowAuthority \}/, `${ACTION} no longer imports the rule.`)
  assert.match(
    source,
    /const borrow = mayBorrowAuthority\(\{[\s\S]{0,200}?requestedByPrincipalId: approval\.submittedById/,
    `${ACTION} must ask mayBorrowAuthority about THIS approval's author. Asking about anything ` +
      `else — or not asking — lets a backup approve their own request.`,
  )
  assert.match(
    source,
    /if \(!allowed && borrow\.ok\)/,
    `${ACTION} must gate the delegation branch on the answer. Computing it and ignoring it is ` +
      `the same as not computing it.`,
  )
})

test("no other caller borrows authority without asking", () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", "dist"].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8")
        if (!/effectiveApprovalContext\(/.test(text)) continue
        // The module that defines it is not a caller.
        if (/export async function effectiveApprovalContext/.test(text)) continue
        if (!/mayBorrowAuthority/.test(text)) {
          offenders.push(path.relative(ROOT, full).split(path.sep).join("/"))
        }
      }
    }
  }
  walk(path.join(ROOT, "apps"))
  assert.deepEqual(
    offenders,
    [],
    "A caller borrows delegated authority without checking whether it may be used on this request.",
  )
})
