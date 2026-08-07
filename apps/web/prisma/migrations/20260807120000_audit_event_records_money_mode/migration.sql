-- PAY-000-007 — the audit trail learns which money-mode an action happened in.
--
-- Before this column, nothing in the platform had a mode dimension at all. One
-- deployment serves a tenant still being set up and a tenant running real
-- budgets; `NODE_ENV` is the same string for both, so two AuditEvent rows for
-- the same action in those two tenants were byte-identical on the only point
-- that matters after the fact. "Did this happen in test or in live" had no
-- field to be answered from.
--
-- Written by apps/web/src/lib/audit-record.ts (`recordAuditEvent`) from the
-- ambient TenantScope, whose `environment` is resolved from the tenant's
-- published configuration key `platform.payments.mode` — not from an
-- environment variable, so a mode change is an authorised configuration
-- publication with a diff rather than a deploy.

ALTER TABLE "AuditEvent" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'test';

COMMENT ON COLUMN "AuditEvent"."mode" IS
  'Money-mode the action happened in: test or live. Resolved per tenant from platform.payments.mode, never from NODE_ENV.';

-- Every existing row backfills to 'test', and that is a statement rather than a
-- convenience. None of them were written by a payment path — there is no
-- payment path — so calling them 'live' would manufacture evidence that real
-- money moved, in a table whose whole value is that it does not do that. The
-- default runs in the direction that claims the least.

-- "Everything that happened in live for this tenant" is the first query an
-- incident review runs, and it is the one that must not table-scan the audit
-- trail of a tenant that has been live for a year.
CREATE INDEX "AuditEvent_institutionId_mode_occurredAt_idx"
  ON "AuditEvent" ("institutionId", "mode", "occurredAt");
