import { DataTable } from "@/components/ui/DataTable"
import type { DocContent, PptxSlide, SheetData } from "@/components/documents/types"

/**
 * Read-only renderer for every `DocContent` kind. Shared by the full-page
 * /view route (server component) and the viewer overlay's view mode (client).
 * Pure/presentational — no hooks, no server-only imports — so it renders in
 * both environments. `onMediaError` lets the client overlay recover expired
 * presigned URLs; the server page simply omits it.
 */
export function DocContentView({
  content,
  title,
  onMediaError,
}: {
  content: DocContent
  title: string
  onMediaError?: () => void
}) {
  switch (content.kind) {
    case "unconfigured":
      return (
        <p className="text-sm text-text-2">
          Document storage is not configured in this environment.
        </p>
      )

    case "pdf":
      return (
        <iframe
          src={content.url}
          title={title}
          onError={onMediaError}
          className="w-full rounded-md border border-border bg-base"
          style={{ height: "72vh" }}
        />
      )

    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={content.url}
          alt={title}
          onError={onMediaError}
          className="max-w-full rounded-md border border-border"
        />
      )

    case "html":
      return (
        <div
          className="prose-doc text-sm text-text-1 space-y-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-[1rem] [&_h2]:font-semibold [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_a]:text-[--text-link]"
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      )

    case "sheets":
      return <SheetTables sheets={content.sheets} />

    case "text":
      return (
        <pre className="max-h-[70vh] overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-base p-4 text-xs text-text-1">
          {content.text}
        </pre>
      )

    case "pptx":
      return <PptxOutline slides={content.slides} />

    case "unsupported":
      return <p className="text-sm text-text-2">{content.reason}</p>
  }
}

/**
 * TTES-020-002-GRID. A spreadsheet's first row IS its header row, and this
 * used to render it as six more `<td>`s in a `<tbody>` with no `<thead>`, no
 * `scope` and no caption — so a reader arriving at cell D17 of a budget was
 * never told which column it was in. Through `DataTable` the header row becomes
 * real `<th scope="col">` and the sheet's name becomes the table's caption.
 *
 * Not sortable: re-ordering somebody's spreadsheet rows changes what the
 * document says. `DataTable` only offers sorting when a `sortHref` is supplied,
 * so declining it here is the whole of the decision.
 */
type SheetRow = { cells: (string | number | null)[]; index: number }

function SheetTables({ sheets }: { sheets: SheetData[] }) {
  if (sheets.length === 0) {
    return <p className="text-sm text-text-2">This spreadsheet has no readable sheets.</p>
  }
  return (
    <div className="space-y-6">
      {sheets.map((sheet) => {
        const [headerRow = [], ...bodyRows] = sheet.rows
        // A ragged sheet is normal — a row can be longer than the header row.
        // Column count is the widest row, so no cell is dropped.
        const width = Math.max(headerRow.length, ...sheet.rows.map((r) => r.length), 1)
        const rows: SheetRow[] = bodyRows.map((cells, index) => ({ cells, index }))
        return (
          <div key={sheet.name}>
            {sheets.length > 1 && (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">
                {sheet.name}
              </p>
            )}
            <DataTable
              caption={`${sheet.name} — ${rows.length} rows`}
              rows={rows}
              rowKey={(r) => `row-${r.index}`}
              className="rounded-md border border-border"
              tableClassName="text-xs text-text-1"
              columns={Array.from({ length: width }, (_, j) => ({
                key: `col-${j}`,
                header:
                  headerRow[j] === null || headerRow[j] === undefined || headerRow[j] === ""
                    ? `Column ${j + 1}`
                    : String(headerRow[j]),
                className: "whitespace-nowrap border border-border px-2 py-1 tabular-nums",
                cell: (r: SheetRow) => (r.cells[j] === null || r.cells[j] === undefined ? "" : String(r.cells[j])),
              }))}
            />
          </div>
        )
      })}
    </div>
  )
}

function PptxOutline({ slides }: { slides: PptxSlide[] }) {
  if (slides.length === 0) {
    return (
      <p className="text-sm text-text-2">
        No readable slide text found — download the deck to view it.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {slides.map((slide) => (
        <div key={slide.index} className="rounded-lg border border-border bg-base/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-6 min-w-[1.5rem] place-items-center rounded-md bg-subtle px-1.5 text-xs font-semibold text-text-2">
              {slide.index}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Slide {slide.index}
            </span>
          </div>
          {slide.lines.length > 0 ? (
            <ul className="space-y-1">
              {slide.lines.map((line, i) => (
                <li
                  key={i}
                  className={
                    i === 0
                      ? "text-sm font-semibold text-text-1"
                      : "pl-3 text-sm text-text-2"
                  }
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-text-3">No text on this slide.</p>
          )}
          {slide.notes.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-3">
                Notes
              </p>
              <ul className="space-y-1">
                {slide.notes.map((note, i) => (
                  <li key={i} className="text-xs text-text-2">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
