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
  Button,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  Select,
  UnknownState,
  type BadgeTone,
  type DataColumn,
} from "@/components/md3"
import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { listFleet, registryConfigured } from "@/lib/registry"
import {
  PLATFORM_PARTITION,
  holdsFor,
  readRecordsFor,
  retentionDays,
  safeErrorOf,
} from "@/lib/audit-ledger"
import { describeRegistryProtection, tableReadings } from "@/lib/aws/dynamodb-tables"
import type { DynamoDbReadings } from "@/lib/aws/dynamodb-tables"
import {
  describeDeliveryHealth,
  describeLoggingState,
  loggingStateOf,
  trailReadings,
  type TrailReading,
  type TrailReadings,
} from "@/lib/aws/trail"
import { HoldControls } from "./HoldControls"
import {
  asOfLabel,
  chainVerdict,
  distinct,
  exclusionSentence,
  filterEntries,
  mergeChains,
  optionsFor,
  parseEntryFilter,
  projectChain,
  shortDigest,
  type EntryFilter,
  type FilteredEntries,
  type LedgerEntry,
} from "./entries"
import styles from "./audit.module.css"

/**
 * STUDIO-110-005 — the append-only audit ledger.
 *
 * # Who did what, when, and can I prove the record has not been altered?
 *
 * That question is the page, in that order, and the order is the design.
 *
 * ## The verification comes first, because a list is not a ledger
 *
 * The point of a hash chain is that it can be CHECKED. A page that renders
 * entries without verifying them has shown an operator a table they must simply
 * believe — which is exactly what a tampered table looks like. So `verifyChain`
 * runs on every load, over the rows read back out of DynamoDB, and its verdict
 * is the first thing on the page in a sentence that answers the question with a
 * word: yes, no, or not fully.
 *
 * `verifyChain` and `applyRetention` had no caller anywhere in `apps/` before
 * this route existed. A check nobody runs detects a tamper for exactly as long
 * as somebody remembers to run it, which is zero.
 *
 * ## Then the entries, newest first
 *
 * Four facts per row, and they are the four the question asks for: the actor as
 * the ledger recorded them (a principal, never a display name), the action, the
 * target, and how it ended. Newest first, because an operator opens an audit
 * trail to ask what just happened.
 *
 * `OPEN` is the third outcome and the one that matters most: an INTENT row is
 * written BEFORE a mutating call and an OUTCOME row after, so a process that
 * dies mid-flight leaves a durable "somebody started this and we cannot say how
 * it ended". An outcome-only trail leaves silence there, and silence is
 * indistinguishable from nothing having been attempted.
 *
 * ## The filter cannot hide a break
 *
 * A ledger with a filter is a ledger where the most important row on the page is
 * one query away from invisible. `filterEntries` in `./entries.ts` therefore
 * carries a broken entry through EVERY exclusion — the filter and the page cap
 * both — marks it as kept against the filter, and reports `hiddenBroken`, which
 * is computed against the finished output rather than derived from the logic
 * that built it. The page renders that number if it is ever not zero. The
 * invariant has a mutation-proven test; the JSX below only draws it.
 *
 * ## Read once, checked twice
 *
 * Each chain is read ONCE and the same array is handed to `verifyChain`, to the
 * entry projection and to `applyRetention`. Reading twice would let this page
 * report a chain as intact, an entry as verified and a deletion plan as safe
 * over three different reads of the table.
 *
 * ## The plan is never performed
 *
 * `applyRetention` returns a partition of the records and deletes nothing, and
 * nothing on this page deletes anything. Deletion of audit evidence is not a
 * button.
 *
 * ## Three things that used to be wrong here, and are worth naming
 *
 *   * **A chain nobody could read is not an intact chain.** The verdict was once
 *     computed over `!verification.ok`, which is `false` for a chain whose read
 *     threw — so an unreachable table read as "intact". `chainVerdict` now has
 *     `proven`, and it is false whenever anything is broken OR anything could
 *     not be read.
 *   * **The console has to boot without AWS.** `listFleet()` and
 *     `retentionDays()` were both called bare, so an unreachable table or a
 *     mistyped `AUDIT_RETENTION_DAYS` turned the whole route into a 500 —
 *     including the chain verification, which needs neither. A page that cannot
 *     render is a page that cannot report a tamper.
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
 * How many entries the table draws before it starts accounting for what it left
 * out.
 *
 * A chain has no upper bound, and a page that renders every record of a
 * years-old ledger is a page that does not render. The cap is disclosed in the
 * same sentence as the filter, and `filterEntries` seats every broken entry
 * before the cap applies — so a break from three years ago is above the fold of
 * a page of two hundred.
 */
