I have everything I need. Here is the inventory.

---

# TENURE — CURRENT-STATE INVENTORY (multi-tenancy migration input)

Repo root: `C:\Users\adiab\Tenure`. Not a Prisma-migrations project — schema is applied with `db push`.

## 1. STACK

**Framework**: Next.js `^15.1.0`, App Router, React `^19.0.0`, TypeScript `^5.7.0` (`package.json:16,19-20,45`). No `middleware.ts` anywhere (verified absent) — **there is no request-level tenant interceptor; every page/route/action resolves tenancy itself.**
**ORM**: Prisma `^6.0.0` client + CLI (`package.json:14,40`). Single `PrismaClient` singleton, no extensions, no `$extends`, no query middleware, no RLS (`src/lib/db.ts:7-16`).
**Database**: PostgreSQL. `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` (`prisma/schema.prisma:8-11`). Production is RDS Postgres `16.3`, `db.t3.micro`, single instance, `manage_master_user_password = true`, `deletion_protection = true`, `backup_retention_period = 1` (free-tier cap) (`infrastructure/terraform/rds.tf:27-61`). Parameter group loads `pg_stat_statements` only; **`pgvector` is named in a comment but not enabled** (`rds.tf:8-24`).
**Auth**: NextAuth `5.0.0-beta.25` + `@auth/prisma-adapter ^2.7.4` (`package.json:13,18`). Config at `src/lib/auth.ts:15-59`: `session: { strategy: "jwt" }` (`:20`), `trustHost: true` (`:18`), custom sign-in page `/signin` (`:21`). Two conditionally-registered providers: **Okta** (registered only when `OKTA_ISSUER` starts with `https://`, `:12-13,23-31`) and **`dev-login` Credentials** — *email only, no password, any seeded user* — enabled by `AUTH_DEV_LOGIN=true` (`:9,32-47`). `AUTH_DEV_LOGIN` is hardcoded `"true"` in the production ECS task (`infrastructure/terraform/ecs.tf:157`). JWT callbacks only carry `sub`→`session.user.id` (`:49-58`) — **no institution/tenant claim in the session**.
**Hosting/infra** (`infrastructure/terraform/*.tf`, all one AWS account, `name_prefix = "tenure-pilot"`, `main.tf:34-38`, `variables.tf:1-17`):
- Docker multi-stage `node:20-alpine`, `output: "standalone"` gated on `NEXT_STANDALONE=1` (`Dockerfile:1-96`, `next.config.ts:17`). Entrypoint runs **`prisma db push --accept-data-loss` then `node scripts/seed.mjs` on every container start** (`scripts/entrypoint.sh:20-31`, `Dockerfile:95`).
- ECS Fargate, 1 task, 512 CPU / 1024 MB (`ecs.tf:123-262`, `variables.tf:75-88`); ALB (HTTP :80) → CloudFront (TLS, `PriceClass_100`, default behavior forwards all headers + all cookies, TTL 0) (`cloudfront.tf:1-106`, `alb.tf`). Custom domain `platform.tenurework.com`, `attach_custom_domain` default `false` (`variables.tf:128-145`).
- Provisioned but **entirely unused by application code** (grep: zero imports of Redis/SQS/SES clients in `src/` or `scripts/`): ElastiCache Redis 7.1 `cache.t3.micro` (`elasticache.tf`), three SQS queues + two DLQs (`sqs.tf`), SES domain identity `tenurework.com` + config set (`ses.tf`). `REDIS_URL`, `SQS_*_URL`, `SES_FROM_EMAIL` are injected as env vars (`ecs.tf:144-151`) and never read.
- S3: two buckets, `tenure-pilot-documents-<acct>` (versioned, SSE-KMS, `tmp/` 1-day lifecycle, **CORS `allowed_origins = ["*"]`**) and `tenure-pilot-exports-<acct>` (`s3.tf:1-73`).
- Secrets Manager: `tenure-pilot/app` (AUTH_SECRET, OKTA_*) and `tenure-pilot/job` (JOB_SECRET) (`secrets.tf:1-23`, `scheduler.tf:16-25`).
- CI: `.github/workflows/deploy.yml` uses **non-standard secret names** `secrets.ACCESSKEYID` / `secrets.SECRETACCESSKEY` (`deploy.yml:43-44`), `TF_VAR_anthropic_api_key` (`:167`).

## 2. PRISMA MODELS — COMPLETE LIST WITH PK STRATEGY AND TENANT COLUMNS

**Every model uses `String @id @default(cuid())`** except the three noted. There are **no UUIDs, no composite tenant-scoped PKs, no `@@schema`, no `@@map`**. Total: 39 models, 21 enums.

Legend: **I** = has `institutionId`; **I→** = `institutionId` *with* a declared `Institution` relation; **O** = has `organizationId`; **—** = neither.

