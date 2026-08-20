#!/usr/bin/env node
/**
 * EXT-120-001 — §14's decommission inventory and retirement state machine, run
 * over a worked legacy estate.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §14.1 (inventory each of twenty-one kinds, eight facts apiece) and §14.2 (the
 * eleven-state lifecycle and its five control states).
 *
 * The scenarios are declared HERE once and read twice — this generator writes
 * `docs/architecture/legacy-retirement.md`, and
 * `tests/architecture/ext-legacy-retirement.test.mjs` re-runs the same estate
 * through the same module and asserts both the findings and that the committed
 * document is what the engine produces today.
 *
 * SPECIFICATION data, not a customer's estate: every asset id is `legacy-*`,
 * every owner is a role, no hostname, account number, certificate subject or
 * vendor name appears, and §14.4's rule that evidence "must not contain the
 * destroyed sensitive content" is why the facts below are references rather than
 * contents.
 *
 *   node tools/legacy-retirement.mjs           writes the document
 *   node tools/legacy-retirement.mjs --check    exits 1 if it is stale
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  ASSET_FACTS,
  ASSET_KINDS,
  CONTROL_STATES,
  RETIREMENT_STATES,
  dependencyCycles,
  inventoryProblems,
  kindCoverage,
  nextState,
  transitionProblems,
} from "../packages/provisioning/src/decommission-inventory.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const DOC = "docs/architecture/legacy-retirement.md"

export const TENANT = "example-district"

/**
 * One inventoried asset, with §14.1's eight facts filled completely rather than
 * plausibly.
 *
 * As in the cutover generators' `task()` and `seat()`, the defaults exist so
 * each refusal scenario overrides exactly ONE fact — which is what keeps a
 * scenario from proving two things at once.
 */
const asset = (id, kind, over = {}) => ({
  id,
  kind,
  owner: "legacy-service-owner",
  users: ["finance office", "registrar"],
  dependencies: [],
  dataClasses: ["student records", "financial transactions"],
  retentionOrHold: "7-year records retention; no legal hold in force",
  authoritativeRecords: "authority moved to Tenure at cutover; this holds history only",
  cost: "USD 1,180 / month",
  targetDisposition: "archive then destroy after the rollback window closes",
  state: "DISCOVERED",
  controls: [],
  ...over,
})

/**
 * A worked estate covering every one of §14.1's twenty-one kinds.
 *
 * Twenty-one assets and not more: §14.1 requires each KIND to be inventoried,
 * not each kind to have five instances, and a fixture with a hundred rows would
 * prove that the loop runs. The states are spread across §14.2's chain so the
 * document shows a retirement in progress rather than a list at rest.
 */
