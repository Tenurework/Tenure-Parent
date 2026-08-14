import fs from "fs"
import path from "path"

import { test, expect } from "@playwright/test"

import {
  filterOptions,
  firstEnabled,
  isActivation,
  isDismiss,
  isTypeaheadKey,
  lastEnabled,
  listCommand,
  nextTrapStop,
  step,
  treeCommand,
  treeRows,
  typeaheadBuffer,
  typeaheadIndex,
  type ListState,
  type TreeNode,
} from "../src/components/md3/interaction"
import { describeDiff, diffLines, MAX_DIFF_CELLS } from "../src/components/md3/diff"
import { combineDateTime, formatUtc, splitIso } from "../src/components/md3/datetime"
import {
  checkFiles,
  describeSelection,
  formatBytes,
  matchesAccept,
} from "../src/components/md3/files"
import {
  DEFAULT_BOX,
  describeSeries,
  domainOf,
  niceTicks,
  scaleX,
  scaleY,
  seriesPath,
} from "../src/components/md3/chart-model"

/**
 * STUDIO-030-003 — the primitives' decisions, enumerated.
 *
 * ## Why this file has no browser in it
 *
 * A menu's keyboard model is about twenty branches: what End does when the last
 * two items are disabled, what ArrowLeft does on a collapsed tree node, whether
 * a repeated character cycles or refines. Proving each one through a rendered
 * component costs a jsdom mount per case and cannot practically cover them; and
 * a case not covered in a keyboard model is a case that is wrong, because
 * nothing on screen changes when it is.
 *
 * So the DECISIONS live in pure modules (`interaction.ts`, `diff.ts`,
 * `datetime.ts`, `files.ts`, `chart-model.ts`) and are enumerated here, and the
 * WIRING — that pressing the key really moves focus, that closing really
 * restores it, that the background really goes inert — is proven against a real
 * DOM in `src/components/md3/Primitives.test.tsx`. Neither file is sufficient
 * alone and each is worthless without the other.
 *
 * ## The last section is a guard on a guard
 *
 * `md3-tokens-logic.spec.ts` asserts that no component contains a colour and
 * that the classes in `globals.css` and the classes in the components are the
 * same set. It reads `.ts`/`.tsx` only, and it reads `globals.css` only. This
 * set of primitives ships its own co-located stylesheet, which that spec cannot
 * see — so the same two guarantees are re-asserted here over
 * `primitives.css`: no literal colour in any of the three syntaxes, and no
 * drift between the `data-md3` hooks the components emit and the ones the
 * stylesheet declares. A layer that dodges the audit is a layer that acquires a
 * second palette, and the file it happens in is never the one anybody reviews.
 */

const MD3_DIR = path.join(__dirname, "..", "src", "components", "md3")

/* ── Lists: menus, listboxes, accordion headers ───────────────────────────── */

const SIX: ListState = { index: 0, count: 6, loop: true }

