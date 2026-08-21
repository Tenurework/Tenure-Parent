# Email infrastructure audit — what Tenure has TODAY (repo-only, no AWS credentials)

## Summary
Tenure has SES **provisioning** and SES **observability**, but zero SES **sending**. Five SES Terraform resources exist in `infrastructure/terraform/ses.tf` (v1 domain identity for tenurework.com, DKIM, email identity, configuration set, v2 account suppression). A 988-line read-only SES reader exists at `apps/system-studio/src/lib/aws/ses.ts` and IS live — but via the server-rendered `/platform/messaging` page, NOT via `/api/aws/[surface]` (`ses` is absent from SURFACES entirely, not `capability: null`). The application `apps/web` sends no email at all: it has no email SDK dependency, zero send sites, and `notifyUsers()` writes DB rows only. There are ZERO `aws_route53_*` resources anywhere in `infrastructure/`, zero MAIL FROM, zero receipt rules, zero SPF/DMARC/DKIM records-as-code — DKIM tokens are merely printed as a Terraform output for manual registrar entry. The `ses:SendEmail` IAM grant and `SES_FROM_EMAIL` env var are provisioned into the ECS task and read by nothing.

## Findings
## 1. Terraform SES — PARTIAL, five resources, all v1 except suppression

`infrastructure/terraform/ses.tf` is 32 lines. Complete contents by resource:

| Line | Resource | Value |
|---|---|---|
| `ses.tf:4-6` | `aws_ses_domain_identity` `"main"` | `domain = "tenurework.com"` (hardcoded literal, not a variable) |
| `ses.tf:8-10` | `aws_ses_domain_dkim` `"main"` | `domain = aws_ses_domain_identity.main.domain` |
| `ses.tf:13-15` | `aws_ses_email_identity` `"from"` | `email = var.ses_from_email` |
| `ses.tf:18-27` | `aws_ses_configuration_set` `"main"` | `name = "${local.name_prefix}-mail"`; `delivery_options { tls_policy = "Require" }`; `reputation_metrics_enabled = true`; `sending_enabled = true` |
| `ses.tf:30-32` | `aws_sesv2_account_suppression_attributes` `"suppression"` | `suppressed_reasons = ["BOUNCE", "COMPLAINT"]` |

The file's own header comment (`ses.tf:1-3`) concedes the gap:
```
# DNS verification records must be added to the domain registrar after apply.
# Run: terraform output ses_dkim_tokens to get the CNAME records.
```

### What is NOT in Terraform — verified by explicit grep, all returned NONE

Run over `infrastructure/**/*.tf` (all three stacks: `terraform`, `studio`, `oidc`):

- `resource "aws_route53` → **NONE**
- `mail_from` / `MailFrom` → **NONE** (no `aws_ses_domain_mail_from`, no custom MAIL FROM domain, so bounces use `amazonses.com` and SPF alignment is inherited-not-aligned)
- `receipt_rule` / `receipt_rule_set` → **NONE** (no inbound mail at all)
- `event_destination` → **NONE** (the configuration set has no SNS/CloudWatch/Firehose event destination — bounce and complaint *events* are not routed anywhere; `reputation_metrics_enabled` only publishes aggregate CloudWatch metrics)
- `vdm` / `dedicated_ip` → **NONE**
- `aws_sesv2_*` → **only** `aws_sesv2_account_suppression_attributes`. No `aws_sesv2_email_identity`, no `aws_sesv2_configuration_set`, no `aws_sesv2_dedicated_ip_pool`, no `aws_sesv2_contact_list`.
- `dmarc` / `_dmarc` / `v=spf1` / `spf` → **NONE**. The only DKIM mention outside `ses.tf` is the output below.

### The DKIM output — manual handoff, not code

`infrastructure/terraform/outputs.tf:62-65`:
```hcl
output "ses_dkim_tokens" {
  description = "Add these as CNAME records in DNS to verify the domain for SES"
  value       = aws_ses_domain_dkim.main.dkim_tokens
}
```
Three CNAMEs a human is expected to paste at a registrar. Nothing asserts they were ever pasted.

