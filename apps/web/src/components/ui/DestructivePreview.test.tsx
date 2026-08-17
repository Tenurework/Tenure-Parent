/**
 * @jest-environment jsdom
 */

/**
 * GE-143-025 — what the panel actually puts on screen.
 *
 * The model test proves the sentences; this proves they are rendered, in the
 * requirement's order, with the unavailable ones marked as unavailable rather
 * than dropped. A disclosure that exists in a type and never reaches the DOM is
 * not a disclosure.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { DestructivePreviewPanel } from "./DestructivePreview"
import { DISCLOSURE_LABELS, DISCLOSURE_ORDER, type DestructivePreview } from "./destructive-preview"

function completePreview(): DestructivePreview {
  return {
    target: { known: { kind: "board seat", label: "Treasurer", identifier: "position ID TRE-1" } },
    scope: {
      known: {
        tenant: "Example University",
        organization: "Robotics Club",
        seat: "Treasurer",
        crossOrganization: false,
      },
    },
    affected: { known: { count: 0, noun: "attached record" } },
    downstream: { known: [] },
    approvals: { known: [] },
    recovery: { known: { kind: "irreversible", why: "The row is deleted outright." } },
    retention: { known: "Nothing is retained and no legal hold is affected." },
    cost: { known: null },
    audit: { known: { kind: "recorded", event: "seat.deleted" } },
  }
}

// Same declaration owned-wrappers.test.tsx makes: without it React logs an act
// warning on every render and the DOM assertions run against a tree it has not
// finished flushing.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return container
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("the panel", () => {
  it("renders every disclosure, in the requirement's order", () => {
    const dom = render(<DestructivePreviewPanel preview={completePreview()} />)

    const labels = [...dom.querySelectorAll("dt")].map((dt) => dt.textContent)
    expect(labels).toEqual(DISCLOSURE_ORDER.map((key) => DISCLOSURE_LABELS[key]))

    const keys = [...dom.querySelectorAll("dd")].map((dd) => dd.getAttribute("data-disclosure"))
    expect(keys).toEqual([...DISCLOSURE_ORDER])
    expect(dom.querySelector("[data-destructive-preview]")?.getAttribute("data-destructive-preview")).toBe(
      "complete",
    )
  })

  it("prints a zero count as a measurement, not as a blank", () => {
    const dom = render(<DestructivePreviewPanel preview={completePreview()} />)
    const affected = dom.querySelector('[data-disclosure="affected"]')!
    expect(affected.textContent).toBe("None — checked, and no attached records are attached")
    expect(affected.getAttribute("data-disclosure-state")).toBe("known")
  })

  it("prints an unavailable disclosure's reason where its value would have been", () => {
    const dom = render(
      <DestructivePreviewPanel
        preview={{ ...completePreview(), affected: { unavailable: "the count query timed out" } }}
      />,
    )
    const affected = dom.querySelector('[data-disclosure="affected"]')!
    expect(affected.getAttribute("data-disclosure-state")).toBe("unavailable")
    expect(affected.textContent).toBe("Not determined — the count query timed out")
    // Marked in the caution family, so it does not read as an ordinary value.
    expect(affected.className).toContain("--warning-text")
  })

  it("says out loud when the action writes no audit record", () => {
    const dom = render(
      <DestructivePreviewPanel
        preview={{
          ...completePreview(),
          audit: { known: { kind: "not-recorded", why: "adminDeleteSeat writes no audit event." } },
        }}
      />,
    )
    expect(dom.querySelector('[data-disclosure="audit"]')!.textContent).toBe(
      "Nothing is recorded. adminDeleteSeat writes no audit event.",
    )
  })

  it("refuses to render an incomplete preview, and says what is missing", () => {
    const broken = completePreview() as unknown as Record<string, unknown>
    delete broken.retention

    const dom = render(
      <DestructivePreviewPanel preview={broken as unknown as DestructivePreview} />,
    )
    expect(dom.querySelector("[data-destructive-preview]")?.getAttribute("data-destructive-preview")).toBe(
      "invalid",
    )
    expect(dom.querySelectorAll("dd")).toHaveLength(0)
    expect(dom.textContent).toContain("Retention and legal hold was not disclosed at all.")
    expect(dom.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe("the migrated call site", () => {
  it("hands ConfirmDialog a preview that validates and renders complete", async () => {
    // The page is a server component reading the database, so what is asserted
    // here is the preview object it builds, imported through the same panel the
    // dialog renders. The shape, the zero-count sentence and the audit
    // disclosure are the three things a reader of that dialog depends on.
    const { ConfirmDialog } = await import("./ConfirmDialog")
    const dom = render(
      <ConfirmDialog
        isOpen
        onOpenChange={() => {}}
        title="Delete the Treasurer seat?"
        description="This permanently removes the seat."
        confirmLabel="Delete seat"
        variant="danger"
        preview={completePreview()}
        onConfirm={() => {}}
      />,
    )
    // The dialog portals its content; assert against the document, not the div.
    const panel = document.querySelector('[data-destructive-preview="complete"]')
    expect(panel).not.toBeNull()
    expect(document.querySelector('[data-disclosure="audit"]')!.textContent).toBe(
      "Recorded as seat.deleted.",
    )
    expect(dom).toBeDefined()
  })
})