const ENTRY_LIMIT = 200

/**
 * What one chain came back as.
 *
 * `plan` is nullable and `unreadable` is a string, and both are load-bearing: a
 * chain that could not be read has no verification worth showing, and a
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
 * One CloudTrail trail, as this page needs it.
 *
 * `logging` and `digests` are strings rather than booleans because both can be
 * three things — on, off, and not known — and a boolean would force the third
 * into one of the first two. `loggingStateOf` in `lib/aws/trail.ts` owns the
 * vocabulary; this page prints it rather than deciding it.
 */
interface TrailRow {
  name: string
  logging: string
  validation: string
  digests: string
}

/**
 * A sequence position, or the honest word for a record that has none.
 *
 * Not a dash. `verifyChain` still hash-checks an unchained record's content, but
 * nothing proves a neighbour of it was not deleted — so "unchained" is a
 * different fact from "position unknown", and an em dash says neither.
 */
function positionOf(sequence: number | null): string {
  return sequence === null ? "unchained" : String(sequence)
}

/* ── The entries, which are the answer to "who did what, when" ───────────── */

/**
 * The badge tone for how an attempt ended.
 *
 * `OPEN` is `warn` rather than `neutral` on purpose: an act that was begun and
 * never closed is not a neutral fact about the estate, it is a process that
 * disappeared. It is the row an incident review looks for and the one an
 * outcome-only trail does not contain.
 */
/**
 * The part of an entry's test id that identifies WHICH entry.
 *
 * The chain plus the sequence, because that is how an operator and every other
 * assertion on this page name a record — `break-PLATFORM-41`, `verdict-…`. An
 * unchained record has no sequence and cannot borrow the word "unchained",
 * because two of them in one chain would then share an id and a strict locator
 * would match both; it falls back to the head of its own digest, which is unique
 * by construction.
 */
function entryTag(entry: LedgerEntry): string {
  if (entry.sequence !== null) return `${entry.chain}-${entry.sequence}`
  const body = entry.digest.startsWith("sha256:") ? entry.digest.slice(7) : entry.digest
  return `${entry.chain}-unchained-${body.slice(0, 12)}`
}

const OUTCOME_TONE: Readonly<Record<LedgerEntry["outcomeKind"], BadgeTone>> = {
  ALLOW: "ok",
  DENY: "bad",
  OPEN: "warn",
  BEGUN: "neutral",
}

const OUTCOME_MEANING: Readonly<Record<LedgerEntry["outcomeKind"], string>> = {
  ALLOW: "The act was permitted and an outcome was recorded.",
  DENY: "The act was refused or it failed, and the refusal is on the record.",
  OPEN: "An intent was recorded and no outcome ever was. The act was begun; how it ended is not known.",
  BEGUN:
    "The intent recorded before the act ran. It was closed, and the row that closed it says how it ended.",
}

/**
 * What the outcome badge says when a reader hovers or hears it.
 *
 * The pairing is named, not implied. An INTENT row and the OUTCOME row that
 * closes it are two positions in the chain, and an operator reading a row of
 * either kind needs to be able to find the other one — otherwise "begun" is a
 * dead end and "APPLIED" is a success with no record of what was attempted.
 */
function outcomeTitle(entry: LedgerEntry): string {
  const meaning = OUTCOME_MEANING[entry.outcomeKind]
  if (entry.closedBy !== null) {
    return `${meaning} Closed by the record at sequence ${entry.closedBy}.`
  }
  if (entry.resolves !== null) {
    return `${meaning} This closes the intent at sequence ${entry.resolves}.`
  }
  return meaning
}

