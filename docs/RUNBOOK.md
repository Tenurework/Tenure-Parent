# Tenure Pilot Runbook

Live URL: https://d1n6mdis7bs02g.cloudfront.net · AWS account `154932391697` (us-east-1)

## Onboarding a real institution

1. **Institution + OSE staff.** Adapt `scripts/seed.mjs` (or run the same Prisma calls
   from a one-off script): create the `Institution` (name, slug, email `domain`),
   the OSE users, and their `InstitutionMembership` rows (`OSE_DIRECTOR` / `OSE_STAFF`).
2. **Clubs and seats.** For each club: `Organization` (slug is the URL), then `Role`
   seats — one `PRESIDENT`, functional VP seats, one `MEMBER` role.
3. **People.** Create `User` rows with real university emails and `RoleAssignment`s:
   `ACTIVE` for current holders, `SHADOW` for incoming leaders. Do not backfill
   ALUMNI unless the history matters on day one.
4. **Auth.** Real logins require Okta:
   - Create an Okta OIDC app (redirect URI: `https://<domain>/api/auth/callback/okta`).
   - Put `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`, `OKTA_ISSUER` into Secrets Manager
     secret `tenure-pilot/app` (console → edit the JSON keys, they already exist).
   - Set `AUTH_DEV_LOGIN` to `"false"` in `infrastructure/terraform/ecs.tf` and deploy.
     **The demo picker must be off before real data enters the system.**
5. **Domain.** Point a real domain at CloudFront (ACM cert in us-east-1 + alias in
   `cloudfront.tf`), update `NEXTAUTH_URL` in `ecs.tf`.

## Routine operations

| Task | How |
|---|---|
| Deploy | Push to `main` — CI (48 unit + 32 e2e tests) gates, version verified live |
| Diagnose prod | Actions → **Debug Logs** workflow → ECS events + container log heads |
| Rotate auth secret | Actions → **Rotate Auth Secret** workflow (invalidates sessions) |
| DB access | RDS is VPC-only; connect via a bastion or `aws ecs execute-command` |
| Metrics | CloudWatch dashboard `tenure-pilot-ops`; alarms on 5xx, task count, RDS CPU, DLQ |

## Security posture (Week 8 review)

- **AuthN:** NextAuth v5, JWT sessions, `trustHost` behind CloudFront/ALB.
  Pilot dev-login is ON for demos — see step 4 above before real rollout.
- **AuthZ:** every server action re-checks permissions server-side
  (`src/lib/rbac.ts`, `memory.ts`, `messaging.ts`, `approvals.ts`); denials are
  audit-logged and surface on `/reports`.
- **Secrets:** Secrets Manager (app bundle + RDS-managed DB password), injected
  at task start; nothing in the repo. `ANTHROPIC_API_KEY` via GitHub secret →
  Terraform var.
- **Data:** RDS encrypted, deletion protection + final snapshot on; S3 documents
  SSE-AES256, private, presigned 10-min downloads; append-only `AuditEvent` and
  `ApprovalStep` trails.
- **Transport:** TLS at CloudFront (min TLSv1.2), HSTS + nosniff + frame-deny +
  referrer-policy headers app-wide.
- **AI:** the model receives only content the requesting user can already see;
  answers must cite numbered sources.

## Changing the database schema

Schema changes are versioned. Editing `prisma/schema.prisma` is half the change;
the migration is the other half, and CI fails without it.

```sh
npx prisma migrate dev --name what-you-changed   # writes prisma/migrations/<ts>_<name>/
npm test                                          # planner + env contract
```

At container start `scripts/db-bootstrap.mjs` runs `prisma migrate deploy` and
**exits non-zero if it cannot prove the schema is current**, so ECS rolls back
rather than serving against an unknown shape. Prisma holds a Postgres advisory
lock, so several tasks starting at once serialise instead of racing.

The pilot database predates migrations, so it carries a recorded-not-replayed
baseline (`20260730000000_baseline`). Nothing special is needed for it — the
bootstrap detects that state and records the baseline once. See
`docs/decisions/ADR-0001-versioned-migrations-and-boot-safety.md`.

Never run `prisma db push` against the pilot: it is unversioned, and
`--accept-data-loss` will drop columns to reach the target shape.

## Environment

`src/lib/env.ts` is checked at boot (`src/instrumentation.ts`). A misconfigured
environment is a boot failure naming the variable, not a 500 later. In
production it refuses:

| Refused | Why |
|---|---|
| `AUTH_DEV_LOGIN=true` without `ALLOW_DEV_LOGIN_IN_PRODUCTION=true` | passwordless sign-in as any seeded account, including OSE Director |
| Neither dev login nor complete Okta | nobody can sign in |
| `AUTH_SECRET` under 32 chars, or a known placeholder | forgeable sessions |
| Non-https `NEXTAUTH_URL` (except loopback) | session cookie in clear |

`.env.example` documents every variable for local setup.

## Known pilot limitations

- **Passwordless dev sign-in is on in production.** `AUTH_DEV_LOGIN=true` plus
  the seeded `@tenure.demo` accounts means anyone who can reach the site can
  sign in as the OSE Director. It is now acknowledged explicitly in `ecs.tf`
  (`ALLOW_DEV_LOGIN_IN_PRODUCTION`) rather than being an unstated default, but
  the exposure is unchanged and it blocks real institutional data. Closing it
  needs Okta credentials from the institution.
- Reference data is still delivered by `scripts/seed.mjs` at container start via
  `SEED_ON_BOOT=true`. It no longer creates demo accounts there
  (`SEED_DEMO_ACCOUNTS` defaults off when `NODE_ENV=production`). Moving it to a
  one-off ECS `RunTask` stage is the follow-up; it is also what a long backfill
  will need, since a migration that outlives the ALB health-check grace period
  cannot run at boot.
- Single ECS task (no HA); scale `ecs_desired_count` for production.
- Free-tier account caps RDS backups at 1 day — raise to 7 after upgrading.
- No WAF/rate limiting at the edge yet (add `aws_wafv2_web_acl` when public).