test.describe("the list keyboard model", () => {
  test("ArrowDown moves forward and wraps at the end", () => {
    expect(listCommand("ArrowDown", { ...SIX, index: 0 })).toEqual({ type: "move", index: 1 })
    expect(listCommand("ArrowDown", { ...SIX, index: 5 })).toEqual({ type: "move", index: 0 })
  })

  test("ArrowUp moves back and wraps at the start", () => {
    expect(listCommand("ArrowUp", { ...SIX, index: 3 })).toEqual({ type: "move", index: 2 })
    expect(listCommand("ArrowUp", { ...SIX, index: 0 })).toEqual({ type: "move", index: 5 })
  })

  test("with nothing active, forward starts at the first and back at the last", () => {
    // The rule that decides whether ArrowUp on a closed menu opens it at the
    // top — where the operator then presses ArrowUp nine more times — or at the
    // bottom, which is what it means.
    expect(listCommand("ArrowDown", { ...SIX, index: -1 })).toEqual({ type: "move", index: 0 })
    expect(listCommand("ArrowUp", { ...SIX, index: -1 })).toEqual({ type: "move", index: 5 })
  })

  test("disabled items are stepped over, not landed on", () => {
    const state: ListState = { index: 0, count: 5, disabled: [1, 2], loop: true }
    expect(listCommand("ArrowDown", state)).toEqual({ type: "move", index: 3 })
    expect(listCommand("ArrowUp", { ...state, index: 3 })).toEqual({ type: "move", index: 0 })
  })

  test("Home and End land on the first and last ENABLED item", () => {
    const state: ListState = { index: 2, count: 5, disabled: [0, 4], loop: true }
    expect(listCommand("Home", state)).toEqual({ type: "move", index: 1 })
    expect(listCommand("End", state)).toEqual({ type: "move", index: 3 })
  })

  test("a list whose every item is disabled cannot be moved onto, and does not hang", () => {
    const state: ListState = { index: -1, count: 3, disabled: [0, 1, 2], loop: true }
    expect(firstEnabled(state)).toBe(-1)
    expect(lastEnabled(state)).toBe(-1)
    expect(step(state, 1)).toBe(-1)
  })

  test("loop:false clamps instead of wrapping", () => {
    const state: ListState = { index: 4, count: 5, loop: false }
    expect(step(state, 1)).toBe(4)
    expect(step({ ...state, index: 0 }, -1)).toBe(0)
  })

  test("a horizontal list uses left and right, and swaps them in RTL", () => {
    const ltr: ListState = { index: 1, count: 4, orientation: "horizontal", loop: true }
    expect(listCommand("ArrowRight", ltr)).toEqual({ type: "move", index: 2 })
    expect(listCommand("ArrowLeft", ltr)).toEqual({ type: "move", index: 0 })
    const rtl: ListState = { ...ltr, dir: "rtl" }
    // The keys are physical; the reading order is not. STUDIO-030-007 names RTL.
    expect(listCommand("ArrowRight", rtl)).toEqual({ type: "move", index: 0 })
    expect(listCommand("ArrowLeft", rtl)).toEqual({ type: "move", index: 2 })
  })

  test("Escape dismisses, Enter and Space activate", () => {
    expect(listCommand("Escape", SIX)).toEqual({ type: "dismiss" })
    expect(listCommand("Enter", SIX)).toEqual({ type: "activate" })
    expect(listCommand(" ", SIX)).toEqual({ type: "activate" })
  })

  test("keys the model does not claim are returned unhandled", () => {
    // The other half of the accessibility failure: a widget that swallows Tab,
    // PageDown or a browser shortcut because it had focus.
    for (const key of ["Tab", "PageDown", "F5", "a", "Control"]) {
      expect(listCommand(key, SIX), key).toEqual({ type: "none" })
    }
  })

  test("activation and dismissal accept the legacy key names too", () => {
    expect(isActivation("Spacebar")).toBe(true)
    expect(isDismiss("Esc")).toBe(true)
    expect(isTypeaheadKey(" ")).toBe(false)
    expect(isTypeaheadKey("u")).toBe(true)
    expect(isTypeaheadKey("ArrowDown")).toBe(false)
  })
})

/* ── Type-ahead ──────────────────────────────────────────────────────────── */

const REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "eu-west-1",
  "eu-central-1",
  "ap-south-1",
]

test.describe("type-to-find", () => {
  test("a growing buffer refines and does not walk past the match", () => {
    const first = typeaheadIndex(REGIONS, "e", -1)
    expect(REGIONS[first]).toBe("eu-west-1")
    // "eu-c" must find eu-central-1 from where "e" left us, not skip it.
    expect(REGIONS[typeaheadIndex(REGIONS, "eu-c", first)]).toBe("eu-central-1")
  })

  test("one character repeated cycles through the items that start with it", () => {
    let at = typeaheadIndex(REGIONS, "u", -1)
    expect(REGIONS[at]).toBe("us-east-1")
    at = typeaheadIndex(REGIONS, "uu", at)
    expect(REGIONS[at]).toBe("us-east-2")
    at = typeaheadIndex(REGIONS, "uuu", at)
    expect(REGIONS[at]).toBe("us-west-1")
    // And back round to the first.
    expect(REGIONS[typeaheadIndex(REGIONS, "uuuu", at)]).toBe("us-east-1")
  })

  test("no match leaves the caller a -1 rather than a guess", () => {
    expect(typeaheadIndex(REGIONS, "zz", 0)).toBe(-1)
    expect(typeaheadIndex(REGIONS, "", 0)).toBe(-1)
  })

  test("disabled items are never found", () => {
    expect(typeaheadIndex(REGIONS, "u", -1, [0])).toBe(1)
  })

  test("matching ignores case, because operators type in lower case", () => {
    expect(typeaheadIndex(["Westfield", "Ashbourne"], "w", -1)).toBe(0)
  })

  test("the buffer resets after a second and not before", () => {
    expect(typeaheadBuffer("us", "e", 300)).toBe("use")
    expect(typeaheadBuffer("us", "e", 1200)).toBe("e")
  })
})