export const INVENTORY = [
  asset("legacy-sis", "APPLICATION", {
    state: "READ_ONLY",
    controls: ["ROLLBACK_WINDOW"],
    dependencies: ["legacy-sis-db", "legacy-nightly-export", "legacy-enrolment-report"],
    users: ["registrar", "finance office", "every teaching seat"],
  }),
  asset("legacy-sis-db", "DATABASE", {
    state: "READ_ONLY",
    controls: ["ROLLBACK_WINDOW"],
    dependencies: ["legacy-db-host", "legacy-db-volume"],
  }),
  asset("legacy-db-host", "SERVER", { state: "CHANGE_FROZEN", dependencies: [] }),
  asset("legacy-db-volume", "STORAGE_VOLUME", { state: "CHANGE_FROZEN", dependencies: ["legacy-db-host"] }),
  asset("legacy-shared-drive", "FILE_SHARE", {
    state: "ARCHIVING",
    dependencies: [],
    dataClasses: ["scanned correspondence"],
  }),
  asset("legacy-sis-to-ledger", "INTEGRATION", {
    state: "RETIREMENT_APPROVED",
    dependencies: ["legacy-sis-db"],
  }),
  asset("legacy-nightly-export", "BATCH_JOB", {
    state: "RETIREMENT_APPROVED",
    dependencies: ["legacy-sis-db", "legacy-sftp-account"],
  }),
  asset("legacy-sftp-account", "SERVICE_ACCOUNT", {
    state: "DEPENDENCY_MAPPED",
    controls: ["BLOCKED_DEPENDENCY"],
    dependencies: [],
  }),
  asset("legacy-tls-cert", "CERTIFICATE_OR_KEY", {
    state: "DEPENDENCY_MAPPED",
    dependencies: ["legacy-db-host"],
    retentionOrHold: "no retention; revoke at ACCESS_REVOKING",
  }),
  asset("legacy-dns-a-record", "DNS_ENTRY", { state: "DEPENDENCY_MAPPED", dependencies: ["legacy-db-host"] }),
  asset("legacy-inbound-rule", "FIREWALL_RULE", { state: "DEPENDENCY_MAPPED", dependencies: ["legacy-db-host"] }),
  asset("legacy-event-queue", "QUEUE_OR_TOPIC", { state: "DISCOVERED", dependencies: [] }),
  asset("legacy-enrolment-report", "REPORT", { state: "RETIREMENT_APPROVED", dependencies: ["legacy-sis-db"] }),
  asset("legacy-desktop-client", "DESKTOP_CLIENT", { state: "CHANGE_FROZEN", dependencies: ["legacy-sis"] }),
  asset("legacy-parent-app", "MOBILE_APP", { state: "CHANGE_FROZEN", dependencies: ["legacy-sis"] }),
  asset("legacy-records-archive", "ARCHIVE", {
    state: "READ_ONLY",
    controls: ["LEGAL_HOLD"],
    dependencies: [],
    retentionOrHold: "legal hold in force pending a records request",
  }),
  asset("legacy-nightly-backup", "BACKUP", {
    state: "READ_ONLY",
    controls: ["RETENTION_ONLY"],
    dependencies: ["legacy-sis-db"],
    retentionOrHold: "35-day rolling retention; disposition follows the approved schedule",
  }),
  asset("legacy-uptime-alarm", "MONITORING_RULE", { state: "ACCESS_REVOKING", dependencies: ["legacy-db-host"] }),
  asset("legacy-support-contract", "VENDOR_CONTRACT_OR_LICENSE", {
    state: "CONTRACT_CLOSED",
    dependencies: [],
    cost: "USD 24,000 / year, terminated at the next renewal date",
  }),
  asset("legacy-archive-bucket", "CLOUD_RESOURCE", {
    state: "VERIFIED",
    dependencies: [],
    cost: "USD 42 / month, verified against delayed billing data",
  }),
  asset("legacy-scanner", "PHYSICAL_DEVICE", {
    state: "DESTROYING",
    dependencies: [],
    targetDisposition: "sanitized to the approved standard by the contracted vendor; certificate on file",
  }),
]

/**
 * The kinds this estate genuinely has none of, each with the reason.
 *
 * Every kind is populated in `INVENTORY` above, so this list is empty for the
 * worked estate — and that is deliberate: the refusal scenario below removes a
 * kind WITHOUT adding a survey note, which is the shape §14.1's "inventory each"
 * is written against. The parameter exists because a real estate will have kinds
 * with nothing in them, and the difference between that and an unasked question
 * is the entire point of `kindCoverage`.
 */
export const SURVEYED = []

/** Transitions attempted against the estate, permitted and refused alike. */
export const TRANSITIONS = [
  {
    id: "archive-after-window",
    asset: "legacy-shared-drive",
    from: "READ_ONLY",
    to: "ARCHIVING",
    controls: [],
    what: "The normal next step for a source whose rollback window has closed.",
  },
  {
    id: "archive-inside-rollback-window",
    asset: "legacy-sis",
    from: "READ_ONLY",
    to: "ARCHIVING",
    controls: ["ROLLBACK_WINDOW"],
    what: "The same step attempted while the source is still the fallback.",
  },
  {
    id: "destroy-under-legal-hold",
    asset: "legacy-records-archive",
    from: "ACCESS_REVOKING",
    to: "DESTROYING",
    controls: ["LEGAL_HOLD"],
    what: "Destruction of an asset whose records are under hold.",
  },
  {
    id: "destroy-under-retention",
    asset: "legacy-nightly-backup",
    from: "ACCESS_REVOKING",
    to: "DESTROYING",
    controls: ["RETENTION_ONLY"],
    what: "Destruction of a backup kept deliberately for a retention schedule.",
  },
  {
    id: "approve-with-blocked-dependency",
    asset: "legacy-sftp-account",
    from: "DEPENDENCY_MAPPED",
    to: "RETIREMENT_APPROVED",
    controls: ["BLOCKED_DEPENDENCY"],
    what: "Approving retirement while something still depends on it.",
  },
  {
    id: "skip-to-verified",
    asset: "legacy-shared-drive",
    from: "READ_ONLY",
    to: "VERIFIED",
    controls: [],
    what: "A jump past archiving, revocation and destruction.",
  },
  {
    id: "resurrect-a-destroyed-asset",
    asset: "legacy-scanner",
    from: "DESTROYING",
    to: "READ_ONLY",
    controls: [],
    what: "A move back down the chain after destruction started.",
  },
  {
    id: "advance-while-aborted",
    asset: "legacy-event-queue",
    from: "DISCOVERED",
    to: "DEPENDENCY_MAPPED",
    controls: ["ABORTED"],
    what: "Any forward move on a retirement somebody stopped.",
  },
]