---

## 2. Route 53 — NOTHING is managed as code

There is **no** `aws_route53_zone`, `aws_route53_record`, or `aws_route53_zone_association` in the repository. `tenurework.com` is delegated somewhere Terraform cannot see.

Two places in the repo state this correctly and at length:

`infrastructure/studio/acm.tf:66-67`:
```
#      `grep -rn "aws_route53_zone" infrastructure/` finds none in either stack,
#      so `tenurework.com` is delegated somewhere this configuration cannot see.
```

`infrastructure/studio/variables.tf:205-206`:
```
Two applies, never one. No Route 53 hosted zone for `tenurework.com` is
declared by either stack — `grep -rn "aws_route53_zone" infrastructure/`
```

There is a `studio_hosted_zone_id` variable (`infrastructure/studio/outputs.tf:93` describes CNAMEs being "already written for you when studio_hosted_zone_id is set") — i.e. the Studio stack has an *optional, currently-unset* path to write validation records into a zone id supplied from outside. That is the only zone-adjacent affordance in the tree.

### ⚠️ One code comment contradicts this and will mislead an implementer

`apps/system-studio/src/lib/aws/dns.ts:5` asserts:
```
 * `infrastructure/terraform` provisions Route 53 and nothing in the running
 * product ever issued a Route 53 call, ...
```
The first clause is **false** — grep finds zero Route 53 resources. `dns.ts` is a *reader* of whatever zones happen to exist in the account; it does not imply Terraform created them. Do not take that comment as evidence a zone is managed.

---

## 3. `apps/system-studio/src/lib/aws/ses.ts` — a 988-line READ-ONLY reader, live but not via the API route

### What it reads

Five SESv2 calls, dispatched through the closed switch in `apps/system-studio/src/lib/aws/client.ts` (SDK imports at `client.ts:150-156`):

| Capability id | SDK command | TTL constant | Value |
|---|---|---|---|
| `ses:GetAccount` (`capabilities.ts:757-763`) | `GetAccountCommand` | `SES_ACCOUNT_TTL_MS` (`capabilities.ts:106`) | `90_000` ms |
| `ses:ListEmailIdentities` (`capabilities.ts:765-770`) | `ListEmailIdentitiesCommand` (PageSize 100) | `SES_CONFIG_TTL_MS` (`capabilities.ts:115`) | `600_000` ms |
| `ses:ListConfigurationSets` (`capabilities.ts:772-777`) | `ListConfigurationSetsCommand` (PageSize 100) | `SES_CONFIG_TTL_MS` | `600_000` ms |
| `ses:GetConfigurationSet` (`capabilities.ts:779-786`) | `GetConfigurationSetCommand`, resource-scoped `arn:*:ses:*:*:configuration-set/*` | `SES_CONFIG_TTL_MS` | `600_000` ms |
| `ses:ListSuppressedDestinations` (`capabilities.ts:789-793`) | `ListSuppressedDestinationsCommand` | `SES_SUPPRESSION_TTL_MS` (`capabilities.ts:124`) | `180_000` ms |

Entry point `sesReadings(supplied?: AwsGateway, options?)` at `ses.ts:710-754` returns `SesReadings` (`ses.ts:691-699`) with seven `AwsRead<T>` fields: `identity`, `tagged`, `account`, `identities`, `configurationSetNames`, `configurationSets`, `suppressed`. Page cap `MAX_PAGES = 20` (`ses.ts:312`).

The module's headline product is `mailabilityVerdict(readings)` (`ses.ts:912-985`) → `CAN_SEND` | `CANNOT_SEND` | `UNKNOWN`, which is precisely the "is the domain verified and are we out of the sandbox" question a new SES architecture needs answered. It carries `sendableFrom: readonly string[]` and, in the sandbox case, a non-null `recipientRestriction`.