const ENTRY_COLUMNS: readonly DataColumn<LedgerEntry>[] = [
  {
    key: "when",
    header: "When (UTC)",
    cell: (r) => (
      <time dateTime={r.at} data-testid={`entry-${entryTag(r)}-at`}>
        {asOfLabel(r.at)}
      </time>
    ),
  },
  {
    key: "actor",
    header: "Who",
    /*
     * The principal the ledger recorded, verbatim. Never resolved to a display
     * name: a name is a join against a table that can change, and an audit row
     * that renders "Alex" for a principal that was deleted and re-created under
     * a different person is a row that names the wrong human.
     */
    cell: (r) => <code>{r.actor}</code>,
  },
  { key: "action", header: "Did what", cell: (r) => <code>{r.action}</code> },
  {
    key: "target",
    header: "To what",
    /*
     * The type on its own line, not trailing the id on the same one. `code` is
     * `overflow-wrap: anywhere`, so a target id breaks mid-token in a narrow
     * column and the type then carries on from the tail of that break —
     * `…856 Tenant` read as one string, and the wrapped id's box drawn over the
     * type's. `.cellLines` carries the argument.
     */
    cell: (r) => (
      <span className={styles.cellLines}>
        <code>{r.target}</code>
        <span className="md3-label-small">{r.targetType}</span>
      </span>
    ),
  },
  {
    key: "outcome",
    header: "How it ended",
    cell: (r) => (
      <span data-testid={`entry-${entryTag(r)}-outcome`}>
        <Badge tone={OUTCOME_TONE[r.outcomeKind]} title={outcomeTitle(r)}>
          {r.outcome}
        </Badge>
      </span>
    ),
  },
  { key: "chain", header: "Chain", cell: (r) => <code>{r.chain}</code> },
  { key: "seq", header: "Seq", align: "end", cell: (r) => positionOf(r.sequence) },
  {
    key: "digest",
    header: "Digest ← previous",
    /*
     * Both halves of the link, on the row, in the operator's reading order —
     * because the list is newest first and the record this one links to is
     * therefore BELOW it, not above. Relying on adjacency to make the chain
     * checkable would only work in the order nobody reads.
     *
     * One digest per line, for the same reason the target's type is on its own:
     * two twelve-character hashes and an arrow on one line is a line that wraps,
     * and a wrapped digest with the next one continuing from its tail is two
     * hashes an operator cannot tell apart — the defect `layout.spec.ts` reported
     * here as `d99f435ad625…` drawn over `none — head of the chain`. The arrow
     * stays a text node beside the second digest, so the link is still stated
     * rather than implied by position.
     */
    cell: (r) => (
      <span className={styles.cellLines}>
        <code>{shortDigest(r.digest)}</code>
        <span>
          {"← "}
          <code>{shortDigest(r.previousDigest)}</code>
        </span>
      </span>
    ),
  },
  {
    key: "verified",
    header: "Verified",
    cell: (r) =>
      r.broken === null ? (
        <Badge tone="ok" title="This record hashes to what it says and links to the one before it.">
          verified
        </Badge>
      ) : (
        <span data-testid={`entry-broken-${entryTag(r)}`}>
          <Badge tone="bad" title="This record did not verify. It is listed whatever the filter says.">
            {r.broken}
          </Badge>
        </span>
      ),
  },
]

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
     * on the row, because `DataTable` owns the `<tr>` and a primitive that let a
     * caller decorate its rows would be a primitive with a hole in it. The pair
     * is on the cell the attribute is ABOUT, so a reader of the DOM finds
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

const TRAIL_COLUMNS: readonly DataColumn<TrailRow>[] = [
  { key: "name", header: "Trail", cell: (r) => <code>{r.name}</code> },
  { key: "logging", header: "Recording", cell: (r) => r.logging },
  {
    key: "validation",
    header: "Log-file validation",
    /*
     * The CloudTrail half of this page's question. Digest files are what make a
     * delivered log file tamper-EVIDENT; without them the bucket holds a record
     * that can be rewritten by anyone who can write to the bucket, which is the
     * same defect the chain on this page exists to close on the console's side.
     */
    cell: (r) => r.validation,
  },
  { key: "digests", header: "Last digest", cell: (r) => r.digests },
]

