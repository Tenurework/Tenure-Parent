# Simon absorption — technology and capability inventory

**Generated** by `node tools/simon-absorption-inventory.mjs` from
`docs/architecture/simon-absorption-inventory.json`. Do not edit by hand — `tests/simon-absorption-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-003**. Source repository read from `refs/remotes/live/main` only: the pilot is
never cloned, checked out or pushed to from here.

Each row is a probe: a pattern run over the tracked file list of each side,
with the matched paths as evidence. A row reading **no match** says that no
tracked path matched that pattern in that repository — it does not say the
capability is absent, because a probe is a search and not a proof. Evidence
is capped at 6 paths per cell; the count is not capped.

| Capability | Source | Target |
| --- | --- | --- |
| Frontend framework | 1 — `apps/web/next.config.ts` | 2 — `apps/system-studio/next.config.ts` `apps/web/next.config.ts` |
| Frontend routes (pages) | 37 — `apps/web/src/app/(app)/admin/approvals/page.tsx` `apps/web/src/app/(app)/admin/audit/page.tsx` `apps/web/src/app/(app)/admin/clubs/[slug]/page.tsx` `apps/web/src/app/(app)/admin/clubs/page.tsx` `apps/web/src/app/(app)/admin/overrides/page.tsx` `apps/web/src/app/(app)/admin/page.tsx` | 58 — `apps/system-studio/src/app/page.tsx` `apps/system-studio/src/app/platform/audit/page.tsx` `apps/system-studio/src/app/platform/compute/page.tsx` `apps/system-studio/src/app/platform/cost/page.tsx` `apps/system-studio/src/app/platform/data/page.tsx` `apps/system-studio/src/app/platform/diagnostics/page.tsx` |
| Frontend layouts | 3 — `apps/web/src/app/(app)/admin/layout.tsx` `apps/web/src/app/(app)/layout.tsx` `apps/web/src/app/layout.tsx` | 4 — `apps/system-studio/src/app/layout.tsx` `apps/web/src/app/(app)/admin/layout.tsx` `apps/web/src/app/(app)/layout.tsx` `apps/web/src/app/layout.tsx` |
| Frontend components | 71 — `apps/web/src/components/BackButton.tsx` `apps/web/src/components/CalendarFilters.tsx` `apps/web/src/components/CalendarMiniMonth.tsx` `apps/web/src/components/CalendarSubscribe.tsx` `apps/web/src/components/CalendarTimeGrid.tsx` `apps/web/src/components/ClubCard.tsx` | 142 — `apps/system-studio/src/components/AccountMenu.tsx` `apps/system-studio/src/components/Breadcrumbs.tsx` `apps/system-studio/src/components/CommandPalette.tsx` `apps/system-studio/src/components/DeploymentPanel.tsx` `apps/system-studio/src/components/EvidencePanel.tsx` `apps/system-studio/src/components/Launcher.tsx` |
| Styles | 1 — `apps/web/src/app/globals.css` | 23 — `apps/system-studio/src/app/console-index/console-index.module.css` `apps/system-studio/src/app/globals.css` `apps/system-studio/src/app/platform/audit/audit.module.css` `apps/system-studio/src/app/platform/compute/compute.module.css` `apps/system-studio/src/app/platform/cost/cost.module.css` `apps/system-studio/src/app/platform/data/data.module.css` |
| Design tokens / theme config | 1 — `apps/web/tailwind.config.ts` | 2 — `apps/web/src/lib/a11y/tokens.ts` `apps/web/tailwind.config.ts` |
| HTTP API handlers | 20 — `apps/web/src/app/api/admin/directory/route.ts` `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` `apps/web/src/app/api/attachment/[id]/content/route.ts` `apps/web/src/app/api/attachment/[id]/route.ts` `apps/web/src/app/api/auth/[...nextauth]/route.ts` | 29 — `apps/system-studio/src/app/api/auth/[...nextauth]/route.ts` `apps/system-studio/src/app/api/aws/[surface]/route.ts` `apps/system-studio/src/app/api/export/route.ts` `apps/web/src/app/api/admin/directory/route.ts` `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` |
| Backend services / domain libraries | 30 — `apps/web/src/lib/ai.ts` `apps/web/src/lib/approvals-sla.ts` `apps/web/src/lib/approvals.ts` `apps/web/src/lib/auth.ts` `apps/web/src/lib/calendar-color.ts` `apps/web/src/lib/calendar-data.ts` | 64 — `apps/system-studio/src/lib/adopt.ts` `apps/system-studio/src/lib/audit-ledger.ts` `apps/system-studio/src/lib/auth-config.ts` `apps/system-studio/src/lib/auth.ts` `apps/system-studio/src/lib/authorize.ts` `apps/system-studio/src/lib/cells.ts` |
| Database engine (provisioned) | 2 — `infrastructure/terraform/elasticache.tf` `infrastructure/terraform/rds.tf` | 2 — `infrastructure/terraform/elasticache.tf` `infrastructure/terraform/rds.tf` |
| Database schema | 1 — `apps/web/prisma/schema.prisma` | 1 — `apps/web/prisma/schema.prisma` |
| Database migrations | 2 — `apps/web/prisma/migrations/20260730000000_baseline/migration.sql` `apps/web/prisma/migrations/migration_lock.toml` | 15 — `apps/web/prisma/migrations/20260730000000_baseline/migration.sql` `apps/web/prisma/migrations/20260801210840_outbox_events/migration.sql` `apps/web/prisma/migrations/20260802184410_membership_effective_state/migration.sql` `apps/web/prisma/migrations/20260803070000_seat_is_not_a_role/migration.sql` `apps/web/prisma/migrations/20260803160000_seat_carries_a_role_template/migration.sql` `apps/web/prisma/migrations/20260806180000_activation_gates_serving/migration.sql` |
| Events / scheduled jobs | 2 — `apps/web/src/app/api/jobs/reminders/route.ts` `infrastructure/terraform/scheduler.tf` | 6 — `apps/system-studio/src/lib/aws/eventbridge.test.ts` `apps/system-studio/src/lib/aws/eventbridge.ts` `apps/web/src/app/api/jobs/outbox/route.ts` `apps/web/src/app/api/jobs/reminders/route.ts` `apps/web/src/app/api/jobs/slo/route.ts` `infrastructure/terraform/scheduler.tf` |
| Queues | 1 — `infrastructure/terraform/sqs.tf` | 1 — `infrastructure/terraform/sqs.tf` |
| Identity and authentication | 3 — `apps/web/src/app/api/auth/[...nextauth]/route.ts` `apps/web/src/lib/auth.ts` `apps/web/src/lib/dev-login.ts` | 9 — `apps/system-studio/src/app/api/auth/[...nextauth]/route.ts` `apps/system-studio/src/lib/auth.ts` `apps/system-studio/src/lib/aws/cognito.test.ts` `apps/system-studio/src/lib/aws/cognito.ts` `apps/web/src/app/api/auth/[...nextauth]/route.ts` `apps/web/src/lib/auth.ts` |
| Authorization | 2 — `apps/web/src/lib/admin/guard.ts` `apps/web/src/lib/rbac.ts` | 14 — `apps/web/src/lib/admin/guard.ts` `apps/web/src/lib/rbac.ts` `packages/authorization/src/assurance.ts` `packages/authorization/src/break-glass.ts` `packages/authorization/src/controls.ts` `packages/authorization/src/decide.ts` |
| Tenancy isolation | 5 — `apps/web/src/lib/tenancy/context.ts` `apps/web/src/lib/tenancy/extension.ts` `apps/web/src/lib/tenancy/registry.ts` `apps/web/src/lib/tenancy/scope-args.ts` `apps/web/src/lib/tenant-scope.ts` | 9 — `apps/web/src/lib/tenancy/context.ts` `apps/web/src/lib/tenancy/extension.ts` `apps/web/src/lib/tenancy/locale-cookie.ts` `apps/web/src/lib/tenancy/registry.ts` `apps/web/src/lib/tenancy/repository.ts` `apps/web/src/lib/tenancy/request-context.ts` |
| File storage | 2 — `apps/web/src/lib/s3.ts` `infrastructure/terraform/s3.tf` | 2 — `apps/web/src/lib/s3.ts` `infrastructure/terraform/s3.tf` |
| Search | 3 — `apps/web/src/app/api/search/route.ts` `apps/web/src/lib/search-data.ts` `apps/web/src/lib/search.ts` | 3 — `apps/web/src/app/api/search/route.ts` `apps/web/src/lib/search-data.ts` `apps/web/src/lib/search.ts` |
| AI | 3 — `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` `apps/web/src/lib/ai.ts` | 3 — `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` `apps/web/src/lib/ai.ts` |
| Outbound integrations (email) | 2 — `apps/web/src/lib/notify.ts` `infrastructure/terraform/ses.tf` | 2 — `apps/web/src/lib/notify.ts` `infrastructure/terraform/ses.tf` |
| Observability | 3 — `apps/web/src/app/api/health/route.ts` `apps/web/src/instrumentation.ts` `infrastructure/terraform/cloudwatch.tf` | 3 — `apps/web/src/app/api/health/route.ts` `apps/web/src/instrumentation.ts` `infrastructure/terraform/cloudwatch.tf` |
| Infrastructure as code | 20 — `infrastructure/terraform/acm.tf` `infrastructure/terraform/alb.tf` `infrastructure/terraform/cloudfront.tf` `infrastructure/terraform/cloudwatch.tf` `infrastructure/terraform/dev-login-gate.tf` `infrastructure/terraform/ecr.tf` | 36 — `infrastructure/oidc/main.tf` `infrastructure/oidc/outputs.tf` `infrastructure/oidc/roles.tf` `infrastructure/oidc/variables.tf` `infrastructure/studio/acm.tf` `infrastructure/studio/cloudfront.tf` |
| Unit tests | 25 — `apps/web/scripts/db-bootstrap.test.mjs` `apps/web/src/app/api/documents/_lib/content.test.ts` `apps/web/src/app/api/documents/_lib/mammoth-sanitize.test.ts` `apps/web/src/app/api/documents/_lib/sanitize.test.ts` `apps/web/src/components/charts/timeseries.test.ts` `apps/web/src/lib/approvals-sla.test.ts` | 395 — `apps/system-studio/src/app/console-index/answer.test.ts` `apps/system-studio/src/app/platform/audit/entries.test.ts` `apps/system-studio/src/app/platform/compute/compute-answer.test.ts` `apps/system-studio/src/app/platform/cost/cost-citation.test.tsx` `apps/system-studio/src/app/platform/cost/cost-decisions.test.ts` `apps/system-studio/src/app/platform/cost/cost-rates.test.tsx` |
| End-to-end tests | 28 — `apps/web/e2e/admin-console.spec.ts` `apps/web/e2e/admin.spec.ts` `apps/web/e2e/app.spec.ts` `apps/web/e2e/audit.spec.ts` `apps/web/e2e/board-messaging.spec.ts` `apps/web/e2e/calendar-filters.spec.ts` | 82 — `apps/system-studio/e2e/adoption.spec.ts` `apps/system-studio/e2e/api-contract.spec.ts` `apps/system-studio/e2e/audit-chain.spec.ts` `apps/system-studio/e2e/auth-mode-logic.spec.ts` `apps/system-studio/e2e/authorize-logic.spec.ts` `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` |
| CI / deployment workflows | 12 — `.github/workflows/ci.yml` `.github/workflows/custom-domain.yml` `.github/workflows/db-recovery.yml` `.github/workflows/debug-logs.yml` `.github/workflows/deploy.yml` `.github/workflows/force-redeploy.yml` | 18 — `.github/workflows/aws-inventory.yml` `.github/workflows/bootstrap-oidc.yml` `.github/workflows/ci.yml` `.github/workflows/custom-domain.yml` `.github/workflows/db-recovery.yml` `.github/workflows/debug-logs.yml` |

## Probe patterns

| Capability | Pattern |
| --- | --- |
| Frontend framework | `/^(apps\/[^/]+\/)?next\.config\.(ts\|mjs\|js)$/` |
| Frontend routes (pages) | `/\/src\/app\/.*\/page\.tsx$\|\/src\/app\/page\.tsx$/` |
| Frontend layouts | `/\/src\/app\/.*layout\.tsx$/` |
| Frontend components | `/\/src\/components\/.*\.tsx$/` |
| Styles | `/\.css$/` |
| Design tokens / theme config | `/tailwind\.config\.(ts\|js\|mjs)$\|\/tokens?\.(ts\|css\|json)$/` |
| HTTP API handlers | `/\/src\/app\/api\/.*\/route\.ts$/` |
| Backend services / domain libraries | `/\/src\/lib\/[^/]+\.ts$/` |
| Database engine (provisioned) | `/(^\|\/)(rds\|elasticache)\.tf$/` |
| Database schema | `/prisma\/schema\.prisma$/` |
| Database migrations | `/prisma\/migrations\/.*\.(sql\|toml)$/` |
| Events / scheduled jobs | `/scheduler\.tf$\|\/api\/jobs\/.*\/route\.ts$\|eventbridge/i` |
| Queues | `/sqs\.tf$\|\/queue[^/]*\.ts$/` |
| Identity and authentication | `/\/src\/lib\/auth\.ts$\|\/api\/auth\/.*\/route\.ts$\|\/src\/lib\/dev-login\.ts$\|cognito/i` |
| Authorization | `/\/rbac\.ts$\|\/authorization\/src\/.*\.ts$\|\/admin\/guard\.ts$/` |
| Tenancy isolation | `/\/tenancy\/[^/]+\.ts$\|\/tenant-scope\.ts$/` |
| File storage | `/\/s3\.ts$\|s3\.tf$/` |
| Search | `/\/search[^/]*\.ts$\|\/search\/.*\.ts$/` |
| AI | `/\/ai\.ts$\|\/api\/ai\/.*\/route\.ts$\|bedrock/i` |
| Outbound integrations (email) | `/ses\.tf$\|\/notify\.ts$/` |
| Observability | `/cloudwatch\.tf$\|instrumentation\.ts$\|\/api\/health\/route\.ts$/` |
| Infrastructure as code | `/^infrastructure\/.*\.tf$/` |
| Unit tests | `/\.(test\|itest)\.(ts\|tsx\|mjs\|js)$/` |
| End-to-end tests | `/\/e2e\/.*\.spec\.ts$/` |
| CI / deployment workflows | `/^\.github\/workflows\/.*\.ya?ml$/` |
