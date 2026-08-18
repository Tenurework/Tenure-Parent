#!/usr/bin/env node
/**
 * EXT-100 — who is in command, what the plan set is, and what activation refuses.
 *
 * Companion to `tools/cutover-command-center.mjs`, which runs §12.4–§12.9 over a
 * worked cutover. This one runs the three the other does not:
 *
 *   · EXT-100-002 — §12.2's command roster, by durable seat;
 *   · EXT-100-003 — §12.3's six plan levels and the joins between them;
 *   · EXT-100-008 — §12.7's activation, progressive change, validation, cleanup.
 *
 * Same contract as its companion. The scenarios are declared here ONCE and read
 * twice: this generator writes `docs/architecture/cutover-command-authority.md`,
 * and `tests/architecture/ext-cutover-command-authority.test.mjs` re-runs them
 * through the same three modules and asserts both the verdicts and that the
 * committed document is what the engine produces today. §12.1's line is the one
 * this arrangement answers to — cutover "never becomes an unchecked spreadsheet
 * with stale copies", and a hand-maintained document of the rules is one.
 *
 * These are SPECIFICATION scenarios, not tenant data. Every occupant is a role
 * name rather than a person, every contact is a channel rather than an address,
 * the tenant slug is `example-*`, and nothing here names a bank, a provider
 * account, a credential or a real go-live date.
 *
 *   node tools/cutover-command-authority.mjs           writes the document
 *   node tools/cutover-command-authority.mjs --check    exits 1 if it is stale
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  COMMAND_SEATS,
  REQUIRED_SEAT_FACTS,
  TERMINAL_ESCALATION,
  contactMatrix,
  escalationChain,
  rosterProblems,
} from "../packages/provisioning/src/cutover-command-roles.mjs"
import {
  COMMUNICATION_ELEMENTS,
  DECISION_ELEMENTS,
  PLAN_LEVELS,
  STRATEGY_ELEMENTS,
  levelCoverage,
  planProblems,
} from "../packages/provisioning/src/cutover-plan-levels.mjs"
import {
  ACTIVATION_MANIFESTS,
  ISOLATION_ASSERTIONS,
  PROGRESSIVE_CHANGES,
  VALIDATION_CHECKS,
  activationCommandProblems,
  activationVerdict,
  progressiveChangeProblems,
  smokeProblems,
  validationProblems,
} from "../packages/provisioning/src/cutover-activation.mjs"
import { TASKS } from "./cutover-command-center.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const DOC = "docs/architecture/cutover-command-authority.md"

export const TENANT = "example-district"

/**
 * Every scope §12.2 qualifies "as applicable" is applicable to this worked
 * cutover, so the roster below has to staff all 23 seats rather than 17.
 *
 * A fixture that declared half the scopes inapplicable would prove the easy half
 * of the rule — that unstaffed seats are found — and never exercise the other
 * half, which is that a seat staffed for work nobody is doing is also a finding.
 */
export const APPLICABLE_SCOPES = Object.freeze([
  "integration",
  "payroll",
  "banking",
  "finance",
  "relay",
  "infrastructure",
])

/** A follow-the-sun rota that tiles the 24-hour command day with no gap. */
const ROTA = Object.freeze([
  Object.freeze({ from: "00:00", to: "08:00", occupant: "APAC on-call", zone: "UTC+09" }),
  Object.freeze({ from: "08:00", to: "16:00", occupant: "EMEA on-call", zone: "UTC+01" }),
  Object.freeze({ from: "16:00", to: "00:00", occupant: "AMER on-call", zone: "UTC-05" }),
])

/**
 * One roster row, with §12.2's seven facts filled from defaults that are
 * complete rather than plausible.
 *
 * As in the companion generator's `task()`, the defaults exist so that each
 * refusal scenario overrides exactly ONE fact — which is what keeps a scenario
 * from proving two things at once.
 */
const seat = (key, over = {}) => ({
  seat: key,
  occupant: `${key} occupant`,
  backup: `${key} deputy`,
  authority: `decides matters delegated to ${key} by the cutover commander`,
  handoff: "verbal handover on the command bridge plus a written entry in the decision log",
  coverage: ROTA,
  contact: `bridge://cutover/${key}`,
  escalation: "cutover-commander",
  decisionRights: [`${key} scope`],
  ...over,
})

