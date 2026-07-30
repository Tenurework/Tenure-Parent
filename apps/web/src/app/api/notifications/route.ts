import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * Feeds the header notification bell: a small, RBAC-safe endpoint scoped to the
 * signed-in user. GET returns the unread count and the most recent items for
 * the live dropdown; POST marks items read (all, or a specific set).
 *
 * Notifications are created per-user (see src/lib/notify.ts), so "your own"
 * is enforced by construction — every query is filtered by session user id.
 */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ unread: 0, items: [] }, { status: 401 })
  }
  const userId = session.user.id

  // Optional ?limit — the dropdown uses the default 12, the full-history
  // overlay asks for up to 100. Clamp to a sane range regardless of input.
  const limitParam = Number(new URL(request.url).searchParams.get("limit"))
  const take = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.trunc(limitParam)))
    : 12

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true },
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ])

  return NextResponse.json({ unread, items })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => ({}) as Record<string, unknown>)
  const ids = Array.isArray((body as { ids?: unknown }).ids)
    ? ((body as { ids: unknown[] }).ids.filter((x) => typeof x === "string") as string[])
    : undefined

  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  })

  const unread = await db.notification.count({ where: { userId, readAt: null } })
  return NextResponse.json({ ok: true, unread })
}
