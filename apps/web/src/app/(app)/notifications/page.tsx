import Link from "next/link"
import { redirect } from "next/navigation"
import { Bell, BellOff } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Card, CardHeader } from "@/components/ui/Card"

export const dynamic = "force-dynamic"

export default async function NotificationsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  const notifications = await db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 60,
  })

  // Opening the page marks everything read
  await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })

  return (
    <div className="max-w-screen-md">
      <div className="mb-6">
        <h1 className="text-text-1">Notifications</h1>
        <p className="text-sm text-text-2 mt-1">
          Approvals, roster changes, events, and messages that involve you.
        </p>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <BellOff size={24} className="mx-auto text-text-3" />
            <p className="text-sm text-text-2 mt-3">
              Nothing yet — activity that involves you lands here.
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="p-5 border-b border-border">
            <CardHeader title="Recent" subtitle="Opening this page marks all as read" />
          </div>
          <ul className="divide-y divide-border">
            {notifications.map((n) => {
              const inner = (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <Bell
                    size={14}
                    className={`mt-0.5 shrink-0 ${n.readAt ? "text-text-3" : "text-[--primary]"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${n.readAt ? "text-text-2" : "font-semibold text-text-1"}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-xs text-text-2 mt-0.5">{n.body}</p>}
                    <p className="text-xs text-text-3 mt-0.5">
                      {n.createdAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              )
              return (
                <li key={n.id} className="hover:bg-base transition-colors">
                  {n.href ? (
                    <Link href={n.href} className="block no-underline">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
