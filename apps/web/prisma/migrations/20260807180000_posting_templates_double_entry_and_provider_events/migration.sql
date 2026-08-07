-- PAY-130-002 / PAY-140-008 / PAY-070-003 — double entry, provider event
-- receipts, and the funds-flow configuration the liability gate protects.
--
-- Before this, `LedgerEntry` was single-sided: one `amountCents`, one
-- `budgetLineId`, and a posting rule that was a signum function. It could say
-- that a club spent £40; it could not say what the club then owed the member
-- who paid, because there was no credit to record it on. Nothing anywhere
-- asserted debits equal credits, because there were no credits.

-- ── 1. The side of the journal ───────────────────────────────────────────────
--
-- Direction lives in the enum and magnitude in `amountCents`, which stays
-- debit-positive. `SUM(amountCents) GROUP BY journalId` is therefore exactly 0
-- for a balanced journal, and a non-zero sum is a broken one a query can find.
DO $$ BEGIN
  CREATE TYPE "LedgerSide" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. The new columns, nullable first so the backfill has somewhere to go ───
ALTER TABLE "LedgerEntry" ADD COLUMN "journalId"  TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "templateId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "account"    TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "side"       "LedgerSide";
ALTER TABLE "LedgerEntry" ADD COLUMN "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
--
-- Every existing row becomes the budget-dimensioned half of a synthetic,
-- single-sided journal. That is the truthful description of what it was: the
-- expense side was recorded and the counter-side never existed. Inventing the
-- missing half here would fabricate a credit to an account nobody chose.
--
-- The journal id is derived from the row id so it is stable across a re-run and
-- so the two are visibly the same object; the template is named `synthetic` so
-- a reader can tell a backfilled row from one a template actually produced.
UPDATE "LedgerEntry"
SET
  "journalId"  = COALESCE("journalId", 'jrn_backfill_' || "id"),
  "templateId" = COALESCE("templateId", 'synthetic.pre-double-entry'),
  "account"    = COALESCE("account", '6000-program-expense'),
  -- Debit-positive: a SPEND raised the line's actual and is a debit to expense;
  -- a REIMBURSEMENT or a REVERSAL lowered it and is a credit to the same
  -- account. The sign already stored is the only evidence of which, and it is
  -- sufficient — the two kinds never share a sign.
  "side"       = COALESCE("side", CASE WHEN "amountCents" < 0 THEN 'CREDIT'::"LedgerSide" ELSE 'DEBIT'::"LedgerSide" END),
  "effectiveAt" = "occurredAt"
WHERE "journalId" IS NULL OR "templateId" IS NULL OR "account" IS NULL OR "side" IS NULL;

ALTER TABLE "LedgerEntry" ALTER COLUMN "journalId"  SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "templateId" SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "account"    SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "side"       SET NOT NULL;

COMMENT ON COLUMN "LedgerEntry"."journalId" IS
  'PAY-130-002. The journal this row is one side of. Both halves share it.';
COMMENT ON COLUMN "LedgerEntry"."templateId" IS
  'PAY-130-002. The posting template revision that produced it. Effective-dated, so re-deriving a March entry needs to know which revision posted it.';
COMMENT ON COLUMN "LedgerEntry"."account" IS
  'PAY-130-002. Chart-of-accounts code this side hits.';
COMMENT ON COLUMN "LedgerEntry"."effectiveAt" IS
  'PAY-130-002. The accounting date, which is neither occurredAt (when the spend happened) nor createdAt (when the row was written).';

-- ── 4. Only one side carries the budget-line dimension ───────────────────────
--
-- The club's expense hits a budget line; the payable to the member who fronted
-- the cash is an organization-level liability and does not. Making the column
-- NULLable rather than adding a `budgetDimensioned` flag is deliberate: every
-- existing `aggregate({ where: { budgetLineId } })` in the application already
-- excludes NULL, so a line's actual stays correct without each call site
-- learning about journals. A boolean would have made three of them silently
-- wrong on the day the first counter-half was written.
ALTER TABLE "LedgerEntry" ALTER COLUMN "budgetLineId" DROP NOT NULL;

CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");

-- ── 5. PAY-140-008 — the immutable receipt for an inbound provider event ─────
CREATE TABLE "ProviderEventReceipt" (
  "id"                    TEXT NOT NULL,
  "provider"              TEXT NOT NULL,
  "mode"                  TEXT NOT NULL,
  "accountId"             TEXT NOT NULL,
  "eventId"               TEXT NOT NULL,
  "eventType"             TEXT NOT NULL,
  "sequence"              INTEGER NOT NULL,
  "apiVersion"            TEXT NOT NULL,
  "dedupeVerdict"         TEXT NOT NULL,
  "verifiedBySecretIndex" INTEGER NOT NULL,
  "receivedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderEventReceipt_pkey" PRIMARY KEY ("id")
);

-- The four-part key. Dropping any part merges events that are not the same:
-- `evt_1` in test and in live are different events, and so is the same id under
-- two connected accounts.
CREATE UNIQUE INDEX "ProviderEventReceipt_provider_mode_accountId_eventId_key"
  ON "ProviderEventReceipt"("provider", "mode", "accountId", "eventId");
CREATE INDEX "ProviderEventReceipt_provider_mode_accountId_sequence_idx"
  ON "ProviderEventReceipt"("provider", "mode", "accountId", "sequence");

-- ── 6. PAY-070-003 — the configuration the liability gate refuses to write ───
CREATE TABLE "PaymentsFundsFlowConfig" (
  "id"                  TEXT NOT NULL,
  "institutionId"       TEXT NOT NULL,
  "organizationId"      TEXT NOT NULL,
  "legalEntityId"       TEXT NOT NULL,
  "capabilityId"        TEXT NOT NULL,
  "chargeModel"         TEXT NOT NULL,
  "liableParty"         TEXT NOT NULL,
  "region"              TEXT NOT NULL,
  "currency"            TEXT NOT NULL,
  "grossCents"          INTEGER NOT NULL,
  "platformFeeCents"    INTEGER NOT NULL,
  "decisionDigest"      TEXT NOT NULL,
  "exceptionApprovalId" TEXT,
  "createdById"         TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentsFundsFlowConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentsFundsFlowConfig_organizationId_legalEntityId_capabi_key"
  ON "PaymentsFundsFlowConfig"("organizationId", "legalEntityId", "capabilityId");
CREATE INDEX "PaymentsFundsFlowConfig_institutionId_updatedAt_idx"
  ON "PaymentsFundsFlowConfig"("institutionId", "updatedAt");

-- Restrict on both, for the reason every other link into financial state is
-- Restrict (PAY-030-006): the approval that authorised a liability shift must
-- not be removable out from under the configuration it authorised, or the
-- configuration silently becomes unapproved while still in force.
ALTER TABLE "PaymentsFundsFlowConfig" ADD CONSTRAINT "PaymentsFundsFlowConfig_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentsFundsFlowConfig" ADD CONSTRAINT "PaymentsFundsFlowConfig_exceptionApprovalId_fkey"
  FOREIGN KEY ("exceptionApprovalId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
