import "./primitives.css"
import { describeDiff, diffLines, type DiffKind } from "./diff"

/**
 * Code and diff: a rendered manifest, a policy document, and the exact change
 * between two of them.
 *
 * Neither is a client component. There is nothing to interact with beyond
 * scrolling, and a server-rendered block is one that is readable before any
 * JavaScript arrives — which for the thing an operator is about to approve is
 * the right side of the trade.
 *
 * ## A scrollable block is a tab stop
 *
 * `<pre>` with `tabIndex={0}` and a name. WCAG 2.2 AA 2.1.1: a region that
 * scrolls and contains no focusable element cannot be scrolled from a keyboard,
 * and a 400-line manifest is exactly that region. The name is required for the
 * same reason a landmark's is — "region" alone, six times on a page, is nothing.
 *
 * ## The diff does not carry its meaning in colour
 *
 * Every row has a sign column that says `+` or `−` in text, a per-row word
 * ("added", "removed") for anyone who cannot see either, and only then a tint.
 * Bible §26.3.2 forbids meaning carried by colour alone, and a red/green diff is
 * the canonical example — roughly one man in twelve sees those two tints as the
 * same tint.
 *
 * ## It is a table because it is one
 *
 * Line numbers on the left, the sign, then the text. A table gives a screen
 * reader row and column structure and gives the reader a real line number to
 * quote in a review comment. `globals.css` deliberately does not give `td`
 * `overflow-wrap: anywhere` — a wide table scrolls rather than collapsing — so
 * the wrapper scrolls on its own axis and the page never does.
 */

export interface CodeBlockProps {
  /** The text. Rendered exactly, never trimmed — trailing whitespace is a difference. */
  code: string
  /**
   * What this is: "Effective manifest, tenant westfield, revision 41". Required
   * — it is the accessible name of a scrollable region and the caption a
   * reviewer quotes.
   */
  caption: string
  /** The language, for the reader. No highlighting is applied; see below. */
  language?: string
  id?: string
}

/**
 * ## No syntax highlighting
 *
 * Deliberate, and the reason is contrast rather than effort. A highlighter
 * introduces eight to twelve colours that this console's contrast audit has
 * never measured, in two themes, at two contrast settings — and the token that
 * fails is always the comment colour, which is where the operator's own note
 * about why a change was made ends up. Structure is carried by the caption, the
 * line numbers and the diff signs instead.
 */
export function CodeBlock({ code, caption, language, id }: CodeBlockProps) {
  const captionId = `${id ?? "code"}-caption`
  return (
    <figure data-md3="code" id={id}>
      <figcaption id={captionId} data-md3="code-caption" className="md3-label-medium">
        {caption}
        {language ? <span data-md3="code-language"> · {language}</span> : null}
      </figcaption>
      <pre
        data-md3="code-body"
        className="md3-body-small"
        tabIndex={0}
        role="region"
        aria-labelledby={captionId}
      >
        <code>{code}</code>
      </pre>
    </figure>
  )
}

const SIGN: Record<DiffKind, string> = { context: " ", added: "+", removed: "−" }
const WORD: Record<DiffKind, string> = { context: "unchanged", added: "added", removed: "removed" }

export interface DiffViewProps {
  before: string
  after: string
  /** What is being compared: "Revision 40 against revision 41". */
  caption: string
  /** Labels for the two sides, used as the line-number column headers. */
  beforeLabel?: string
  afterLabel?: string
  id?: string
}

export function DiffView({
  before,
  after,
  caption,
  beforeLabel = "Before",
  afterLabel = "After",
  id,
}: DiffViewProps) {
  const result = diffLines(before, after)
  const captionId = `${id ?? "diff"}-caption`
  const summary = describeDiff(result)

  return (
    <figure data-md3="diff" id={id}>
      <figcaption id={captionId} data-md3="code-caption" className="md3-label-medium">
        {caption}
        {/*
          The summary is a sentence in the page, not a badge. It is also what a
          reader hears first, which is the right order: how much changed, then
          what.
        */}
        <span data-md3="diff-summary" className="md3-body-small">
          {" "}
          {summary}
        </span>
      </figcaption>
      {result.refused ? null : (
        <div data-md3="diff-scroll" tabIndex={0} role="region" aria-labelledby={captionId}>
          <table data-md3="diff-table" className="md3-body-small">
            <thead>
              <tr>
                <th scope="col" data-md3="diff-lineno">
                  {beforeLabel}
                </th>
                <th scope="col" data-md3="diff-lineno">
                  {afterLabel}
                </th>
                <th scope="col" data-md3="diff-sign">
                  Change
                </th>
                <th scope="col">Line</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={`${row.kind}-${index}`} data-kind={row.kind}>
                  <td data-md3="diff-lineno">{row.before ?? ""}</td>
                  <td data-md3="diff-lineno">{row.after ?? ""}</td>
                  <td data-md3="diff-sign">
                    <span aria-hidden="true">{SIGN[row.kind]}</span>
                    {/* The word, for a reader who has neither the glyph nor the tint. */}
                    <span data-md3="sr-only">{WORD[row.kind]}</span>
                  </td>
                  <td data-md3="diff-text">{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}
