-- WRK-030-006. A calendar feed token gains a revocation counter.
--
-- The one launch-token-shaped credential this product issues is the signed
-- token in `/api/calendar/ics/<token>`, and before this migration it was
-- `base64url(userId) + '.' + HMAC(AUTH_SECRET)` — a value with no issue time,
-- no tenant, and no way to stop honouring it short of rotating AUTH_SECRET and
-- signing every user out of the application.
--
-- Single-use is the wrong shape for this credential and saying so is the point:
-- Outlook, Google Calendar and Apple Calendar POLL a subscription URL, forever,
-- every few hours. A token consumed on first use would break the only feature
-- it has. What "already consumed" means for a feed is REVOKED — the holder, or
-- an administrator acting for them, decides every token issued so far is dead —
-- and a per-user counter embedded in the token and compared on every request is
-- what expresses that.
--
-- Zero for every existing user, which is true rather than convenient: nobody
-- has revoked anything, so nobody's feed changes when this ships. The first
-- bump is a deliberate act.

ALTER TABLE "User" ADD COLUMN "calendarTokenEpoch" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "User"."calendarTokenEpoch" IS
  'WRK-030-006. Revocation counter for this user''s ICS calendar feed token. The value is signed into every token minted; verifyCalendarToken refuses a token carrying a different one, so incrementing this invalidates every subscription URL already handed out.';
