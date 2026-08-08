import Link from "next/link"

import { applyRetention, verifyChain, type AuditRecord } from "@tenure/audit"

import { EmptyState, ErrorState } from "@/components/states"
import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { listFleet, registryConfigured } from "@/lib/registry"
import { PLATFORM_PARTITION, holdsFor, readRecordsFor, retentionDays } from "@/lib/audit-ledger"
import { HoldControls } from "./HoldControls"

/**
 * STUDIO-110-005 — is the audit trail intact, and what would retention destroy?
 *
 * ## Why a page and not a script
 *
 * `verifyChain` and `applyRetention` existed as code with no caller: nothing in
 * `apps/` reached either, so "verification tooling" and "a retention schedule"
 * were declarations. A hash chain nobody verifies is a hash chain that proves
 * nothing — the tamper it would detect goes undetected for exactly as long as
 * nobody runs the check, and a check that has to be remembered is a check that
 * is not run.
 *
 * So the verification runs on every page load, over the rows read back out of
 * DynamoDB, and reports the break by SEQUENCE — which is what an operator needs
 * to know: not "something is wrong" but "record 41 of rochester's chain no
 * longer hashes to what it says, and 42 does not link to it".
 *
 * ## Read once, checked twice
 *
 * Each chain is read ONCE and the same array is handed to both `verifyChain` and
 * `applyRetention`. Reading twice would let this page report a chain as intact
 * and a deletion plan as safe over two different reads of the table.
 *
 * ## The plan is never performed
 *
 * `applyRetention` returns a partition of the records and deletes nothing, and
 * nothing on this page deletes anything. Deletion of audit evidence is not a
 * button; it is an operator act with an anchor to keep, and the anchors are
 * rendered so that the surviving chain can still be shown to continue the one
 * that was cut.
 */
export const dynamic = "force-dynamic"

interface ChainReport {
  partition: string
  records: AuditRecord[]
  verification: ReturnType<typeof verifyChain>
  plan: ReturnType<typeof applyRetention>
  holds: Awaited<ReturnType<typeof holdsFor>>
  /** Set when this chain could not be read at all. */
  unreadable: string | null
}

