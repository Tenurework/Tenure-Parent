#!/usr/bin/env node
/**
 * EXT-100 — the Cutover Command Center's own rules, run over a worked cutover.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12
 * describes cutover as "a tenant-scoped, versioned state machine" and adds the
 * line this generator is answerable to: "It never becomes an unchecked
 * spreadsheet with stale copies." A document describing the rules would be
 * exactly that. So the scenarios below are declared here ONCE and read twice —
 * this generator writes `docs/architecture/cutover-command-center.md`, and
 * `tests/architecture/ext-cutover-command-center.test.mjs` re-runs the same
 * scenarios through the same five modules and asserts both the verdicts and that
 * the committed document is what the engine produces today.
 *
 * These are SPECIFICATION scenarios, not tenant data. The tenant slug is
 * `example-*`, every seat is a role name rather than a person, no date is a real
 * customer's go-live and nothing here names a bank, a provider account or a
 * credential. What is being proven is the arithmetic and the refusals over a
 * plan shape, not any plan.
 *
 *   node tools/cutover-command-center.mjs           writes the document
 *   node tools/cutover-command-center.mjs --check    exits 1 if it is stale
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  FREEZE_CLASSES,
  DUAL_OPERATION_PROOFS,
  DUAL_WRITE_PROOFS,
  dualWriteVerdict,
  freezeProblems,
} from "../packages/provisioning/src/cutover-freeze.mjs"
import {
  HORIZONS,
  horizonOf,
  horizonProblems,
  horizonWindows,
} from "../packages/provisioning/src/cutover-horizons.mjs"
import {
  REQUIRED_TASK_BINDINGS,
  plannedDuration,
  runbookProblems,
} from "../packages/provisioning/src/cutover-runbook.mjs"
import {
  GO_NO_GO_DIMENSIONS,
  boardReadiness,
  decide,
  decisionProblems,
} from "../packages/provisioning/src/cutover-go-no-go.mjs"
import {
  BOUNDARY_PLAN_CONTRACT,
  boundaryPlanProblems,
  forwardRecoveryProblems,
  lastReversiblePoint,
} from "../packages/provisioning/src/cutover-rollback.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const DOC = "docs/architecture/cutover-command-center.md"

/** The worked tenant's own T0. Tenant-specific by §12.4, so it is an input. */
export const T0 = "2026-09-15"

/**
 * One runbook task, with the nine §12.3 bindings filled from defaults that are
 * complete rather than plausible.
 *
 * The defaults exist so the valid plan below reads as a plan instead of as nine
 * repeated lines per task; every refusal scenario overrides exactly the one
 * binding it is about, which is also what keeps a scenario from proving two
 * things at once.
 */
const task = (id, date, covers, over = {}) => ({
  id,
  date,
  covers,
  version: "rel-2026.09.1+sha.4f21c0",
  executor: "technical-release-lead",
  approver: "cutover-commander",
  durationMinutes: 30,
  reference: `workflow://cutover/${id}`,
  verification: {
    success: "the task's own assertion passes",
    failure: "any assertion fails, or the window is exceeded",
    evidence: `evidence://cutover/${id}`,
  },
  retry: { attempts: 1, idempotent: true },
  rollbackBoundary: "CONFIGURATION",
  escalation: "cutover-commander then executive-sponsor",
  reversibility: "REVERSIBLE",
  prerequisites: [],
  ...over,
})

/**
 * A plan that covers every topic §12.4 lists, in the horizon it lists it in.
 *
 * Tasks carry several topics each: §12.4 requires the plan to *cover* the topics,
 * not to have one task per topic, and a one-to-one fixture would be forty-four
 * near-identical objects proving only that the loop runs.
 */
