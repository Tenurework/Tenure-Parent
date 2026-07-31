# ADR-0004 — The schema changes that make a second tenant possible

- **Status:** Proposed — five product decisions outstanding (below)
- **Date:** 2026-07-31
- **Full plan:** [`docs/architecture/tenant-scoped-schema-plan.md`](../architecture/tenant-scoped-schema-plan.md) — M0–M12, with per-step SQL, backfills, lock assessments, verification queries and rollbacks
- **Builds on:** ADR-0001 (migration vehicle), ADR-0002 (the enforced chokepoint)

## Context

ADR-0002 put a tenant predicate on every query and ADR-0002's follow-up switched
it to enforcing. Isolation now holds for the 15 models that carry
`institutionId`. None of that lets a second tenant exist.

There is one `Institution` row, created by the only `institution` write in the
repository — `apps/web/scripts/seed.mjs:29-36`, hardcoded to `slug: "rochester"`.
Four independent classes of defect stand between that and a second one.

**1. Five uniques are global where they should be per-tenant.**

| Constraint | Failure with tenant B |
|---|---|
| `Organization.slug` | `clubs.ts:85` rejects B's club because A used the name — a wrong error, not a collision |
| `Role.positionCode` | `uniquePositionCode` renames B's genuine `CC-PRES` to `CC-PRES-2` |
| `Deliverable.key` | `seed.mjs` upserts on `key` alone; seeding B takes the **UPDATE** branch and rewrites A's 34 rows |
| `DirectoryPerson.email` | `admin/actions.ts:315` upserts on `email`; B's admin silently overwrites A's person |
| `ApprovalRequest.idempotencyKey` | dead column, zero call sites; latent |

**2. Nineteen models carry tenant-owned data with no tenant column.**
`decideScope` returns `pass-through` for every one, enforcement or not.

**3. Eight models carry `institutionId` as bare, unvalidated TEXT** with no
foreign key — so nothing detects a row whose `institutionId` and relations
disagree.

**4. Nine `*Id` columns have no foreign key at all**, including
`AuditEvent.organizationId`. Audit is append-only by design, so a wrong
cross-tenant reference there is permanent.

Two things earlier analysis got wrong, corrected by reading: a code path **does**
create two institutions (`isolation.itest.ts`) — it works only because it gives
them different slugs. And `DirectoryPerson` is not unreachable: all 172 rows
resolve through `SeatHolding → Role → Organization` or
`OrganizationAdvisor → Organization`, with zero orphans locally.

## Decision

Expand-and-contract, in twelve steps, governed by six rules. The rules are the
part worth stating here; the steps are in the full plan.

**R1 — Expand adds a NULLABLE column. Never `NOT NULL`, never a DEFAULT.**
Prisma rejects a missing required scalar *client-side*: once `institutionId` is
required, the generated input type demands it, and no database trigger can
rescue the write because Prisma never emits the INSERT. A required column
therefore breaks ~41 write sites in the new release. `SET NOT NULL` waits for
contract. A DEFAULT is out because Prisma models column defaults and CI's drift
gate would go red.

**R2 — No `RAISE EXCEPTION` inside a migration.** Backfills are total; rows they
cannot classify stay NULL and are quarantined. Preconditions run as preflight
queries before the deploy. The reason is ADR-0001's own trap: a migration that
aborts leaves a `finished_at NULL` ledger row and P3009 locks out every image.

**R3 — Migrations run from an in-VPC `RunTask` stage, not container boot**, with
`lock_timeout` and `statement_timeout` set per file. Prisma wraps a migration in
one transaction, so an ACCESS EXCLUSIVE lock taken by the first statement is
held to the last; lock *acquisition* is unbounded and queues every reader behind
it. `entrypoint.sh` pins `connection_limit=5`, so five blocked requests exhaust
the pool, `/api/health` 503s, and the ALB kills the only task in ~90s.

**R4 — One table per migration file.** Nine brief exclusive locks, not one long
one.

**R5 — Nothing is dropped until after enforcement.** A tenant-leading index
cannot serve an equality-on-`organizationId` lookup, so dropping the original
early gives strictly worse plans for the whole migration window.

