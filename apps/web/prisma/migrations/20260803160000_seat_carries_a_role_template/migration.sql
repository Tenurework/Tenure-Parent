-- GE-051-005 — a seat's authority stops being read from its title.
--
-- `canManageFinance` decided who may edit a budget with a regular expression
-- over the seat's NAME:
--
--     /financ|treasur|\bcfo\b|chief financ|chief operating|\bcoo\b/i
--
-- Bible §"Decisions" 3 forbids exactly this: authority "comes from an active,
-- scoped assignment or explicit delegation, not from a title string". The
-- failure is not hypothetical. A club that calls the seat "Budget Lead" has a
-- person accountable for money who cannot touch it; a club with a "Financial
-- Inclusion Officer" — a diversity seat — has somebody who can. Renaming a seat
-- silently grants or removes spending authority, with no record that anything
-- changed and no date on either side of it.
--
-- `Role` is already documented as "what authorization reads" (GE-050-002). So
-- the authority a seat carries becomes a column on it, naming a role template
-- from `packages/authorization/src/role-templates.ts`.
--
-- The regex survives exactly once, below, as a one-time interpretation of data
-- that already exists. That is a different act from consulting it on every
-- request: it runs under review, its result is visible in a column somebody can
-- correct, and a seat renamed tomorrow keeps the authority it was given.

ALTER TABLE "Role" ADD COLUMN "templateKey" TEXT;

COMMENT ON COLUMN "Role"."templateKey" IS
  'Role template this seat confers, from packages/authorization role-templates. Authority is read from here, never from name.';

-- Backfill, most specific first so a "President of Finance" is a lead rather
-- than an officer: the presidency is the larger authority and the finance
-- template does not contain it.
UPDATE "Role" SET "templateKey" = 'unit.lead'
  WHERE "scope" = 'PRESIDENT';

UPDATE "Role" SET "templateKey" = 'finance.officer'
  WHERE "templateKey" IS NULL
    AND "name" ~* '(financ|treasur|\mcfo\M|chief financ|chief operating|\mcoo\M)';

-- Everything else is an ordinary seat. Deliberately not left NULL: a NULL would
-- have to be read as "no authority" or "unknown", and the two behave
-- differently at every call site that forgets which one it is.
UPDATE "Role" SET "templateKey" = 'unit.member'
  WHERE "templateKey" IS NULL;

-- Every row now says what it carries, and nothing may be inserted that does
-- not. The default is the smallest bundle: a seat created by a path that has
-- not been taught about templates confers the least, not the most.
ALTER TABLE "Role" ALTER COLUMN "templateKey" SET DEFAULT 'unit.member';
ALTER TABLE "Role" ALTER COLUMN "templateKey" SET NOT NULL;

CREATE INDEX "Role_templateKey_idx" ON "Role"("templateKey");