export const TASKS = [
  // ── T-90 to T-30 ─────────────────────────────────────────────────────────
  task("freeze-strategy", "2026-06-20", ["freeze_strategy"]),
  task("final-adapters", "2026-06-29", ["final_adapters"], {
    rollbackBoundary: "INTEGRATION",
  }),
  task("uat-and-training", "2026-07-13", ["uat", "training"], {
    executor: "test-validation-lead",
    durationMinutes: 480,
  }),
  task("support-model-and-cleanup", "2026-07-20", ["support", "data_cleanup"], {
    executor: "communications-support-lead",
  }),
  task("provider-certification", "2026-07-27", ["certification"], {
    executor: "banking-lead",
    rollbackBoundary: "INTEGRATION",
  }),
  task("dr-and-rollback-proof", "2026-08-03", ["dr_rollback"], {
    executor: "infrastructure-lead",
    rollbackBoundary: "INFRASTRUCTURE_APPLICATION",
  }),
  task("full-rehearsal", "2026-08-10", ["rehearsal"], {
    prerequisites: ["dr-and-rollback-proof", "uat-and-training"],
    durationMinutes: 600,
  }),

  // ── T-30 to T-7 ──────────────────────────────────────────────────────────
  task("readiness-review", "2026-08-17", ["final_readiness", "open_defects"], {
    executor: "test-validation-lead",
    prerequisites: ["full-rehearsal"],
  }),
  task("access-rosters-and-secrets", "2026-08-24", ["access_rosters", "certificates_secrets"], {
    executor: "identity-security-lead",
    rollbackBoundary: "IDENTITY",
  }),
  task("capacity-and-production-plans", "2026-08-31", ["capacity", "production_plans"], {
    executor: "infrastructure-lead",
    rollbackBoundary: "INFRASTRUCTURE_APPLICATION",
  }),
  task("comms-and-staffing", "2026-09-02", ["communications", "command_staffing"], {
    executor: "communications-support-lead",
    rollbackBoundary: "COMMUNICATION_SUPPORT",
  }),
  task("final-rehearsal-results", "2026-09-04", ["rehearsal_results"], {
    executor: "test-validation-lead",
    prerequisites: ["full-rehearsal"],
  }),

  // ── T-7 to T-1 ───────────────────────────────────────────────────────────
  task("change-freeze", "2026-09-08", ["change_freeze"]),
  task("source-health-and-deltas", "2026-09-09", ["source_health", "delta_checks"], {
    executor: "data-conversion-lead",
    rollbackBoundary: "MIGRATION",
  }),
  task("backups-and-digests", "2026-09-10", ["backups", "artifact_digests"], {
    executor: "infrastructure-lead",
    rollbackBoundary: "INFRASTRUCTURE_APPLICATION",
  }),
  task("approvals-and-notice", "2026-09-11", ["approvals", "customer_notice"], {
    executor: "communications-support-lead",
    approver: "executive-sponsor",
    rollbackBoundary: "COMMUNICATION_SUPPORT",
  }),
  task("no-surprise-review", "2026-09-12", ["no_surprise_review"], {
    prerequisites: ["readiness-review", "backups-and-digests"],
  }),

  // ── T0 window ────────────────────────────────────────────────────────────
  task("stop-integrations", "2026-09-15", ["stop_integrations"], {
    executor: "integration-lead",
    rollbackBoundary: "INTEGRATION",
    durationMinutes: 20,
  }),
  task("source-freeze", "2026-09-15", ["source_freeze"], {
    prerequisites: ["stop-integrations"],
    executor: "data-conversion-lead",
    rollbackBoundary: "MIGRATION",
    durationMinutes: 15,
  }),
  task("final-extracts", "2026-09-15", ["final_extracts"], {
    prerequisites: ["source-freeze"],
    executor: "data-conversion-lead",
    rollbackBoundary: "MIGRATION",
    durationMinutes: 90,
    retry: { attempts: 3, idempotent: true },
  }),
  // The point of no return. Once the converted ledger is posted, §12.8's
  // database bullet applies and the reversal is forward-only.
  task("conversion-load", "2026-09-15", ["conversion"], {
    prerequisites: ["final-extracts"],
    executor: "data-conversion-lead",
    rollbackBoundary: "DATABASE",
    durationMinutes: 240,
    reversibility: "IRREVERSIBLE",
  }),
  task("reconciliation", "2026-09-15", ["reconciliation"], {
    prerequisites: ["conversion-load"],
    executor: "domain-reconciliation-owner",
    approver: "data-conversion-lead",
    rollbackBoundary: "MIGRATION",
    durationMinutes: 120,
  }),
  task("deploy-promote", "2026-09-15", ["deploy_promote"], {
    prerequisites: ["backups-and-digests"],
    executor: "technical-release-lead",
    approver: "executive-sponsor",
    rollbackBoundary: "INFRASTRUCTURE_APPLICATION",
    durationMinutes: 45,
  }),
  task("identity-and-sso", "2026-09-15", ["identity_sso"], {
    prerequisites: ["deploy-promote", "access-rosters-and-secrets"],
    executor: "identity-security-lead",
    rollbackBoundary: "IDENTITY",
    durationMinutes: 30,
  }),
  task("enable-integrations", "2026-09-15", ["integration_enablement"], {
    prerequisites: ["identity-and-sso"],
    executor: "integration-lead",
    rollbackBoundary: "INTEGRATION",
    durationMinutes: 25,
  }),
  task("smoke-and-isolation", "2026-09-15", ["smoke_isolation"], {
    prerequisites: ["enable-integrations", "reconciliation"],
    executor: "test-validation-lead",
    durationMinutes: 60,
  }),
  task("go-no-go-board", "2026-09-15", ["go_no_go"], {
    prerequisites: ["smoke-and-isolation"],
    executor: "cutover-commander",
    approver: "executive-sponsor",
    durationMinutes: 30,
  }),
  task("activation", "2026-09-15", ["activation"], {
    prerequisites: ["go-no-go-board"],
    executor: "technical-release-lead",
    approver: "executive-sponsor",
    rollbackBoundary: "CONFIGURATION",
    durationMinutes: 20,
    retry: { attempts: 2, idempotent: true },
  }),
  task("user-release", "2026-09-15", ["user_release"], {
    prerequisites: ["activation"],
    executor: "communications-support-lead",
    rollbackBoundary: "COMMUNICATION_SUPPORT",
    durationMinutes: 15,
  }),

  // ── T+ ───────────────────────────────────────────────────────────────────
  task("transaction-monitoring", "2026-09-16", ["transaction_monitoring"], {
    executor: "infrastructure-lead",
    durationMinutes: 480,
  }),
  task("business-validation", "2026-09-16", ["business_validation", "issue_triage"], {
    executor: "business-process-owner",
    approver: "cutover-commander",
    durationMinutes: 300,
  }),
  task("period-controls", "2026-09-22", ["period_controls"], {
    executor: "finance-lead",
    durationMinutes: 240,
  }),
  task("hypercare-comms-and-adoption", "2026-09-22", ["communications", "adoption"], {
    executor: "communications-support-lead",
    rollbackBoundary: "COMMUNICATION_SUPPORT",
    durationMinutes: 180,
  }),
]

