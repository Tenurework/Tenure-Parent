import "server-only"
import crypto from "node:crypto"
import type { ScopedEvent } from "@/lib/calendar-data"

/**
 * Calendar sync surface.
 *
 * Today Tenure publishes a per-user ICS feed that Outlook / Google / Apple
 * Calendar subscribe to and poll — a credential-free bridge that keeps a
 * student's school calendar in step with Tenure. When Microsoft Graph
 * credentials are provided, a real two-way GraphCalendarSync implements the
 * CalendarSyncProvider below and drops in with no change to callers.
 */

export interface CalendarSyncProvider {
  readonly id: string
  /** Push the user's Tenure events into the external calendar. */
  push?(userId: string, events: ScopedEvent[]): Promise<void>
  /** Pull external events into Tenure (future two-way sync). */
  pull?(userId: string): Promise<void>
}

/** Default: no external push/pull — the ICS feed is the sync path. */
class IcsFeedSync implements CalendarSyncProvider {
  readonly id = "ics-feed"
}

let provider: CalendarSyncProvider = new IcsFeedSync()
export function calendarSync(): CalendarSyncProvider {
  return provider
}
export function setCalendarSyncProvider(p: CalendarSyncProvider) {
  provider = p
}

// ─── Signed calendar tokens (stable per user, no schema change) ───────────────

function secret(): string {
  return process.env.AUTH_SECRET ?? "tenure-dev-calendar-secret"
}

/** A stable, unguessable token embedding the user id — used in the feed URL. */
export function calendarToken(userId: string): string {
  const payload = Buffer.from(userId).toString("base64url")
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("base64url")
  return `${payload}.${mac}`
}

export function verifyCalendarToken(token: string): string | null {
  const [payload, mac] = token.split(".")
  if (!payload || !mac) return null
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return Buffer.from(payload, "base64url").toString()
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

export function eventsToICS(events: ScopedEvent[], calName = "Tenure"): string {
  const now = icsDate(new Date())
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tenure//Student Org OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName)}`,
    "X-PUBLISHED-TTL:PT1H",
  ]
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@tenure`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.startAt)}`,
      `DTEND:${icsDate(e.endAt)}`,
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