/**
 * One trail's row, with every unknown said out loud.
 *
 * `GetTrailStatus` is a separate call from `DescribeTrails` and is separately
 * refusable, so a trail can be fully described and completely opaque. That is
 * rendered as this console's word for not knowing, with the arm AWS's reader
 * returned — never as "not logging", which is a different and much worse claim.
 */
function trailRowOf(reading: TrailReading, now: Date): TrailRow {
  const status = reading.status
  const known = status.state === "ACTUAL" || status.state === "STALE"

  return {
    name: reading.configuration.name,
    logging: known
      ? describeLoggingState(loggingStateOf(status.value, now))
      : `${UNKNOWN} — cloudtrail:GetTrailStatus came back ${status.state} for this trail, so whether it is recording is not known. It is not a report that it is stopped.`,
    validation: reading.configuration.logFileValidationEnabled
      ? "ON — digest files are written, so a rewritten log file is detectable"
      : "OFF — delivered log files carry no digest, so a rewrite of one is not detectable",
    digests: known
      ? (status.value.latestDigestDeliveryAt ??
        "never — no digest file has been delivered, so there is nothing to validate against")
      : UNKNOWN,
  }
}

/**
 * The filter, as a plain GET form.
 *
 * No `"use client"` anywhere near it. A native form submitting to this same
 * route puts the filter in the URL, which means an operator can paste the exact
 * view they are looking at into an incident channel and the person who opens it
 * sees the same rows. A client-side filter is a view nobody else can be shown.
 *
 * The blank option carries a real meaning here — "do not constrain this field" —
 * rather than the "nothing chosen yet" the `Select` primitive reserves its
 * `placeholder` for. Nothing on this form is `required`, so a blank value cannot
 * pass a validation it was meant to fail; it is an answer, and the one the page
 * defaults to.
 */
