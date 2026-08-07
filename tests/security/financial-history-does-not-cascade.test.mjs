/**
 * PAY-030-006. Deleting an Organization does not destroy its financial history.
 *
 * Every financial relation used to be `onDelete: Cascade`:
 *
 *     Budget      → Organization   Cascade
 *     Transaction → Budget         Cascade
 *     BudgetLine  → Organization   Cascade
 *     Vendor      → Organization   Cascade
 *     LedgerEntry → Organization   Cascade
 *     LedgerEntry → BudgetLine     Cascade
 *
 * So one `organization.delete()` — a single line in a cleanup script, an admin
 * action nobody thought twice about — silently destroyed every posted ledger
 * entry the finance dashboard reports and the approval engine writes, plus the
 * budgets, lines, vendors and transactions behind them. Not soft-deleted: gone,
 * with no row left to say they had existed.
 *
 * The removal path a club actually needs is `OrgStatus.ARCHIVED`, which the
 * roster and every read already filter on. It keeps the history answerable,
 * which is the product's entire thesis.
 *
 * This asserts the SCHEMA, because the failure mode is somebody adding the
 * cascade back — a one-word edit that no unit test would notice and that the
 * companion integration test (apps/web/src/lib/payments/ledger-attribution.itest.ts)
 * only catches where a database is running. Deliberately an absolute zero: there
 * is no financial relation that legitimately cascades from a club.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "../../tools/document-graph.mjs"

const SCHEMA = path.join(ROOT, "apps/web/prisma/schema.prisma")

/**
 * The six relations, as `<model>.<field>` and the model each points AT.
 *
 * Named individually rather than swept for by a regex over the whole file: a
 * sweep would pass the day somebody deleted a relation, and "the cascade is
 * gone because the column is gone" is not the property being asserted.
 */
const FINANCIAL_RELATIONS = [
  { model: "Budget", field: "organization", references: "Organization" },
  { model: "Transaction", field: "budget", references: "Budget" },
  { model: "BudgetLine", field: "organization", references: "Organization" },
  { model: "Vendor", field: "organization", references: "Organization" },
  { model: "LedgerEntry", field: "organization", references: "Organization" },
  { model: "LedgerEntry", field: "budgetLine", references: "BudgetLine" },
]

/** The body of one `model X { … }` block. */
function modelBlock(schema, model) {
  const start = schema.search(new RegExp(`^model ${model} \\{$`, "m"))
  assert.notEqual(start, -1, `schema.prisma has no model ${model}`)
  const end = schema.indexOf("\n}", start)
  assert.notEqual(end, -1, `model ${model} is not closed`)
  return schema.slice(start, end)
}

test("no financial relation cascades from its parent", () => {
  const schema = fs.readFileSync(SCHEMA, "utf8")

  for (const relation of FINANCIAL_RELATIONS) {
    const block = modelBlock(schema, relation.model)
    const line = block
      .split("\n")
      .find((l) => new RegExp(`^\\s*${relation.field}\\s+${relation.references}\\??\\s`).test(l))

    assert.ok(
      line,
      `${relation.model}.${relation.field} is missing. This relation carries financial ` +
        `history; removing it does not satisfy this test.`,
    )
    assert.match(
      line,
      /onDelete:\s*Restrict/,
      `${relation.model}.${relation.field} must be onDelete: Restrict. Cascade here means one ` +
        `organization.delete() destroys posted financial history with nothing left to say it ` +
        `existed. Archive the club (OrgStatus.ARCHIVED) instead — that is what removal means ` +
        `for a record whose whole point is that it stays answerable.`,
    )
    assert.doesNotMatch(
      line,
      /onDelete:\s*Cascade/,
      `${relation.model}.${relation.field} still cascades.`,
    )
  }
})

test("the migration that changed them is committed, not just the schema", () => {
  // The schema is what Prisma's client is generated from; the DDL is what the
  // database actually enforces. A schema edit with no migration produces a
  // client that believes the constraint and a database that does not.
  const migrations = path.join(ROOT, "apps/web/prisma/migrations")
  const applied = fs
    .readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => fs.readFileSync(path.join(migrations, entry.name, "migration.sql"), "utf8"))
    .join("\n")

  for (const relation of FINANCIAL_RELATIONS) {
    const constraint = new RegExp(
      `ADD CONSTRAINT "${relation.model}_\\w+_fkey"[\\s\\S]{0,200}?ON DELETE RESTRICT`,
    )
    assert.match(
      applied,
      constraint,
      `No migration adds a RESTRICT foreign key for ${relation.model}. The generated client ` +
        `would enforce a rule the database does not.`,
    )
  }
})

test("archiving is the removal path, so there is one that is legal", () => {
  const schema = fs.readFileSync(SCHEMA, "utf8")

  // Restricting deletion without an archive route would just make removal
  // impossible, and a constraint people cannot work with is one they drop.
  assert.match(
    schema,
    /enum OrgStatus \{[\s\S]*?ARCHIVED[\s\S]*?\}/,
    "OrgStatus must carry ARCHIVED: with deletion restricted, archiving is the only way to " +
      "retire a club, and a schema with no legal removal path invites the cascade back.",
  )
  assert.match(
    modelBlock(schema, "Organization"),
    /status\s+OrgStatus/,
    "Organization must carry the OrgStatus flag that ARCHIVED lives on.",
  )
})