/** All 23 of §12.2's seats, staffed. The authority seat escalates to nobody. */
export const ROSTER = {
  tenant: TENANT,
  seats: COMMAND_SEATS.map((s) =>
    seat(
      s.key,
      s.key === "executive-sponsor"
        ? { escalation: TERMINAL_ESCALATION, authority: "go-live authority; the decision no other seat may take" }
        : s.key === "cutover-commander"
          ? { escalation: "executive-sponsor", authority: "runs the cutover; may pause, may not release" }
          : {},
    ),
  ),
}

// ── EXT-100-003: the six plan levels ────────────────────────────────────────

export const PLAN = {
  strategy: {
    scope: "finance, HR and identity for one district; payroll remains with the certified provider",
    approach: "single big-bang activation with a read-only legacy reference window",
    freeze: "hard freeze on source masters at T-1; soft freeze with delta capture on transactions",
    coexistence: "legacy remains query-only for 90 days; no dual write outside the approved directory",
    migration: "extract, transform, load and reconcile per the migration factory, rehearsed twice",
    activation: "protected idempotent command bound to the approved manifests, progressive routing",
    rollbackPhilosophy: "reverse until the conversion load; forward-recover past it, by board decision",
    support: "hypercare tier 1 for 30 days with the command bridge kept open for the first week",
    successMeasures: "sign-in success rate, day-one transaction completion, reconciliation variance",
  },
  integratedPlan: [
    { id: "readiness-baseline", workstream: "program", phase: "PREPARATION", dependsOn: [] },
    { id: "config-baselined", workstream: "configuration", phase: "BUILD", dependsOn: ["readiness-baseline"] },
    { id: "conversion-rehearsed", workstream: "migration", phase: "REHEARSAL", dependsOn: ["config-baselined"] },
    { id: "command-rehearsed", workstream: "cutover", phase: "REHEARSAL", dependsOn: ["conversion-rehearsed"] },
    { id: "go-live", workstream: "cutover", phase: "CUTOVER", dependsOn: ["command-rehearsed"] },
    { id: "hypercare-exit", workstream: "service", phase: "HYPERCARE", dependsOn: ["go-live"] },
  ],
  runbook: { checkedBy: "cutover-runbook.mjs", tasks: TASKS.length },
  contactMatrix: { checkedBy: "cutover-command-roles.mjs", seats: COMMAND_SEATS.length },
  communicationsPlan: [
    {
      audience: "all staff",
      channel: ["email", "in-product banner"],
      template: "template://cutover/staff-notice",
      trigger: "T-7, T-1, and at business release",
      owner: "communications-support-lead",
      translations: "English and Spanish, reviewed by the district",
      accessibility: "plain-language, screen-reader checked, no colour-only status",
      approval: "cutover-commander countersigns each send",
    },
    {
      audience: "command bridge",
      channel: ["bridge"],
      template: "template://cutover/bridge-status",
      trigger: "every 30 minutes through the T0 window",
      owner: "scribe",
      translations: "not applicable; bridge language is English by roster agreement",
      accessibility: "written status posted alongside every verbal update",
      approval: "cutover-commander",
    },
    {
      audience: "external providers",
      channel: ["email"],
      template: "template://cutover/provider-notice",
      trigger: "T-7 and on any integration enablement change",
      owner: "integration-lead",
      translations: "English",
      accessibility: "plain-language",
      approval: "technical-release-lead",
    },
  ],
  decisionLog: [
    {
      id: "DEC-001",
      options: ["big-bang activation", "phased by module"],
      evidence: "evidence://cutover/rehearsal-2",
      authority: "executive-sponsor",
      timestamp: "2026-08-14T15:30:00Z",
      rationale: "phasing needs a dual write the reconciliation owners could not prove",
      affectedTasks: ["activation", "conversion-load"],
      followUp: "re-check at the T-7 no-surprise review",
    },
    {
      id: "DEC-002",
      options: ["reverse to legacy", "forward-recover"],
      evidence: "evidence://cutover/rollback-rehearsal",
      authority: "rollback-authority",
      timestamp: "2026-09-01T09:00:00+01:00",
      rationale: "past the conversion load the reversal loses same-day entries",
      affectedTasks: ["conversion-load"],
      followUp: "board reconfirms at go/no-go",
    },
  ],
}

