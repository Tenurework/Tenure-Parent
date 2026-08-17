/**
 * EXT-100-004 — the cutover time horizons, computed from one tenant's own T0.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.4
 * is explicit that the requirement is not a fixed calendar: "Exact timing is
 * tenant-specific, but plans must cover:" and then five horizons, each with its
 * own list of what it has to cover. So a hard-coded set of dates would fail the
 * sentence rather than satisfy it, and a set of horizon *names* with nothing
 * behind them would satisfy neither half.
 *
 * This module is therefore two things: arithmetic from a tenant's `t0` to five
 * dated windows, and the coverage list §12.4 names for each, checked against the
 * tasks a plan actually carries.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * See the header of `connection-cardinality.mjs`: both readers — `node --test`
 * via `tools/run-platform-tests.mjs` and the generator that writes
 * `docs/architecture/cutover-command-center.md` — must load it on Node 20, which
 * CI pins and which cannot load TypeScript. The package's `main`/`exports` are
 * unchanged.
 *
 * ── Why the windows are half-open and contiguous ───────────────────────────
 *
 * `[T0-90, T0-30)`, `[T0-30, T0-7)`, `[T0-7, T0)`, `[T0, T0+1)`, `[T0+1, ∞)`.
 * Contiguous so no date inside the program falls between two horizons — a task
 * dated at exactly T0-30 belongs to the T-30 horizon, and before this the
 * obvious alternative (closed windows on both ends) put it in two. Half-open so
 * it belongs to exactly one without a tie-break rule that a reader has to know.
 *
 * `T_PLUS` has no end. §12.4's last horizon is "T+1 hour/day/week", which names
 * three depths of the same open-ended period and no boundary; inventing one
 * would be inventing a hypercare exit date the document does not give, and
 * §13.5 says that date comes from exit criteria being met, not from a countdown.
 *
 * ── UTC, and why that is not a detail ──────────────────────────────────────
 *
 * Every computation here is UTC day arithmetic on an ISO date. §12.2 requires
 * time-zone coverage to be explicit for the command seats, which is a different
 * problem: the seats span zones, and the horizon a task falls in must not.
 * A local-midnight boundary would put the same task in different horizons
 * depending on where the reader is sitting.
 */

const DAY_MS = 86_400_000

/**
 * §12.4's five horizons, in the document's order, with what each must cover.
 *
 * `covers` entries are the document's own phrases, reduced to keys so a plan can
 * declare which topic a task covers and a missing one is a name rather than a
 * judgement. The phrase is kept beside the key so the list can be checked
 * against §12.4 instead of trusted.
 */