**R6 — Composite FKs land in contract, not expand.** Postgres FKs are MATCH
SIMPLE: any NULL referencing column satisfies them unconditionally, so a
composite FK on a nullable denormalised column enforces nothing.

## What this changes about the application

The full plan carries the table. The shape of it: 41 URL construction sites, 18
`revalidatePath` calls, `clubs.ts`'s uniqueness pre-check, every `upsert` whose
`where` names one of the five uniques, and the two route segments that would sit
under a new `[institutionSlug]`.

## Product decisions required

Three of these block specific steps. Recommendations given; none are decided.

| | Decision | Recommendation |
|---|---|---|
| **A** | What is a club URL once slugs are per-tenant? | **Tenant path prefix** — `/i/rochester/orgs/consulting-club`. Costs 41 URL sites and a redirect layer; buys a link that means the same thing to everyone, and feeds `resolveTenantScope`'s existing `institutionId` argument. The alternative (derive from session) makes a URL mean different things to different people, which is an undiagnosable support ticket. |
| **B** | Is a directory record a fact about a person, or about an institution's roster? | **Per-tenant rows** — `@@unique([institutionId, email])`. The schema already says a `DirectoryPerson` is deliberately *not* identity. Accept explicitly: **merging people across institutions is not a feature, now or later.** 71 people already hold seats in more than one org. |
| **C** | Does an audit log outlive the tenant it describes? | **Yes.** Deletion is already impossible — `AuditEvent_institutionId_fkey` is `ON DELETE RESTRICT`. Offboarding becomes export-then-delete as an audited routine, not a cascade. |
| **D** | Does `Institution.domain` mean anything? | It is nullable, **not unique**, written once and read nowhere — yet it is the only column that looks like it answers "which tenant does this email belong to". Either make it unique and use it, or say it is decorative. |
| **E** | Drop the dead `idempotencyKey` and empty `Budget`/`Transaction`? | **Drop nothing.** Their live row counts were never measured — the pilot was shaped by `db push` and has never been counted. Dropping a table whose contents are unknown is the most irreversible action available, and ADR-0001 makes non-destructive migration policy. |

## Verification

The gap that matters most is in CI, and it is in CI I wrote: **`ci.yml` applies
migrations to an empty database.** Every backfill therefore runs against zero
rows and every check passes vacuously. Nothing at any point in this programme
would exercise a backfill against data.

That is fixed before M1, not after:

1. **A two-tenant fixture** whose organizations, roles, deliverables and
   directory people **deliberately collide** on `slug`, `positionCode`, `key`
   and `email`. Apply the migration; assert every row classified and no
   constraint fired.
2. **A multi-institution `DirectoryPerson` fixture** — one person with a seat
   under A and an advisor row under B. Assert it **quarantines as NULL** rather
   than being stamped, and that preflight reports it.
3. **One isolation test per step**, not one at the end. The existing suite gives
   its two tenants deliberately different slugs because the schema forbids the
   case that actually matters; making that case writable is the point:

   ```ts
   it("lets two tenants hold the same slug", async () => {
     await runInTenantScope(scopeA, () => createOrg({ slug: `chess-${SUFFIX}` }))
     await runInTenantScope(scopeB, () => createOrg({ slug: `chess-${SUFFIX}` })) // must not throw P2002
   })
   ```

4. **After every deploy**, an in-VPC `migrate diff --from-url` against the pilot.
   Without it a database-side rollback leaves the migration recorded as applied,
   `db-bootstrap.mjs` prints "schema is up to date" against a shape nothing
   describes, and nothing detects it — CI's drift gate never looks at the pilot,
   and no runner can reach RDS.

Rollback is `prisma migrate resolve --rolled-back` **plus** the SQL, both from
the RunTask stage. The SQL alone is not a rollback.

## Status of the sequence

M8 (open a tenant scope everywhere) and M10 (`TENANCY_ENFORCE=true`) are already
done — `beaa0fe` and `8d11204`. M9, persisting the acting institution, is the
KNOWN GAP named in `src/lib/tenant-scope.ts` and is blocked on decision A.
M0 (the migration vehicle and the pilot census) blocks everything else.