// ── EXT-100-008: activation ─────────────────────────────────────────────────

const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`

export const ACTIVATION_COMMAND = {
  idempotencyKey: "cutover-example-district-2026-09-15-activation",
  protected: true,
  approvedBy: "executive-sponsor",
  executedBy: "technical-release-lead",
  manifests: Object.fromEntries(
    ACTIVATION_MANIFESTS.map((kind, i) => [
      kind,
      {
        version: `rel-2026.09.1+sha.4f21c${i}`,
        digest: digest(String(i)),
        rollbackId: `rollback://${kind}/2026.08.4`,
      },
    ]),
  ),
}

export const CHANGES = [
  { kind: "routing", progressive: true, observedBy: "metric://edge/5xx-by-target", reversal: "shift weight back to the legacy target group", rollbackBoundary: "INFRASTRUCTURE_APPLICATION" },
  { kind: "dns", progressive: false, whyNotProgressive: "the record has a single value; the TTL was lowered to 60s at T-1 instead", observedBy: "probe://dns/resolution", reversal: "restore the prior record within one TTL", rollbackBoundary: "INFRASTRUCTURE_APPLICATION" },
  { kind: "feature", progressive: true, observedBy: "metric://feature/error-rate", reversal: "flag off, no data migration required", rollbackBoundary: "CONFIGURATION" },
  { kind: "entitlement", progressive: true, observedBy: "metric://authorization/denials", reversal: "revoke the new grants, prior grants untouched", rollbackBoundary: "IDENTITY" },
  { kind: "connection", progressive: true, observedBy: "metric://integration/queue-depth", reversal: "disable the connection and restore source ownership", rollbackBoundary: "INTEGRATION" },
]

export const SMOKE_RECORDS = [
  { id: "canary-signin", synthetic: true, tenant: TENANT, cleanup: { workflow: "workflow://identity/retire-canary", audited: true, completed: true } },
  { id: "canary-journal", synthetic: true, tenant: TENANT, cleanup: { workflow: "workflow://finance/reverse-journal", audited: true, completed: true } },
  { id: "canary-workflow", synthetic: true, tenant: TENANT, cleanup: { workflow: "workflow://work/cancel-instance", audited: true, completed: true } },
]

export const VALIDATION = [
  ...VALIDATION_CHECKS.map((c) => ({ check: c.key, verdict: "PASSED", evidence: `evidence://activation/${c.key}` })),
  ...ISOLATION_ASSERTIONS.map((a) => ({ check: a.key, verdict: "PASSED", evidence: `evidence://activation/${a.key}` })),
]

export const DEVIATIONS = [
  {
    id: "DEV-001",
    commandCenterEvent: "event://cutover/2026-09-15/0412",
    rollbackThreshold: { crossed: false, decidedBy: "cutover-commander", detail: "notification lag 9 minutes against a 15-minute threshold" },
  },
]

export const DAY_ONE = [
  { id: "day-one-payroll-preview", executedBy: "business-process-owner", result: "PASSED" },
  { id: "day-one-purchase-to-pay", executedBy: "business-process-owner", result: "PASSED" },
]

export const ACTIVATION = {
  tenant: TENANT,
  command: ACTIVATION_COMMAND,
  changes: CHANGES,
  smokeRecords: SMOKE_RECORDS,
  validation: VALIDATION,
  deviations: DEVIATIONS,
  riskRequiresDayOne: true,
  dayOneScenarios: DAY_ONE,
}

// ── Refusals: one mutation each ─────────────────────────────────────────────

const withoutSeat = (seatKey) => ({ ...ROSTER, seats: ROSTER.seats.filter((s) => s.seat !== seatKey) })
const patchSeat = (seatKey, over) => ({
  ...ROSTER,
  seats: ROSTER.seats.map((s) => (s.seat === seatKey ? { ...s, ...over } : s)),
})