/** §12.5, classified for every object the cutover's scope names. */
export const FREEZE_PLAN = {
  scopeObjects: [
    "GeneralLedger",
    "PurchaseOrder",
    "PersonDirectory",
    "LegacyReportArchive",
    "BankStatement",
  ],
  objects: [
    { object: "GeneralLedger", class: "HARD_FREEZE", cutoff: "2026-09-15T02:00:00Z", writesTo: ["tenure"] },
    {
      object: "PurchaseOrder",
      class: "SOFT_FREEZE",
      cutoff: "2026-09-12T18:00:00Z",
      writesTo: ["tenure"],
      sourceChangesAfterCutoff: ["PO-88214 receipt correction"],
      approvedExceptions: [
        {
          change: "PO-88214 receipt correction",
          approvedBy: "business-process-owner",
          deltaCapture: "delta-set 7, re-extracted at T-0:30",
        },
      ],
    },
    {
      object: "PersonDirectory",
      class: "DUAL_OPERATION",
      cutoff: "2026-09-15T02:00:00Z",
      systemOfRecord: "tenure",
      direction: "OUTBOUND",
      deduplication: "durable person id, SCIM externalId as the join key",
      conflictHandling: "Tenure wins; legacy conflicts raise an exception case",
      duration: "T0 to T+30 days",
      exit: "legacy directory moves to READ_ONLY_COEXISTENCE at hypercare exit",
      // The one genuine dual write in the plan, and the only classification
      // §12.5 permits one under. All six proofs, or `dualWriteVerdict` refuses
      // it — the permitted branch is exercised here rather than only in a test.
      writesTo: ["tenure", "legacy"],
      dualWriteProofs: {
        conflictSemantics: "last-writer-wins is refused; Tenure's value stands and legacy raises a case",
        reconciliation: "nightly directory reconciliation, unmatched rows become exceptions",
        ownership: "Tenure is system of record; legacy writes only the payroll-provider id field",
        loopPrevention: "origin tag on every SCIM write; a write tagged Tenure is not echoed back",
        failureRecovery: "on channel failure both sides queue and the reconciliation replays by externalId",
        sunset: "channel closes at hypercare exit; legacy becomes query-only",
      },
    },
    {
      object: "LegacyReportArchive",
      class: "READ_ONLY_COEXISTENCE",
      cutoff: "2026-09-15T02:00:00Z",
      writesTo: ["tenure"],
    },
    {
      object: "BankStatement",
      class: "DEFERRED_MIGRATION",
      cutoff: "2026-09-15T02:00:00Z",
      governedLink: "statement reference resolves to the legacy archive through the memory index",
      retirementPlan: "retire with the legacy archive at T+180 days under §14's gates",
      writesTo: ["legacy"],
    },
  ],
}

