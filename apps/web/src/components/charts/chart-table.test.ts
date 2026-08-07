import { csvCell, tableFromSeries, toCsv } from "@/components/charts/chart-table"

describe("tableFromSeries", () => {
  it("puts one row per category and one column per series", () => {
    const table = tableFromSeries(
      ["Mar 1", "Mar 2"],
      [
        { name: "Events", values: [3, 5] },
        { name: "Approvals", values: [1, 0] },
      ],
      "Day",
    )
    expect(table.columns).toEqual(["Day", "Events", "Approvals"])
    expect(table.rows).toEqual([
      ["Mar 1", 3, 1],
      ["Mar 2", 5, 0],
    ])
  })

  it("reads a short series as zero rather than shifting later rows up", () => {
    const table = tableFromSeries(["a", "b", "c"], [{ name: "S", values: [1] }])
    expect(table.rows).toEqual([
      ["a", 1],
      ["b", 0],
      ["c", 0],
    ])
  })
})

describe("csvCell — formula injection (Bible §12)", () => {
  it("neutralises a leading = so a spreadsheet reads it as text", () => {
    // The named case. Without the apostrophe, opening the export evaluates
    // this, and the person opening it is the officer with the permissions.
    expect(csvCell("=1+1")).toBe("'=1+1")
  })

  it("neutralises every dangerous leader, not only =", () => {
    expect(csvCell("+1")).toBe("'+1")
    expect(csvCell("-1")).toBe("'-1")
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    // A tab is a dangerous LEADER but is not a CSV delimiter here, so it is
    // prefixed and left unquoted. A carriage return is both, so it gets both.
    expect(csvCell("\tcmd")).toBe("'\tcmd")
    expect(csvCell("\rcmd")).toBe('"\'\rcmd"')
  })

  it("neutralises a formula that also needs quoting", () => {
    // Both rules at once: the apostrophe goes INSIDE the quotes, or the quoting
    // strips it back off and the cell is a formula again.
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    )
  })

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Simon, Consulting")).toBe('"Simon, Consulting"')
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvCell("two\nlines")).toBe('"two\nlines"')
  })

  it("leaves ordinary values alone, including negative numbers written as numbers", () => {
    expect(csvCell("Mar 1")).toBe("Mar 1")
    expect(csvCell(42)).toBe("42")
    // A NUMBER -3 is still a leading '-' once stringified, and a spreadsheet
    // does treat "-3" as a formula-ish token; quoting it as text is correct and
    // still reads as -3 to a human.
    expect(csvCell(-3)).toBe("'-3")
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })
})

describe("toCsv", () => {
  it("emits the header row and CRLF line endings", () => {
    const csv = toCsv(tableFromSeries(["Mar 1"], [{ name: "Events", values: [3] }], "Day"))
    expect(csv).toBe("Day,Events\r\nMar 1,3")
  })

  it("escapes every cell it writes, not only the body", () => {
    const csv = toCsv({ columns: ["=evil"], rows: [["=also"]] })
    expect(csv).toBe("'=evil\r\n'=also")
  })
})
