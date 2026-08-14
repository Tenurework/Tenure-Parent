/**
 * A line diff, computed rather than approximated.
 *
 * ## Why a real longest-common-subsequence and not a zip
 *
 * The cheap version walks both files in step and calls every differing line a
 * change. On a manifest where one key was INSERTED that reports every remaining
 * line as modified — twenty-eight changes where there is one — and an operator
 * reviewing a change plan cannot tell which of the twenty-eight is real. In a
 * console whose whole job is "what exactly will this change", that is not a
 * cosmetic defect.
 *
 * So this is the standard dynamic-programming LCS, which is O(n·m) in time and
 * memory. That is fine for what it is used on — a rendered manifest, a policy
 * document, a plan — and it is capped: over `MAX_LINES` the diff refuses and
 * says so, rather than allocating a hundred million cells inside a request.
 * A refusal an operator can read beats a page that never responds.
 *
 * ## Trailing whitespace is a change
 *
 * Lines are compared exactly. A trailing space in a policy document is a real
 * difference to a hash, to a signature and to a digest comparison, and a diff
 * that hides it is a diff that disagrees with `ManifestDigest`.
 */

export type DiffKind = "context" | "added" | "removed"

export interface DiffRow {
  kind: DiffKind
  /** 1-based line number in the BEFORE text, or null for an added line. */
  before: number | null
  /** 1-based line number in the AFTER text, or null for a removed line. */
  after: number | null
  text: string
}

export interface DiffResult {
  rows: readonly DiffRow[]
  added: number
  removed: number
  /** True when the inputs were too large to diff and `rows` is empty. */
  refused: boolean
}

/**
 * The cell cap. 4,000,000 cells is a 2000×2000 diff, which measures in tens of
 * milliseconds; beyond it the answer is a refusal.
 */
export const MAX_DIFF_CELLS = 4_000_000

function lines(text: string): string[] {
  // A trailing newline produces a final empty line in every editor's model, and
  // dropping it makes "file ends with a newline" invisible — which is a real
  // difference in a signed document.
  return text.split("\n")
}

export function diffLines(before: string, after: string): DiffResult {
  const a = lines(before)
  const b = lines(after)
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) {
    return { rows: [], added: 0, removed: 0, refused: true }
  }

  // table[i][j] = length of the LCS of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", before: i + 1, after: j + 1, text: a[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ kind: "removed", before: i + 1, after: null, text: a[i] })
      removed += 1
      i += 1
    } else {
      rows.push({ kind: "added", before: null, after: j + 1, text: b[j] })
      added += 1
      j += 1
    }
  }
  while (i < a.length) {
    rows.push({ kind: "removed", before: i + 1, after: null, text: a[i] })
    removed += 1
    i += 1
  }
  while (j < b.length) {
    rows.push({ kind: "added", before: null, after: j + 1, text: b[j] })
    added += 1
    j += 1
  }

  return { rows, added, removed, refused: false }
}

/**
 * The sentence above a diff.
 *
 * Written out in words because a "+12 −3" pair is meaning carried by two glyphs
 * and a colour, which Bible §26.3.2 forbids, and because "no change" is a
 * genuinely different answer from "0 added, 0 removed" — the second is what a
 * broken diff also reports.
 */
export function describeDiff(result: DiffResult): string {
  if (result.refused) return "Too large to compare line by line."
  if (result.added === 0 && result.removed === 0) return "No change."
  const parts: string[] = []
  if (result.added) parts.push(`${result.added} line${result.added === 1 ? "" : "s"} added`)
  if (result.removed) parts.push(`${result.removed} line${result.removed === 1 ? "" : "s"} removed`)
  return `${parts.join(", ")}.`
}