| # | Model | line | PK | Tenant cols | Notes / uniqueness that is GLOBAL |
|---|---|---|---|---|---|
| 1 | `Account` | 19 | cuid | — | `@@unique([provider, providerAccountId])` |
| 2 | `Session` | 38 | cuid | — | `sessionToken @unique` |
| 3 | `VerificationToken` | 47 | **no `@id`**; `token @unique`, `@@unique([identifier,token])` | — | |
| 4 | `Institution` | 58 | cuid | *is the tenant* | `slug @unique`; `timeZone` default `"America/New_York"` (`:67`) |
| 5 | `InstitutionMembership` | 87 | cuid | **I→** | `@@unique([userId, institutionId])`, `@@index([institutionId, role])` |
| 6 | `User` | 101 | cuid | **—** | `email @unique` **globally**. Users are cross-tenant by construction |
| 7 | `Organization` | 134 | cuid | **I→** | **`slug @unique` GLOBALLY (`:142`)** — the single biggest schema blocker |
| 8 | `Role` (seat) | 188 | cuid | **O** only | **`positionCode @unique` GLOBALLY (`:198`)**; `@@unique([organizationId,name])` |
| 9 | `Deliverable` | 222 | cuid | **I→** | **`key @unique` GLOBALLY (`:226`)** — not `@@unique([institutionId,key])` |
| 10 | `DeliverableReminder` | 256 | cuid | — | `@@unique([deliverableId,userId])` |
| 11 | `DirectoryPerson` | 275 | cuid | **—** | **`email @unique` GLOBALLY (`:278`)**; directory is institution-agnostic |
| 12 | `SeatHolding` | 301 | cuid | — | `@@unique([roleId,personId,term])`; `term` is a string "2026-2027" |
| 13 | `OrganizationAdvisor` | 317 | **composite `@@id([organizationId, personId])`** | **O** | |
| 14 | `RoleAssignment` | 341 | cuid | **—** | tenancy only via `role → organization` |
| 15 | `ApprovalRequest` | 380 | cuid | **I** (scalar, *no relation*) + **O** | `idempotencyKey @unique` global; `@@index([institutionId,status])` |
| 16 | `ApprovalStep` | 405 | cuid | — | append-only; `policySnapshot Json` |
| 17 | `Event` | 438 | cuid | **I** (scalar) + **O** | `approvalId @unique` |
| 18 | `ConflictRecord` | 473 | cuid | — | |
| 19 | `Conversation` | 498 | cuid | **I** (scalar) + **O nullable** | `approvalId @unique` |
| 20 | `Participant` | 517 | cuid | — | `@@unique([conversationId,userId])` |
| 21 | `Message` | 534 | cuid | — | immutable |
| 22 | `Attachment` | 552 | cuid | — | `objectKey` S3 |
| 23 | `Delivery` | 565 | cuid | — | |
| 24 | `Document` | 581 | cuid | **I** (scalar) + **O** | `objectKey` S3; `isArchived` soft delete |
| 25 | `MemoryRecord` | 615 | cuid | **I** (scalar) + **O** + `roleId?` | |
| 26 | `Budget` | 643 | cuid | **I** (scalar) + **O** | `@@unique([organizationId,period,academicYear])` |
| 27 | `Transaction` | 669 | cuid | **—** | via `budgetId` |
| 28 | `BudgetLine` | 690 | cuid | **O only — no institutionId** | `@@unique([organizationId,academicYear,category])` |
| 29 | `Vendor` | 714 | cuid | **I** (scalar) + **O** | |
| 30 | `LedgerEntry` | 745 | cuid | **O only — no institutionId** | links approval/vendor/document |
| 31 | `FeedPost` | 784 | cuid | **I** (scalar) + **O** | `@@index([institutionId,createdAt])` |
| 32 | `FeedComment` | 804 | cuid | **—** | |
| 33 | `CollabInterest` | 821 | cuid | **O only** | `@@unique([postId,organizationId])` |
| 34 | `Notification` | 840 | cuid | **—** | per-user only |
| 35 | `NotificationPreference` | 854 | cuid | **—** | `@@unique([userId,channel])` |
| 36 | `AuditEvent` | 868 | cuid | **I→** + `organizationId?` scalar | `institution` relation has **no `onDelete`** (default Restrict) `:871` |
| 37 | `RoleTransfer` | 901 | cuid | **I→** cascade | |
| 38 | `ApprovalDelegation` | 930 | cuid | **I→** cascade | |
| 39 | `Resource` | 967 | cuid | **I→** cascade | **only model with a correct composite tenant key: `@@unique([institutionId, key])` (`:994`)** |

`Institution` declares back-relations for exactly 7 models (`:71-77`): `organizations, memberships, auditEvents, deliverables, roleTransfers, approvalDelegations, resources`. **The other 8 models carrying `institutionId` (`ApprovalRequest`, `Event`, `Conversation`, `Document`, `MemoryRecord`, `Budget`, `Vendor`, `FeedPost`) hold it as a bare denormalized string with no FK, no cascade, and no referential integrity.**

