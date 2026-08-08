import "server-only"
import crypto from "node:crypto"
import type { ScopedEvent } from "@/lib/calendar-data"
import { formatRecurrenceRule, parseRecurrenceRule } from "@/lib/calendar-recurrence"
import { selectorDigest, type CalendarSelector } from "@/lib/connections/selector-consent"

/**
 * The per-user ICS calendar feed: a signed token, and the document it protects.
 *
 * Tenure publishes ONE WAY. Outlook, Google Calendar and Apple Calendar
 * subscribe to `/api/calendar/ics/<token>` and poll it; events flow out of
 * Tenure and nothing flows back in. There is no Microsoft Graph connector in
 * this repository — `grep -rn graph.microsoft.com apps/web/src` finds nothing —
 * and `packages/platform-config/src/provider-review.ts` records
 * `GRAPH_CALENDAR_REVIEW` at `NOT_SUBMITTED`, which is what the calendar page
 * and the subscribe dialog render their copy from.
 *
 * This header used to end with a sentence claiming that "when Microsoft Graph
 * credentials are provided, a real two-way GraphCalendarSync implements the
 * CalendarSyncProvider below and drops in with no change to callers", above a
 * `CalendarSyncProvider` interface, an `IcsFeedSync` that implemented neither of
 * its two methods, a module-level mutable `provider` singleton with no tenant in
 * its key, and `calendarSync()` / `setCalendarSyncProvider()`. A repository-wide
 * grep found six references to those four symbols and all six were inside this
 * file. "Drops in with no change to callers" was true only because there were no
 * callers. They are deleted; `tests/architecture/no-overstated-connectors.test.mjs`
 * refuses a doc comment that claims a caller nothing calls.
 */

// ─── Signed calendar tokens (WRK-030-006) ────────────────────────────────────

/**
 * `v2.<userId>.<institutionId>.<selectorDigest>.<issuedAt>.<epoch>.<mac>`.
 *
 * The version prefix is first so a format change is a refusal rather than a
 * misparse: a `v1` token handed to this code fails the prefix check instead of
 * having its fields read in the wrong order. That is exactly what happened when
 * WRK-020-005 added the sixth field — every `v1` URL already in a calendar
 * client stops being honoured, which is the correct outcome, because a `v1`
 * token carries no record of what its holder consented to share.
 *
 * What each field buys, against the seven cases WRK-030-006 names, plus the one
 * WRK-020-005 adds:
 *
 *   * `userId` — WRONG-USER. The subject is the payload, so a token cannot name
 *     one person and authenticate another.
 *   * `institutionId` — WRONG-TENANT. The route pins the scope to this value.
 *     Without it the feed resolved the tenant through `actingInstitutionChoice`,
 *     so the SAME token started returning a different institution's events the
 *     moment the holder used the tenant switcher — a cross-tenant disclosure
 *     arriving as a silent 200.
 *   * `selectorDigest` — SILENT EXPANSION (WRK-020-005). The digest of the
 *     selector the holder consented to, from
 *     `src/lib/connections/selector-consent.ts`. The route recomputes it from
 *     the live scope on every poll: a grant that has widened since the URL was
 *     minted serves the INTERSECTION rather than the new, wider set. Without
 *     it, joining a second club silently began publishing that club's events to
 *     whichever third party holds the URL.
 *   * `issuedAt` — EXPIRED. Compared against `CALENDAR_TOKEN_MAX_AGE_MS`.
 *   * `epoch` — REVOKED, which is what ALREADY-CONSUMED means for this
 *     credential. A calendar client polls this URL forever, so the token is
 *     REPLAYED by design and single-use would break the feature. Bumping
 *     `User.calendarTokenEpoch` is the act that stops honouring every token
 *     issued so far.
 *   * `mac` — TAMPERED. HMAC-SHA256 over all six preceding fields, compared
 *     with `timingSafeEqual`. The digest is inside the MAC, so a holder cannot
 *     widen their own consent by editing the URL.
 *
 * WRONG-SESSION has no mechanism here and deliberately so: this credential is
 * used by software that cannot hold a session cookie, which is the entire
 * reason it exists. Binding it to a browser session would make the feed stop
 * working at the next sign-out. `apps/web/src/lib/calendar-sync.test.ts` states
 * that as a case rather than leaving it unmentioned.
 */
const TOKEN_VERSION = "v2"

/** Fields before the MAC, and therefore covered by it. */
const TOKEN_FIELDS = 7

/**
 * How long a minted feed URL stays good.
 *
 * A subscription URL that never expires is a bearer credential with an infinite
 * lifetime sitting in a student's calendar client, in whatever backup that
 * client syncs to. 180 days is longer than an academic term, so a feed added in
 * September survives the year it was added for, and short enough that a URL
 * pasted into a public document stops working. The calendar page mints a fresh
 * one on every visit, so re-subscribing is copying the field again.
 */
