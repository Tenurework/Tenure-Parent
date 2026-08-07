"use client"

import { Fragment, useState, useTransition } from "react"
import Link from "next/link"
import { ExternalLink, FileText, Store, ArchiveRestore, Plus } from "@/components/ui/icons"
import { Overlay } from "@/components/ui/Overlay"
import { Badge } from "@/components/ui/Badge"
import {
  formatCents,
  ledgerDisclosure,
  LEDGER_KINDS,
  LEDGER_KIND_LABEL,
  type LedgerKindName,
} from "@/lib/finance"
import { postLedgerEntry, reverseLedgerEntry } from "@/app/(app)/orgs/[slug]/finance/actions"

export type LedgerEntryRow = {
  id: string
  kind: LedgerKindName
  amountCents: number
  description: string
  memo: string | null
  occurredAt: string
  approval: { id: string; title: string } | null
  vendor: { id: string; name: string } | null
  document: { id: string; title: string } | null
  /** PAY-120-001. The entry this one reverses, when it is a reversal. */
  reversesId: string | null
  /** The reversal answering this entry, when it has been reversed. */
  reversedById: string | null
}

export type LedgerSources = {
  approvals: { id: string; title: string }[]
  vendors: { id: string; name: string }[]
  documents: { id: string; title: string }[]
}

export type LedgerLine = { id: string; category: string; actualCents: number; budgetedCents: number }