export const HORIZONS = Object.freeze([
  Object.freeze({
    key: "T_MINUS_90",
    label: "T-90 to T-30",
    startOffsetDays: -90,
    endOffsetDays: -30,
    covers: Object.freeze([
      Object.freeze({ key: "freeze_strategy", phrase: "scope/config freeze strategy" }),
      Object.freeze({ key: "final_adapters", phrase: "final adapters" }),
      Object.freeze({ key: "uat", phrase: "UAT" }),
      Object.freeze({ key: "training", phrase: "training" }),
      Object.freeze({ key: "support", phrase: "support" }),
      Object.freeze({ key: "data_cleanup", phrase: "data cleanup" }),
      Object.freeze({ key: "certification", phrase: "bank/provider certification" }),
      Object.freeze({ key: "dr_rollback", phrase: "DR/rollback" }),
      Object.freeze({ key: "rehearsal", phrase: "rehearsal" }),
    ]),
  }),
  Object.freeze({
    key: "T_MINUS_30",
    label: "T-30 to T-7",
    startOffsetDays: -30,
    endOffsetDays: -7,
    covers: Object.freeze([
      Object.freeze({ key: "final_readiness", phrase: "final readiness" }),
      Object.freeze({ key: "access_rosters", phrase: "access rosters" }),
      Object.freeze({ key: "certificates_secrets", phrase: "certificates/secrets" }),
      Object.freeze({ key: "capacity", phrase: "capacity" }),
      Object.freeze({ key: "communications", phrase: "communications" }),
      Object.freeze({ key: "rehearsal_results", phrase: "final rehearsal results" }),
      Object.freeze({ key: "open_defects", phrase: "open defects/risks" }),
      Object.freeze({ key: "command_staffing", phrase: "command staffing" }),
      Object.freeze({ key: "production_plans", phrase: "production plans" }),
    ]),
  }),
  Object.freeze({
    key: "T_MINUS_7",
    label: "T-7 to T-1",
    startOffsetDays: -7,
    endOffsetDays: 0,
    covers: Object.freeze([
      Object.freeze({ key: "change_freeze", phrase: "controlled change freeze" }),
      Object.freeze({ key: "source_health", phrase: "final source health" }),
      Object.freeze({ key: "delta_checks", phrase: "delta checks" }),
      Object.freeze({ key: "backups", phrase: "backups" }),
      Object.freeze({ key: "artifact_digests", phrase: "artifact/config digests" }),
      Object.freeze({ key: "approvals", phrase: "approvals" }),
      Object.freeze({ key: "customer_notice", phrase: "customer notice" }),
      Object.freeze({ key: "no_surprise_review", phrase: "no-surprise review" }),
    ]),
  }),
  Object.freeze({
    key: "T0",
    label: "T0 window",
    startOffsetDays: 0,
    endOffsetDays: 1,
    covers: Object.freeze([
      Object.freeze({ key: "stop_integrations", phrase: "stop/sequence integrations" }),
      Object.freeze({ key: "source_freeze", phrase: "source freeze" }),
      Object.freeze({ key: "final_extracts", phrase: "final extracts/deltas" }),
      Object.freeze({ key: "conversion", phrase: "conversion" }),
      Object.freeze({ key: "reconciliation", phrase: "reconciliation" }),
      Object.freeze({ key: "deploy_promote", phrase: "deploy/promote" }),
      Object.freeze({ key: "identity_sso", phrase: "identity/SSO" }),
      Object.freeze({ key: "integration_enablement", phrase: "integration enablement" }),
      Object.freeze({ key: "smoke_isolation", phrase: "smoke/security/isolation" }),
      Object.freeze({ key: "go_no_go", phrase: "go/no-go" }),
      Object.freeze({ key: "activation", phrase: "activation" }),
      Object.freeze({ key: "user_release", phrase: "user release" }),
    ]),
  }),
  Object.freeze({
    key: "T_PLUS",
    label: "T+1 hour/day/week",
    startOffsetDays: 1,
    /** Open. §12.4 gives no end and §13.5 says the exit comes from criteria. */
    endOffsetDays: null,
    covers: Object.freeze([
      Object.freeze({ key: "transaction_monitoring", phrase: "transaction monitoring" }),
      Object.freeze({ key: "business_validation", phrase: "business validation" }),
      Object.freeze({ key: "period_controls", phrase: "batch/statement/payroll/finance controls" }),
      Object.freeze({ key: "issue_triage", phrase: "issue triage" }),
      Object.freeze({ key: "communications", phrase: "communications" }),
      Object.freeze({ key: "adoption", phrase: "adoption and stabilization" }),
    ]),
  }),
])

const HORIZON_KEYS = Object.freeze(HORIZONS.map((h) => h.key))

/** An ISO calendar date (`YYYY-MM-DD`) as a UTC millisecond instant, or NaN. */
function utcDay(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) return NaN
  // Date.parse accepts 2026-02-30 on some engines by rolling over. Round-trip
  // it so an impossible date is rejected rather than silently moved.
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : NaN
}

const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10)

/**
 * The five horizons as this tenant's actual dates.
 *
 * `t0` is the tenant's own go-live date, and nothing here has a default: a
 * horizon table computed from today would be a different table tomorrow, and a
 * plan whose dates move on their own is the "stale spreadsheet" §12.1 refuses.
 *
 * Returns `{ known: false, why }` when `t0` is absent or not a real calendar
 * date, rather than an empty table. An empty table reads as "this tenant has no
 * horizons", which is a different claim from "nobody has set a go-live date".
 */
export function horizonWindows(t0) {
  const base = utcDay(t0)
  if (Number.isNaN(base)) {
    return Object.freeze({
      known: false,
      why:
        `"${t0}" is not a calendar date (YYYY-MM-DD). §12.4's horizons are all relative to a ` +
        `tenant-specific T0, so with no T0 there is no window to place a task in — and a ` +
        `default would silently invent a go-live date.`,
    })
  }
  return Object.freeze({
    known: true,
    t0: isoOf(base),
    windows: Object.freeze(
      HORIZONS.map((h) =>
        Object.freeze({
          key: h.key,
          label: h.label,
          start: isoOf(base + h.startOffsetDays * DAY_MS),
          end: h.endOffsetDays === null ? null : isoOf(base + h.endOffsetDays * DAY_MS),
          covers: h.covers,
        }),
      ),
    ),
  })
}

/**
 * Which horizon a date falls in, for one tenant's T0.
 *
 * `{ known: false }` for a date before the earliest horizon: a task dated T0-200
 * is not "in T-90", it is outside every window §12.4 requires the plan to cover,
 * and placing it in the nearest one would hide a task nobody scheduled.
 */