/** §12.8, one plan per boundary the runbook's tasks actually touch. */
export const BOUNDARY_PLANS = [
  {
    boundary: "INFRASTRUCTURE_APPLICATION",
    artifact: "rel-2026.09.0+sha.90ab12 (immutable, previously active)",
    config: "config digest sha256:0e91… captured at backups-and-digests",
  },
  {
    boundary: "DATABASE",
    method: "RESTORE",
    dataImpact: "loss of every transaction posted after the T0 snapshot; re-keyed from delta-set 7",
  },
  {
    boundary: "CONFIGURATION",
    dataCompatibilityAnalysis:
      "activation touches routing and entitlement only; no column is dropped, so the prior config reads current data",
  },
  {
    boundary: "INTEGRATION",
    disableOrReroute: "disable inbound connectors, reroute outbound to the legacy endpoint set",
    replay: "replay from the envelope store by correlation id, at-least-once with target idempotency",
    sourceOwnershipRestoration: "legacy resumes as system of record for the affected domains",
  },
  {
    boundary: "MIGRATION",
    authorityRestoration: "legacy becomes authoritative again for converted domains",
    lostChangePrevention: "delta-set 7 is retained and re-applied to legacy",
    doubleEntryPrevention: "target rows are quarantined, not deleted, and matched by idempotency key",
  },
  {
    boundary: "IDENTITY",
    accessPreservation: "prior role and seat assignments are restored from the pre-cutover roster",
    sessionRevocation: "every session issued after identity-and-sso is revoked",
  },
  {
    boundary: "COMMUNICATION_SUPPORT",
    audiences: "all users, support desk, provider contacts",
    supportPosture: "return to pre-cutover support model and reopen the legacy queue",
  },
]

/** §12.6, the evidence a board reviewed at the recorded time. */
export const BOARD_TIME = "2026-09-15T14:00:00Z"

export const EVIDENCE = {
  versions: { ready: true, asOf: "2026-09-10T09:00:00Z", digest: "sha256:8b1c…" },
  production_readiness: { ready: true, asOf: "2026-09-14T20:00:00Z", digest: "sha256:1de4…" },
  conversion_reconciliation: { ready: true, asOf: "2026-09-15T12:30:00Z", digest: "sha256:77aa…" },
  smoke_isolation: { ready: true, asOf: "2026-09-15T13:20:00Z", digest: "sha256:c40f…" },
  external_readiness: { ready: true, asOf: "2026-09-14T16:00:00Z", digest: "sha256:2b90…" },
  business_readiness: { ready: true, asOf: "2026-09-04T11:00:00Z", digest: "sha256:5f31…" },
  defects: { ready: true, asOf: "2026-09-15T13:45:00Z", digest: "sha256:aa02…" },
  rollback_feasibility: { ready: true, asOf: "2026-09-15T13:50:00Z", digest: "sha256:6cc8…" },
}

