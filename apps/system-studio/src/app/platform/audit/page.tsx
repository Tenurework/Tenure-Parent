import {
  applyRetention,
  verifyChain,
  type AuditRecord,
  type ChainVerification,
  type LegalHold,
  type RetentionPlan,
} from "@tenure/audit"

import { ErrorState } from "@/components/states"
import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  type BadgeTone,
  type DataColumn,
} from "@/components/md3"
import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { listFleet, registryConfigured } from "@/lib/registry"
import { PLATFORM_PARTITION, holdsFor, readRecordsFor, retentionDays } from "@/lib/audit-ledger"
import { HoldControls } from "./HoldControls"
import styles from "./audit.module.css"

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
 *
 * ## The shape of the page, and why it is this shape
 *
 * An operator opens this route to learn ONE thing: whether the evidence is
 * still evidence. That answer is the first card, in a sentence, with the
 * instant it was computed for — everything below it is the working. Before,
 * the page opened with a paragraph about hash chains and a six-column table,
 * and the verdict was a pill at the end of a header row.
 *
 * Three things follow from that ordering and are worth stating, because each
 * one used to be wrong here:
 *
 *   * **A chain nobody could read is not an intact chain.** The verdict used to
 *     be computed over `!verification.ok`, which is `true` for a chain whose
 *     read threw — so a table that could not be reached read as "intact". It
 *     now has its own word, `unreadable`, and its own card naming the chain,
 *     what the read said, and what would fix it.
 *   * **The console has to boot without AWS.** `listFleet()` and
 *     `retentionDays()` were both awaited/called bare, so an unreachable table
 *     or a mistyped `AUDIT_RETENTION_DAYS` turned the whole route into a 500 —
 *     including the chain verification, which needs neither of them. A page
 *     that cannot render is a page that cannot report a tamper. Both are now
 *     caught, and the part that cannot be computed says so in the console's own
 *     word for not knowing rather than being guessed at.
 *   * **Every panel says what it is AS OF.** One instant is computed at the top
 *     and every card carries it, because a retention plan and a chain verdict
 *     read off two different clocks are two answers about two different tables.
 */
export const dynamic = "force-dynamic"

/**
 * The word this console uses when it does not know, and the only one.
 *
 * Never an empty cell, never a dash, never a plausible default. Every use below
 * is paired with the sentence that says what would make it known.
 */
const UNKNOWN = "UNKNOWN"

/**
 * A timestamp a reader can compare against a clock, from the ISO string.
 *
 * Sliced rather than formatted through `Intl`: a locale-dependent rendering is
 * a different string on a different machine, and this stamp is the thing an
 * operator quotes in an incident channel. UTC because the estate is.
 */