export default async function AuditPage() {
  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  if (!registryConfigured()) {
    return (
      <>
        <h1>Audit</h1>
        <EmptyState
          what="audit chains"
          because={
            "TENANT_TABLE is not set, so there is no registry to read the trail from. The chain " +
            "lives in the same table as the tenants (infrastructure/studio/dynamodb.tf)."
          }
        />
      </>
    )
  }

  const asOf = new Date().toISOString()
  const retain = retentionDays()

  /**
   * One chain per tenant, plus the platform's own.
   *
   * Enumerated from the fleet rather than by scanning for `AUDIT#` partitions:
   * a chain exists for exactly the subjects that can be acted on, and a scan
   * would read every audit row in the table to answer "which chains are there".
   */
  const fleet = await listFleet()
  const partitions = [PLATFORM_PARTITION, ...fleet.map((t) => t.slug)]

  const reports: ChainReport[] = await Promise.all(
    partitions.map(async (partition): Promise<ChainReport> => {
      try {
        const [records, holds] = await Promise.all([
          readRecordsFor(partition),
          holdsFor(partition),
        ])
        return {
          partition,
          records,
          verification: verifyChain(records),
          // The holds are passed explicitly. `applyRetention` defaults them to
          // empty, and a plan computed with the default would expire records
          // under an active preservation order while looking entirely correct.
          plan: applyRetention(records, { retainDays: retain, asOf }, holds),
          holds,
          unreadable: null,
        }
      } catch (err) {
        return {
          partition,
          records: [],
          verification: verifyChain([]),
          plan: applyRetention([], { retainDays: retain, asOf }, []),
          holds: [],
          unreadable: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  const written = reports.filter((r) => r.records.length > 0 || r.holds.length > 0)
  const broken = reports.filter((r) => !r.verification.ok && r.records.length > 0)

  return (
    <>
      <h1>Audit</h1>
      <p>
        Every act this console attempts is written to a per-subject hash chain before it runs and
        again when it ends. Each record carries a hash over its own content and the hash of the
        record before it, so a rewritten row and a removed row are both detectable — which
        &ldquo;append-only&rdquo; as a table permission is not.
      </p>

      <section className="system" data-testid="chain-summary">
        <header>
          <h2>Chain integrity</h2>
          <span className={`badge ${broken.length === 0 ? "ok" : "bad"}`} data-testid="chain-verdict">
            {broken.length === 0 ? "intact" : `${broken.length} broken`}
          </span>
        </header>

        {written.length === 0 ? (
          <EmptyState
            what="recorded acts"
            because="No act has been attempted through this console since the ledger existed."
          />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Chain</th>
                <th className="num">Records</th>
                <th className="num">First seq</th>
                <th>Verdict</th>
                <th className="num">Unchained</th>
                <th className="num">Holds</th>
              </tr>
            </thead>
            <tbody>
              {written.map((r) => (
                <tr key={r.partition} data-testid={`chain-${r.partition}`}>
                  <td>{r.partition}</td>
                  <td className="num">{r.records.length}</td>
                  <td className="num">
                    {/* A chain that starts above 0 has been truncated —
                        legitimately by retention, or otherwise. Reported rather
                        than judged, because the array alone cannot tell which. */}
                    {r.verification.firstSequence[r.partition] ?? "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.verification.ok ? "ok" : "bad"}`}
                      data-testid={`verdict-${r.partition}`}
                    >
                      {r.verification.ok ? "intact" : "BROKEN"}
                    </span>
                  </td>
                  <td className="num">{r.verification.unchained}</td>
                  <td className="num">{r.holds.filter((h) => h.releasedAt == null).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reports
          .filter((r) => r.unreadable)
          .map((r) => (
            <ErrorState
              key={r.partition}
              what={`the ${r.partition} chain`}
              detail={r.unreadable!}
            />
          ))}
      </section>

      {/* ── Every break, by sequence ─────────────────────────────────────── */}
      {broken.length > 0 && (
        <section className="system" data-testid="chain-breaks">
          <header>
            <h2>Breaks</h2>
            <span className="badge bad">
              {broken.reduce((n, r) => n + r.verification.tampered.length, 0)}
            </span>
          </header>
          <p>
            <b>CONTENT_ALTERED</b> means a record no longer hashes to its own recorded hash — it was
            edited after it was written. <b>BROKEN_LINK</b> means the record does not follow the one
            before it: either that one changed, or something between them was removed.
          </p>
          <table className="grid" data-testid="break-table">
            <thead>
              <tr>
                <th>Chain</th>
                <th className="num">Seq</th>
                <th>Reason</th>
                <th>What</th>
                <th>Expected</th>
                <th>Found</th>
              </tr>
            </thead>
            <tbody>
              {broken.flatMap((r) =>
                r.verification.tampered.map((t) => (
                  <tr
                    key={`${r.partition}-${t.sequence}-${t.reason}`}
                    data-testid={`break-${r.partition}-${t.sequence}`}
                    data-break-reason={t.reason}
                  >
                    <td>{r.partition}</td>
                    <td className="num">{t.sequence ?? "—"}</td>
                    <td>
                      <span className="badge bad">{t.reason}</span>
                    </td>
                    <td>{t.detail}</td>
                    <td className="id">{t.expectedHash}</td>
                    <td className="id">{t.actualHash}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>

          {broken.some((r) => r.verification.gaps.length > 0) && (
            <>
              <h3>Missing positions</h3>
              <table className="grid" data-testid="gap-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th className="num">After</th>
                    <th className="num">Before</th>
                    <th className="num">Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {broken.flatMap((r) =>
                    r.verification.gaps.map((g) => (
                      <tr key={`${r.partition}-${g.after}-${g.before}`}>
                        <td>{r.partition}</td>
                        <td className="num">{g.after}</td>
                        <td className="num">{g.before}</td>
                        <td className="num">{g.missing}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </>
          )}

          {broken.some((r) => r.verification.duplicates.length > 0) && (
            <>
              <h3>Two records at one position</h3>
              <p>One of them is a rewrite: a chain position is claimed once.</p>
              <table className="grid" data-testid="duplicate-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th className="num">Seq</th>
                    <th className="num">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {broken.flatMap((r) =>
                    r.verification.duplicates.map((d) => (
                      <tr key={`${r.partition}-${d.sequence}`}>
                        <td>{r.partition}</td>
                        <td className="num">{d.sequence}</td>
                        <td className="num">{d.count}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {/* ── Retention, planned and not performed ─────────────────────────── */}
      <section className="system" data-testid="retention-plan">
        <header>
          <h2>Retention plan</h2>
          <span className="badge quiet">{retain} days · nothing is deleted</span>
        </header>
        <p>
          What expiry <b>would</b> cover, computed at {asOf}. This page performs no deletion and
          offers no button that does: a hole cut in a hash chain is indistinguishable from someone
          removing the record that mattered, so expiry stops at the first record that must be kept
          and everything after it is <b>chain-blocked</b> — eligible on age, retained because
          destroying it would destroy the proof that the rest is intact.
        </p>
        <table className="grid" data-testid="retention-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th className="num">Expire</th>
              <th className="num">Retain</th>
              <th className="num">Held by a hold</th>
              <th className="num">Chain-blocked</th>
              <th>Anchor to keep</th>
            </tr>
          </thead>
          <tbody>
            {written.map((r) => (
              <tr key={r.partition} data-testid={`retention-${r.partition}`}>
                <td>{r.partition}</td>
                <td className="num">{r.plan.expire.length}</td>
                <td className="num">{r.plan.retain.length}</td>
                <td className="num">{r.plan.heldBack.length}</td>
                <td className="num">{r.plan.chainBlocked.length}</td>
                <td className="id">
                  {r.plan.anchors.length === 0
                    ? "—"
                    : r.plan.anchors
                        .map((a) => `through #${a.throughSequence} (${a.anchorHash.slice(0, 20)}…)`)
                        .join(" ")}
                </td>
              </tr>
            ))}
            {written.length === 0 && (
              <tr>
                <td colSpan={6}>Nothing is recorded yet, so nothing is eligible for anything.</td>
              </tr>
            )}
          </tbody>
        </table>

        {written.some((r) => r.plan.heldBack.length > 0) && (
          <>
            <h3>Preserved past retention</h3>
            <table className="grid" data-testid="held-back-table">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th className="num">Seq</th>
                  <th>Action</th>
                  <th>Held by</th>
                </tr>
              </thead>
              <tbody>
                {written.flatMap((r) =>
                  r.plan.heldBack.map((h) => (
                    <tr key={`${r.partition}-${h.record.sequence}`}>
                      <td>{r.partition}</td>
                      <td className="num">{h.record.sequence ?? "—"}</td>
                      <td>{h.record.action}</td>
                      {/* Plural: releasing one hold does not free the record. */}
                      <td className="slug">{h.holds.join(", ")}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── Legal holds ──────────────────────────────────────────────────── */}
      <section className="system" data-testid="legal-holds">
        <header>
          <h2>Legal holds</h2>
          <span className="badge">
            {reports.reduce((n, r) => n + r.holds.filter((h) => h.releasedAt == null).length, 0)} in
            force
          </span>
        </header>

        {reports.every((r) => r.holds.length === 0) ? (
          <EmptyState
            what="legal holds"
            because="No preservation order is on record, so retention is bounded only by the window above."
          />
        ) : (
          <table className="grid" data-testid="hold-table">
            <thead>
              <tr>
                <th>Chain</th>
                <th>Id</th>
                <th>Scope</th>
                <th>Why</th>
                <th>Placed</th>
                <th>Released</th>
              </tr>
            </thead>
            <tbody>
              {reports.flatMap((r) =>
                r.holds.map((h) => (
                  <tr key={`${r.partition}-${h.id}`} data-testid={`hold-${h.id}`}>
                    <td>{r.partition}</td>
                    <td>{h.id}</td>
                    <td className="slug">{h.scope?.action ?? "the whole chain"}</td>
                    <td>{h.reason}</td>
                    <td className="id">{h.placedAt}</td>
                    <td className="id">{h.releasedAt ?? "in force"}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}

        <HoldControls partitions={partitions} />
      </section>

      <p className="slug">
        <Link href="/platform">← back to Platform</Link>
      </p>
    </>
  )
}
