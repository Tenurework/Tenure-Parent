import "server-only"
import type { OrgCategory } from "@prisma/client"
import { db, type TxClient } from "@/lib/db"

export const ORG_CATEGORIES: OrgCategory[] = [
  "COMMUNITY",
  "PROFESSIONAL",
  "ORGANIZATION",
  "SOCIAL",
]

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Short club code used to prefix permanent position IDs. */
export function clubCode(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  return words.length === 1
    ? words[0].slice(0, 3).toUpperCase()
    : words.map((w) => w[0].toUpperCase()).join("").slice(0, 5)
}

function seatCode(clubName: string, seatName: string): string {
  const c = clubCode(clubName)
  if (seatName === "President") return `${c}-PRES`
  if (seatName === "Member") return `${c}-MEMB`
  const suffix = seatName
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => (w.toUpperCase() === "VP" ? "VP" : w.slice(0, 4).toUpperCase()))
    .join("-")
    .replace(/[^A-Z-]/g, "")
  return `${c}-${suffix}`
}

/**
 * `Seat.positionCode` is GLOBALLY @unique, but `seatCode` is derived from a
 * club's initials — so two clubs with the same initials (e.g. "Consulting
 * Club" and "Chess Club" both → "CC") generate identical codes and the second
 * charter would hit a P2002 and could never be chartered. Resolve collisions
 * by suffixing a counter (CC-PRES, CC-PRES-2, CC-PRES-3, …) until the code is
 * free. Runs inside the charter transaction so it sees every committed code.
 */
export async function uniquePositionCode(
  tx: TxClient,
  base: string
): Promise<string> {
  let code = base
  let n = 2
  while (await tx.seat.findUnique({ where: { positionCode: code }, select: { id: true } })) {
    code = `${base}-${n}`
    n++
  }
  return code
}

const STARTER_SEATS: { name: string; scope: "PRESIDENT" | "FUNCTIONAL" | "MEMBER" }[] = [
  { name: "President", scope: "PRESIDENT" },
  { name: "VP Finance & Operations", scope: "FUNCTIONAL" },
  { name: "VP Marketing & Communications", scope: "FUNCTIONAL" },
  { name: "VP Events & Partnerships", scope: "FUNCTIONAL" },
  { name: "Member", scope: "MEMBER" },
]

/**
 * Charter a new club with the standard board seats, each with a permanent
 * position code. Shared by the app and the admin console so a club is created
 * the same way everywhere. Returns the created club's slug.
 */
export async function chartClub(
  institutionId: string,
  input: { name: string; category: OrgCategory; description?: string | null },
  actorId: string
): Promise<{ id: string; slug: string }> {
  const name = input.name.trim()
  if (!name) throw new Error("Club name is required")
  if (!ORG_CATEGORIES.includes(input.category)) throw new Error("Pick a category")

  const slug = slugify(name)
  const existing = await db.organization.findUnique({ where: { slug } })
  if (existing) throw new Error("A club with that name already exists")

  return db.$transaction(async (tx: TxClient) => {
    const club = await tx.organization.create({
      data: {
        institutionId,
        name,
        slug,
        category: input.category,
        description: input.description?.trim() || null,
      },
    })
    for (const seat of STARTER_SEATS) {
      const positionCode = await uniquePositionCode(tx, seatCode(name, seat.name))
      // GE-050-002. The role carries the authority; the seat carries the
      // position. Created together because a starter seat is exactly one of
      // each, and a role with no seat would be authority attached to no post.
      await tx.role.create({
        data: {
          organizationId: club.id,
          name: seat.name,
          scope: seat.scope,
          seat: { create: { organizationId: club.id, positionCode } },
        },
      })
    }
    await tx.auditEvent.create({
      data: {
        institutionId,
        organizationId: club.id,
        actorId,
        action: "Club.Chartered",
        resourceType: "Organization",
        resourceId: club.id,
        outcome: "ALLOW",
      },
    })
    return { id: club.id, slug: club.slug }
  })
}
