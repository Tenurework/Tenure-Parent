-- The consuming half of the transactional outbox.
--
-- Covers PAY-020-005 (dispatcher, dead-letter operator path, idempotent
-- consumers), PAY-020-006 (provider-origin classification) and PAY-140-007
-- (event-gap reconciliation and safe redrive).
--
-- Nothing here is destructive: two nullable/defaulted columns on OutboxEvent
-- and one new table. Every existing row keeps its meaning.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PAY-020-006 — who wrote the payload.
--
-- `DomainEvent.origin` is required, and the dispatcher rehydrates the event
-- from this row: without the column an event read back from the database would
-- fail its own contract at delivery time. The backfill value is a fact, not a
-- guess — `outboxEventRow` in the approvals action is the only writer this
-- table has ever had, and it writes events this platform authored.
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'tenure';

-- When a consumer confirmed it. Set only AFTER delivery returns, which is what
-- makes a crash between the two a redelivery rather than a lost event.
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PAY-020-005 — the inbox, without which at-least-once is unbounded.
--
-- The dispatcher marks a record dispatched only after the consumer returns, so
-- a crash in between redelivers. That is only tolerable if a consumer can
-- recognise a redelivery; this table is where it writes down that it ran, in
-- the same transaction as its own effects.
CREATE TABLE IF NOT EXISTS "InboxEvent" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- The dedupe itself. A UNIQUE INDEX rather than an application check, because
-- two dispatchers claiming different rows can still race on the same event id
-- after a replay, and a check-then-insert loses that race silently. Keyed by
-- consumer as well: two consumers of one event are two pieces of work, and one
-- having run says nothing about the other.
CREATE UNIQUE INDEX IF NOT EXISTS "InboxEvent_institutionId_eventId_consumer_key"
    ON "InboxEvent"("institutionId", "eventId", "consumer");

CREATE INDEX IF NOT EXISTS "InboxEvent_institutionId_consumedAt_idx"
    ON "InboxEvent"("institutionId", "consumedAt");

-- Scoped like the outbox row it acknowledges: a tenant's deletion takes its
-- consumption record with it, or the record outlives the institution it names.
ALTER TABLE "InboxEvent" DROP CONSTRAINT IF EXISTS "InboxEvent_institutionId_fkey";
ALTER TABLE "InboxEvent" ADD CONSTRAINT "InboxEvent_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