function asOfLabel(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/**
 * What one chain came back as.
 *
 * `plan` is nullable and `unreadable` is a string, and both are load-bearing:
 * a chain that could not be read has no verification worth showing, and a
 * retention window that could not be parsed has no plan worth showing — and in
 * both cases the honest render is a named absence rather than a zero.
 *
 * Local to this module. It has no other construction site and no other reader,
 * which is why widening it here cannot silently leave a caller behind.
 */
interface ChainReport {
  partition: string
  records: AuditRecord[]
  verification: ChainVerification
  /** Null when the retention window itself is not known. */
  plan: RetentionPlan | null
  holds: LegalHold[]
  /** Set when this chain could not be read at all. */
  unreadable: string | null
}

/* ── Row shapes, one per table ────────────────────────────────────────────────
 *
 * Flat, and built before the markup rather than inside it. Every table on this
 * page is a join of a partition with something inside that partition's report,
 * and doing the join in the JSX is what produced four nested `flatMap`s whose
 * column headers and cells had to be kept in step by hand.
 */

interface ChainRow {
  partition: string
  records: number
  firstSequence: number | null
  ok: boolean
  unchained: number
  activeHolds: number
}

interface BreakRow {
  key: string
  partition: string
  sequence: number | null
  reason: string
  detail: string
  expectedHash: string
  actualHash: string
}

interface GapRow {
  partition: string
  after: number
  before: number
  missing: number
}

interface DuplicateRow {
  partition: string
  sequence: number
  count: number
}

interface RetentionRow {
  partition: string
  expire: number
  retain: number
  heldBack: number
  chainBlocked: number
  anchors: string
}

interface HeldRow {
  key: string
  partition: string
  sequence: number | null
  action: string
  holds: string
}

interface HoldRow {
  partition: string
  id: string
  scope: string
  reason: string
  placedAt: string
  releasedAt: string | null
}

interface UnreadableRow {
  partition: string
  detail: string
}

/**
 * A sequence position, or the honest word for a record that has none.
 *
 * Not a dash. `verifyChain` still hash-checks an unchained record's content,
 * but nothing proves a neighbour of it was not deleted — so "unchained" is a
 * different fact from "position unknown", and an em dash says neither.
 */
function positionOf(sequence: number | null): string {
  return sequence === null ? "unchained" : String(sequence)
}

const CHAIN_COLUMNS: readonly DataColumn<ChainRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  {
    key: "records",
    header: "Records",
    align: "end",
    cell: (r) => <span data-testid={`chain-${r.partition}-records`}>{r.records}</span>,
  },
  {
    key: "first",
    header: "First seq",
    align: "end",
    /*
     * A chain that starts above 0 has been cut — legitimately by retention, or
     * otherwise. Reported rather than judged, because the array alone cannot
     * tell which; "none" is a chain with no sequenced record at all, which is
     * what a partition holding only legal holds looks like.
     */
    cell: (r) => (r.firstSequence === null ? "none" : r.firstSequence),
  },
  {
    key: "verdict",
    header: "Verdict",
    cell: (r) => (
      <span data-testid={`verdict-${r.partition}`}>
        <Badge
          tone={r.ok ? "ok" : "bad"}
          title={
            r.ok
              ? "Every record hashes to what it says and links to the one before it."
              : "At least one record was altered after it was written, or one is missing."
          }
        >
          {r.ok ? "intact" : "BROKEN"}
        </Badge>
      </span>
    ),
  },
  {
    key: "unchained",
    header: "Unchained",
    align: "end",
    cell: (r) => r.unchained,
  },
  { key: "holds", header: "Holds in force", align: "end", cell: (r) => r.activeHolds },
]

const BREAK_COLUMNS: readonly DataColumn<BreakRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  { key: "seq", header: "Seq", align: "end", cell: (r) => positionOf(r.sequence) },
  {
    key: "reason",
    header: "Reason",
    /*
     * The test id and the machine-readable reason live on this cell rather than
     * on the row, because `DataTable` owns the `<tr>` and a primitive that let
     * a caller decorate its rows would be a primitive with a hole in it. The
     * pair is on the cell the attribute is ABOUT, so a reader of the DOM finds
     * `data-break-reason` beside the word it duplicates.
     */
    cell: (r) => (
      <span data-testid={`break-${r.partition}-${r.sequence}`} data-break-reason={r.reason}>
        <Badge tone="bad">{r.reason}</Badge>
      </span>
    ),
  },
  { key: "detail", header: "What", cell: (r) => r.detail },
  { key: "expected", header: "Expected", cell: (r) => <code>{r.expectedHash}</code> },
  { key: "found", header: "Found", cell: (r) => <code>{r.actualHash}</code> },
]

const GAP_COLUMNS: readonly DataColumn<GapRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  { key: "after", header: "After", align: "end", cell: (r) => r.after },
  { key: "before", header: "Before", align: "end", cell: (r) => r.before },
  { key: "missing", header: "Missing", align: "end", cell: (r) => r.missing },
]

const DUPLICATE_COLUMNS: readonly DataColumn<DuplicateRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  { key: "seq", header: "Seq", align: "end", cell: (r) => r.sequence },
  { key: "count", header: "Records", align: "end", cell: (r) => r.count },
]

