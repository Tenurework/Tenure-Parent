#!/usr/bin/env node
/**
 * Import every requirement a Bible states into an execution ledger.
 *
 * The registry measures the gap; this closes it. A requirement in no execution
 * document is invisible — not queued, not counted, not failing — so importing
 * it is not paperwork, it is the difference between 895 requirements nobody can
 * reach and 895 requirements sitting at the front of a queue marked FAIL.
 *
 * ## Additive, never regenerative
 *
 * These ledgers are where evidence gets written. A generator that rewrote them
 * would delete the record of work every time somebody ran `npm run generate` —
 * so this only ever APPENDS entries for ids no ledger mentions yet, and never
 * touches an entry that already exists. Running it twice does nothing the
 * second time.
 *
 * That is also why it is not wired into `generate`. It is a one-shot per new
 * Bible, run deliberately, and `document-graph.mjs --check` is what notices
 * when a new authority arrives and its requirements have not been imported.
 *
 * ## Everything lands as FAIL
 *
 * Import is not progress. A requirement becomes PASS when somebody builds it,
 * proves it and records the evidence — never because a script wrote a row for
 * it. Seeding these as anything other than FAIL would manufacture completion,
 * which is the exact failure the registry exists to expose.
 *
 * Usage: node tools/import-requirements.mjs [--dry-run]
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildRegistry, classify, importedIds, ledgerStatuses, ROOT } from "./document-graph.mjs"

/** Which ledger owns each prefix. One file per domain, so writers never collide. */
const LEDGER_FOR = {
  PAY: "payments-treasury-execution-ledger.md",
  WRK: "universal-work-graph-execution-ledger.md",
  CFG: "declarative-configurator-execution-ledger.md",
  INT: "integration-ecosystem-execution-ledger.md",
  CAT: "connection-composer-execution-ledger.md",
  PACK: "erp-pack-factory-execution-ledger.md",
  FIN: "financial-management-execution-ledger.md",
  TTES: "tenant-experience-execution-ledger.md",
  HCM: "people-hr-workforce-execution-ledger.md",
  OPS: "operations-cloud-execution-ledger.md",
  ANL: "analytics-reporting-execution-ledger.md",
  PLN: "planning-epm-execution-ledger.md",
  GE: "global-engine-execution-ledger.md",
  EXT: "global-engine-execution-ledger.md",
  STUDIO: "system-studio-aws-control-plane-execution-ledger.md",
  SIMON: "simon-ose-absorption-execution-ledger.md",
}

const TITLE = {
  PAY: "Payments, Treasury, Cards and the Stripe Control Plane",
  WRK: "Universal Work Graph and Workspace Connector Cloud",
  CFG: "Declarative Tenant Configurator and Deployer UX",
  INT: "Global Integration Ecosystem and Connector Certification",
  CAT: "Global Deployer Integration Catalog and Tenant Connection Composer",
  PACK: "ERP Archetype and Specialized System Pack Factory",
  FIN: "Financial Management Cloud",
  TTES: "Tenant Experience System and Product UI/UX",
  HCM: "People, HR and Workforce Cloud",
  OPS: "Operations, Supply, Manufacturing and Service Cloud",
  ANL: "Enterprise Analytics, Reporting and Visualization Cloud",
  PLN: "Planning, EPM and Decision Cloud",
}

const HEADER = (prefix, title, source) => `# ${title} — execution ledger

Every \`${prefix}-*\` requirement stated by \`${source}\`.

Seeded by \`tools/import-requirements.mjs\`. **Every entry is \`FAIL\` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes \`PASS\` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

Before this file existed these requirements were in no execution document at
all. They were not queued, not counted and not failing; they were invisible, and
invisible reads exactly like done. \`tests/architecture/document-graph.test.mjs\`
ratchets that number downward and it may only shrink.

Statuses: \`PASS\` · \`FAIL\` · \`BLOCKED_EXTERNAL\` · \`BLOCKED_ARCHITECTURE\` ·
\`NOT_APPLICABLE\`. There is no \`PARTIAL\` — an unfinished requirement stays
\`FAIL\` unless a precise external or architectural blocker exists.

`

function main() {
  const dryRun = process.argv.includes("--dry-run")
  const documents = classify()
  const rows = buildRegistry(documents, ledgerStatuses(), importedIds())
  const unimported = rows.filter((r) => !r.imported)

  const byLedger = new Map()
  const unroutable = []
  for (const r of unimported) {
    const file = LEDGER_FOR[r.prefix]
    if (!file) {
      unroutable.push(r.id)
      continue
    }
    if (!byLedger.has(file)) byLedger.set(file, [])
    byLedger.get(file).push(r)
  }

  if (unroutable.length > 0) {
    // Refused rather than dumped somewhere plausible. A requirement filed under
    // the wrong domain is worse than one filed nowhere: it looks handled.
    console.error(
      `::error::No ledger is declared for ${unroutable.length} requirement(s): ` +
        `${[...new Set(unroutable.map((i) => i.split("-")[0]))].join(", ")}. ` +
        `Add the prefix to LEDGER_FOR in tools/import-requirements.mjs.`,
    )
    process.exit(1)
  }

  let appended = 0
  for (const [file, requirements] of [...byLedger].sort()) {
    const abs = path.join(ROOT, "docs/implementation", file)
    const prefix = requirements[0].prefix
    const exists = fs.existsSync(abs)
    let body = exists ? fs.readFileSync(abs, "utf8") : HEADER(prefix, TITLE[prefix] ?? prefix, requirements[0].source_document)

    const lines = []
    for (const r of requirements) {
      // Belt and braces: never append an id the file already mentions, even if
      // the registry thought it was unimported. Appending a second entry for one
      // requirement is how a ledger starts disagreeing with itself.
      if (body.includes(r.id)) continue
      lines.push("")
      lines.push(`- [ ] **${r.id}** — ${r.statement}`)
      lines.push(`  - Status: FAIL`)
      lines.push(`  - Reason: imported from \`${r.source_document}\`; not yet implemented`)
      appended += 1
    }
    if (lines.length === 0) continue

    const next = body.replace(/\s*$/, "") + "\n" + lines.join("\n") + "\n"
    if (dryRun) {
      console.log(`${exists ? "append" : "create"} ${file}: ${lines.length / 4} requirement(s)`)
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, next)
      console.log(`${exists ? "Appended to" : "Created"} docs/implementation/${file}`)
    }
  }

  console.log(`${appended} requirement(s) ${dryRun ? "would be" : ""} imported.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
