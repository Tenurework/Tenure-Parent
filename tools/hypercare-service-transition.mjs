#!/usr/bin/env node
/**
 * EXT-110 — the hypercare rules of §13, run over a worked hypercare.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §13.4 (change control and workarounds), §13.5 (exit and transition criteria),
 * and §12.2's seat facts where an outage moves a seat.
 *
 * Requirements: EXT-110-005 (emergency change and correction packages),
 * EXT-110-006 (workaround lifecycle), EXT-110-007 (exit criteria and evidence),
 * EXT-110-010 (on-call, escalation and handoff under an outage).
 *
 * Same contract as `tools/cutover-command-center.mjs`, and for the same reason:
 * the scenarios are declared HERE once and read twice — this generator writes
 * `docs/architecture/hypercare-service-transition.md`, and
 * `tests/architecture/ext-hypercare-service-transition.test.mjs` re-runs the
 * same scenarios through the same four modules and asserts both the verdicts and
 * that the committed document is what the engine produces today. A worked
 * example that lives only in a document is a claim; one a test re-runs is
 * evidence.
 *
 * These are SPECIFICATION scenarios, not tenant data. The tenant slug is
 * `example-*`, every occupant is a role name rather than a person, no date is a
 * real customer's go-live, and nothing here names a bank, a provider account or
 * a credential.
 *
 *   node tools/hypercare-service-transition.mjs           writes the document
 *   node tools/hypercare-service-transition.mjs --check    exits 1 if it is stale
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  COMMAND_SEATS,
  TERMINAL_ESCALATION,
} from "../packages/provisioning/src/cutover-command-roles.mjs"
import {
  CORRECTION_FACTS,
  EMERGENCY_STEPS,
  configurationFixProblems,
  dataFixProblems,
  directEditPosture,
  emergencyChangeProblems,
} from "../packages/provisioning/src/hypercare-change-control.mjs"
import {
  EXIT_CRITERIA,
  HANDOVER_ITEMS,
  exitReadiness,
  exitVerdict,
} from "../packages/provisioning/src/hypercare-exit.mjs"
import {
  coverageUnderOutage,
  handoffCoverageProblems,
  handoffDrill,
  seatHolder,
} from "../packages/provisioning/src/hypercare-standby.mjs"
import {
  WORKAROUND_FACTS,
  registerProblems,
  stateOf,
  workaroundAges,
} from "../packages/provisioning/src/hypercare-workarounds.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const DOC = "docs/architecture/hypercare-service-transition.md"

export const TENANT = "example-district"

/** The instant every clock-relative answer below is evaluated at. */
export const NOW = "2026-10-06T09:00:00Z"

// ── EXT-110-010: the hypercare on-call roster ───────────────────────────────

/**
 * The seven seats a hypercare rota actually staffs, drawn from §12.2's list.
 *
 * Not all twenty-three: §13.1 describes hypercare coverage as "on-call
 * rotations", and a rota that names an executive sponsor at 03:00 is a rota
 * nobody runs. The seats kept are the ones §13.2's daily cadence names as
 * answering for a domain, plus the two accountable seats an outage has to be
 * able to escalate INTO — which is the pair the drill below is really about.
 */
export const ONCALL_SEATS = Object.freeze([
  "incident-commander",
  "cutover-commander",
  "executive-sponsor",
  "technical-release-lead",
  "identity-lead",
  "integration-lead",
  "communications-support-lead",
])

/** A follow-the-sun rota that tiles the 24-hour hypercare day with no gap. */
const ROTA = Object.freeze([
  Object.freeze({ from: "00:00", to: "08:00", occupant: "apac-oncall", zone: "UTC+09" }),
  Object.freeze({ from: "08:00", to: "16:00", occupant: "emea-oncall", zone: "UTC+01" }),
  Object.freeze({ from: "16:00", to: "00:00", occupant: "amer-oncall", zone: "UTC-05" }),
])