Models with **no tenant column at any depth of denormalization** (reachable only by join): `RoleAssignment`, `ApprovalStep`, `ConflictRecord`, `Participant`, `Message`, `Attachment`, `Delivery`, `Transaction`, `FeedComment`, `Notification`, `NotificationPreference`, `DeliverableReminder`, `SeatHolding`, `DirectoryPerson`, `User`.

Schema header comment claims "Every business record resolves to a tenant boundary (institutionId)" (`prisma/schema.prisma:4`) — the table above shows this is aspirational, not enforced.

## 3. HOW "TENANT" IS REPRESENTED TODAY, AND EVERY SINGLE-INSTITUTION ASSUMPTION

`Institution` (`schema.prisma:58-78`) is the declared tenant root: `slug @unique`, optional `domain` for "verified email matching" (never read anywhere in `src/`), `timeZone`. **There is exactly one Institution row in practice**, created by the seed.

**Seed hardcoding** (`scripts/seed.mjs`): upsert `where: { slug: "rochester" }`, name `"University of Rochester"`, domain `"rochester.edu"` (`:30-37`). Seven demo login users `*@tenure.demo` (`:47-53`), of which `director@tenure.demo` = `OSE_DIRECTOR` and `staff@tenure.demo` = `OSE_STAFF` (`:55-64`). Demo assignments hardcode `findUniqueOrThrow({ where: { slug: "simon-consulting-club" } })` (`:265-267`) and `{ slug: "simon-women-in-business" }` (`:294`). Every club, seat, deliverable, resource and budget line is created with `institutionId: institution.id` from that single row. The seed also does destructive global writes: `db.approvalDelegation.deleteMany({})` with **no tenant filter** (`:325`), and archives every org not in the current roster scoped by `institutionId` (`:257-260`). This seed runs on **every container boot** (`scripts/entrypoint.sh:26-27`).

**`institutionRoles[0]` — "the acting institution" is always the first membership**, ordered `institutionId asc` for stability (`src/lib/rbac.ts:29-31`):
- `src/lib/admin/guard.ts:23` — `requireAdminContext()`: `const institutionId = ctx.institutionRoles[0].institutionId`. **Every admin page** derives its whole scope from this.
- `src/lib/admin/guard.ts:58` — `requireCapability()`: `opts?.institutionId ?? ctx.institutionRoles[0]?.institutionId`. Callers that pass no `institutionId` therefore act on membership #0: `adminAddDirectoryPerson` (`admin/actions.ts:309`), `adminGrantInstitutionRole` (`:331`), `adminRevokeInstitutionRole` (`:438`), `initiateRoleTransfer` (`:499`).
- `src/app/(app)/admin/layout.tsx:21`, `src/app/(app)/reports/page.tsx:22`, `src/app/(app)/reports/finance/page.tsx:27`, `src/app/api/reports/pulse/route.ts:19`, `src/lib/institution-time.ts:33`, `src/lib/resources-data.ts:91`, `src/app/(app)/settings/page.tsx:42,121-122`, `src/app/(app)/settings/actions.ts:81`, `src/app/(app)/messages/actions.ts:157,220,323`.

**"Any OSE membership at all" used as a boolean**, ignoring which institution: `isAdmin(ctx) { return ctx.institutionRoles.length > 0 }` (`src/lib/admin/capabilities.ts:160-162`, used as the sole gate in `requireAdminContext` `guard.ts:22` and `api/admin/directory/route.ts:15`); `messagingTier` returns `"OSE"` on `length > 0` (`src/lib/messaging.ts:59`); nav `showReports`/`showAdmin` (`src/app/(app)/layout.tsx:38-39`); `src/app/(app)/resources/page.tsx:27`; `src/app/(app)/dashboard/page.tsx:256`.