export const CALENDAR_TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

/**
 * Tolerance for a token minted a moment "in the future".
 *
 * Clock skew between the process that mints and the process that verifies is
 * real in a multi-instance deployment. A minute is more than enough for NTP-
 * disciplined hosts and far too little to matter against a 180-day window.
 */
const CLOCK_SKEW_MS = 60_000

export interface CalendarTokenClaims {
  userId: string
  institutionId: string
  /**
   * The scope the holder consented to share (WRK-020-005).
   *
   * The IDS, not only their digest. A digest is an equality test: it can say
   * "the live scope is different" and cannot say "wider", so it cannot tell the
   * route which organizations to keep serving. The route needs the consented
   * set to compute the intersection, so the set travels — inside the MAC, so a
   * holder cannot widen their own consent by editing the URL.
   */
  selector: CalendarSelector
  /**
   * `selectorDigest(selector)`, carried alongside it.
   *
   * The MAC already covers both, so this is not a second integrity check
   * pretending to be one. It is here because it is the identifier the re-consent
   * AUDIT RECEIPT records and the value a support engineer compares against a
   * feed URL, and `verifyCalendarToken` refuses a token whose digest and
   * selector disagree — which is what makes those two artifacts provably about
   * the same grant rather than about two things that happen to look alike.
   */
  selectorDigest: string
  issuedAt: Date
  epoch: number
}

/** The selector as it travels in the token: institution comes from its own field. */
interface EncodedSelector {
  o: string[]
  w: boolean
}

function secret(): string {
  return process.env.AUTH_SECRET ?? "tenure-dev-calendar-secret"
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function unb64(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8")
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url")
}

/**
 * Mint a feed token for one user acting in one institution.
 *
 * `institutionId` and `epoch` are required parameters rather than values looked
 * up inside: the one production caller — `apps/web/src/app/(app)/calendar/page.tsx`
 * — is already inside `withTenantScope` and already holds the scope, and a
 * parameter it may omit is one `tsc` cannot make it pass.
 */
export function calendarToken(
  userId: string,
  institutionId: string,
  epoch: number,
  selector: CalendarSelector,
  now: Date = new Date()
): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const encoded: EncodedSelector = {
    o: [...new Set(selector.organizationIds)].sort(),
    w: selector.institutionWide,
  }
  const body = [
    TOKEN_VERSION,
    b64(userId),
    b64(institutionId),
    b64(JSON.stringify(encoded)),
    selectorDigest({ ...selector, institutionId }),
    issuedAt,
    epoch,
  ].join(".")
  return `${body}.${sign(body)}`
}

/**
 * The user id a token NAMES, without checking whether it is genuine.
 *
 * Needed for exactly one thing: looking up the revocation counter that
 * `verifyCalendarToken` then compares against. Reading an unverified field to
 * find the key a signature is checked with is the same move a JWT `kid` header
 * is for, and it is safe for the same reason — nothing is trusted on the
 * strength of it, and a forged subject resolves to an epoch that will not match
 * a signature the forger cannot produce.
 *
 * Named so no caller mistakes it for authentication.
 */
export function calendarTokenSubject(token: string): string | null {
  const parts = token.split(".")
  if (parts.length !== TOKEN_FIELDS + 1 || parts[0] !== TOKEN_VERSION) return null
  const userId = unb64(parts[1])
  return userId.length > 0 ? userId : null
}

/**
 * Verify a feed token against the user's current revocation counter.
 *
 * Returns the claims or `null`. Every refusal is `null` on purpose: a caller
 * that could tell "expired" from "forged" from "revoked" would be an oracle for
 * anybody probing the endpoint, and the route has nothing useful to do with the
 * difference — all three are 403.
 */
