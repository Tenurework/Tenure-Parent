# Tenant-scoped schema — the full migration plan

Companion to `docs/decisions/ADR-0004-tenant-scoped-schema.md`, which records the
decision. This is the working plan behind it: every step's schema diff, migration
SQL, backfill, lock assessment, verification query and rollback.

It is kept whole rather than summarised because the load-bearing parts are the
specifics — which lock a statement takes, which order two deploys go in, which
predicate a verification query needs parenthesised. A summary of those is not
usable.

**Two steps are already done**, and were not when this was written:

- **M8** (open a tenant scope at every entry point) — landed in `beaa0fe`.
- **M10** (`TENANCY_ENFORCE=true`) — landed in `8d11204`.

M9 (persist the acting institution) remains open and is the KNOWN GAP named in
`src/lib/tenant-scope.ts`.

Read `## Product decisions required` first. Five decisions gate this work, and
three of them block specific steps.

---

## Context

There is one `Institution` row (`cms7xlavv0000nmr427o4dyon` / `rochester`), created by the only `institution` write in the repository — `apps/web/scripts/seed.mjs:29-36`, hardcoded to `slug: "rochester"`. Nothing else provisions a tenant. Four independent classes of defect make a second one impossible, unsafe, or invisible.

**1. Five uniques are global where they should be per-tenant.**

| Constraint | schema.prisma | Failure with tenant B |
|---|---|---|
| `Organization.slug @unique` | :~168 | `apps/web/src/lib/clubs.ts:85` rejects B's club because A used the name — a wrong error message, not a collision |
| `Role.positionCode @unique` | :~205 | `uniquePositionCode` (`clubs.ts:49-59`) renames B's genuine `CC-PRES` to `CC-PRES-2` |
| `Deliverable.key @unique` | :~238 | `seed.mjs:241-244` upserts on `key` alone; seeding B takes the **UPDATE** branch and rewrites A's 34 rows in place |
| `DirectoryPerson.email @unique` | :~270 | `admin/actions.ts:315-319` and `seed.mjs:90-94` upsert on `email`; B's admin silently overwrites A's person record |
| `ApprovalRequest.idempotencyKey @unique` | :~397 | dead column, zero call sites; latent |

**2. Nineteen models carry tenant-owned data with no tenant column** (`apps/web/src/lib/tenancy/registry.ts:74-98`). `decideScope` returns `pass-through` for every one of them (`apps/web/src/lib/tenancy/scope-args.ts:65-70`), regardless of the enforce flag. Concrete consequence today: `apps/web/src/app/api/jobs/reminders/route.ts:53` reads `db.roleAssignment.findMany` inside a per-institution scope and is *not* filtered, so the nightly job would notify B's officers about A's deadlines.

**3. Eight models carry `institutionId` as bare, unvalidated TEXT** — ApprovalRequest, Event, Conversation, Document, MemoryRecord, Budget, Vendor, FeedPost (`registry.ts:33-41`). There is no FK. Worse, the chokepoint actively manufactures divergence: `scope-args.ts:161` is `return { ...data, institutionId }`, which places the ambient scope's value **last**, overriding the `institutionId: org.institutionId` that every create site supplies (`approvals/actions.ts:104`, `calendar/actions.ts:55`, `documents/actions.ts:45`, `memory/actions.ts:39`, `feed/actions.ts:39`, `finance/actions.ts:34`, `messages/actions.ts:275`, `admin/actions.ts:67`). A request acting in A that touches an org in B writes `institutionId = A, organizationId → B`.

**4. Nine `*Id` columns have no foreign key at all** (verified against `information_schema`): `ConflictRecord.conflictWithEventId`, `Message.replyToId`, `Participant.lastReadMessageId`, `Transaction.approvalId`, `Event.ownerRoleId` (:443), `AuditEvent.organizationId` (:877), plus `CollabInterest.requestedById` / `.decidedById`. `AuditEvent` is append-only and tamper-evident, so a wrong cross-tenant reference there is permanent by design.

**What is *not* broken, contrary to earlier surveys:**

- A code path **does** create two institutions: `apps/web/src/lib/tenancy/isolation.itest.ts:52-53`. It works only because it gives them different slugs.
- An acting-tenant **mechanism exists**: `apps/web/src/lib/tenant-scope.ts:121-176` provides `resolveTenantScope(userId, institutionId?)` (validates a caller-supplied institution against membership), `withTenantScope`, `withSystemTenantScope`, `forEachInstitution`. The gap is narrower than "no mechanism": it is the persisted user *choice*, named in the KNOWN GAP block at `tenant-scope.ts:103-106` — today "the first candidate wins", via `rbac.ts:38 orderBy: [{ institutionId: "asc" }]` and `admin/guard.ts:21,:55`.
- `DirectoryPerson.reachableVia: "(none)"` understates reality. All 172 rows resolve through `SeatHolding → Role → Organization` ∪ `OrganizationAdvisor → Organization`, with 0 orphans locally. That is luck, not schema: `admin/actions.ts:315` creates unlinked rows.

**Two execution facts constrain every design choice below.**

*Prisma rejects a missing required scalar client-side.* Once `institutionId` is `String` (required), `XUncheckedCreateInput` demands it and `XCreateInput` (once relation-bound) omits it. In observe mode `decideScope` returns `pass-through` **unstamped** whenever no scope is open (`scope-args.ts:88-101`) or under any `runUnscoped` grant (`:89-93`). Only 7 `runInTenantScope`/`runUnscoped` references exist in `src/`, and all but one are inside `lib/tenancy/context.ts` and `lib/tenant-scope.ts` themselves — essentially no application call site opens a scope yet. A required column therefore breaks the **new** release at ~41 write sites, and no database trigger can rescue it, because Prisma never emits the INSERT.

*A failed migration is not a failed deploy — it is a permanent boot lock.* `apps/web/scripts/db-bootstrap.mjs:48-54` returns `steps: ["deploy"]` whenever `_prisma_migrations` exists; `:227-231` exits non-zero on failure; `apps/web/scripts/entrypoint.sh:7,30` runs it under `set -e` before `exec node server.js`. Postgres rolls the DDL back but leaves the ledger row with `finished_at NULL`, and Prisma 6.19.3 then returns **P3009** to every subsequent `migrate deploy` — from every image, new or old. The ECS circuit breaker's rollback target (`infrastructure/terraform/ecs.tf:281-284`) fails identically. With `deployment_minimum_healthy_percent = 100` and `desired_count = 1` the running task survives, so there is no alarm — the service simply becomes unable to replace a task, and `apps/web/src/app/api/health/route.ts:5-16` (which recycles the task when the DB is unreachable) then guarantees a zero-capacity outage. RDS is VPC-only (ADR-0001:107-109), so no GitHub Actions runner can run `prisma migrate resolve`. **There is no recovery path today.**

## Decision

### Mechanism rules

These are the load-bearing constraints; every step obeys them.

**R1 — Expand adds a NULLABLE column. Never `NOT NULL`, never a DEFAULT.** Forced by the Prisma client-side validation above. `SET NOT NULL` happens only in the contract phase, after enforcement is on. A DEFAULT is rejected because Prisma models column defaults and the CI drift gate (`.github/workflows/ci.yml:103-119`) would go red.

**R2 — No `RAISE EXCEPTION`, no conditional abort, inside any migration.** Backfills are total and unconditional; rows they cannot classify stay NULL and are quarantined. Every precondition runs as a preflight query (Step 0 / Step 10 gates) against the pilot **before** the deploy. Rationale: P3009.

**R3 — Migrations run from an in-VPC `RunTask` stage, not from container boot** (the deferred stage named in ADR-0001:110-113). Every migration file begins `SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '120s';`. `lock_timeout`, `statement_timeout` and `idle_in_transaction_session_timeout` are also set on the RDS parameter group. Rationale: Prisma wraps a migration file in one transaction, so the ACCESS EXCLUSIVE lock taken by the first statement on `Organization` is held until the last statement commits; lock *acquisition* is unbounded and queues all subsequent readers behind it; `entrypoint.sh:21` pins `connection_limit=5`, so five blocked requests exhaust the pool, `/api/health` 503s, and `alb.tf:30-33` kills the only task after ~90s.

**R4 — One table per migration file.** Nine brief exclusive locks on `Organization`, not one long one.

**R5 — Nothing is dropped until after `TENANCY_ENFORCE=true`.** Old uniques, old indexes and expand-window triggers are all additive-then-removed. In observe mode the emitted SQL carries no `institutionId` predicate, so a tenant-leading index cannot serve an equality-on-`organizationId` lookup; dropping the original would give strictly worse plans than today for the whole migration window.

**R6 — A composite FK only bites when both legs are NOT NULL.** Postgres FKs are MATCH SIMPLE: any NULL referencing column satisfies the constraint unconditionally. Composite FKs on denormalised models therefore land in the contract phase. This also means the composite FK added to `Conversation` in Step 1 enforces **nothing** for rows where `organizationId IS NULL` — i.e. `OSE_BROADCAST`, `SYSTEM` and `PRESIDENT_NETWORK` conversations, exactly the population ADR-0002:19-20 names as leaking. Stated, not claimed as covered.

**R7 — Every composite-FK target needs `@@unique([id, institutionId])`.** Written once here so the waves do not rediscover it: Organization, Deliverable, ApprovalRequest, Event, Conversation, Budget, FeedPost, **Document**, **Vendor**, **MemoryRecord**, **Message**, **Participant**, **BudgetLine**, **Role**, **DirectoryPerson**.

**R8 — Expand-window triggers are named `tenure_expand_*`** and derive `institutionId` from the parent on `BEFORE INSERT`. They are a correctness net for unscoped writers, not a NOT-NULL rescue. Prisma's Postgres describer has no concept of triggers, so the drift gate neither sees nor removes them. They are dropped in Step 11, **after** enforcement — dropping them earlier converts every unscoped writer from "silently recorded" to a hard 500 (10 of 20 API routes open no scope: `api/admin/directory`, `api/notifications`, `api/attachment/[id]`, `api/templates/budget`, `api/ai/draft`, `api/profile-image`, `api/documents/[id]`, and the search variants).

