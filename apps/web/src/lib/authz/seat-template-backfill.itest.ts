import fs from "fs"
import path from "path"

import { ROLE_TEMPLATES } from "@tenure/authorization"

import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { runUnscoped } from "@/lib/tenancy/context"

/**
 * GE-051-005 — the migration that moved authority off the seat's title.
 *
 * Runs against the seeded database, because the interesting part of this
 * migration is the backfill: it read a regular expression over names that
 * already existed and wrote the answer into a column. A unit test would prove
 * the column exists; only this proves the interpretation landed on the right
 * rows.
 */

const TEMPLATE_KEYS = new Set(ROLE_TEMPLATES.map((t) => t.key))

/**
 * Every claim here is about the seeded institution, and scoping is not
 * decoration.
 *
 * This file runs inside `test:isolation`, alongside tests that legitimately
 * create bare `Role` rows to prove other properties — including presidents,
 * created without a template and therefore carrying the column default. A
 * global "every president holds the lead bundle" is false the moment one of
 * them runs first, and the failure names this migration rather than the test
 * that made the row. The same mistake cost a red build on GE-050-002.
 */
const SEEDED = { organization: { institution: { slug: "rochester" } } } as const

describe("every seat says what it carries", () => {
  it("has a template key on every row", async () => {
    const total = await runUnscoped("migration", "count", () => db.role.count({ where: SEEDED }))
    expect(total).toBeGreaterThan(50)

    // `templateKey` is NOT NULL, so an empty string is the only way a row can
    // carry nothing while satisfying the schema.
    const blank = await runUnscoped("migration", "blank", () =>
      db.role.count({ where: { ...SEEDED, templateKey: "" } }),
    )
    expect(blank).toBe(0)
  })

  it("uses only templates the platform ships", async () => {
    // A key nobody recognises confers nothing, which fails closed and is
    // therefore invisible: the seat simply stops working and nobody is told.
    const distinct = await runUnscoped("migration", "distinct", () =>
      db.role.findMany({ where: SEEDED, distinct: ["templateKey"], select: { templateKey: true } }),
    )
    const unknown = distinct.map((r) => r.templateKey).filter((k) => !TEMPLATE_KEYS.has(k))
    expect(unknown).toEqual([])
  })

  it("gives every president the lead bundle", async () => {
    const wrong = await runUnscoped("migration", "presidents", () =>
      db.role.findMany({
        where: { ...SEEDED, scope: "PRESIDENT", NOT: { templateKey: "unit.lead" } },
        select: { name: true, templateKey: true },
      }),
    )
    expect(wrong).toEqual([])
  })

  it("gives the seeded finance seats the finance bundle", async () => {
    // The backfill's whole job. These are the rows the old regex matched, and
    // they must keep the authority they had — a migration that silently removed
    // spending authority from every treasurer would be a worse defect than the
    // one it fixed.
    const finance = await runUnscoped("migration", "finance", () =>
      db.role.findMany({
        where: {
          ...SEEDED,
          scope: { not: "PRESIDENT" },
          OR: [
            { name: { contains: "Financ", mode: "insensitive" } },
            { name: { contains: "Treasur", mode: "insensitive" } },
          ],
        },
        select: { name: true, templateKey: true },
      }),
    )
    expect(finance.length).toBeGreaterThan(0)
    expect(finance.filter((r) => r.templateKey !== "finance.officer")).toEqual([])
  })

  it("gives an ordinary seat the smallest bundle", async () => {
    const member = await runUnscoped("migration", "member", () =>
      db.role.findFirst({ where: { ...SEEDED, name: "Member" }, select: { templateKey: true } }),
    )
    expect(member?.templateKey).toBe("unit.member")
  })

  it("hands the seat's bundle to every permission check", async () => {
    // The column is only worth having if the thing that reads permissions can
    // see it. `getUserContext` is where every check in the application resolves
    // its seats, and a mapping that dropped the field would leave every seat
    // looking like an ordinary member — failing closed, silently, everywhere.
    const holder = await runUnscoped("migration", "holder", () =>
      db.roleAssignment.findFirst({
        where: { role: { ...SEEDED, templateKey: "finance.officer" }, status: "ACTIVE" },
        select: { userId: true, role: { select: { id: true } } },
      }),
    )
    expect(holder).not.toBeNull()

    const ctx = await getUserContext(holder!.userId)
    const seat = ctx.orgRoles.find((r) => r.roleId === holder!.role.id)
    expect(seat?.templateKey).toBe("finance.officer")
  })

  it("refuses a row that carries nothing", async () => {
    // NOT NULL, not merely a default. A default fills in a column somebody
    // omitted; it does nothing about a caller that writes NULL on purpose, and
    // "no seat carries nothing" is the guarantee every check below rests on.
    const org = await runUnscoped("migration", "org", () =>
      db.organization.findFirstOrThrow({ where: { institution: { slug: "rochester" } }, select: { id: true } }),
    )
    const name = `GE-051-005 null probe ${Date.now()}`
    await expect(
      runUnscoped("migration", "insert-null", () =>
        db.$executeRaw`INSERT INTO "Role" ("id", "organizationId", "name", "scope", "templateKey", "updatedAt") VALUES (${`nullprobe-${Date.now()}`}, ${org.id}, ${name}, 'FUNCTIONAL', NULL, NOW())`,
      ),
    ).rejects.toThrow()
    const leaked = await runUnscoped("migration", "check", () =>
      db.role.count({ where: { name } }),
    )
    expect(leaked).toBe(0)
  })

  it("defaults a seat created without one to the smallest bundle", async () => {
    // A path that has not been taught about templates confers the least, not
    // the most. Proven against the database default rather than the Prisma
    // client's, because a raw INSERT is what a migration or a script does.
    const org = await runUnscoped("migration", "org", () =>
      db.organization.findFirstOrThrow({ where: { institution: { slug: "rochester" } }, select: { id: true } }),
    )
    const name = `GE-051-005 default probe ${Date.now()}`
    try {
      await runUnscoped("migration", "insert", () =>
        db.$executeRaw`INSERT INTO "Role" ("id", "organizationId", "name", "scope", "updatedAt") VALUES (${`probe-${Date.now()}`}, ${org.id}, ${name}, 'FUNCTIONAL', NOW())`,
      )
      const created = await runUnscoped("migration", "read", () =>
        db.role.findFirstOrThrow({ where: { name }, select: { templateKey: true } }),
      )
      expect(created.templateKey).toBe("unit.member")
    } finally {
      await runUnscoped("migration", "cleanup", () => db.role.deleteMany({ where: { name } }))
    }
  })
})