const KIND_VARIANT: Record<LedgerKindName, "default" | "success" | "info" | "warning"> = {
  SPEND: "default",
  REIMBURSEMENT: "success",
  ADJUSTMENT: "info",
  RECEIPT: "success",
  // A reversal is a correction, not a normal posting: it reads differently on
  // purpose, because a reader scanning the line needs to see that a pair
  // cancels rather than that two things happened.
  REVERSAL: "warning",
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export function LedgerDrawer({
  slug,
  line,
  entries,
  sources,
  canManage,
  canReverse,
  merchantLegalName,
  merchantStatementDescriptor,
  isOpen,
  onOpenChange,
}: {
  slug: string
  line: LedgerLine
  entries: LedgerEntryRow[]
  sources: LedgerSources
  canManage: boolean
  /**
   * PAY-150-001. Separate from `canManage`, because they are now separate
   * capabilities: `finance.ledger.post` records a transaction,
   * `finance.ledger.reverse` corrects one. The club president holds the first
   * and not the second, so a single flag would offer them a control the server
   * refuses.
   */
  canReverse: boolean
  /**
   * PAY-040-007. The registered legal name of the entity that sells, and the
   * descriptor a payer would see on a statement. Passed in from the server —
   * the drawer must not invent either, which is exactly what a literal here
   * would be.
   */
  merchantLegalName: string
  merchantStatementDescriptor: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [pending, start] = useTransition()
  const [reversing, setReversing] = useState<string | null>(null)
  const post = postLedgerEntry.bind(null, slug)
  const reverse = reverseLedgerEntry.bind(null, slug)

  // The line's actual IS the sum of these entries — derive it here so it updates
  // live as entries are posted or removed (the stored actualCents is the cache).
  const ledgerActual = entries.reduce((sum, e) => sum + e.amountCents, 0)

  // PAY-020-002 / PAY-040-007. Through the payments port. The responsibility
  // configuration passed here is empty because no club has one recorded yet —
  // and passing an empty one is the point: the port answers "not decided"
  // rather than letting this component invent a merchant of record.
  const disclosure = ledgerDisclosure({
    legalName: merchantLegalName,
    statementDescriptor: merchantStatementDescriptor,
    fundsFlow: "direct",
    responsibility: {},
  })

  return (
    <Overlay
      title={`${line.category} — ledger`}
      description="Every posted transaction behind this line's actual. The actual is the sum of these entries — no hand-typed number to drift."
      size="lg"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {() => (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-base px-4 py-3">
            <Stat label="Actual (from ledger)" value={formatCents(ledgerActual)} />
            <Stat label="Budgeted" value={formatCents(line.budgetedCents)} />
            <Stat label="Entries" value={String(entries.length)} />
          </div>

          {/*
            PAY-040-007. The legal merchant, from the payments port rather than
            from a string in this file. Bible §6 asks for it on every payment
            preview and receipt; Bible §2 forbids implying Tenure is the seller,
            the bank or the holder of funds. Both are satisfied by the sentence
            being GENERATED from the resolved responsibility matrix — which,
            today, is unanswered for every club, so the honest rendering is that
            it has not been decided rather than a confident name.
          */}
          <p className="rounded-lg border border-border bg-base px-4 py-2 text-[13px] text-text-3">
            {disclosure.sentence}
            {disclosure.blockers.length > 0 && (
              <span className="ml-1 text-text-3">
                ({disclosure.blockers.length} responsibility decision
                {disclosure.blockers.length === 1 ? "" : "s"} outstanding.)
              </span>
            )}
          </p>

          {entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-3">
              No transactions posted to this line yet.
              {canManage ? " Post the first one below." : ""}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm tabular">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    {canReverse && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-4 py-2.5 text-text-2">{fmtDate(e.occurredAt)}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={KIND_VARIANT[e.kind]}>{LEDGER_KIND_LABEL[e.kind]}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-text-1">{e.description}</span>
                          {e.memo && <span className="ml-2 text-[13px] text-text-3">{e.memo}</span>}
                          {e.reversedById && (
                            <span className="ml-2 text-[13px] text-text-3">(reversed)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <SourceLink slug={slug} entry={e} />
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${
                            e.amountCents < 0 ? "text-[--primary]" : "text-text-1"
                          }`}
                        >
                          {formatCents(e.amountCents)}
                        </td>
                        {canReverse && (
                          <td className="px-3 py-2.5 text-right">
                            {/* A posted transaction is corrected by an opposite
                                entry, never removed — so there is no delete
                                control here to offer, and a reversal that has
                                already happened cannot happen twice. */}
                            {e.reversesId == null && e.reversedById == null && (
                              <button
                                type="button"
                                aria-label={`Reverse ${e.description}`}
                                disabled={pending}
                                onClick={() => setReversing(reversing === e.id ? null : e.id)}
                                className="text-text-3 hover:text-text-1 disabled:opacity-50"
                              >
                                <ArchiveRestore size={14} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {canReverse && reversing === e.id && (
                        <tr className="border-b border-border bg-base last:border-0">
                          <td colSpan={6} className="px-4 py-3">
                            <form
                              action={(fd) =>
                                start(async () => {
                                  await reverse(fd)
                                  setReversing(null)
                                })
                              }
                              className="flex flex-wrap items-end gap-2"
                            >
                              <input type="hidden" name="id" value={e.id} />
                              <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
                                Why is this being reversed?
                                <input
                                  name="reason"
                                  required
                                  maxLength={500}
                                  placeholder="Posted against the wrong line"
                                  className="h-9 w-full rounded border border-border bg-surface px-2 text-sm normal-case text-text-1"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={pending}
                                className="inline-flex h-9 items-center rounded border border-border px-3 text-sm font-medium text-text-1 hover:bg-surface disabled:opacity-50"
                              >
                                Post reversal
                              </button>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <form
              action={post}
              className="rounded-lg border border-border p-4"
              onSubmit={() => onOpenChange(true)}
            >
              <input type="hidden" name="budgetLineId" value={line.id} />
              <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-text-1">
                <Plus size={14} /> Post a transaction
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Type">
                  <select name="kind" className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1">
                    {LEDGER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LEDGER_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount">
                  <input
                    name="amount"
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1"
                  />
                </Field>
                <Field label="Date">
                  <input
                    name="occurredAt"
                    type="date"
                    defaultValue={today}
                    className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1"
                  />
                </Field>
                <Field label="Vendor">
                  <select name="vendorId" className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1">
                    <option value="">— none —</option>
                    {sources.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description" full>
                  <input
                    name="description"
                    required
                    maxLength={140}
                    placeholder="What was this?"
                    className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1"
                  />
                </Field>
                <Field label="From approval">
                  <select name="approvalId" className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1">
                    <option value="">— none —</option>
                    {sources.approvals.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Receipt (doc)">
                  <select name="documentId" className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text-1">
                    <option value="">— none —</option>
                    {sources.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-9 items-center gap-1.5 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover] disabled:opacity-50"
                >
                  Post entry
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Overlay>
  )
}

function SourceLink({ slug, entry }: { slug: string; entry: LedgerEntryRow }) {
  if (entry.approval) {
    return (
      <Link
        href={`/approvals/${entry.approval.id}`}
        className="inline-flex items-center gap-1 text-[13px] text-text-link no-underline hover:underline"
      >
        <ExternalLink size={12} /> {entry.approval.title}
      </Link>
    )
  }
  if (entry.document) {
    return (
      <Link
        href={`/orgs/${slug}/documents/${entry.document.id}/view`}
        className="inline-flex items-center gap-1 text-[13px] text-text-link no-underline hover:underline"
      >
        <FileText size={12} /> {entry.document.title}
      </Link>
    )
  }
  if (entry.vendor) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-text-2">
        <Store size={12} /> {entry.vendor.name}
      </span>
    )
  }
  return <span className="text-[13px] text-text-3">—</span>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="micro-label">{label}</p>
      <p className="mt-0.5 text-lead font-semibold tabular-nums text-text-1">{value}</p>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-text-3 ${full ? "col-span-2 sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  )
}
