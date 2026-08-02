/**
 * GE-020-005 — before consolidating two sources of one fact, ask them both.
 *
 *   node scripts/duplicate-source-report.mjs
 *   node scripts/duplicate-source-report.mjs --json
 *
 * The item this implements ends "do not delete historical data blindly", and
 * this is the instrument that makes that possible to obey. A migration plan
 * that consolidates `Budget` into `BudgetLine` is safe or catastrophic
 * depending on a number — how many rows are in `Budget` on the database being
 * migrated — and that number is not knowable from the schema, the code, or this
 * repository. It is knowable from a query, against the database in question,
 * run before the migration.
 *
 * So this is deliberately read-only and deliberately not a test. It has no
 * pass/fail of its own beyond the guards below, because "3 rows disagree" is
 * not a failure — on the pilot it may be the expected residue of a year of
 * operation. It is a fact a human needs before signing a migration.
 *
 * Two things it will refuse to do, both learned the hard way elsewhere in this
 * repository:
 *
 *   * Never print a disagreement count without its denominator. "0 mismatches"
 *     and "0 rows examined" are the same output and only one is good news.
 *   * Never omit a family it could not measure. A section that vanishes when a
 *     table is empty reads as "clean".
 */

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient({ log: ["error"] })
const json = process.argv.includes("--json")

const out = []
const say = (s = "") => {
  if (!json) console.log(s)
}

const h = (title, why) => {
  say(`\n${"═".repeat(76)}`)
  say(` ${title}`)
  if (why) for (const line of why.split("\n")) say(` ${line}`)
  say("═".repeat(76))
}

const table = (rows) => {
  if (!rows.length) return say("  (no rows)")
  const cols = Object.keys(rows[0])
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)))
  say("  " + cols.map((c, i) => c.padEnd(w[i])).join("  "))
  say("  " + w.map((n) => "─".repeat(n)).join("  "))
  for (const r of rows) say("  " + cols.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join("  "))
}

const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])))

/** Record a family's measurement so `--json` carries the same facts as the text. */
const record = (family, measurement, rows) => out.push({ family, measurement, rows: num(rows)[0] ?? {} })

// ── person ───────────────────────────────────────────────────────────────────
h(
  "PERSON — User vs DirectoryPerson",
  "Two person tables, joinable only by email address. Both are legitimate: the\n" +
    "directory deliberately cannot be signed in as. What is missing is an\n" +
    "enforced link, so 'who is this' has two answers and no way to reconcile them.",
)
const person = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "User")                                       AS users,
         (SELECT count(*) FROM "DirectoryPerson")                            AS directory_people,
         (SELECT count(*) FROM "User" u JOIN "DirectoryPerson" dp
            ON lower(dp.email) = lower(u.email))                             AS joinable_by_email,
         (SELECT count(*) FROM "User" u WHERE u.email IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "DirectoryPerson" dp WHERE lower(dp.email) = lower(u.email))) AS users_not_in_directory,
         (SELECT count(*) FROM "DirectoryPerson" dp WHERE NOT EXISTS (
            SELECT 1 FROM "User" u WHERE lower(u.email) = lower(dp.email)))  AS directory_without_account`
table(num(person))
record("person", "User vs DirectoryPerson", person)

// ── member / seat ────────────────────────────────────────────────────────────
h(
  "SEAT — RoleAssignment vs SeatHolding",
  "Who holds this seat, asked twice. RoleAssignment keys on User and is what the\n" +
    "application writes; SeatHolding keys on DirectoryPerson, carries the academic\n" +
    "term, and is written only by the seed. Neither is redundant — SeatHolding can\n" +
    "represent a holder who has no account, which is most of the roster — so the\n" +
    "disagreement below is a join gap, not corruption.",
)
const seat = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "RoleAssignment" WHERE status = 'ACTIVE')     AS active_assignments,
         (SELECT count(*) FROM "SeatHolding" WHERE "isCurrent")              AS current_holdings,
         (SELECT count(*) FROM "RoleAssignment" ra WHERE ra.status = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM "SeatHolding" sh
              JOIN "DirectoryPerson" dp ON dp.id = sh."personId"
              JOIN "User" u ON lower(u.email) = lower(dp.email)
             WHERE sh."roleId" = ra."roleId" AND sh."isCurrent" AND u.id = ra."userId")) AS assignment_without_holding,
         (SELECT count(*) FROM "SeatHolding" sh WHERE sh."isCurrent"
            AND NOT EXISTS (SELECT 1 FROM "RoleAssignment" ra
              JOIN "User" u ON u.id = ra."userId"
              JOIN "DirectoryPerson" dp ON lower(dp.email) = lower(u.email)
             WHERE ra."roleId" = sh."roleId" AND ra.status = 'ACTIVE' AND dp.id = sh."personId")) AS holding_without_assignment`
table(num(seat))
record("seat", "RoleAssignment vs SeatHolding", seat)