const seat = (key, over = {}) => ({
  seat: key,
  occupant: `${key}-primary`,
  backup: `${key}-deputy`,
  authority: `answers for ${key} during hypercare`,
  handoff: "written handover in the hypercare log plus a verbal bridge handover",
  coverage: ROTA,
  contact: `bridge://hypercare/${key}`,
  escalation: "incident-commander",
  decisionRights: [`${key} scope`],
  ...over,
})

/**
 * The roster the outage is run against.
 *
 * The escalation chain is three deep on purpose — domain seat → incident
 * commander → cutover commander → executive sponsor — because a two-deep chain
 * cannot show the difference between "the escalation path worked" and "the one
 * seat above happened to be awake".
 */
export const ROSTER = {
  tenant: TENANT,
  seats: ONCALL_SEATS.map((key) =>
    seat(
      key,
      key === "executive-sponsor"
        ? { escalation: TERMINAL_ESCALATION, authority: "the decision no other seat may take" }
        : key === "cutover-commander"
          ? { escalation: "executive-sponsor" }
          : key === "incident-commander"
            ? { escalation: "cutover-commander" }
            : {},
    ),
  ),
}

/**
 * Four outages, each larger than the last, so the drill shows where cover ENDS.
 *
 * A single scenario in which everybody is available proves nothing, and one in
 * which everybody is unavailable proves only that the refusal fires. The middle
 * two are the ones worth running: they are the shapes a real rota fails at.
 */
export const OUTAGES = [
  {
    id: "primary-unavailable",
    atUtc: "10:00",
    unavailable: ["identity-lead-primary"],
    what: "One domain seat's primary occupant is unreachable during the EMEA window.",
  },
  {
    id: "primary-and-deputy-unavailable",
    atUtc: "10:00",
    unavailable: ["identity-lead-primary", "identity-lead-deputy"],
    what: "Both the occupant and §12.2's declared backup are unreachable.",
  },
  {
    id: "seat-and-rota-unavailable",
    atUtc: "10:00",
    unavailable: ["identity-lead-primary", "identity-lead-deputy", "emea-oncall"],
    what: "The seat, its backup, and the whole rota window covering the hour.",
  },
  {
    id: "night-window",
    atUtc: "03:00",
    unavailable: ["integration-lead-primary", "integration-lead-deputy"],
    what: "The same shape at 03:00, where the APAC window rather than EMEA is on.",
  },
]

// ── EXT-110-006: the workaround register ────────────────────────────────────

/** One workaround, with §13.4's seven facts filled completely rather than plausibly. */
const workaround = (id, over = {}) => ({
  id,
  owner: "business-process-owner",
  instructions: [`open the ${id} queue`, "export the affected rows", "re-key them in the target"],
  risk: "MEDIUM",
  affectedPopulation: "the 40 users of the affected process",
  expiry: "2026-11-30T00:00:00Z",
  communication: ["hypercare bulletin 2026-10-01", "support article KB-114"],
  permanentFix: "D-208",
  adoptedAt: "2026-09-20T00:00:00Z",
  riskAcceptedBy: "business-process-owner",
  ...over,
})

export const WORKAROUNDS = [
  workaround("WA-01"),
  workaround("WA-02", { risk: "LOW", permanentFix: "D-214", expiry: "2026-12-15T00:00:00Z" }),
  // Adopted as the process, with the decision recorded rather than left blank.
  workaround("WA-03", {
    risk: "LOW",
    permanentFix: "NONE_REQUIRED",
    permanentFixDecision:
      "the business owner accepted the extra approval step as the standing process on 2026-09-28",
    expiry: "2027-06-30T00:00:00Z",
  }),
  // Superseded by the fix that shipped, which is the happy end of the lifecycle.
  workaround("WA-04", {
    permanentFix: "D-190",
    supersededAt: "2026-10-02T00:00:00Z",
  }),
  // Drafted during triage and not yet adopted: no audience, so no communication.
  workaround("WA-05", { adoptedAt: undefined, communication: [], permanentFix: "D-221" }),
]

// ── EXT-110-005: change control during hypercare ────────────────────────────

const step = (disposition, detail, shortcut) => ({ disposition, detail, shortcut })

