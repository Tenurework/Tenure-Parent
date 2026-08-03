# ADR-0003 — The application moves to `apps/web` inside an npm-workspaces monorepo

- **Status:** Accepted (structure done; repo-identity step outstanding — see Consequences)
- **Date:** 2026-07-30
- **Implements:** PD-001

## Context

The build directive requires one platform monorepo containing applications,
packages, modules, infrastructure and tooling. What existed was a single Next.js
application at the root of its own repository, plus a separate documentation-only
repository (`Tenurework/Tenure-Parent`) holding the architecture specification.

Nothing can be added around an application that *is* the repository root. There
is no `packages/` for a platform kernel to live in, no place for a second
application (the Studio the directive calls for), and no workspace boundary to
stop them depending on each other by accident.

## Decision

Relocate the entire application to `apps/web/`, with npm workspaces at the root.

```
/
├── apps/web/            the former repository root, whole
├── packages/            empty, for the platform kernel
├── infrastructure/      unmoved — keeps TF_DIR byte-identical
├── docs/  .github/  Tier1/
├── package.json         name: tenure-parent, workspaces: [apps/*, packages/*]
├── package-lock.json    one lockfile
└── .npmrc               legacy-peer-deps=true
```

`infrastructure/` staying at the root is deliberate: it keeps
`TF_DIR: infrastructure/terraform` unchanged in `deploy.yml` and
`replace-acm-cert.yml`, and leaves the Terraform backend block — bucket,
`key=pilot/terraform.tfstate`, lock table — untouched. The deployment's
relationship to its own state is the last thing that should move in a
restructure.

## The failure modes this had, and how each is now caught

A relocation is only mechanically simple. Every real risk was a path assumption
that fails *silently* or reports the wrong cause.

**The standalone bundle moves.** With workspaces, `output: standalone` emits
`.next/standalone/apps/web/server.js`, not `.next/standalone/server.js`, and
needs the hoisted root `node_modules` beside it. `outputFileTracingRoot` is now
set explicitly rather than inferred by walking up for a lockfile — inference
would have been *correct here and wrong later*, which is worse than wrong now.

**A CRLF or misplaced entrypoint reads as a database problem.** `entrypoint.sh`
now `exec`s `apps/web/server.js`. Miss it and migrations apply, the server then
fails with `Cannot find module '/app/server.js'`, and the visible symptom is an
ECS task dying in a rollback loop shortly after touching the database.

**`.dockerignore` is not `.gitignore`.** Docker matches context-relative paths
segment by segment, so a bare `node_modules` excludes only the top-level one.
`apps/web/node_modules`, carrying a **Windows** Prisma engine, would have entered
the builder through `COPY . .` and overwritten the musl engine — an image that
builds cleanly and cannot reach the database. Patterns are now `**/`-prefixed.

**`.gitignore` anchoring.** A leading slash anchors to the file's own directory,
so `/node_modules` stopped matching `apps/web/node_modules`. The first
`git add -A` would have staged the entire installed dependency tree.

**npm eats forwarded flags, and still exits 0.** `npm run test -- --ci` expands
to `npm run test --workspace apps/web --ci`, where npm takes `--ci` as its own
flag. The step passes, having run jest without it. Every delegating script in the
root `package.json` therefore ends in `--`, and the comment there says why.

**CI never built the container image.** The Dockerfile was only ever validated by
deploying it, so a mistake in it surfaced as a failed production rollout. A
`container` job now builds it on every push and asserts what the entrypoint needs
— `server.js` at the exec'd path, `prisma/` and `scripts/` flattened to `/app`,
the bundled Prisma CLI, a linux-musl query engine, no `*.dll.node` anywhere — and
boots it against an unreachable database to prove it still fails closed.

## Consequences

**History follows the move.** `git mv` preserves blobs, so rename detection
carries history through: `git log --follow apps/web/prisma/schema.prisma` returns
17 commits, `entrypoint.sh` 5. Only the Dockerfile needed
`--find-renames=30%`, having been substantially rewritten.

**Prisma commands run from `apps/web`.** CI uses `working-directory: apps/web`
with no `--schema` flag, on purpose: the implicit `./prisma/schema.prisma` lookup
is exactly what the container does, so CI keeps exercising the real path rather
than a flagged approximation.

**The repo-identity half of PD-001 is not done.** PD-001 says the application
ends up inside `Tenure-Parent`. The restructure happened inside `Tenurework/Tenure`,
so the monorepo and the specification repository are still two repositories. What
remains is no longer a restructure — the history is already monorepo-shaped — but
a repository move, and it is blocked on operational bindings rather than code:
the GitHub Actions secrets (`ACCESSKEYID`, `SECRETACCESSKEY`, `ANTHROPIC_API_KEY`),
the Terraform state key, and the ECR repository are all bound to this repo's
pipeline. Doing it carelessly costs the pilot its deployment path. It should be
its own change, with its own ADR.

## Verification

| Check | Result |
|---|---|
| File accounting | 335 tracked files, 0 missing, 267 byte-identical renames |
| `npm ci` from one root lockfile | clean; lockfile unmodified |
| Type-check · lint | pass |
| Unit tests | 240 / 18 suites |
| Unit tests run from the **root** with the workspace config | 240 — proves the `__dirname` anchors |
| Isolation tests, real PostgreSQL | 14 |
| e2e | 132 / 132 |
| Standalone emit | `apps/web/.next/standalone/apps/web/server.js` + hoisted `node_modules` |
| Container build | first executed in CI by the new `container` job |
