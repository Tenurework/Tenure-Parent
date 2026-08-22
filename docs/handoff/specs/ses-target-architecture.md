# SES infrastructure + application sender design, verified against AWS documentation and against the live DNS/Terraform state of tenurework.com

## Summary
The user's design is sound and AWS-legal on every point I could check — domain identities really do allow arbitrary local parts, a dedicated MAIL FROM subdomain is exactly what AWS requires, and us-east-1 (the stack's region) supports SES inbound. But three facts on the ground change the plan materially. (1) DNS for tenurework.com is hosted at **Vercel** (`ns1/ns2.vercel-dns.com`), not Route 53 — so no `aws_route53_record` in this repo can publish a single SES record today; Terraform can only emit outputs a human pastes, unless the three sending subdomains are delegated to a Route 53 zone. (2) The apex has **no SPF, no DKIM, and no DMARC** at all right now — Google Workspace human mail is unauthenticated. That means the SPF-collision risk the user worried about does not exist yet, but it also means an apex DMARC record published carelessly would break human email. (3) `infrastructure/terraform/ses.tf` currently verifies `tenurework.com` itself and an email identity `hello@tenurework.com`, and `ecs.tf` injects `SES_FROM_EMAIL=hello@tenurework.com` into the running task — the exact thing the design forbids. There is no application mail sender in `apps/web` at all yet, so the sender module is greenfield.

## Findings
# SES build spec — tenurework.com

## 0. What I verified, and how

| Claim | Verified by |
|---|---|
| Custom MAIL FROM must be a subdomain, not used for sending or receiving | `docs.aws.amazon.com/ses/latest/dg/mail-from.html`, fetched. Verbatim: "The MAIL FROM domain has to be a subdomain of the parent domain of a verified identity"; "shouldn't be a subdomain that you also use to send email from"; "shouldn't be a subdomain that you use to receive email." |
| Exactly one MX on the MAIL FROM domain | Same page: "you must publish exactly one MX record to the DNS server of your MAIL FROM domain. If the MAIL FROM domain has multiple MX records, the custom MAIL FROM setup with Amazon SES will fail." |
| MAIL FROM MX value + SPF value | Terraform provider docs source (`ses_domain_mail_from.html.markdown`): `10 feedback-smtp.us-east-1.amazonses.com`, `v=spf1 include:amazonses.com ~all`. Endpoint hostname cross-checked against `general/latest/gr/ses.html` "Feedback endpoints used by SES for Custom MAIL FROM domains". |
| Domain identity ⇒ arbitrary local parts, no per-address verification | `creating-identities.html`, verbatim: "when you verify a domain identity, you can send email from any subdomain or email address of the verified domain without having to verify each one individually." **With one caveat, below.** |
| DKIM CNAME shape | Same page: three CNAMEs, value `{token}.dkim.amazonses.com`; `general/latest/gr/ses.html` "DKIM domains" table confirms us-east-1 falls under "All other regions" ⇒ `dkim.amazonses.com`. Record name is `{token}._domainkey.{domain}` with **no** leading underscore on the token. |
| SES inbound region list | `general/latest/gr/ses.html` "Email Receiving endpoints" — 22 regions, **us-east-1 included**, endpoint `inbound-smtp.us-east-1.amazonaws.com`. Not supported in `eu-central-2`, `ap-south-2`, `ap-southeast-5`, `me-central-1`, `ca-west-1`, `us-gov-*`. |
| Inbound MX record | `receiving-email-mx-record.html`: value `10 inbound-smtp.{region}.amazonaws.com`, priority `10`. |
| Recipient matching is on the SMTP envelope | `receiving-email-concepts.html`: "Recipient conditions are evaluated against the SMTP envelope recipients (the addresses specified in the `RCPT TO` command) … not against the `To:` or `Cc:` headers." Only **one rule set is active at a time**. |
| DMARC SPF alignment needs a custom MAIL FROM and relaxed aspf | `send-email-authentication-dmarc.html`: "In order to achieve SPF alignment with SES, the domain's DMARC policy must not specify a strict SPF policy (aspf=s)." |
| Sandbox limits | `request-production-access.html`: verified recipients only, **200 messages / 24 hours**, **1 message / second**; "AWS Support team provides an initial response … within 24 hours." |
| Message-tag character set | `event-publishing-send-email.html`: "Message tags can include the numbers 0–9, the letters A–Z (both uppercase and lowercase), hyphens (-), and underscores (_)." Headers `X-SES-CONFIGURATION-SET` / `X-SES-MESSAGE-TAGS`. |
| Google bulk-sender rules | `support.google.com/a/answer/81126`: 5,000+/day ⇒ SPF **and** DKIM **and** DMARC (`p=none` acceptable), "the domain in the sender's From: header must be aligned with either the SPF domain or the DKIM domain", spam rate **<0.30%** (aim <0.10%), TLS, forward+reverse DNS. "Marketing messages and subscribed messages must support one-click unsubscribe, and include a clearly visible unsubscribe link in the message body." |
| Yahoo | `senders.yahooinc.com/best-practices/`: spam **<0.3%**, DKIM ≥1024-bit, DMARC `p=none` minimum, "Honor unsubscribes within 2 days." |
| SES one-click unsubscribe | `sending-email-subscription-management.html`: `ListManagementOptions` makes SES insert and **override** `List-Unsubscribe` / `List-Unsubscribe-Post`; requires Easy DKIM; **single recipient only**; `{{amazonSESUnsubscribeUrl}}` placeholder, max 2 occurrences; "For transactional emails where you don't want contacts to be able to unsubscribe, you can omit the ListManagementOptions field." |
| `ses:FromAddress` IAM condition key | `control-user-access.html` — table lists `ses:FromAddress` for `SendEmail`, `SendRawEmail`, `SendBounce`; `ses:FromDisplayName` and `ses:Recipients` for `SendEmail`, `SendRawEmail`. |
| SES Tenants exist as a first-class resource | `docs.aws.amazon.com/ses/latest/dg/tenants.html`: `TenantName` on `SendEmail`, `X-SES-TENANT` SMTP header, tenant name ≤64 chars alnum/`-`/`_`, 10,000 default quota, per-tenant monthly charge, tenant-level suppression, reputation policies Standard/Strict/None. |
| Live DNS of tenurework.com | `nslookup` against 8.8.8.8 and 1.1.1.1, 2026-08-20 — results in §1. |

**The one caveat on domain identities.** `creating-identities.html` also says: "an email address identity that's using the inherited verification from its domain is limited to straightforward email sending. If you want to do more advanced sending, you'll have to also explicitly verify it as an email address identity. Advanced sending includes using the email address with configuration sets, policy authorizations for delegate sending, and configurations that override the domain settings." Read strictly that would sink the whole design, since every send here names a configuration set. I read it as referring to *identity-level* settings — assigning a **default** configuration set to an address identity, sending-authorization policies, MAIL FROM overrides per address — not to passing `ConfigurationSetName` on a `SendEmail` call, which is a request parameter and not an identity attribute. **I could not find a doc sentence that settles this either way, and I did not test it.** Item 1 of the rollout is a live send that proves it. If it turns out SES refuses, the fallback is to verify each of the 17 addresses as an email identity too — 17 extra `aws_sesv2_email_identity` resources, no DNS change, since address identities on a verified domain need no separate records.

---

## 1. Live DNS state — and the Google Workspace collision analysis

Queried 2026-08-20 via `nslookup` against `8.8.8.8` and `1.1.1.1`:

```
tenurework.com          NS    ns1.vercel-dns.com, ns2.vercel-dns.com
tenurework.com          MX    1 smtp.google.com          <- single record, Google Workspace
tenurework.com          TXT   "google-site-verification=b9nNRYUkotE1vkQ0LyHfKxfEiifQ79KJRRBGe1src6Y"
tenurework.com          A     216.198.79.1, 216.198.79.65
_dmarc.tenurework.com         NO RECORD
google._domainkey.tenurework.com   NO RECORD
auth./notify./reply.tenurework.com (TXT, MX)   NO RECORDS
platform.tenurework.com A/AAAA  18.238.80.x + 2600:9000:… (CloudFront)
```

Three consequences, in descending order of importance.

**(a) The SPF collision the design fears does not exist — and the design keeps it that way.** The apex TXT set contains exactly one record and it is a Google site-verification string. There is **no SPF record on tenurework.com at all**. SES's SPF (`v=spf1 include:amazonses.com ~all`) belongs on `bounce.auth.tenurework.com` and `bounce.notify.tenurework.com`, never the apex, so nothing this project publishes can ever collide with a Google SPF record. The collision risk is only realised if somebody later "helpfully" adds `include:amazonses.com` to an apex SPF record — that is wrong and unnecessary, and should be written into the DNS runbook as a prohibition. (RFC 7208 §4.5: two `v=spf1` TXT records on one name is a `permerror`, which fails SPF for *everything*, including human mail.)

**(b) Google Workspace human mail is currently unauthenticated, and that is a pre-existing defect this project must not paper over.** No SPF, no `google._domainkey` DKIM, no DMARC. If somebody publishes `_dmarc.tenurework.com` with `p=quarantine` or `p=reject` before Google Workspace SPF+DKIM are in place, **every human email from @tenurework.com starts landing in spam or being rejected**. That is the single highest-risk action in this whole plan.

Mitigation, and it is a strong one: **publish DMARC only on the sending subdomains, and leave the apex `_dmarc` absent until Google Workspace auth is fixed as a separate piece of work.** DMARC resolution checks `_dmarc.auth.tenurework.com` first and only falls back to the organizational domain when the subdomain record is absent — so `_dmarc.auth.tenurework.com` and `_dmarc.notify.tenurework.com` at `p=reject` are fully independent of the apex and cannot touch human mail. Google's bulk-sender rule is evaluated on the From-header domain, which for application mail is `auth.` / `notify.`, so subdomain DMARC satisfies it.

