-- WRK-120-004 — the meter for model use and provider calls.
--
-- `apps/web/src/lib/ai.ts` makes the one outbound vendor call this application
-- makes, and it parsed the response with a cast that named only `content`. The
-- Anthropic messages API returns `usage.input_tokens` and `usage.output_tokens`
-- on every 200, so the numbers arrived on the wire and were dropped on the
-- floor: no tenant could be charged for a call, and no budget could refuse one,
-- because nothing recorded that a call had happened at all.
--
-- One row per provider call. A running counter answers only "how much"; the
-- questions asked afterwards — which model, which month, one runaway loop or
-- steady use — need the calls themselves.
--
-- Purely additive: one new table, no column changed, no row rewritten.
CREATE TABLE IF NOT EXISTS "ModelUsageMeter" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    -- The UTC calendar month this call is billed into, as `YYYY-MM`. Stored
    -- rather than derived at read time: the budget is a calendar-month
    -- allowance, and computing the month from `occurredAt` in SQL could not use
    -- the index below and would disagree with the application's own UTC month
    -- boundary the first time a container ran in another zone.
    "period" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelUsageMeter_pkey" PRIMARY KEY ("id")
);

-- The budget query, and the only one this table has: this tenant's total for
-- this period. A SUM without this index is a sequential scan of every call the
-- platform has ever made, on the request path of every assistant answer.
CREATE INDEX IF NOT EXISTS "ModelUsageMeter_institutionId_period_idx"
    ON "ModelUsageMeter"("institutionId", "period");

-- Scoped like every other tenant row: an institution's deletion takes its meter
-- with it, rather than leaving usage attributed to a tenant that no longer
-- exists.
ALTER TABLE "ModelUsageMeter" DROP CONSTRAINT IF EXISTS "ModelUsageMeter_institutionId_fkey";
ALTER TABLE "ModelUsageMeter" ADD CONSTRAINT "ModelUsageMeter_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
