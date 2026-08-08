-- WRK-030-002. Bible §5.3's single-use connection launch token.
--
-- Before this table the only thing holding a person's pending intent was a
-- React prop (`MissingConnectionCard.pendingIntent`, whose own comment read
-- "Never persisted anywhere"). "Kept for when this connects" therefore survived
-- a re-render and nothing else: a refresh, a sign-in redirect, or finishing the
-- connect on another device lost the question that caused the whole detour.
--
-- Single-use is enforced by the partial predicate on the claiming UPDATE
-- (`WHERE id = $1 AND "consumedAt" IS NULL`), which takes the row lock and
-- re-evaluates under it — so two concurrent redemptions produce one success and
-- one ALREADY_CONSUMED, rather than a check-then-write race where both read
-- NULL and both proceed.
--
-- The token itself is never stored. `tokenHash` is sha256(token), so a database
-- dump, a slow-query log or a support engineer reading rows yields nothing
-- redeemable.

CREATE TABLE "ConnectionLaunchToken" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "pendingIntent" TEXT,
    "returnPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionLaunchToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectionLaunchToken_tokenHash_key" ON "ConnectionLaunchToken"("tokenHash");
CREATE INDEX "ConnectionLaunchToken_institutionId_expiresAt_idx" ON "ConnectionLaunchToken"("institutionId", "expiresAt");
CREATE INDEX "ConnectionLaunchToken_userId_capabilityKey_idx" ON "ConnectionLaunchToken"("userId", "capabilityKey");

ALTER TABLE "ConnectionLaunchToken"
  ADD CONSTRAINT "ConnectionLaunchToken_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectionLaunchToken"
  ADD CONSTRAINT "ConnectionLaunchToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "ConnectionLaunchToken"."tokenHash" IS
  'WRK-030-002. sha256 of the opaque launch token. The token itself is never stored: it exists only in the URL the person was handed.';
COMMENT ON COLUMN "ConnectionLaunchToken"."pendingIntent" IS
  'WRK-030-002 / Bible 5.2. The person''s own words, held server-side because 5.2 forbids raw prompt content in a redirect URL — a URL travels through history, Referer and access logs.';
COMMENT ON COLUMN "ConnectionLaunchToken"."consumedAt" IS
  'WRK-030-002 / Bible 5.3. Single-use. Written by the same UPDATE that claims the row under WHERE consumedAt IS NULL, never by a separate check-then-write.';