**(c) Terraform in this repo cannot publish any of these records today.** DNS is at Vercel. `infrastructure/terraform/acm.tf:30` already carries the workaround — "Add these CNAMEs at the registrar to validate the certificate" — and `.github/workflows/custom-domain.yml:140` says "The record that must exist in Vercel DNS for validation to complete." SES adds 9 DKIM CNAMEs + 2 MX + 2 SPF TXT + 1 inbound MX + 3–4 DMARC TXT = **~17 records**, all copy-paste by hand, all silently breaking the build if one is fat-fingered.

**Recommended structural fix (do this before anything else):** create a Route 53 public hosted zone for **each of the three subdomains only** and delegate them from Vercel with three NS record sets:

```
auth.tenurework.com     NS   <4 nameservers from aws_route53_zone.auth>
notify.tenurework.com   NS   <4 nameservers from aws_route53_zone.notify>
reply.tenurework.com    NS   <4 nameservers from aws_route53_zone.reply>
```

`bounce.auth.tenurework.com` and `bounce.notify.tenurework.com` are children of the delegated zones, so they come along free. After those three human-published NS sets, **every remaining SES record is Terraform-managed and the apex is never touched by Terraform at all** — it becomes structurally impossible for a `terraform apply` to break the company's human email. That property is worth the extra zones (US$0.50/zone/month).

The spec below is written for the delegated-zone path and gates it on `var.manage_mail_dns` so the outputs-only path still works if delegation is refused.

**Do-not-touch list, for the DNS runbook:**
- `tenurework.com` MX — Google Workspace. Never modified, never supplemented.
- `tenurework.com` TXT — never add a second `v=spf1` record here.
- `_dmarc.tenurework.com` — out of scope for this project; owned by whoever fixes Google Workspace auth.
- CAA on `tenurework.com` — `variables.tf:146-148` records that it previously permitted only `letsencrypt.org`, `pki.goog`, `sectigo.com` and that `amazon.com` was added for ACM. I could not query CAA directly (Windows `nslookup` returns "unknown query type: CAA"), so this is from the repo comment, not from live DNS. SES/DKIM needs no CAA change; delegating subdomains to Route 53 does not either.

---

## 2. Terraform — exact resources

All in `infrastructure/terraform/`. Provider `hashicorp/aws ~> 5.0`, region `var.aws_region` = `us-east-1` (`variables.tf:13-17`). The 12 `tenure:*` tags come from `provider.default_tags` (`main.tf`) automatically.

### 2.1 Remove from `ses.tf`

| Existing resource | Action | Why |
|---|---|---|
| `aws_ses_email_identity.from` (`hello@tenurework.com`) | **destroy** | The design forbids application mail from the apex. Nothing sends today (grep for `SESClient`/`SendEmailCommand`/`nodemailer`/`EMAIL_FROM` across `apps/web` returns nothing), so this is a zero-traffic destroy. |
| `aws_ses_domain_identity.main` + `aws_ses_domain_dkim.main` (`tenurework.com`) | **destroy** | Keeping a verified apex identity means SES would *accept* a send from `support@tenurework.com`. Destroying it makes the prohibition an AWS-enforced fact rather than a code-review convention. It is currently unverified anyway — no DKIM CNAMEs are published (verified: `abc1._domainkey.tenurework.com` etc. return nothing, and nothing resembling SES DKIM exists on the apex). |
| `aws_ses_configuration_set.main` (`tenure-<env>-mail`) | **destroy** after cutover | Replaced by the five named sets. |
| `output "ses_dkim_tokens"` (`outputs.tf:62-65`) | **replace** | Points at the destroyed apex DKIM resource. |
| `SES_FROM_EMAIL` env var (`ecs.tf:151`) + `var.ses_from_email` (`variables.tf:115-119`) | **remove** | A task-level default From is precisely the "caller picks a wrong From" failure the sender module exists to prevent. |

Keep `aws_sesv2_account_suppression_attributes.suppression` as-is.

### 2.2 New file `infrastructure/terraform/ses-identities.tf`

```hcl
locals {
  mail_domains = {
    auth   = "auth.tenurework.com"
    notify = "notify.tenurework.com"
  }
  mail_from_domains = {
    auth   = "bounce.auth.tenurework.com"
    notify = "bounce.notify.tenurework.com"
  }
  inbound_domain = "reply.tenurework.com"
}
```

| Type | Name | Key arguments |
|---|---|---|
| `aws_sesv2_email_identity` | `sending` (`for_each = local.mail_domains`) | `email_identity = each.value`; `dkim_signing_attributes { next_signing_key_length = "RSA_2048_BIT" }`. **Do not** set `configuration_set_name` — a default config set on the identity would silently apply when the sender module forgets one, which hides the bug the module exists to make impossible. |
| `aws_sesv2_email_identity_mail_from_attributes` | `sending` (`for_each = local.mail_domains`) | `email_identity = aws_sesv2_email_identity.sending[each.key].email_identity`; `mail_from_domain = local.mail_from_domains[each.key]`; `behavior_on_mx_failure = "REJECT_MESSAGE"` |
| `aws_sesv2_email_identity` | `inbound` | `email_identity = local.inbound_domain`. Required — receipt rules only apply to verified identities (`receiving-email-concepts.html`: "for any of your verified identities which includes domains, sub-domains, or email addresses"). **No** `mail_from_attributes` on this one; a receiving subdomain must never be a MAIL FROM domain. |

On `behavior_on_mx_failure`: `USE_DEFAULT_VALUE` and `REJECT_MESSAGE` are the two sesv2 values (v1 spells them `UseDefaultValue` / `RejectMessage`); the provider default is `UseDefaultValue`. **`REJECT_MESSAGE` is the correct choice for this design and it is a deliberately sharp edge.** With `USE_DEFAULT_VALUE`, a broken or deleted `bounce.auth` MX makes SES silently fall back to `amazonses.com` as the envelope-from — SPF still passes, but SPF *alignment* breaks, and if DKIM is also having a bad day the mail fails DMARC at `p=reject` and vanishes. `REJECT_MESSAGE` converts that into a loud `MailFromDomainNotVerified` error at send time. Note the state machine (`mail-from.html`): Pending/TemporaryFailure/Failed all use the fallback setting, and SES gives up permanently after 72 hours — so a `Failed` state requires re-running setup, and must be alarmed on.

### 2.3 New file `infrastructure/terraform/ses-config-sets.tf`

Five sets, names exactly as specified:

| `configuration_set_name` | `delivery_options` | `reputation_options` | `sending_options` | `suppression_options` |
|---|---|---|---|---|
| `tenure-auth-critical` | `tls_policy = "REQUIRE"` | `reputation_metrics_enabled = true` | `sending_enabled = true` | `suppressed_reasons = ["COMPLAINT"]` |
| `tenure-transactional` | `tls_policy = "REQUIRE"` | `true` | `true` | `["BOUNCE", "COMPLAINT"]` |
| `tenure-workflow` | `tls_policy = "REQUIRE"` | `true` | `true` | `["BOUNCE", "COMPLAINT"]` |
| `tenure-digest` | `tls_policy = "REQUIRE"` | `true` | `true` | `["BOUNCE", "COMPLAINT"]` |
| `tenure-billing` | `tls_policy = "REQUIRE"` | `true` | `true` | `["BOUNCE", "COMPLAINT"]` |

Resource type `aws_sesv2_configuration_set`, one resource per set (not `for_each`) so the differing suppression policy on `tenure-auth-critical` is visible in the diff rather than buried in a map.

`tenure-auth-critical` suppressing only `COMPLAINT`: a password-reset or MFA mail must still be *attempted* to an address that soft-bounced last week, because the alternative is a locked-out user with no path back in. Bounce handling for that stream is the application's job (surface it in the admin UI), not the suppression list's. This is a deliberate divergence from the other four and needs a comment in the file saying so.

**Two open items on the names, for the user to rule on:**
1. The names carry no `local.name_prefix`, so a staging apply in the same account+region as production collides on all five. Either accept that the five sets are account-global and one environment owns them, or prefix. I have written the literal names as specified; flag before apply.
2. `tls_policy = "REQUIRE"` means SES refuses to deliver to a receiving server that will not do STARTTLS. That satisfies Google's TLS requirement and is right for student PII, but it *will* drop mail to a minority of badly-run institutional mail servers. Worth stating out loud rather than discovering.

Quota is not a concern: 10,000 configuration sets per region (`general/latest/gr/ses.html`).

### 2.4 New file `infrastructure/terraform/ses-events.tf`

Per config set, two `aws_sesv2_configuration_set_event_destination` resources:

**(a) CloudWatch, for dashboards and alarms** — `event_destination_name = "cw"`:
```hcl
event_destination {
  enabled              = true
  matching_event_types = ["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT","RENDERING_FAILURE","DELIVERY_DELAY"]
  cloud_watch_destination {
    dimension_configuration {
      dimension_name          = "email_type"
      dimension_value_source  = "MESSAGE_TAG"
      default_dimension_value = "unknown"
    }
    dimension_configuration {
      dimension_name          = "tenant_id"
      dimension_value_source  = "MESSAGE_TAG"
      default_dimension_value = "unknown"
    }
    dimension_configuration {
      dimension_name          = "environment"
      dimension_value_source  = "MESSAGE_TAG"
      default_dimension_value = "unknown"
    }
  }
}
```
Only these three as CloudWatch dimensions. `org_id`, `workspace_id`, `user_id`, `template_id` still travel as message tags (they reach the EventBridge stream), but promoting high-cardinality ids to CloudWatch dimensions multiplies custom-metric cost by the cardinality product. `user_id` as a dimension would be one custom metric per user per event type.

**(b) EventBridge, for the `Delivery` table** — `event_destination_name = "bus"`:
```hcl
event_destination {
  enabled              = true
  matching_event_types = ["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT","RENDERING_FAILURE","DELIVERY_DELAY"]
  event_bridge_destination { event_bus_arn = "arn:aws:events:us-east-1:<acct>:event-bus/default" }
}
```
Plus `aws_cloudwatch_event_rule.ses_events` + `aws_cloudwatch_event_target` → the **existing** `aws_sqs_queue.email` (`sqs.tf:27`, `tenure-<env>-email`, already wired into the task as `SQS_EMAIL_URL` at `ecs.tf:146`) + `aws_sqs_queue_policy` allowing `events.amazonaws.com`. A worker drains it and updates `Delivery.deliveredAt` / `Delivery.failureReason` (`apps/web/prisma/schema.prisma:740`) — those columns exist and are currently never written by anything.