/* ── Focus containment ───────────────────────────────────────────────────── */

test.describe("the focus trap's arithmetic", () => {
  test("Tab wraps at the last stop and Shift+Tab at the first", () => {
    expect(nextTrapStop(3, 2, false)).toBe(0)
    expect(nextTrapStop(3, 0, true)).toBe(2)
    expect(nextTrapStop(3, 1, false)).toBe(2)
  })

  test("focus outside the trap comes back to an end, not to nothing", () => {
    expect(nextTrapStop(3, -1, false)).toBe(0)
    expect(nextTrapStop(3, -1, true)).toBe(2)
  })

  test("a trap with no focusable content reports -1 rather than looping", () => {
    // The component then focuses its own container. Returning 0 here would be
    // an index into an empty list, which is a Tab that escapes the modal.
    expect(nextTrapStop(0, -1, false)).toBe(-1)
  })
})

/* ── Trees ───────────────────────────────────────────────────────────────── */

const TOPOLOGY: TreeNode[] = [
  {
    id: "eu",
    label: "eu-west-1",
    children: [
      { id: "eu-cell-a", label: "cell-a", children: [{ id: "eu-a-1", label: "tenant westfield" }] },
      { id: "eu-cell-b", label: "cell-b" },
    ],
  },
  { id: "us", label: "us-east-1", children: [{ id: "us-cell-a", label: "cell-a" }] },
  { id: "ap", label: "ap-south-1" },
]

