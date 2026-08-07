-- Payments / treasury: the tenant-scoped idempotency key, a denominated and
-- attributable ledger, provider-neutral external references, and financial
-- history that a DELETE cannot take with it.
--
-- Covers REVIEW-FINDINGS #7 (P0), PAY-020-004, PAY-030-005, PAY-030-006,
-- PAY-030-007, PAY-080-004, PAY-130-004, PAY-140-005, PAY-150-003, PAY-230-004.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight.
--
-- The claim this migration rests on is that NOTHING has ever written
-- ApprovalRequest.idempotencyKey, so dropping the global unique and creating a
-- tenant-scoped one needs no backfill and can collide with nothing. Assert it
-- rather than believe it: if a writer landed between the survey and this
-- migration, the composite index would be created over rows nobody checked.
DO $$
DECLARE keyed BIGINT;
BEGIN
  SELECT count(*) INTO keyed FROM "ApprovalRequest" WHERE "idempotencyKey" IS NOT NULL;
  IF keyed > 0 THEN
    RAISE EXCEPTION
      'ApprovalRequest has % row(s) with a non-null idempotencyKey. This migration assumes none: re-check them for cross-tenant collisions before scoping the index.',
      keyed;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. REVIEW-FINDINGS #7 — the client-supplied key stops being a global handle.
--
-- "ApprovalRequest_idempotencyKey_key" is ONE unique index across every tenant,
-- so tenant B retrying with a key tenant A had already used resolved onto
-- tenant A's approval. PostgreSQL treats NULLs as distinct in a unique index,
-- so the composite leaves every un-keyed row free.
DROP INDEX "ApprovalRequest_idempotencyKey_key";
CREATE UNIQUE INDEX "ApprovalRequest_institutionId_idempotencyKey_key"
  ON "ApprovalRequest"("institutionId", "idempotencyKey");

-- PAY-150-003 — maker-checker needs a preparer to name.
ALTER TABLE "ApprovalRequest" ADD COLUMN "preparedById" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PAY-030-005 — the state-transition history records what policy it was
--    decided against, who conferred the authority, and what evidence backed it.
--
-- Added nullable, backfilled, then SET NOT NULL. Rows that predate this were
-- genuinely decided without a recorded revision; 'unrecorded@0' says exactly
-- that rather than inventing a blueprint version they were never checked
-- against.
ALTER TABLE "ApprovalStep" ADD COLUMN "configRevision" TEXT;
ALTER TABLE "ApprovalStep" ADD COLUMN "configChecksum" TEXT;
ALTER TABLE "ApprovalStep" ADD COLUMN "authority" TEXT;
ALTER TABLE "ApprovalStep" ADD COLUMN "evidenceDocumentId" TEXT;

UPDATE "ApprovalStep" SET "configRevision" = 'unrecorded@0' WHERE "configRevision" IS NULL;
UPDATE "ApprovalStep" SET "configChecksum" = 'unrecorded' WHERE "configChecksum" IS NULL;
UPDATE "ApprovalStep" SET "authority" = 'unrecorded' WHERE "authority" IS NULL;

ALTER TABLE "ApprovalStep" ALTER COLUMN "configRevision" SET NOT NULL;
ALTER TABLE "ApprovalStep" ALTER COLUMN "configChecksum" SET NOT NULL;
ALTER TABLE "ApprovalStep" ALTER COLUMN "authority" SET NOT NULL;

ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_evidenceDocumentId_fkey"
  FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PAY-030-007 / PAY-080-004 — the ledger entry carries its tenant, its
--    currency, its durable owner seat and its attribution.
ALTER TABLE "LedgerEntry" ADD COLUMN "institutionId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "currency" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "postedBySeatId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "eventId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "seatId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "fundCode" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "settlementId" TEXT;

-- Backfill from the rows that already knew the answer: the tenant from the
-- owning Organization, the denomination from the parent BudgetLine. Neither is
-- a guess — both relations are mandatory, so every entry has exactly one.
UPDATE "LedgerEntry" e
   SET "institutionId" = o."institutionId"
  FROM "Organization" o
 WHERE o."id" = e."organizationId";

UPDATE "LedgerEntry" e
   SET "currency" = l."currency"
  FROM "BudgetLine" l
 WHERE l."id" = e."budgetLineId";

DO $$
DECLARE orphans BIGINT;
BEGIN
  SELECT count(*) INTO orphans
    FROM "LedgerEntry"
   WHERE "institutionId" IS NULL OR "currency" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      '% LedgerEntry row(s) did not backfill. Both source relations are mandatory, so this means referential damage that must be looked at before the columns go NOT NULL.',
      orphans;
  END IF;
END $$;