`OPEN` and `CLICK` are deliberately excluded from `matching_event_types`. Open/click tracking requires SES to rewrite links through `r.us-east-1.awstrack.me` and embed a tracking pixel. On mail carrying student conflict-of-interest declarations and approval decisions, that is a surveillance surface nobody asked for, and it damages deliverability by putting a third-party domain in the links. If engagement metrics are ever wanted for `tenure-digest` only, add a `tracking_options { custom_redirect_domain = "click.notify.tenurework.com" }` to that one set and nothing else.

Add `aws_cloudwatch_metric_alarm` on the SES `Reputation.BounceRate` (>5%) and `Reputation.ComplaintRate` (>0.1%) — the 0.1% figure is Google's recommended resilience target, and it is well below their 0.30% enforcement line.

### 2.5 New file `infrastructure/terraform/ses-inbound.tf`

| Type | Name | Key arguments |
|---|---|---|
| `aws_s3_bucket` | `inbound_mail` | `${local.name_prefix}-inbound-mail`; versioning on; SSE; lifecycle expiring objects at **30 days** (the parsed reply lives in `Message`; the raw MIME is a debugging artifact, and student mail is not something to keep indefinitely). |
| `aws_s3_bucket_policy` | `inbound_mail` | `Allow` `ses.amazonaws.com` `s3:PutObject` with `StringEquals { "aws:Referer" = <account_id> }` and `ArnLike { "aws:SourceArn" = "arn:aws:ses:us-east-1:<acct>:receipt-rule-set/*" }`. |
| `aws_ses_receipt_rule_set` | `main` | `rule_set_name = "${local.name_prefix}-inbound"` |
| `aws_ses_active_receipt_rule_set` | `main` | **Only one rule set is active per account per region** (`receiving-email-concepts.html`). If any other SES receiving exists in this account, this resource silently takes it over. Verify before apply. |
| `aws_ses_receipt_rule` | `reply` | `rule_set_name`, `recipients = ["reply.tenurework.com"]`, `enabled = true`, `scan_enabled = true`, `tls_policy = "Require"`. Actions: `add_header_action { header_name = "X-Tenure-Inbound", header_value = "reply", position = 1 }`; `s3_action { bucket_name, object_key_prefix = "inbound/", position = 2 }`; `lambda_action { function_arn = aws_lambda_function.inbound_reply.arn, invocation_type = "Event", position = 3 }`. |
| `aws_ses_receipt_rule` | `catchall_stop` | `rule_set_name`, no `recipients`, `stop_action { scope = "RuleSet", position = 1 }` — ordered after `reply`. Without a terminal rule, anything else that ever gets an SES-pointed MX in this account falls through into the `reply` handler. |
| `aws_lambda_function` | `inbound_reply` | Reads the object from S3, parses, validates the token (§4), posts the `Message` row. |
| `aws_lambda_permission` | `ses_invoke` | `principal = "ses.amazonaws.com"`, `source_account = <acct>`. |

`recipients = ["reply.tenurework.com"]` matches the **whole domain**, not the individual `r+<token>@` addresses — which is the only way this can work, since the token is per-message and unbounded in count. Matching is on the SMTP envelope `RCPT TO`, so BCC'd replies still match. Size ceilings from `receiving-email-concepts.html`: **40 MB** via S3, 150 KB via SNS — hence S3 + Lambda, never the SNS action.

### 2.6 New file `infrastructure/terraform/ses-dns.tf` (gated on `var.manage_mail_dns`)

```hcl
variable "manage_mail_dns" {
  description = "True once auth./notify./reply.tenurework.com are delegated from Vercel DNS to the Route 53 zones in this stack. Until then Terraform emits records as outputs for a human to publish."
  type        = bool
  default     = false
}
```

| Type | Name | Notes |
|---|---|---|
| `aws_route53_zone` | `mail` (`for_each` over `auth`, `notify`, `reply`) | `count`/`for_each` gated on `var.manage_mail_dns`. |
| `aws_route53_record` | `dkim` | `for_each` over the flattened product of the three identities × their 3 DKIM tokens; `type = "CNAME"`, `ttl = 600`. Tokens come from `aws_sesv2_email_identity.sending[k].dkim_signing_attributes[0].tokens` (a set of 3). |
| `aws_route53_record` | `mail_from_mx` | `for_each` over `local.mail_from_domains`; `type = "MX"`, `ttl = 600`, `records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]`. **Exactly one record in the list.** |
| `aws_route53_record` | `mail_from_spf` | same names, `type = "TXT"`, `records = ["v=spf1 include:amazonses.com ~all"]` |
| `aws_route53_record` | `inbound_mx` | name `reply.tenurework.com`, `type = "MX"`, `records = ["10 inbound-smtp.${var.aws_region}.amazonaws.com"]` |
| `aws_route53_record` | `dmarc` | four records, §3 |

Always-on outputs (the non-delegated path):
```hcl
output "ses_mail_dns_records" {
  description = "Publish these in Vercel DNS. Every one is required; a missing MX on a MAIL FROM domain fails sends outright because behavior_on_mx_failure = REJECT_MESSAGE."
  value = { ... name/type/value/ttl for all ~17 records ... }
}
```

### 2.7 IAM — `ses-iam.tf`

Attach to `aws_iam_role.ecs_task` (`ecs.tf:46`, `tenure-<env>-ecs-task`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendOnlyFromSendingSubdomains",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": [
        "arn:aws:ses:us-east-1:<acct>:identity/auth.tenurework.com",
        "arn:aws:ses:us-east-1:<acct>:identity/notify.tenurework.com",
        "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-auth-critical",
        "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-transactional",
        "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-workflow",
        "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-digest",
        "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-billing"
      ],
      "Condition": {
        "ForAllValues:StringLike": {
          "ses:FromAddress": ["*@auth.tenurework.com", "*@notify.tenurework.com"]
        }
      }
    }
  ]
}
```

This is the **second** wall behind the sender module: even a compromised or buggy call site cannot emit `support@tenurework.com`, because IAM refuses it. `ses:FromAddress` on `SendEmail`/`SendRawEmail` is documented in `control-user-access.html` (table under "Restricting Email Addresses") with a worked example under "Restricting the 'From' Address". `StringLike` is documented as **case sensitive**, so the sender module must lower-case domains before sending.

Two things I did **not** confirm: whether `ses:FromAddress` is evaluated identically for the SES **v2** `SendEmail` shape (the doc's table is written against the v1 API names), and whether the wildcard form behaves as expected against a display-name-wrapped From (`"Simon Business School via Tenure" <notifications@notify.tenurework.com>`). Both are cheap to prove empirically — send one message with a deliberately wrong From and confirm `AccessDenied` — and rollout step 4 does exactly that. If the condition turns out not to bite on v2, fall back to `ses:SendRawEmail` + MIME construction, or accept the `Resource` restriction alone (which still blocks the apex identity, since it will no longer exist).

### 2.8 SES Tenants — recommended, and not in the user's design

`docs.aws.amazon.com/ses/latest/dg/tenants.html` describes a first-class tenant resource: `TenantName` on `SendEmail`, `X-SES-TENANT` for SMTP, per-tenant reputation findings, per-tenant suppression lists (`SuppressionScope = TENANT`), and — the important part — **AWS Trust & Safety can pause one tenant instead of the whole account**. For a platform where one institution's bad list hygiene would otherwise take down every institution's password resets, that is a materially different failure mode from a `tenant_id` message tag, which is only an analytics label.

This adds cost (per-tenant monthly charge), an onboarding step per institution (`CreateTenant` + two `CreateTenantResourceAssociation` calls, for the identity and the config set), and a real constraint: "When sending on behalf of a tenant, you must specify a configuration set that is associated with that tenant." Tenant names are ≤64 chars, `[A-Za-z0-9_-]` — cuid `institutionId` values qualify directly.

I am flagging it rather than speccing it because it is a design change the user did not ask for, and because the Terraform provider may not have `aws_sesv2_tenant` yet — **I did not verify whether a Terraform resource exists**, and if it does not, tenant creation belongs in the application's institution-onboarding path via the SDK, not in Terraform.

---

## 3. Every DNS record

`{t1}`, `{t2}`, `{t3}` are the three Easy DKIM tokens per identity, from `aws_sesv2_email_identity.<x>.dkim_signing_attributes[0].tokens`. They are generated by SES at create time and are **not** predictable — the identity must exist before the records can be written, which is why the outputs-only path needs two applies.

### New records — SES

| # | Name | Type | Value | TTL |
|---|---|---|---|---|
| 1–3 | `{t1}._domainkey.auth.tenurework.com`, `{t2}…`, `{t3}…` | CNAME | `{tN}.dkim.amazonses.com` | 600 |
| 4–6 | `{t1}._domainkey.notify.tenurework.com`, `{t2}…`, `{t3}…` | CNAME | `{tN}.dkim.amazonses.com` | 600 |
| 7–9 | `{t1}._domainkey.reply.tenurework.com`, `{t2}…`, `{t3}…` | CNAME | `{tN}.dkim.amazonses.com` | 600 |
| 10 | `bounce.auth.tenurework.com` | MX | `10 feedback-smtp.us-east-1.amazonses.com` | 600 |
| 11 | `bounce.auth.tenurework.com` | TXT | `"v=spf1 include:amazonses.com ~all"` | 600 |
| 12 | `bounce.notify.tenurework.com` | MX | `10 feedback-smtp.us-east-1.amazonses.com` | 600 |
| 13 | `bounce.notify.tenurework.com` | TXT | `"v=spf1 include:amazonses.com ~all"` | 600 |
| 14 | `reply.tenurework.com` | MX | `10 inbound-smtp.us-east-1.amazonaws.com` | 600 |
| 15 | `_dmarc.auth.tenurework.com` | TXT | `"v=DMARC1; p=none; rua=mailto:dmarc@tenurework.com; adkim=r; aspf=r; pct=100"` → later `p=reject` | 3600 |
| 16 | `_dmarc.notify.tenurework.com` | TXT | same, then `p=reject` | 3600 |
| 17 | `_dmarc.reply.tenurework.com` | TXT | `"v=DMARC1; p=reject; rua=mailto:dmarc@tenurework.com"` from day one | 3600 |
| 18 | `_dmarc.bounce.auth.tenurework.com`, `_dmarc.bounce.notify.tenurework.com` | TXT | `"v=DMARC1; p=reject; rua=mailto:dmarc@tenurework.com"` | 3600 |

`dkim.amazonses.com` (not a region-qualified variant) because `general/latest/gr/ses.html` "DKIM domains" puts `us-east-1` under "All other regions". If the region ever changes, this value changes with it. The doc also notes the value can be read programmatically from `DkimAttributes.SigningHostedZone` on `CreateEmailIdentity`/`GetEmailIdentity` — prefer that over hardcoding if the provider surfaces it.

Record-name pitfall from `creating-identities.html`, verbatim: "Do not add any additional underscores (`_`) at the beginning of the CNAME record names… *Correct:* `abc123._domainkey.domain.com` *Incorrect:* `_abc123._domainkey.domain.com`". Vercel's DNS UI appends the zone automatically — enter the **relative** name there, not the FQDN, or you get `{t1}._domainkey.auth.tenurework.com.tenurework.com`.

On records 15/16 starting at `p=none`: `adkim=r` and `aspf=r` are explicit rather than relied upon as defaults, because `send-email-authentication-dmarc.html` is unambiguous that `aspf=s` kills SPF alignment with SES, and being explicit means nobody later "tightens" it without reading. Move to `p=reject` only after the `rua` aggregate reports show 100% of `auth.`/`notify.` volume passing — typically 2–4 weeks. `p=reject` on `reply.` and `bounce.*` from day one is safe: nothing legitimately puts those domains in a From header, so a reject policy costs nothing and blocks spoofing immediately.

`dmarc@tenurework.com` must exist as a Google Group before these records go live, or the aggregate reports bounce into nothing. That is a Workspace admin action, not a Terraform one.

### Records that must NOT change

| Name | Type | Current value | Owner |
|---|---|---|---|
| `tenurework.com` | MX | `1 smtp.google.com` | Google Workspace — human mail |
| `tenurework.com` | TXT | `google-site-verification=b9nNRYUkotE1vkQ0LyHfKxfEiifQ79KJRRBGe1src6Y` | Google Workspace |
| `tenurework.com` | A | `216.198.79.1`, `216.198.79.65` | Vercel — marketing site |
| `platform.tenurework.com` | A/AAAA | CloudFront | this stack |

### Separate work item (NOT this project, but sequenced before apex DMARC)

| Name | Type | Value |
|---|---|---|
| `tenurework.com` | TXT | `"v=spf1 include:_spf.google.com ~all"` — one record, only |
| `google._domainkey.tenurework.com` | TXT | Google-generated DKIM key, from Workspace Admin → Apps → Google Workspace → Gmail → Authenticate email |
| `_dmarc.tenurework.com` | TXT | `"v=DMARC1; p=none; rua=mailto:dmarc@tenurework.com"` — **only after the two above are live and reports are clean** |

---

## 4. The application sender module

Nothing exists today. New directory `apps/web/src/lib/mail/`.

### 4.1 `streams.ts` — the registry, and the only place a From address is written

```ts
export const EMAIL_TYPES = [
  "account.created", "account.password_reset", "account.mfa_enrolled",
  "invite.sent", "invite.reminder",
  "verification.email", "verification.identity",
  "security.new_device", "security.role_escalation",
  "access.granted", "access.revoked", "access.expiring",
  "notification.generic", "approval.requested", "approval.decided",
  "task.assigned", "task.due", "mention.created", "message.received",
  "calendar.invite", "calendar.changed", "document.shared",
  "integration.connected", "integration.failed", "admin.report",
  "billing.invoice", "billing.payment_failed",
  "digest.daily", "digest.weekly", "system.maintenance",
] as const
export type EmailType = (typeof EMAIL_TYPES)[number]