### Target schema

| Change | Constraint enforced |
|---|---|
| `@@unique([id, institutionId])` on the 15 models in R7 | FK target; no data constraint of its own |
| Composite FK `(organizationId, institutionId) → Organization(id, institutionId)` on the 8 bare-column models | A row cannot claim a tenant its organization does not belong to |
| `institutionId` on 18 models (17 UNENFORCEABLE minus NotificationPreference, plus Role and DirectoryPerson) | The query extension can filter and stamp them |
| `NotificationPreference` → `PLATFORM_GLOBAL` | A person's own delivery setting is not tenant data; adding a column buys no isolation |
| `@@unique([institutionId, slug/positionCode/key/email/idempotencyKey])` replacing five global uniques | Two tenants may hold the same name |
| `Notification(userId, institutionId) → InstitutionMembership(userId, institutionId)` | You may only notify a user who is a member of the acting tenant — the only real invariant available, since `User` is global |
| Composite FKs on the 16 denormalised models to their parents (contract phase) | Child and parent agree on tenant |
| Plain FKs on the 6 unconstrained pointers, with explicit `onDelete` | A pointer resolves to a row that exists |
| `[institutionId, …]` index added alongside every non-tenant-leading index on a scoped model | Under N tenants an index matches 1/N of the table, not 100% |

Registry counts, tracked because `registry.test.ts:92-99` asserts all four:

| After | TENANT_SCOPED | PLATFORM_GLOBAL | UNENFORCEABLE | schemaModels |
|---|---|---|---|---|
| today | 15 | 5 | 19 | 39 |
| M3 (Role) | 16 | 5 | 18 | 39 |
| M4b (DirectoryPerson) | 17 | 5 | 17 | 39 |
| M5a (wave A) | 19 | 6 | 14 | 39 |
| M5b (wave B) | 23 | 6 | 10 | 39 |
| M5c (wave C) | 29 | 6 | 4 | 39 |
| M5d (wave D) | **33** | **6** | **0** | **39** |

`registry.test.ts:36` matches on the field name alone (`/^\s*institutionId\s/m`) and cannot distinguish `String` from `String?`, so a model moves to `TENANT_SCOPED` the moment the nullable column lands. That is the intended forcing function; do not relax it. Consequence to accept: a NULL-`institutionId` row on a scoped model is invisible to every tenant — which is what quarantine means.

### Prisma input-type consequence

A generated client from a schema where `Message.institutionId` participates in a composite relation confirms:

```
MessageCreateInput          → institutionId ABSENT
MessageUncheckedCreateInput → institutionId REQUIRED
MessageCreateWithoutConversationInput → no institutionId at all (derived from parent)
```

`stampTenant` spreads `institutionId` onto `data` unconditionally, so a call site using the *checked* nested form would produce a payload matching neither variant. No call site does today — a repo-wide grep for `institution: { connect`, `organization: { connect`, `conversation: { connect` returns nothing; every site passes scalars. **This property is now load-bearing and gets a lint rule** forbidding `X: { connect: … }` in `data:` payloads on tenant-scoped models. Nested creates (`messages/actions.ts:355`) become strictly safer: they cannot name the wrong tenant.

## Migration sequence

### M0 — Vehicle and preflight. No schema change. Blocks everything.

Not optional and not deferrable: several later steps are unrecoverable without it.

1. Land the ADR-0001:110-113 `RunTask` migration stage. `db-bootstrap.mjs` stops running `migrate deploy` at container boot; boot verifies the schema is current and fails closed if not.
2. Teach `db-bootstrap.mjs` to detect P3009 specifically and print the named recovery step.
3. Build and **test** the in-VPC operator path (ECS exec or bastion) for `npx prisma migrate resolve --rolled-back <name>`.
4. `SET PRISMA_SCHEMA_ENGINE_LOCK_TIMEOUT` above the longest planned migration. The engine takes `pg_advisory_lock(72707369)` with a 10s default; `entrypoint.sh:41-47` and `.github/workflows/seed-reference-data.yml` run the same entrypoint as a one-off task, so a seed overlapping a deploy fails spuriously. Document that seed and deploy must not overlap.
5. `lock_timeout`, `statement_timeout`, `idle_in_transaction_session_timeout` on the RDS parameter group.
6. Raise `backup_retention_period` from 1 (`infrastructure/terraform/rds.tf:48`) or state in writing that recovery beyond 24h is impossible.
7. Add a minimum-image-tag guard to `.github/workflows/force-redeploy.yml`.

**Preflight census, run against the pilot RDS** — every row count in this ADR came from the local seeded DB; the pilot was shaped by `db push --accept-data-loss` (ADR-0001:13) and holds real roster and governance data.

```sql
-- (a) orphan institutionId on the 8 bare-column models
SELECT 'ApprovalRequest' t, count(*) n FROM "ApprovalRequest" x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'Event',        count(*) FROM "Event"        x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'Conversation', count(*) FROM "Conversation" x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'Document',     count(*) FROM "Document"     x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'MemoryRecord', count(*) FROM "MemoryRecord" x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'Budget',       count(*) FROM "Budget"       x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'Vendor',       count(*) FROM "Vendor"       x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL
UNION ALL SELECT 'FeedPost',     count(*) FROM "FeedPost"     x LEFT JOIN "Institution" i ON i.id=x."institutionId" WHERE i.id IS NULL;

-- (b) org/institution disagreement (INNER JOIN — see (c) for the blind spot)
SELECT 'ApprovalRequest' t, count(*) FROM "ApprovalRequest" x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'Event',        count(*) FROM "Event"        x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'Conversation', count(*) FROM "Conversation" x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'Document',     count(*) FROM "Document"     x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'MemoryRecord', count(*) FROM "MemoryRecord" x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'Budget',       count(*) FROM "Budget"       x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'Vendor',       count(*) FROM "Vendor"       x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId"
UNION ALL SELECT 'FeedPost',     count(*) FROM "FeedPost"     x JOIN "Organization" o ON o.id=x."organizationId" WHERE o."institutionId" <> x."institutionId";

-- (c) the population no composite FK will ever cover (R6). Know its size.
SELECT "institutionId", type, count(*) FROM "Conversation"
WHERE "organizationId" IS NULL GROUP BY 1,2 ORDER BY 3 DESC;

-- (d) DirectoryPerson resolvability — pairs, not bare ids
WITH pairs AS (
  SELECT sh."personId" AS person_id, o."institutionId" AS institution_id
    FROM "SeatHolding" sh JOIN "Role" r ON r.id=sh."roleId" JOIN "Organization" o ON o.id=r."organizationId"
  UNION
  SELECT oa."personId", o2."institutionId"
    FROM "OrganizationAdvisor" oa JOIN "Organization" o2 ON o2.id=oa."organizationId"
),
resolved AS (SELECT person_id, count(DISTINCT institution_id) AS n FROM pairs GROUP BY person_id)
SELECT count(*) AS total,
       count(*) FILTER (WHERE r.person_id IS NULL) AS unresolvable,
       count(*) FILTER (WHERE r.n > 1)             AS multi_institution
FROM "DirectoryPerson" dp LEFT JOIN resolved r ON r.person_id = dp.id;

-- (e) row-count and plan census for every table this programme touches
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```

Local results, for calibration only: 0 / 0 / (172 total, 0 unresolvable, 0 multi). 896 rows across all denormalisation targets. **A clean result proves the migration is safe, not that the invariant is enforced** — with one Institution a mismatch is arithmetically impossible.

**Rollback:** n/a.

---

### M1a–M1i — Tenant anchors. One migration file per child table.

**Schema diff**

```diff
 model Organization    { + @@unique([id, institutionId]) }
 model Deliverable     { + @@unique([id, institutionId]) }
 model ApprovalRequest { + @@unique([id, institutionId])
-  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
+  organization Organization @relation(fields: [organizationId, institutionId], references: [id, institutionId], onDelete: Cascade) }
 model Event           { …same… }
 model Document        { …same… + @@unique([id, institutionId]) }   // needed by M7 (LedgerEntry.documentId)
 model MemoryRecord    { …same… + @@unique([id, institutionId]) }
 model Budget          { …same… + @@unique([id, institutionId]) }
 model Vendor          { …same… + @@unique([id, institutionId]) }   // needed by M7 (LedgerEntry.vendorId)
 model FeedPost        { …same… + @@unique([id, institutionId]) }
 model Conversation    { + @@unique([id, institutionId])
-  organization Organization? @relation(fields: [organizationId], references: [id])
+  organization Organization? @relation(fields: [organizationId, institutionId], references: [id, institutionId], onDelete: Cascade)
+  institution  Institution   @relation(fields: [institutionId], references: [id], onDelete: Restrict) }
 model Institution     { + conversations Conversation[] }
```

**Migration SQL** (M1c shown; the other eight are identical modulo table name)

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