Notable type discipline worth preserving in any new work: `Stated<T>` (`ses.ts:105`) — `{stated:true,value}` | `{stated:false,why}` — exists so an absent `ProductionAccessEnabled` field can never render as "production access granted".

### Is it wired into `/api/aws/[surface]`? — **NO**

`SURFACES` in `apps/system-studio/src/lib/aws/result.ts:171-256` is a closed table. Its complete membership:

- `capability: null` (not live): `fleet`, `operations`, `cost`
- live (`...live(action)`): `cdn`, `certificates`, `compliance`, `dashboards`, `dns`, `guardduty`, `logs`, `organization`, `pricing`, `quotas`, `waf`

**`ses` is not in the table at all** — it is neither live nor `capability: null`. Confirmed independently at the switch: `apps/system-studio/src/app/api/aws/[surface]/route.ts` has exactly 11 `case` arms (lines 356, 360, 364, 368, 372, 376, 380, 384, 392, 411, 417) and none of them is `"ses"`.

### But it IS live — through a server component

`apps/system-studio/src/app/platform/messaging/page.tsx:23-30` imports `sesReadings`, `mailabilityVerdict`, `describeSesAttribution`, `describeStated`, `SES_ACCOUNT_TTL_MS` from `@/lib/aws/ses`, and the page is `export const dynamic = "force-dynamic"` (`page.tsx:69`). `sesReadings()` called with no gateway falls through to `liveGateway()` (`ses.ts:731`), which dynamically imports `client.ts` and reaches the real `SESv2Client`.

The page is reachable from the nav: `apps/system-studio/src/components/Nav.tsx:251` (`href: "/platform/messaging"`), and is covered by diagnostics registrations at `apps/system-studio/src/app/platform/diagnostics/register.ts:37` and `:129`.

Also consumed by `apps/system-studio/src/lib/aws/inventory.ts:93` (`import { sesReadings, type SesIdentity } from "./ses"`).

**So: the reader is production-live, just on a different transport than the task assumed.** Anyone adding an SES surface to `/api/aws/[surface]` must edit three files by the table's own doc comment (`result.ts:164-169`): the SURFACES table, the switch in `route.ts`, and the IAM grant.

### Sending is deliberately impossible from the Studio

`client.ts:526-529`:
```
/* ------------------------------------------------ SES (SESv2) --
 * `SendEmailCommand` is not imported, and `ses:SendEmail` is denied on
 * the task role. The console reports on this account's mail; it does
 * not send any.
 */
```
Enforced in three places:
- `capabilities.ts:753` — "`ses:SendEmail` is deliberately absent and is explicitly DENIED on the..."
- `apps/system-studio/src/lib/aws/ses.test.ts:934-936` — `expect(Object.keys(CAPABILITIES)).not.toContain("ses:SendEmail")`
- `infrastructure/studio/iam.tf:785-788` — explicit `Effect = "Deny"` (Sid `NeverWrite`, `iam.tf:742-744`) on `ses:SendEmail`, `ses:SendBulkEmail`, `ses:DeleteEmailIdentity`, `ses:PutAccountSendingAttributes`

Studio read grants: `infrastructure/studio/iam.tf:346-349` (`ses:GetAccount`, `ses:ListEmailIdentities`, `ses:ListConfigurationSets`, `ses:ListSuppressedDestinations`) plus resource-scoped `ses:GetConfigurationSet` at `iam.tf:441-442`. `tests/security/studio-task-role-is-narrow.test.mjs` parses this file (per `iam.tf:66`).

---

## 4. Does the application send any email? — **NO. Zero send sites.**

### Dependency evidence

`apps/web/package.json` contains exactly two AWS SDK packages:
```
"@aws-sdk/client-s3": "^3.1085.0",
"@aws-sdk/s3-request-presigner": "^3.1085.0",
```
No `@aws-sdk/client-ses`, no `@aws-sdk/client-sesv2`, no `nodemailer`, `resend`, `postmark`, `@sendgrid/mail`, or `mailgun`. `apps/system-studio/package.json` has `@aws-sdk/client-sesv2: ^3.1106.0` — read-only use, above.

