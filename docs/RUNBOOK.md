# Tenure Pilot Runbook

Live URL: https://d1n6mdis7bs02g.cloudfront.net · AWS account `154932391697` (us-east-1)

## Repository layout

This is an npm-workspaces monorepo. The application is the `apps/web` workspace;
`infrastructure/`, `docs/` and `.github/workflows/` stay at the root.

Unqualified paths below (`prisma/schema.prisma`, `scripts/seed.mjs`,
`src/lib/env.ts`, …) are **relative to `apps/web/`**, which is also the
directory the container runs from once `prisma/` and `scripts/` are flattened
into its `/app` workdir. Anything run against the app — prisma, jest,
playwright, next — either runs from `apps/web` or goes through a root
delegating script (`npm run build`, `npm test`, `npm run e2e`), never from the
monorepo root directly.

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
cd apps/web                                       # prisma resolves ./prisma from cwd
npx prisma migrate dev --name what-you-changed    # writes prisma/migrations/<ts>_<name>/
npm test --workspace apps/web                     # planner + env contract (from anywhere)
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

## The interim sign-in gate

Until Okta is live, passwordless sign-in sits behind a shared passphrase.
Terraform generates it and stores it; nothing needs setting up by hand.

```sh
aws secretsmanager get-secret-value --secret-id tenure-pilot/dev-login \
  --query SecretString --output text
```

Give that to pilot users. It is enforced server-side in
`src/lib/auth.ts` before the account lookup, so a wrong passphrase cannot even
be used to probe which emails exist, and `src/lib/env.ts` refuses to boot if dev
login is on in production without one.

**Removing it when Okta lands** — one step, in this order:

1. Put `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET` into Secrets
   Manager (`tenure-pilot/app`). Okta registers itself once `OKTA_ISSUER`
   is an `https://` URL (`src/lib/auth.ts`).
2. In `ecs.tf`, set `AUTH_DEV_LOGIN` to `"false"` and delete both
   `ALLOW_DEV_LOGIN_IN_PRODUCTION` and the `DEV_LOGIN_PASSPHRASE` secret entry.
3. Delete `infrastructure/terraform/dev-login-gate.tf` and its ARN from the
   `ecs_secrets` policy in `secrets.tf`.

The gate adds no sign-in path of its own, so removing `AUTH_DEV_LOGIN` removes
the provider it guards and there is nothing left behind. Also delete the seeded
`@tenure.demo` users at that point — they are accounts with no credential.

## Known pilot limitations

- **Passwordless dev sign-in is on in production, behind an interim gate.**
  `AUTH_DEV_LOGIN=true` plus the seeded `@tenure.demo` accounts would otherwise
  mean anyone who can reach the site signs in as OSE Director. A shared
  passphrase now stands in front of it (below). That is a stopgap, not the fix:
  every pilot user holds the same secret, so it does not identify anyone and it
  still blocks real institutional data. Okta closes it properly.
- Reference data is published by the "Seed reference data" workflow, which runs
  `scripts/seed.mjs` once as a one-off ECS task. It is **not** run at container
  start: `SEED_ON_BOOT` is deliberately unset in `ecs.tf`, because the script is
  an e2e fixture that issues unscoped deletes. Migrations still run at boot; a
  backfill longer than the ALB health-check grace period will need its own
  `RunTask` stage.
- Single ECS task (no HA); scale `ecs_desired_count` for production.
- Free-tier account caps RDS backups at 1 day — raise to 7 after upgrading.
- **No rate limiting.** The edge gate below blocks unknown viewers outright, so
  the pilot is not exposed, but nothing throttles an allowlisted one. Anything
  expensive and authenticated — AI synthesis in particular, which calls a paid
  API per question with no per-user quota — is unprotected against a tester
  holding the access token. Attach `aws_wafv2_web_acl` with rate-based rules
  before the gate comes off.
- The app runs as the RDS master user (`entrypoint.sh` composes `DATABASE_URL`
  from the AWS-managed master secret), so a server-side compromise gets
  database-owner rights rather than the CRUD its queries need.

## The closed-pilot access gate

The pilot is not reachable from an arbitrary address. A CloudFront Function
(`infrastructure/terraform/edge-access.tf`) runs on viewer request, before the
cache and before the origin, and answers 403 to anyone it does not recognise.

This exists because the interim sign-in passphrase above is one control, and
one control in front of a real 172-person directory and a one-click
`OSE_DIRECTOR` account is not enough. Two independent things now have to be
wrong before a stranger sees institutional data.

**Getting in.** Terraform prints a one-time entry link:

```sh
cd infrastructure/terraform && terraform output -raw edge_access_url
```

Opening it sets a 30-day `HttpOnly` cookie on that browser and redirects to the
page with the token stripped from the URL. That link plus the sign-in passphrase
is what a pilot tester needs. The operator's own addresses are also allowlisted
in `var.edge_allowed_ips`, so a normal working session needs neither — but the
link is the recovery path when an ISP renumbers, a phone is on cellular, or
CloudFront serves the same laptop over IPv6.

**Adding someone's network.** Append to `edge_allowed_ips` in `edge-access.tf`
and deploy. Prefer handing out the link; an address list goes stale silently.

**Two paths stay open, deliberately** — `/api/health`, which `deploy.yml` curls
from a GitHub Actions runner whose address cannot be allowlisted, and
`/api/jobs/reminders`, which EventBridge POSTs daily and which already requires
`JOB_SECRET`. Both are exact-match, so no path walks out of the exemption.

**The origin is closed too.** The ALB security group accepts port 80 only from
the `com.amazonaws.global.cloudfront.origin-facing` managed prefix list. It was
previously open to `0.0.0.0/0` under a comment claiming otherwise, which meant
the ALB's DNS name served the whole application in clear text and would have
walked straight around this gate.

**Removing it** when Okta is live and real people can authenticate: delete
`edge-access.tf` and the three `function_association` blocks in `cloudfront.tf`.
Leave the security-group rule alone — the origin should stay closed permanently.