CREATE UNIQUE INDEX "Organization_id_institutionId_key" ON "Organization"("id","institutionId");   -- M1a only

ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_organizationId_fkey";
CREATE UNIQUE INDEX "ApprovalRequest_id_institutionId_key" ON "ApprovalRequest"("id","institutionId");
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_institutionId_fkey"
  FOREIGN KEY ("organizationId","institutionId") REFERENCES "Organization"("id","institutionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

M1e (Conversation) adds, in addition:

```sql
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`Restrict`, not `Cascade`. `Institution` is `PLATFORM_GLOBAL`, so `decideScope` (`scope-args.ts:61-63`) passes every `institution.delete` through with no guard whatsoever. A cascade would let one unguarded call destroy an institution's whole Conversation → Participant → Message → Attachment → Delivery tree, and `Attachment.objectKey` means the S3 objects survive with nothing pointing at them — unrecoverable per row. Offboarding belongs in M12's control plane, where the delete path is designed. Note that Institution deletion is **already** blocked by `AuditEvent_institutionId_fkey … ON DELETE RESTRICT` (`migration.sql:1010`); `isolation.itest.ts` teardown only succeeds because that test writes no AuditEvents.

The org leg moving from implicit `SetNull` to explicit `Cascade` is a real semantic change (today `migration.sql:926` is `ON DELETE SET NULL`, so a deleted club's board channel survives as an institution-level conversation). Prisma cannot emit `SetNull` for a composite relation with a required `institutionId` leg — it falls back to `RESTRICT`, which would make org deletion impossible and break the isolation test's teardown. The app never hard-deletes an Organization (`admin/actions.ts` sets `status: "ARCHIVED"`; the only `organization.delete*` calls are in `isolation.itest.ts:52,102,168`), so the practical effect is nil.

**Backfill:** none, subject to M0(b) returning zero.

**Locks / duration:** metadata-only plus one small index build and one FK validation per file. ACCESS EXCLUSIVE on the child and on `Organization` for the file's duration — seconds at pilot size, which is why R4 splits it. At scale: `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT` (ACCESS SHARE) in a separate file.

**Dual-shape:** no application change required. The previous release writes `organizationId` and `institutionId` from the same org row, so the composite FK is satisfied. No Prisma input types change on the checked path that anything uses.

**Verification**

```sql
SELECT conrelid::regclass::text AS tbl, conname, confdeltype
FROM pg_constraint
WHERE contype='f'
  AND (conname LIKE '%\_organizationId\_institutionId\_fkey' OR conname = 'Conversation_institutionId_fkey')
ORDER BY 1;                                   -- expect 9 rows (note the parentheses)

BEGIN;
  UPDATE "Document" SET "institutionId"='not-a-real-institution' WHERE id=(SELECT id FROM "Document" LIMIT 1);
  -- expect ERROR 23503 violates "Document_organizationId_institutionId_fkey"
ROLLBACK;
```

The second is the one that matters. Run it from a session with `idle_in_transaction_session_timeout` set, or an abandoned transaction blocks the next migration indefinitely.

**Rollback:** `DROP CONSTRAINT` ×9, `DROP INDEX` ×10, restore the eight single-column FKs from `migration.sql:911-989` (including Conversation's `ON DELETE SET NULL`), then `npx prisma migrate resolve --rolled-back 2026…_m1c_approvalrequest_anchor` for each file. No data changed.

---

### M2a–M2c — Expand three global uniques. Additive.

`Resource.@@unique([institutionId, key])` (schema.prisma:994, consumed at `seed.mjs:274`) is the same pattern already done right.

**Schema diff** — the single-column `@unique` is **kept**; both constraints coexist until M11.

```diff
 model Deliverable     { key            String  @unique     + @@unique([institutionId, key]) }
 model ApprovalRequest { idempotencyKey String? @unique     + @@unique([institutionId, idempotencyKey]) }
 model Organization    { slug           String  @unique     + @@unique([institutionId, slug]) }
```

**Migration SQL**

```sql
SET LOCAL lock_timeout = '3s';
CREATE UNIQUE INDEX "Deliverable_institutionId_key_key"                ON "Deliverable"("institutionId","key");
CREATE UNIQUE INDEX "ApprovalRequest_institutionId_idempotencyKey_key" ON "ApprovalRequest"("institutionId","idempotencyKey");
CREATE UNIQUE INDEX "Organization_institutionId_slug_key"              ON "Organization"("institutionId","slug");
```

**Backfill:** none. 34 Deliverables / 34 distinct keys; 14 ApprovalRequests all `idempotencyKey IS NULL` (btree does not collide NULLs); 29 Organizations / 29 distinct slugs.

**Locks / duration:** SHARE (writes blocked, reads allowed) on tables of ≤34 rows. `CONCURRENTLY` is unavailable by construction — Prisma wraps migrations in a transaction.

**Dual-shape:** with one Institution the two constraints are equivalent, so the previous release's global lookups all resolve. Start with M2b — zero call sites, zero non-NULL rows — as the cheapest possible proof that the expand shape and the drift gate agree. I verified that a schema carrying both `@unique` and `@@unique([institutionId, …])` validates and that `migrate diff` emits only the new index, so the gate is green at every intermediate commit.

**Verification**

```sql
SELECT count(*) FROM (SELECT "institutionId", key  FROM "Deliverable"  GROUP BY 1,2 HAVING count(*)>1) x;  -- 0
SELECT count(*) FROM (SELECT "institutionId", slug FROM "Organization" GROUP BY 1,2 HAVING count(*)>1) x;  -- 0
```

**Rollback:** `DROP INDEX` ×3 + `migrate resolve --rolled-back`. Free — the old constraints never left.

---

### M3 — `Role`: nullable `institutionId`, composite `positionCode`. The template.

250 rows. Seat codes derive from club initials (`clubs.ts:28-39`), so they collide constantly — which is why `uniquePositionCode` (`clubs.ts:49-59`) and the pre-nulling dance at `seed.mjs:143-156` exist. Across two tenants the workaround produces the wrong answer: B's genuine `CC-PRES` gets renamed `CC-PRES-2`.

**Schema diff**

```diff
 model Role {
+  institutionId  String?
   organizationId String
   organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)   // composite deferred to M11 (R6)
   positionCode   String?      @unique
+  @@unique([id, institutionId])
+  @@unique([institutionId, positionCode])
   @@unique([organizationId, name])
   @@index([organizationId, scope])          // kept (R5)
+  @@index([institutionId, organizationId, scope])
 }
```

`registry.ts`: `Role` → `TENANT_SCOPED`. `registry.test.ts`: 15 → 16, 19 → 18.

**Migration SQL**

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "Role" ADD COLUMN "institutionId" TEXT;
```

> Prisma generates `ADD COLUMN "institutionId" TEXT NOT NULL`, which fails on 250 rows *and* breaks every unscoped writer. Every denormalisation migration in this ADR is hand-edited to drop `NOT NULL`. The hand-edit still satisfies the drift gate because the datamodel declares `String?`.

**Backfill SQL** (unconditional, total, idempotent — R2)

```sql
UPDATE "Role" r
   SET "institutionId" = o."institutionId"
  FROM "Organization" o
 WHERE o.id = r."organizationId"
   AND r."institutionId" IS DISTINCT FROM o."institutionId";
```

**Trigger + indexes**

```sql
CREATE OR REPLACE FUNCTION tenure_expand_fill_from_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."institutionId" IS NULL THEN
    SELECT o."institutionId" INTO NEW."institutionId"
      FROM "Organization" o WHERE o.id = NEW."organizationId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tenure_expand_role BEFORE INSERT ON "Role"
  FOR EACH ROW EXECUTE FUNCTION tenure_expand_fill_from_organization();

CREATE INDEX        "Role_institutionId_organizationId_scope_idx" ON "Role"("institutionId","organizationId","scope");
CREATE UNIQUE INDEX "Role_id_institutionId_key"                   ON "Role"("id","institutionId");
CREATE UNIQUE INDEX "Role_institutionId_positionCode_key"         ON "Role"("institutionId","positionCode");
```

`BEFORE ROW` triggers fire before the `NOT NULL` check, which is why this same object still works unchanged when M11 makes the column required.

**Locks / duration:** 250-row UPDATE — ROW EXCLUSIVE on `Role`, ACCESS SHARE on `Organization`, ~1 ms. Three index builds on 250 rows. Under 50 ms total.

**Dual-shape:** previous release creates Roles without `institutionId` (`clubs.ts:100`, `admin/actions.ts:263`) — column is nullable, trigger fills it. New release: `Role` is `TENANT_SCOPED`, so the extension stamps creates *when a scope is open* and the trigger covers the rest. `positionCode` remains in `RoleWhereUniqueInput` until M11, but its semantics change now — see the application table.

**Verification**

```sql
SELECT count(*) FILTER (WHERE "institutionId" IS NULL) AS quarantined, count(*) AS total FROM "Role";  -- 0, 250
SELECT count(*) FROM "Role" r JOIN "Organization" o ON o.id=r."organizationId"
 WHERE o."institutionId" IS DISTINCT FROM r."institutionId";                                           -- 0
SELECT tgname FROM pg_trigger WHERE tgname='tenure_expand_role';                                       -- 1 row
```

**Rollback:** `DROP TRIGGER` + `DROP FUNCTION` + `DROP INDEX` ×3 + `ALTER TABLE "Role" DROP COLUMN "institutionId"` + `migrate resolve --rolled-back`. Loses nothing: `institutionId` here is a derived copy and `Organization.institutionId` remains the source of truth. **This property holds for every denormalisation in this ADR except DirectoryPerson.**

---

### M4a / M4b — `DirectoryPerson`. Two deploys; the order is load-bearing.

Requires **Product decision B**. 172 rows of real students' and advisors' contact details, 169 `@simon.rochester.edu`. Both write paths are upserts on the global email key (`admin/actions.ts:315-319`, `seed.mjs:90-94`), so B's admin adding an existing person silently rewrites A's row — name, kind, affiliation — with no error and no audit of the overwritten values. `requireCapability("directory.manage")` at `:309` checks that the actor may manage *a* directory, not *whose*.

#### M4a — code only, no schema change

`admin/actions.ts:315` creates a person linked to nothing, so a row added between authoring the backfill and running it is unresolvable. M4a stops that: `requireCapability("directory.manage", …)` at `:309` already resolves an `institutionId` and discards it — capture it, and refuse to create a person that will not be linked. Widen `DirectoryProvider` (`apps/web/src/lib/directory.ts:21-26`): `search(query, opts)` and `getByEmail(email)` both take an institution argument; the caller is `admin/actions.ts:43` (`upsertHolder`).

#### M4b — schema

**Schema diff**

