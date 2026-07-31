-- Pilot census — read-only. Run BEFORE the first tenant migration (ADR-0004, M0).
--
--   psql "$DATABASE_URL" -f scripts/pilot-census.sql
--
-- Every row count in ADR-0004 came from a locally seeded database. The pilot was
-- shaped by `prisma db push --accept-data-loss` over months and has never been
-- measured. One mismatched row turns M1 from a metadata change into a data
-- repair, and one dangling pointer turns M7 into an aborted migration and a
-- P3009 boot lock.
--
-- Two rules this file obeys, because an earlier draft broke both:
--
--   * Never report a failure count without its denominator. "0 mismatches" and
--     "0 rows examined" are the same output, and only one of them is good news.
--   * Never use a statistics estimate where a count is meant. n_live_tup is
--     zeroed by a crash, a major-version upgrade, and a restore from snapshot or
--     PITR — which is exactly how you would stage or recover this database. It
--     would report an empty pilot and read as "nothing to back-fill".

\pset footer off
\timing off

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (0) HOW MANY TENANTS?  Everything below is uninterpretable until'
\echo '     you have read this. Expected: 1.'
\echo '════════════════════════════════════════════════════════════════════'
-- Load-bearing far beyond this file. Several backfills in the plan are written
-- `WHERE (SELECT count(*) FROM "Institution") = 1`, which silently no-ops at 2+
-- and leaves every row quarantined at NULL; one expand trigger uses SELECT ...
-- INTO STRICT and raises TOO_MANY_ROWS instead. And with 2+ tenants, a clean
-- result below stops being arithmetically guaranteed and becomes actual
-- evidence — the same numbers, a completely different claim.
SELECT count(*) AS institutions,
       array_agg(id || '  /  ' || slug ORDER BY id) AS rows
FROM "Institution";

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (1) EXACT ROW COUNTS.  Lock duration is a function of these, and'
\echo '     the plan calls M1-M7 "brief" on the strength of them.'
\echo '════════════════════════════════════════════════════════════════════'
-- count(*) per table via query_to_xml, not n_live_tup. Exact, one statement,
-- and cheap at this size. n_live_tup alongside it purely as a staleness signal:
-- where the two disagree, the planner is working from stale statistics and the
-- plan's index arguments were made against numbers the database no longer has.
SELECT c.relname AS "table",
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint AS exact_rows,
       s.n_live_tup AS estimate,
       CASE WHEN s.n_live_tup IS NULL THEN 'no stats'
            WHEN s.n_live_tup = 0 AND c.reltuples = -1 THEN 'never analyzed'
            ELSE '' END AS note,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname <> '_prisma_migrations'
ORDER BY 2 DESC, 1;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (2) DO THE 8 BARE institutionId COLUMNS AGREE WITH THEIR ORG?'
\echo '     Expected: 0 disagreeing, 0 unresolvable — each with a non-zero'
\echo '     denominator, or the zero means nothing.'
\echo '════════════════════════════════════════════════════════════════════'
-- LEFT JOIN, not INNER: an INNER JOIN silently discards a row whose
-- organizationId resolves to nothing, which is one of the two failures worth
-- finding. IS DISTINCT FROM, not <>: <> yields NULL rather than TRUE when
-- either side is NULL, so a NULL institutionId would not be counted as a
-- disagreement — it would vanish.
-- One aggregate per model rather than a GROUP BY over a union. A GROUP BY emits
-- no row at all for an empty table, so a model with zero rows would silently
-- disappear from this report and read as "not a problem" — which is the same
-- output as "checked, and clean". An ungrouped aggregate always returns exactly
-- one row, so an empty model shows up as `rows_examined = 0` and declares
-- itself unmeasured. (Found by running this against a database where six of the
-- seven were empty and only Document appeared.)
SELECT 'ApprovalRequest' AS model, count(*) AS rows_examined,
       count(*) FILTER (WHERE x."institutionId" IS NULL) AS null_institution,
       count(*) FILTER (WHERE o.id IS NULL) AS unresolvable_org,
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId") AS disagrees
  FROM "ApprovalRequest" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'Event', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "Event" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'Conversation', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE x."organizationId" IS NOT NULL AND o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "Conversation" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'Document', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "Document" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'MemoryRecord', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "MemoryRecord" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'Budget', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "Budget" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'FeedPost', count(*), count(*) FILTER (WHERE x."institutionId" IS NULL),
       count(*) FILTER (WHERE o.id IS NULL),
       count(*) FILTER (WHERE o.id IS NOT NULL AND x."institutionId" IS DISTINCT FROM o."institutionId")
  FROM "FeedPost" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