export const DEFECTS = [
  { id: "D-114", severity: "S1", resolved: true },
  { id: "D-208", severity: "S3", resolved: false },
  {
    id: "D-233",
    severity: "S2",
    resolved: false,
    acceptedRisk: {
      authority: "executive-sponsor",
      compensatingControl: "manual weekly export until the report is fixed",
      expiry: "2026-10-15",
    },
  },
]

export const DECISION = {
  result: "GO",
  at: BOARD_TIME,
  expiry: "2026-09-15T22:00:00Z",
  evidenceDigest: "sha256:eb77…",
  participants: [
    { seat: "executive-sponsor", vote: "GO (go-live authority)" },
    { seat: "cutover-commander", vote: "GO" },
    { seat: "data-conversion-lead", vote: "GO" },
    { seat: "identity-security-lead", vote: "GO" },
    { seat: "business-process-owner", vote: "GO" },
    { seat: "test-validation-lead", vote: "GO" },
  ],
  conditions: [
    {
      condition: "D-233's manual export runs before the first weekly close",
      owner: "finance-lead",
      dueBy: "2026-09-21T17:00:00Z",
    },
  ],
}

/**
 * The refusal scenarios, each isolating ONE rule.
 *
 * One mutation per scenario is not a stylistic choice: two at once can mask each
 * other, and a scenario that trips three rules proves that something refused it
 * rather than that this rule did.
 */
