-- GE-050-002. A seat is not a role.
--
-- `Role` carried three things at once: a permission scope, an organization-
-- scoped record, and a durable position. The schema comment said as much —
-- "Permanent position ID — the seat's identity outlives every holder" — while
-- the model kept that identity in the same row every authorization check reads.
--
-- Live consequences: renaming a position edited the row authorization reads,
-- and a seat's history attached to a record that also defines permissions, so
-- retiring the position meant considering who it would deauthorise.
--
-- The split is 1:1 with existing rows, so this creates, backfills and drops in
-- ONE migration. Two migrations would leave a window where both `Role` and
-- `Seat` carry the same four columns — two records of one fact, which is the
-- shape of the drift this repository has already had to repair once.

CREATE TABLE "Seat" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    -- The role whose scope this position carries. Unique: one seat per role
    -- today, which is exactly what the backfill produces. A second seat sharing
    -- a role is a real future case and lifting this is a deliberate migration,
    -- not something that happens by accident.
    "roleId"         TEXT NOT NULL,
    "positionCode"   TEXT,
    "positionNote"   TEXT,
    "vacancyNote"    TEXT,
    "seatOrder"      INTEGER,
    -- Effective-dated, because a position is created and can be retired. A
    -- retired seat is not deleted: its history stays answerable.
    "effectiveFrom"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "retiredAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Seat_roleId_key" ON "Seat"("roleId");
CREATE UNIQUE INDEX "Seat_positionCode_key" ON "Seat"("positionCode");
CREATE INDEX "Seat_organizationId_idx" ON "Seat"("organizationId");

ALTER TABLE "Seat" ADD CONSTRAINT "Seat_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one seat per existing role, carrying the position identity across.
--
-- `createdAt` is preserved from the role rather than set to now, because the
-- position is as old as the row it is being lifted out of — a seat that claims
-- to have been created during a migration would misdate every history that
-- hangs off it.
INSERT INTO "Seat" (
    "id", "organizationId", "roleId",
    "positionCode", "positionNote", "vacancyNote", "seatOrder",
    "effectiveFrom", "createdAt", "updatedAt"
)
SELECT
    'seat_' || "id",
    "organizationId",
    "id",
    "positionCode", "positionNote", "vacancyNote", "seatOrder",
    "createdAt", "createdAt", CURRENT_TIMESTAMP
FROM "Role";

-- Dropped in the same migration. There is never a moment when both tables
-- carry the position.
DROP INDEX IF EXISTS "Role_positionCode_key";
ALTER TABLE "Role" DROP COLUMN "positionCode";
ALTER TABLE "Role" DROP COLUMN "positionNote";
ALTER TABLE "Role" DROP COLUMN "vacancyNote";
ALTER TABLE "Role" DROP COLUMN "seatOrder";
