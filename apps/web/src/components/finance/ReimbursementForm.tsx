"use client"

import { useMemo, useState } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { formatCents, parseMoneyToCents } from "@/lib/finance"
import { submitReimbursement } from "@/app/(app)/orgs/[slug]/finance/actions"

type Line = { id: string; category: string; remainingCents: number }

/**
 * Member-facing reimbursement request with a live BUDGET GUARDRAIL: as you type
 * an amount it compares against the chosen line's remaining budget and warns
 * before you file if it would push the line over. Anyone with an active club
 * seat can file; it routes through approval and, on approval, auto-posts to the
 * ledger (see submitReimbursement + the actOnApproval hook).
 */
export function ReimbursementForm({ slug, lines }: { slug: string; lines: Line[] }) {
  const [lineId, setLineId] = useState(lines[0]?.id ?? "")
  const [amount, setAmount] = useState("")

  const selected = lines.find((l) => l.id === lineId) ?? lines[0]
  const guardrail = useMemo(() => {
    if (!selected) return null
    const cents = parseMoneyToCents(amount)
    if (cents == null || cents <= 0) return null
    const remaining = selected.remainingCents
    if (cents > remaining) {
      return remaining <= 0
        ? `This line is already at or over budget — the reimbursement would deepen the overspend.`
        : `This exceeds the line's remaining budget of ${formatCents(remaining)} by ${formatCents(cents - remaining)}.`
    }
    return null
  }, [amount, selected])

  // All hooks are above this guard (Rules of Hooks); narrows `selected` too.
  if (lines.length === 0 || !selected) return null
  const submit = submitReimbursement.bind(null, slug)

  return (
    <Card>
      <CardHeader
        title="Request a reimbursement"
        subtitle="Get paid back for a club expense. It routes through approval and, once approved, posts to the ledger against the line you pick."
      />
      <form action={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Budget line
          <select
            name="budgetLineId"
            required
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-9 rounded border border-border bg-surface px-2 text-sm text-text-1"
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.category}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Amount
          <input
            name="amount"
            inputMode="decimal"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`h-9 rounded border bg-surface px-2 text-sm text-text-1 ${
              guardrail ? "border-[--warning]" : "border-border"
            }`}
          />
        </label>

        {guardrail ? (
          <p
            className="sm:col-span-2 rounded-md px-3 py-2 text-[13px]"
            style={{ background: "var(--warning-light)", color: "var(--warning)" }}
          >
            ⚠ {guardrail} You can still file it — the approver decides.
          </p>
        ) : (
          <p className="sm:col-span-2 text-[12px] text-text-3">
            {selected.category} has {formatCents(selected.remainingCents)} remaining this year.
          </p>
        )}

        <label className="flex flex-col gap-1 text-xs text-text-2 sm:col-span-2">
          What is this for?
          <input
            name="description"
            required
            maxLength={140}
            placeholder="e.g. Printing for the case competition"
            className="h-9 rounded border border-border bg-surface px-2 text-sm text-text-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2 sm:col-span-2">
          Receipt <span className="text-text-3">(required once document storage is configured)</span>
          <input
            name="receipt"
            type="file"
            className="text-sm text-text-2 file:mr-3 file:rounded file:border-0 file:bg-base file:px-3 file:py-1.5 file:text-sm file:text-text-1"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]"
          >
            Submit request
          </button>
        </div>
      </form>
    </Card>
  )
}