function EntryFilterForm({
  filter,
  chains,
  actors,
  actions,
}: {
  filter: EntryFilter
  chains: readonly string[]
  actors: readonly string[]
  actions: readonly string[]
}) {
  return (
    <form method="get" className={styles.filter} data-testid="entry-filter">
      <div className={styles.filterField}>
        <Select
          id="filter-chain"
          name="chain"
          label="Chain"
          defaultValue={filter.chain ?? ""}
          options={[
            { value: "", label: "Any chain" },
            ...chains.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>
      <div className={styles.filterField}>
        <Select
          id="filter-actor"
          name="actor"
          label="Who"
          defaultValue={filter.actor ?? ""}
          options={[
            { value: "", label: "Anyone" },
            ...actors.map((a) => ({ value: a, label: a })),
          ]}
        />
      </div>
      <div className={styles.filterField}>
        <Select
          id="filter-action"
          name="action"
          label="Did what"
          defaultValue={filter.action ?? ""}
          options={[
            { value: "", label: "Any action" },
            ...actions.map((a) => ({ value: a, label: a })),
          ]}
        />
      </div>
      <div className={styles.filterField}>
        <Select
          id="filter-outcome"
          name="outcome"
          label="How it ended"
          defaultValue={filter.outcome ?? ""}
          options={[
            { value: "", label: "Any outcome" },
            { value: "ALLOW", label: "ALLOW — permitted" },
            { value: "DENY", label: "DENY — refused or failed" },
            { value: "OPEN", label: "OPEN — begun, never closed" },
            { value: "BEGUN", label: "begun — the intent of a closed act" },
          ]}
        />
      </div>
      <div className={styles.filterActions}>
        <Button type="submit" variant="filled">
          Apply
        </Button>
        <ButtonLink href="/platform/audit" variant="outlined">
          Clear
        </ButtonLink>
      </div>
    </form>
  )
}

/**
 * The sentence that says what the filter left out, and the alarm if it left out
 * something it must not have.
 *
 * `hiddenBroken` is rendered rather than asserted. An invariant that only exists
 * in a test is one an operator has no way of checking on the screen in front of
 * them, and this page's entire subject is not having to take the software's word
 * for it.
 */
function Exclusions({ result }: { result: FilteredEntries }) {
  return (
    <>
      <p className="md3-body-medium" data-testid="entry-exclusions">
        {exclusionSentence(result)}
      </p>
      {result.hiddenBroken > 0 && (
        <p className="md3-title-medium" data-testid="hidden-broken-alarm" role="alert">
          {result.hiddenBroken} records that failed verification are NOT listed above. This is a
          defect in this page, not a fact about the ledger: a filter must never be able to hide a
          break. Clear the filter to see every entry, and treat the counts on this card as{" "}
          {UNKNOWN} until it is fixed.
        </p>
      )}
    </>
  )
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const asOf = new Date().toISOString()
  const filter = parseEntryFilter(await searchParams)

  if (!registryConfigured()) {
    return (
      <>
        <h1 className="md3-headline-large">Audit</h1>
        <p className={`${styles.lede} md3-body-large`}>
          Who did what, when — and can this console prove the record has not been altered?
        </p>

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
   * Enumerated from the fleet rather than by scanning for `AUDIT#` partitions: a
   * chain exists for exactly the subjects that can be acted on, and a scan would
   * read every audit row in the table to answer "which chains are there".
   *
   * Caught, because the scan is a live DynamoDB call and this page must still
   * render the platform chain when it fails. A fleet that could not be listed is
   * not a fleet of zero tenants, and the difference is said out loud below.
   */
  let fleetSlugs: string[] = []
  let fleetProblem: string | null = null
  try {
    fleetSlugs = (await listFleet()).map((t) => t.slug)
  } catch (err) {
    fleetProblem = err instanceof Error ? err.message : String(err)
  }
  const partitions = [PLATFORM_PARTITION, ...fleetSlugs]

  /*
   * The two facts about this chain's durability that the chain itself cannot
   * carry, read from AWS rather than asserted.
   *
   * A hash chain proves nobody EDITED a record. It proves nothing about the
   * table the records live in — `DeleteTable` takes the whole ledger and leaves
   * a chain of length zero, which verifies perfectly — and nothing about acts
   * taken against the account outside this console. `registryProtection` and
   * CloudTrail's delivery health are the other two halves of "can I prove it",
   * and both come from readers that were written for this estate rather than
   * from anything this page invented.
   *
   * Caught, because the console must keep booting with no AWS credentials at
   * all. Both readers already return `AwsRead` arms for a refused or throttled
   * call — those render through `UnknownState` below with the principal, the
   * action and a pasteable IAM statement — so this catch is for the case where
   * the call could not even be made, and it renders as a named absence rather
   * than taking the chain verification down with it.
   */
  let tables: DynamoDbReadings | null = null
  let trails: TrailReadings | null = null
  let awsProblem: string | null = null
  try {
    ;[tables, trails] = await Promise.all([tableReadings(), trailReadings()])
  } catch (err) {
    awsProblem = safeErrorOf(err)
  }

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

  /* ── The entries ───────────────────────────────────────────────────────── */

  // The same arrays that were verified above. Not a second read.
  const entries = mergeChains(
    readable.map((r) => projectChain(r.partition, r.records, r.verification)),
  )
  const filtered = filterEntries(entries, filter, ENTRY_LIMIT)

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

  const verdict = chainVerdict({
    attempted: reports.length,
    readable: readable.length,
    written: written.length,
    broken: broken.length,
    records: totalRecords,
  })

  return (
    <>
      <h1 className="md3-headline-large">Audit</h1>
      <p className={`${styles.lede} md3-body-large`}>
        Who did what, when — and can this console prove the record has not been altered? Every act
        this console attempts is written to a per-subject hash chain before it runs and again when
        it ends. Each record hashes over its own content and over the hash of the record before it,
        so a rewritten row and a removed row are both detectable — which
        &ldquo;append-only&rdquo; as a table permission is not. The chains are re-verified below on
        every load of this page.
      </p>

      <div className={styles.stack}>
        {/* ── 1. The answer, before the apparatus that produced it ───────── */}
        <Card
          id="verdict"
          container="high"
          level={1}
          headline={verdict.headline}
          headerAside={
            <span data-testid="chain-verdict">
              <Badge
                tone={verdict.tone}
                title={
                  broken.length > 0
                    ? "At least one record was altered after it was written, or one is missing."
                    : unreadable.length > 0
                      ? "Some chains could not be read, so nothing is known about them."
                      : "Every record hashes to what it says and links to the one before it."
                }
              >
                {verdict.word}
              </Badge>
            </span>
          }
          supportingText={
            <>
              Re-verified from the ledger on this page load, as of{" "}
              <time dateTime={asOf}>{asOfLabel(asOf)}</time>.{" "}
              {verdict.proven
                ? "Every record read hashes to what it says and links to the one before it, so the trail below is the trail that was written."
                : "This console cannot currently prove the trail below is the trail that was written. What is unproven, and why, is named in the cards that follow."}
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
            container="high"
            level={1}
            headline={`Where it broke — ${breakRows.length} records by sequence`}
            headerAside={<Badge tone="bad">{breakRows.length} records</Badge>}
            supportingText={
              <>
                As of <time dateTime={asOf}>{asOfLabel(asOf)}</time>. <b>CONTENT_ALTERED</b> means a
                record no longer hashes to its own recorded hash — it was edited after it was
                written. <b>BROKEN_LINK</b> means the record does not follow the one before it:
                either that one changed, or something between them was removed.
              </>
            }
          >
            <div data-testid="break-table">
              <DataTable
                caption={`Broken records — ${breakRows.length} across ${broken.length} chains, as of ${asOfLabel(asOf)}`}
                columns={BREAK_COLUMNS}
                rows={breakRows}
                rowKey={(r) => r.key}
                empty={<EmptyState headline="No broken record" description="Nothing to show here." />}
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
                As of <time dateTime={asOf}>{asOfLabel(asOf)}</time>. Everything below is a question
                this page could not answer, listed rather than rendered as a zero — an unread chain
                is not an intact chain, and an unlisted fleet is not an empty one.
              </>
            }
          >
            {fleetProblem !== null && (
              <>
                <h3 className="md3-label-large">Which chains exist</h3>
                <p className="md3-body-medium">
                  The fleet could not be listed, so the only chain enumerated here is the
                  platform&rsquo;s own. Every tenant chain is {UNKNOWN} — not absent. The read is a
                  DynamoDB <code>Scan</code> of <code>TENANT_TABLE</code>; grant this engine&rsquo;s
                  task role <code>dynamodb:Scan</code> on that table, or make the table reachable,
                  and the chains reappear on the next load.
                </p>
                <ErrorState what="the fleet" detail={fleetProblem} />
              </>
            )}

            {retentionProblem !== null && (
              <>
                <h3 className="md3-label-large">How long a record must be kept</h3>
                <p className="md3-body-medium">
                  <code>AUDIT_RETENTION_DAYS</code> could not be read as a whole number of days, so
                  no retention plan was computed and none is shown below. Chain verification does not
                  depend on it and ran anyway. Set the variable to a whole number of days — or unset
                  it to fall back to the seven-year default — and the plan returns.
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
                  excluded from every count above rather than counted as zero, and their entries are
                  absent from the trail below for the same reason.
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

        {/* ── 4. Who did what, when ──────────────────────────────────────── */}
        <div data-testid="ledger-entries">
          <Card
            id="entries"
            headline="Who did what, when"
            headerAside={
              <Badge tone={filtered.hiddenBroken > 0 ? "bad" : "neutral"}>
                {filtered.shown.length} of {filtered.total} entries
              </Badge>
            }
            supportingText={
              <>
                Every act recorded on every chain this page could read, newest first, as of{" "}
                <time dateTime={asOf}>{asOfLabel(asOf)}</time>. An <b>OPEN</b> row is an act that
                was begun and never closed — an intent with no outcome — which is what a process
                that died mid-flight leaves behind. The digest and the digest it links to are on
                every row, so the chain is checkable from the page and not only from the verdict
                above.
              </>
            }
          >
            <EntryFilterForm
              filter={filter}
              chains={optionsFor(partitions, filter.chain)}
              actors={optionsFor(distinct(entries, (e) => e.actor), filter.actor)}
              actions={optionsFor(distinct(entries, (e) => e.action), filter.action)}
            />

            <Exclusions result={filtered} />

            <div data-testid="entries-table">
              <DataTable
                caption={`Ledger entries — ${filtered.shown.length} of ${filtered.total}, newest first, as of ${asOfLabel(asOf)}`}
                columns={ENTRY_COLUMNS}
                rows={filtered.shown}
                rowKey={(r) => r.key}
                empty={
                  filtered.total === 0 ? (
                    <EmptyState
                      headline="No act has been recorded"
                      description="Nothing has been attempted through this console since the ledger existed. This is a real absence: the chains were read and they are empty, not refused."
                    />
                  ) : (
                    <EmptyState
                      headline="No entry matches this filter"
                      description="Every entry the filter excluded is counted in the sentence above, and none of them failed verification — a break would be listed here whatever the filter said. Clear the filter to see the whole trail."
                    />
                  )
                }
              />
            </div>
          </Card>
        </div>

        {/* ── 5. Chain by chain ──────────────────────────────────────────── */}
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
                chain has been cut — legitimately by retention, or otherwise; the array alone cannot
                tell which, so it is reported rather than judged.
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

        {/* ── 6. What the chain itself cannot prove ──────────────────────── */}
        <div data-testid="beyond-the-chain">
          <Card
            id="durability"
            headline="What the chain itself cannot prove"
            headerAside={<Badge tone="neutral">read from AWS</Badge>}
            supportingText={
              <>
                As of <time dateTime={asOf}>{asOfLabel(asOf)}</time>. A hash chain proves nobody
                edited a record. It proves nothing about the table the records live in — a single{" "}
                <code>DeleteTable</code> takes the whole ledger and leaves a chain of length zero,
                which verifies perfectly — and nothing about acts taken against this account
                outside this console. These are the other two halves of the question at the top of
                the page, and they are read from AWS rather than asserted here.
              </>
            }
          >
            {awsProblem !== null && (
              <>
                <h3 className="md3-label-large">Neither read could be made</h3>
                <p className="md3-body-medium">
                  The AWS readers did not run at all, so both facts below are {UNKNOWN}. Chain
                  verification does not depend on either and ran anyway — everything above this
                  card stands.
                </p>
                <ErrorState what="the AWS-side durability of this ledger" detail={awsProblem} />
              </>
            )}

            {tables !== null && (
              <>
                <h3 className="md3-label-large">The table the chain lives in</h3>
                <p className="md3-body-medium" data-testid="registry-protection">
                  {describeRegistryProtection(tables.registry)}
                </p>
              </>
            )}

            {trails !== null && (
              <>
                <h3 className="md3-label-large">The account&rsquo;s own record</h3>
                <p className="md3-body-medium" data-testid="trail-delivery">
                  {describeDeliveryHealth(trails.delivery)}
                </p>

                {trails.trails.state === "ACTUAL" || trails.trails.state === "STALE" ? (
                  <DataTable
                    caption={`CloudTrail trails — ${trails.trails.value.length}, as of ${asOfLabel(asOf)}`}
                    columns={TRAIL_COLUMNS}
                    rows={trails.trails.value.map((t) => trailRowOf(t, new Date(asOf)))}
                    rowKey={(r) => r.name}
                    empty={
                      <EmptyState
                        headline="No trail was returned"
                        description="The listing succeeded and named no trail."
                      />
                    }
                  />
                ) : trails.trails.state === "EMPTY" ? (
                  <EmptyState
                    headline="No trail exists in this account"
                    description="cloudtrail:DescribeTrails succeeded and returned nothing. This is a real absence: no act taken against this account outside this console is being recorded anywhere, and none can be reconstructed later."
                  />
                ) : (
                  <UnknownState
                    what="the estate's CloudTrail trails"
                    read={trails.trails}
                    id="trail-unknown"
                  />
                )}
              </>
            )}
          </Card>
        </div>

        {/* ── 7. Retention, planned and never performed ──────────────────── */}
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
                  hash chain is indistinguishable from someone removing the record that mattered, so
                  expiry stops at the first record that must be kept and everything after it is{" "}
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

        {/* ── 8. Legal holds ─────────────────────────────────────────────── */}
        <div data-testid="legal-holds">
          <Card
            id="holds"
            headline="Legal holds"
            headerAside={
              <Badge tone={activeHolds > 0 ? "info" : "neutral"}>{activeHolds} in force</Badge>
            }
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