interface Stream {
  readonly from: string           // full address, lower-case
  readonly configurationSet: ConfigSet
  readonly replyTo: ReplyTo       // "group:<addr>" | "thread" | "none"
  readonly unsubscribe: boolean   // one-click headers. Never true on auth.*
}

export const STREAMS: Readonly<Record<EmailType, Stream>> = Object.freeze({ ... })
```

`STREAMS` is exhaustive over `EmailType` by construction — `Record<EmailType, Stream>` means adding a member to `EMAIL_TYPES` without a stream entry is a compile error, which is the mechanism that keeps this file from drifting. The seventeen addresses map as follows:

| From | Streams (email_type prefix) | Config set | Reply-To | One-click unsub |
|---|---|---|---|---|
| `account@auth.tenurework.com` | `account.*` | `tenure-auth-critical` | none | **no** |
| `invites@auth.tenurework.com` | `invite.*` | `tenure-auth-critical` | `thread` | **no** |
| `verification@auth.tenurework.com` | `verification.*` | `tenure-auth-critical` | none | **no** |
| `security@auth.tenurework.com` | `security.*` | `tenure-auth-critical` | `group:security@tenurework.com` | **no** |
| `access@auth.tenurework.com` | `access.*` | `tenure-auth-critical` | `group:support@tenurework.com` | **no** |
| `notifications@notify.tenurework.com` | `notification.*` | `tenure-transactional` | `thread` | no |
| `approvals@notify.tenurework.com` | `approval.*` | `tenure-workflow` | `thread` | no |
| `tasks@notify.tenurework.com` | `task.*` | `tenure-workflow` | `thread` | no |
| `mentions@notify.tenurework.com` | `mention.*` | `tenure-transactional` | `thread` | no |
| `messages@notify.tenurework.com` | `message.*` | `tenure-transactional` | `thread` | no |
| `calendar@notify.tenurework.com` | `calendar.*` | `tenure-transactional` | `thread` | no |
| `documents@notify.tenurework.com` | `document.*` | `tenure-transactional` | `thread` | no |
| `integrations@notify.tenurework.com` | `integration.*` | `tenure-transactional` | `group:support@tenurework.com` | no |
| `admin@notify.tenurework.com` | `admin.*` | `tenure-transactional` | `group:support@tenurework.com` | no |
| `billing@notify.tenurework.com` | `billing.*` | `tenure-billing` | `group:billing@tenurework.com` | no |
| `digest@notify.tenurework.com` | `digest.*` | `tenure-digest` | none | **yes** |
| `system@notify.tenurework.com` | `system.*` | `tenure-transactional` | none | no |

`unsubscribe: true` on `digest.*` **only**. Google's rule covers "marketing messages and subscribed messages"; a daily digest is a subscribed message and needs it. Putting `List-Unsubscribe` on `account.password_reset` would let a recipient opt out of the mail that recovers their account — and Gmail renders the header as a prominent "Unsubscribe" button, so people will click it. The type system should make this unrepresentable: a `Stream` on a `tenure-auth-critical` config set with `unsubscribe: true` should fail a unit test that iterates `STREAMS`.

### 4.2 `send.ts` — the single exported entry point

```ts
export async function sendMail(input: {
  emailType: EmailType
  to: string
  scope: { institutionId: string; organizationId?: string; workspaceId?: string; userId: string }
  templateId: string
  displayName: string          // "Simon Business School via Tenure"
  subject: string
  html: string
  text: string
  thread?: ReplyContext        // conversationId + recipientParticipantId + messageId
}): Promise<{ messageId: string }>
```

There is no `from` parameter, no `configurationSet` parameter, no `replyTo` parameter. They are *derived* from `emailType`. A caller cannot pick a wrong From because a caller cannot pick a From.

The module resolves:
- `FromEmailAddress` = `"${displayName}" <${STREAMS[t].from}>` — RFC 5322 quoted display name, with `"` and `\` escaped. Display name is the **only** per-tenant variable; the address never varies by tenant. Reject a `displayName` containing CR or LF outright (header injection).
- `ConfigurationSetName` = `STREAMS[t].configurationSet`
- `ReplyToAddresses` = `["r+<token>@reply.tenurework.com"]` when `replyTo === "thread"` and `input.thread` is present; `[groupAddress]` when `"group:…"`; omitted otherwise. `replyTo === "thread"` with no `thread` is a thrown error, not a silent fallback.
- `EmailTags` = §4.3
- `ListManagementOptions` when `STREAMS[t].unsubscribe` — see the caveat below.

Enforcement that the module is the only door: an ESLint `no-restricted-imports` rule banning `@aws-sdk/client-sesv2` and `@aws-sdk/client-ses` everywhere under `apps/web/src` **except** `src/lib/mail/**`, plus a monorepo test in `tests/` (this repo already keeps repo-property tests there, and `npm run test:platform` runs them in CI) asserting the same by grep. Two mechanisms because the ESLint rule is one `// eslint-disable` from being bypassed and the platform test is the thing that reds CI.

**Caveat on one-click unsubscribe.** SES's built-in `ListManagementOptions` requires a SES **contact list**, works on **single-recipient sends only**, and — per `sending-email-subscription-management.html` — SES **overrides** any `List-Unsubscribe` / `List-Unsubscribe-Post` you set yourself. Adopting it means SES, not the Tenure database, becomes the system of record for digest subscription state, which conflicts with the existing `NotificationPreference` model (`schema.prisma:1332`). The alternative is to set the two headers yourself via `SendRawEmail`/raw content pointing at a Tenure endpoint (`https://platform.tenurework.com/api/unsubscribe/<token>`), keeping preference state in Postgres where the rest of it lives. **I recommend the self-managed path** for that reason, with the same signed-token machinery as §5 and a `POST` handler per RFC 8058. Yahoo requires honouring within **2 days**; Tenure can honour synchronously. I could not find a matching 2-day statement on Google's page — Yahoo states it, Google does not, so treat 2 days as the binding number.

### 4.3 `tags.ts` — the seven tags