**Cross-tenant reads that will leak on day one of multi-tenancy:**
- `src/lib/calendar-write.ts:456-464` `loadEditableEvent`: visible if OSE **or** club member **or** `event.status === "PUBLISHED"` — *any authenticated user of any institution can read any PUBLISHED event* via `GET /api/calendar/event/[id]`.
- `src/lib/messaging.ts:36-40` `OSE_BROADCAST` readable by `ctx.orgRoles.some(r => ACTIVE || SHADOW)` with **no institution comparison** — a member of institution B can read institution A's broadcast.
- `src/app/(app)/feed/actions.ts:62-65` `addFeedComment`: `ctx.institutionRoles.some(m => m.institutionId === post.institutionId) || ctx.orgRoles.some(r => r.status === "ACTIVE")` — the second clause is tenant-blind.
- `src/lib/directory.ts:33-60` `SeededDirectoryProvider.search/getByEmail`: queries `DirectoryPerson` with **no tenant predicate at all**; exposed through `GET /api/admin/directory` to any admin of any institution.
- `src/app/api/profile-image/[userId]/route.ts:22-25`: any signed-in user, any user id, no tenant check (documented as intentional).
- `src/app/(app)/orgs/[slug]/**`: every page/action resolves `db.organization.findUnique({ where: { slug } })` (`documents/actions.ts:22`, `memory/actions.ts:14`, `members/actions.ts:20`, `finance/actions.ts:26,309`, `finance/page.tsx:24`, `memory/page.tsx:45`, `impact/page.tsx:37`, `documents/page.tsx:36`) then relies on `canViewOrg`/`canContribute` for safety. Correct today *only because `slug` is globally unique*. The one place that re-checks tenancy explicitly is `src/app/(app)/admin/clubs/[slug]/page.tsx:52` — `if (!org || org.institutionId !== institutionId) notFound()`.
- `src/lib/clubs.ts:84-86` `chartClub`: uniqueness check is `findUnique({ where: { slug } })` across all institutions — institution B cannot charter a club whose name collides with institution A's.
- `src/lib/clubs.ts:49-60` + `admin/actions.ts:257-260`: `positionCode` collision resolution loops **globally** (`tx.role.findUnique({ where: { positionCode } })`).

**Tenant-resolution fallbacks for non-OSE users** (three separate, subtly different implementations of the same idea): `src/lib/institution-time.ts:30-44` (`orderBy: { id: "asc" }`, falls back to `DEFAULT_TIME_ZONE`), `src/lib/resources-data.ts:90-100` (`orderBy: { id: "asc" }`, returns `null`), `src/app/(app)/settings/actions.ts:75-90` (`presidentOrgIds[0]`). A user with clubs at two institutions silently gets one arbitrary answer.

**Institution-specific content compiled into the binary**: `src/lib/policies.ts` — the entire policy corpus is a hardcoded TS array with Rochester/Simon-specific text, named OSE staff (`:137-139,401-403`), and `simon.rochester.edu` addresses (`:185,242`); consumed by `src/app/(app)/resources/[slug]/page.tsx:8`. Also `src/lib/resources.ts:75` `OSE: "Ainslie OSE"`, hardcoded "Ainslie OSE" strings in `resources-data.ts:193,246,292`, `calendar/page.tsx:193`, error pages, and `@rochester.edu` placeholders across admin/member forms.

## 4. AUTHORIZATION MODEL

Two parallel systems that do not share code.

### 4a. `src/lib/rbac.ts` (read in full)

**Context loader** — `getUserContext(userId)` (`:24-55`), wrapped in React `cache()` so it is one round-trip per request. Two parallel queries: `institutionMembership.findMany({ where: { userId } })` (**no institution filter — it loads every institution the user belongs to**) and `roleAssignment.findMany({ where: { userId } })` with all statuses. Shape (`:15-21`): `{ userId, institutionRoles: {institutionId, role}[], orgRoles: {organizationId, roleId, roleName, scope, status}[] }`.

**Roles.** Institution roles = `enum InstitutionRole { OSE_DIRECTOR | OSE_STAFF | OSE_ADVISOR }` (`schema.prisma:80-84`). Seat scopes = `enum RoleScope { PRESIDENT | FUNCTIONAL | MEMBER }` (`:328-332`). Seat statuses = `enum AssignmentStatus { SHADOW | ACTIVE | ALUMNI }` (`:335-339`) — SHADOW = read-only pre-term, ALUMNI = record kept, access revoked.

**Pure predicates** (no DB, unit-tested in `src/lib/rbac.test.ts`):

| fn | line | rule |
|---|---|---|
| `isOse(ctx, instId)` | 60-62 | any membership at that institution |
| `isOseDirector(ctx, instId)` | 64-68 | `OSE_DIRECTOR` at that institution |
| `canViewOrg` | 80-88 | OSE at org's institution, **or** own seat SHADOW/ACTIVE |
| `canManageRoster` | 95-103 | OSE **Director**, or own club ACTIVE `PRESIDENT` |
| `canListAllOrgs` | 106-108 | `isOse` |
| `canManageOrg` | 116-123 | any OSE, or ACTIVE `PRESIDENT` |
| `canContribute` | 126-132 | any OSE, or **any ACTIVE seat** in the org |
| `canManageResources` | 146-152 | `OSE_DIRECTOR` or `OSE_STAFF` (Advisor read-only) |
| `isFinanceRole(name)` | 155-157 | regex `/financ\|treasur\|\bcfo\b\|chief financ\|chief operating\|\bcoo\b/i` |
| `canViewFinance` | 166-170 | delegates to `canViewOrg` |
| `canManageFinance` | 177-187 | OSE Director, or ACTIVE `PRESIDENT`, or ACTIVE seat matching `isFinanceRole` |

Every predicate takes `org: { id, institutionId }` and compares `institutionId` — **the pure layer is already correctly tenant-parameterized.** The leakage is entirely at call sites that pick the wrong institution or skip the check.

### 4b. `src/lib/admin/capabilities.ts` — the admin capability table