export function horizonOf(date, t0) {
  const base = utcDay(t0)
  const at = utcDay(date)
  if (Number.isNaN(base) || Number.isNaN(at)) {
    return Object.freeze({
      known: false,
      why: `both a task date and a tenant T0 are needed; got date="${date}", t0="${t0}".`,
    })
  }
  for (const h of HORIZONS) {
    const start = base + h.startOffsetDays * DAY_MS
    const end = h.endOffsetDays === null ? Infinity : base + h.endOffsetDays * DAY_MS
    if (at >= start && at < end) return Object.freeze({ known: true, horizon: h.key })
  }
  return Object.freeze({
    known: false,
    why:
      `${date} is ${Math.round((base - at) / DAY_MS)} days before T0 (${isoOf(base)}), earlier ` +
      `than the T-90 horizon §12.4 requires the plan to cover. A task outside every window is ` +
      `unscheduled, not early.`,
  })
}

/**
 * Every way a horizon plan can fail §12.4, in a stable order.
 *
 * Four properties, and the third is the one that makes the horizons mean
 * something rather than label something:
 *
 *   1. T0 is a real tenant-specific date.
 *   2. Every task is dated inside a horizon.
 *   3. Every horizon covers every topic §12.4 lists for it. A horizon with two
 *      tasks and nine required topics is not "in progress", it is a horizon the
 *      plan does not cover, and §12.4's words are "plans must cover".
 *   4. Dependencies run forwards. A task whose prerequisite is dated later than
 *      itself is a plan that cannot execute in the order it is written, and this
 *      is the failure that a Gantt chart renders as a valid-looking bar.
 */
export function horizonProblems(plan) {
  const problems = []
  const bad = (where, reason, detail) => problems.push(Object.freeze({ where, reason, detail }))

  const windows = horizonWindows(plan?.t0)
  if (!windows.known) {
    bad("t0", "no-t0", windows.why)
    return Object.freeze(problems)
  }

  const tasks = (plan?.tasks ?? []).filter((t) => t && typeof t.id === "string" && t.id.trim())
  const byId = new Map(tasks.map((t) => [t.id.trim(), t]))
  /** horizon key → set of covered topic keys */
  const covered = new Map(HORIZON_KEYS.map((k) => [k, new Set()]))

  for (const task of tasks) {
    const id = task.id.trim()
    const placed = horizonOf(task.date, windows.t0)
    if (!placed.known) {
      bad(id, "outside-every-horizon", placed.why)
      continue
    }

    // A task may declare the horizon it believes it is in. When it does, the
    // date decides and a disagreement is reported rather than resolved: the two
    // fields are read by different audiences (the date by the runbook, the label
    // by the plan-on-a-page) and a silent mismatch means they show different
    // plans.
    if (task.horizon && task.horizon !== placed.horizon) {
      bad(
        id,
        "horizon-contradicts-date",
        `"${id}" is labelled ${task.horizon} and dated ${task.date}, which falls in ` +
          `${placed.horizon} for T0=${windows.t0}. The date decides; the label is refused ` +
          `rather than corrected, because a plan and its runbook disagreeing about when a task ` +
          `runs is how one of them is executed and the other is reported.`,
      )
    }

    const horizon = HORIZONS.find((h) => h.key === placed.horizon)
    for (const topic of task.covers ?? []) {
      if (!horizon.covers.some((c) => c.key === topic)) {
        bad(
          id,
          "unknown-coverage-topic",
          `"${topic}" is not a topic §12.4 lists for ${placed.horizon}. Its topics are: ` +
            `${horizon.covers.map((c) => c.key).join(", ")}.`,
        )
        continue
      }
      covered.get(placed.horizon).add(topic)
    }

    for (const prerequisite of task.prerequisites ?? []) {
      const upstream = byId.get(String(prerequisite).trim())
      if (!upstream) {
        bad(
          id,
          "unknown-prerequisite",
          `"${id}" depends on "${prerequisite}", which is not a task in this plan. A dependency ` +
            `on something absent is not satisfied by anything and is never reported unmet.`,
        )
        continue
      }
      const upstreamDay = utcDay(upstream.date)
      const taskDay = utcDay(task.date)
      if (!Number.isNaN(upstreamDay) && !Number.isNaN(taskDay) && upstreamDay > taskDay) {
        bad(
          id,
          "prerequisite-runs-later",
          `"${id}" is dated ${task.date} and depends on "${upstream.id}", dated ${upstream.date}. ` +
            `The plan cannot execute in the order it is written.`,
        )
      }
    }
  }

  for (const horizon of HORIZONS) {
    const missing = horizon.covers.filter((c) => !covered.get(horizon.key).has(c.key))
    if (missing.length > 0) {
      bad(
        horizon.key,
        "horizon-not-covered",
        `${horizon.label} does not cover ${missing.map((m) => m.phrase).join(", ")}. §12.4: ` +
          `"plans must cover" — ${missing.length} of ${horizon.covers.length} topics have no ` +
          `task in this horizon.`,
      )
    }
  }

  return Object.freeze(problems)
}
