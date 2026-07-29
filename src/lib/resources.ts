/**
 * Board resources — the forms, guides and policies officers actually need,
 * routed to the seat that needs them.
 *
 * Every board member used to keep these in a bookmark folder, a Padlet, or
 * their predecessor's head. Holding them against the position code means they
 * survive the handoff.
 *
 * ── Where the data lives ────────────────────────────────────────────────────
 * Resources are `Resource` rows owned by the institution (see
 * prisma/schema.prisma and src/lib/resources-data.ts). They used to be a
 * hardcoded array in this file and nothing else, which meant nobody could
 * publish one: adding a form required a pull request and a deploy, and the OSE
 * Director — who owns the board-resource programme — had no Add button at all.
 *
 * This module is now types, labels and pure seat logic only. The launch content
 * lives in scripts/resources-data.mjs and is loaded by the seeder; nothing here
 * is read at request time.
 */
import type { ResourceKind } from "@prisma/client"

export type { ResourceKind }

export type SeatKey =
  | "ALL"
  | "PRESIDENT"
  | "VP_FINANCE"
  | "VP_EVENTS"
  | "VP_MARKETING"
  | "MBA_REP"
  | "OSE"

export const SEAT_KEYS: SeatKey[] = [
  "ALL",
  "PRESIDENT",
  "VP_FINANCE",
  "VP_EVENTS",
  "VP_MARKETING",
  "MBA_REP",
  "OSE",
]

export const RESOURCE_KINDS: ResourceKind[] = ["FORM", "GUIDE", "POLICY", "TOOL", "CHECKLIST"]

/** The app-level shape of a resource, as rendered. */
export type Resource = {
  id: string
  /** Stable slug — survives edits, used for links and seeding. */
  key: string
  title: string
  description: string
  /** External link, or an internal Tenure route */
  href: string
  external: boolean
  /**
   * False while the internal page is still being built. Unready resources
   * render as inert cards — a listed-but-dead link is worse than an honest
   * "not yet".
   */
  ready: boolean
  kind: ResourceKind
  seats: SeatKey[]
  /** Hard rule surfaced next to the link, e.g. a lead time */
  rule?: string | null
  sortOrder: number
}

export const SEAT_LABELS: Record<SeatKey, string> = {
  ALL: "Every board member",
  PRESIDENT: "President",
  VP_FINANCE: "VP Finance & Operations",
  VP_EVENTS: "VP Events & Partnerships",
  VP_MARKETING: "VP Marketing & Communications",
  MBA_REP: "MBA First Year Rep",
  OSE: "Ainslie OSE",
}

export const KIND_LABELS: Record<ResourceKind, string> = {
  FORM: "Form",
  GUIDE: "Guide",
  POLICY: "Policy",
  TOOL: "Tool",
  CHECKLIST: "Checklist",
}

/** Narrow an arbitrary string to a SeatKey, for form input and stored values. */
export function isSeatKey(value: string): value is SeatKey {
  return (SEAT_KEYS as string[]).includes(value)
}

/**
 * Maps a seat name from the OSE roster to the resource audience it belongs to.
 * Titles vary across clubs ("VP of Finance and Operations", "VP Finance &
 * Operations", "President (Oversees Finances)"), so match on intent.
 */
export function seatKeysForRole(roleName: string): SeatKey[] {
  const n = roleName.toLowerCase()
  const keys: SeatKey[] = ["ALL"]

  const isPresident = /president|managing director|chief operating/.test(n)
  if (isPresident) keys.push("PRESIDENT")

  // A president who explicitly covers a function inherits that function's
  // resources — small boards double up constantly.
  if (/financ|operations|treasur/.test(n)) keys.push("VP_FINANCE")
  if (/event|partnership/.test(n)) keys.push("VP_EVENTS")
  if (/marketing|communicat|social media/.test(n)) keys.push("VP_MARKETING")
  if (/mba rep|1y mba|first year rep/.test(n)) keys.push("MBA_REP")

  return [...new Set(keys)]
}

/** Filter a resource list to a set of seats, most specific first. */
export function resourcesForSeats(resources: Resource[], seats: SeatKey[]): Resource[] {
  const set = new Set(seats)
  return resources
    .filter((r) => r.seats.some((s) => set.has(s)))
    .sort((a, b) => {
      // Seat-specific resources outrank the universal ones
      const aGeneral = a.seats.includes("ALL") ? 1 : 0
      const bGeneral = b.seats.includes("ALL") ? 1 : 0
      return aGeneral - bGeneral || a.sortOrder - b.sortOrder
    })
}
