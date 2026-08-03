# ADR-0006 — Organization differences are configuration, resolved in layers

- **Status:** Accepted (engine built and wired; storage is file-backed on purpose — see Consequences)
- **Date:** 2026-07-31
- **Depends on:** ADR-0005 (one monorepo, so a package can sit beside the app that uses it)
- **Does not touch:** ADR-0004's schema programme. No migration, no schema change.

## Context

The platform's central promise is that Tenure can stand up a new organization
system without a new codebase — no fork, no branch, no customer-specific
conditional. Section 3.4 of the build directive states the prohibition directly:
nothing may read `tenant.slug === "rochester"` and behave differently.

Today the codebase does not have that conditional. It has something with the same
effect and less structure: the answer baked in. `"Ainslie OSE"` is a literal in
**eight files**. A second institution does not call its staff office that, and
there is nowhere to say so.

`Tenurework/Tenure` is not "the product" that this repository abstracts over. It is
**one tenant's system** — the Ainslie Office of Student Engagement at Simon
Business School. The platform has to be able to produce that system as
configuration, rather than as the thing it was built around. Until it can, tenant
#2 means editing components.

## Decision

A configuration engine, `packages/configuration`, and blueprints that use it.

A value is **declared once**, then **resolved** by folding ordered layers over
its default:

```
platform → module → blueprint → tenant → legalEntity → orgUnit → workspace → user
```

Four properties are load-bearing, and each is there because of a specific way the
obvious version goes wrong.

**Declared, not discovered.** Nothing can set a key that has no definition. The
alternative — a JSON bag every caller reads defensively with `?? fallback` — has
no way to answer "what is configurable?" and no place to put validation. A key
carries its schema, its default, the scopes it may be set at, and how it merges.

**Merge strategy is declared, not inferred.** The architecture specifies
`restrictiveMeet(def, value, r.value)` and glosses it as "AND / min / intersect"
with no rule for choosing. There is no such rule, because the shape does not
determine the intent: `notifications.enabled` should AND, so a tenant switching
it off cannot be re-enabled beneath them, while `features.betaOptIn` should
replace, so a user can turn it on for themselves. Both are booleans. So the
intent is written down.

The split matters for authority, not tidiness. `and`, `min` and `intersectSet`
are **restrictive**: a higher layer can only narrow. That is what makes it safe
to delegate configuration downward — a department cannot grant itself a longer
retention than its tenant allowed, because `min` cannot go up.

**Fail closed, with one stated exception.** An override naming an undefined key,
set at a forbidden scope, or failing its schema stops resolution. It does not
fall back to the default — falling back would discard an administrator's setting
because of a typo while reporting the system healthy.

The exception is narrow and written into the code: an institution with *no*
binding resolves to platform defaults. Every key defined so far is a word on a
screen. An unconfigured institution reading "Student Engagement Office" is a
cosmetic defect; a 500 on every page because nobody wrote its overlay yet is an
outage. A test asserts the precondition — that this module defines no key with a
`requiresCapability` and none above `public` sensitivity — so the exception
cannot quietly widen to cover something that decides authority.

**The result is validated, not just the inputs.** Found while building it: under
`deepMerge` a layer supplies a *fragment* — an org unit sets `{ logoUrl }` and
inherits `primary` from its tenant. Validating that fragment against the full
schema rejects it for the fields it deliberately does not restate, which makes
partial override impossible, which is the entire point of `deepMerge`. So
fragments are shape-checked and the *merged* value is validated. That also
catches failures no layer could be blamed for individually: an `intersectSet`
whose result is empty when the schema requires at least one.

## What is wired

`terminologyForInstitution(institutionId)` resolves through the engine, and the
three authorization messages in `resources-data.ts` use it. Rochester still reads
"Only Ainslie OSE can publish board resources." — the string is identical, its
source is not.

Two blueprints ship: `university-student-organizations` (clubs, executive boards,
seats) and `nonprofit-program-operations` (programs, steering committees, posts).
The second is not decoration. An engine that has only ever been configured for
one customer is indistinguishable from an engine hardcoded for that customer, and
the difference only shows the first time someone tries the second. So there is a
second, and it is exercised on every test run.

## Consequences

**Tenant overlays are files, and that is deliberate.** Configuration belongs in a
versioned, publishable store with draft, approval and rollback. The engine
already models exactly that — `publish`, `supersede`, `diffVersions`, immutable
versions with content checksums — and has no table to sit in.

Giving it one means adding a migration. ADR-0004's schema programme owns
migrations right now, and two sources of migrations against one database is how a
drift gate goes red and a deploy stops. So the layers come from
`blueprints/tenants.ts` until M0 lands, then from the store. **The resolution path
does not change** — only where the layers are read from — which is the point of
having the seam.

`blueprints/tenants.ts` is data, not code. No branch reads a tenant's name; a
lookup returns that tenant's layers and one resolver folds them.

**A renamed key becomes a runtime failure for one tenant.** Resolution is fail
closed, so a blueprint left setting a key that definitions.ts renamed is a 500 on
that tenant's first request. A test validates every shipped blueprint and binding
against the registry, which turns it into a red build instead.

**Two more workspace packages.** `@tenure/configuration` and `@tenure/blueprints`
ship TypeScript source with no build step, listed in `transpilePackages` and
mapped in `tsconfig.json` and `jest.config.js`. No `dist/`, so no build ordering
and no stale artifact — at this size the build step buys nothing.

## Verification

```
npm run test --workspace apps/web -- --ci      313 passed  (was 258; +55)
npm run test:platform                            8 passed
npm run type-check                                    pass
npm run lint                                     0 errors
npm run build                                   40 routes
npx playwright test                          132 passed
```

The 55 new tests include: two institutions resolving different words from one
call; a restrictive strategy refusing to widen; every fail-closed refusal;
frozen, order-independent checksums; publication refusing a no-op; and the
merged-result validation described above.