16 `CapabilityId`s (`:19-36`): `club.create|edit|archive|image`, `role.assign|remove|transfer`, `seat.manage`, `directory.manage`, `institution.grantRole|transferRole`, `approval.override`, `event.override`, `content.override`, `budget.override`, `audit.view`. Strict rank hierarchy `OSE_ADVISOR=1 < OSE_STAFF=2 < OSE_DIRECTOR=3` (`:45-49`); each capability declares `minRole` (`:51-148`). `adminRoleAt(ctx, instId)` picks the highest role *at that institution* (`:151-157`); `hasCapability` = `RANK[role] >= RANK[cap.minRole]` (`:164-172`).

### 4c. How checks actually happen at call sites

- **RSC pages**: `const session = await auth(); if (!session?.user?.id) redirect("/signin")` → `getUserContext` → predicate → `notFound()`. E.g. `orgs/page.tsx:70-83`, `reports/page.tsx:22-23`, `orgs/[slug]/impact/page.tsx:37-40`. **Admin pages** instead call `requireAdminContext()` (`src/lib/admin/guard.ts:13-25`) which does `isAdmin(ctx)` → `notFound()` and returns `institutionRoles[0]`; then `hasCapability(...)` per-section (`admin/audit/page.tsx:34-35`, `admin/approvals/page.tsx:20-21`, `admin/overrides/page.tsx:25-30`, `admin/clubs/[slug]/page.tsx:34,52-61`). Reads are deliberately **not** audited (`guard.ts:10-12`).
- **Server actions** (14 files with `"use server"`): each re-authenticates via `auth()`, re-loads the entity from the id in `FormData`, and applies a predicate. There is no shared wrapper for the club-side actions — the pattern is copy-pasted (`approvals/actions.ts:54-58`, `documents/actions.ts:17-27`, `members/actions.ts:16-40` which additionally writes a DENY `AuditEvent` before throwing). **Admin actions** all funnel through `requireCapability()` (`src/lib/admin/guard.ts:39-80`), which is the only gate that writes an `AuditEvent` for **both ALLOW and DENY** (`:63-78`) before throwing.
- **Route handlers** (`src/app/api/**`): same manual pattern — `auth()` → 401, then entity load → predicate → 403. `attachment/[id]/route.ts:19-42` (`canReadConversation`), `org-image/[orgId]/route.ts:21-30` (`canViewOrg`), `documents/[id]/content/route.ts:28-45` (`canViewOrg` + optional `?slug=` match), `calendar/reschedule/route.ts:27-41` (delegates all permission logic to `lib/calendar-write`), `search/route.ts:11` + `ai/chat/route.ts:22` (rely wholly on `loadSearchCorpus` scoping), `reports/pulse/route.ts:15-22` (`institutionRoles[0]` or 403), `notifications/route.ts` (scoped by `session.user.id` only), `api/jobs/reminders` (bearer token — see §6).

## 5. WORKFLOW / STATE MACHINES

**Approvals — `src/lib/approvals.ts` (pure, no DB).** 7 states: `enum ApprovalStatus { DRAFT | PENDING_PRESIDENT | NEEDS_CHANGES | PENDING_OSE | APPROVED | REJECTED | CANCELLED }` (`schema.prisma:369-377`). 6 actions: `submit | approve | request_changes | reject | resubmit | cancel` (`approvals.ts:16-22`). `actorRoles()` (`:33-48`) computes `{isRequester, isPresident (ACTIVE PRESIDENT in that org), isOseGate (isOse at approval.institutionId), canAdmin}`. `availableActions()` (`:51-76`) is a switch over current status. `nextStatus()` (`:82-116`): `submit`/`resubmit` → `PENDING_OSE` if `requesterIsPresident` else `PENDING_PRESIDENT` (**presidents skip their own gate**); `approve` PENDING_PRESIDENT→PENDING_OSE, PENDING_OSE→APPROVED; `request_changes`→NEEDS_CHANGES; `reject`→REJECTED; `cancel` from DRAFT/PENDING_*/NEEDS_CHANGES→CANCELLED. APPROVED/REJECTED/CANCELLED terminal.
Executor: `src/app/(app)/approvals/actions.ts`. `createApproval` (`:72-147`) requires an ACTIVE seat in the org, takes `institutionId` **from the org** (`:105`), writes `ApprovalRequest` + `ApprovalStep` + `AuditEvent` in one `$transaction`. `actOnApproval` (`:149-352`) is the hot path: permission → delegation fallback → `nextStatus` → linked-`Event` lifecycle (APPROVED→`PUBLISHED`, REJECTED/CANCELLED→`CANCELLED`, `:213-222`) → **idempotent reimbursement auto-post** to `LedgerEntry` + `BudgetLine.actualCents` recompute (`:224-276`) → one `$transaction` writing status + append-only `ApprovalStep` + `AuditEvent` (`:278-313`) → notifications (`:315-343`).
Admin bypass: `adminDecideApproval` (`admin/actions.ts:380-430`) force-sets APPROVED/REJECTED under `approval.override`, recording `actorRoleContext: "OSE Override"` and `policySnapshot: { override: true }`.
Aging: `src/lib/approvals-sla.ts:19-33` — pure calendar-day SLA, `ok`/`attention` (≥3d)/`overdue` (≥6d).

