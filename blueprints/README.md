# Blueprints

A blueprint is a reusable, Tenure-authored definition of a *kind* of organization
system. It is not a customer's data and not a fork — it is the starting shape
that many customers of the same kind share.

Today a blueprint carries terminology. It will grow to carry the module
selection, default roles, policies, workflows, forms, views, navigation and
notification defaults the platform architecture describes. Each of those lands
here when it has a working engine behind it, not before.

## What is here

| Blueprint | The kind of system it describes |
|---|---|
| `university-student-organizations` | A university's student clubs, their executive boards, and the staff office that oversees them. The pilot's shape. |
| `nonprofit-program-operations` | A nonprofit's programs, their steering committees, and the program office. Deliberately different in structure and vocabulary. |

The second one exists for a specific reason. An engine that has only ever been
configured for one customer is indistinguishable from an engine hardcoded for
that customer, and the difference only shows up the first time someone tries the
second. Two blueprints that differ in their *words* is a small claim; it is
still a claim that is checked, by
`apps/web/src/lib/config/system-config.test.ts`, on every run.

## The tenant binding

`tenants.ts` maps an institution slug to its blueprint and its own overlay.

That file is data, not code — no branch anywhere reads a tenant's name and
behaves differently. The difference between two institutions is entirely which
values they resolve, and every one of those values comes back through the same
call, `resolveSystemConfig`.

It lives in the repository rather than the database on purpose, and only for
now. Tenant configuration belongs in a versioned, publishable store with draft,
approval and rollback — `@tenure/configuration` already models that
(`publish`, `supersede`, `diffVersions`) and has no table to sit in yet. Adding
one means adding a migration, and the schema programme in
`docs/decisions/ADR-0004-tenant-scoped-schema.md` owns migrations right now.
Two sources of migrations against one database is how a drift check goes red and
a deploy stops.

So: file-backed overlays until that programme lands M0, then the same overlays
loaded from the store the engine already expects. The resolution path does not
change — only where the layers come from.