```diff
 model DirectoryPerson {
+  institutionId String?
+  institution   Institution? @relation(fields: [institutionId], references: [id], onDelete: Restrict)
   email         String       @unique
+  @@unique([id, institutionId])
+  @@unique([institutionId, email])
   @@index([kind])
+  @@index([institutionId, kind])
 }
 model Institution { + directoryPeople DirectoryPerson[] }
```

`registry.ts`: `DirectoryPerson` → `TENANT_SCOPED` (16 → 17, 18 → 17).

**Migration SQL + backfill**

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "DirectoryPerson" ADD COLUMN "institutionId" TEXT;

WITH pairs AS (
  SELECT sh."personId" AS person_id, o."institutionId" AS institution_id
    FROM "SeatHolding" sh
    JOIN "Role" r          ON r.id  = sh."roleId"
    JOIN "Organization" o  ON o.id  = r."organizationId"
  UNION
  SELECT oa."personId", o2."institutionId"
    FROM "OrganizationAdvisor" oa
    JOIN "Organization" o2 ON o2.id = oa."organizationId"
),
resolved AS (
  SELECT person_id,
         min(institution_id)            AS institution_id,
         count(DISTINCT institution_id) AS n
  FROM pairs GROUP BY person_id
)
UPDATE "DirectoryPerson" dp
   SET "institutionId" = resolved.institution_id
  FROM resolved
 WHERE resolved.person_id = dp.id
   AND resolved.n = 1;                   -- <<< multi-institution people stay NULL, on purpose
```

`AND resolved.n = 1` is the whole correction. A person holding a seat at A and advising at B must **not** be silently stamped to whichever cuid sorts lower — `DirectoryPerson.institutionId` is the one column in this programme that is not a re-derivable copy, so a wrong value there is permanent, undetectable and blocks the later composite FK `SeatHolding(personId, institutionId) → DirectoryPerson(id, institutionId)` from validating. Unclassified rows quarantine as NULL, which makes them invisible to every tenant until an operator classifies them.

> **CORRECTION (2026-07-31) — this trigger breaks CI as written.**
>
> `INTO STRICT` raises `TOO_MANY_ROWS` on two or more institutions, and CI has
> had a deliberate second tenant since `c4328ca`
> (`apps/web/scripts/ci-two-tenant-fixture.mjs`). `seed.mjs` inserts
> `DirectoryPerson` rows without an `institutionId` while the column is still
> nullable, so this trigger would fire, find two rows, and `RAISE EXCEPTION` —
> failing the seed and every job downstream of it.
>
> The premise is also weaker than it reads. "This model genuinely has no
> parent" is true of the *schema*, not of the *data*: the census
> (`scripts/pilot-census.sql`, section 6) shows all 172 people reach exactly one
> institution through `SeatHolding → Role → Organization` or
> `OrganizationAdvisor → Organization`. The backfill below already uses that.
> Only a person with neither link has no parent, and locally there are none.
>
> So the fallback should not exist. A `DirectoryPerson` inserted with no
> institution and no seat has no honest tenant to guess at, and guessing is what
> produces a row whose `institutionId` and relations disagree — the defect this
> whole programme exists to remove. Leave it NULL and let the quarantine report
> it, exactly as R2 prescribes for every other unclassifiable row.

**Trigger** (superseded — see the correction above; kept for the reasoning about `INTO STRICT` vs `LIMIT 2`)

```sql
CREATE OR REPLACE FUNCTION tenure_expand_fill_single_institution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inst TEXT;
BEGIN
  IF NEW."institutionId" IS NULL THEN
    BEGIN
      SELECT id INTO STRICT inst FROM "Institution";
    EXCEPTION
      WHEN NO_DATA_FOUND  THEN RETURN NEW;                      -- empty DB (CI): leave NULL
      WHEN TOO_MANY_ROWS  THEN RAISE EXCEPTION
        'tenure: % insert with no institutionId and more than one Institution exists', TG_TABLE_NAME;
    END;
    NEW."institutionId" := inst;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tenure_expand_directoryperson BEFORE INSERT ON "DirectoryPerson"
  FOR EACH ROW EXECUTE FUNCTION tenure_expand_fill_single_institution();

CREATE INDEX        "DirectoryPerson_institutionId_kind_idx"  ON "DirectoryPerson"("institutionId","kind");
CREATE UNIQUE INDEX "DirectoryPerson_id_institutionId_key"    ON "DirectoryPerson"("id","institutionId");
CREATE UNIQUE INDEX "DirectoryPerson_institutionId_email_key" ON "DirectoryPerson"("institutionId","email");
```

`INTO STRICT` rather than `LIMIT 2` + a separate count: one query, raises on its own, and cannot assign before checking.

**Locks / duration:** the CTE joins 259 SeatHoldings and 50 advisors, updates ≤172 rows. Low single-digit ms.

**Dual-shape:** previous release (M4a) still upserts on `where: { email }`; `DirectoryPerson_email_key` is still present so `INSERT … ON CONFLICT (email)` resolves, and the trigger fills the column. This is exactly why that index cannot be dropped until M11. New release moves `getByEmail` to `institutionId_email`; `search` needs no change — once the model is scoped, the extension filters `findMany`, which closes the live leak at `admin/people/page.tsx:30-31` (a `findMany` and `count` with no tenant filter, directly beside a `where: { institutionId }` on line 26).

> **Do not sweep this together with `User.email`.** The same grep matches six sites that are correct and must be left alone: `auth.ts:58`, `admin/actions.ts:45,:337,:512`, `orgs/[slug]/members/actions.ts:81`, `seed.mjs:41`. `User` is deliberately global (`registry.ts:44-51`); scoping it would fork one human into N accounts and break NextAuth.

**Verification**

```sql
SELECT count(*) FILTER (WHERE "institutionId" IS NULL) AS quarantined, count(*) FROM "DirectoryPerson";
SELECT count(*) FROM "SeatHolding" sh
  JOIN "Role" r ON r.id=sh."roleId" JOIN "Organization" o ON o.id=r."organizationId"
  JOIN "DirectoryPerson" dp ON dp.id=sh."personId"
 WHERE dp."institutionId" IS DISTINCT FROM o."institutionId";                     -- 0
SELECT count(*) FROM "OrganizationAdvisor" oa
  JOIN "Organization" o ON o.id=oa."organizationId"
  JOIN "DirectoryPerson" dp ON dp.id=oa."personId"
 WHERE dp."institutionId" IS DISTINCT FROM o."institutionId";                     -- 0
```

Quarantined rows need an unscoped admin repair surface before M11 can make the column NOT NULL.

**Rollback:** reversible **only while a single Institution exists**. Once tenant B has directory rows, `institutionId` on an unlinked person is the only record of who owns them. Compensating action after that point: `\copy (SELECT id, email, "institutionId" FROM "DirectoryPerson") TO 'dp.csv' CSV` first, roll back, restore from the export.

---

### M5a–M5d — The remaining 16 denormalisations, in four waves.

Every wave uses the M3 template verbatim: nullable column → total backfill → `tenure_expand_*` trigger → `@@unique([id, institutionId])` → additive tenant-leading index → registry move + all four `registry.test.ts` counts. Composite FKs are deferred to M11 (R6). Waves are independently deployable in the stated order.

**Wave A (M5a) — no parent dependency.**

| Model | Backfill source | Rows | Writers | Note |
|---|---|---|---|---|
| `DeliverableReminder` | `Deliverable.institutionId` | 0 | `api/jobs/reminders/route.ts:97` | **Has a writer** — the earlier "no writers" claim inferred it from a row count. Needs `tenure_expand_deliverablereminder`. The job writes the row *after* `notifyUsers` by explicit design, so a rejected insert would re-notify the same board members every invocation, forever. |
| `Transaction` | `Budget.institutionId` | 0 | none (grep-confirmed) | Column added like everything else. See product decision E. |
| `NotificationPreference` | — | 0 | none | **No column. Reclassify `PLATFORM_GLOBAL`.** The row is `userId` + `channel` + `enabled` — structurally a field on `User`. `registry.test.ts:85-90` permits the move; `PLATFORM_GLOBAL` 5 → 6. Widening `@@unique([userId, channel])` later on an empty table is free. |

`Attachment` is **not** in Wave A. Its backfill source and its eventual composite FK are both `Message`, which has no `institutionId` until Wave B.

**Wave B (M5b) — messaging chain, in order.** `Participant` (16) ← `Conversation`; `Message` (6) ← `Conversation`; `Delivery` (12); `Attachment` (0) ← `Message → Conversation`.

`Attachment` is the highest-consequence model in the programme: `objectKey` (schema.prisma:558) means a cross-tenant read yields a signed URL to another institution's file. Its writer is `messages/actions.ts:25`, and `uploadDocument` runs at line 24 *before* the insert — a rejected insert orphans the S3 object and loses the user's upload. It needs `tenure_expand_attachment`.

`Delivery` gets **two** composite legs at M11, not one. `registry.ts:82` records only `Message → Conversation`, but `Participant.conversationId` is an equally valid NOT NULL path and nothing requires a Delivery's message and participant to share a Conversation — it holds by convention across 12 rows. Prisma accepts both legs sharing one `institutionId` column.

**Wave C (M5c) — org- and role-rooted. Must follow M3 and M4b.** In this internal order: `SeatHolding` (259) ← `Role → Organization`; `OrganizationAdvisor` (50) ← `Organization`; `RoleAssignment` (10) ← `Role → Organization`; **`BudgetLine` (18) ← `Organization`; then `LedgerEntry` (7) ← `Organization`**; `CollabInterest` (1).

- `BudgetLine` before `LedgerEntry`, and `BudgetLine` gets `@@unique([id, institutionId])`, because `LedgerEntry.budgetLineId` is a **required** parent link that must become composite at M11. `BudgetLine.actualCents` is documented (schema.prisma:744) as the cache of Σ `LedgerEntry.amountCents`; a cross-tenant ledger entry against another tenant's budget line is the corruption this ADR exists to prevent, on the model where it moves money.
- `RoleAssignment` is where `registry.ts:50-51`'s claim — that a global `User`'s data is separated on the assignment rows pointing at them — stops being aspirational.
- `CollabInterest` derives from **`post`**, not `organization`. `registry.ts:97` records `Organization.institutionId`, but this is the one model whose purpose is cross-organization: the interested club is by design a different org from the post's owner. The feed is the institution-wide surface and the post defines the collaboration's tenant. Both legs become composite at M11, so a club at B cannot raise interest on A's post. (`requestedById` / `decidedById` are bare Strings with no FK.)

**Wave D (M5d) — children of the eight anchors.** `ApprovalStep` (29) ← `ApprovalRequest`; `ConflictRecord` (1) ← `Event`; `FeedComment` (1) ← `FeedPost`; `Notification` (64) — **different treatment**.

`ApprovalStep` is append-only and holds `policySnapshot`, the permissions in effect at decision time (schema.prisma:414), so a wrong tenant stamp is a permanently wrong audit record.

`Notification` has **no derivable parent**: `registry.ts:90` names `User`, which is `PLATFORM_GLOBAL`. Its treatment:

```sql
ALTER TABLE "Notification" ADD COLUMN "institutionId" TEXT;

