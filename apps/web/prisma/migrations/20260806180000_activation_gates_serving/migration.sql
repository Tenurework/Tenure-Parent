-- The cell learns whether a tenant may be served, so ACTIVATING does something.
--
-- `executeStep("ACTIVATING")` returned this sentence and nothing else:
--
--   "Routing for /<slug> switched on. This is the first moment a user can reach
--    the system, which is why it is a separate, approved act."
--
-- Nothing switched. Nothing in `apps/web` read a tenant lifecycle state at all —
-- `grep -rn "TenantState" apps/web/src` finds no reader — so a tenant became
-- reachable the moment `reconcile` created its Institution row. That happens at
-- MIGRATING, one state and one approval BEFORE the act that calls itself the
-- first moment a user can reach the system.
--
-- The approval on READY → ACTIVATING was therefore guarding something that had
-- already happened, which is worse than no gate: a gate nobody can see is open
-- is one people plan around.
--
-- `serving` is now carried on the digest-covered deployment manifest, written
-- here by the reconciler, and read by `resolveTenant`, which refuses a tenant
-- that is not serving.

ALTER TABLE "Institution" ADD COLUMN "serving" BOOLEAN;

COMMENT ON COLUMN "Institution"."serving" IS
  'Whether this cell may resolve the tenant for users. Written by the reconciler from the signed deployment manifest; ACTIVATING is what publishes one that sets it true.';

-- Every institution that already exists is already being served, and has been
-- for the whole life of the pilot. Backfilling them to true states that fact
-- rather than changing it; backfilling to false would take a live tenant off
-- the air to satisfy a column added afterwards.
--
-- This is the one place the default runs in the permissive direction, and it is
-- correct precisely because it is a statement about the past.
UPDATE "Institution" SET "serving" = TRUE WHERE "serving" IS NULL;

ALTER TABLE "Institution" ALTER COLUMN "serving" SET NOT NULL;

-- NO DEFAULT, deliberately.
--
-- A default is what a row gets when nobody said. For every institution created
-- from here on, "nobody said" must not silently mean "serve it" — the whole
-- defect was a tenant being served because nothing had decided otherwise. The
-- reconciler always supplies the value from the manifest, so an insert that
-- omits it is a caller that has not been taught about activation, and it fails
-- loudly rather than opening the tenant.