test.describe("the tree model", () => {
  test("a collapsed tree is its roots, with level, setsize and position", () => {
    const rows = treeRows(TOPOLOGY, new Set())
    expect(rows.map((row) => row.id)).toEqual(["eu", "us", "ap"])
    expect(rows.map((row) => `${row.posinset}/${row.setsize}@${row.level}`)).toEqual([
      "1/3@1",
      "2/3@1",
      "3/3@1",
    ])
    expect(rows.map((row) => row.hasChildren)).toEqual([true, true, false])
  })

  test("expanding inserts the children and renumbers nothing else", () => {
    const rows = treeRows(TOPOLOGY, new Set(["eu"]))
    expect(rows.map((row) => row.id)).toEqual(["eu", "eu-cell-a", "eu-cell-b", "us", "ap"])
    const cellA = rows[1]
    expect(cellA.level).toBe(2)
    expect(cellA.posinset).toBe(1)
    expect(cellA.setsize).toBe(2)
    expect(cellA.parentId).toBe("eu")
    // `us` is still the second of three at level one; a subtree does not change
    // its siblings' announced position.
    expect(rows[3]).toMatchObject({ id: "us", posinset: 2, setsize: 3, level: 1 })
  })

  test("a collapsed node's children are absent, not hidden", () => {
    const rows = treeRows(TOPOLOGY, new Set(["eu"]))
    expect(rows.some((row) => row.id === "eu-a-1")).toBe(false)
  })

  test("ArrowRight expands a closed branch, then steps into it", () => {
    const closed = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("ArrowRight", closed, 0)).toEqual({ type: "expand", id: "eu" })
    const open = treeRows(TOPOLOGY, new Set(["eu"]))
    // The rule people leave out. Without it, ArrowRight on an open branch does
    // nothing and the subtree is unreachable by that key.
    expect(treeCommand("ArrowRight", open, 0)).toEqual({ type: "move", index: 1 })
  })

  test("ArrowLeft collapses an open branch, then walks to the parent", () => {
    const open = treeRows(TOPOLOGY, new Set(["eu"]))
    expect(treeCommand("ArrowLeft", open, 0)).toEqual({ type: "collapse", id: "eu" })
    // On a child, ArrowLeft goes UP. The other rule people leave out: without
    // it a keyboard user who descends has no way back but Home.
    expect(treeCommand("ArrowLeft", open, 2)).toEqual({ type: "move", index: 0 })
  })

  test("ArrowLeft on a root leaf does nothing rather than jumping", () => {
    const rows = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("ArrowLeft", rows, 2)).toEqual({ type: "none" })
  })

  test("the arrows swap in a right-to-left document", () => {
    const closed = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("ArrowLeft", closed, 0, "rtl")).toEqual({ type: "expand", id: "eu" })
    expect(treeCommand("ArrowRight", closed, 0, "rtl")).toEqual({ type: "none" })
  })

  test("* expands every branch at the focused level, and only branches", () => {
    const rows = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("*", rows, 0)).toEqual({ type: "expandSiblings", ids: ["eu", "us"] })
    // `ap` is a leaf and is not in the list; expanding a leaf is a promise of
    // children that do not exist.
  })

  test("Down, Up, Home and End move without wrapping", () => {
    const rows = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("ArrowDown", rows, 0)).toEqual({ type: "move", index: 1 })
    expect(treeCommand("ArrowDown", rows, 2)).toEqual({ type: "move", index: 2 })
    expect(treeCommand("ArrowUp", rows, 0)).toEqual({ type: "move", index: 0 })
    expect(treeCommand("Home", rows, 2)).toEqual({ type: "move", index: 0 })
    expect(treeCommand("End", rows, 0)).toEqual({ type: "move", index: 2 })
  })

  test("Enter activates the focused row", () => {
    const rows = treeRows(TOPOLOGY, new Set())
    expect(treeCommand("Enter", rows, 2)).toEqual({ type: "activate", id: "ap" })
  })

  test("an empty tree answers every key with none", () => {
    expect(treeCommand("ArrowDown", [], 0)).toEqual({ type: "none" })
  })
})

/* ── Combobox filtering ──────────────────────────────────────────────────── */

const TENANTS = [
  { value: "t-1", label: "Westfield Academy", keywords: ["044137762219"] },
  { value: "t-2", label: "Ashbourne College" },
  { value: "t-3", label: "West Ridge School" },
  { value: "t-4", label: "Northwest Trust" },
]

test.describe("combobox filtering", () => {
  test("prefix matches come before substring matches", () => {
    // "Northwest Trust" contains "west" and must not outrank the two names that
    // start with it — the list reshuffling under a moving finger is the defect.
    expect(filterOptions(TENANTS, "west").map((o) => o.value)).toEqual(["t-1", "t-3", "t-4"])
  })

  test("each group keeps its original order", () => {
    expect(filterOptions(TENANTS, "e").map((o) => o.value)).toEqual(["t-1", "t-2", "t-3", "t-4"])
  })

  test("keywords match, so an account number finds a tenant with a name", () => {
    expect(filterOptions(TENANTS, "0441").map((o) => o.value)).toEqual(["t-1"])
  })

  test("an empty query is every option, and a copy of the array", () => {
    const all = filterOptions(TENANTS, "   ")
    expect(all).toHaveLength(4)
    expect(all).not.toBe(TENANTS)
  })

  test("no match is an empty list, never the unfiltered one", () => {
    expect(filterOptions(TENANTS, "zzz")).toEqual([])
  })
})

/* ── Diff ────────────────────────────────────────────────────────────────── */

