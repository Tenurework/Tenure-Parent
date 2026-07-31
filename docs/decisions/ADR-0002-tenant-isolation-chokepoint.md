# ADR-0002 — Tenant isolation belongs in the query layer, not in every caller

- **Status:** Accepted — **enforcing since 2026-07-31** (`TENANCY_ENFORCE=true`)
- **Date:** 2026-07-30
- **Related:** ADR-0001 (the migration vehicle this depends on)

## Context

`prisma/schema.prisma:5` states that cross-tenant queries are "denied by
default". Nothing implements that. Verified by reading the code:

- No `middleware.ts` anywhere in the repository.
- `src/lib/db.ts` was a bare `PrismaClient` — no `$extends`, no `$use`.
- No row-level security: `CREATE POLICY` appears nowhere in `prisma/`.

So isolation is a convention held up by roughly sixty server actions and
nineteen route handlers, each performing its own check. Phase 0 found the
predictable consequences — an approval thread reachable by id from any signed-in
account, `OSE_BROADCAST` readable by anyone holding a seat at any institution, a
nightly reminders job querying every deliverable in the database regardless of
institution.

Those are worth fixing individually, and will be. But fixing them individually
leaves the actual defect in place: **nothing can tell you a check is missing.**
The sixty-first call site will be written the same way, and no test will notice.

Today this is latent. There is exactly one `Institution` row, and no code path
anywhere provisions a second — `scripts/seed.mjs:29` is the only place one is
created. It stops being latent at precisely the moment the platform work
succeeds.

## Decision

Put the tenant predicate in the one place every query already passes through: a
Prisma client extension on `src/lib/db.ts`.

**1. Classify every model, and make drift a build failure.**
`src/lib/tenancy/registry.ts` sorts all 39 models into `TENANT_SCOPED` (15, the
ones carrying `institutionId`), `PLATFORM_GLOBAL` (5), and `UNENFORCEABLE` (19).
`registry.test.ts` parses `schema.prisma` and fails if a model is unclassified,
stale, double-counted, or carries `institutionId` without being scoped.

Adding a model now forces a tenancy decision at the moment it is added. That
mechanism, not the lists, is the point of this ADR.

**2. Name the gap instead of hiding it.** Only 15 of 39 models can be filtered,
because the other 24 have no column to filter on. `UNENFORCEABLE` lists each one
with the relation a future migration would denormalise `institutionId` from —
`Attachment` via `Message → Conversation`, `RoleAssignment` via
`Role → Organization`, and so on. `DirectoryPerson` is the worst of them: no
parent at all, a globally unique `email`, and real students' contact details.
That is a schema change, not something a filter can fix.

**3. Carry the tenant ambiently, not as a parameter.** `src/lib/tenancy/context.ts`
uses `AsyncLocalStorage`. Threading an `institutionId` through every call chain
fails in the direction that matters: the one function that forgets still
compiles, still runs, and returns another tenant's rows.

**4. Name the bootstrap escape hatch.** `REVIEW-FINDINGS.md` identified a
deadlock in the architecture spec: `InstitutionMembership` was inside the
enforced set, but reading memberships is *how* a request resolves its tenant, so
as specified nobody could authenticate. The same deadlock applies to any
chokepoint. `runUnscoped(reason, detail, fn)` resolves it with a closed set of
reasons — `auth-bootstrap`, `control-plane`, `migration`, `seed` — and a required
`detail`, so an audit of what runs unscoped reads as a list of named operations
rather than a count.

**5. Fail closed, and refuse to be talked out of it.** The predicate is `AND`-ed,
never spread, so `where: { institutionId: X }` supplied by a caller cannot
displace the acting tenant. Creates are stamped, overriding a wrong value. An
unrecognised model or operation throws rather than passing through.

## Consequences

