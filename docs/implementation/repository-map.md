# Repository map

**Generated** by `node tools/repository-map.mjs` from `git ls-files`. Do not edit by hand —
a hand-written map is accurate on the day it is written and wrong from the next commit.
Regenerate it instead. `docs/architecture/repository-map.json` is the machine-readable form.

Tracked files: **470**. Workspace globs: `apps/*`, `packages/*`, `blueprints`, `modules`.

## Workspaces

| Directory | Package | Files | Tests | Depends on | Container |
| --- | --- | ---: | ---: | --- | --- |
| `apps/system-studio` | @tenure/system-studio | 14 | 2 | — | yes |
| `apps/web` | tenure | 294 | 56 | — | yes |
| `blueprints` | @tenure/blueprints | 6 | 0 | — | — |
| `modules` | @tenure/modules | 2 | 0 | — | — |
| `packages/audit` | @tenure/audit | 4 | 1 | — | — |
| `packages/authorization` | @tenure/authorization | 6 | 1 | — | — |
| `packages/configuration` | @tenure/configuration | 8 | 1 | — | — |
| `packages/metadata` | @tenure/metadata | 5 | 1 | — | — |
| `packages/module-runtime` | @tenure/module-runtime | 5 | 1 | — | — |
| `packages/organization-model` | @tenure/organization-model | 5 | 1 | — | — |
| `packages/platform-config` | @tenure/platform-config | 12 | 4 | — | — |
| `packages/releases` | @tenure/releases | 5 | 1 | — | — |
| `packages/workflow` | @tenure/workflow | 5 | 1 | — | — |

## Workflows

| File | Name | Triggers | Reaches AWS | Guarded to |
| --- | --- | --- | --- | --- |
| `ci.yml` | CI | push, pull_request, workflow_call | — | — |
| `custom-domain.yml` | Custom Domain Status | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `db-recovery.yml` | Database recovery and census | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `debug-logs.yml` | Debug Logs | — | **yes** | `Tenurework/Tenure` |
| `deploy-studio.yml` | Deploy Studio | push, workflow_dispatch | **yes** | `Tenurework/Tenure-Parent` |
| `deploy.yml` | Deploy | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `force-redeploy.yml` | Force Redeploy | — | **yes** | `Tenurework/Tenure` |
| `ops-status.yml` | Ops Status | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `platform-plan.yml` | Platform · Terraform plan (read-only) | workflow_dispatch | **yes** | — |
| `probe-debug.yml` | Probe Debug | — | — | `Tenurework/Tenure` |
| `replace-acm-cert.yml` | Replace ACM Certificate | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `rotate-auth-secret.yml` | Rotate Auth Secret | — | **yes** | `Tenurework/Tenure` |
| `seed-reference-data.yml` | Seed reference data | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `verify-reminders.yml` | Verify Reminders | — | **yes** | `Tenurework/Tenure` |

## Infrastructure stacks

| Directory | .tf files | State key |
| --- | ---: | --- |
| `infrastructure/studio` | 9 | `studio/terraform.tfstate` |
| `infrastructure/terraform` | 20 | `pilot/terraform.tfstate` |

## Database

| Schema | Models | Enums | Migrations |
| --- | ---: | ---: | ---: |
| `apps/web/prisma/schema.prisma` | 39 | 21 | 1 |

## Test suites

| Suite | Files |
| --- | ---: |
| apps/web unit (jest) | 24 |
| apps/web isolation (jest, needs Postgres) | 4 |
| apps/web e2e (playwright) | 28 |
| system-studio e2e (playwright) | 2 |
| platform (node:test) | 1 |
| packages (jest, via apps/web roots) | 12 |