const RETENTION_COLUMNS: readonly DataColumn<RetentionRow>[] = [
  {
    key: "chain",
    header: "Chain",
    cell: (r) => (
      <span data-testid={`retention-${r.partition}`}>
        <code>{r.partition}</code>
      </span>
    ),
  },
  { key: "expire", header: "Expire", align: "end", cell: (r) => r.expire },
  { key: "retain", header: "Retain", align: "end", cell: (r) => r.retain },
  {
    key: "held",
    header: "Held by a hold",
    align: "end",
    cell: (r) => <span data-testid={`retention-${r.partition}-held`}>{r.heldBack}</span>,
  },
  { key: "blocked", header: "Chain-blocked", align: "end", cell: (r) => r.chainBlocked },
  { key: "anchors", header: "Anchor to keep", cell: (r) => <code>{r.anchors}</code> },
]

const HELD_COLUMNS: readonly DataColumn<HeldRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  { key: "seq", header: "Seq", align: "end", cell: (r) => positionOf(r.sequence) },
  { key: "action", header: "Action", cell: (r) => r.action },
  { key: "holds", header: "Held by", cell: (r) => r.holds },
]

const HOLD_COLUMNS: readonly DataColumn<HoldRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  {
    key: "id",
    header: "Id",
    cell: (r) => (
      <span data-testid={`hold-${r.id}`}>
        <code>{r.id}</code>
      </span>
    ),
  },
  { key: "scope", header: "Scope", cell: (r) => r.scope },
  { key: "reason", header: "Why", cell: (r) => r.reason },
  { key: "placed", header: "Placed", cell: (r) => <code>{r.placedAt}</code> },
  {
    key: "released",
    header: "Released",
    cell: (r) =>
      r.releasedAt === null ? <Badge tone="warn">in force</Badge> : <code>{r.releasedAt}</code>,
  },
]

const UNREADABLE_COLUMNS: readonly DataColumn<UnreadableRow>[] = [
  { key: "chain", header: "Chain", cell: (r) => <code>{r.partition}</code> },
  { key: "detail", header: "What the read said", cell: (r) => <code>{r.detail}</code> },
]