/**
 * The backfill, tested by running the migration's own statements.
 *
 * The tests above pass on a seeded database whether or not the backfill works,
 * because `seed.mjs` upserts every seat afterwards and writes the column
 * itself — so they measure the seed. A mutation dropping the backfill survived
 * them, which is how this gap was found.
 *
 * These scramble the column on real rows and replay the UPDATE statements read
 * out of the migration file. That is the SQL that ran against the pilot's data,
 * exercised against rows whose names were written by a real roster.
 */
describe("the backfill interprets existing seats correctly", () => {
  const migration = path.join(
    process.cwd(),
    "prisma/migrations/20260803160000_seat_carries_a_role_template/migration.sql",
  )

  /** The UPDATE statements, in file order. Nothing else is replayed. */
  function backfillStatements(): string[] {
    const sql = fs.readFileSync(migration, "utf8")
    return sql
      .split(";")
      // Splitting on `;` leaves each statement wearing the comment block that
      // precedes it, so the leading `--` lines come off before the shape of the
      // statement can be read.
      .map((chunk) =>
        chunk
          .split(String.fromCharCode(10))
          .filter((line) => !line.trim().startsWith("--"))
          .join(String.fromCharCode(10))
          .trim(),
      )
      .filter((chunk) => chunk.toUpperCase().startsWith("UPDATE "))
  }

  it("reads the statements out of the migration that shipped", () => {
    // Otherwise this replays nothing and passes.
    const statements = backfillStatements()
    expect(statements.length).toBe(3)
    expect(statements.join(" ")).toContain("finance.officer")
  })

  it("puts every seat back where the migration would", async () => {
    // Two reads, and the difference matters. The replay below runs the
    // migration's statements exactly as written, which means globally — so
    // everything it touches has to be put back, including rows other isolation
    // tests created. The assertions stay on the seeded rows, because those are
    // the ones whose names a real roster wrote.
    const everything = await runUnscoped("migration", "all", () =>
      db.role.findMany({ select: { id: true, templateKey: true } }),
    )
    const before = await runUnscoped("migration", "before", () =>
      db.role.findMany({ where: SEEDED, select: { id: true, name: true, scope: true, templateKey: true } }),
    )
    expect(before.length).toBeGreaterThan(50)

    try {
      // Reproduce the state the migration actually started from: the column
      // freshly added and empty. Scrambling to some other value looks like the
      // same thing and is not — the last statement keys off `IS NULL`, so a
      // scrambled row is one the backfill was never written to touch, and the
      // test would report the migration wrong for a state it never sees.
      await runUnscoped("migration", "unconstrain", () =>
        db.$executeRawUnsafe(`ALTER TABLE "Role" ALTER COLUMN "templateKey" DROP NOT NULL`),
      )
      await runUnscoped("migration", "empty", () =>
        db.$executeRawUnsafe(`UPDATE "Role" SET "templateKey" = NULL`),
      )
      for (const statement of backfillStatements()) {
        await runUnscoped("migration", "replay", () => db.$executeRawUnsafe(statement))
      }

      const after = await runUnscoped("migration", "after", () =>
        db.role.findMany({ where: SEEDED, select: { id: true, templateKey: true } }),
      )
      const byId = new Map(after.map((r) => [r.id, r.templateKey]))

      const financeNames = /financ|treasur|cfo|chief operating|coo/i
      const wrong = before.filter((row) => {
        const expected =
          row.scope === "PRESIDENT"
            ? "unit.lead"
            : financeNames.test(row.name)
              ? "finance.officer"
              : "unit.member"
        return byId.get(row.id) !== expected
      })
      expect(wrong.map((r) => `${r.name} -> ${byId.get(r.id)}`)).toEqual([])

      // And it actually moved rows into each bundle, or "correct" would be
      // satisfied by a scramble that happened to match.
      const counts = new Map<string, number>()
      for (const key of byId.values()) counts.set(key, (counts.get(key) ?? 0) + 1)
      expect(counts.get("unit.lead") ?? 0).toBeGreaterThan(0)
      expect(counts.get("finance.officer") ?? 0).toBeGreaterThan(0)
      expect(counts.get("unit.member") ?? 0).toBeGreaterThan(0)
    } finally {
      for (const row of everything) {
        await runUnscoped("migration", "restore", () =>
          db.role.update({ where: { id: row.id }, data: { templateKey: row.templateKey } }),
        )
      }
      await runUnscoped("migration", "reconstrain", () =>
        db.$executeRawUnsafe(`ALTER TABLE "Role" ALTER COLUMN "templateKey" SET NOT NULL`),
      )
    }
  })
})