Every send carries all seven. `event-publishing-send-email.html` restricts tag names *and values* to `0-9 A-Z a-z - _`.

| Tag name | Source | Notes |
|---|---|---|
| `tenant_id` | `scope.institutionId` | cuid — `[a-z0-9]`, safe as-is |
| `org_id` | `scope.organizationId` | `"none"` when absent — never omit the tag, or the CloudWatch dimension silently takes `default_dimension_value` |
| `workspace_id` | `scope.workspaceId` | **No `Workspace` model exists in `schema.prisma` today.** Emit `"none"` until one does, rather than inventing a mapping |
| `user_id` | `scope.userId` | cuid |
| `email_type` | the key | Contains `.` — **`.` is NOT in the allowed set.** Must be transformed: `account.password_reset` → `account_password_reset` |
| `template_id` | `input.templateId` | sanitize |
| `environment` | `process.env.TENURE_ENV` | `production` / `staging` |

`sanitizeTagValue()` replaces every disallowed character with `_` and truncates. **I did not verify the maximum tag name/value length** — the `MessageTag` API reference would settle it; assume 256 and truncate at 200 until confirmed. A value that sanitizes to empty becomes `"none"`. There is a real failure mode here worth a test: a tag with an illegal character does not fail the send — `event-publishing-send-email.html` says "the email sending call will still succeed, but the event metrics will not be emitted to CloudWatch". So a bad tag produces silently missing metrics, which is exactly the kind of bug nobody notices for a quarter.

Also emit these as `X-SES-MESSAGE-TAGS` only if you move to raw sends; on the v2 `SendEmail` API they go in `EmailTags` and the header is unnecessary. Note the doc's warning: if you specify tags in both headers and API parameters, SES uses **only** the API parameters and does not merge.

---

## 5. The opaque reply token

Address form: `r+<token>@reply.tenurework.com`.

### 5.1 Why raw ids are refused

Four independent reasons, all concrete:

1. **The address is a bearer capability.** It appears in a `Reply-To`, so it lands in the recipient's mail client, their sent folder, their mail provider's logs, and — when they forward the thread to a colleague — in that person's mailbox too. If it reads `conv-clx7f2k9p0001@reply.tenurework.com`, anybody holding it can post into that conversation. Worse, they can *guess neighbours*: cuids are not sequential but they are enumerable in the sense that one leaked id tells you the id format and the domain's shape.
2. **Cross-tenant leakage.** A raw conversation id says nothing about which institution it belongs to, so the inbound handler has to look it up and trust the lookup. This repo's own `ConnectionLaunchToken` comment (`schema.prisma:1654`) makes exactly this argument: "a token readable across tenants would let one institution enumerate what another's members are trying to connect — and, worse, redeeming across tenants would restore one tenant's intent inside another's scope."
3. **Attribution.** A reply must be posted *as a specific participant*. If the address only names the conversation, the handler has to attribute by the `From` header — which is trivially forged, and which fails legitimately when someone replies from their phone's alias.
4. **Revocation.** A raw id is valid forever. A signed token can carry an epoch and expire.

### 5.2 What is signed

Follow the house pattern in `apps/web/src/lib/calendar-sync.ts` — version prefix, dot-separated base64url fields, HMAC-SHA256, `timingSafeEqual`, a single `null` on every refusal.

```
body  = "r1" . b64(institutionId) . b64(conversationId) . b64(participantId)
             . b64(messageId) . issuedAtEpochSeconds . replyEpoch
token = base64url( HMAC-SHA256(bodyBytes, key) truncated to 16 bytes )
        prefixed by a short random selector
```

**But there is a hard constraint the calendar pattern does not face: RFC 5321 §4.5.3.1.1 caps the local part at 64 octets.** With `r+` consuming 2, the token has 62 characters. Five base64url'd cuids (25 chars each) plus a 27-char MAC is ~180 characters — four times over budget. (I am citing the 64-octet limit from RFC 5321 from memory; I did not fetch the RFC in this session. It is worth confirming before implementation, but the design below is correct either way and simply stops caring about the limit.)

So the token **cannot be self-describing**. It must be a **database handle**, following the existing `ConnectionLaunchToken` shape rather than the calendar shape:

New Prisma model:
```prisma
model ReplyToken {
  id             String   @id @default(cuid())
  institutionId  String
  conversationId String
  participantId  String
  messageId      String
  /// sha256(token) hex, unique — a collision is a constraint violation, not
  /// two people sharing a mailbox.
  tokenHash      String   @unique
  epoch          Int      @default(0)
  expiresAt      DateTime
  revokedAt      DateTime?
  usedCount      Int      @default(0)
  createdAt      DateTime @default(now())
  @@index([institutionId, conversationId])
  @@index([expiresAt])
}
```

- The token itself is **32 bytes of `crypto.randomBytes`, base64url** = 43 characters. `r+` + 43 = 45 octets, comfortably inside 64.
- Nothing is derivable from it. It is an unguessable handle, not an encoding — 256 bits of entropy, so enumeration is not a threat model.
- Only `sha256(token)` is stored, so a database dump does not yield working reply addresses. Compare against the stored hash with `crypto.timingSafeEqual`.
- Every field the handler needs — tenant, conversation, participant, message — comes from the row, which means the tenant scope is *read from the record*, not parsed from attacker-controlled input.

### 5.3 Verification, in order

