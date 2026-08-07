-- PAY-120-001 — a posted ledger entry is corrected by a reversal, not a DELETE.
--
-- `deleteLedgerEntry` called `tx.ledgerEntry.delete()` and recomputed the
-- budget line's actual from whatever survived. A transaction the institution
-- had recognised simply stopped existing: no opposite entry, no reason, no
-- record that money had ever been recognised at all, and nothing to reconcile a
-- bank statement against. This is the schema half of replacing that with a
-- reversal — two rows, both readable, summing to zero.

-- The kind. Deliberately its own value rather than an ADJUSTMENT with a memo:
-- a reversal is bound to the entry it answers by `reversesId`, and a kind that
-- did not distinguish it would make "has this been reversed" a text search.
ALTER TYPE "LedgerKind" ADD VALUE IF NOT EXISTS 'REVERSAL';

ALTER TABLE "LedgerEntry" ADD COLUMN "reversesId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "reversalReason" TEXT;

COMMENT ON COLUMN "LedgerEntry"."reversesId" IS
  'PAY-120-001. The posted entry this REVERSAL answers. Unique: one posting may be reversed at most once.';
COMMENT ON COLUMN "LedgerEntry"."reversalReason" IS
  'PAY-120-001. Why the correction was made. Required by reverseLedgerEntry; a reversal with no reason is a deletion with extra steps.';

-- One reversal per posting. This is the constraint that makes the reversal path
-- safe to retry: a double-submitted correction is refused by PostgreSQL rather
-- than by a read-then-write that two requests both win.
CREATE UNIQUE INDEX "LedgerEntry_reversesId_key" ON "LedgerEntry"("reversesId");

-- Restrict, matching every other link into a posted entry (PAY-030-006): the
-- entry a correction refers to must not be removable out from under it, or the
-- reversal becomes a correction of nothing.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversesId_fkey"
  FOREIGN KEY ("reversesId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