### Grep evidence

A repo-wide scan (excluding `node_modules`, `.git`, `.swc`, `test-results`) over `*.ts,*.tsx,*.mjs,*.js,*.tf` for `sendEmail|sendRawEmail|nodemailer|postmark|sendgrid|mailgun|createTransport|smtp` returns **14 hits, none of which is a send call**:

- 6 hits are Studio comments/tests asserting SendEmail is *absent* (`capabilities.test.ts:111`, `capabilities.ts:753`, `client.ts:527`, `ses.test.ts:934`, `ses.test.ts:936`)
- 3 are IAM comments/denies (`studio/iam.tf:330`, `:437`, `:785`)
- 1 is the unused ECS grant (`terraform/ecs.tf:104`)
- 2 are tooling *detectors* looking for SES usage: `tools/simon-mapping-matrices.mjs:194` — `{ provider: 'Amazon SES (email)', match: /@aws-sdk\/client-ses|\bSESv?2?Client\b|\bSendEmailCommand\b/ }` — and `tools/int-integration-inventory.mjs:501`
- 2 are test fixtures naming a secret `tenure/prod/ses-smtp` (`apps/system-studio/src/lib/aws/secrets.test.ts:142,143,455,463`). **This secret is a test fixture only** — `infrastructure/terraform/secrets.tf` and `infrastructure/studio/secrets.tf` contain no SES/SMTP secret. Do not assume SMTP credentials exist.

### How notifications actually reach a user today: an in-app bell, DB rows only

`apps/web/src/lib/notify.ts:41` — `export async function notifyUsers(userIds, opts: {title, body?, href?, excludeUserId?})`. Its entire delivery is `db.notification.createMany(...)` (`notify.ts:49-56`). The module hardcodes `const IN_APP = "IN_APP" as const` (`notify.ts:11`) and its doc comment says outright:

```
 * `notifyUsers` writes `Notification` rows, which are read by the in-app bell —
 * so IN_APP is the only consent that can govern it. A person who has turned
 * EMAIL off has said nothing about the bell, and must keep receiving it
```

The schema already models email channels that **nothing reads**:
- `apps/web/prisma/schema.prisma:1252-1256` — `enum NotificationChannel { IN_APP  EMAIL  EMAIL_DIGEST }`
- `apps/web/prisma/schema.prisma:1332-1341` — `model NotificationPreference { userId, channel, enabled @default(true), @@unique([userId, channel]) }`

`inAppRecipients()` (`notify.ts:27-34`) queries only `channel: IN_APP`. `EMAIL` and `EMAIL_DIGEST` are inert enum members.

### Invitations, password resets, verification — none of these send mail

