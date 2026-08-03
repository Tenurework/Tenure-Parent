/**
 * Pilot census — read-only. Run BEFORE the first tenant migration (ADR-0004, M0).
 *
 *   node scripts/census.mjs                    # locally, against DATABASE_URL
 *   Actions -> "Database census"               # against the pilot, inside the VPC
 *
 * A Node implementation rather than a .sql file because of where it has to run.
 * RDS is reachable only inside the VPC, the only thing that runs in there is the
 * task, and the task image has Node and the Prisma CLI but no psql. A census
 * that cannot be run against the database it was written to measure is not a
 * census. `scripts/pilot-census.sql` is the same queries for anyone who does
 * have psql; this is the one that runs on the pilot.
 *
 * Two rules it obeys, because an earlier draft broke both:
 *
 *   * Never report a failure count without its denominator. "0 mismatches" and
 *     "0 rows examined" are the same output, and only one is good news.
 *   * Never omit what was not measured. An empty table must say so about
 *     itself rather than vanishing from the report, which reads as "clean".
 */

import { PrismaClient } from "@prisma/client"
import { reachSummary } from "./person-reach.mjs"

const db = new PrismaClient({ log: ["error"] })

const problems = []
const note = (s) => problems.push(s)

const h = (title, why) => {
  console.log(`\n${"═".repeat(72)}`)
  console.log(` ${title}`)
  if (why) for (const line of why.split("\n")) console.log(` ${line}`)
  console.log("═".repeat(72))
}

/** Print rows as an aligned table, or say plainly that there were none. */
const table = (rows) => {
  if (!rows.length) return console.log("  (no rows)")
  const cols = Object.keys(rows[0])
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)))
  console.log("  " + cols.map((c, i) => c.padEnd(w[i])).join("  "))
  console.log("  " + w.map((n) => "─".repeat(n)).join("  "))
  for (const r of rows) console.log("  " + cols.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join("  "))
}

// ── (0) ──────────────────────────────────────────────────────────────────────
h(
  "(0) HOW MANY TENANTS?",
  "Everything below is uninterpretable until you have read this.\n" +
    "Several backfills branch on there being exactly one; at 2+ they either\n" +
    "no-op silently or raise. With 2+, a clean result below also stops being\n" +
    "arithmetically guaranteed and becomes actual evidence.",
)
const institutions = await db.$queryRaw`SELECT id, slug FROM "Institution" ORDER BY id`
table(institutions)
console.log(`\n  institutions: ${institutions.length}`)
if (institutions.length !== 1) {
  note(`${institutions.length} institutions — every "0" below is evidence, not arithmetic`)
}

// ── (1) ──────────────────────────────────────────────────────────────────────
h(
  "(1) EXACT ROW COUNTS",
  "Counted, not estimated. n_live_tup is zeroed by a crash, a major-version\n" +
    "upgrade, and a restore from snapshot or PITR — which is how this database\n" +
    "would be staged or recovered. It would report an empty pilot.",
)
const counts = await db.$queryRaw`
  SELECT c.relname AS "table",
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                             false, true, '')))[1]::text::bigint AS exact_rows,
         COALESCE(s.n_live_tup, 0) AS estimate,
         pg_size_pretty(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname <> '_prisma_migrations'
  ORDER BY 2 DESC, 1`
table(counts.map((r) => ({ ...r, exact_rows: Number(r.exact_rows), estimate: Number(r.estimate) })))

const stale = counts.filter((r) => Number(r.exact_rows) > 0 && Number(r.estimate) === 0)
if (stale.length) {
  note(`${stale.length} table(s) hold rows but report an estimate of 0 — statistics were reset`)
}

