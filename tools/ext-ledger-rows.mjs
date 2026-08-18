#!/usr/bin/env node
/**
 * One reader for execution-ledger rows: the id, the box, the sentence, the file
 * and the body underneath.
 *
 * `document-graph.mjs` already answers "what status does this id have" and that
 * answer is not repeated anywhere. What it does not expose is WHERE the row is
 * and WHAT IS UNDER IT, and two files in this directory need exactly that —
 * `ext-verification-matrix.mjs` to check §19.1's qualifiers, `ext-readiness.mjs`
 * to tell a green with evidence under it from a green with nothing. They share
 * this rather than each growing a reader, because the note this repository
 * carries about having two parsers of the same documents was written after the
 * two disagreed and the disagreement decided a requirement's status.
 *
 * The body ends at the next row head of ANY prefix. A row that ran on to the
 * end of the file would inherit its neighbour's evidence, which is the precise
 * shape of a false green.
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./document-graph.mjs"

export const LEDGER_DIR = "docs/implementation"

/** Any requirement id in the registry's two shapes. */
export const ANY_ROW_HEAD = /^- \[([ xX])\] \*\*([A-Z]{2,8}-\d{3}-\d{3}|[A-Z]{2,8}-GATE-\d+)\b[^*]*\*\*\s*—\s*(.*)$/

/**
 * @param {object} [opts]
 * @param {string} [opts.dir] absolute directory of `*-ledger.md` files
 * @param {RegExp} [opts.id]  ids to keep; the default keeps every prefix
 */
export function ledgerRows({ dir = path.join(ROOT, LEDGER_DIR), id = /./ } = {}) {
  const rows = []
  if (!fs.existsSync(dir)) return rows
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith("-ledger.md")) continue
    const rel = `${LEDGER_DIR}/${name}`
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split(/\r?\n/)
    let open = null
    const close = (endExclusive) => {
      if (!open) return
      open.body = lines.slice(open.start + 1, endExclusive).join("\n")
      if (id.test(open.id)) rows.push(open)
      open = null
    }
    for (let i = 0; i < lines.length; i++) {
      const m = ANY_ROW_HEAD.exec(lines[i])
      if (m) close(i)
      if (!m) continue
      open = {
        id: m[2],
        checked: m[1].toLowerCase() === "x",
        statement: m[3].trim(),
        ledger: rel,
        start: i,
        line: i + 1,
        body: "",
      }
    }
    close(lines.length)
  }
  return rows
}

/** The `Status:` word a row declares, or null. Bold or bare; §19.1 permits both in practice. */
export function declaredStatus(body) {
  return /^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/m.exec(body)?.[1] ?? null
}

if (process.argv[1] && path.basename(process.argv[1]) === "ext-ledger-rows.mjs") {
  const rows = ledgerRows()
  const byLedger = {}
  for (const r of rows) byLedger[r.ledger] = (byLedger[r.ledger] ?? 0) + 1
  console.log(`${rows.length} rows across ${Object.keys(byLedger).length} ledgers:`)
  for (const [l, n] of Object.entries(byLedger).sort()) console.log(`  ${String(n).padStart(5)}  ${l}`)
}