- **Auth is SSO + a pilot credential shim, no email provider.** `apps/web/src/lib/auth.ts:3-4` imports `Okta from "next-auth/providers/okta"` and `Credentials from "next-auth/providers/credentials"`. `providers:` at `auth.ts:193-194` is `...oktaProviders` plus, when `devLoginEnabled`, a `Credentials({ id: "dev-login", name: "Pilot demo user" })`. **There is no NextAuth `Email` provider and no magic link.** So no password-reset or verification mail is required by the auth design.
- `model VerificationToken` exists at `apps/web/prisma/schema.prisma:47-53` (NextAuth's standard shape) but with no Email provider nothing writes it. `schema.prisma:1652` notes NextAuth's `VerificationToken` shape "is not the shape used here."
- **"Invitation" language in the app is in-app only.** `apps/web/src/app/(app)/admin/actions.ts:848` and `:902` produce `notifyUsers(...)` bodies about a Director role transfer — DB notification rows, not email.
- `INVITE_ONLY` at `schema.prisma:607` is an `EventAudience` enum member (event visibility), unrelated to user invitations.
- `ConnectionLaunchToken` (`schema.prisma:1654+`) is a `sha256`-hashed bearer token whose doc says "The value exists only in the URL the person was handed" — handed by some out-of-band means; minted at `apps/web/src/app/api/connections/opportunity/route.ts`. No mail path.
- **The only outbound-email affordance in the entire app is a client-side `mailto:` link**: `apps/web/src/components/EmailLink.tsx:19-21` builds `mailto:${email}?subject=...`. That opens the *user's own* mail client.

### Studio operator onboarding also sends nothing

`infrastructure/studio/cognito.tf:118` — `message_action = "SUPPRESS"` on `aws_cognito_user.operators`, with `attributes = { email, email_verified = "true" }` (`cognito.tf:120-123`). The comment at `cognito.tf:103` says "no invite, so no reset is ever forced". There is **no `email_configuration` block** in `cognito.tf`, so the pool would fall back to `COGNITO_DEFAULT` (Cognito-managed sending, ~50 messages/day, not SES) if any flow ever did send — but with `SUPPRESS` set, invitations do not.

---

## 5. The provisioned-but-dead sending path

Everything needed to send exists except the code that calls it:

- **IAM grant, unused** — `infrastructure/terraform/ecs.tf:103-110`:
```hcl
{
  Effect   = "Allow"
  Action   = ["ses:SendEmail", "ses:SendRawEmail"]
  Resource = "*"
  Condition = {
    StringEquals = {
      "ses:FromAddress" = var.ses_from_email
    }
  }
}
```
Note this grant is **not** scoped to the configuration set — nothing forces a send through `tenure-pilot-mail`, so reputation metrics and the TLS-Require policy would be bypassed by a naive `SendEmail` that omits `ConfigurationSetName`.

- **Env var, injected and never read** — `infrastructure/terraform/ecs.tf:151`: `{ name = "SES_FROM_EMAIL", value = var.ses_from_email }`. Grep for `SES_FROM_EMAIL` across `apps/`, `tools/`, `tests/`, `docs/` returns **only docs** (four hits in `docs/architecture/*`), never a `process.env` read.

- **An SQS email queue, unused** — `infrastructure/terraform/sqs.tf:26-36`:
```hcl
# Email delivery jobs (transactional + digests)
resource "aws_sqs_queue" "email" {
  name                       = "${local.name_prefix}-email"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 3600 # 1 hour — stale emails not useful
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.email_dlq.arn
    maxReceiveCount     = 3
  })
}
```
with `SQS_EMAIL_URL` injected at `ecs.tf:150` and read by nothing.

### The repo's own docs already say all of this

`docs/architecture/CURRENT-STATE-INVENTORY.md:182` (my greps independently confirm every clause):
> **No email is ever sent** — SES is provisioned, `SES_FROM_EMAIL` injected, and the only outbound-email code in the app is `mailto:` links (`src/components/EmailLink.tsx:19`). `NotificationPreference`/`NotificationChannel` exist in the schema but nothing reads them.

`docs/architecture/PLATFORM-ARCHITECTURE.md:6598` contains a prior design opinion worth reading before planning:
> When mail ships: a per-tenant `fromAddress` and `replyTo` on `Institution`, one SES configuration set per environment (not per tenant), a `Suppression` table keyed `(institutionId, email)`, and `NotificationPreference` finally read. Do not build a per-tenant SES identity or DKIM-per-custom-domain until a tenant demands their own sending domain — that is a per-tenant DNS onboarding workflow and it is the most underestimated item on this list.

Per `CLAUDE.md`, `docs/architecture/REVIEW-FINDINGS.md` supersedes `PLATFORM-ARCHITECTURE.md` where they disagree; I did not audit REVIEW-FINDINGS for email content in this pass.

---

## 6. The delta, stated as work

**Exists (do not rebuild):** domain identity, DKIM key generation, one configuration set with TLS-Require + reputation metrics, account-level BOUNCE/COMPLAINT suppression, a send IAM grant, an email SQS queue + DLQ, a 988-line verified-and-tested SES read/observability layer with a mailability verdict, a notification table + preference model with EMAIL channels already enumerated.

**Does not exist (all of it is new work):**
1. Any code that calls `SendEmail`/`SendEmailV2` anywhere in the product.
2. `@aws-sdk/client-sesv2` as an `apps/web` dependency.
3. Any Route 53 hosted zone or record as code — including the DKIM CNAMEs, which are currently a manual registrar chore driven off `terraform output ses_dkim_tokens`.
4. SPF, DMARC, and custom MAIL FROM (`aws_ses_domain_mail_from`) — none, at any level.
5. Configuration-set event destinations — bounce/complaint *events* go nowhere; only aggregate CloudWatch metrics are enabled.
6. Anything reading `NotificationPreference` for `EMAIL` / `EMAIL_DIGEST`.
7. A consumer for `aws_sqs_queue.email`.
8. An `ses` entry in `SURFACES` + `route.ts` if API-route access to the reader is wanted (the page path already works without it).
9. A per-tenant suppression model (`Suppression` keyed `(institutionId, email)` per the architecture doc) — only the account-level AWS suppression list exists.
10. Any binding of the send grant to the configuration set.

## Concrete values
**Terraform identifiers (region `us-east-1`, `infrastructure/terraform/variables.tf:13-17`)**

- `local.name_prefix = "${var.project}-${var.environment}"` (`infrastructure/terraform/main.tf:70`)
- `var.project` default `"tenure"` (`variables.tf:1-5`)
- `var.environment` default `"pilot"` (`variables.tf:7-11`)
- ⇒ **configuration set name = `tenure-pilot-mail`**
- ⇒ SQS email queue name = `tenure-pilot-email`
- `var.ses_from_email` default = **`hello@tenurework.com`** (`variables.tf:115-119`, description "Verified SES sender address")
- SES domain identity domain = **`tenurework.com`** (hardcoded at `ses.tf:5`, NOT a variable)
- Custom app domain `var.custom_domain` default = `platform.tenurework.com` (`variables.tf:138`)
- Studio host `helm.tenurework.com` (`infrastructure/studio/variables.tf:195`)

**Terraform resource addresses that exist**
```
aws_ses_domain_identity.main
aws_ses_domain_dkim.main
aws_ses_email_identity.from
aws_ses_configuration_set.main
aws_sesv2_account_suppression_attributes.suppression
aws_sqs_queue.email
aws_sqs_queue.email_dlq
```

**Terraform output**: `ses_dkim_tokens` = `aws_ses_domain_dkim.main.dkim_tokens` (`outputs.tf:62-65`)

**ECS task env vars injected, never read**: `SES_FROM_EMAIL` (`ecs.tf:151`), `SQS_EMAIL_URL` (`ecs.tf:150`), `REDIS_URL` (`ecs.tf:146`), `SQS_DEFAULT_URL`, `SQS_NOTIFICATIONS_URL`

**Studio capability ids + TTLs** (`apps/system-studio/src/lib/aws/capabilities.ts`)
```
ses:GetAccount                  SES_ACCOUNT_TTL_MS      = 90_000 ms   (:106, :757)
ses:ListEmailIdentities         SES_CONFIG_TTL_MS       = 600_000 ms  (:115, :765)
ses:ListConfigurationSets       SES_CONFIG_TTL_MS       = 600_000 ms  (:772)
ses:GetConfigurationSet         SES_CONFIG_TTL_MS       = 600_000 ms  (:779)
                                resource arn:*:ses:*:*:configuration-set/*
ses:ListSuppressedDestinations  SES_SUPPRESSION_TTL_MS  = 180_000 ms  (:124, :789)
```

**`SURFACES` complete membership** (`apps/system-studio/src/lib/aws/result.ts:171-256`) — `ses` absent:
```
capability: null →  fleet (dynamodb:Scan, budget 60/60s)
                    operations (dynamodb:Query, budget 120/60s)
                    cost (ce:GetCostAndUsageWithResources, budget 6/60s)
live()          →  cdn, certificates, compliance, dashboards, dns,
                   guardduty, logs, organization, pricing, quotas, waf
```

**Prisma enum already present, unread** (`apps/web/prisma/schema.prisma:1252-1256`)
```prisma
enum NotificationChannel { IN_APP  EMAIL  EMAIL_DIGEST }
```

**Test fixture secret name — NOT real infrastructure**: `tenure/prod/ses-smtp` appears only in `apps/system-studio/src/lib/aws/secrets.test.ts:142,143,455,463`.

**Verbatim IAM grant to reuse or replace** (`infrastructure/terraform/ecs.tf:103-110`)
```hcl
{
  Effect   = "Allow"
  Action   = ["ses:SendEmail", "ses:SendRawEmail"]
  Resource = "*"
  Condition = {
    StringEquals = {
      "ses:FromAddress" = var.ses_from_email
    }
  }
}
```

## Sources


## Confidence / not asserted
**Everything below is UNVERIFIABLE-WITHOUT-AWS.** There are no AWS credentials in this environment; I read only repository files and ran no AWS calls.

1. **Whether `tenurework.com` is actually verified in SES.** Terraform declares the identity; verification requires the three DKIM CNAMEs to be published at whatever registrar/DNS provider holds the domain. Nothing in the repo records that this happened, and `ses.ts`'s own header (`ses.ts:11-13`) names this as one of the two silent-failure modes it was written to detect. I cannot say whether it is verified.
2. **Whether the account is in the SES sandbox.** `mailabilityVerdict` exists precisely because `ProductionAccessEnabled` must be read live. I cannot read it.
3. **Whether a Route 53 hosted zone for `tenurework.com` exists in the AWS account.** It is definitively *not in Terraform* — that I verified by grep. But `infrastructure/studio/acm.tf:71` suggests the check `aws route53 list-hosted-zones --query "HostedZones[?Name=='tenurework.com.']"`, implying the authors also did not know. A zone may exist unmanaged, or the domain may be delegated to a third-party DNS provider entirely.
4. **Whether SPF / DMARC / DKIM records exist in real DNS.** None are managed as code. Whether any were hand-created at the registrar is invisible from here. Do not assume either way.
5. **Whether `terraform apply` has actually been run against `ses.tf`.** Resource declarations are not proof of applied state, and CLAUDE.md notes the production workflows in this repo are deliberately disarmed.
6. **Whether the SES account-level suppression list currently has entries**, and how large it is.
7. **Cognito's effective email path.** `cognito.tf` has no `email_configuration` block, so AWS's documented default is `EmailSendingAccount: COGNITO_DEFAULT` with a low daily cap — but I am asserting that from the *absence* of the block plus general AWS behavior, not from a fetched AWS doc page in this session. Treat the "50 emails/day" figure as recalled, not verified. In any case `message_action = "SUPPRESS"` (`cognito.tf:118`) means no invite is sent; a hosted-UI forgot-password flow could still send, and I could not confirm whether that flow is reachable.

**One in-repo contradiction flagged rather than resolved:** `apps/system-studio/src/lib/aws/dns.ts:5` claims "`infrastructure/terraform` provisions Route 53". Grep contradicts it and two other files (`studio/acm.tf:66-67`, `studio/variables.tf:205-206`) state the opposite explicitly. I am reporting the grep result as authoritative and the comment as stale/loose, but I did not trace the comment's history to prove intent.

**Scope I did not cover:** I did not audit `docs/architecture/REVIEW-FINDINGS.md` (which CLAUDE.md says supersedes `PLATFORM-ARCHITECTURE.md`) for email-specific findings; if it contains an email/notification section it should be read before this spec is turned into a plan. I also did not read `Tenure_*_Claude_Bible_*.md` root documents, which may contain the user's intended SES architecture.

**Tree was being edited concurrently** by another agent (`git status` showed 6 modified files, none email-related: calendar e2e spec, relay provenance-context, three ledgers, capability registry yaml). No file I quoted was among them.

**Read-only compliance:** I ran only `grep`, `cat`, `sed -n`, `ls`, `find`, `wc`, and `git status`/`git branch`. No file was created, edited, staged, or deleted; no npm or AWS command was run.

## Risks
**1. The `ses:SendEmail` grant is not bound to the configuration set.** `ecs.tf:103-110` conditions only on `ses:FromAddress`. The first `SendEmail` call anyone writes will succeed *without* `ConfigurationSetName`, silently bypassing `tls_policy = "Require"` and `reputation_metrics_enabled` on `tenure-pilot-mail`. The grant should gain a condition or the send helper must hardcode the set name — decide which, deliberately.

**2. No event destination means bounces are invisible per-message.** The configuration set has `reputation_metrics_enabled = true` (aggregate CloudWatch only) and no SNS/Firehose destination. Account-level suppression will silently absorb BOUNCE/COMPLAINT, so a tenant asking "why did this student not get their reminder" is answerable only by polling `ListSuppressedDestinations` (which `ses.ts` already does, on a 180s TTL). Real per-message diagnosis needs an event destination that does not exist.

**3. Suppression is account-wide, not tenant-scoped.** `aws_sesv2_account_suppression_attributes` suppresses globally. One tenant's bounce removes that address for every tenant. `PLATFORM-ARCHITECTURE.md:6598` anticipates a `Suppression` table keyed `(institutionId, email)`; nothing implements it.

**4. The suppression list contains real people's addresses.** `ses.ts`'s header is explicit that `ListSuppressedDestinations` returns identifiable students, that entries are carried deliberately, and that `maskedAddress` (`maskAddress`, `ses.ts:622`) exists so surfaces can render shape without identity. Any new surface printing `address` is making a privacy choice; it should be made explicitly, not by default.

**5. No custom MAIL FROM ⇒ SPF is not aligned.** Without `aws_ses_domain_mail_from`, the envelope domain is `amazonses.com`. DKIM alignment alone can pass DMARC, but a future `p=reject` DMARC policy authored without a MAIL FROM domain is a deliverability cliff. Sequence MAIL FROM *before* DMARC enforcement.

**6. Route 53 as code is a prerequisite, not a nice-to-have.** With zero `aws_route53_*` resources, every DNS fact (DKIM CNAMEs, SPF TXT, DMARC TXT, MAIL FROM MX+SPF) is a manual registrar action with no drift detection. If the user's "full SES architecture" assumes records-as-code, importing or creating the hosted zone is the first blocking task — and `studio/acm.tf:29` records that a **CAA record on `tenurework.com` already caused a real `CAA_ERROR`** on an earlier ACM request, which is direct evidence that the domain's DNS is controlled somewhere outside this codebase and has non-default records on it.

**7. Do not remove the Studio's `ses:SendEmail` Deny to "make sending work".** It is asserted by `apps/system-studio/src/lib/aws/ses.test.ts:936` and parsed by `tests/security/studio-task-role-is-narrow.test.mjs`. Sending belongs to the `apps/web` ECS task role (`ecs.tf`), which already has the grant. Two different roles, on purpose.

**8. `apps/web` gains its first SESv2 dependency.** Adding `@aws-sdk/client-sesv2` to `apps/web/package.json` will be picked up by `tools/simon-mapping-matrices.mjs:194` and `tools/int-integration-inventory.mjs:501`, which actively scan for exactly this pattern. Expect integration-inventory output to change and a snapshot/ledger to need updating.

**9. `notifyUsers()`'s consent model does not extend to email.** `notify.ts:11` hardcodes `IN_APP` and its comment argues that an EMAIL opt-out says nothing about the bell. The inverse is the live risk: reusing `notifyUsers` for email without adding an `EMAIL`-channel filter would mail people who opted out. `NotificationPreference` rows are written only on change, so **absence of a row means consent** (`notify.ts:17-19`) — an email fan-out against an empty preference table mails everyone.

**10. CLAUDE.md's disarm rule applies.** Any `.github/workflows` change accompanying SES work must retain `if: github.repository == 'Tenurework/Tenure'` on AWS-touching jobs; `npm run test:platform` asserts it.