// ── role ─────────────────────────────────────────────────────────────────────
h(
  "ROLE — durable seats vs the role names copied onto audit rows",
  "ApprovalStep.actorRoleContext, Participant.roleContext and AuditEvent.actorRole\n" +
    "hold a role NAME copied at the time of the action. A value that no longer\n" +
    "matches any Role is NOT drift — it is the snapshot doing its job after a seat\n" +
    "was renamed. Counted so the number is known, and labelled so nobody 'fixes' it.",
)
const role = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "Role")                                        AS role_seats,
         (SELECT count(*) FROM "ApprovalStep" WHERE "actorRoleContext" IS NOT NULL) AS step_snapshots,
         (SELECT count(*) FROM "ApprovalStep" s WHERE s."actorRoleContext" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Role" r WHERE r.name = s."actorRoleContext")) AS step_snapshot_no_live_role,
         (SELECT count(*) FROM "AuditEvent" WHERE "actorRole" IS NOT NULL)    AS audit_snapshots,
         (SELECT count(*) FROM "InstitutionMembership")                       AS institution_roles`
table(num(role))
record("role", "seats vs snapshotted role names", role)

// ── approval ─────────────────────────────────────────────────────────────────
h(
  "APPROVAL — Event.status vs the ApprovalRequest it points at",
  "An event linked to an approval carries the decision twice. These can disagree,\n" +
    "and when they do the UI shows one and the audit trail proves the other.",
)
const approval = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "Event")                                       AS events,
         (SELECT count(*) FROM "Event" WHERE "approvalId" IS NOT NULL)        AS events_with_approval,
         (SELECT count(*) FROM "Event" e JOIN "ApprovalRequest" a ON a.id = e."approvalId"
           WHERE (a.status = 'APPROVED') <> (e.status IN ('APPROVED','PUBLISHED'))) AS decision_disagrees,
         (SELECT count(*) FROM "CollabInterest" WHERE status <> 'PENDING_OSE') AS collab_decided_without_step_history,
         (SELECT count(*) FROM "RoleTransfer" WHERE status <> 'PENDING')       AS transfers_decided_without_step_history`
table(num(approval))
record("approval", "Event.status vs ApprovalRequest.status", approval)

// ── audit ────────────────────────────────────────────────────────────────────
h(
  "AUDIT — three append-only trails, written separately",
  "ApprovalStep records the state machine; AuditEvent records who did what;\n" +
    "OutboxEvent records what downstream should learn. Nothing makes the three\n" +
    "agree, and an approval decision writes to two of them in separate statements.",
)
const audit = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "AuditEvent")                                  AS audit_events,
         (SELECT count(*) FROM "ApprovalStep")                                AS approval_steps,
         (SELECT count(*) FROM "OutboxEvent")                                 AS outbox_events,
         (SELECT count(*) FROM "ApprovalStep" s WHERE NOT EXISTS (
            SELECT 1 FROM "AuditEvent" a
             WHERE a."resourceType" = 'ApprovalRequest' AND a."resourceId" = s."approvalId")) AS steps_with_no_audit_event`
table(num(audit))
record("audit", "ApprovalStep vs AuditEvent vs OutboxEvent", audit)

// ── finance ──────────────────────────────────────────────────────────────────
h(
  "FINANCE — two parallel stacks, and a documented cache",
  "Budget+Transaction and BudgetLine+LedgerEntry model the same money. The first\n" +
    "has no creator anywhere in the codebase. The second documents actualCents as\n" +
    "'the cache of Σ amountCents', and a cache can be wrong.",
)
const finance = await db.$queryRaw`
  SELECT (SELECT count(*) FROM "Budget")                                      AS budgets,
         (SELECT count(*) FROM "Transaction")                                 AS transactions,
         (SELECT count(*) FROM "BudgetLine")                                  AS budget_lines,
         (SELECT count(*) FROM "LedgerEntry")                                 AS ledger_entries,
         (SELECT count(*) FROM "BudgetLine" bl WHERE bl."actualCents" <> COALESCE(
            (SELECT sum(le."amountCents") FROM "LedgerEntry" le WHERE le."budgetLineId" = bl.id), 0)) AS lines_whose_cache_is_stale`
table(num(finance))
record("finance", "Budget/Transaction vs BudgetLine/LedgerEntry", finance)

// ── what a migration must be told ────────────────────────────────────────────
const f = num(finance)[0]
const p = num(person)[0]
const a = num(approval)[0]
const fin = num(audit)[0]

const blockers = []
if (f.budgets > 0 || f.transactions > 0) {
  blockers.push(
    `Budget/Transaction hold ${f.budgets}/${f.transactions} rows on THIS database. ` +
      `The plan in docs/migrations/DUPLICATE-SOURCES.md drops them only when both are 0; ` +
      `export them first (they are the only copy of whatever they hold).`,
  )
}
if (f.lines_whose_cache_is_stale > 0) {
  blockers.push(
    `${f.lines_whose_cache_is_stale} of ${f.budget_lines} budget lines have an actualCents ` +
      `that does not equal the sum of their ledger entries. Reconcile before treating either as authoritative.`,
  )
}
if (a.decision_disagrees > 0) {
  blockers.push(
    `${a.decision_disagrees} of ${a.events_with_approval} approved-linked events disagree with their ApprovalRequest. ` +
      `Decide which is authoritative per row before collapsing the field.`,
  )
}
if (fin.steps_with_no_audit_event > 0) {
  blockers.push(
    `${fin.steps_with_no_audit_event} of ${fin.approval_steps} approval steps have no AuditEvent naming the request. ` +
      `The two trails are written by separate statements; this is the gap that opens.`,
  )
}

h("BEFORE ANY CONSOLIDATION MIGRATION ON THIS DATABASE")
if (blockers.length === 0) {
  say(
    `  Nothing blocking. Measured: ${p.users} users, ${p.directory_people} directory people, ` +
      `${f.budget_lines} budget lines, ${fin.approval_steps} approval steps.`,
  )
  say("  This is a statement about THIS database only. Run it again against the one being migrated.")
} else {
  for (const b of blockers) say(`  • ${b}`)
}
say()

if (json) console.log(JSON.stringify({ families: out, blockers }, null, 2))

await db.$disconnect()

// Exit 0 either way. A blocker is information for a human about to run a
// migration, not a broken build — failing CI because the pilot has real data in
// it would train everyone to pass --force.
