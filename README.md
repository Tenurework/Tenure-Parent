# Tenure — the global distribution engine

The Tenure platform engine: the codebase from which the Tenure team configures,
provisions, deploys, operates and supports organization-specific systems.

**This repository is the engine. It is not a tenant** (PD-008). A tenant's
system — the Simon OSE pilot — lives and deploys from `satvikOS/Tenure`. The
two share an AWS account and nothing else: separate Terraform state, separate
cluster, separate load balancer, separate CloudFront distribution.

| | URL | Deploys from |
|---|---|---|
| **System Studio** (this engine) | https://d2kj4iy5i37kfd.cloudfront.net | this repository |
| Simon OSE (tenant #1) | https://d1n6mdis7bs02g.cloudfront.net | `satvikOS/Tenure` |

Signing in to the Studio needs an address in `PLATFORM_OPERATORS` and the
operator secret, which Terraform generates and never prints — this repository is
public, so a workflow summary is world-readable:

```bash
aws secretsmanager get-secret-value --secret-id tenure-studio/app   --query SecretString --output text
```

## What is here

| Path | What it is |
|---|---|
| `apps/system-studio/` | **The engine.** The internal console: every tenant's blueprint, topology, modules, resolved configuration and release checksum. |
| `infrastructure/studio/` | The engine's own stack — cluster, ALB, ECR, secret, CloudFront. Separate Terraform state from the pilot's, deliberately. |
| `apps/web/` | The tenant application, and a **duplicate** of `satvikOS/Tenure`. Here only as the integration proof for the engines until they are consumable by version — see PD-008. |
| `apps/web/prisma/` | 40-model schema, versioned migrations. |
| `packages/` | The platform engines — see below. Each is used by the application, not shelved beside it. |
| `modules/` | The module catalog: 12 manifests describing capability the application already has. |
| `blueprints/` | Tenure-authored system definitions, and the binding from each institution to the one it runs. |
| `infrastructure/terraform/` | ECS, RDS, CloudFront, ACM, SES, SQS, ElastiCache — 21 files. |
| `tests/` | Monorepo-level tests: properties of the repository, not of the application. |
| `tools/` | Operational scripts. |
| `docs/` | Architecture, decisions, migrations, runbook. |
| `Tier1/`, `*.pdf`, `*.xlsx` | Simon Business School source documents the roster and resource data derive from. |

### The engines

| Package | What it decides | Where the application uses it |
|---|---|---|
| `@tenure/configuration` | Layered resolution over eight scopes, declared merge strategies, fail-closed, immutable checksummed versions | Terminology and localization |
| `@tenure/organization-model` | Declared node types and containment, cycle prevention, effective-dated reparenting, typed relations | Projection of the live `Institution`/`Organization` schema |
| `@tenure/module-runtime` | Which capabilities a system has: dependencies, incompatibilities, entitlements, lifecycle | The sidebar, and what a release pins |
| `@tenure/authorization` | Who may do what, and why not: roles, scope inheritance, delegation, separation of duties, explainable denials | Navigation capabilities |
| `@tenure/workflow` | Approval flows as versioned definitions; instances pinned to their version | The live approval path |
| `@tenure/releases` | Immutable checksummed system artifacts, a lifecycle with an approval gate, append-only rollback | `buildSystem()` |
| `@tenure/audit` | An audit record that cannot be built unattributed, with credentials redacted by rule | `admin/guard.ts` |

A package appears here when it has working code that something uses. There is no
`forms/`, `search/` or `notifications/` package, because there is nothing real
that would go in one yet.

### Status, honestly

The working pilot application, plus the platform engines above around it. Two
structurally different organization systems — Simon OSE and a synthetic nonprofit
— build, validate, publish, diff and roll back end to end, with no line of code
naming either.

What is **not** built: configurable custom fields and forms, configurable
dashboards, the control plane and cell placement, tenant suspension and deletion,
and provisioning a new tenant from the Studio. The Studio is read-only, and
`docs/decisions/ADR-0006-configuration-engine.md` explains why: tenant overlays
are files until the schema programme lands a configuration store, and a write
surface over files would produce a system that survives until the next deploy.

## Running it

Requires Node ≥ 20 (developed on 22.21) and Docker.

```bash
npm ci

docker run -d --name tenure-pg \
  -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure \
  -p 5433:5432 postgres:16

export DATABASE_URL="postgresql://tenure:tenure@localhost:5433/tenure"

cd apps/web
npx prisma migrate deploy
node scripts/seed.mjs        # 26 clubs, 235 seats, 172 people
cd ../..

npm run dev                  # http://localhost:3000
```

`GET /api/health` returns `{"status":"ok","db":"ok"}` when the app can reach the
database.

## Checks

```bash
npm run lint
npm run type-check
npm run test --workspace apps/web -- --ci    # 726 unit tests, app + packages
npm run test:platform                        # monorepo-level tests
npm run build

cd apps/web
npm run test:isolation                       # 26 tests, needs DATABASE_URL
npx playwright install --with-deps chromium
npx playwright test                          # 139 e2e specs
```

Two things to know before trusting a red result:

- **The e2e suite is not idempotent.** Several specs mutate state they later
  assert on: 139/139 against a fresh migrate+seed, fewer on a second run against
  the same database. Re-seed between runs.
- **One e2e failure has been observed once and not reproduced** —
  `resources.spec.ts`, "OSE can retire a resource and restore it". CI runs with
  `retries: 1`, so CI can be green while it is real. See
  `docs/migrations/BASELINE-VALIDATION.md`.

`test:isolation` needs a database but no longer needs a *seeded* one — the suite
supplies its own fixtures, which is what fixed the failure that had been blocking
deploys on `satvikOS/Tenure`.

## Deployment

**Production deploys from `satvikOS/Tenure`, not from here.** That is deliberate
and temporary: this repository is canonical for development first, and canonical
for deployment only after a staging equivalence proof and an approved cutover.

Every AWS-touching workflow here is disarmed twice over, because this repository
holds the same deploy credentials as the one that deploys:

1. **No automatic trigger.** `deploy.yml` and `ops-status.yml` have no `push` or
   `schedule` here, only `workflow_dispatch`. A guarded job still *creates* a run
   that then reports `skipped`, and a repository where half the runs are neither
   success nor failure teaches everyone to stop reading them.
2. **A job-level guard**, `if: github.repository == 'satvikOS/Tenure'`, so
   dispatching one here still does nothing.

`npm run test:platform` asserts both in CI, and asserts that the one read-only
exemption (`platform-plan.yml`) contains no mutating command. See
`docs/decisions/ADR-0005-CANONICAL-MONOREPO.md`.

### The System Studio

`/studio` shows every configured system: its blueprint and topology, the modules
enabled and the modules refused with the reason, every resolved configuration
value with the layer that supplied it, and the release-candidate checksum. It can
also export a tenant's data.

Gated on `PLATFORM_OPERATORS`, a comma-separated list of Tenure staff addresses,
which fails closed when unset. Deliberately not gated on any existing role: an
OSE Director is a *customer* administrator, and gating on that would hand a
customer the console that configures other customers. Everyone else gets a 404,
not a 403.

## Documents, in the order they are worth reading

1. `docs/decisions/ADR-0005-CANONICAL-MONOREPO.md` — why this repository is canonical.
2. `docs/migrations/LIVE-APP-IMPORT-PLAN.md` — how the application got here, with the history proof.
3. `docs/migrations/BASELINE-VALIDATION.md` — every check, its exit code, and the pre-existing failures.
4. `docs/architecture/REVIEW-FINDINGS.md` — an adversarial review of the platform spec against the real code. **Read before the spec itself.**
5. `docs/decisions/ADR-0006-configuration-engine.md` — why organization differences are configuration, and why tenant overlays are still files.
6. `docs/decisions/ADR-0004-tenant-scoped-schema.md` — the schema programme that makes a second tenant possible (M0–M12).
7. `docs/architecture/PLATFORM-ARCHITECTURE.md` — the target platform (~7,200 lines).
8. `docs/RUNBOOK.md` — operating the live pilot.

### Why the review comes before the specification

The specification's sections were authored in parallel and then reviewed by an
independent pass instructed to find only defects. It found several that would not
work as written — an RLS bootstrap deadlock that would stop the application
authenticating anyone, two contradictory `withTenant` designs with opposite failure
semantics, effective-permission SQL that never checks membership state so suspended
members keep every capability, and three mutually exclusive target schemas all
marked MVP. Treat the specification as a strong draft with a known defect list.
Where the two disagree, the review wins.