export const EMERGENCY_CHANGE = {
  id: "EC-07",
  executor: "technical-release-lead",
  approver: "incident-commander",
  steps: {
    risk: step("FULL", "blast radius assessed against the affected process and its integrations"),
    test: step(
      "COMPRESSED",
      "the regression subset covering the affected process ran in staging",
      "the full nightly regression was not run; the untested surface is the four unrelated modules",
    ),
    approval: step("COMPRESSED", "approved on the hypercare bridge", "one approver instead of the standing two"),
    rollback: step("FULL", "prior artifact rel-2026.09.4 retained and redeploy rehearsed in staging"),
    deployment: step("FULL", "promoted through staging to production by the normal pipeline"),
    evidence: step("FULL", "pipeline run, approval record and post-change validation attached to EC-07"),
  },
}

export const CONFIG_FIXES = [
  { id: "CF-11", version: "cfg-2026.10.2", promotedFrom: "staging" },
  { id: "CF-12", version: "cfg-2026.10.3", promotedFrom: "staging" },
  {
    id: "CF-13",
    version: "cfg-2026.10.4",
    directProductionEdit: true,
    authorisedBy: "EC-07",
    promotionBackfill: "cfg-2026.10.4 committed and promoted from staging on 2026-10-05",
  },
]

export const DATA_FIXES = [
  { id: "DF-21", route: "DOMAIN_COMMAND", command: "finance.reversePosting", executor: "finance-lead" },
  {
    id: "DF-22",
    route: "CORRECTION_PACKAGE",
    executor: "data-conversion-lead",
    before: "evidence://hypercare/DF-22/before",
    after: "evidence://hypercare/DF-22/after",
    affectedRecords: "312 rows in the affected process, listed by id in the package",
    dryRun: "run 2026-10-03, 312 rows matched",
    dryRunMatchedApply: true,
    validation: "post-apply reconciliation returned to zero variance",
    approval: "business-process-owner and finance-lead",
    audit: "audit://hypercare/DF-22",
    rollbackOrCompensation: "compensating reversal prepared; the original rows are quarantined, not deleted",
  },
]

// ── EXT-110-007: the exit facts ─────────────────────────────────────────────