-- total, no RAISE, no-op on an empty database (CI runs migrate deploy against one)
-- CORRECTION (2026-07-31): the `= 1` guard below is wrong and must not ship.
--
-- It does not fail on two tenants, which would at least be visible — it
-- silently updates nothing, leaves every Notification quarantined at NULL, and
-- surfaces much later as M11's SET NOT NULL failing on a table nobody was
-- looking at. CI has had a second tenant since c4328ca, so this would no-op
-- there today.
--
-- Notification has a real parent: `userId`. Derive the tenant from the
-- recipient's own membership, and leave a NULL for anyone whose membership
-- cannot be resolved to exactly one institution — that row is genuinely
-- ambiguous and R2 says quarantine it rather than guess:
--
--   UPDATE "Notification" n
--      SET "institutionId" = m."institutionId"
--     FROM "InstitutionMembership" m
--    WHERE m."userId" = n."userId"
--      AND n."institutionId" IS NULL
--      AND (SELECT count(*) FROM "InstitutionMembership" m2
--            WHERE m2."userId" = n."userId") = 1;
--
-- A user with memberships at two institutions needs the notification's own
-- origin to disambiguate, which is a product question, not a backfill.
UPDATE "Notification" n
   SET "institutionId" = (SELECT id FROM "Institution")
 WHERE n."institutionId" IS NULL
   AND (SELECT count(*) FROM "Institution") = 1;

