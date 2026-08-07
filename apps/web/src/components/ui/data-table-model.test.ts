import {
  ariaSortFor,
  formatSortParam,
  nextSort,
  parseSortParam,
  sortRows,
  type SortableColumn,
} from "@/components/ui/data-table-model"

interface Row {
  action: string
  when: Date | null
  count: number
}

const columns: SortableColumn<Row>[] = [
  { key: "action", sortValue: (r) => r.action },
  { key: "when", sortValue: (r) => r.when },
  { key: "count", sortValue: (r) => r.count },
  { key: "detail" }, // deliberately not sortable
]

const rows: Row[] = [
  { action: "seat.assign", when: new Date("2026-03-02T10:00:00Z"), count: 2 },
  { action: "approval.force", when: new Date("2026-01-05T10:00:00Z"), count: 10 },
  { action: "content.archive", when: null, count: 7 },
]

describe("sortRows", () => {
  it("orders ascending by a string column", () => {
    const sorted = sortRows(rows, columns, { key: "action", direction: "asc" })
    expect(sorted.map((r) => r.action)).toEqual(["approval.force", "content.archive", "seat.assign"])
  })

  it("orders descending by the same column", () => {
    // The direction flag is the thing a comparator most often ignores: reading
    // the key and forgetting the direction produces a table that looks sorted
    // and is wrong for half of every column.
    const sorted = sortRows(rows, columns, { key: "action", direction: "desc" })
    expect(sorted.map((r) => r.action)).toEqual(["seat.assign", "content.archive", "approval.force"])
  })

  it("orders numbers numerically, not lexically", () => {
    expect(sortRows(rows, columns, { key: "count", direction: "asc" }).map((r) => r.count)).toEqual([
      2, 7, 10,
    ])
  })

  it("orders dates chronologically", () => {
    const sorted = sortRows(rows, columns, { key: "when", direction: "asc" })
    expect(sorted.map((r) => r.action)).toEqual(["approval.force", "seat.assign", "content.archive"])
  })

  it("keeps missing values last in BOTH directions", () => {
    const asc = sortRows(rows, columns, { key: "when", direction: "asc" })
    const desc = sortRows(rows, columns, { key: "when", direction: "desc" })
    expect(asc[asc.length - 1].action).toBe("content.archive")
    expect(desc[desc.length - 1].action).toBe("content.archive")
  })

  it("leaves the order alone for a column that declares no sort value", () => {
    const sorted = sortRows(rows, columns, { key: "detail", direction: "asc" })
    expect(sorted.map((r) => r.action)).toEqual(rows.map((r) => r.action))
  })

  it("does not mutate the caller's array", () => {
    const original = [...rows]
    sortRows(rows, columns, { key: "action", direction: "desc" })
    expect(rows).toEqual(original)
  })
})

describe("nextSort", () => {
  it("cycles unsorted → ascending → descending → unsorted", () => {
    const a = nextSort(null, "action")
    expect(a).toEqual({ key: "action", direction: "asc" })
    const b = nextSort(a, "action")
    expect(b).toEqual({ key: "action", direction: "desc" })
    expect(nextSort(b, "action")).toBeNull()
  })

  it("clicking a different column starts that column ascending", () => {
    expect(nextSort({ key: "action", direction: "desc" }, "count")).toEqual({
      key: "count",
      direction: "asc",
    })
  })
})

describe("ariaSortFor", () => {
  it("reports none for every column except the sorted one", () => {
    const sort = { key: "action", direction: "asc" } as const
    expect(ariaSortFor("action", sort)).toBe("ascending")
    expect(ariaSortFor("count", sort)).toBe("none")
    expect(ariaSortFor("action", null)).toBe("none")
    expect(ariaSortFor("action", { key: "action", direction: "desc" })).toBe("descending")
  })
})

describe("sort params round-trip", () => {
  it("parses only the two directions it emits", () => {
    expect(parseSortParam("action:asc")).toEqual({ key: "action", direction: "asc" })
    expect(parseSortParam("action:sideways")).toBeNull()
    expect(parseSortParam("action")).toBeNull()
    expect(parseSortParam(undefined)).toBeNull()
  })

  it("formats back to what it parses", () => {
    const sort = { key: "when", direction: "desc" } as const
    expect(parseSortParam(formatSortParam(sort))).toEqual(sort)
    expect(formatSortParam(null)).toBeNull()
  })
})