ORDER BY 1;

-- Vendor has no organizationId, so it cannot be cross-checked the same way.
-- Reported separately rather than silently omitted from the table above.
SELECT 'Vendor' AS model, count(*) AS rows_examined,
       count(*) FILTER (WHERE "institutionId" IS NULL) AS null_institution,
       'no organizationId — not cross-checkable' AS note
FROM "Vendor";

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (3) CAN EVERY CHILD REACH A TENANT?  These are the backfill parent'
\echo '     links. A child whose parent is missing does not error during'
\echo '     the backfill — it stays NULL and is quarantined.'
\echo '════════════════════════════════════════════════════════════════════'
SELECT 'Role -> Organization' AS link, count(*) AS rows_examined,
       count(*) FILTER (WHERE o.id IS NULL) AS unreachable
  FROM "Role" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'RoleAssignment -> Role', count(*), count(*) FILTER (WHERE r.id IS NULL)
  FROM "RoleAssignment" x LEFT JOIN "Role" r ON r.id = x."roleId"
UNION ALL
SELECT 'SeatHolding -> Role', count(*), count(*) FILTER (WHERE r.id IS NULL)
  FROM "SeatHolding" x LEFT JOIN "Role" r ON r.id = x."roleId"
UNION ALL
SELECT 'ApprovalStep -> ApprovalRequest', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "ApprovalStep" x LEFT JOIN "ApprovalRequest" p ON p.id = x."approvalId"
UNION ALL
SELECT 'Message -> Conversation', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Message" x LEFT JOIN "Conversation" p ON p.id = x."conversationId"
UNION ALL
SELECT 'Participant -> Conversation', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Participant" x LEFT JOIN "Conversation" p ON p.id = x."conversationId"
UNION ALL
SELECT 'Attachment -> Message', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Attachment" x LEFT JOIN "Message" p ON p.id = x."messageId"
UNION ALL
SELECT 'BudgetLine -> Organization', count(*), count(*) FILTER (WHERE o.id IS NULL)
  FROM "BudgetLine" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'LedgerEntry -> Organization', count(*), count(*) FILTER (WHERE o.id IS NULL)
  FROM "LedgerEntry" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'OrganizationAdvisor -> Organization', count(*), count(*) FILTER (WHERE o.id IS NULL)
  FROM "OrganizationAdvisor" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'CollabInterest -> Organization', count(*), count(*) FILTER (WHERE o.id IS NULL)
  FROM "CollabInterest" x LEFT JOIN "Organization" o ON o.id = x."organizationId"
UNION ALL
SELECT 'FeedComment -> FeedPost', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "FeedComment" x LEFT JOIN "FeedPost" p ON p.id = x."postId"
UNION ALL
SELECT 'DeliverableReminder -> Deliverable', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "DeliverableReminder" x LEFT JOIN "Deliverable" p ON p.id = x."deliverableId"
ORDER BY 1;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (4) DANGLING POINTERS.  Nine *Id columns have never had a foreign'
\echo '     key. M7 adds them, and ADD CONSTRAINT validates the whole table'
\echo '     at add time — one dangling value raises 23503, aborts the'
\echo '     migration, and lands in a P3009 boot lock. Expected: 0.'
\echo '════════════════════════════════════════════════════════════════════'
-- This is the population most likely to hold garbage precisely because nothing
-- has ever enforced it. Every other pointer in the schema has had an FK all
-- along, so (2) and (3) above check the rows that cannot be broken while this
-- checks the ones that can.
SELECT 'AuditEvent.organizationId' AS pointer, count(*) AS rows_set,
       count(*) FILTER (WHERE p.id IS NULL) AS dangling
  FROM "AuditEvent" x LEFT JOIN "Organization" p ON p.id = x."organizationId"
 WHERE x."organizationId" IS NOT NULL
UNION ALL
SELECT 'Event.ownerRoleId', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Event" x LEFT JOIN "Role" p ON p.id = x."ownerRoleId"
 WHERE x."ownerRoleId" IS NOT NULL
UNION ALL
SELECT 'ConflictRecord.conflictWithEventId', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "ConflictRecord" x LEFT JOIN "Event" p ON p.id = x."conflictWithEventId"
 WHERE x."conflictWithEventId" IS NOT NULL
