# Subsystem paths, duplicates, and contradictions

GE-000-003. Where each cross-cutting concern is actually implemented, which
concerns have more than one implementation, and which of those disagree.

The point of this document is the second half. A list of where things live is
mildly useful; a list of the places where the codebase holds two opinions is
what stops the next change from picking the wrong one. Every claim below was
read out of the code on 2026-07-31, and the counts are reproducible with the
commands shown.

---

## 1. Authentication

| Path | File |
|---|---|
| Provider registration | `apps/web/src/lib/auth.ts` |
| Session shape | JWT (`session: { strategy: "jwt" }`), required by the credentials provider |
| Adapter | `PrismaAdapter(db)` — user rows in Postgres |

Two providers, and **which one is live depends on configuration, not on code**:

- **Okta**, registered only when `OKTA_ISSUER` is set and starts with `https://`.
- **`dev-login`**, a credentials provider registered when `AUTH_DEV_LOGIN=true`.
  It takes an email and a **single shared passphrase** — not a per-user secret —
  and signs in whichever seeded user owns that email.

`checkDevLoginGate` (`lib/dev-login.ts`) refuses in production when no passphrase
is configured, rather than falling through to open, and `lib/env.ts` refuses to
boot in the same state. Two independent lines, which is right.

But the honest statement is this: **the pilot authenticates every user with one
shared passphrase.** Anyone holding it can sign in as any seeded email, including
a director. There is no second factor, no per-user credential, and no
account-recovery path. That is a pilot decision, not a platform one, and it is
the concrete reason GE-041 moves identity to Cognito.

> Contradiction with the Bible: §Identity mandates Cognito as the identity
> substrate for both the engine and tenants. Neither application uses it — the
> inventory found **zero Cognito user pools** in the account. Owned by GE-041.

## 2. Authorization — three systems, and the newest one gates nothing

This is the most consequential duplication in the repository.

| System | File | Consumers | What it decides |
|---|---|---|---|
| `rbac.ts` | `apps/web/src/lib/rbac.ts` | app-wide | seat and membership lookups — `UserContext` |
| `admin/capabilities.ts` | `apps/web/src/lib/admin/capabilities.ts` | 11 files | 16 capability ids, Director ⊇ Staff ⊇ Advisor. **Authoritative for privileged operations.** |
| `@tenure/authorization` | `packages/authorization/` | 2 files | roles, scope, delegation, effective dates, separation of duties |

The package is the one the Architecture Bible describes — and today it decides
**which menu entries render**, and nothing else. Its two consumers are
`lib/authz/navigation-capabilities.ts` (navigation) and `lib/system/build-system.ts`
(reads the `SEPARATION_OF_DUTIES` constant while validating a system definition).

`navigation-capabilities.ts` says so itself, in a comment that deserves to be
lifted into a ledger rather than left where only its author will read it:

> These are navigation capabilities only. Hiding a link does not protect a
> route; `admin/guard.ts` and `requireCapability` remain authoritative.

So: **the platform's policy engine does not gate a single request.** It is
well-tested, it models things the app cannot express — suspension, effective
dates, module gating, delegation — and it is wired to the menu. Any claim that
Tenure has a policy engine enforcing access is, today, false.

The three are not in conflict about outcomes, because the newest one was
deliberately built to reproduce today's behaviour exactly (all three institution
roles map to both navigation capabilities, matching the `institutionRoles.length > 0`
test it replaced). They are in conflict about **authority**: nothing records
which system a new permission check should be written against, and the answer is
currently "the older one", which is the opposite of the intended direction.

> Owned by: GE-030s. The migration is not "delete two systems" — `rbac.ts`
> answers a different question (who holds what seat) and stays. It is
> `admin/capabilities.ts` whose 16 ids must become policies the engine decides.

## 3. Audit — 38 writes, 6 through the audit package

```
$ grep -rho 'auditEvent\.create' apps/web/src --include=*.ts --include=*.tsx | wc -l
36
```

Of those call sites, exactly **two** — `lib/admin/guard.ts` and
`lib/provisioning/reconcile.ts` — import `buildAuditRecord` from `@tenure/audit`.
The other 32 construct a `db.auditEvent.create({ ... })` payload by hand.
`lib/calendar-write.ts` joined the package side on 2026-08-07: its two
conflict records are built by `buildAuditRecord`, which is what enforces
that a DENY carries a reason and that metadata is redacted before storage.

What the 34 therefore skip:

- **Validation.** `buildAuditRecord` throws when `tenantId`, `actor.principalId`,
  `action` or `resourceType` is missing, and when a `DENY` carries no reason.
  A hand-built row can omit any of them.
- **Redaction.** `redactMetadata` strips sensitive keys before the row is stored.
  A hand-built row stores whatever was put in `metadata`.
- **Chaining.** The package's record carries the fields that make a sequence of
  events tamper-evident. A hand-built row does not participate.

This is not a latent risk; it is the current state of the evidence trail. The
audit log that a school would be shown in an incident review is 32/38
unvalidated. The ratchet in `tests/security/audit-writes.test.mjs` is what makes
that number able only to improve: the reconciler was a *new* write, and it went
through the package rather than adding a 35th raw one.

> Owned by: GE-120s. The fix is mechanical — route every write through one
> helper — and the test that keeps it fixed is the same shape as
> `tests/security/entry-points.test.mjs`: count the raw writes, assert zero.

## 4. Tenancy

| Path | File |
|---|---|
| Scope resolution from a user | `lib/tenant-scope.ts` → `resolveTenantScope` |
| Scope iteration for jobs | `lib/tenant-scope.ts` → `forEachInstitution` |
| Model classification | `lib/tenancy/registry.ts` — all 40 models as scoped / platform-global / unenforceable |
| Enforcement | Prisma client extension, asserted by `npm run test:isolation` (34 tests) |