**Delegation — `src/lib/delegation.ts:14-35`.** `effectiveApprovalContext(userId, ctx, institutionId)` loads `approvalDelegation.findMany({ toUserId, revokedAt: null, institutionId })` (correctly institution-scoped) and **merges the delegators' `institutionRoles` and `orgRoles` into the actor's context** while preserving `ctx.userId`. Used only as a fallback when the direct check fails (`approvals/actions.ts:163-173`), and records `onBehalfOf` on the `ApprovalStep.policySnapshot` and the `AuditEvent.metadata` (`:296,310`). Grant/revoke: `settings/actions.ts:104-164`; eligibility (`:93-102`) = OSE at the same institution, or ACTIVE seat in one of the delegator's president-orgs; one active delegation at a time (`:121-127`).

**Institution role transfer (`RoleTransfer`, 4 states `PENDING|COMPLETED|DECLINED|CANCELLED`, `schema.prisma:894-924`).** `initiateRoleTransfer` (`admin/actions.ts:492-568`) — requires `institution.transferRole`, verifies the actor currently holds `OSE_DIRECTOR`, upserts the successor `User` by email, enforces one open transfer, records `stepDownRole` (`OSE_STAFF` or null=revoke). `acceptRoleTransfer` (`:576-655`) — only `transfer.toUserId`; **one `$transaction`: upsert successor membership → step initiator down or delete → close COMPLETED → audit**. `declineRoleTransfer` (`:659-702`), `cancelRoleTransfer` (`:706-752`, initiator or any Director). Zero-Director guards live in `adminGrantInstitutionRole` (`:342-362`) and `adminRevokeInstitutionRole` (`:449-462`).

**Seat transfer (club-level)** — `adminTransferSeat` (`admin/actions.ts:189-239`): ends all ACTIVE holders as `ALUMNI` + creates the new ACTIVE assignment in one `$transaction`. `adminRemoveAssignment` (`:143-187`) allows hard-delete only for `SHADOW`.

**Calendar/event state machine** — `enum EventStatus { DRAFT|PENDING_APPROVAL|APPROVED|PUBLISHED|CANCELLED }` (`schema.prisma:422-428`), driven by the approval above plus `adminSetEventStatus` (`admin/actions.ts:756-776`). Conflict detection is pure (`src/lib/calendar.ts:46-...`, HARD/SOFT/INFORMATIONAL) and re-run on every write; candidate set is scoped `where: { institutionId: event.institutionId, ... }` (`src/lib/calendar-write.ts:182-198`) — **conflict detection is already institution-scoped and is the one place the denormalized `Event.institutionId` is load-bearing for correctness.**

## 6. BACKGROUND / SCHEDULED WORK

**Only one job exists**: `POST /api/jobs/reminders` (`src/app/api/jobs/reminders/route.ts`).
- **Identity**: a static shared bearer token. `process.env.JOB_SECRET` compared to the `Authorization: Bearer …` header (`:22-30`); 503 if unset, 401 on mismatch. **There is no user session, no `UserContext`, and no institution parameter** — the job runs with implicit superuser reach.
- **Scope**: `db.deliverable.findMany({ where: { dueAt: { gt: now, lte: now+24h } } })` — **no institution filter** (`:35-38`); then `db.roleAssignment.findMany({ where: { status: { in: ["ACTIVE","SHADOW"] } } })` — **every seat holder at every institution** (`:46-49`). Matching is by seat-key string only (`deliverable.seat === "ALL" || seats.has(deliverable.seat)`, `:69`). With two institutions, institution A's deliverable notifies institution B's officers.
- Idempotency: `DeliverableReminder` unique `(deliverableId, userId)` + `createMany({ skipDuplicates: true })` (`:89-95`), written *after* notifying, deliberately (`:87-88`).
- **EventBridge wiring** (`infrastructure/terraform/scheduler.tf`): `random_password.job_secret` (48 chars) → Secrets Manager `tenure-pilot/job` (`:11-25`) → injected into ECS as the `JOB_SECRET` secret (`ecs.tf:182-185`). An `aws_cloudwatch_event_connection` of type `API_KEY` puts `Authorization: Bearer <secret>` on the request (`:61-71`); `aws_cloudwatch_event_api_destination.reminders` targets `https://<cloudfront|custom-domain>/api/jobs/reminders` (`:73-88`) — **through CloudFront, because EventBridge requires HTTPS and the ALB is HTTP-only** (`:76-80`). Schedule is an **EventBridge Rule, not EventBridge Scheduler** (`:90-105`, with the reason documented): `cron(0 13 * * ? *)`. Target sends `input = "{}"`, retry 3× / 3600s (`:107-119`). IAM role `tenure-pilot-scheduler` may only `events:InvokeApiDestination` on that one ARN (`:28-58`).
- Manual verification path: `.github/workflows/verify-reminders.yml` (workflow_dispatch) reads the secret and curls the endpoint, with the CloudFront host `d1n6mdis7bs02g.cloudfront.net` hardcoded (`:52,57`).
- The SQS queues and `AUTH`/SES plumbing that would normally back "background work" are provisioned but **no worker or consumer exists in the codebase**.