test.describe("the line diff", () => {
  test("an inserted line is one addition, not a cascade of modifications", () => {
    const before = "alpha\nbravo\ncharlie"
    const after = "alpha\ninserted\nbravo\ncharlie"
    const result = diffLines(before, after)
    expect({ added: result.added, removed: result.removed }).toEqual({ added: 1, removed: 0 })
    expect(result.rows.map((row) => row.kind)).toEqual([
      "context",
      "added",
      "context",
      "context",
    ])
  })

  test("line numbers are the numbers in each file, and a gap has none", () => {
    const result = diffLines("a\nb", "a\nx\nb")
    expect(result.rows.map((row) => [row.kind, row.before, row.after])).toEqual([
      ["context", 1, 1],
      ["added", null, 2],
      ["context", 2, 3],
    ])
  })

  test("a deletion at the end is a deletion", () => {
    const result = diffLines("a\nb\nc", "a")
    expect({ added: result.added, removed: result.removed }).toEqual({ added: 0, removed: 2 })
  })

  test("trailing whitespace is a change, because a digest says it is", () => {
    const result = diffLines("policy", "policy ")
    expect({ added: result.added, removed: result.removed }).toEqual({ added: 1, removed: 1 })
  })

  test("identical inputs report no change in words", () => {
    const result = diffLines("same\ntext", "same\ntext")
    expect(describeDiff(result)).toBe("No change.")
    expect(result.rows.every((row) => row.kind === "context")).toBe(true)
  })

  test("the summary is a sentence with both counts", () => {
    expect(describeDiff(diffLines("a\nb", "a\nx"))).toBe("1 line added, 1 line removed.")
  })

  test("an input too large to diff is refused rather than allocated", () => {
    const huge = new Array(2100).fill("line").join("\n")
    const result = diffLines(huge, `${huge}\nmore`)
    expect(result.refused).toBe(true)
    expect(result.rows).toEqual([])
    expect(describeDiff(result)).toBe("Too large to compare line by line.")
    expect(MAX_DIFF_CELLS).toBe(4_000_000)
  })
})

/* ── Date and time ───────────────────────────────────────────────────────── */

test.describe("UTC instants", () => {
  test("the two field values become one ISO instant, in UTC", () => {
    const result = combineDateTime("2026-08-14", "09:30")
    expect(result).toEqual({ ok: true, iso: "2026-08-14T09:30:00.000Z", epochMs: 1786699800000 })
    // The instant, read back by the platform's own parser rather than by a
    // second copy of this module's arithmetic.
    expect(Date.parse("2026-08-14T09:30:00.000Z")).toBe(1786699800000)
  })

  test("a date that does not exist is refused, not rolled over", () => {
    // Date.UTC turns the 31st of February into March. A maintenance window
    // silently moved by a day is the failure this catches.
    const result = combineDateTime("2026-02-31", "00:00")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toEqual([{ field: "date", message: "That date does not exist." }])
  })

  test("each half is blamed by name", () => {
    const result = combineDateTime("14/08/2026", "9am")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.map((p) => p.field)).toEqual(["date", "time"])
  })

  test("an hour past 23 is refused", () => {
    expect(combineDateTime("2026-08-14", "24:00").ok).toBe(false)
  })

  test("seconds are accepted where a browser supplies them", () => {
    const result = combineDateTime("2026-08-14", "09:30:15")
    expect(result.ok && result.iso).toBe("2026-08-14T09:30:15.000Z")
  })

  test("splitting an instant is the inverse, and stays in UTC", () => {
    expect(splitIso("2026-01-05T04:07:00.000Z")).toEqual({ date: "2026-01-05", time: "04:07" })
    expect(formatUtc("2026-01-05T04:07:00.000Z")).toBe("2026-01-05 04:07 UTC")
    expect(splitIso("not an instant")).toBeNull()
  })

  test("a round trip through both is the identity", () => {
    const parts = splitIso("2026-11-30T23:59:00.000Z")!
    expect(combineDateTime(parts.date, parts.time)).toMatchObject({
      ok: true,
      iso: "2026-11-30T23:59:00.000Z",
    })
  })
})

/* ── File rules ──────────────────────────────────────────────────────────── */

const JSON_FILE = { name: "manifest.json", size: 2048, type: "application/json" }
const ZIP_FILE = { name: "bundle.zip", size: 9_000_000, type: "application/zip" }

