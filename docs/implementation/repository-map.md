# Repository map

**Generated** by `node tools/repository-map.mjs` from `git ls-files`. Do not edit by hand —
a hand-written map is accurate on the day it is written and wrong from the next commit.
Regenerate it instead. `docs/architecture/repository-map.json` is the machine-readable form.

Tracked files: **1191**. Workspace globs: `apps/*`, `packages/*`, `blueprints`, `modules`.

## Workspaces

| Directory | Package | Files | Tests | Depends on | Container |
| --- | --- | ---: | ---: | --- | --- |
| `apps/system-studio` | @tenure/system-studio | 128 | 40 | `@tenure/audit` `@tenure/contracts` `@tenure/finops` `@tenure/provisioning` | yes |
| `apps/web` | tenure | 492 | 155 | `@tenure/contracts` | yes |
| `blueprints` | @tenure/blueprints | 8 | 0 | — | — |
| `modules` | @tenure/modules | 2 | 0 | — | — |
| `packages/audit` | @tenure/audit | 7 | 1 | — | — |
| `packages/authorization` | @tenure/authorization | 20 | 7 | — | — |
| `packages/configuration` | @tenure/configuration | 28 | 11 | `@tenure/audit` `@tenure/finops` | — |
| `packages/contracts` | @tenure/contracts | 3 | 1 | — | — |
| `packages/finops` | @tenure/finops | 13 | 4 | — | — |
| `packages/identity` | @tenure/identity | 57 | 28 | — | — |
| `packages/metadata` | @tenure/metadata | 5 | 1 | — | — |
| `packages/module-runtime` | @tenure/module-runtime | 8 | 2 | — | — |
| `packages/organization-model` | @tenure/organization-model | 15 | 6 | — | — |
| `packages/payments` | @tenure/payments | 27 | 12 | — | — |
| `packages/platform-config` | @tenure/platform-config | 30 | 12 | — | — |
| `packages/provisioning` | @tenure/provisioning | 30 | 10 | `@tenure/platform-config` | — |
| `packages/releases` | @tenure/releases | 5 | 1 | — | — |
| `packages/workflow` | @tenure/workflow | 5 | 1 | — | — |

## Workflows

| File | Name | Triggers | Reaches AWS | Guarded to |
| --- | --- | --- | --- | --- |
| `aws-inventory.yml` | AWS · Read-only inventory | workflow_dispatch | **yes** | — |
| `bootstrap-oidc.yml` | AWS · Bootstrap OIDC (one-time) | workflow_dispatch | **yes** | `Tenurework/Tenure-Parent` |
| `ci.yml` | CI | push, pull_request, workflow_call | — | — |
| `custom-domain.yml` | Custom Domain Status | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `db-recovery.yml` | Database recovery and census | workflow_dispatch | **yes** | `Tenurework/Tenure` |
| `debug-logs.yml` | Debug Logs | workflow_dispatch | **yes** | `Tenurework/Tenure-Parent` |
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
| `visual-baselines-refresh.yml` | Visual baselines · refresh | workflow_dispatch | — | — |

## Infrastructure stacks

| Directory | .tf files | State key |
| --- | ---: | --- |
| `infrastructure/oidc` | 4 | `oidc/terraform.tfstate` |
| `infrastructure/studio` | 10 | `studio/terraform.tfstate` |
| `infrastructure/terraform` | 20 | `pilot/terraform.tfstate` |

## Database

| Schema | Models | Enums | Migrations |
| --- | ---: | ---: | ---: |
| `apps/web/prisma/schema.prisma` | 52 | 24 | 14 |

## Test suites

| Suite | Files |
| --- | ---: |
| apps/web unit (jest) | 97 |
| apps/web isolation (jest, needs Postgres) | 22 |
| apps/web e2e (playwright) | 37 |
| system-studio e2e (playwright) | 26 |
| platform (node:test) | 64 |
| packages (jest, via apps/web roots) | 97 |