The Lambda in §2.5, for each inbound message:
1. Reject if the S3 object exceeds 40 MB (SES's own ceiling) or the `X-SES-Virus-Verdict` header is `FAIL`. `receiving-email-concepts.html` documents `X-SES-Spam-Verdict` / `X-SES-Virus-Verdict` / `Authentication-Results` as headers SES adds to the S3 copy. SES takes no action on these itself — acting on them is the handler's job.
2. Extract the envelope recipient from the SES event's `recipients` field — **not** from `To:`/`Cc:`, per the doc's explicit warning about BCC.
3. Parse `^r\+([A-Za-z0-9_-]{43})@reply\.tenurework\.com$`, case-insensitively on the domain only. Anything else → drop, log, no bounce (bouncing tells a prober which addresses are real).
4. `sha256` the token, look up `ReplyToken` by `tokenHash`. Constant-time compare. Miss → drop.
5. Refuse if `revokedAt != null`, `expiresAt < now`, or `epoch != conversation.replyEpoch`.
6. Enter the tenant scope using `row.institutionId` and nothing else.
7. Strip quoted history, create the `Message` with `senderId` = the participant's `userId`, `replyToId` = `row.messageId`.
8. `usedCount++`. Do **not** invalidate on first use — people reply twice to the same notification, and a single-use reply address produces mail that vanishes with no error the user can see. Rate-limit instead: >20 uses in 24h → revoke and alert.

Every refusal returns the same nothing. As `calendar-sync.ts` puts it: "a caller that could tell 'expired' from 'forged' from 'revoked' would be an oracle for anybody probing the endpoint."

### 5.4 Rotation

Three independent mechanisms:
- **Per-token TTL** — `expiresAt = createdAt + 90 days`. A reply address in a year-old email is dead.
- **Per-conversation epoch** — add `replyEpoch Int @default(0)` to `Conversation`. Archiving a conversation, or removing a participant, increments it and every outstanding token for it stops verifying in one write. This is exactly the `User.calendarTokenEpoch` mechanism already in the codebase.
- **Global key rotation** — not applicable to random handles (there is no key), which is a real advantage of the handle design over the HMAC design. If a future version does sign, put the key in `aws_secretsmanager_secret.app` (`secrets.tf:2`, `${local.name_prefix}/app`) alongside `AUTH_SECRET`, and carry a `kid` in the token so old and new keys verify concurrently during a rotation window.

A daily job deletes `ReplyToken` rows where `expiresAt < now() - 30 days`.

---

## 6. Ordered rollout, with gates

Steps marked **[GATE]** need a human decision or a human action outside this repository.

**Phase 0 — decisions (nothing shipped)**
1. **[GATE]** Ratify: delegate `auth.` / `notify.` / `reply.` to Route 53, or stay on Vercel with manual publication? Delegation is the recommendation and everything downstream is easier for it.
2. **[GATE]** Ratify the five configuration-set names as account-global (no environment prefix), or prefix them.
3. **[GATE]** Ratify `tls_policy = "REQUIRE"` knowing it drops mail to non-TLS receivers.
4. **[GATE]** Decide on SES Tenants (§2.8) now, before onboarding code is written — retrofitting `TenantName` across every send later is worse.
5. **[GATE]** Create the Google Groups `dmarc@`, `security@`, `billing@`, `support@` on tenurework.com. Workspace admin action.

**Phase 1 — identities and DNS (no sending)**
6. Apply `ses-identities.tf`. Creates three identities in `us-east-1`; all `Unverified`.
7. **[GATE]** Publish records 1–14 (§3). Either the three NS delegations at Vercel then a second `terraform apply`, or 14 records by hand from `output.ses_mail_dns_records`.
8. Wait for verification. DKIM: up to 72 hours. Custom MAIL FROM: up to 72 hours, and SES **gives up permanently** after that, requiring the whole setup to be re-run. Confirm with `aws sesv2 get-email-identity --email-identity auth.tenurework.com` — `VerifiedForSendingStatus: true` and `MailFromAttributes.MailFromDomainStatus: SUCCESS`. Do not proceed on a `PENDING`.
9. Publish records 15–18 (DMARC) at **`p=none`** on `auth.`/`notify.`, `p=reject` on `reply.`/`bounce.*`.

**Phase 2 — config sets and events**
10. Apply `ses-config-sets.tf` + `ses-events.tf` + `ses-iam.tf`.
11. Verify the EventBridge → SQS path with a send to the SES mailbox simulator (`success@simulator.amazonses.com`, `bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`) — these work in the sandbox and are the only safe way to exercise bounce/complaint handling without hurting reputation.

**Phase 3 — sender module**
12. Ship `apps/web/src/lib/mail/`, the ESLint restriction, and the platform test. No call sites yet.
13. **Prove the domain-identity assumption (§0 caveat).** In the sandbox, send from `account@auth.tenurework.com` with `ConfigurationSetName: tenure-auth-critical` to a verified address. If SES accepts it, the design holds. If it errors, add the 17 address identities. **This is the single most load-bearing unverified assumption in the plan and it is cheap to settle — do it before writing call sites.**
14. **Prove the IAM condition bites.** Attempt a send with `From: support@tenurework.com` under the task role and confirm `AccessDenied`, not a delivered message.
15. Inspect a received message's raw source: `Authentication-Results` shows `spf=pass` with `envelope-from` on `bounce.auth.tenurework.com`, `dkim=pass header.i=auth.tenurework.com`, `dmarc=pass`. If SPF passes but DMARC does not align, the `aspf` tag is wrong.

**Phase 4 — sandbox exit**
16. **[GATE]** Submit production access (`aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL --website-url https://tenurework.com --additional-contact-email-addresses … --contact-language EN`). Choose **TRANSACTIONAL** — it describes the majority of this volume, and the console's own definition ("Sent on a one-to-one basis unique to each recipient usually triggered by a user action") fits every stream except `digest.*`. Initial AWS response within 24 hours. Sandbox limits until then: 200 msgs/24h, 1/sec, verified recipients only.
17. **[GATE]** Request a sending-quota and rate increase in the same or a follow-up case. Defaults are 200/24h and 1/sec, which will not carry a single institution's morning digest.

**Phase 5 — warm-up**
This account has **no sending history**. SES shared IPs carry some inherited reputation, but a domain that has never sent and suddenly emits thousands of messages to Gmail gets throttled or foldered regardless of the IP.

18. Ramp on `tenure-auth-critical` only — the highest-engagement, lowest-complaint stream — to internal @tenurework.com recipients: day 1–2 ≈50/day, day 3–4 ≈200, day 5–7 ≈1,000, week 2 ≈5,000, doubling weekly while bounce <5% and complaint <0.1%. **These specific numbers are my recommendation from general deliverability practice, not from an AWS document — I did not find an AWS page prescribing a shared-IP ramp schedule.** AWS documents automatic warm-up only for *dedicated* IPs. Treat the shape (start small, double, gate on metrics) as sound and the exact figures as tunable.
19. Add `tenure-transactional` and `tenure-workflow` in week 2–3, `tenure-billing` week 3, `tenure-digest` **last** — bulk mail is what triggers complaints, and it should not ride on an unproven reputation.
20. **[GATE]** Register `auth.tenurework.com` and `notify.tenurework.com` in Google Postmaster Tools (a DNS TXT verification per domain) before digest volume starts. Google's 0.30% threshold is measured there; without Postmaster you cannot see the number you are being judged on.
21. **[GATE]** Move `_dmarc.auth` / `_dmarc.notify` from `p=none` → `p=quarantine` → `p=reject` on the evidence of `rua` reports. AWS's own guidance in `send-email-authentication-dmarc.html` is explicit that this must be phased and that "using the wrong one at the wrong time can cause your email to not be delivered."

**Phase 6 — inbound**
22. Apply `ses-inbound.tf`. **[GATE]** Confirm no other active receipt rule set exists in this account+region before `aws_ses_active_receipt_rule_set` takes over.
23. Publish record 14 if not already. Test with a real reply from an external Gmail account.
24. Turn on `Reply-To: thread` streams only after the inbound path is proven end-to-end. A `Reply-To` that goes nowhere is worse than none.

**Phase 7 — apex hygiene (separate work item)**
25. **[GATE]** Google Workspace SPF + DKIM, then apex DMARC at `p=none`. Not this project, but it is what makes human mail from @tenurework.com trustworthy, and it should not be left undone.

---

## 7. What cannot be done from here

| Blocked on | Items |
|---|---|
| **DNS write access (Vercel DNS, or the Vercel account that owns the zone)** | Every record in §3. All 14 SES verification records, all 4 DMARC records, and the 3 NS delegations if that path is chosen. Nothing in phases 1, 6 or 7 can start without this, and the SES identities sit `Unverified` — accepting sends and dropping them — until it happens. |
| **AWS credentials for the account holding this stack** | `terraform apply` of every file in §2. Also `get-email-identity` verification polling, the mailbox-simulator tests, and reading `Authentication-Results` on a real message. |
| **AWS account-level human action (console/support case)** | Sandbox exit (step 16), sending quota + rate increase (step 17). AWS reviews these; they are not Terraform-expressible. |
| **Google Workspace super-admin** | The `dmarc@` / `security@` / `billing@` / `support@` Groups; Google Workspace DKIM key generation; the apex SPF record. |
| **Google Postmaster Tools** | Domain registration + the per-domain TXT verification. Without it the 0.30% spam-rate number is invisible. |
| **Production deploy** | `deploy.yml:26,36` carries `if: github.repository == 'Tenurework/Tenure'`, so applying any of this from *this* repository is disarmed by design (`CLAUDE.md` rule 2). Landing it here does not deploy it; a human merges the corresponding change in `Tenurework/Tenure`. |
| **Nothing — can be built now, unblocked** | The whole of §4 (sender module, streams registry, tag sanitizer), §5 (`ReplyToken` model + migration, mint/verify, the Lambda handler's parsing and validation logic), the ESLint restriction, the platform test, and unit tests for all of it. All of this is pure application code with no AWS dependency and can be written, tested and merged while the DNS and credential gates are pending. |

## Concrete values
# Exact values somebody will type

## Region
`us-east-1` — `infrastructure/terraform/variables.tf:13-17`, `var.aws_region` default. Confirmed to support SES **inbound** (`inbound-smtp.us-east-1.amazonaws.com`).

## Endpoint hostnames (us-east-1)
```
feedback-smtp.us-east-1.amazonses.com     MAIL FROM MX target
inbound-smtp.us-east-1.amazonaws.com      inbound MX target
dkim.amazonses.com                        DKIM CNAME suffix (us-east-1 = "all other regions")
email.us-east-1.amazonaws.com             API endpoint
r.us-east-1.awstrack.me                   open/click tracking (NOT used)
```

## DNS records to publish

```
# --- DKIM, 3 per identity, 9 total. {tN} from terraform output. ---
{t1}._domainkey.auth.tenurework.com        CNAME  {t1}.dkim.amazonses.com     600
{t2}._domainkey.auth.tenurework.com        CNAME  {t2}.dkim.amazonses.com     600
{t3}._domainkey.auth.tenurework.com        CNAME  {t3}.dkim.amazonses.com     600
{t1}._domainkey.notify.tenurework.com      CNAME  {t1}.dkim.amazonses.com     600
{t2}._domainkey.notify.tenurework.com      CNAME  {t2}.dkim.amazonses.com     600
{t3}._domainkey.notify.tenurework.com      CNAME  {t3}.dkim.amazonses.com     600
{t1}._domainkey.reply.tenurework.com       CNAME  {t1}.dkim.amazonses.com     600
{t2}._domainkey.reply.tenurework.com       CNAME  {t2}.dkim.amazonses.com     600
{t3}._domainkey.reply.tenurework.com       CNAME  {t3}.dkim.amazonses.com     600

# --- Custom MAIL FROM. EXACTLY ONE MX each, or SES setup fails. ---
bounce.auth.tenurework.com                 MX     10 feedback-smtp.us-east-1.amazonses.com   600
bounce.auth.tenurework.com                 TXT    "v=spf1 include:amazonses.com ~all"        600
bounce.notify.tenurework.com               MX     10 feedback-smtp.us-east-1.amazonses.com   600
bounce.notify.tenurework.com               TXT    "v=spf1 include:amazonses.com ~all"        600

# --- Inbound ---
reply.tenurework.com                       MX     10 inbound-smtp.us-east-1.amazonaws.com    600

# --- DMARC. Start p=none on sending domains, p=reject on non-From domains. ---
_dmarc.auth.tenurework.com                 TXT    "v=DMARC1; p=none; rua=mailto:dmarc@tenurework.com; adkim=r; aspf=r; pct=100"   3600
_dmarc.notify.tenurework.com               TXT    "v=DMARC1; p=none; rua=mailto:dmarc@tenurework.com; adkim=r; aspf=r; pct=100"   3600
_dmarc.reply.tenurework.com                TXT    "v=DMARC1; p=reject; rua=mailto:dmarc@tenurework.com"                            3600
_dmarc.bounce.auth.tenurework.com          TXT    "v=DMARC1; p=reject; rua=mailto:dmarc@tenurework.com"                            3600
_dmarc.bounce.notify.tenurework.com        TXT    "v=DMARC1; p=reject; rua=mailto:dmarc@tenurework.com"                            3600
```

## LIVE DNS as of 2026-08-20 (nslookup vs 8.8.8.8 and 1.1.1.1) — DO NOT MODIFY
```
tenurework.com                    NS   ns1.vercel-dns.com, ns2.vercel-dns.com
tenurework.com                    MX   1 smtp.google.com
tenurework.com                    TXT  "google-site-verification=b9nNRYUkotE1vkQ0LyHfKxfEiifQ79KJRRBGe1src6Y"
tenurework.com                    A    216.198.79.1, 216.198.79.65
_dmarc.tenurework.com                  <NO RECORD>
google._domainkey.tenurework.com       <NO RECORD>
auth/notify/reply.tenurework.com       <NO RECORDS>
platform.tenurework.com           A    18.238.80.94/.95/.121/.124 (+AAAA 2600:9000:266a:…)  CloudFront
```
No SPF exists at the apex. No DMARC exists anywhere on the domain.

## Optional Route 53 delegation (recommended) — 3 records at Vercel
```
auth.tenurework.com     NS  <4 NS from aws_route53_zone.mail["auth"].name_servers>
notify.tenurework.com   NS  <4 NS from aws_route53_zone.mail["notify"].name_servers>
reply.tenurework.com    NS  <4 NS from aws_route53_zone.mail["reply"].name_servers>
```

## Terraform resources

REMOVE from `infrastructure/terraform/ses.tf` / `outputs.tf` / `ecs.tf` / `variables.tf`:
```
aws_ses_domain_identity.main             (tenurework.com)
aws_ses_domain_dkim.main
aws_ses_email_identity.from              (hello@tenurework.com)
aws_ses_configuration_set.main           (tenure-<env>-mail)   -- after cutover
output.ses_dkim_tokens                   (outputs.tf:62-65)
env var SES_FROM_EMAIL                   (ecs.tf:151)
variable.ses_from_email                  (variables.tf:115-119)
```
KEEP: `aws_sesv2_account_suppression_attributes.suppression`

ADD — `ses-identities.tf`:
```
aws_sesv2_email_identity.sending["auth"]     email_identity = "auth.tenurework.com"
aws_sesv2_email_identity.sending["notify"]   email_identity = "notify.tenurework.com"
aws_sesv2_email_identity.inbound             email_identity = "reply.tenurework.com"
aws_sesv2_email_identity_mail_from_attributes.sending["auth"]
    mail_from_domain = "bounce.auth.tenurework.com"    behavior_on_mx_failure = "REJECT_MESSAGE"
aws_sesv2_email_identity_mail_from_attributes.sending["notify"]
    mail_from_domain = "bounce.notify.tenurework.com"  behavior_on_mx_failure = "REJECT_MESSAGE"
```
`dkim_signing_attributes { next_signing_key_length = "RSA_2048_BIT" }` on each identity.
Do NOT set `configuration_set_name` on any identity.
Do NOT set mail_from_attributes on `inbound`.

ADD — `ses-config-sets.tf` (`aws_sesv2_configuration_set`, 5 resources):
```
tenure-auth-critical   tls REQUIRE  reputation true  sending true  suppressed ["COMPLAINT"]
tenure-transactional   tls REQUIRE  reputation true  sending true  suppressed ["BOUNCE","COMPLAINT"]
tenure-workflow        tls REQUIRE  reputation true  sending true  suppressed ["BOUNCE","COMPLAINT"]
tenure-digest          tls REQUIRE  reputation true  sending true  suppressed ["BOUNCE","COMPLAINT"]
tenure-billing         tls REQUIRE  reputation true  sending true  suppressed ["BOUNCE","COMPLAINT"]
```
(sesv2 `tls_policy` values are `REQUIRE` / `OPTIONAL` — uppercase; the v1 resource uses `Require` / `Optional`.)

ADD — `ses-events.tf`, 2 × `aws_sesv2_configuration_set_event_destination` per set (10 total):
```
matching_event_types = ["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT","RENDERING_FAILURE","DELIVERY_DELAY"]
   (OPEN and CLICK deliberately excluded)
cw  -> cloud_watch_destination, dimension_value_source = "MESSAGE_TAG",
       dimension_name in {email_type, tenant_id, environment}, default_dimension_value = "unknown"
bus -> event_bridge_destination { event_bus_arn = arn:aws:events:us-east-1:<acct>:event-bus/default }
```
Plus `aws_cloudwatch_event_rule.ses_events` + `aws_cloudwatch_event_target` → existing `aws_sqs_queue.email`
(`sqs.tf:27`, name `tenure-<env>-email`, already exposed to the task as `SQS_EMAIL_URL` at `ecs.tf:146`)
+ `aws_sqs_queue_policy` allowing `events.amazonaws.com`.

ADD — `ses-inbound.tf`:
```
aws_s3_bucket.inbound_mail                  ${local.name_prefix}-inbound-mail, 30-day expiry
aws_s3_bucket_policy.inbound_mail           ses.amazonaws.com s3:PutObject, aws:Referer = <acct>
aws_ses_receipt_rule_set.main               rule_set_name = "${local.name_prefix}-inbound"
aws_ses_active_receipt_rule_set.main        <- only ONE active per account per region
aws_ses_receipt_rule.reply                  recipients = ["reply.tenurework.com"]
                                            scan_enabled = true, tls_policy = "Require"
                                            add_header_action position 1 (X-Tenure-Inbound: reply)
                                            s3_action        position 2 (object_key_prefix "inbound/")
                                            lambda_action    position 3 (invocation_type "Event")
aws_ses_receipt_rule.catchall_stop          no recipients, stop_action { scope = "RuleSet", position 1 }
aws_lambda_function.inbound_reply
aws_lambda_permission.ses_invoke            principal ses.amazonaws.com, source_account <acct>
```

ADD — `ses-iam.tf`, attached to `aws_iam_role.ecs_task` (`ecs.tf:46`, `tenure-<env>-ecs-task`):
```json
{"Effect":"Allow",
 "Action":["ses:SendEmail","ses:SendRawEmail"],
 "Resource":["arn:aws:ses:us-east-1:<acct>:identity/auth.tenurework.com",
             "arn:aws:ses:us-east-1:<acct>:identity/notify.tenurework.com",
             "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-auth-critical",
             "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-transactional",
             "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-workflow",
             "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-digest",
             "arn:aws:ses:us-east-1:<acct>:configuration-set/tenure-billing"],
 "Condition":{"ForAllValues:StringLike":
   {"ses:FromAddress":["*@auth.tenurework.com","*@notify.tenurework.com"]}}}
```
`StringLike` is case sensitive — lower-case the From in the sender module.

## Stream registry (apps/web/src/lib/mail/streams.ts)

| From address | email_type prefix | Config set | Reply-To | 1-click unsub |
|---|---|---|---|---|
| account@auth.tenurework.com | account.* | tenure-auth-critical | none | NO |
| invites@auth.tenurework.com | invite.* | tenure-auth-critical | thread | NO |
| verification@auth.tenurework.com | verification.* | tenure-auth-critical | none | NO |
| security@auth.tenurework.com | security.* | tenure-auth-critical | security@tenurework.com | NO |
| access@auth.tenurework.com | access.* | tenure-auth-critical | support@tenurework.com | NO |
| notifications@notify.tenurework.com | notification.* | tenure-transactional | thread | no |
| approvals@notify.tenurework.com | approval.* | tenure-workflow | thread | no |
| tasks@notify.tenurework.com | task.* | tenure-workflow | thread | no |
| mentions@notify.tenurework.com | mention.* | tenure-transactional | thread | no |
| messages@notify.tenurework.com | message.* | tenure-transactional | thread | no |
| calendar@notify.tenurework.com | calendar.* | tenure-transactional | thread | no |
| documents@notify.tenurework.com | document.* | tenure-transactional | thread | no |
| integrations@notify.tenurework.com | integration.* | tenure-transactional | support@tenurework.com | no |
| admin@notify.tenurework.com | admin.* | tenure-transactional | support@tenurework.com | no |
| billing@notify.tenurework.com | billing.* | tenure-billing | billing@tenurework.com | no |
| digest@notify.tenurework.com | digest.* | tenure-digest | none | **YES** |
| system@notify.tenurework.com | system.* | tenure-transactional | none | no |

From header form: `"Simon Business School via Tenure" <notifications@notify.tenurework.com>`
Display name is the ONLY per-tenant variable. Escape `"` and `\`; reject CR/LF.

## Message tags — 7 on every send
Allowed chars in names AND values: `0-9 A-Z a-z - _` only. `.` is NOT allowed.
```
tenant_id     = institutionId (cuid)
org_id        = organizationId or "none"
workspace_id  = "none"   (no Workspace model in schema.prisma today)
user_id       = userId (cuid)
email_type    = emailType with "." -> "_"    e.g. account_password_reset
template_id   = sanitized
environment   = "production" | "staging"
```
An illegal character does NOT fail the send — it silently drops the CloudWatch metric.
Truncate at 200 chars (256 assumed but unverified).

## Reply address
```
r+<43-char-base64url>@reply.tenurework.com     total local part = 45 octets
```
Token = 32 bytes `crypto.randomBytes`, base64url. Stored as `sha256(token)` hex, unique.
RFC 5321 local-part limit is 64 octets, so a self-describing HMAC token (~180 chars) does not fit —
this must be a DB handle, not an encoding.
Parse regex: `^r\+([A-Za-z0-9_-]{43})@reply\.tenurework\.com$`

```prisma
model ReplyToken {
  id             String    @id @default(cuid())
  institutionId  String
  conversationId String
  participantId  String
  messageId      String
  tokenHash      String    @unique   // sha256(token), hex
  epoch          Int       @default(0)
  expiresAt      DateTime            // createdAt + 90 days
  revokedAt      DateTime?
  usedCount      Int       @default(0)
  createdAt      DateTime  @default(now())
  @@index([institutionId, conversationId])
  @@index([expiresAt])
}
// plus: Conversation.replyEpoch Int @default(0)
```

## Thresholds and limits
```
SES sandbox              200 msgs / 24h, 1 msg / sec, verified recipients only
SES prod-access response initial reply within 24 hours
Config sets per region   10,000
SES tenants per account  10,000 default (to 300,000 on request)
Tenant name              <= 64 chars, [A-Za-z0-9_-]
Inbound via S3           40 MB max
Inbound via SNS          150 KB max  (why S3+Lambda, not SNS)
Active receipt rule sets 1 per account per region
Gmail spam rate          < 0.30% enforced, < 0.10% recommended
Yahoo spam rate          < 0.30%
Yahoo unsub processing   within 2 days  (Google's page states no equivalent number)
Gmail bulk threshold     5,000 messages/day to Gmail
DKIM key                 RSA_2048_BIT (Yahoo min 1024)
DNS propagation          up to 72 hours; SES gives up on MAIL FROM MX after 72h -> Failed
CloudWatch alarms        Reputation.BounceRate > 5%, Reputation.ComplaintRate > 0.1%
```

## behavior_on_mx_failure
```
sesv2 (aws_sesv2_email_identity_mail_from_attributes):  USE_DEFAULT_VALUE | REJECT_MESSAGE
v1    (aws_ses_domain_mail_from):                       UseDefaultValue   | RejectMessage
provider default:                                       UseDefaultValue
this design:                                            REJECT_MESSAGE
```
MAIL FROM setup states: Pending / Success / TemporaryFailure / Failed. All but Success use the
fallback setting. Failed is terminal and requires re-running setup.

## Warm-up ramp (my recommendation, NOT from an AWS doc)
```
day 1-2   ~50/day     internal recipients, tenure-auth-critical only
day 3-4   ~200/day
day 5-7   ~1,000/day
week 2    ~5,000/day  + tenure-transactional, tenure-workflow
week 3    double       + tenure-billing
week 4+   double weekly while bounce < 5% and complaint < 0.1%; tenure-digest LAST
```

## Verification commands
```
aws sesv2 get-email-identity --email-identity auth.tenurework.com --region us-east-1
  -> VerifiedForSendingStatus: true
  -> MailFromAttributes.MailFromDomainStatus: SUCCESS
  -> DkimAttributes.SigningHostedZone   (authoritative DKIM CNAME suffix)

aws sesv2 get-account --region us-east-1
  -> ProductionAccessEnabled, SendQuota, EnforcementStatus

# mailbox simulator — works in sandbox, does not touch reputation
success@simulator.amazonses.com
bounce@simulator.amazonses.com
complaint@simulator.amazonses.com
suppressionlist@simulator.amazonses.com
```

## Expected headers on a correctly-configured received message
```
Authentication-Results: mx.google.com;
  spf=pass ... envelope-from=<bounce-id>@bounce.auth.tenurework.com;
  dkim=pass header.i=@auth.tenurework.com;
  dmarc=pass header.from=auth.tenurework.com
```


## Sources
- https://docs.aws.amazon.com/ses/latest/dg/mail-from.html
- https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html
- https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html
- https://docs.aws.amazon.com/ses/latest/dg/receiving-email-mx-record.html
- https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html
- https://docs.aws.amazon.com/ses/latest/dg/using-configuration-sets.html
- https://docs.aws.amazon.com/ses/latest/dg/event-publishing-send-email.html
- https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- https://docs.aws.amazon.com/ses/latest/dg/sending-email-subscription-management.html
- https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html
- https://docs.aws.amazon.com/ses/latest/dg/tenants.html
- https://docs.aws.amazon.com/general/latest/gr/ses.html
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ses_domain_mail_from.html.markdown
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sesv2_configuration_set.html.markdown
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sesv2_configuration_set_event_destination.html.markdown
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sesv2_email_identity.html.markdown
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sesv2_email_identity_mail_from_attributes.html.markdown
- https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ses_receipt_rule.html.markdown
- https://support.google.com/a/answer/81126
- https://senders.yahooinc.com/best-practices/

## Confidence / not asserted
Things I could NOT verify, stated plainly:

1. **Whether a configuration set can be named at send time for an address that inherits verification from its domain.** `creating-identities.html` says an inherited address is "limited to straightforward email sending" and that "advanced sending includes using the email address with configuration sets". I read that as identity-level *default* config sets, not the `ConfigurationSetName` request parameter, but I found no sentence settling it and I ran no send. This is the single most load-bearing unverified assumption in the whole plan. Rollout step 13 is a one-message experiment that settles it; the fallback (17 extra `aws_sesv2_email_identity` resources, no DNS change) is cheap.

2. **The exact MX/SPF value table on `mail-from.html`.** The page's records table renders as "See the AWS documentation website for more details" through WebFetch. I recovered the values from the Terraform provider's own docs source (`10 feedback-smtp.us-east-1.amazonses.com`, `v=spf1 include:amazonses.com ~all`) and cross-checked the hostname against the "Feedback endpoints used by SES for Custom MAIL FROM domains" table in `general/latest/gr/ses.html`, which lists `feedback-smtp.us-east-1.amazonses.com` verbatim. The priority `10` is stated in the page prose ("The number *10* listed along with the MX value is the preference order"). I am confident, but the values came from two sources stitched together rather than one authoritative table.

3. **Maximum length of a message tag name/value.** Not on the page I fetched. I assumed 256 and recommended truncating at 200. The `MessageTag` API reference would settle it.

4. **Whether `ses:FromAddress` is evaluated for the SES v2 `SendEmail` shape.** `control-user-access.html` lists the condition key against `SendEmail` / `SendRawEmail`, but that table is written against v1 API names and the page predates v2's `Content.Simple` structure. Also untested: whether the wildcard matches when the From carries a display name. Rollout step 14 is the test.

5. **RFC 5321 §4.5.3.1.1's 64-octet local-part limit.** Cited from memory; I did not fetch the RFC. The reply-token design (a 43-char random handle) is comfortably inside it either way, so the design does not depend on the exact number — but confirm before treating 64 as a hard budget elsewhere.

6. **Whether a Terraform resource exists for SES tenants.** I confirmed the feature and its API (`docs.aws.amazon.com/ses/latest/dg/tenants.html`, plus a `AWS::SES::Tenant` CloudFormation type in search results), but did not check the AWS provider for `aws_sesv2_tenant`. If absent, tenant creation belongs in application onboarding code, not Terraform.

7. **The CAA record on tenurework.com.** Windows `nslookup` returns "unknown query type: CAA", so I could not query it. The claim that it previously allowed only letsencrypt.org / pki.goog / sectigo.com and that amazon.com was later added comes from a comment in `infrastructure/terraform/variables.tf:146-148`, not from live DNS. It does not affect SES (DKIM CNAMEs and MX records are not certificate issuance), so nothing in the plan depends on it.

8. **A 2-day unsubscribe processing requirement at Google.** Yahoo states "Honor unsubscribes within 2 days" explicitly. I fetched `support.google.com/a/answer/81126` twice with targeted prompts and found no equivalent sentence. I am reporting 2 days as Yahoo's number, not Google's — this is the kind of thing widely repeated as a joint Google/Yahoo rule, and I could not confirm the Google half.

9. **Shared-IP warm-up figures.** The 50 → 200 → 1,000 → 5,000 ramp is standard deliverability practice, not an AWS-published schedule. AWS documents automatic warm-up for *dedicated* IPs only. The shape is sound; the numbers are tunable.

10. **DNS results are a point-in-time read.** All `nslookup` output is from 2026-08-20 against 8.8.8.8 and 1.1.1.1, so it reflects public resolver caches, not the Vercel zone's authoritative contents. A record added in the last few minutes, or one that exists but is not being served, would not appear. Re-query authoritatively against `ns1.vercel-dns.com` before acting on the "no SPF / no DMARC" finding — that finding drives the recommendation to publish DMARC on subdomains only, and it is worth double-checking.

11. **Whether another active SES receipt rule set already exists in the target account+region.** Requires credentials. `aws_ses_active_receipt_rule_set` would silently take over an existing one, and only one can be active per account per region.

12. I did **not** read the ~30 `Tenure_*_Claude_Bible_*.md` documents at the repo root. If any of them already specifies an email architecture, this spec may duplicate or contradict it. My grounding is the live Terraform, the live Prisma schema, the live DNS, and AWS's documentation.

## Risks
**Highest risk in the plan: an apex DMARC record published before Google Workspace authentication is fixed.** The apex has no SPF, no DKIM and no DMARC today (verified). Publishing `_dmarc.tenurework.com` at `p=quarantine` or `p=reject` while human mail is unauthenticated would send every email from every employee to spam or get it rejected outright. Mitigation, and it is complete: publish DMARC only on `auth.` / `notify.` / `reply.` / `bounce.*`. Subdomain DMARC records are resolved directly and never fall back to the organizational domain, so they are fully independent of human mail. The apex is a separate work item with its own sequencing (SPF → DKIM → `p=none` → observe → tighten).

**Second: Terraform cannot reach the DNS that matters.** DNS is at Vercel (`ns1/ns2.vercel-dns.com`). Every SES record is hand-published today, which is how a typo in one of 14 records becomes a silent multi-day verification failure. The Route 53 subdomain-delegation option in §2.6 removes this class of error entirely and — more importantly — makes it structurally impossible for a `terraform apply` to touch the apex where Google Workspace lives. That property is the argument for it, more than the convenience.

**Third: `behavior_on_mx_failure = "REJECT_MESSAGE"` is a deliberate sharp edge that will page someone.** If `bounce.auth.tenurework.com`'s MX is deleted or ever ends up with two MX records, sends stop with `MailFromDomainNotVerified` rather than degrading quietly. That is the correct trade — the alternative degrades into DMARC-failing mail that vanishes — but it must be alarmed and documented, and the MAIL FROM state must be monitored (SES abandons the setup permanently after 72 hours in `Failed`).

**Fourth: the five configuration-set names have no environment prefix.** A staging apply in the same account and region as production collides on all five. Decide before the first apply.

**Fifth: `tls_policy = "REQUIRE"` will drop mail to receivers that do not support STARTTLS.** Correct for student PII and required by Google's guidelines, but it is a real deliverability cost against badly-run institutional mail servers, and it should be a knowing decision rather than a discovery.

**Sixth: `aws_ses_active_receipt_rule_set` is account-and-region singular.** Applying it takes over whatever rule set is active. Check first.

**Seventh: SES message tags fail open.** An illegal character in a tag value does not fail the send — it silently stops emitting the CloudWatch metric. A sanitizer bug therefore produces missing dashboards rather than errors, which is the kind of defect that survives a quarter. Unit-test the sanitizer against the documented character class.

**Eighth: putting `List-Unsubscribe` on auth mail would let people opt out of their own password resets.** Gmail renders the header as a prominent button and people click it. Encode the prohibition in the type system, not in a comment: assert in a test that no stream on `tenure-auth-critical` has `unsubscribe: true`.

**Ninth: adopting SES's built-in `ListManagementOptions` moves subscription state out of Postgres.** SES overrides any `List-Unsubscribe` headers you set yourself and becomes the system of record, which conflicts with the existing `NotificationPreference` model. Self-managed headers pointing at a Tenure endpoint keep preference state where the rest of it lives.

**Tenth: existing state is live and wrong.** `ecs.tf:151` injects `SES_FROM_EMAIL=hello@tenurework.com` into the running production task, and `ses.tf` verifies the apex domain — both direct contradictions of the design. Nothing sends today (verified by grep across `apps/web`), so removing them is a zero-traffic change, but they must be removed rather than left as an unexercised path back to the banned address.

**Eleventh: reputation.** This account has no sending history. Do not let `tenure-digest` be the stream that establishes it. Register both sending domains in Google Postmaster Tools before digest volume begins, or the 0.30% number you are being judged on is invisible to you.