test.describe("what an upload accepts", () => {
  test("an extension rule matches on the extension, not the browser's guess", () => {
    // Many browsers report an empty type for .json; a rule that trusted `type`
    // would reject the file the operator was told to upload.
    expect(matchesAccept({ name: "a.json", size: 1, type: "" }, ".json")).toBe(true)
    expect(matchesAccept({ name: "a.txt", size: 1, type: "" }, ".json")).toBe(false)
  })

  test("a wildcard rule matches the family", () => {
    expect(matchesAccept({ name: "a.csv", size: 1, type: "text/csv" }, "text/*")).toBe(true)
    expect(matchesAccept({ name: "a.png", size: 1, type: "image/png" }, "text/*")).toBe(false)
  })

  test("every rejection names the file and the rule it broke", () => {
    const result = checkFiles([JSON_FILE, ZIP_FILE], { accept: ".json", maxBytes: 5000 })
    expect(result.accepted.map((f) => f.name)).toEqual(["manifest.json"])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toContain("bundle.zip")
    expect(result.rejected[0].reason).toContain(".json")
  })

  test("a file over the limit is told the limit", () => {
    const result = checkFiles([ZIP_FILE], { maxBytes: 5_000_000 })
    expect(result.rejected[0].reason).toBe("bundle.zip is 9.0 MB; the limit is 5.0 MB.")
  })

  test("an empty file is rejected, because it uploads without failing", () => {
    const result = checkFiles([{ name: "empty.json", size: 0, type: "" }], {})
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe("empty.json is empty.")
  })

  test("the count rule applies to what survived the other rules", () => {
    const wrong = { name: "notes.txt", size: 10, type: "text/plain" }
    const result = checkFiles([JSON_FILE, wrong, { ...JSON_FILE, name: "second.json" }], {
      accept: ".json",
      maxFiles: 1,
    })
    expect(result.accepted.map((f) => f.name)).toEqual(["manifest.json"])
    // Both problems are reported: the wrong type AND the extra file.
    expect(result.rejected.map((r) => r.file.name).sort()).toEqual(["notes.txt", "second.json"])
  })

  test("sizes are base ten, because every provider's bill is", () => {
    expect(formatBytes(999)).toBe("999 B")
    expect(formatBytes(1000)).toBe("1.0 kB")
    expect(formatBytes(1_500_000)).toBe("1.5 MB")
    expect(formatBytes(23_400_000)).toBe("23 MB")
    expect(formatBytes(-1)).toBe("unknown size")
  })

  test("the announcement says both numbers", () => {
    const result = checkFiles([JSON_FILE, ZIP_FILE], { accept: ".json" })
    expect(describeSelection(result)).toBe("1 file ready, 1 rejected.")
    expect(describeSelection({ accepted: [], rejected: [] })).toBe("No file chosen.")
  })
})

/* ── Chart arithmetic ────────────────────────────────────────────────────── */

const SERIES = [
  {
    key: "cost",
    label: "Daily cost",
    points: [
      { x: 1, y: 10 },
      { x: 2, y: null },
      { x: 3, y: 30 },
      { x: 4, y: 25 },
    ],
  },
]