export const EXIT_FACTS = {
  defects: [
    { id: "D-190", severity: "S1", resolved: true },
    { id: "D-208", severity: "S2", resolved: false, acceptedBy: "executive-sponsor" },
    { id: "D-214", severity: "S3", resolved: false },
  ],
  businessCycles: [
    { name: "month-end close", completed: true, reconciled: true },
    { name: "bank reconciliation", completed: true, reconciled: true },
    {
      name: "payroll cycle",
      completed: false,
      reconciled: false,
      observationWindow: "payroll remains with the certified provider; two cycles observed to T+60",
      agreedBy: "executive-sponsor",
    },
  ],
  thresholds: [
    { dimension: "reliability", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "performance", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "integration", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "security", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "data quality", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "support SLA", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
    { dimension: "cost", withinThreshold: true, observedDays: 30, agreedPeriodDays: 30 },
  ],
  workarounds: WORKAROUNDS,
  handover: Object.fromEntries(
    HANDOVER_ITEMS.map((item) => [item, { acceptedBy: `service-owner (${item})` }]),
  ),
  knowledge: {
    sessionsPassed: true,
    supportSimulationsPassed: true,
    attestingSeats: [
      { seat: "tier-1 support", attested: true },
      { seat: "tier-2 support", attested: true },
      { seat: "platform on-call", attested: true },
    ],
  },
  signoff: {
    customer: "customer service owner",
    tenureServiceOwner: "Tenure service owner",
    manifestRef: "evidence://hypercare/transition-manifest",
  },
}

// ── the refusals ────────────────────────────────────────────────────────────

const without = (object, key) => {
  const copy = { ...object }
  delete copy[key]
  return copy
}

/**
 * Each row mutates the worked hypercare in exactly ONE way.
 *
 * One at a time because two mutations can mask each other, and a scenario that
 * trips three rules proves that something refused it rather than that this rule
 * did.
 */
export const REFUSALS = [
  {
    id: "workaround-without-expiry",
    requirement: "EXT-110-006",
    what: "A workaround with no expiry — the shape that becomes the process.",
    run: () => registerProblems(WORKAROUNDS.map((w) => (w.id === "WA-01" ? without(w, "expiry") : w)), NOW),
  },
  {
    id: "workaround-expired",
    requirement: "EXT-110-006",
    what: "A workaround whose expiry passed with no permanent fix and no renewal.",
    run: () =>
      registerProblems(
        WORKAROUNDS.map((w) => (w.id === "WA-01" ? { ...w, expiry: "2026-09-30T00:00:00Z" } : w)),
        NOW,
      ),
  },
  {
    id: "workaround-accepted-without-decision",
    requirement: "EXT-110-006",
    what: "NONE_REQUIRED declared with no decision behind it.",
    run: () =>
      registerProblems(
        WORKAROUNDS.map((w) => (w.id === "WA-03" ? without(w, "permanentFixDecision") : w)),
        NOW,
      ),
  },
  {
    id: "workaround-superseded-by-nothing",
    requirement: "EXT-110-006",
    what: "A supersession that names no fix that superseded it.",
    run: () =>
      registerProblems(
        WORKAROUNDS.map((w) => (w.id === "WA-04" ? { ...w, permanentFix: "NONE_REQUIRED", permanentFixDecision: "x" } : w)),
        NOW,
      ),
  },
  {
    id: "emergency-step-skipped",
    requirement: "EXT-110-005",
    what: "The rollback step marked SKIPPED on the emergency path.",
    run: () =>
      emergencyChangeProblems({
        ...EMERGENCY_CHANGE,
        steps: { ...EMERGENCY_CHANGE.steps, rollback: step("SKIPPED", "no time") },
      }),
  },
  {
    id: "emergency-compression-unstated",
    requirement: "EXT-110-005",
    what: "A COMPRESSED step that does not say what was traded away.",
    run: () =>
      emergencyChangeProblems({
        ...EMERGENCY_CHANGE,
        steps: { ...EMERGENCY_CHANGE.steps, test: without(EMERGENCY_CHANGE.steps.test, "shortcut") },
      }),
  },
  {
    id: "emergency-self-approved",
    requirement: "EXT-110-005",
    what: "One person as both executor and approver of the emergency change.",
    run: () => emergencyChangeProblems({ ...EMERGENCY_CHANGE, approver: "technical-release-lead" }),
  },
  {
    id: "relay-executed-fix",
    requirement: "EXT-110-005",
    what: "Relay named as the executor of a protected fix.",
    run: () => emergencyChangeProblems({ ...EMERGENCY_CHANGE, executor: "Relay Copilot" }),
  },
  {
    id: "direct-edit-not-backfilled",
    requirement: "EXT-110-005",
    what: "A direct production edit with no promotion putting it back.",
    run: () =>
      configurationFixProblems(without(CONFIG_FIXES.find((f) => f.id === "CF-13"), "promotionBackfill")),
  },
  {
    id: "correction-package-incomplete",
    requirement: "EXT-110-005",
    what: "A correction package with no dry run.",
    run: () => dataFixProblems(without(DATA_FIXES.find((f) => f.id === "DF-22"), "dryRun")),
  },
  {
    id: "data-fix-unrouted",
    requirement: "EXT-110-005",
    what: "A data fix that took neither of §13.4's two routes.",
    run: () => dataFixProblems({ ...DATA_FIXES[0], route: "DIRECT_SQL" }),
  },
  {
    id: "exit-with-open-s1",
    requirement: "EXT-110-007",
    what: "An unresolved S1 at the exit board.",
    run: () =>
      exitReadiness(
        { ...EXIT_FACTS, defects: EXIT_FACTS.defects.map((d) => (d.id === "D-190" ? { ...d, resolved: false } : d)) },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "exit-with-unaccepted-s2",
    requirement: "EXT-110-007",
    what: "An open S2 nobody is named as accepting.",
    run: () =>
      exitReadiness(
        { ...EXIT_FACTS, defects: EXIT_FACTS.defects.map((d) => (d.id === "D-208" ? without(d, "acceptedBy") : d)) },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "exit-with-unmeasured-threshold",
    requirement: "EXT-110-007",
    what: "A threshold dimension that says nothing either way — UNKNOWN, not satisfied.",
    run: () =>
      exitReadiness(
        {
          ...EXIT_FACTS,
          thresholds: EXIT_FACTS.thresholds.map((t) =>
            t.dimension === "cost" ? without(t, "withinThreshold") : t,
          ),
        },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "exit-with-short-observation",
    requirement: "EXT-110-007",
    what: "A dimension within threshold for less than the agreed period.",
    run: () =>
      exitReadiness(
        {
          ...EXIT_FACTS,
          thresholds: EXIT_FACTS.thresholds.map((t) =>
            t.dimension === "reliability" ? { ...t, observedDays: 6 } : t,
          ),
        },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "exit-with-unowned-handover",
    requirement: "EXT-110-007",
    what: "The DR handover item with nobody named as accepting it.",
    run: () =>
      exitReadiness(
        { ...EXIT_FACTS, handover: { ...EXIT_FACTS.handover, disasterRecovery: {} } },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "exit-with-one-signature",
    requirement: "EXT-110-007",
    what: "A transition manifest the customer signed and Tenure did not.",
    run: () =>
      exitReadiness(
        { ...EXIT_FACTS, signoff: without(EXIT_FACTS.signoff, "tenureServiceOwner") },
        NOW,
      ).filter((r) => r.verdict !== "SATISFIED"),
  },
  {
    id: "no-stand-in",
    requirement: "EXT-110-010",
    what: "Every seat on the escalation path unavailable at 10:00 as well.",
    run: () => [
      seatHolder(ROSTER, "identity-lead", {
        atUtc: "10:00",
        unavailable: [
          "identity-lead-primary",
          "identity-lead-deputy",
          "emea-oncall",
          "incident-commander-primary",
          "incident-commander-deputy",
          "cutover-commander-primary",
          "cutover-commander-deputy",
          "executive-sponsor-primary",
          "executive-sponsor-deputy",
        ],
      }),
    ],
  },
  {
    id: "escalation-cycle-under-outage",
    requirement: "EXT-110-010",
    what: "An escalation path that loops, discovered by an outage rather than at 03:00.",
    run: () => [
      seatHolder(
        {
          ...ROSTER,
          seats: ROSTER.seats.map((s) =>
            s.seat === "incident-commander" ? { ...s, escalation: "identity-lead" } : s,
          ),
        },
        "identity-lead",
        {
          atUtc: "10:00",
          unavailable: ["identity-lead-primary", "identity-lead-deputy", "emea-oncall"],
        },
      ),
    ],
  },
  {
    id: "handoff-undocumented",
    requirement: "EXT-110-010",
    what: "A seat that changes hands during an outage and declares no handoff.",
    run: () => {
      const roster = {
        ...ROSTER,
        seats: ROSTER.seats.map((s) => (s.seat === "identity-lead" ? without(s, "handoff") : s)),
      }
      return handoffCoverageProblems(
        roster,
        handoffDrill(roster, [OUTAGES[0]]),
      ).filter((p) => p.seat === "identity-lead")
    },
  },
]

const bullet = (problems) =>
  problems.length === 0
    ? "_no findings_"
    : problems
        .map((p) => `- \`${p.reason ?? p.verdict ?? p.result ?? "?"}\` — ${p.detail ?? p.why ?? ""}`)
        .join("\n")

export function render() {
  const register = registerProblems(WORKAROUNDS, NOW)
  const ages = workaroundAges(WORKAROUNDS, NOW)
  const emergency = emergencyChangeProblems(EMERGENCY_CHANGE)
  const config = CONFIG_FIXES.flatMap((f) => configurationFixProblems(f))
  const posture = directEditPosture(CONFIG_FIXES)
  const data = DATA_FIXES.flatMap((f) => dataFixProblems(f))
  const readiness = exitReadiness(EXIT_FACTS, NOW)
  const exit = exitVerdict(EXIT_FACTS, NOW)
  const drill = handoffDrill(ROSTER, OUTAGES)
  const handoff = handoffCoverageProblems(ROSTER, drill)

  const lines = []
  const w = (s = "") => lines.push(s)

  w("# Hypercare and service transition — the rules, run over a worked hypercare")
  w()
  w("**Generated by `tools/hypercare-service-transition.mjs`. Do not edit by hand.**")
  w("`tests/architecture/ext-hypercare-service-transition.test.mjs` fails if this file is stale.")
  w()
  w("Authority: [`Tenure_Global_ERP_Implementation_Extension_v1.0.md`](./Tenure_Global_ERP_Implementation_Extension_v1.0.md) §13.")
  w("Requirements: EXT-110-005 (change control), EXT-110-006 (workaround lifecycle),")
  w("EXT-110-007 (exit criteria), EXT-110-010 (on-call, escalation and handoff under an outage).")
  w()
  w(`Every number below is computed at generation time from the four modules under`)
  w("`packages/provisioning/src/hypercare-*.mjs`, over a specification tenant, evaluated at")
  w(`\`${NOW}\`. No line here is tenant data: the seats are role names, the dates are a worked`)
  w("example, and nothing names a bank, a provider account or a credential.")
  w()

  // ── EXT-110-006 ──────────────────────────────────────────────────────────
  w("## The workaround register (EXT-110-006)")
  w()
  w(`§13.4 gives a workaround ${WORKAROUND_FACTS.length} facts —`)
  w(`${WORKAROUND_FACTS.map((f) => f.phrase).join(", ")} — and the requirement id adds the word`)
  w("the sentence leaves implicit: lifecycle.")
  w()
  w("| Workaround | State | Age (days) | Risk | Permanent fix |")
  w("| --- | --- | --- | --- | --- |")
  for (const item of WORKAROUNDS) {
    const s = stateOf(item, NOW)
    w(
      `| \`${item.id}\` | ${s.state ?? "_unplaceable_"} | ${s.ageDays ?? "—"} | ${item.risk} | ` +
        `\`${item.permanentFix}\` |`,
    )
  }
  w()
  w(
    `Register findings: ${register.length}. Open (ACTIVE or EXPIRED): ${ages.openCount}; ` +
      `oldest open: ${ages.oldestOpenDays === null ? "—" : `${ages.oldestOpenDays} days`}; ` +
      `unplaceable: ${ages.unplaceable}.`,
  )
  w()
  w(bullet(register))
  w()
  w("`WA-05` is PROPOSED and carries no communication, which is not a finding: §13.4's")
  w("communication fact applies from adoption. A draft nobody has been told to follow has an")
  w("audience of nobody, and holding it to that fact would make every triage note a defect.")
  w()

  // ── EXT-110-005 ──────────────────────────────────────────────────────────
  w("## Change control during hypercare (EXT-110-005)")
  w()
  w(`§13.4's emergency path has ${EMERGENCY_STEPS.length} steps and each has a disposition.`)
  w("`COMPRESSED` is what \"expedited\" means and is allowed — with the shortcut named.")
  w("`SKIPPED` is refused: a path missing a step is not a fast path, it is a different one.")
  w()
  w("| Step | Disposition | Shortcut taken |")
  w("| --- | --- | --- |")
  for (const s of EMERGENCY_STEPS) {
    const record = EMERGENCY_CHANGE.steps[s.key]
    w(`| ${s.phrase} | \`${record.disposition}\` | ${record.shortcut ?? "—"} |`)
  }
  w()
  w(`Emergency-change findings: ${emergency.length}.`)
  w()
  w(bullet(emergency))
  w()
  w(`Configuration-fix findings: ${config.length} over ${CONFIG_FIXES.length} fixes. ${posture.why}`)
  w()
  w(bullet(config))
  w()
  w(
    `Data-fix findings: ${data.length} over ${DATA_FIXES.length} fixes; a correction package ` +
      `carries ${CORRECTION_FACTS.length} facts.`,
  )
  w()
  w(bullet(data))
  w()

  // ── EXT-110-007 ──────────────────────────────────────────────────────────
  w("## Exit and transition criteria (EXT-110-007)")
  w()
  w(`§13.5 says hypercare exits "only when" all ${EXIT_CRITERIA.length} hold. It is a conjunction,`)
  w("not a score — a readiness percentage is what lets six satisfied criteria carry the seventh.")
  w()
  w("| Criterion | Verdict | Detail |")
  w("| --- | --- | --- |")
  for (const row of readiness) {
    w(`| \`${row.criterion}\` | **${row.verdict}** | ${row.detail} |`)
  }
  w()
  w(`Verdict: **${exit.result}**. ${exit.why}`)
  w()

  // ── EXT-110-010 ──────────────────────────────────────────────────────────
  w("## On-call, escalation and handoff under an outage (EXT-110-010)")
  w()
  w(`${ROSTER.seats.length} hypercare seats, drawn from §12.2's list, on a three-window`)
  w("follow-the-sun rota. §12.2 already requires every seat to declare a backup, an escalation")
  w("and a handoff, and `cutover-command-roles.mjs` already refuses a roster that omits them.")
  w("What that cannot tell you is whether the declarations WORK — so the outages below are run.")
  w()
  w("| Outage | At (UTC) | Unavailable | Seat under test | Holder | Route |")
  w("| --- | --- | --- | --- | --- | --- |")
  for (const outage of OUTAGES) {
    const under = outage.id === "night-window" ? "integration-lead" : "identity-lead"
    const held = seatHolder(ROSTER, under, { atUtc: outage.atUtc, unavailable: outage.unavailable })
    w(
      `| \`${outage.id}\` | ${outage.atUtc} | ${outage.unavailable.length} | \`${under}\` | ` +
        `${held.holder ?? `**${held.reason}**`} | ${held.route ?? "—"}${held.via ? ` via \`${held.via}\`` : ""} |`,
    )
  }
  w()
  w(
    `The drill resolves all ${ROSTER.seats.length} seats for all ${OUTAGES.length} outages — ` +
      `${drill.results.length} resolutions — because a roster where 6 seats have working cover ` +
      `and the 7th does not passes any sampling.`,
  )
  w()
  w(`Unheld seats across the drill: ${drill.findings.length}.`)
  w()
  w(bullet(drill.findings))
  w()
  w("Coverage lost by the seat under test when its rota window is also out:")
  w()
  const under = ROSTER.seats.find((s) => s.seat === "identity-lead")
  const lost = coverageUnderOutage(under, OUTAGES[2].unavailable)
  w(
    `- before: ${lost.coveredMinutesBefore} minutes of the 1440-minute day; after: ` +
      `${lost.coveredMinutesAfter}; lost: ${lost.lostMinutes} — the EMEA window exactly. A rota ` +
      `with no gaps and one person per window has 24 hours of coverage and zero hours of resilience.`,
  )
  w()
  w(`Handoff findings across the drill: ${handoff.length}.`)
  w()
  w(bullet(handoff))
  w()

  // ── refusals ─────────────────────────────────────────────────────────────
  w("## Refusals")
  w()
  w("Each row mutates the worked hypercare above in exactly ONE way and reports what refused it.")
  w("One at a time because two mutations can mask each other, and a scenario that trips three")
  w("rules proves that something refused it rather than that this rule did.")
  w()
  w("| Scenario | Requirement | Mutation | Refused by |")
  w("| --- | --- | --- | --- |")
  for (const refusal of REFUSALS) {
    const out = refusal.run()
    // A readiness row is identified by criterion AND verdict: `BLOCKED` alone
    // does not say which of §13.5's seven refused, and a refusal scenario whose
    // evidence is one word is a scenario that would pass against the wrong rule.
    const codes = [...new Set(out.map((p) => p.reason ?? (p.criterion ? `${p.criterion}:${p.verdict}` : p.verdict ?? "?")))]
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
      console.error(`${DOC} is stale. Run: node tools/hypercare-service-transition.mjs`)
      process.exit(1)
    }
    console.log(`${DOC} is up to date.`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rendered)
    console.log(`wrote ${DOC} (${rendered.split("\n").length} lines)`)
  }
}