// ── (2) ──────────────────────────────────────────────────────────────────────
h(
  "(2) DO THE BARE institutionId COLUMNS AGREE WITH THEIR ORG?",
  "LEFT JOIN so an unresolvable org is counted rather than discarded, and\n" +
    "IS DISTINCT FROM so a NULL counts as a disagreement instead of vanishing.\n" +
    "One aggregate per model: GROUP BY would drop an empty model entirely.",
)
const agreement = await db.$queryRaw`
  SELECT 'ApprovalRequest' AS model, count(*) AS rows_examined,
         count(*) FILTER (WHERE x."institutionId" IS NULL) AS null_inst,
         count(*) FILTER (WHERE o.id IS NULL) AS unresolvable_org,
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId") AS disagrees
    FROM "ApprovalRequest" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'Event', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "Event" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'Conversation', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE x."organizationId" IS NOT NULL AND o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "Conversation" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'Document', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "Document" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'MemoryRecord', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "MemoryRecord" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'Budget', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "Budget" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'FeedPost', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
         count(*) FILTER (WHERE o.id IS NULL),
         count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
    FROM "FeedPost" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
  UNION ALL SELECT 'Vendor (no org link)', count(*), count(*) FILTER (WHERE "institutionId" IS NULL), 0, 0
    FROM "Vendor"
  ORDER BY 1`
table(agreement.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))))

for (const r of agreement) {
  if (Number(r.disagrees) > 0) note(`${r.model}: ${r.disagrees} row(s) disagree with their organization — M1 is a repair, not metadata`)
  if (Number(r.unresolvable_org) > 0) note(`${r.model}: ${r.unresolvable_org} row(s) point at no organization`)
  if (Number(r.null_inst) > 0) note(`${r.model}: ${r.null_inst} row(s) have a NULL institutionId`)
}

// ── (3) ──────────────────────────────────────────────────────────────────────
h(
  "(3) DANGLING POINTERS",
  "The columns that never had a foreign key — the only population that CAN\n" +
    "hold garbage, because nothing has ever enforced it. M7 adds the\n" +
    "constraints, and ADD CONSTRAINT validates the whole table at add time:\n" +
    "one dangling value raises 23503, aborts the migration, and locks boot.",
)
const pointers = await db.$queryRaw`
  SELECT 'AuditEvent.organizationId' AS pointer, count(*) AS rows_set,
         count(*) FILTER (WHERE p.id IS NULL) AS dangling
    FROM "AuditEvent" x LEFT JOIN "Organization" p ON p.id = x."organizationId"
   WHERE x."organizationId" IS NOT NULL
  UNION ALL SELECT 'Event.ownerRoleId', count(*), count(*) FILTER (WHERE p.id IS NULL)
    FROM "Event" x LEFT JOIN "Role" p ON p.id = x."ownerRoleId" WHERE x."ownerRoleId" IS NOT NULL
  UNION ALL SELECT 'ConflictRecord.conflictWithEventId', count(*), count(*) FILTER (WHERE p.id IS NULL)
    FROM "ConflictRecord" x LEFT JOIN "Event" p ON p.id = x."conflictWithEventId" WHERE x."conflictWithEventId" IS NOT NULL
  UNION ALL SELECT 'Message.replyToId', count(*), count(*) FILTER (WHERE p.id IS NULL)
    FROM "Message" x LEFT JOIN "Message" p ON p.id = x."replyToId" WHERE x."replyToId" IS NOT NULL
  UNION ALL SELECT 'Participant.lastReadMessageId', count(*), count(*) FILTER (WHERE p.id IS NULL)
    FROM "Participant" x LEFT JOIN "Message" p ON p.id = x."lastReadMessageId" WHERE x."lastReadMessageId" IS NOT NULL
  UNION ALL SELECT 'Transaction.approvalId', count(*), count(*) FILTER (WHERE p.id IS NULL)
    FROM "Transaction" x LEFT JOIN "ApprovalRequest" p ON p.id = x."approvalId" WHERE x."approvalId" IS NOT NULL
  ORDER BY 1`
table(pointers.map((r) => ({ pointer: r.pointer, rows_set: Number(r.rows_set), dangling: Number(r.dangling) })))
for (const r of pointers) {
  if (Number(r.dangling) > 0) note(`${r.pointer}: ${r.dangling} dangling — M7 would abort here`)
}