CREATE TRIGGER tenure_expand_notification BEFORE INSERT ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION tenure_expand_fill_single_institution();   -- from M4b
```

Do **not** attempt `href`-derivation: the distribution is `/approvals` 32, `/calendar` 12, `/feed` 6, `/admin` 6, `/orgs` 4, `/messages` 2, NULL 2 — only the first two resolve. The trigger is mandatory here, not optional: `notify.ts:10` `db.notification.createMany` is called from 28 sites across 8 files, **every one of them after its `$transaction` has committed** (e.g. `approvals/actions.ts:354` follows the transaction opened at `:103`; `admin/actions.ts:602/685/690/742/792` follow role-transfer commits). A failing insert there shows the user a failure for an operation that succeeded; they retry and create a duplicate approval or a duplicate transfer.

At M11, `Notification` gets the real invariant rather than a bare column:

```sql
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_institutionId_fkey"
  FOREIGN KEY ("userId","institutionId") REFERENCES "InstitutionMembership"("userId","institutionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

`InstitutionMembership @@unique([userId, institutionId])` already exists (schema.prisma:97). Without this, `Notification.institutionId` would be an unanchored bare TEXT column — structurally identical to the eight columns M1 exists to eliminate. Consequence to accept: revoking a membership deletes that user's notifications for that tenant. Preflight before M11 must confirm every notification's user is a member of its stamped institution.

**Locks / duration, all waves:** largest single backfill is SeatHolding at 259 rows. Every wave completes in tens of milliseconds at pilot scale. At >1M rows, batch the UPDATE.

**Dual-shape, all waves:** nullable column + trigger, so both releases write valid rows. No `NOT NULL` anywhere.

**Verification, per model** (parameterise over the wave):

```sql
SELECT count(*) FILTER (WHERE "institutionId" IS NULL) AS quarantined, count(*) FROM "<Model>";
-- and the parent-agreement query, e.g. for SeatHolding:
SELECT count(*) FROM "SeatHolding" sh
  JOIN "Role" r ON r.id=sh."roleId" JOIN "Organization" o ON o.id=r."organizationId"
 WHERE sh."institutionId" IS DISTINCT FROM o."institutionId";   -- 0
```

**Rollback:** `DROP TRIGGER` / `DROP INDEX` / `DROP COLUMN` / `migrate resolve --rolled-back`. Free — every column is a derived copy.

---

### M6 — Indexes. Purely additive (R5). One migration per table.

Under one tenant a tenant-leading index matches 100% of the table; under N it matches 1/N. **Nothing is dropped here** — in observe mode the emitted SQL carries no `institutionId` predicate, so replacing `[organizationId, status]` with `[institutionId, organizationId, status]` would force a seq scan for the whole window.

**On the 15 pre-existing scoped models** (add alongside):

```
Deliverable        [institutionId, seat, dueAt]                        :244
ApprovalRequest    [institutionId, organizationId, status]             :400
Event              [institutionId, organizationId, status]             :464
Conversation       [institutionId, updatedAt(Desc)]                    :513  (the bare [institutionId] can filter but not order — EXPLAIN on messages/page.tsx:44-53 gives Limit → Sort → Bitmap Heap Scan)
Conversation       [institutionId, organizationId, type]               :514
Document           [institutionId, organizationId, isArchived]         :600
Document           [institutionId, updatedAt]                          (none today)
MemoryRecord       [institutionId, organizationId, type, isArchived]   :631
MemoryRecord       [institutionId, roleId]                             :632
MemoryRecord       [institutionId, isArchived, updatedAt]              (none today)
Vendor             [institutionId, organizationId, isArchived]         :732
Budget             [institutionId, updatedAt]                          (no @@index at all)
FeedPost           [institutionId, isArchived, createdAt(Desc)]        :801
AuditEvent         [institutionId, actorId, occurredAt]                :885
AuditEvent         [institutionId, resourceType, resourceId]           :886
RoleTransfer       [institutionId, toUserId, status]                   :923
ApprovalDelegation [institutionId, toUserId, revokedAt]                :942
ApprovalDelegation [institutionId, fromUserId, revokedAt]              :943
```

`admin/overrides/page.tsx:43-56` reads Document and MemoryRecord institution-wide ordered by `updatedAt desc` and EXPLAINs to `Limit → Sort → Seq Scan` on both today. MemoryRecord holds `CREDENTIAL`-typed rows (schema.prisma:611).

**On the 18 newly scoped models** — omitted from every earlier draft, and it includes the sharpest cases:

```
Notification        [institutionId, userId, readAt] , [institutionId, userId, createdAt]   :850-851
DeliverableReminder [institutionId, userId]
SeatHolding         [institutionId, personId]
OrganizationAdvisor [institutionId, personId]
Message             [institutionId, conversationId, createdAt]
ApprovalStep        [institutionId, approvalId]
FeedComment         [institutionId, postId, createdAt]
RoleAssignment      [institutionId, userId, roleId]
CollabInterest      [institutionId, status]
Attachment          [institutionId, messageId]                    -- Attachment has NO index at all today
```

The `userId`-leading ones matter precisely because `User` is `PLATFORM_GLOBAL`: one person legitimately holds seats at several institutions, so a `userId`-leading index genuinely spans tenants and the tenant predicate can only be applied as a post-index filter.

**A rule, because the naive reading over-corrects.** A unique whose leading column is `organizationId` is *already* transitively tenant-scoped, because `Organization.institutionId` is a real FK. `Budget` :659, `BudgetLine` :710, `Role` :212, `CollabInterest` :835 and `OrganizationAdvisor`'s `@@id` :324 need no change and would be **weakened** by prefixing `institutionId` — two institutions could then claim the same organization. Likewise `Event.approvalId` :444 and `Conversation.approvalId` :504 are global uniques on a FK to a cuid primary key: they enforce 1:1 cardinality on an already-globally-unique surrogate. Leave them. A mechanical "add institutionId to every `@unique`" sweep would wrongly rewrite all seven.

`Deliverable @@index([seat, dueAt])` is a **correctness** signal: it is the index behind the nightly reminders job ADR-0002:20-21 names as querying every deliverable regardless of institution. `seat` is a low-cardinality `SeatKey`; leading with it means the index is near-useless at scale and reads across tenants at every scale.

**Locks / duration:** SHARE per table, tables of ≤259 rows, one file each. **Rollback:** `DROP INDEX` + `migrate resolve --rolled-back`. Free.

---

### M7 — Bind the unconstrained pointers. Delete action stated per pointer.

Every one of these is nullable, and most are `ON DELETE SET NULL` today. Prisma cannot emit `SetNull` for a composite relation with a required `institutionId` leg (M1's Conversation finding), so **compositing a SetNull pointer silently converts it to RESTRICT or forces CASCADE — both wrong.** M7 therefore adds plain FKs only; same-tenant agreement for these is deferred to RLS (ADR-0002 item 5).

| Pointer | Today | M7 action | Why not composite |
|---|---|---|---|
| `AuditEvent.organizationId` :877 | bare String, no FK | `FK → Organization(id) ON DELETE SET NULL` | Append-only and tamper-evident: an audit row in A can permanently cite an org in B and cannot be corrected by design. Highest value in this step. |
| `Event.ownerRoleId` :443 | bare String, no FK | `FK → Role(id) ON DELETE SET NULL` | An Event can name another tenant's seat as its owner |
| `ConflictRecord.conflictWithEventId` :477 | bare String, no FK | `FK → Event(id) ON DELETE SET NULL` | After M5d the row is scoped, which makes an unvalidated pointer *look* handled — IDOR-shaped |
| `Message.replyToId` :542 | no FK | `FK → Message(id) ON DELETE SET NULL` | display threading only |
| `Participant.lastReadMessageId` :526 | no FK | `FK → Message(id) ON DELETE SET NULL` | CASCADE would delete the Participant when a message is deleted |
| `Transaction.approvalId` :676 | no FK | `FK → ApprovalRequest(id) ON DELETE SET NULL` | only if Transaction survives decision E |
| `LedgerEntry.approvalId` / `vendorId` / `documentId` :759-764 | FK, SetNull (`migration.sql:980,983,986`) | **leave** | CASCADE on `documentId` would destroy a financial record when a receipt is deleted |
| `MemoryRecord.roleId` :620 | FK, SetNull (:959) | **leave** | CASCADE destroys the seat's institutional memory when a Role is deleted — the product's stated first principle (schema.prisma:3); RESTRICT blocks `seed.mjs:223` `db.role.delete` and, via Organization→Role, blocks Organization deletion |
| `Event.approvalId` / `Conversation.approvalId` | FK, SetNull (:920, :929) | **leave** | as above |
| `FeedPost.eventId` :792 | FK, SetNull (:992) | **leave** | as above |
| `LedgerEntry.budgetLineId` | FK, Cascade, **required** | **composite at M11** | the one required parent link on the model |

**Locks / duration:** ACCESS EXCLUSIVE on both tables per `ADD CONSTRAINT`, one file each, ≤259-row scans. **Rollback:** `DROP CONSTRAINT` + `migrate resolve --rolled-back`. DB-side free; the datamodel side is not, since code will have started using the new relation fields.

---

### M8 — Code: open a tenant scope at every entry point. No schema change.

This is ADR-0002 remaining-work item 1, and it is a **hard, per-model prerequisite** of enforcement, not a parallel track. Today essentially no application call site opens a scope. Scope every server action, page and API route through `withTenantScope` / `withSystemTenantScope` / `forEachInstitution` (`apps/web/src/lib/tenant-scope.ts:169-230`), and every job through `forEachInstitution`. Start with the 10 unscoped API routes listed under R8.

Optional simplification worth considering: make the extension **stamp in observe mode too** (stamp always; filter only when scoped). That is a one-line change to `decideScope` and removes the dependency of every denormalisation on the sweep being complete.

### M9 — Persist the acting institution. No schema change.

`resolveTenantScope(userId, institutionId?)` already validates a caller-supplied institution against membership and throws otherwise. The missing piece is the **choice**: derive it from the URL segment (product decision A1 gives this for free), persist it in a cookie or session claim, and pass it as `opts.institutionId`. Replace `institutionRoles[0]` at `admin/guard.ts:21` and `:55`, and remove the `orderBy: [{ institutionId: "asc" }]` stability hack at `rbac.ts:38`. Harmless with one institution; silently wrong with two.

### M10 — `TENANCY_ENFORCE=true`. No schema change. **Gate.**

Flip only when: (a) M8 is complete, (b) the observe-mode recorder is empty for every scoped model, (c) `isolation.itest.ts` is green under enforcement. Note that `apps/web/src/lib/tenancy/extension.ts:28-47` records in-process, capped at 500, deduped per (model, operation) and never persisted — so "drive the recording to empty" has no instrument that survives a task restart. **Persist the recorder (structured log or a table) as part of M8**, or (b) cannot gate anything.

This is where the earlier draft's dependency graph was wrong in the direction that matters. Enforcement belongs *after* the denormalisations (each one moves a model into `TENANT_SCOPED`, and under enforcement every unscoped call site throws rather than being recorded) — and *before* provisioning. Observe mode is not a weaker filter; it is **no** filter and **no** stamp.

---

### M11 — Contract. One migration per table. Gated on preflight.

Runs only after M10 is stable. Preflight (as SQL, run from the RunTask stage before the deploy — **not** as assertions inside the migration):

```sql
-- must all return 0
SELECT count(*) FROM "Role" WHERE "institutionId" IS NULL;      -- repeat for all 18 models
SELECT count(*) FROM "Notification" n
  LEFT JOIN "InstitutionMembership" m ON m."userId"=n."userId" AND m."institutionId"=n."institutionId"
 WHERE m.id IS NULL;
SELECT count(*) FROM (SELECT "institutionId", slug FROM "Organization" GROUP BY 1,2 HAVING count(*)>1) x;
```

**Schema diff**

```diff
 model Role            { - institutionId String?  + institutionId String
                         - positionCode  String? @unique  + positionCode String?
                         - @@index([organizationId, scope])
                         - organization Organization @relation(fields: [organizationId], …)
                         + organization Organization @relation(fields: [organizationId, institutionId], references: [id, institutionId], onDelete: Cascade) }
 model Organization    { - slug String @unique   + slug String }
 model Deliverable     { - key  String @unique   + key  String }
 model DirectoryPerson { - email String @unique  + email String ; institutionId String ; institution Institution @relation(… onDelete: Restrict) }
 model ApprovalRequest { - idempotencyKey String? @unique + idempotencyKey String? }
 -- …and String? → String plus the composite parent relation on the other 15 denormalised models
```

**Migration SQL** (M11-Role shown; one file per table)

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

UPDATE "Role" r SET "institutionId" = o."institutionId"
  FROM "Organization" o WHERE o.id = r."organizationId" AND r."institutionId" IS NULL;

ALTER TABLE "Role" ALTER COLUMN "institutionId" SET NOT NULL;

ALTER TABLE "Role" DROP CONSTRAINT "Role_organizationId_fkey";
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_institutionId_fkey"
  FOREIGN KEY ("organizationId","institutionId") REFERENCES "Organization"("id","institutionId")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER "tenure_expand_role" ON "Role";
DROP INDEX "Role_positionCode_key";
DROP INDEX "Role_organizationId_scope_idx";
```

The five global uniques are dropped in their owning table's file. The full trigger/function teardown is its **own final file**, with every trigger enumerated explicitly — Postgres refuses to drop a function a surviving trigger depends on, and one missed `DROP TRIGGER` aborts the transaction:

```sql
DROP TRIGGER "tenure_expand_role"                ON "Role";
DROP TRIGGER "tenure_expand_directoryperson"     ON "DirectoryPerson";
DROP TRIGGER "tenure_expand_deliverablereminder" ON "DeliverableReminder";
DROP TRIGGER "tenure_expand_transaction"         ON "Transaction";
DROP TRIGGER "tenure_expand_participant"         ON "Participant";
DROP TRIGGER "tenure_expand_message"             ON "Message";
DROP TRIGGER "tenure_expand_delivery"            ON "Delivery";
DROP TRIGGER "tenure_expand_attachment"          ON "Attachment";
DROP TRIGGER "tenure_expand_seatholding"         ON "SeatHolding";
DROP TRIGGER "tenure_expand_organizationadvisor" ON "OrganizationAdvisor";
DROP TRIGGER "tenure_expand_roleassignment"      ON "RoleAssignment";
DROP TRIGGER "tenure_expand_budgetline"          ON "BudgetLine";
DROP TRIGGER "tenure_expand_ledgerentry"         ON "LedgerEntry";
DROP TRIGGER "tenure_expand_collabinterest"      ON "CollabInterest";
DROP TRIGGER "tenure_expand_approvalstep"        ON "ApprovalStep";
DROP TRIGGER "tenure_expand_conflictrecord"      ON "ConflictRecord";
DROP TRIGGER "tenure_expand_feedcomment"         ON "FeedComment";
DROP TRIGGER "tenure_expand_notification"        ON "Notification";

DROP FUNCTION "tenure_expand_fill_from_organization"();
DROP FUNCTION "tenure_expand_fill_from_role"();
DROP FUNCTION "tenure_expand_fill_from_conversation"();
DROP FUNCTION "tenure_expand_fill_from_message"();
DROP FUNCTION "tenure_expand_fill_from_deliverable"();
DROP FUNCTION "tenure_expand_fill_from_budget"();
DROP FUNCTION "tenure_expand_fill_from_approvalrequest"();
DROP FUNCTION "tenure_expand_fill_from_event"();
DROP FUNCTION "tenure_expand_fill_from_feedpost"();
DROP FUNCTION "tenure_expand_fill_single_institution"();
```

Never `DROP FUNCTION … CASCADE`: it would silently drop a trigger you forgot, which is the failure this file exists to surface.

**Locks / duration:** `SET NOT NULL` takes ACCESS EXCLUSIVE and scans the table — instant at ≤259 rows. At scale: `ADD CONSTRAINT chk CHECK ("institutionId" IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT` (ACCESS SHARE) → `SET NOT NULL` skips the scan → drop the check.

**Dual-shape:** this is the release that has none, and the gate is an **image-tag precondition on the preceding task definition**, not "the previous release has drained". ECS starts the new task, it migrates at `entrypoint.sh:30` *before* serving, becomes healthy, and only then is the old task deregistered with a 30s drain (`alb.tf:37`) — so `DROP INDEX "DirectoryPerson_email_key"` executes while the previous release is still serving, by construction. The checkable invariant is: *the immediately preceding task definition must never upsert on a dropped key.* Prisma compiles `upsert` to `INSERT … ON CONFLICT (col) DO UPDATE`; an image predating M4b produces *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*. After M11 the circuit breaker's guarantee weakens from "returns to a working service" to "returns to task definition N-1 only" — hence the M0(7) guard on `force-redeploy.yml`.

**Verification**

```sql
SELECT indexname FROM pg_indexes WHERE indexname IN
 ('Organization_slug_key','Role_positionCode_key','Deliverable_key_key',
  'DirectoryPerson_email_key','ApprovalRequest_idempotencyKey_key');            -- 0 rows
SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgname LIKE 'tenure_expand_%';                  -- 0 rows
SELECT proname FROM pg_proc WHERE proname LIKE 'tenure\_expand\_%';             -- 0 rows
SELECT attrelid::regclass::text, attname FROM pg_attribute
 WHERE attname='institutionId' AND attnum>0 AND NOT attnotnull
   AND attrelid IN (SELECT oid FROM pg_class WHERE relkind='r');                -- 0 rows
```

**Rollback:** recreate the five indexes and the single-column FKs, re-add the triggers, `ALTER COLUMN … DROP NOT NULL`, then `migrate resolve --rolled-back`. **`CREATE UNIQUE INDEX "Organization_slug_key"` succeeds only while no duplicate exists** — i.e. only before tenant B has data. Which gives the programme its clearest property:

> Every migration in this ADR is reversible right up until a second Institution row has data. **Provisioning tenant 2 is the irreversible act — not any migration.**

---

### M12 — Provisioning. New work; not folded into this ADR.

`seed.mjs:29-36` is the only Institution write and everything downstream is hardcoded to the Simon roster, deliverables and resources. Tenant B needs a parameterised entry point (slug, name, domain, timezone, roster source) running under `runUnscoped("control-plane", …)`, plus a first OSE Director — a chicken-and-egg problem, because `institution.grantRole` requires a Director. `admin/actions.ts` has a zero-director guard for the *demotion* case; the **bootstrap** case has no answer. Offboarding (export-then-delete, with the AuditEvent retention decision from product decision C) belongs here too.

## What this breaks in the application

| File | What depends on the old shape | Required change |
|---|---|---|
| `apps/web/prisma/schema.prisma` | 39 models | All diffs above; both `@unique` and `@@unique` coexist M2→M11 |
| `apps/web/src/lib/tenancy/registry.ts` | 15/5/19 buckets | 18 models UNENFORCEABLE→TENANT_SCOPED; NotificationPreference→PLATFORM_GLOBAL. End state 33/6/0 |
| `apps/web/src/lib/tenancy/registry.test.ts:92-99` | `toHaveLength(15/5/19/39)` | All four counts, per step, per the table in **Decision** |
| `apps/web/src/lib/tenancy/scope-args.ts:88-101` | `pass-through` unstamped when unscoped | Either M8 completes first per model, or stamp in observe mode too |
| `apps/web/src/lib/tenancy/extension.ts:28-47` | in-process recorder, cap 500, never persisted | Persist it — M10's gate has no instrument otherwise |
| `apps/web/src/lib/tenancy/isolation.itest.ts:52-53` | A/B with deliberately different slugs; teardown deletes Institutions | Same-slug test (M2c); teardown must delete Conversations/AuditEvents explicitly once `Conversation_institutionId_fkey` is Restrict |
| `apps/web/src/lib/clubs.ts:85` | `findUnique({ where: { slug } })` | `findUnique({ where: { institutionId_slug: { institutionId, slug } } })` — `institutionId` is already `chartClub`'s first parameter |
| `apps/web/src/lib/clubs.ts:49-59` `uniquePositionCode` | `findUnique({ where: { positionCode } })` | `findFirst` — scoped by the extension. `CC-PRES` at B is **not** a collision with A's and must not become `CC-PRES-2` |
| `apps/web/src/app/(app)/admin/actions.ts:260-263` | check-then-create on `positionCode`, using top-level `db` not `tx` | Single `upsert` on `institutionId_positionCode` — already racy today |
| `apps/web/src/lib/directory.ts:21-26,36-58` | `search(query)`, `getByEmail(email)` | Add institution argument (M4a); `getByEmail` → `institutionId_email`. `search` needs no filter change once scoped |
| `apps/web/src/app/(app)/admin/actions.ts:309-319` | `requireCapability` discards institutionId; upsert on `email` | Capture it; refuse to create an unlinkable person; upsert on `institutionId_email` |
| `apps/web/src/app/(app)/admin/people/page.tsx:26-31` | `findMany`/`count` with **no** tenant filter | None — the extension closes it at M4b. This is a live leak today |
| 12 read sites: `orgs/[slug]/members/page.tsx:30`, `memory/page.tsx:45`, `handoff/page.tsx:43`, `documents/page.tsx:36`, `finance/page.tsx:24`, `impact/page.tsx:37`, `members/actions.ts:20`, `memory/actions.ts:14`, `documents/actions.ts:22`, `finance/actions.ts:26`, `finance/actions.ts:309`, `admin/clubs/[slug]/page.tsx:37` | `db.organization.findUnique({ where: { slug } })` | `findFirst({ where: { slug } })`. No control-flow inversion, no threaded parameter: the ambient scope supplies the tenant and a missing scope throws under enforcement |
| `apps/web/src/lib/admin/guard.ts:21,:55` | `ctx.institutionRoles[0].institutionId` | Acting institution from the persisted choice (M9) |
| `apps/web/src/lib/rbac.ts:28-38` | `orderBy: [{ institutionId: "asc" }]` stability hack | Remove once M9 lands |
| `apps/web/src/lib/notify.ts:10` + 28 call sites in 8 files | `createMany` with no institution, called **after** `$transaction` commit | None if the trigger and M8 land together; the trigger is mandatory for M5d |
| `apps/web/src/app/api/notifications/route.ts:54`, `(app)/notifications/page.tsx:22` | `updateMany({ where: { userId } })` | Must filter userId **and** institution, or a two-school user sees A's notification titles while acting in B |
| `apps/web/src/app/api/jobs/reminders/route.ts:53` | `db.roleAssignment.findMany` — UNENFORCEABLE, passes through even inside `forEachInstitution` | Fixed by M5c; until then the job notifies B's officers about A's deadlines |
| `apps/web/src/app/api/jobs/reminders/route.ts:92,:97` | literal `href: "/calendar"`; `deliverableReminder.createMany` after `notifyUsers` | Tenant-relative href (decision A); trigger for the reminder row |
| `apps/web/src/app/(app)/messages/actions.ts:24-25` | `uploadDocument` **before** `attachment.create` | Nullable column + `tenure_expand_attachment`; consider inverting the order so a failed insert cannot orphan an S3 object |
| 10 unscoped API routes: `api/admin/directory`, `api/notifications`, `api/attachment/[id]`, `api/templates/budget`, `api/ai/draft`, `api/profile-image`, `api/documents/[id]`, search variants | No `withTenantScope`; every one touches a model this ADR scopes | M8 |
| `apps/web/scripts/seed.mjs:19` | `new PrismaClient()` — bypasses the extension entirely, never stamped in any mode | Add `institutionId: institution.id` to **nine** payloads: `directoryPerson.upsert`:90, `organizationAdvisor.upsert`:136, `role.upsert`:159, `seatHolding.upsert`:186, `role.upsert`:199, `roleAssignment.create`:307, `budgetLine.upsert`:337, `ledgerEntry.create`:406, `budgetLine.upsert`:441. Run as a deployed one-off task (`seed-reference-data.yml`) and with `SEED_ON_BOOT=true` in CI/local, so this breaks the reference-data pipeline and every DB rebuild if missed. That the seed bypasses the chokepoint is a permanent unaudited write path worth its own decision |
| `apps/web/scripts/seed.mjs:110,:112,:288,:320` | `findUnique`/`findUniqueOrThrow` on global `slug` | `findFirst`/`findFirstOrThrow` with `institutionId`. `:110-112` is the rename-in-place path — seeded against B it would adopt A's Organization row and rename it, while `:126-127` leaves `institutionId` untouched |
| `apps/web/scripts/seed.mjs:143-156` | pre-nulls `positionCode` to reclaim it | Delete — correct but unnecessary once the unique is per-tenant |
| `apps/web/scripts/seed.mjs:241-244` | `deliverable.upsert({ where: { key } })` | `where: { institutionId_key: { institutionId: institution.id, key: d.key } }` |
| `apps/web/scripts/db-bootstrap.mjs:48-54,:227-236` | runs `migrate deploy` at every boot; exits 1 on failure | M0: RunTask stage; boot verifies only; detect P3009 and name the recovery step |
| `apps/web/scripts/entrypoint.sh:7,21,30,41-47` | `set -e`; `connection_limit=5`; seed shares the entrypoint | M0: `PRISMA_SCHEMA_ENGINE_LOCK_TIMEOUT`; seed and deploy must not overlap |
| `infrastructure/terraform/rds.tf:48`, `ecs.tf:250-264`, `alb.tf:30-37` | `backup_retention_period=1`; `desired_count=1`; no timeouts; 300s grace | M0: parameter-group timeouts; retention decision; RunTask removes the grace-period budget problem |
| `.github/workflows/ci.yml:128-130,:225-229` | `migrate deploy` against an **empty** database | Every backfill and trigger must no-op at zero rows (hence `NO_DATA_FOUND → RETURN NEW`, and `count(*) = 1` rather than `<> 1`) |
| `.github/workflows/force-redeploy.yml` | lets an operator pin any older image | Minimum-image-tag guard (M0) |
| 41 URL constructions / 18 `revalidatePath` / `(app)/orgs/[slug]` / `(app)/admin/clubs/[slug]` | global slug in the path | Decision A. Not affected: `(app)/resources/[slug]` resolves against the in-code `policyBySlug` table; `api/calendar/ics/[token]` is an HMAC |
| `Resource.href` (9 of 15 seeded rows internal) and `Notification.href` (62 of 64 internal) | stored absolute in-app paths | Decision A: store tenant-relative and prefix at render. `Resource.href` is admin-authorable, so it needs validation, not a one-time rewrite |
| New lint rule | `stampTenant` cannot coexist with checked nested creates | Forbid `institution: { connect:`, `organization: { connect:`, `conversation: { connect:` in `data:` payloads on tenant-scoped models |

## Product decisions required

### A — What is a club URL once slugs are per-tenant? *(blocks M9, M2c's code half)*

| Option | URL | Cost | Buys |
|---|---|---|---|
| **A1 — tenant path prefix** *(recommend)* | `/i/rochester/orgs/consulting-club` | 41 URL sites, 18 revalidatePaths, 2 route segments under a new `[institutionSlug]`, permanent redirects, ICS/email absolute URLs regenerated, **plus a resolution layer for stored `Resource.href` and `Notification.href`** | A link means one thing to everyone. Tenant resolvable before auth. `revalidatePath` keys distinct by construction. A user with seats at two schools can hold both pages open. Feeds `resolveTenantScope`'s existing `institutionId` argument for free |
| A2 — session-derived | unchanged | almost nothing | A link means different things to different people; an OSE director with two seats gets whichever tenant they are "acting" in. Undiagnosable support tickets |
| A3 — subdomain | `rochester.tenure.app/…` | wildcard DNS + wildcard ACM + host routing; real money against the free-tier posture | A1's benefits plus cookie isolation |
| A4 — prefix the slug | `/orgs/rochester-consulting-club` | none | Rejected: the same collision wearing a hat; renaming an institution breaks every URL |

**Recommend A1.** Honest counter-argument for A2: every org page calls `auth()`, so all are dynamic and there is no shared full-route cache to poison — the cache argument for A1 is weaker than it looks. The link-portability argument is not.

### B — Is a directory record a fact about a person, or a fact about an institution's roster? *(blocks M4)*

| Option | Shape | Consequence |
|---|---|---|
| **B1 — per-tenant rows** *(recommend)* | `institutionId` NOT NULL, `@@unique([institutionId, email])` | An advisor at two schools has two unlinked records. A fixing a typo does not fix it for B. Offboarding A is a clean cascade |
| B2 — global person + `DirectoryListing` join | mirrors `User`/`InstitutionMembership` | Reproduces the exact unenforceable shape this programme exists to delete, on the one table holding real PII. Deleting a person B still lists is a data-loss incident |
| B3 — global person + "home" institutionId | one row, one owner | Worst of both: the extension filters on a column that does not describe who may see the row |

**Recommend B1.** The schema already answers it: `schema.prisma:268-274` says a DirectoryPerson is deliberately **not** identity, and that Okta-authenticated people are *matched* to these records by email. One global `User`, N per-institution `DirectoryPerson` rows, matched by verified email; cross-institution identity lives on `User` where `registry.ts:44-51` already put it. **Consequence to accept explicitly: merging or de-duplicating people across institutions is not a feature, now or later.** 71 people already hold seats in more than one org and 8 advisors advise more than one — a second school in the same university system shares that population by default, so this will be exercised immediately.

### C — Institution deletion and audit retention *(blocks M12, shapes M1e)*

Institution deletion is **already impossible** on any real tenant: `AuditEvent_institutionId_fkey … ON DELETE RESTRICT` (`migration.sql:1010`) blocks it on a single audit row. Seven FKs point at Institution — six Cascade, AuditEvent Restrict. Offboarding is therefore a retention question, not a cascade question: does an append-only, tamper-evident audit log outlive the tenant it describes? **Recommend: yes** — offboarding exports and archives AuditEvent, then deletes, as an explicit audited routine in M12. Meanwhile `Conversation`'s new Institution FK is `Restrict` for the same reason, and because `Institution` is `PLATFORM_GLOBAL` and the chokepoint does not guard `institution.delete` at all.

### D — Does `Institution.domain` mean anything? *(cheap; blocks nothing)*

`domain` (schema.prisma:62) is nullable, **not unique**, written once by `seed.mjs:35` and read nowhere. Its comment says "used for verified email matching" and `DirectoryPerson`'s says Okta people are matched by email. Today two institutions could both claim `rochester.edu`. **Recommend:** if domain-based matching is real, add `@@unique` on `domain` (or an `InstitutionDomain` child table for multi-domain schools) in an M2-style additive step, and list it in M12's provisioning inputs. If it is not real, say so — it is currently the only column that looks like it answers "which tenant does this email belong to".

### E — Budget / Transaction, and `ApprovalRequest.idempotencyKey` *(blocks nothing; resolve the contradiction)*

Budget and Transaction are 0 rows **locally**; the pilot was never counted. Budget is not dead — `admin/actions.ts:880` reads it and `:891` updates it — and M1 gives it a composite anchor. `idempotencyKey` is genuinely dead (zero call sites, all 14 rows NULL). **Recommend: drop nothing.** ADR-0001 makes non-destructive migration a policy; a `DROP TABLE` against a table whose live row count was never measured is the most irreversible action available. Give Transaction a column like everything else and keep `idempotencyKey` behind its composite index — one index preserves the option. If the project decides dead models *may* be dropped, that is a general amendment to ADR-0001, it changes `expect(schemaModels).toHaveLength(39)`, and `idempotencyKey` should be revisited under the same rule. Do not decide it in a parenthetical.

## Verification

### Per-step, in the migration pipeline

Each step's verification query above runs from the in-VPC RunTask stage immediately after its migration, and its exit code gates the deploy. Note the class of bug they are written to avoid: `WHERE contype='f' AND conname LIKE '…' OR conname='…'` returns the expected 9 rows while silently no longer testing what it claims, because `AND` binds tighter than `OR`. Parenthesise; a verification step that reads green while proving nothing is worse than none.

### In CI — the gap that matters most

`ci.yml:128-130` applies migrations to an **empty** database, so every backfill runs against zero rows and every check passes vacuously. Nothing in CI exercises a backfill against data at any point in the programme, including DirectoryPerson. Add:

1. **A two-tenant fixture.** Before applying the new migrations, seed a second Institution whose organizations, roles, deliverables and directory people **deliberately collide** with the first on `slug`, `positionCode`, `key` and `email`. Apply the migration. Assert the backfill classified every row and no constraint fired.
2. **A multi-institution DirectoryPerson fixture** — one person with a SeatHolding under A and an OrganizationAdvisor row under B. Assert the row **quarantines as NULL** rather than being stamped, and that the preflight reports it.
3. **The empty-database path stays green** for every migration file — it already runs; use it.
4. **The drift gate** (`ci.yml:103-119`) continues to prove only the end shape. Confirm on M3 — the first migration carrying a trigger — that `migrate diff --from-migrations --to-schema-datamodel --shadow-database-url` ignores triggers and functions entirely. This is the one assumption in the ADR that cannot be checked without a shadow database. **If it turns out false, fall back to a maintenance window — not to a column DEFAULT, which definitely breaks the gate.**

### In `isolation.itest.ts` — one test per step, not one at the end

The existing test gives tenants A and B deliberately different slugs (`a-club-*` / `b-club-*`) because the schema forbids the case that actually matters. Making that case writable is the point of the programme.

```ts
it("lets two tenants hold the same slug", async () => {
  await runInTenantScope(scopeA, () => createOrg({ name: "Chess Club", slug: `chess-${SUFFIX}` }))
  await runInTenantScope(scopeB, () => createOrg({ name: "Chess Club", slug: `chess-${SUFFIX}` }))  // must not throw P2002
  await runInTenantScope(scopeA, async () => {
    const rows = await db.organization.findMany({ where: { slug: `chess-${SUFFIX}` } })
    expect(rows).toHaveLength(1)
    expect(rows[0].institutionId).toBe(INST_A)
  })
})
```

The same shape, per step: same `positionCode` (M3), same `email` (M4b), same `Deliverable.key` (M2a). Then, after M5: for each of the 18 newly scoped models, create a row in A, open scope B, and assert `findMany` returns nothing and `findUnique` by A's id returns null. Then run the **whole suite under `TENANCY_ENFORCE=true`** — that is M10's gate.

### On the pilot, before and after

- **Before M1:** the M0 census (a)–(e). One mismatched row turns M1 from metadata-only into a repair. Every row count in this ADR is from the local seeded DB; the pilot was shaped by `db push --accept-data-loss` and has never been measured.
- **After every deploy:** an in-VPC `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code` run from the RunTask stage. Without it, a DB-side rollback leaves the migration recorded as applied, `db-bootstrap.mjs:236` prints "✅ Database schema is up to date" against a schema neither the code nor `schema.prisma` describes, and nothing detects it — the CI drift gate never looks at the pilot, and a GitHub Actions runner cannot reach RDS.
- **Rollback is defined as** `prisma migrate resolve --rolled-back <name>` **plus** the SQL, both from the RunTask stage. The SQL alone is not a rollback.

### End to end — the acceptance test for "a second tenant exists and is isolated"

Runs against a staging clone of the pilot, after M11, before M12 ships to production:

1. Provision `institution B` through M12's entry point, with a colliding club slug, a colliding `positionCode`, a colliding `Deliverable.key`, and a directory person whose email already exists under A. All four succeed.
2. Bootstrap B's first OSE Director. Confirm the chicken-and-egg path works without hand-editing rows.
3. Sign in as a user with seats at **both**. Switch acting institution. Every page, every count, every notification list changes. `/i/rochester/orgs/x` and `/i/b/orgs/x` render different clubs simultaneously in two tabs.
4. As B, attempt to read A's document, approval, memory record, message, attachment and ledger entry by direct id. Each returns 404, not 403 and not data. Repeat for the `/api/attachment/[id]` signed-URL path specifically.
5. Run the nightly reminders job. Confirm each institution's officers receive only their own deadlines — the `roleAssignment.findMany` leak at `api/jobs/reminders/route.ts:53` is the regression to watch.
6. Attempt, as B, to write a row whose `organizationId` belongs to A. Expect `23503` from the composite FK, not a stored row.
7. Attempt to notify a user who is not a member of B. Expect `23503` from `Notification_userId_institutionId_fkey`.
8. Run the full `isolation.itest.ts` suite with `TENANCY_ENFORCE=true` against the two-tenant database. Confirm the observe-mode recorder is empty.

Only after step 8 passes is `TENANCY_ENFORCE=true` sound in production, and only then does ADR-0002 item 5 (RLS) become the next piece of work — as defence in depth behind a schema that can already express the invariant, rather than as a substitute for one that cannot.