export default async function AuditPage() {
  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const asOf = new Date().toISOString()

  if (!registryConfigured()) {
    return (
      <>
        <h1 className="md3-headline-large">Audit</h1>
        <div className={styles.stack}>
          <Card
            id="verdict"
            container="high"
            level={1}
            headline={`Whether the audit trail is intact is ${UNKNOWN}`}
            headerAside={
              <span data-testid="chain-verdict">
                <Badge tone="warn" title="No ledger was reachable, so no chain was verified.">
                  {UNKNOWN}
                </Badge>
              </span>
            }
            supportingText={
              <>
                Checked at <time dateTime={asOf}>{asOfLabel(asOf)}</time>. This is not an empty
                ledger and it is not an intact one — nothing was read at all, so nothing is known
                either way.
              </>
            }
          >
            <EmptyState
              headline="No ledger to read"
              description={
                "TENANT_TABLE is not set in this process, so there is no registry to read the trail " +
                "from. The chain lives in the same table as the tenants — set TENANT_TABLE to the " +
                "table infrastructure/studio/dynamodb.tf provisions, and this page verifies on the " +
                "next load."
              }
            />
          </Card>
        </div>
      </>
    )
  }

  /*
   * The retention window is policy, and a policy expressed as an unparseable
   * string is a policy nobody is following — `retentionDays()` refuses to guess
   * and throws, which is right. What was wrong was letting that throw take the
   * page down with it: chain verification does not depend on the retention
   * window, and a mistyped environment variable must not be able to hide a
   * tamper.
   */
  let retain: number | null = null
  let retentionProblem: string | null = null
  try {
    retain = retentionDays()
  } catch (err) {
    retentionProblem = err instanceof Error ? err.message : String(err)
  }

  /**
   * One chain per tenant, plus the platform's own.
   *
   * Enumerated from the fleet rather than by scanning for `AUDIT#` partitions:
   * a chain exists for exactly the subjects that can be acted on, and a scan
   * would read every audit row in the table to answer "which chains are there".
   *
   * Caught, because the scan is a live DynamoDB call and this page must still
   * render the platform chain when it fails. A fleet that could not be listed
   * is not a fleet of zero tenants, and the difference is said out loud below.
   */
  let fleetSlugs: string[] = []
  let fleetProblem: string | null = null
  try {
    fleetSlugs = (await listFleet()).map((t) => t.slug)
  } catch (err) {
    fleetProblem = err instanceof Error ? err.message : String(err)
  }
  const partitions = [PLATFORM_PARTITION, ...fleetSlugs]

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
          plan: retain === null ? null : applyRetention(records, { retainDays: retain, asOf }, holds),
          holds,
          unreadable: null,
        }
      } catch (err) {
        return {
          partition,
          records: [],
          verification: verifyChain([]),
          plan: null,
          holds: [],
          unreadable: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  const readable = reports.filter((r) => r.unreadable === null)
  const unreadable = reports.filter((r) => r.unreadable !== null)
  const written = readable.filter((r) => r.records.length > 0 || r.holds.length > 0)
  const broken = readable.filter((r) => !r.verification.ok && r.records.length > 0)

  const totalRecords = readable.reduce((n, r) => n + r.records.length, 0)
  const activeHolds = readable.reduce(
    (n, r) => n + r.holds.filter((h) => h.releasedAt == null).length,
    0,
  )

  /* ── The rows ──────────────────────────────────────────────────────────── */

  const chainRows: ChainRow[] = written.map((r) => ({
    partition: r.partition,
    records: r.records.length,
    firstSequence: r.verification.firstSequence[r.partition] ?? null,
    ok: r.verification.ok,
    unchained: r.verification.unchained,
    activeHolds: r.holds.filter((h) => h.releasedAt == null).length,
  }))

  const breakRows: BreakRow[] = broken.flatMap((r) =>
    r.verification.tampered.map((t) => ({
      key: `${r.partition}-${t.sequence}-${t.reason}`,
      partition: r.partition,
      sequence: t.sequence,
      reason: t.reason,
      detail: t.detail,
      expectedHash: t.expectedHash,
      actualHash: t.actualHash,
    })),
  )

  const gapRows: GapRow[] = broken.flatMap((r) =>
    r.verification.gaps.map((g) => ({
      partition: r.partition,
      after: g.after,
      before: g.before,
      missing: g.missing,
    })),
  )

  const duplicateRows: DuplicateRow[] = broken.flatMap((r) =>
    r.verification.duplicates.map((d) => ({
      partition: r.partition,
      sequence: d.sequence,
      count: d.count,
    })),
  )

  const retentionRows: RetentionRow[] = written
    .filter((r): r is ChainReport & { plan: RetentionPlan } => r.plan !== null)
    .map((r) => ({
      partition: r.partition,
      expire: r.plan.expire.length,
      retain: r.plan.retain.length,
      heldBack: r.plan.heldBack.length,
      chainBlocked: r.plan.chainBlocked.length,
      anchors:
        r.plan.anchors.length === 0
          ? "none — nothing would be cut"
          : r.plan.anchors
              .map((a) => `through #${a.throughSequence} (${a.anchorHash.slice(0, 20)}…)`)
              .join(" "),
    }))

  const heldRows: HeldRow[] = written.flatMap((r) =>
    (r.plan?.heldBack ?? []).map((h) => ({
      key: `${r.partition}-${h.record.sequence}`,
      partition: r.partition,
      sequence: h.record.sequence,
      action: h.record.action,
      // Plural: releasing one hold does not free the record.
      holds: h.holds.join(", "),
    })),
  )

  const holdRows: HoldRow[] = readable.flatMap((r) =>
    r.holds.map((h) => ({
      partition: r.partition,
      id: h.id,
      scope: h.scope?.action ?? "the whole chain",
      reason: h.reason,
      placedAt: h.placedAt,
      releasedAt: h.releasedAt ?? null,
    })),
  )

  const unreadableRows: UnreadableRow[] = unreadable.map((r) => ({
    partition: r.partition,
    detail: r.unreadable!,
  }))

  /* ── The answer ────────────────────────────────────────────────────────── */

  const verdictWord =
    broken.length > 0
      ? `${broken.length} broken`
      : unreadable.length > 0
        ? `${unreadable.length} unreadable`
        : "intact"

  const verdictTone: BadgeTone =
    broken.length > 0 ? "bad" : unreadable.length > 0 ? "warn" : "ok"

  const verdictHeadline =
    broken.length > 0
      ? `${broken.length} of ${written.length} chains no longer verify`
      : unreadable.length > 0
        ? `Every chain that could be read is intact — ${unreadable.length} could not be read`
        : written.length === 0
          ? "Nothing has been recorded through this console yet"
          : `All ${written.length} chains are intact — ${totalRecords} records, none altered and none missing`

  return (
    <>
      <h1 className="md3-headline-large">Audit</h1>

      <div className={styles.stack}>
        {/* ── 1. The answer, before the apparatus that produced it ───────── */}
        <Card
          id="verdict"
          container="high"
          level={1}
          headline={verdictHeadline}
          headerAside={
            <span data-testid="chain-verdict">
              <Badge
                tone={verdictTone}
                title={
                  broken.length > 0
                    ? "At least one record was altered after it was written, or one is missing."
                    : unreadable.length > 0
                      ? "Some chains could not be read, so nothing is known about them."
                      : "Every record hashes to what it says and links to the one before it."
                }
              >
                {verdictWord}
              </Badge>
            </span>
          }
          supportingText={
            <>
              Re-verified from the ledger on this page load, as of{" "}
              <time dateTime={asOf}>{asOfLabel(asOf)}</time>. Every act this console attempts is
              written to a per-subject hash chain before it runs and again when it ends; each
              record hashes over its own content and over the hash of the record before it, so a
              rewritten row and a removed row are both detectable — which
              &ldquo;append-only&rdquo; as a table permission is not.
            </>
          }
        >
          <div className="chips">
            <Chip title="Chains this console could read, out of the subjects that can be acted on.">
              {readable.length} of {reports.length} chains read
            </Chip>
            <Chip title="Records across every chain that could be read.">
              {totalRecords} records
            </Chip>
            <Chip title="Preservation orders placed and not yet released.">
              {activeHolds} holds in force
            </Chip>
            <Chip
              title={
                retain === null
                  ? "AUDIT_RETENTION_DAYS could not be read, so no retention plan was computed."
                  : "How long a record must be kept before retention may plan its expiry."
              }
            >
              retention {retain === null ? UNKNOWN : `${retain} days`}
            </Chip>
            <Chip title="This page renders a plan. It has no control that deletes a record.">
              nothing here deletes anything
            </Chip>
          </div>
        </Card>

        {/* ── 2. What broke, by sequence ─────────────────────────────────── */}
        {broken.length > 0 && (
          <Card
            id="breaks"
            headline={`Where it broke — ${breakRows.length} records by sequence`}
            headerAside={<Badge tone="bad">{breakRows.length} records</Badge>}
            supportingText={
              <>
                As of <time dateTime={asOf}>{asOfLabel(asOf)}</time>.{" "}
                <b>CONTENT_ALTERED</b> means a record no longer hashes to its own recorded hash —
                it was edited after it was written. <b>BROKEN_LINK</b> means the record does not
                follow the one before it: either that one changed, or something between them was
                removed.
              </>
            }
          >
            <div data-testid="break-table">
              <DataTable
                caption={`Broken records — ${breakRows.length} across ${broken.length} chains, as of ${asOfLabel(asOf)}`}
                columns={BREAK_COLUMNS}
                rows={breakRows}
                rowKey={(r) => r.key}
                empty={
                  <EmptyState
                    headline="No broken record"
                    description="Nothing to show here."
                  />
                }
              />
            </div>

            {gapRows.length > 0 && (
              <>
                <h3 className="md3-label-large">Positions the chain never accounts for</h3>
                <div data-testid="gap-table">
                  <DataTable
                    caption={`Missing positions — ${gapRows.length} runs, as of ${asOfLabel(asOf)}`}
                    columns={GAP_COLUMNS}
                    rows={gapRows}
                    rowKey={(r) => `${r.partition}-${r.after}-${r.before}`}
                    empty={
                      <EmptyState
                        headline="No missing position"
                        description="Every sequence between the first and the last is accounted for."
                      />
                    }
                  />
                </div>
              </>
            )}

            {duplicateRows.length > 0 && (
              <>
                <h3 className="md3-label-large">Two records at one position</h3>
                <p className="md3-body-medium">
                  One of them is a rewrite: a chain position is claimed once, and the conditional
                  write that enforces that is in the ledger rather than in this page.
                </p>
                <div data-testid="duplicate-table">
                  <DataTable
                    caption={`Duplicated positions — ${duplicateRows.length}, as of ${asOfLabel(asOf)}`}
                    columns={DUPLICATE_COLUMNS}
                    rows={duplicateRows}
                    rowKey={(r) => `${r.partition}-${r.sequence}`}
                    empty={
                      <EmptyState
                        headline="No duplicated position"
                        description="Every chain position is claimed exactly once."
                      />
                    }
                  />
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── 3. What this page does not know ────────────────────────────── */}
        {(unreadable.length > 0 || fleetProblem !== null || retentionProblem !== null) && (
          <Card
            id="not-known"
            headline="What this page could not read"
            headerAside={<Badge tone="warn">{UNKNOWN}</Badge>}
            supportingText={
              <>
                As of <time dateTime={asOf}>{asOfLabel(asOf)}</time>. Everything below is a
                question this page could not answer, listed rather than rendered as a zero — an
                unread chain is not an intact chain, and an unlisted fleet is not an empty one.
              </>
            }
          >
            {fleetProblem !== null && (
              <>
                <h3 className="md3-label-large">Which chains exist</h3>
                <p className="md3-body-medium">
                  The fleet could not be listed, so the only chain enumerated here is the
                  platform&rsquo;s own. Every tenant chain is {UNKNOWN} — not absent. The read is a
                  DynamoDB <code>Scan</code> of <code>TENANT_TABLE</code>; grant this
                  engine&rsquo;s task role <code>dynamodb:Scan</code> on that table, or make the
                  table reachable, and the chains reappear on the next load.
                </p>
                <ErrorState what="the fleet" detail={fleetProblem} />
              </>
            )}

            {retentionProblem !== null && (
              <>
                <h3 className="md3-label-large">How long a record must be kept</h3>
                <p className="md3-body-medium">
                  <code>AUDIT_RETENTION_DAYS</code> could not be read as a whole number of days, so
                  no retention plan was computed and none is shown below. Chain verification does
                  not depend on it and ran anyway. Set the variable to a whole number of days — or
                  unset it to fall back to the seven-year default — and the plan returns.
                </p>
                <ErrorState what="the retention window" detail={retentionProblem} />
              </>
            )}

            {unreadableRows.length > 0 && (
              <>
                <h3 className="md3-label-large">Chains that could not be read</h3>
                <p className="md3-body-medium">
                  Nothing is known about these {unreadableRows.length} chains: not whether they are
                  intact, not how many records they hold, not what retention would cover. They are
                  excluded from every count above rather than counted as zero.
                </p>
                <div data-testid="unreadable-table">
                  <DataTable
                    caption={`Unreadable chains — ${unreadableRows.length}, as of ${asOfLabel(asOf)}`}
                    columns={UNREADABLE_COLUMNS}
                    rows={unreadableRows}
                    rowKey={(r) => r.partition}
                    empty={
                      <EmptyState
                        headline="Every chain was read"
                        description="No chain refused or failed a read on this load."
                      />
                    }
                  />
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── 4. Chain by chain ──────────────────────────────────────────── */}
        <div data-testid="chain-summary">
          <Card
            id="chains"
            headline="Chain by chain"
            headerAside={
              <Badge tone={broken.length > 0 ? "bad" : "neutral"}>
                {written.length} with records
              </Badge>
            }
            supportingText={
              <>
                One chain per tenant, plus the platform&rsquo;s own, as of{" "}
                <time dateTime={asOf}>{asOfLabel(asOf)}</time>. A first sequence above 0 means the
                chain has been cut — legitimately by retention, or otherwise; the array alone
                cannot tell which, so it is reported rather than judged.
              </>
            }
          >
            <DataTable
              caption={`Chain integrity — ${written.length} chains with records or holds, as of ${asOfLabel(asOf)}`}
              columns={CHAIN_COLUMNS}
              rows={chainRows}
              rowKey={(r) => r.partition}
              empty={
                <EmptyState
                  headline="No act has been recorded"
                  description="Nothing has been attempted through this console since the ledger existed. This is a real absence: the chains were read and they are empty, not refused."
                />
              }
            />
          </Card>
        </div>

        {/* ── 5. Retention, planned and never performed ──────────────────── */}
        <div data-testid="retention-plan">
          <Card
            id="retention"
            headline="Retention plan"
            headerAside={<Badge tone="neutral">nothing is deleted</Badge>}
            supportingText={
              retain === null ? (
                <>
                  Not computed, as of <time dateTime={asOf}>{asOfLabel(asOf)}</time>: the retention
                  window is {UNKNOWN} for the reason given above. No records were classified, so
                  none is shown as expiring.
                </>
              ) : (
                <>
                  What expiry <b>would</b> cover if it ran at{" "}
                  <time dateTime={asOf}>{asOfLabel(asOf)}</time>, against a {retain}-day window.
                  This page performs no deletion and offers no button that does: a hole cut in a
                  hash chain is indistinguishable from someone removing the record that mattered,
                  so expiry stops at the first record that must be kept and everything after it is{" "}
                  <b>chain-blocked</b> — eligible on age, retained because destroying it would
                  destroy the proof that the rest is intact.
                </>
              )
            }
          >
            <div data-testid="retention-table">
              <DataTable
                caption={
                  retain === null
                    ? `Retention plan — not computed, as of ${asOfLabel(asOf)}`
                    : `Retention plan — ${retain}-day window, as of ${asOfLabel(asOf)}`
                }
                columns={RETENTION_COLUMNS}
                rows={retentionRows}
                rowKey={(r) => r.partition}
                empty={
                  retain === null ? (
                    <EmptyState
                      headline={`The retention window is ${UNKNOWN}`}
                      description="No plan was computed, so this table is empty for a reason that has nothing to do with the records. Fix AUDIT_RETENTION_DAYS and the plan returns."
                    />
                  ) : (
                    <EmptyState
                      headline="Nothing is eligible for anything"
                      description="No record is recorded on any readable chain, so there is nothing for the retention window to classify."
                    />
                  )
                }
              />
            </div>

            {heldRows.length > 0 && (
              <>
                <h3 className="md3-label-large">Preserved past retention</h3>
                <p className="md3-body-medium">
                  Past the window and kept anyway, because a preservation order matched. A held
                  record is never in <code>expire</code>, however old it is.
                </p>
                <div data-testid="held-back-table">
                  <DataTable
                    caption={`Records a hold preserves — ${heldRows.length}, as of ${asOfLabel(asOf)}`}
                    columns={HELD_COLUMNS}
                    rows={heldRows}
                    rowKey={(r) => r.key}
                    empty={
                      <EmptyState
                        headline="No record is preserved past retention"
                        description="Nothing past the window is under an active hold."
                      />
                    }
                  />
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ── 6. Legal holds ─────────────────────────────────────────────── */}
        <div data-testid="legal-holds">
          <Card
            id="holds"
            headline="Legal holds"
            headerAside={<Badge tone={activeHolds > 0 ? "info" : "neutral"}>{activeHolds} in force</Badge>}
            supportingText={
              <>
                Preservation orders on record as of{" "}
                <time dateTime={asOf}>{asOfLabel(asOf)}</time>, placements folded with their
                releases. A hold is the one rule that always wins in the plan above, and it is
                released by writing a second row rather than by rewriting the placement.
              </>
            }
          >
            <div data-testid="hold-table">
              <DataTable
                caption={`Legal holds — ${activeHolds} in force of ${holdRows.length} on record, as of ${asOfLabel(asOf)}`}
                columns={HOLD_COLUMNS}
                rows={holdRows}
                rowKey={(r) => `${r.partition}-${r.id}`}
                empty={
                  <EmptyState
                    headline="No preservation order is on record"
                    description="Every readable chain was checked and none carries a hold, so retention is bounded only by the window above. This is a real absence, not a refused read."
                  />
                }
              />
            </div>

            <HoldControls partitions={partitions} />
          </Card>
        </div>
      </div>
    </>
  )
}