export function verifyCalendarToken(
  token: string,
  currentEpoch: number,
  now: Date = new Date()
): CalendarTokenClaims | null {
  const parts = token.split(".")
  if (parts.length !== TOKEN_FIELDS + 1) return null
  if (parts[0] !== TOKEN_VERSION) return null

  const body = parts.slice(0, TOKEN_FIELDS).join(".")
  const presented = Buffer.from(parts[TOKEN_FIELDS])
  const expected = Buffer.from(sign(body))
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    return null
  }

  const userId = unb64(parts[1])
  const institutionId = unb64(parts[2])
  if (!userId || !institutionId) return null

  // The consented selector. Refused rather than defaulted when it will not
  // parse: a token whose consent record is unreadable is one nobody can say the
  // holder agreed to, and defaulting it to "everything the user can see" is the
  // silent expansion this whole item is about.
  let encoded: EncodedSelector
  try {
    const parsed: unknown = JSON.parse(unb64(parts[3]))
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as EncodedSelector).o) ||
      typeof (parsed as EncodedSelector).w !== "boolean" ||
      !(parsed as EncodedSelector).o.every((id) => typeof id === "string")
    ) {
      return null
    }
    encoded = parsed as EncodedSelector
  } catch {
    return null
  }
  const selector: CalendarSelector = {
    institutionId,
    organizationIds: encoded.o,
    institutionWide: encoded.w,
  }

  // A 64-character lowercase hex digest that MATCHES the selector beside it.
  // Shape-checked so a truncated digest is refused rather than compared — an
  // empty pin would equal an empty recomputation and read as UNCHANGED — and
  // cross-checked so the receipt's identifier and the served scope cannot
  // describe two different grants.
  const digest = parts[4]
  if (!/^[0-9a-f]{64}$/.test(digest)) return null
  if (selectorDigest(selector) !== digest) return null

  if (!/^\d+$/.test(parts[5])) return null
  const issuedAt = new Date(Number(parts[5]) * 1000)
  const age = now.getTime() - issuedAt.getTime()
  if (age > CALENDAR_TOKEN_MAX_AGE_MS) return null
  if (age < -CLOCK_SKEW_MS) return null

  if (!/^\d+$/.test(parts[6])) return null
  const epoch = Number(parts[6])
  if (epoch !== currentEpoch) return null

  return { userId, institutionId, selector, selectorDigest: digest, issuedAt, epoch }
}

// ─── ICS generation ───────────────────────────────────────────────────────────

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  if (line.length <= 73) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 73))
  rest = rest.slice(73)
  while (rest.length > 72) {
    parts.push(" " + rest.slice(0, 72))
    rest = rest.slice(72)
  }
  parts.push(" " + rest)
  return parts.join("\r\n")
}

/**
 * The subscription document.
 *
 * A recurring event becomes ONE `VEVENT` carrying an `RRULE`, never one VEVENT
 * per occurrence — that is what a calendar client wants, and it is why
 * `loadScopedEvents` marks its generated occurrences with `occurrenceOf` for
 * this loop to skip. Emitting both would double every meeting in a student's
 * Outlook.
 *
 * The rule is re-serialised through `formatRecurrenceRule(parseRecurrenceRule(...))`
 * rather than copied out of the column, so a stored rule this application cannot
 * itself expand is never forwarded to a subscriber. The feed and Tenure's own
 * week grid then describe the same meetings; a verbatim copy could have them
 * disagree, and a subscriber has no way to notice.
 *
 * KNOWN LIMITATION, stated rather than hidden: `DTSTART` is written as a UTC
 * instant, so a client expanding the rule itself places later occurrences at the
 * first occurrence's UTC offset. Across a daylight-saving boundary that is an
 * hour out from what Tenure's grid shows, which resolves each occurrence in the
 * institution's zone (`calendar-recurrence.ts`). Fixing it means emitting
 * `DTSTART;TZID=` with a `VTIMEZONE` component carrying the zone's transition
 * rules, which this module does not generate.
 */
export function eventsToICS(
  events: ScopedEvent[],
  calName = "Tenure",
  /**
   * WRK-020-005. `X-WR-CALDESC` — the calendar's own description, which Outlook,
   * Google and Apple Calendar all show beside the subscription. It carries no
   * VEVENT, so a subscriber under-receiving because their scope widened FINDS
   * OUT instead of quietly missing events. The route pairs it with a `Link`
   * header naming the page that re-issues the URL.
   */
  description?: string
): string {
  const now = icsDate(new Date())
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tenure//Student Org OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName)}`,
    ...(description ? [fold(`X-WR-CALDESC:${icsEscape(description)}`)] : []),
    "X-PUBLISHED-TTL:PT1H",
  ]
  for (const e of events) {
    // Described already by the master's RRULE, three lines below.
    if (e.occurrenceOf !== null) continue
    const rule = parseRecurrenceRule(e.recurrenceRule)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@tenure`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.startAt)}`,
      `DTEND:${icsDate(e.endAt)}`,
      ...(rule ? [`RRULE:${formatRecurrenceRule(rule)}`] : []),
      fold(`SUMMARY:${icsEscape(e.title)}`),
      fold(`DESCRIPTION:${icsEscape([e.organizationName, e.description].filter(Boolean).join(" — "))}`),
      ...(e.venue ? [fold(`LOCATION:${icsEscape(e.venue)}`)] : []),
      `STATUS:${e.status === "PUBLISHED" || e.status === "APPROVED" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT"
    )
  }
  lines.push("END:VCALENDAR")
  return lines.join("\r\n") + "\r\n"
}
