import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Card, CardHeader } from "@/components/ui/Card"
import { BackButton } from "@/components/BackButton"
import { createApproval } from "../actions"

export const dynamic = "force-dynamic"

const TYPES = [
  { value: "EVENT", label: "Event proposal" },
  { value: "BUDGET", label: "Budget / spend request" },
  { value: "VENDOR", label: "Vendor engagement" },
  { value: "COMMUNICATION", label: "External communication" },
  { value: "DOCUMENT", label: "Policy / formal document" },
  { value: "EXCEPTION", label: "Policy exception" },
  { value: "ROSTER", label: "Roster change" },
]

export default async function NewApprovalPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  // Clubs where this user holds an ACTIVE seat (can originate requests)
  const seats = await db.roleAssignment.findMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    include: { role: { include: { organization: true } } },
  })
  const orgs = [...new Map(seats.map((s) => [s.role.organization.id, s.role.organization])).values()]

  if (orgs.length === 0) {
    return (
      <div className="max-w-2xl">
        <Card>
          <p className="text-sm text-text-2 py-4 text-center">
            You need an active club role to submit requests.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <BackButton />
      <div className="mb-6">
        <h1 className="text-text-1">New approval request</h1>
        <p className="text-sm text-text-2 mt-1">
          VP and member requests go to your President first, then OSE. President
          requests go straight to OSE.
        </p>
      </div>

      <Card>
        <CardHeader title="Request details" />
        <form action={createApproval} className="space-y-4">
          <label className="block text-xs text-text-2">
            Club
            <select
              name="organizationId"
              required
              className="mt-1 h-9 w-full rounded border border-border px-2 text-sm text-text-1 bg-surface"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-text-2">
            Type
            <select
              name="type"
              required
              className="mt-1 h-9 w-full rounded border border-border px-2 text-sm text-text-1 bg-surface"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-text-2">
            Title
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Spring case competition budget"
              className="mt-1 h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
            />
          </label>

          <label className="block text-xs text-text-2">
            Description
            <textarea
              name="description"
              rows={4}
              placeholder="What, why, and any context the approvers need."
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-text-1 bg-surface placeholder:text-text-3"
            />
          </label>

          <label className="block text-xs text-text-2">
            Amount (optional, for budget/vendor requests)
            <input
              name="amount"
              inputMode="decimal"
              placeholder="1500.00"
              className="mt-1 h-9 w-48 rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
            />
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              name="intent"
              value="submit"
              className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90"
            >
              Submit for approval
            </button>
            <button
              type="submit"
              name="intent"
              value="draft"
              className="h-9 rounded border border-border px-4 text-sm font-medium text-text-2 hover:bg-base"
            >
              Save as draft
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