ALTER TABLE "LedgerEntry" ALTER COLUMN "institutionId" SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "currency" SET NOT NULL;

CREATE INDEX "LedgerEntry_institutionId_occurredAt_idx" ON "LedgerEntry"("institutionId", "occurredAt");
CREATE INDEX "LedgerEntry_organizationId_eventId_idx" ON "LedgerEntry"("organizationId", "eventId");
CREATE INDEX "LedgerEntry_organizationId_seatId_idx" ON "LedgerEntry"("organizationId", "seatId");
CREATE INDEX "LedgerEntry_organizationId_fundCode_idx" ON "LedgerEntry"("organizationId", "fundCode");
CREATE INDEX "LedgerEntry_settlementId_idx" ON "LedgerEntry"("settlementId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PAY-030-006 — deleting an Organization no longer destroys its financial
--    history. Six relations, Cascade to Restrict. Removal has a legal path
--    already: OrgStatus.ARCHIVED, which the roster and every read filter on.
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_organizationId_fkey";
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_budgetId_fkey";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_budgetId_fkey"
  FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_organizationId_fkey";
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Vendor" DROP CONSTRAINT "Vendor_organizationId_fkey";
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_organizationId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_budgetLineId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_budgetLineId_fkey"
  FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PAY-150-003 — standing declarations get somewhere to live, so the
--    DECLARED_CONFLICT and RECUSED arms of `mayDecide` stop being unreachable.
CREATE TABLE "ConflictDeclaration" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),

    CONSTRAINT "ConflictDeclaration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConflictDeclaration_institutionId_principalId_idx" ON "ConflictDeclaration"("institutionId", "principalId");
CREATE INDEX "ConflictDeclaration_institutionId_subjectId_idx" ON "ConflictDeclaration"("institutionId", "subjectId");

CREATE TABLE "Recusal" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'ApprovalRequest',
    "resourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),

    CONSTRAINT "Recusal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Recusal_institutionId_resourceId_idx" ON "Recusal"("institutionId", "resourceId");
CREATE UNIQUE INDEX "Recusal_institutionId_principalId_resourceId_key" ON "Recusal"("institutionId", "principalId", "resourceId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PAY-020-004 / PAY-130-004 — provider-neutral canonical ids.
--
-- The unique tuple is the requirement: a raw provider id without account and
-- mode context is not unique enough to key on. `canonicalId` is Tenure's own
-- and is what every other row points at.
CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "programId" TEXT,
    "connectedAccountId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExternalReference_institutionId_provider_mode_idx" ON "ExternalReference"("institutionId", "provider", "mode");
CREATE UNIQUE INDEX "ExternalReference_provider_mode_connectedAccountId_objectTy_key" ON "ExternalReference"("provider", "mode", "connectedAccountId", "objectType", "externalId");
CREATE UNIQUE INDEX "ExternalReference_institutionId_canonicalId_key" ON "ExternalReference"("institutionId", "canonicalId");

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "externalReferenceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinorUnits" INTEGER NOT NULL,
    "feeMinorUnits" INTEGER NOT NULL,
    "netMinorUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Settlement_institutionId_occurredAt_idx" ON "Settlement"("institutionId", "occurredAt");

CREATE TABLE "ProviderBalanceTransaction" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinorUnits" INTEGER NOT NULL,
    "feeMinorUnits" INTEGER NOT NULL,
    "netMinorUnits" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderBalanceTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderBalanceTransaction_institutionId_ingestedAt_idx" ON "ProviderBalanceTransaction"("institutionId", "ingestedAt");
CREATE UNIQUE INDEX "ProviderBalanceTransaction_provider_mode_providerAccountId__key" ON "ProviderBalanceTransaction"("provider", "mode", "providerAccountId", "externalId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PAY-230-004 — inbound receipts and their allocation.
CREATE TYPE "ReceiptSource" AS ENUM ('DUES', 'EVENT', 'SPONSORSHIP');
ALTER TYPE "LedgerKind" ADD VALUE 'RECEIPT';

CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fundCode" TEXT,
    "eventId" TEXT,
    "minorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReceiptAllocation_institutionId_ledgerEntryId_idx" ON "ReceiptAllocation"("institutionId", "ledgerEntryId");
CREATE INDEX "ReceiptAllocation_organizationId_source_idx" ON "ReceiptAllocation"("organizationId", "source");

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. The new foreign keys.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_postedBySeatId_fkey"
  FOREIGN KEY ("postedBySeatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_seatId_fkey"
  FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_ledgerEntryId_fkey"
  FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_externalReferenceId_fkey"
  FOREIGN KEY ("externalReferenceId") REFERENCES "ExternalReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;