## 7. NON-DATABASE STORES NEEDING TENANT ISOLATION

**S3** — one shared bucket, `S3_DOCUMENTS_BUCKET`, accessed through a single client in `src/lib/s3.ts:5` with `getDocumentBytes`/`uploadDocument`/`documentDownloadUrl` (600s presign, `:38-49`)/`documentViewUrl` (600s, `:52-63`). Key prefixes, **inconsistently tenant-scoped**:
- Documents: `${org.institutionId}/${org.id}/${Date.now()}-${safeName}` — ✅ tenant-prefixed (`orgs/[slug]/documents/actions.ts:37`, `orgs/[slug]/finance/actions.ts:343`).
- Message attachments: `message-attachments/${messageId}/…` — ❌ no tenant (`messages/actions.ts:21`).
- Club images: `org-images/${org.id}/…` — ❌ no institution (`orgs/actions.ts:112`).
- Profile images: `profile-images/${userId}/…` — ❌ no tenant (`settings/actions.ts:57`).
IAM grants the task `s3:GetObject/PutObject/DeleteObject` on `bucket/*` with no prefix condition (`ecs.tf:79-89`); bucket CORS is `allowed_origins = ["*"]` (`s3.tf:46`). **Isolation is purely application-level: a presigned URL is minted only after a permission check, and object keys are never user-controlled.**

**Cache** — no application cache exists. Redis is provisioned and `REDIS_URL` injected, never imported. The only caching is per-request React `cache()` (`rbac.ts:24`, `institution-time.ts:17,30`) and CloudFront, whose default behavior is `default_ttl = 0` with all cookies/headers forwarded (`cloudfront.tf:69-88`) — so no cross-tenant CDN cache risk today, but also no cache to key by tenant later. `/api/health` holds a 5s process-local boolean (`api/health/route.ts:26-27`).

**Search** — `src/lib/search.ts` is **pure in-memory ranking** (`tokenize`/`scoreDoc`/`makeSnippet`/`rankDocs`, `:21-66`); there is no index, no external engine. The security boundary is entirely `src/lib/search-data.ts:13-112` `loadSearchCorpus(userId)`: resolves `oseInstitutionIds` from `ctx.institutionRoles` and `memberOrgIds` from SHADOW/ACTIVE seats (`:15-18`), loads orgs `WHERE institutionId IN oseInstitutionIds OR id IN memberOrgIds` (`:20-28`), then loads memory/documents/approvals/events **filtered by that `orgIds` list** (`:32-49`) with `canSeeMemoryCard` applied per record (`:56`). **This is the best-scoped surface in the codebase** — one caveat: approvals also include `{ submittedById: userId }` regardless of org (`:42`). The same corpus feeds `/search`, `/api/search` and `/api/ai/chat`.

**AI** — `src/lib/ai.ts:14-64` posts to `api.anthropic.com/v1/messages` with `ANTHROPIC_API_KEY` (default model `claude-haiku-4-5-20251001`, `:21`). **One global API key for all tenants**; prompt content is whatever `loadSearchCorpus` returned, so tenant isolation is inherited from retrieval, not enforced at the boundary. No per-tenant key, quota, or opt-out.

**Notifications** — DB-only, per-user rows: `notifyUsers()` bulk-creates `Notification` (`src/lib/notify.ts:4-18`); recipient resolvers `orgPresidentIds` / `oseMemberIds(institutionId)` / `orgCurrentMemberIds` (`:21-45`). Read/write API scoped strictly by `session.user.id` (`api/notifications/route.ts`). **No email is ever sent** — SES is provisioned, `SES_FROM_EMAIL` injected, and the only outbound-email code in the app is `mailto:` links (`src/components/EmailLink.tsx:19`). `NotificationPreference`/`NotificationChannel` exist in the schema but nothing reads them.