UNION ALL
SELECT 'Message.replyToId', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Message" x LEFT JOIN "Message" p ON p.id = x."replyToId"
 WHERE x."replyToId" IS NOT NULL
UNION ALL
SELECT 'Participant.lastReadMessageId', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Participant" x LEFT JOIN "Message" p ON p.id = x."lastReadMessageId"
 WHERE x."lastReadMessageId" IS NOT NULL
UNION ALL
SELECT 'Transaction.approvalId', count(*), count(*) FILTER (WHERE p.id IS NULL)
  FROM "Transaction" x LEFT JOIN "ApprovalRequest" p ON p.id = x."approvalId"
 WHERE x."approvalId" IS NOT NULL
ORDER BY 1;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (5) COLLISION PRESSURE ON THE FIVE GLOBAL UNIQUES.  A composite is'
\echo '     safe to add only if the composite is already unique.'
\echo '════════════════════════════════════════════════════════════════════'
SELECT 'Organization.slug' AS constraint_, count(*) AS rows,
       count(DISTINCT slug) AS distinct_, count(*) FILTER (WHERE slug IS NULL) AS nulls
  FROM "Organization"
UNION ALL
SELECT 'Role.positionCode', count(*), count(DISTINCT "positionCode"),
       count(*) FILTER (WHERE "positionCode" IS NULL) FROM "Role"
UNION ALL
SELECT 'Deliverable.key', count(*), count(DISTINCT key),
       count(*) FILTER (WHERE key IS NULL) FROM "Deliverable"
UNION ALL
SELECT 'DirectoryPerson.email', count(*), count(DISTINCT email),
       count(*) FILTER (WHERE email IS NULL) FROM "DirectoryPerson"
UNION ALL
SELECT 'ApprovalRequest.idempotencyKey', count(*), count(DISTINCT "idempotencyKey"),
       count(*) FILTER (WHERE "idempotencyKey" IS NULL) FROM "ApprovalRequest"
ORDER BY 1;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (6) PEOPLE WHO REACH MORE THAN ONE TENANT.  Blocks product'
\echo '     decision B. Meaningful only if (0) reported more than 1 —'
\echo '     under a single tenant this is 0 by arithmetic, not by evidence.'
\echo '════════════════════════════════════════════════════════════════════'
WITH reach AS (
  SELECT dp.id, o."institutionId" AS inst
    FROM "DirectoryPerson" dp
    JOIN "SeatHolding" sh ON sh."personId" = dp.id
    JOIN "Role" r ON r.id = sh."roleId"
    JOIN "Organization" o ON o.id = r."organizationId"
  UNION
  SELECT dp.id, o."institutionId"
    FROM "DirectoryPerson" dp
    JOIN "OrganizationAdvisor" oa ON oa."personId" = dp.id
    JOIN "Organization" o ON o.id = oa."organizationId"
)
SELECT (SELECT count(*) FROM "DirectoryPerson")                   AS people_total,
       count(DISTINCT id)                                          AS people_reaching_a_tenant,
       (SELECT count(*) FROM "DirectoryPerson")
         - count(DISTINCT id)                                      AS people_reaching_none,
       count(*) FILTER (WHERE n > 1)                               AS people_reaching_several
FROM (SELECT id, count(DISTINCT inst) AS n FROM reach GROUP BY id) per_person;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' (7) SCHEMA OBJECTS THE MIGRATIONS NAME BY STRING.  A rename that'
\echo '     drifted makes a DROP CONSTRAINT fail mid-migration.'
\echo '════════════════════════════════════════════════════════════════════'
SELECT conrelid::regclass::text AS "table", conname AS constraint_, contype AS type
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND contype IN ('f', 'u')
  AND conrelid::regclass::text IN
      ('"Organization"','"Role"','"Deliverable"','"DirectoryPerson"','"ApprovalRequest"',
       '"Event"','"Conversation"','"Document"','"MemoryRecord"','"Budget"','"Vendor"','"FeedPost"')
ORDER BY 1, 3, 2;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' Census complete.  Before reading any zero above as good news, check'
\echo ' that (0) said 1 and that every "rows_examined" is non-zero.'
\echo ' Separately, run this from the same in-VPC task and require it empty:'
\echo '   npx prisma migrate diff --from-url "$DATABASE_URL" \'
\echo '     --to-schema-datamodel prisma/schema.prisma --exit-code'
\echo ' Without it, every zero above is a claim about a schema nobody checked.'
\echo '════════════════════════════════════════════════════════════════════'