export const REFUSALS = [
  {
    id: "relay-in-an-accountable-seat",
    requirement: "EXT-100-002",
    what: "the decision recorder is occupied by \"Relay Copilot\"",
    run: () => rosterProblems(patchSeat("decision-recorder", { occupant: "Relay Copilot" }), APPLICABLE_SCOPES),
  },
  {
    id: "relay-as-the-backup-for-an-accountable-seat",
    requirement: "EXT-100-002",
    what: "the rollback authority's backup is \"relay-agent\"",
    run: () => rosterProblems(patchSeat("rollback-authority", { backup: "relay-agent" }), APPLICABLE_SCOPES),
  },
  {
    id: "an-hour-with-nobody-in-the-seat",
    requirement: "EXT-100-002",
    what: "the incident commander's rota runs 00:00–08:00 and 09:00–00:00",
    run: () =>
      rosterProblems(
        patchSeat("incident-commander", {
          coverage: [
            { from: "00:00", to: "08:00", occupant: "APAC on-call" },
            { from: "09:00", to: "00:00", occupant: "EMEA on-call" },
          ],
        }),
        APPLICABLE_SCOPES,
      ),
  },
  {
    id: "an-escalation-that-loops",
    requirement: "EXT-100-002",
    what: "the executive sponsor escalates to the cutover commander",
    run: () => rosterProblems(patchSeat("executive-sponsor", { escalation: "cutover-commander" }), APPLICABLE_SCOPES),
  },
  {
    id: "a-backup-who-is-the-occupant",
    requirement: "EXT-100-002",
    what: "the banking lead is their own backup",
    run: () => rosterProblems(patchSeat("banking-lead", { backup: "banking-lead occupant" }), APPLICABLE_SCOPES),
  },
  {
    id: "an-empty-seat",
    requirement: "EXT-100-002",
    what: "the rollback authority is removed from the roster",
    run: () => rosterProblems(withoutSeat("rollback-authority"), APPLICABLE_SCOPES),
  },
  {
    id: "a-decision-that-changed-a-task-nobody-has",
    requirement: "EXT-100-003",
    what: "DEC-001 cites the task `activation-v2`",
    run: () =>
      planProblems(
        { ...PLAN, decisionLog: [{ ...PLAN.decisionLog[0], affectedTasks: ["activation-v2"] }, PLAN.decisionLog[1]] },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
  },
  {
    id: "a-decision-taken-by-a-seat-with-no-authority",
    requirement: "EXT-100-003",
    what: "DEC-002's authority is the scribe",
    run: () =>
      planProblems(
        { ...PLAN, decisionLog: [PLAN.decisionLog[0], { ...PLAN.decisionLog[1], authority: "scribe" }] },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
  },
  {
    id: "an-audience-owned-by-a-person",
    requirement: "EXT-100-003",
    what: "\"all staff\" is owned by \"Comms Manager\" rather than by a seat",
    run: () =>
      planProblems(
        { ...PLAN, communicationsPlan: [{ ...PLAN.communicationsPlan[0], owner: "Comms Manager" }, ...PLAN.communicationsPlan.slice(1)] },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
  },
  {
    id: "a-plan-that-stops-at-cutover",
    requirement: "EXT-100-003",
    what: "the hypercare-exit milestone is dropped",
    run: () =>
      planProblems(
        { ...PLAN, integratedPlan: PLAN.integratedPlan.filter((m) => m.id !== "hypercare-exit") },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
  },
  {
    id: "a-decision-log-read-without-the-runbook",
    requirement: "EXT-100-003",
    what: "the join is attempted with no runbook supplied",
    run: () => planProblems(PLAN, { roster: ROSTER }),
  },
  {
    id: "activation-bound-to-latest",
    requirement: "EXT-100-008",
    what: "the release manifest's version is `latest`",
    run: () =>
      activationCommandProblems({
        ...ACTIVATION_COMMAND,
        manifests: { ...ACTIVATION_COMMAND.manifests, release: { ...ACTIVATION_COMMAND.manifests.release, version: "latest" } },
      }),
  },
  {
    id: "activation-pressed-twice",
    requirement: "EXT-100-008",
    what: "the command carries no idempotency key",
    run: () => activationCommandProblems({ ...ACTIVATION_COMMAND, idempotencyKey: undefined }),
  },
  {
    id: "activation-approved-by-its-executor",
    requirement: "EXT-100-008",
    what: "the technical release lead both approves and executes",
    run: () => activationCommandProblems({ ...ACTIVATION_COMMAND, approvedBy: "technical-release-lead" }),
  },
  {
    id: "a-flip-nobody-explained",
    requirement: "EXT-100-008",
    what: "the routing change is not progressive and gives no reason",
    run: () => progressiveChangeProblems(CHANGES.map((c) => (c.kind === "routing" ? { ...c, progressive: false } : c))),
  },
  {
    id: "a-canary-in-another-tenant",
    requirement: "EXT-100-008",
    what: "canary-journal belongs to `example-other`",
    run: () => smokeProblems(SMOKE_RECORDS.map((r) => (r.id === "canary-journal" ? { ...r, tenant: "example-other" } : r)), TENANT),
  },
  {
    id: "a-canary-deleted-by-hand",
    requirement: "EXT-100-008",
    what: "canary-signin's cleanup is unaudited",
    run: () =>
      smokeProblems(
        SMOKE_RECORDS.map((r) => (r.id === "canary-signin" ? { ...r, cleanup: { ...r.cleanup, audited: false } } : r)),
        TENANT,
      ),
  },
  {
    id: "a-validation-nobody-ran",
    requirement: "EXT-100-008",
    what: "the authorization check is absent from the results",
    run: () => validationProblems(VALIDATION.filter((v) => v.check !== "authorization")).problems,
  },
  {
    id: "isolation-unverified-is-not-isolation-clean",
    requirement: "EXT-100-008",
    what: "the cross-tenant assertion is absent from the results",
    run: () => validationProblems(VALIDATION.filter((v) => v.check !== "no-cross-tenant-access")).problems,
  },
]

const bullet = (problems) =>
  problems.length === 0
    ? "_no findings_"
    : problems.map((p) => `- \`${p.reason}\` — ${p.detail}`).join("\n")

export function render() {
  const roster = rosterProblems(ROSTER, APPLICABLE_SCOPES)
  const matrix = contactMatrix(ROSTER, APPLICABLE_SCOPES)
  const plan = planProblems(PLAN, { runbookTasks: TASKS, roster: ROSTER })
  const coverage = levelCoverage(PLAN)
  const verdict = activationVerdict(ACTIVATION)
  const validation = validationProblems(VALIDATION)

  const lines = []
  const w = (s = "") => lines.push(s)

  w("# Cutover command authority — roster, plan levels, and activation")
  w()
  w("**Generated by `tools/cutover-command-authority.mjs`. Do not edit by hand.**")
  w("`tests/architecture/ext-cutover-command-authority.test.mjs` fails if this file is stale.")
  w()
  w("Authority: [`Tenure_Global_ERP_Implementation_Extension_v1.0.md`](./Tenure_Global_ERP_Implementation_Extension_v1.0.md) §12.2, §12.3, §12.7.")
  w("Requirements: EXT-100-002 (command seats), EXT-100-003 (plan levels), EXT-100-008 (activation).")
  w("Companion: [`cutover-command-center.md`](./cutover-command-center.md) — §12.4–§12.8.")
  w()
  w("Every number below is computed at generation time from")
  w("`packages/provisioning/src/cutover-command-roles.mjs`, `cutover-plan-levels.mjs` and")
  w("`cutover-activation.mjs`, over a specification tenant. No line here is tenant data: every")
  w("occupant is a role name, every contact is a channel, and nothing names a bank, a provider")
  w("account or a credential.")
  w()

  w("## The command roster (EXT-100-002)")
  w()
  w(`§12.2 names ${COMMAND_SEATS.length} durable seats, of which`)
  w(`${COMMAND_SEATS.filter((s) => s.scope !== undefined).length} are qualified "as applicable". This`)
  w(`cutover declares ${APPLICABLE_SCOPES.length} scopes applicable (${APPLICABLE_SCOPES.join(", ")}),`)
  w(`so all ${matrix.length} are required. Each carries §12.2's ${REQUIRED_SEAT_FACTS.length} facts:`)
  w(`${REQUIRED_SEAT_FACTS.map((f) => f.phrase).join(", ")}.`)
  w()
  w("| Seat | Accountable | Occupant | Backup | Escalates to | Covered (min/day) |")
  w("| --- | --- | --- | --- | --- | --- |")
  for (const row of matrix) {
    w(
      `| \`${row.seat}\` | ${row.accountable ? "yes" : "—"} | ${row.occupant ?? "**vacant**"} | ` +
        `${row.backup ?? "**none**"} | ${row.escalatesTo ? `\`${row.escalatesTo}\`` : "_terminal_"} | ` +
        `${row.coveredMinutes} |`,
    )
  }
  w()
  const sponsor = escalationChain(ROSTER, "banking-lead")
  w(`Escalation from \`banking-lead\`: ${sponsor.chain.join(" → ")} (${sponsor.reason}).`)
  w(`Roster findings: ${roster.length}.`)
  w()
  w(bullet(roster))
  w()

  w("## The six plan levels (EXT-100-003)")
  w()
  w(`§12.3 says "Maintain:" and names ${PLAN_LEVELS.length} levels. Two of them are checked`)
  w("elsewhere and are not restated here — the detailed runbook by `cutover-runbook.mjs`, the")
  w("contact/escalation matrix by `cutover-command-roles.mjs`.")
  w()
  w("| Level | Maintained | Entries | Checked by |")
  w("| --- | --- | --- | --- |")
  for (const level of coverage) {
    w(`| ${level.title} | ${level.maintained ? "yes" : "**no**"} | ${level.entries} | \`${level.checkedBy}\` |`)
  }
  w()
  w(`The strategy states §12.3's ${STRATEGY_ELEMENTS.length} elements; the communications plan`)
  w(`carries ${PLAN.communicationsPlan.length} audiences with ${COMMUNICATION_ELEMENTS.length} elements`)
  w(`each; the decision log carries ${PLAN.decisionLog.length} decisions with ${DECISION_ELEMENTS.length}`)
  w(`elements each, joined against ${TASKS.length} runbook tasks and ${ROSTER.seats.length} staffed seats.`)
  w()
  w(`Plan findings: ${plan.length}.`)
  w()
  w(bullet(plan))
  w()

  w("## Activation and validation (EXT-100-008)")
  w()
  w(`§12.7 binds activation to ${ACTIVATION_MANIFESTS.length} approved manifests`)
  w(`(${ACTIVATION_MANIFESTS.join(", ")}), stages ${PROGRESSIVE_CHANGES.length} kinds of change`)
  w(`progressively, and validates ${VALIDATION_CHECKS.length} things plus`)
  w(`${ISOLATION_ASSERTIONS.length} absolutes.`)
  w()
  w("| Result | Why |")
  w("| --- | --- |")
  w(`| \`${verdict.result}\` | ${verdict.why} |`)
  w()
  w(
    `Validations run: ${VALIDATION_CHECKS.length - validation.notRun.length}/${VALIDATION_CHECKS.length}; ` +
      `failed: ${validation.failed.length}; isolation stops: ${validation.stops.length}.`,
  )
  w()
  w("The pair this module refuses to collapse is `NOT_RUN` against `PASSED`. A check nobody ran")
  w("and a check that passed are different answers, and §12.7's isolation bullet is the place")
  w("where treating them alike is a breach rather than a gap.")
  w()
  w(bullet(verdict.problems))
  w()

  w("## Refusals")
  w()
  w("Each row mutates exactly ONE thing in the fixtures above and reports what refused it. One")
  w("at a time, because two mutations can mask each other and a scenario that trips three rules")
  w("proves that something refused it rather than that this rule did.")
  w()
  w("| Scenario | Requirement | Mutation | Refused by |")
  w("| --- | --- | --- | --- |")
  for (const refusal of REFUSALS) {
    const out = refusal.run()
    const codes = [...new Set(out.map((p) => p.reason))]
    w(`| \`${refusal.id}\` | ${refusal.requirement} | ${refusal.what} | ${codes.map((c) => `\`${c}\``).join(", ")} |`)
  }
  w()

  return `${lines.join("\n")}\n`
}

// Run as a command, never as a side effect of being imported: the test file
// imports the fixtures above to re-run them, and an import that writes into the
// tree would make `--check` compare a file against itself.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const target = path.join(ROOT, DOC)
  const rendered = render()
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (current !== rendered) {
      console.error(`${DOC} is stale. Run: node tools/cutover-command-authority.mjs`)
      process.exit(1)
    }
    console.log(`${DOC} is up to date.`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rendered)
    console.log(`wrote ${DOC} (${rendered.split("\n").length} lines)`)
  }
}