**`findUnique` is filtered, which required checking rather than assuming.** A
by-id read that cannot carry a tenant predicate is the shape of an insecure
direct object reference, so the answer mattered. Prisma 6 accepts a non-unique
predicate alongside the unique key and returns `null` when it does not match —
verified against the real client before relying on it. An earlier draft rewrote
`findUnique` to `findFirst`; that was unnecessary, and `$allOperations` cannot
change the operation anyway.

**Extending the client changes a type.** `Prisma.TransactionClient` describes
the unextended client. `src/lib/db.ts` now exports `TxClient`, derived from `db`,
so it stays correct if further extensions are added.

**It runs in observe mode, and that is not security.** No call site opens a
tenant scope yet, so enforcing today would take the pilot down on its first
query. The extension applies the filter wherever a scope exists and records
where none does, behind `TENANCY_ENFORCE=true`. Observe mode is the instrument
that says when enforcement can be switched on without breaking the product — it
is explicitly not the control itself, and this ADR should not be read as
claiming the application is isolated today.

**The rule is nonetheless verified under enforcement.**
`src/lib/tenancy/isolation.itest.ts` builds its own enforcing client and proves,
against real PostgreSQL, that tenant A cannot read, count, look up by unique
key, update or delete tenant B's rows; that writes are stamped and a create
aimed at another tenant is overridden; that a missing context throws; that
platform-global models and the auth bootstrap still work; and that two
concurrent tenants do not bleed into each other. CI runs it in the Migrations
job, which already has a database.

## Alternatives considered

**PostgreSQL row-level security.** Stronger — it survives a bug in the
application layer, which this does not. It is the eventual destination, and the
build directive is explicit that it must not be enabled before the
authentication bootstrap is resolved. This work resolves that bootstrap
question in the application first, where the cost of getting it wrong is a
failed test rather than a database nobody can connect to.

**Fix the individual defects and stop.** Cheaper and closes the known holes, but
leaves the property that made them possible.

**Require an explicit `institutionId` argument everywhere.** A compile-time
check would be stronger than an ambient one — but 24 of 39 models have no such
field, and the ones that do are exactly the ones already being filtered wrongly.

## Enforcement (2026-07-31)

Steps 1 and 2 below are done. 50 files across server actions, RSC pages and
route handlers now open a scope; the observe-mode recording reached zero and
`TENANCY_ENFORCE=true` is set in `ecs.tf` and in CI's e2e job.

Two things were corrected on the way, both found by adversarial review of this
document's own implementation:

**A create naming another tenant is refused, not redirected.** The stamp
originally placed the acting tenant last, overriding whatever the caller
supplied. That looks safe — the row lands in the acting tenant either way — but
every create site here passes `institutionId: org.institutionId`, so overriding
writes `institutionId = <acting>` beside `organizationId -> <other tenant's
org>`. Eight models carry `institutionId` with no foreign key behind it, so
nothing downstream would catch a row whose halves disagree.

**The extension only inspects the top-level model.** A nested `include` is not
rewritten. `/api/attachment/[id]` reaches `Conversation` through
`include: { message: { conversation } }`, so `canReadConversation` remains the
only guard there. This is a real limit of the mechanism, not an oversight in a
call site, and it is closed by the same denormalisation as the rest.

## Remaining work

1. ~~Open a tenant scope at every entry point.~~ Done.
2. ~~Switch `TENANCY_ENFORCE=true`.~~ Done.
3. Denormalise `institutionId` onto the `UNENFORCEABLE` models, shrinking that
   list. `DirectoryPerson` first — it holds real personal data and has no parent.
   Until then, a caller reaching one of those models inside a scope must filter
   it by hand through the relation `registry.ts` records; the reminders cron is
   the worked example, and `isolation.itest.ts` pins the boundary.
4. Tenant-scoped composite uniques (`Organization.slug` and the rest), without
   which a second tenant cannot be created at all. Designed; see ADR-0004.
5. Then RLS, as defence behind this rather than instead of it.
