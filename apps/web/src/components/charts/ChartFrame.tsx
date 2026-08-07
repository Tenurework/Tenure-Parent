"use client"

import { useId, useState, type ReactNode } from "react"

import { toCsv, type ChartTable } from "./chart-table"

/**
 * TTES-020-002-CHART-FRAME — the shared frame every chart sits in.
 *
 * Bible §11 asks a chart to carry its title, the question it answers, where the
 * numbers came from, how fresh they are, the unit, an accessible table
 * alternative and an export. The kit shipped the marks and none of the frame,
 * so a real caller dropped a bare `<LineAreaChart>` into a generic `<Card>`
 * with nothing saying which rows the count came from, as of when, or in what.
 *
 * Two decisions worth stating:
 *
 *   * **The table is built from the same `columns`/`rows` the mark is handed.**
 *     A separately-assembled table is a second source of truth that can
 *     disagree with the picture, which is worse than no table at all.
 *   * **The export goes through `csvCell`.** A club named `=HYPERLINK(...)`
 *     turns an export into an execution the moment somebody opens it; §12 names
 *     that, and `chart-table.ts` is where the rule is tested.
 *
 * The download uses a Blob URL rather than a server route: the numbers are
 * already in the browser, and round-tripping them through the server to get
 * them back would be a second query that could return a different answer.
 */
export function ChartFrame({
  title,
  question,
  source,
  asOf,
  unit,
  table,
  filters,
  comparison,
  fileName,
  children,
}: {
  title: string
  /** The question this chart answers, in the reader's words. */
  question: string
  /** Which rows the numbers came from. */
  source: string
  /** How fresh they are. An ISO instant or a rendered phrase. */
  asOf: string
  /** What one unit of the y axis IS — "events", "USD", "members". */
  unit: string
  /** The plotted values, as a table. Required: it is the chart alternative. */
  table: ChartTable
  /** Filters currently narrowing the data, if any. */
  filters?: string
  /** What the numbers are being compared against, if anything. */
  comparison?: string
  /** Base name for the downloaded file, without the extension. */
  fileName: string
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  const download = () => {
    const blob = new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${fileName}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <figure className="chart-frame m-0 rounded-[10px] border border-border bg-surface p-5" data-chart-frame={fileName}>
      <figcaption className="mb-3">
        <p className="font-display text-[15px] font-semibold text-text-1">{title}</p>
        <p className="mt-0.5 text-[13px] text-text-2">{question}</p>
        <p className="mt-1.5 text-meta text-text-3" data-chart-provenance>
          {source} · as of {asOf} · measured in {unit}
          {filters ? ` · filtered: ${filters}` : ""}
          {comparison ? ` · compared with ${comparison}` : ""}
        </p>
      </figcaption>

      {children}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-base hover:text-text-1"
        >
          {showTable ? "Hide the numbers" : "Show the numbers"}
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-base hover:text-text-1"
        >
          Download CSV
        </button>
      </div>

      {/* Always in the DOM when disclosed, and built from the plotted values.
          `hidden` rather than unmounted so the toggle's aria-controls always
          points at something that exists. */}
      <div id={tableId} hidden={!showTable} className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <caption className="pb-2 text-left text-meta text-text-3">
            {title} — {question} ({unit}). {source}, as of {asOf}.
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-text-3">
              {table.columns.map((c) => (
                <th key={c} scope="col" className="px-2 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5 text-text-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