const without = (object, key) => {
  const copy = { ...object }
  delete copy[key]
  return copy
}

/** Each row mutates the estate above in exactly ONE way. */
export const REFUSALS = [
  {
    id: "kind-not-surveyed",
    requirement: "EXT-120-001",
    what: "The service-account row removed, with no survey saying there are none.",
    run: () =>
      kindCoverage(
        INVENTORY.filter((a) => a.id !== "legacy-sftp-account"),
        SURVEYED,
      ).problems,
  },
  {
    id: "survey-unreasoned",
    requirement: "EXT-120-001",
    what: "The same absence declared surveyed, with no reason for the emptiness.",
    run: () =>
      kindCoverage(INVENTORY.filter((a) => a.id !== "legacy-sftp-account"), [
        { kind: "SERVICE_ACCOUNT" },
      ]).problems,
  },
  {
    id: "fact-missing",
    requirement: "EXT-120-001",
    what: "An asset with no recorded owner.",
    run: () =>
      inventoryProblems(INVENTORY.map((a) => (a.id === "legacy-sis" ? without(a, "owner") : a))),
  },
  {
    id: "dangling-dependency",
    requirement: "EXT-120-001",
    what: "A dependency on something outside the inventory.",
    run: () =>
      inventoryProblems(
        INVENTORY.map((a) =>
          a.id === "legacy-sis" ? { ...a, dependencies: [...a.dependencies, "legacy-unknown-box"] } : a,
        ),
      ),
  },
  {
    id: "dependency-unmapped",
    requirement: "EXT-120-001",
    what: "An asset past DISCOVERED with no dependency list at all — not an empty one, none.",
    run: () =>
      inventoryProblems(
        INVENTORY.map((a) => (a.id === "legacy-shared-drive" ? without(a, "dependencies") : a)),
      ),
  },
  {
    id: "dependency-cycle",
    requirement: "EXT-120-001",
    what: "Two assets that depend on each other, so no retirement order exists.",
    run: () =>
      inventoryProblems(
        INVENTORY.map((a) =>
          a.id === "legacy-db-host" ? { ...a, dependencies: ["legacy-db-volume"] } : a,
        ),
      ).filter((p) => p.reason === "dependency-cycle"),
  },
  {
    id: "duplicate-asset",
    requirement: "EXT-120-001",
    what: "One thing inventoried twice.",
    run: () =>
      inventoryProblems([...INVENTORY, { ...INVENTORY[0] }]).filter(
        (p) => p.reason === "duplicate-asset",
      ),
  },
  {
    id: "unknown-kind",
    requirement: "EXT-120-001",
    what: "A kind invented in the register, which no §14.3 gate was written for.",
    run: () =>
      inventoryProblems(
        INVENTORY.map((a) => (a.id === "legacy-scanner" ? { ...a, kind: "PRINTER" } : a)),
      ).filter((p) => p.reason === "unknown-kind"),
  },
  {
    id: "control-state-as-lifecycle-state",
    requirement: "EXT-120-001",
    what: "LEGAL_HOLD used as a position on the chain rather than a flag beside it.",
    run: () => transitionProblems("READ_ONLY", "LEGAL_HOLD", []),
  },
]

const bullet = (problems) =>
  problems.length === 0
    ? "_no findings_"
    : problems
        .map((p) => `- \`${p.reason}\` — ${p.detail}`)
        .join("\n")