**ICS feed** — `GET /api/calendar/ics/[token]` (`src/app/api/calendar/ics/[token]/route.ts`), `dynamic = "force-dynamic"`. **Unauthenticated by design**: identity is an HMAC-SHA256 token `base64url(userId).base64url(mac)` keyed on `process.env.AUTH_SECRET` with a dev fallback literal `"tenure-dev-calendar-secret"` (`src/lib/calendar-sync.ts:38-57`). Tokens are **stable and永-lived — never rotated, never revocable** (no DB row; rotating `AUTH_SECRET` invalidates all of them at once, which `.github/workflows/rotate-auth-secret.yml` exists to do). Content comes from `loadScopedEvents(userId, …)` (`src/lib/calendar-data.ts:25-79`), so it is scoped identically to the calendar page: OSE institutions ∪ member orgs ∪ `PUBLISHED` events at member institutions (`:49-53`). Response is `cache-control: public, max-age=1800` — **a public cache directive on per-user data**, currently safe only because the token is in the path.

## 8. ALREADY MULTI-INSTITUTION-CAPABLE vs. HARDCODED TO ONE

**Already capable (data model + logic accept N institutions):**
- The whole pure RBAC layer: every predicate compares `institutionId` (`rbac.ts:60-187`), and `rbac.test.ts:55` explicitly asserts an `other_inst` Director gets no access.
- `getUserContext` loads *all* memberships and org roles (`rbac.ts:25-42`) — a user can already legitimately hold roles at several institutions.
- `hasCapability` / `adminRoleAt` are per-institution (`capabilities.ts:151-172`).
- Scoped list surfaces that already use `IN (institutionIds)` rather than a scalar: `loadScopedEvents` (`calendar-data.ts:32-53`), `loadSearchCorpus` (`search-data.ts:15-28`), `orgs/page.tsx:75-83`, `dashboard/page.tsx:39-50`, `approvals/page.tsx:28`, `feed/page.tsx:40`, `messages/page.tsx:39,74-75`, `messages/actions.ts:63-70`, `calendar/page.tsx:69-70,170-176`.
- `Resource` is the model done right: `@@unique([institutionId, key])`, `listResources(institutionId)`, and writes that re-derive the institution from the record rather than the form (`resources-data.ts:67-100,233-307`; note in `resources/actions.ts:15-19`).
- Per-institution timezone (`Institution.timeZone`, `institution-time.ts`), audit trail keyed `@@index([institutionId, occurredAt])`, delegation/role-transfer both institution-scoped.
- Conflict detection scoped by `institutionId` (`calendar-write.ts:183`).

**Hardcoded to one institution / will break or leak:**
1. `Organization.slug @unique` global (`schema.prisma:142`) + all `/orgs/[slug]` routing and `chartClub`'s uniqueness check (`clubs.ts:85`). **Highest-priority schema change.**
2. `Role.positionCode @unique` global (`:198`) and the global collision loop (`clubs.ts:55`).
3. `Deliverable.key @unique` global (`:226`) and `DirectoryPerson.email @unique` global (`:278`) — the directory has no tenant column at all.
4. `institutionRoles[0]` as "the acting institution" in `requireAdminContext` and `requireCapability`'s default (`guard.ts:23,58`) — the admin console has **no institution selector**; a two-institution admin silently administers only the lowest-id one, and four admin actions (`directory.manage`, `institution.grantRole`, `institution.transferRole`, and revoke) never pass an explicit `institutionId`.
5. `isAdmin(ctx) = institutionRoles.length > 0` as an authorization decision (`capabilities.ts:160-162`) and the equivalent `length > 0` checks in nav, messaging tier, resources, dashboard.
6. Tenant-blind predicates: `loadEditableEvent`'s `status === "PUBLISHED"` clause (`calendar-write.ts:463`), `OSE_BROADCAST` read rule (`messaging.ts:39`), `addFeedComment` (`feed/actions.ts:64`), the directory provider and its API route.
7. The reminders job: no institution filter on either query (`api/jobs/reminders/route.ts:35-49`), and no tenant identity in its authentication model.
8. The seed: single hardcoded `slug: "rochester"` institution, hardcoded club slugs, and an untenanted `approvalDelegation.deleteMany({})` — executed on every production container start (`entrypoint.sh:20-31`).
9. Eight models carry `institutionId` as a **bare denormalized string with no FK** (`ApprovalRequest`, `Event`, `Conversation`, `Document`, `MemoryRecord`, `Budget`, `Vendor`, `FeedPost`) — nothing prevents a write from stamping the wrong tenant; and `BudgetLine`, `LedgerEntry`, `CollabInterest` carry only `organizationId`.
10. No DB-level defence in depth: no RLS, no Prisma client extension, no `middleware.ts`, no tenant in the JWT — **every one of the ~61 files touching `institutionId` (384 occurrences) is an independent opportunity to omit the filter.**
11. Institution-specific content compiled in: `src/lib/policies.ts` (entire file), `resources.ts:75`, "Ainslie OSE" and `@rochester.edu` literals across UI.
12. Infrastructure is single-tenant-shaped: one RDS instance/database, one S3 bucket, one Redis, one SES identity (`tenurework.com`), one CloudFront distribution, `desired_count = 1`, and `AUTH_DEV_LOGIN=true` in production (`ecs.tf:157`) meaning **any known email signs in as that user with no password**.