// ── (4) ──────────────────────────────────────────────────────────────────────
h("(4) COLLISION PRESSURE ON THE FIVE GLOBAL UNIQUES", "A composite is safe to add only if it is already unique.")
const uniques = await db.$queryRaw`
  SELECT 'Organization.slug' AS constraint_, count(*) AS rows, count(DISTINCT slug) AS distinct_,
         count(*) FILTER (WHERE slug IS NULL) AS nulls FROM "Organization"
  UNION ALL SELECT 'Seat.positionCode', count(*), count(DISTINCT "positionCode"),
         count(*) FILTER (WHERE "positionCode" IS NULL) FROM "Seat"
  UNION ALL SELECT 'Deliverable.key', count(*), count(DISTINCT key),
         count(*) FILTER (WHERE key IS NULL) FROM "Deliverable"
  UNION ALL SELECT 'DirectoryPerson.email', count(*), count(DISTINCT email),
         count(*) FILTER (WHERE email IS NULL) FROM "DirectoryPerson"
  UNION ALL SELECT 'ApprovalRequest.idempotencyKey', count(*), count(DISTINCT "idempotencyKey"),
         count(*) FILTER (WHERE "idempotencyKey" IS NULL) FROM "ApprovalRequest"
  ORDER BY 1`
table(uniques.map((r) => ({
  constraint: r.constraint_, rows: Number(r.rows), distinct: Number(r.distinct_), nulls: Number(r.nulls),
})))

// ── (5) ──────────────────────────────────────────────────────────────────────
h(
  "(5) PEOPLE WHO REACH MORE THAN ONE TENANT",
  "Blocks product decision B. Meaningful only if (0) reported more than one —\n" +
    "under a single tenant this is 0 by arithmetic, not by evidence.\n" +
    "BOTH person tables, each with its own denominator (GE-020-005). This asked\n" +
    "only the DirectoryPerson graph until 2026-08-02, which is the graph the\n" +
    "application does not write: a user granted a second institution through the\n" +
    "admin UI reaches two tenants and did not appear here.",
)
for (const r of await reachSummary(db)) {
  console.log(`\n  ${r.identity}  (via ${r.paths.join(" + ")})`)
  table([
    {
      total: r.total,
      reaching_a_tenant: r.reachingATenant,
      reaching_none: r.reachingNone,
      reaching_several: r.reachingSeveral,
    },
  ])
  if (r.reachingNone > 0) note(`${r.reachingNone} ${r.identity} rows reach no tenant — they quarantine as NULL`)
  if (r.reachingSeveral > 0) {
    note(`${r.reachingSeveral} ${r.identity} rows reach several tenants — product decision B applies to real rows`)
    // The count, not the ids. This census runs against the pilot from a public
    // repository, and every other section of it is deliberately count-only —
    // a list of identifiers for real people in an archived, indexed build log
    // is a different kind of output from a number. `multiTenantPeople` in
    // person-reach.mjs returns them for an operator who already has database
    // access, which is the only place that list should exist.
    console.log(`\n  Which rows: multiTenantPeople(db, "${r.identity}") — run it where you can already read the data.`)
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(72)}`)
if (problems.length === 0) {
  console.log(" CENSUS CLEAN — M1 is metadata-only on this database.")
  console.log(" This says nothing about M7; that is section (3)'s job and it is also clean.")
} else {
  console.log(` CENSUS FOUND ${problems.length} THING(S) TO RESOLVE BEFORE M1:`)
  for (const p of problems) console.log(`   • ${p}`)
}
console.log("═".repeat(72))
console.log(
  "\nStill required, from this same task, and not covered above:\n" +
    "  npx prisma migrate diff --from-url \"$DATABASE_URL\" \\\n" +
    "    --to-schema-datamodel prisma/schema.prisma --exit-code\n" +
    "Without it every number above is a claim about a schema nobody checked.\n",
)

await db.$disconnect()
process.exit(problems.length ? 1 : 0)
