import { renderToStaticMarkup } from "react-dom/server"

import { Chart } from "./Chart"
import { CodeBlock, DiffView } from "./Code"
import { DateTimeField } from "./DateTimeField"
import { FileUpload } from "./FileUpload"
import { Stepper } from "./Stepper"

/**
 * The primitives that need no client, proven as markup.
 *
 * They run in jest's default node environment rather than the jsdom one
 * `Primitives.test.tsx` uses, and that split is forced rather than chosen:
 * `react-dom/server` resolves to its browser build under jsdom, which needs a
 * `MessageChannel` that environment does not have. Rendering to a string in
 * node is also the closer analogue of what these components actually do — they
 * are server components, and this is the markup a browser receives.
 *
 * What is asserted is structure and words: the roles, the names, the
 * relationships, and the places where a status has to be readable without
 * colour. Layout belongs to `layout.spec.ts`; colour belongs to
 * `md3-tokens-logic.spec.ts`.
 */

describe("the primitives that need no client", () => {
  test("a code block is a named, focusable scroll region", () => {
    const markup = renderToStaticMarkup(
      <CodeBlock caption="Effective manifest" code={"line one\nline two"} language="json" />,
    )
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('role="region"')
    expect(markup).toContain("aria-labelledby")
    expect(markup).toContain("line two")
  })

  test("a diff says added and removed in words, not only in a tint", () => {
    const markup = renderToStaticMarkup(
      <DiffView caption="Revision 40 against 41" before={"a\nb"} after={"a\nx"} />,
    )
    expect(markup).toContain("1 line added, 1 line removed.")
    expect(markup).toContain(">added<")
    expect(markup).toContain(">removed<")
    // The sign is real text as well, so the row is readable in monochrome.
    expect(markup).toContain(">+<")
  })

  test("a stepper is an ordered list whose current step says so", () => {
    const markup = renderToStaticMarkup(
      <Stepper
        label="Change request"
        steps={[
          { key: "plan", label: "Plan", status: "done" },
          { key: "approve", label: "Approve", status: "current" },
          { key: "execute", label: "Execute", status: "upcoming" },
        ]}
      />,
    )
    expect(markup).toContain("<ol")
    expect(markup).toContain('aria-current="step"')
    // Every status is a word. A row of tinted dots says nothing to a reader who
    // cannot separate the tints, and nothing at all to a screen reader.
    expect(markup).toContain("Done")
    expect(markup).toContain("In progress")
    expect(markup).toContain("Not started")
  })

  test("a date and time field is one legend over two named controls, in UTC", () => {
    const markup = renderToStaticMarkup(
      <DateTimeField name="window" legend="Maintenance window opens" defaultIso="2026-08-14T09:30:00.000Z" />,
    )
    expect(markup).toContain("<fieldset")
    expect(markup).toContain("<legend")
    expect(markup).toContain('name="window-date"')
    expect(markup).toContain('name="window-time"')
    expect(markup).toContain('value="2026-08-14"')
    expect(markup).toContain('value="09:30"')
    // The timezone is on the screen, not in a tooltip.
    expect(markup).toContain("Time (UTC)")
  })

  test("a chart carries its unit, range, source and freshness, and a table of the numbers", () => {
    const markup = renderToStaticMarkup(
      <Chart
        title="Daily cost"
        unit="USD"
        timeRange="Last 4 days"
        source="Cost Explorer"
        freshness="Read 4 minutes ago"
        series={[
          {
            key: "cost",
            label: "Daily cost",
            points: [
              { x: 1, y: 10 },
              { x: 2, y: null },
              { x: 3, y: 30 },
            ],
          },
        ]}
      />,
    )
    expect(markup).toContain("USD")
    expect(markup).toContain("Last 4 days")
    expect(markup).toContain("Cost Explorer")
    expect(markup).toContain("Read 4 minutes ago")
    expect(markup).toContain('role="img"')
    // The description a screen reader gets instead of the picture.
    expect(markup).toContain("Lowest 10, highest 30")
    // STUDIO-030-009's tabular alternative, in the DOM rather than behind a
    // client-side toggle.
    expect(markup).toContain("<table")
    // A gap is a word, never a blank cell — a blank reads as zero.
    expect(markup).toContain("no reading")
  })

  test("a chart with no readings says so instead of drawing an empty axis", () => {
    const markup = renderToStaticMarkup(
      <Chart
        title="Daily cost"
        unit="USD"
        timeRange="Last 4 days"
        source="Cost Explorer"
        freshness="Read 4 minutes ago"
        series={[{ key: "cost", label: "Daily cost", points: [{ x: 1, y: null }] }]}
      />,
    )
    expect(markup).toContain("An empty chart is not the same as a zero")
    expect(markup).not.toContain("<svg")
  })

  test("a file upload's control is a real, visible, labelled file input", () => {
    // The usual pattern hides the input behind a styled label, which costs the
    // focus ring. `FileUpload` carries a `"use client"` directive for its
    // selection handling; the markup it produces before hydration is this, and
    // this is the half a keyboard user meets first.
    const markup = renderToStaticMarkup(
      <FileUpload
        name="bundle"
        legend="Blueprint bundle"
        supportingText="One .zip, up to 10 MB."
        accept=".zip"
        maxBytes={10_000_000}
      />,
    )
    expect(markup).toContain('type="file"')
    expect(markup).toContain('name="bundle"')
    expect(markup).toContain('accept=".zip"')
    expect(markup).toContain("<legend")
    expect(markup).toContain("<label")
    // WCAG 2.5.7: the drag path is an enhancement, never the only path.
    expect(markup).toContain("Or drop")
    // The live region is in the document before anything is announced into it.
    expect(markup).toContain('role="status"')
  })
})