This is the healthiest subsystem in the repository and has no duplicate. The
registry fails a test when a model is added without being classified, so the
classification cannot silently fall behind the schema.

One honest limit: the `(app)` layout swallows a `resolveTenantScope` throw and
renders the minimal shell, because a layout's job is to render a shell. The page
inside still fails loudly. That is a deliberate asymmetry, documented in place,
and it is the only path where a missing tenant does not fail closed.

## 5. Person — two models, deliberately

| Model | Line | Is |
|---|---|---|
| `User` | `schema.prisma:101` | someone who can sign in |
| `DirectoryPerson` | `schema.prisma:275` | someone on the roster |

The schema comments the reason: seeding the real roster as login accounts would
create 172 accounts nobody asked for. This is a duplication that is correct, and
it is listed here so that a future reader does not "unify" them.

## 6. Money

| Path | File |
|---|---|
| Amounts | `@tenure/platform-config/money` — integer minor units |
| Ledger | `BudgetLine`, `LedgerEntry`, `Vendor` in the schema |
| Writes | `(app)/orgs/[slug]/finance/actions.ts` (7 actions) |

`platform-config` exposes `/money` as a separate entry point specifically because
the package root reaches `node:crypto` and would otherwise pull it into a client
bundle. No duplication found.

## 7. AI — one egress, no gateway

```
$ grep -rn 'fetch("https' apps/web/src --include=*.ts | grep -v test
lib/ai.ts:35:  const res = await fetch("https://api.anthropic.com/v1/messages", ...)
```

**That is the only outbound HTTP call in the entire application.** It goes
directly to the Anthropic API with `ANTHROPIC_API_KEY`, from the ECS task.

What does exist and is worth crediting: the model only ever sees sources the
requesting user is permitted to see (`synthesizeAnswer` is called with
already-permission-filtered `ScoredDoc`s), failures are logged with status and
body rather than collapsing to `null` silently, and there is a 20s timeout and
a single retry limited to 429/529.

What does not exist:

- no per-tenant model policy — one key, one model, every tenant
- no cost attribution or budget
- no prompt/response audit — an AI answer is not an `AuditEvent`
- no provider abstraction — the URL is a literal in the calling module

> Contradiction with the Bible: §ModelGateway routes all inference through
> Bedrock with per-tenant policy, cost accounting and audit. Owned by GE-100s.

## 8. Connectors — none

There is no connector framework, no webhook receiver, no OAuth app installation
and no third-party integration beyond the AI call above. The Bible's connector
model is entirely unbuilt. This is stated so that "connectors" is never assumed
to be partially present.

## 9. Notifications — five queues with no producer and no consumer

The AWS inventory (`aws-inventory.json`, run `30673479805`) found:

```
sqsQueues: tenure-pilot-default, tenure-pilot-default-dlq,
           tenure-pilot-email, tenure-pilot-email-dlq,
           tenure-pilot-notifications
```

The application declares **no SQS or SES client at all**:

```
$ node -e "…apps/web/package.json…" | grep aws
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
```

`notifyUsers` (`lib/notify.ts`) writes `Notification` rows to Postgres. The UI
reads them. Nothing is enqueued and nothing is dequeued, and **no email is ever
sent by the product** — `infrastructure/terraform/ses.tf` provisions a sending
identity that no code uses.

Two consequences worth stating plainly:

1. The deliverable reminder that "freezes club budgets when missed" reaches a
   user only if they open the app. It is an in-app notification described in
   code as a reminder.
2. `tenure-pilot-dlq-messages` is a CloudWatch alarm in `OK` state watching a
   dead-letter queue that nothing can write to. It will never fire, and its
   being green means nothing.

> This is the clearest infrastructure/code drift in the estate: five queues, a
> sending identity, and an alarm, provisioned for a delivery path that was never
> written. Owned by GE-090 (eventing) and GE-140 (notification delivery).

## 10. Files

| Path | File |
|---|---|
| S3 access | `lib/s3.ts` — `GetObject`, `PutObject`, presigned URLs |
| Served through | `/api/attachment/[id]/content`, `/api/documents/[id]/content` |

Content is streamed through the application rather than by redirecting to a
presigned URL, so the permission check happens on every read. Both routes write
an `AuditEvent` — among the 34 that bypass the audit package.

## 11. Search

`lib/search.ts` + `lib/search-data.ts`, backed by Postgres queries against the
same rows the rest of the app reads, permission-filtered before scoring. No
external search service, no index to fall out of date. `/api/search` is
session- and tenant-guarded.

---

## The contradictions, ranked

| # | Contradiction | Evidence | Owner |
|---|---|---|---|
| 1 | The authorization engine gates nothing. Two older systems decide access; the newest paints the menu. | 2 consumers, both navigational | GE-030s |
| 2 | 32 of 38 audit writes bypass validation, redaction and chaining. | 6 of 38 import `@tenure/audit` | GE-120s |
| 3 | Five SQS queues, an SES identity and a DLQ alarm exist for a delivery path with no producer and no consumer. | no SQS/SES client in any package | GE-090 / GE-140 |
| 4 | Identity is a shared passphrase; the Bible mandates Cognito. | 0 user pools in the account | GE-041 |
| 5 | Inference calls a vendor API directly from the task; the Bible mandates a gateway with per-tenant policy, cost and audit. | one literal URL in `lib/ai.ts` | GE-100s |
| 6 | Connectors are assumed to exist somewhere. They do not exist at all. | no webhook receiver, no OAuth install | GE-110s |

Two duplications were examined and found **correct**, and are recorded so they
are not "fixed": `User` vs `DirectoryPerson` (§5), and the `(app)` layout's
deliberate swallow of a tenant-resolution failure (§4).