test.describe("the chart's numbers", () => {
  test("a gap is excluded from the domain rather than treated as zero", () => {
    expect(domainOf(SERIES)).toEqual({ minX: 1, maxX: 4, minY: 10, maxY: 30 })
  })

  test("a series with no readings has no domain, so the chart can say so", () => {
    expect(domainOf([{ key: "a", label: "A", points: [{ x: 1, y: null }] }])).toBeNull()
    expect(domainOf([])).toBeNull()
  })

  test("a flat series is widened rather than dividing by zero", () => {
    const domain = domainOf([{ key: "a", label: "A", points: [{ x: 1, y: 5 }, { x: 2, y: 5 }] }])
    expect(domain).toEqual({ minX: 1, maxX: 2, minY: 4, maxY: 6 })
  })

  test("ticks are round numbers that cover the domain", () => {
    // Four ticks asked for over 0–100 gives a step of 20, not the 50 that
    // rounding the step UP would produce — two gridlines on a 220-pixel chart.
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(3, 17, 4)).toEqual([0, 5, 10, 15, 20])
    // The floating-point trap: 0.1 + 0.2 must not label a tick
    // 0.30000000000000004.
    expect(niceTicks(0, 1, 4).every((tick) => String(tick).length <= 4)).toBe(true)
  })

  test("the scales put the domain's ends on the plotting box's edges", () => {
    const domain = domainOf(SERIES)!
    expect(scaleX(1, domain, DEFAULT_BOX)).toBe(DEFAULT_BOX.padLeft)
    expect(scaleX(4, domain, DEFAULT_BOX)).toBe(DEFAULT_BOX.width - DEFAULT_BOX.padRight)
    // Inverted: the maximum is at the TOP, which is the smaller y.
    expect(scaleY(30, domain, DEFAULT_BOX)).toBe(DEFAULT_BOX.padTop)
    expect(scaleY(10, domain, DEFAULT_BOX)).toBe(DEFAULT_BOX.height - DEFAULT_BOX.padBottom)
  })

  test("a gap breaks the path instead of drawing a line across it", () => {
    const path = seriesPath(SERIES[0].points, domainOf(SERIES)!, DEFAULT_BOX)
    // Two subpaths: the pen lifts at the missing reading. One `M` would be a
    // straight segment that reads as "flat", which is the opposite of "unknown".
    expect(path.match(/M/g)).toHaveLength(2)
    expect(path.match(/L/g)).toHaveLength(1)
  })

  test("the description is the reading a sighted operator takes from the shape", () => {
    expect(describeSeries(SERIES[0], "USD")).toBe(
      "Daily cost: rising, from 10 to 25 USD. Lowest 10, highest 30. 1 reading missing.",
    )
  })

  test("a series with nothing in it says so rather than describing an empty shape", () => {
    expect(describeSeries({ key: "a", label: "A", points: [] }, "USD")).toBe("A: no readings.")
  })
})

/* ── The co-located stylesheet is held to the same two rules ─────────────── */