export const REFUSALS = [
  {
    id: "unclassified-object",
    requirement: "EXT-100-005",
    what: "An object in cutover scope with no freeze classification.",
    run: () =>
      freezeProblems({ ...FREEZE_PLAN, scopeObjects: [...FREEZE_PLAN.scopeObjects, "GrantAward"] }),
  },
  {
    id: "undeclared-dual-write",
    requirement: "EXT-100-005",
    what: "A hard-frozen object that names both systems as writers.",
    run: () =>
      freezeProblems({
        ...FREEZE_PLAN,
        objects: FREEZE_PLAN.objects.map((o) =>
          o.object === "GeneralLedger" ? { ...o, writesTo: ["tenure", "legacy"] } : o,
        ),
      }),
  },
  {
    id: "dual-operation-unproven",
    requirement: "EXT-100-005",
    what: "DUAL_OPERATION declared without deduplication or an exit.",
    run: () =>
      freezeProblems({
        ...FREEZE_PLAN,
        objects: FREEZE_PLAN.objects.map((o) =>
          o.object === "PersonDirectory"
            ? { ...o, deduplication: undefined, exit: undefined }
            : o,
        ),
      }),
  },
  {
    id: "soft-freeze-without-delta-capture",
    requirement: "EXT-100-005",
    what: "An approved source change with no delta capture — approved, and invisible at the target.",
    run: () =>
      freezeProblems({
        ...FREEZE_PLAN,
        objects: FREEZE_PLAN.objects.map((o) =>
          o.object === "PurchaseOrder"
            ? {
                ...o,
                approvedExceptions: o.approvedExceptions.map((e) => ({
                  ...e,
                  deltaCapture: undefined,
                })),
              }
            : o,
        ),
      }),
  },
  {
    id: "horizon-not-covered",
    requirement: "EXT-100-004",
    what: "The T-7 horizon's backups task no longer covering backups.",
    // Its `covers` is emptied rather than the task deleted: deleting it would
    // also orphan the two tasks that depend on it, and a scenario that trips two
    // rules proves only that something refused it.
    run: () =>
      horizonProblems({
        t0: T0,
        tasks: TASKS.map((t) => (t.id === "backups-and-digests" ? { ...t, covers: [] } : t)),
      }),
  },
  {
    id: "prerequisite-runs-later",
    requirement: "EXT-100-004",
    what: "A task whose prerequisite is dated after it.",
    run: () =>
      horizonProblems({
        t0: T0,
        tasks: TASKS.map((t) =>
          t.id === "change-freeze" ? { ...t, prerequisites: ["no-surprise-review"] } : t,
        ),
      }),
  },
  {
    id: "no-tenant-t0",
    requirement: "EXT-100-004",
    what: "A plan with no tenant-specific T0.",
    run: () => horizonProblems({ tasks: TASKS }),
  },
  {
    id: "floating-version",
    requirement: "EXT-100-006",
    what: "A task bound to `latest` instead of an artifact.",
    run: () =>
      runbookProblems(TASKS.map((t) => (t.id === "activation" ? { ...t, version: "latest" } : t))),
  },
  {
    id: "self-approved-task",
    requirement: "EXT-100-006",
    what: "One seat as both executor and approver.",
    run: () =>
      runbookProblems(
        TASKS.map((t) =>
          t.id === "activation" ? { ...t, approver: "technical-release-lead" } : t,
        ),
      ),
  },
  {
    id: "retry-without-idempotency",
    requirement: "EXT-100-006",
    what: "Three attempts at a task that does not declare itself idempotent.",
    run: () =>
      runbookProblems(
        TASKS.map((t) =>
          t.id === "final-extracts" ? { ...t, retry: { attempts: 3, idempotent: false } } : t,
        ),
      ),
  },
  {
    id: "dependency-cycle",
    requirement: "EXT-100-006",
    what: "Two T0 tasks each waiting for the other.",
    run: () =>
      runbookProblems(
        TASKS.map((t) =>
          t.id === "stop-integrations" ? { ...t, prerequisites: ["source-freeze"] } : t,
        ),
      ),
  },
  {
    id: "stale-evidence",
    requirement: "EXT-100-007",
    what: "Smoke and isolation results from the previous rehearsal.",
    run: () =>
      boardReadiness(
        { ...EVIDENCE, smoke_isolation: { ...EVIDENCE.smoke_isolation, asOf: "2026-09-10T13:20:00Z" } },
        BOARD_TIME,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "go-on-unsupported-evidence",
    requirement: "EXT-100-007",
    what: "A recorded GO with one dimension's evidence never presented.",
    run: () => {
      const { conversion_reconciliation: _absent, ...partial } = EVIDENCE
      return decisionProblems(DECISION, {
        readiness: boardReadiness(partial, BOARD_TIME),
        defects: DEFECTS,
      })
    },
  },
  {
    id: "s2-without-permitted-risk",
    requirement: "EXT-100-007",
    what: "An open S2 whose accepted risk names no authority and no expiry.",
    run: () =>
      decide({
        readiness: boardReadiness(EVIDENCE, BOARD_TIME),
        defects: DEFECTS.map((d) => (d.id === "D-233" ? { ...d, acceptedRisk: {} } : d)),
      }),
  },
  {
    id: "down-migration-rollback",
    requirement: "EXT-100-009",
    what: "A database boundary plan that reverses by down migration.",
    run: () =>
      boundaryPlanProblems(
        TASKS,
        BOUNDARY_PLANS.map((p) =>
          p.boundary === "DATABASE" ? { ...p, method: "DOWN_MIGRATION" } : p,
        ),
      ),
  },
  {
    id: "uncovered-boundary",
    requirement: "EXT-100-009",
    what: "Tasks carrying the IDENTITY boundary with no identity rollback plan.",
    run: () =>
      boundaryPlanProblems(
        TASKS,
        BOUNDARY_PLANS.filter((p) => p.boundary !== "IDENTITY"),
      ),
  },
  {
    id: "forward-recovery-unrecorded",
    requirement: "EXT-100-009",
    what: "The conversion load has completed and no forward-recovery decision exists.",
    run: () =>
      forwardRecoveryProblems(
        null,
        lastReversiblePoint(TASKS, EXECUTED_THROUGH_CONVERSION),
      ),
  },
]

/** Two executed sets, so the last reversible point can be seen to MOVE. */
export const EXECUTED_BEFORE_CONVERSION = [
  "stop-integrations",
  "source-freeze",
  "final-extracts",
]
export const EXECUTED_THROUGH_CONVERSION = [...EXECUTED_BEFORE_CONVERSION, "conversion-load"]

const bullet = (problems) =>
  problems.length === 0
    ? "_no findings_"
    : problems
        .map((p) => `- \`${p.reason ?? p.verdict ?? p.result ?? "?"}\` — ${p.detail ?? p.why ?? ""}`)
        .join("\n")

export function render() {
  const windows = horizonWindows(T0)
  const freeze = freezeProblems(FREEZE_PLAN)
  const horizons = horizonProblems({ t0: T0, tasks: TASKS })
  const runbook = runbookProblems(TASKS)
  const duration = plannedDuration(TASKS)
  const readiness = boardReadiness(EVIDENCE, BOARD_TIME)
  const verdict = decide({ readiness, defects: DEFECTS })
  const decision = decisionProblems(DECISION, { readiness, defects: DEFECTS })
  const boundaries = boundaryPlanProblems(TASKS, BOUNDARY_PLANS)
  const before = lastReversiblePoint(TASKS, EXECUTED_BEFORE_CONVERSION)
  const after = lastReversiblePoint(TASKS, EXECUTED_THROUGH_CONVERSION)

  const lines = []
  const w = (s = "") => lines.push(s)

  w("# Cutover Command Center — the rules, run over a worked cutover")
  w()
  w("**Generated by `tools/cutover-command-center.mjs`. Do not edit by hand.**")
  w("`tests/architecture/ext-cutover-command-center.test.mjs` fails if this file is stale.")
  w()
  w("Authority: [`Tenure_Global_ERP_Implementation_Extension_v1.0.md`](./Tenure_Global_ERP_Implementation_Extension_v1.0.md) §12.")
  w("Requirements: EXT-100-004 (horizons), EXT-100-005 (freeze and dual writes),")
  w("EXT-100-006 (task bindings), EXT-100-007 (go/no-go), EXT-100-009 (last reversible point).")
  w()
  w("§12.1 says cutover \"never becomes an unchecked spreadsheet with stale copies\", so every")
  w("number below is computed at generation time from the five modules under")
  w("`packages/provisioning/src/cutover-*.mjs`, over a specification tenant. No line here is")
  w("tenant data: the seats are role names, the dates are a worked example, and nothing names a")
  w("bank, a provider account or a credential.")
  w()

  w("## The tenant's horizons (EXT-100-004)")
  w()
  w(`T0 = \`${windows.t0}\`, tenant-specific by §12.4. §12.4 gives the T+ horizon no end, and`)
  w("§13.5 says hypercare exit comes from criteria rather than a countdown, so it has none here.")
  w()
  w("| Horizon | §12.4 label | From | Until | Topics | Tasks |")
  w("| --- | --- | --- | --- | --- | --- |")
  for (const window of windows.windows) {
    const count = TASKS.filter((t) => horizonOf(t.date, windows.t0).horizon === window.key).length
    w(
      `| \`${window.key}\` | ${window.label} | ${window.start} | ${window.end ?? "_open_"} | ` +
        `${window.covers.length} | ${count} |`,
    )
  }
  w()
  w(`Horizon findings: ${horizons.length}.`)
  w()
  w(bullet(horizons))
  w()

  w("## Freeze and coexistence (EXT-100-005)")
  w()
  w(`${FREEZE_PLAN.scopeObjects.length} objects in scope, ${FREEZE_PLAN.objects.length} classified,`)
  w(`across ${FREEZE_CLASSES.length} classes. §12.5 requires ${DUAL_OPERATION_PROOFS.length} proofs`)
  w(`for dual operation and ${DUAL_WRITE_PROOFS.length} before a dual write is anything but`)
  w("prohibited.")
  w()
  w("| Object | Class | Writers | Dual write |")
  w("| --- | --- | --- | --- |")
  for (const object of FREEZE_PLAN.objects) {
    const v = dualWriteVerdict(object)
    w(
      `| \`${object.object}\` | ${object.class} | ${(object.writesTo ?? []).join(", ") || "_none_"} | ` +
        `${v.dualWrite ? (v.allowed ? "permitted" : "**prohibited**") : "n/a — one writer"} |`,
    )
  }
  w()
  w(`Freeze findings: ${freeze.length}.`)
  w()
  w(bullet(freeze))
  w()

  w("## Runbook bindings (EXT-100-006)")
  w()
  w(`${TASKS.length} tasks, each bound to §12.3's ${REQUIRED_TASK_BINDINGS.length} bindings:`)
  w(`${REQUIRED_TASK_BINDINGS.map((b) => b.phrase).join(", ")}.`)
  w()
  w(
    `Planned duration: ${duration.total} minutes over ${TASKS.length} tasks; ` +
      `${duration.unbound.length} unbound and therefore excluded from that total.`,
  )
  w()
  w(`Runbook findings: ${runbook.length}.`)
  w()
  w(bullet(runbook))
  w()

  w("## Go/no-go board (EXT-100-007)")
  w()
  w(`Board convened \`${BOARD_TIME}\`. §12.6's ${GO_NO_GO_DIMENSIONS.length} mandatory dimensions,`)
  w("each judged against evidence with an age rather than against a tick.")
  w()
  w("| Dimension | Budget | Age | Verdict |")
  w("| --- | --- | --- | --- |")
  for (const r of readiness) {
    const dimension = GO_NO_GO_DIMENSIONS.find((d) => d.key === r.key)
    w(
      `| \`${r.key}\` | ${dimension.freshnessHours}h | ` +
        `${r.ageHours === undefined ? "—" : `${r.ageHours.toFixed(1)}h`} | ${r.verdict} |`,
    )
  }
  w()
  w(`Derived result: **${verdict.result}**. Recorded result: **${DECISION.result}**.`)
  w(`Blocking defects: ${verdict.blockers.length}. Decision-record findings: ${decision.length}.`)
  w()
  w(bullet(decision))
  w()

  w("## Last reversible point, recalculated (EXT-100-009)")
  w()
  w("§12.8: \"Define the last reversible point before execution and recalculate it as cutover")
  w("advances.\" The same function, called with two executed sets:")
  w()
  w("| Executed through | Reversible | Point | Next irreversible |")
  w("| --- | --- | --- | --- |")
  w(
    `| ${EXECUTED_BEFORE_CONVERSION[EXECUTED_BEFORE_CONVERSION.length - 1]} | yes | ` +
      `\`${before.taskId}\` | \`${before.nextIrreversible}\` |`,
  )
  w(
    `| ${EXECUTED_THROUGH_CONVERSION[EXECUTED_THROUGH_CONVERSION.length - 1]} | **no** | ` +
      `crossed at \`${after.crossedAt}\` | — |`,
  )
  w()
  w(after.why)
  w()
  w(`${BOUNDARY_PLAN_CONTRACT.length} boundaries in §12.8; boundary-plan findings: ${boundaries.length}.`)
  w()
  w(bullet(boundaries))
  w()

  w("## Refusals")
  w()
  w("Each row mutates the plan above in exactly ONE way and reports what refused it. One at a")
  w("time because two mutations can mask each other, and a scenario that trips three rules")
  w("proves that something refused it rather than that this rule did.")
  w()
  w("| Scenario | Requirement | Mutation | Refused by |")
  w("| --- | --- | --- | --- |")
  for (const refusal of REFUSALS) {
    const out = refusal.run()
    const codes = Array.isArray(out)
      ? [...new Set(out.map((p) => p.reason ?? p.verdict ?? "?"))]
      : [out.result ?? "?"]
    w(`| \`${refusal.id}\` | ${refusal.requirement} | ${refusal.what} | ${codes.map((c) => `\`${c}\``).join(", ")} |`)
  }
  w()

  return `${lines.join("\n")}\n`
}

// Run as a command, never as a side effect of being imported: the test file
// imports the scenarios above to re-run them, and an import that writes into the
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
      console.error(`${DOC} is stale. Run: node tools/cutover-command-center.mjs`)
      process.exit(1)
    }
    console.log(`${DOC} is up to date.`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rendered)
    console.log(`wrote ${DOC} (${rendered.split("\n").length} lines)`)
  }
}