export function render() {
  const coverage = kindCoverage(INVENTORY, SURVEYED)
  const findings = inventoryProblems(INVENTORY)
  const cycles = dependencyCycles(INVENTORY)

  const lines = []
  const w = (s = "") => lines.push(s)

  w("# Legacy retirement — the inventory and the state machine, over a worked estate")
  w()
  w("**Generated by `tools/legacy-retirement.mjs`. Do not edit by hand.**")
  w("`tests/architecture/ext-legacy-retirement.test.mjs` fails if this file is stale.")
  w()
  w("Authority: [`Tenure_Global_ERP_Implementation_Extension_v1.0.md`](./Tenure_Global_ERP_Implementation_Extension_v1.0.md) §14.1 and §14.2.")
  w("Requirement: EXT-120-001 — the asset/dependency/data/owner/cost/contract/license inventory")
  w("and the retirement state machine. The individual §14.3 gates are EXT-120-002 through -009 and")
  w("are NOT claimed by this document.")
  w()
  w("Nothing here destroys anything. This is the register and its transition rules;")
  w("`transitionProblems` decides whether a move is permitted and no function performs one. §14.3's")
  w("own text says of hardware \"do not direct Claude to physically destroy hardware\", and the same")
  w("restraint applies to every other disposition.")
  w()

  w("## Every kind was surveyed (EXT-120-001)")
  w()
  w(`§14.1's verb is "inventory each", and it names ${ASSET_KINDS.length} kinds. A kind with`)
  w("assets is surveyed by having them; a kind with none must SAY so, with a reason. A kind")
  w("nobody mentions is `kind-not-surveyed` — an absent row and an absent asset look identical")
  w("in every report ever printed, and this is the one check that tells them apart.")
  w()
  w("| Kind | Assets | Surveyed | If none, why |")
  w("| --- | --- | --- | --- |")
  for (const row of coverage.rows) {
    w(`| \`${row.kind}\` | ${row.count} | ${row.surveyed ? "yes" : "**no**"} | ${row.note ?? "—"} |`)
  }
  w()
  w(`Coverage findings: ${coverage.problems.length}.`)
  w()
  w(bullet(coverage.problems))
  w()

  w("## The estate (EXT-120-001)")
  w()
  w(`${INVENTORY.length} assets, each carrying §14.1's ${ASSET_FACTS.length} facts:`)
  w(`${ASSET_FACTS.map((f) => f.phrase).join(", ")}.`)
  w()
  w("| Asset | Kind | State | Controls | Depends on |")
  w("| --- | --- | --- | --- | --- |")
  for (const item of INVENTORY) {
    w(
      `| \`${item.id}\` | ${item.kind} | ${item.state} | ` +
        `${item.controls.length === 0 ? "—" : item.controls.map((c) => `\`${c}\``).join(", ")} | ` +
        `${item.dependencies.length === 0 ? "—" : item.dependencies.length} |`,
    )
  }
  w()
  w(`Inventory findings: ${findings.length}. Dependency cycles: ${cycles.length}.`)
  w()
  w(bullet(findings))
  w()

  w("## The state machine (EXT-120-001)")
  w()
  w(`§14.2's chain, ${RETIREMENT_STATES.length} states:`)
  w()
  w(`\`${RETIREMENT_STATES.join(" → ")}\``)
  w()
  w(`Its ${CONTROL_STATES.length} control states are flags held ALONGSIDE a lifecycle state, not`)
  w("positions on the chain — an asset under legal hold is still at whatever state it reached, and")
  w("modelling the hold as a state would lose that position the moment the hold landed.")
  w()
  w("| Control | Blocks advancing out of | Because |")
  w("| --- | --- | --- |")
  for (const control of CONTROL_STATES) {
    w(`| \`${control.key}\` | ${control.blocksFrom ?? "_any state_"} | ${control.because} |`)
  }
  w()
  w("| Attempt | Asset | Move | Controls | Verdict |")
  w("| --- | --- | --- | --- | --- |")
  for (const attempt of TRANSITIONS) {
    const problems = transitionProblems(attempt.from, attempt.to, attempt.controls)
    const verdict =
      problems.length === 0
        ? "permitted"
        : problems.map((p) => `\`${p.reason}\``).join(", ")
    w(
      `| \`${attempt.id}\` | \`${attempt.asset}\` | ${attempt.from} → ${attempt.to} | ` +
        `${attempt.controls.length === 0 ? "—" : attempt.controls.join(", ")} | ${verdict} |`,
    )
  }
  w()
  w(
    `The chain's own next step is derived, not listed twice: \`nextState("READ_ONLY")\` is ` +
      `\`${nextState("READ_ONLY")}\` and \`nextState("${RETIREMENT_STATES[RETIREMENT_STATES.length - 1]}")\` ` +
      `is \`null\` — the end of the chain, which is a different answer from an unknown state.`,
  )
  w()

  w("## Refusals")
  w()
  w("Each row mutates the estate above in exactly ONE way and reports what refused it. One at a")
  w("time because two mutations can mask each other, and a scenario that trips three rules proves")
  w("that something refused it rather than that this rule did.")
  w()
  w("| Scenario | Requirement | Mutation | Refused by |")
  w("| --- | --- | --- | --- |")
  for (const refusal of REFUSALS) {
    const out = refusal.run()
    const codes = [...new Set(out.map((p) => p.reason ?? "?"))]
    w(`| \`${refusal.id}\` | ${refusal.requirement} | ${refusal.what} | ${codes.map((c) => `\`${c}\``).join(", ")} |`)
  }
  w()

  return `${lines.join("\n")}\n`
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const target = path.join(ROOT, DOC)
  const rendered = render()
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (current !== rendered) {
      console.error(`${DOC} is stale. Run: node tools/legacy-retirement.mjs`)
      process.exit(1)
    }
    console.log(`${DOC} is up to date.`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rendered)
    console.log(`wrote ${DOC} (${rendered.split("\n").length} lines)`)
  }
}