const CSS_PATH = path.join(MD3_DIR, "primitives.css")
const sheet = fs.readFileSync(CSS_PATH, "utf8")
const sheetRules = sheet.replace(/\/\*[\s\S]*?\*\//g, "")

/** The 148 CSS colour keywords, abbreviated to the ones a primitive would reach for. */
const KEYWORD_COLOURS = [
  "black", "white", "red", "green", "blue", "orange", "yellow", "grey", "gray", "silver",
  "teal", "navy", "olive", "lime", "aqua", "fuchsia", "purple", "maroon", "forestgreen",
  "darkgreen", "seagreen", "crimson", "gold", "tomato", "salmon", "khaki", "plum", "tan",
]

test.describe("primitives.css cannot become a second palette", () => {
  test("no hex code", () => {
    expect([...sheetRules.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual([])
  })

  test("no colour function", () => {
    // `color-mix`, `oklch`, `rgba` — every syntax that produces a value the
    // contrast audit in md3-tokens-logic.spec.ts cannot see.
    const found = [
      ...sheetRules.matchAll(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|light-dark)\s*\(/g),
    ].map((m) => m[1])
    expect(found).toEqual([])
  })

  test("no colour keyword in a colour position", () => {
    const offences: string[] = []
    for (const keyword of KEYWORD_COLOURS) {
      const pattern = new RegExp(
        String.raw`\b(?:color|background|background-color|border|border-color|outline|outline-color|fill|stroke|caret-color|accent-color)\s*:[^;]*\b${keyword}\b`,
        "i",
      )
      const match = sheetRules.match(pattern)
      if (match) offences.push(`${keyword} — ${match[0]}`)
    }
    expect(offences).toEqual([])
  })

  test("every colour in the sheet resolves a token", () => {
    // The positive form of the three rules above: a colour-shaped declaration
    // must name a variable. `currentColor` and `inherit` are the two exceptions
    // and are named, because both take their value from a token further up.
    const offences: string[] = []
    for (const match of sheetRules.matchAll(
      /(^|\n)\s*(color|background|background-color|border-color|outline-color|fill|stroke)\s*:\s*([^;]+);/g,
    )) {
      const value = match[3].trim()
      if (/var\(--/.test(value)) continue
      if (/^(currentColor|inherit|none|transparent)$/i.test(value)) continue
      offences.push(`${match[2]}: ${value}`)
    }
    expect(offences).toEqual([])
  })
})

/* ── The hooks and the stylesheet describe the same set ──────────────────── */

const componentFiles = fs
  .readdirSync(MD3_DIR)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .sort()

function sourceOf(name: string): string {
  return fs
    .readFileSync(path.join(MD3_DIR, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const emitted = new Set<string>()
for (const name of componentFiles) {
  const source = sourceOf(name)
  for (const match of source.matchAll(/data-md3=["']([\w-]+)["']/g)) emitted.add(match[1])
  for (const match of source.matchAll(/"data-md3":\s*["']([\w-]+)["']/g)) emitted.add(match[1])
  for (const match of source.matchAll(/setAttribute\(\s*"data-md3",\s*"([\w-]+)"/g)) {
    emitted.add(match[1])
  }
}

const declared = new Set(
  [...sheetRules.matchAll(/\[data-md3="([\w-]+)"\]/g)].map((match) => match[1]),
)

test.describe("the primitives and their stylesheet cannot drift apart", () => {
  test("the scan is reading real files", () => {
    // An absence check over an empty list passes on every input.
    expect(componentFiles.length).toBeGreaterThanOrEqual(30)
    expect(emitted.size).toBeGreaterThanOrEqual(60)
    expect(declared.size).toBeGreaterThanOrEqual(60)
  })

  test("every hook a component emits is styled", () => {
    // A hook with no rule is a component that renders unstyled and looks, in a
    // screenshot, exactly like one whose rule stopped matching.
    expect([...emitted].filter((hook) => !declared.has(hook)).sort()).toEqual([])
  })

  test("every rule in the sheet is for a hook something emits", () => {
    expect(
      [...declared].filter((hook) => !emitted.has(hook)).sort(),
      "Dead rules. Either a component stopped emitting it, or it was written for one that " +
        "was never built.",
    ).toEqual([])
  })

  test("no component in this set writes an inline style", () => {
    // The structural half of the colour ban: `style={{ background: x }}` defeats
    // every lexical scan the moment the colour is a variable.
    const offences = componentFiles.filter((name) => /\bstyle\s*=\s*\{/.test(sourceOf(name)))
    expect(offences).toEqual([])
  })

  test("the interactive primitives are client components and the pure models are not", () => {
    // A pure model that acquires a `"use client"` directive is one the specs
    // above can no longer import in a Playwright worker, and the enumeration
    // quietly stops running.
    const clientExpected = [
      "Accordion.tsx",
      "Combobox.tsx",
      "Drawer.tsx",
      "FileUpload.tsx",
      "Menu.tsx",
      "ModalDialog.tsx",
      "Popover.tsx",
      "ToastRegion.tsx",
      "Tooltip.tsx",
      "Tree.tsx",
      "hooks.ts",
    ]
    const client = componentFiles.filter((name) =>
      /^\s*"use client"/.test(fs.readFileSync(path.join(MD3_DIR, name), "utf8")),
    )
    expect(client.sort()).toEqual(clientExpected.sort())
    for (const pure of ["interaction.ts", "diff.ts", "datetime.ts", "files.ts", "chart-model.ts"]) {
      expect(client, pure).not.toContain(pure)
    }
  })

  test("every new primitive is exported from the barrel", () => {
    const barrel = fs.readFileSync(path.join(MD3_DIR, "index.ts"), "utf8")
    const missing = [
      "Accordion",
      "Chart",
      "Code",
      "Combobox",
      "DateTimeField",
      "Drawer",
      "FileUpload",
      "Menu",
      "ModalDialog",
      "Popover",
      "Stepper",
      "ToastRegion",
      "Tooltip",
      "Tree",
      "chart-model",
      "datetime",
      "diff",
      "files",
      "hooks",
      "interaction",
    ].filter((module) => !barrel.includes(`from "./${module}"`))
    expect(missing, "a primitive a route cannot import from `components/md3`").toEqual([])
  })
})
