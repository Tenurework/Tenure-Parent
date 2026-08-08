/**
 * @jest-environment jsdom
 */

/**
 * STUDIO-060-003 — the rollback arm, asserted on the DOM the PRODUCTION control
 * emits.
 *
 * The `rollback` domain would be a contract nothing reaches if the document it
 * produces stopped at a pure function. It does not: `ConfigurationPage` builds
 * one preview per offerable revision and hands them to `RollbackControls`, and
 * this is where that hand-off is read rather than assumed.
 *
 * Two decisions are load-bearing and both are checked here rather than argued:
 *
 *   * **The previews are built by the production functions.** `rollbackChangeDiff`,
 *     `rollbackSummary` and `renderComparison` are called below in the same
 *     order and with the same arguments as `page.tsx` calls them — live first,
 *     target second. A fixture typed out by hand would keep this green on the
 *     day the page started computing the diff backwards.
 *   * **`previews` is a REQUIRED prop.** The page is an async server component
 *     that reads DynamoDB, so it cannot be rendered here; what stands in for
 *     that is the type. A page that forgot to pass previews would not compile,
 *     which `npm run studio:type-check` runs on every change.
 *
 * `./actions` is replaced because it is a `"use server"` module that reaches the
 * registry; nothing this file asserts goes near it, and `useActionState` only
 * needs something callable.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { ConfigRecord } from "@tenure/configuration"
import { MODEL_TOKEN_BUDGET_KEY } from "@tenure/platform-config"

import { renderComparison, rollbackChangeDiff, rollbackSummary } from "../../../../lib/revisions"
import { RollbackControls, type RollbackPreview } from "./RollbackControls"

jest.mock("./actions", () => ({
  rollback: async () => null,
}))

// Same flag the app's own DOM suites set: without it React treats every `act`
// as an unwrapped update and warns on each one.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function record(revision: number, values: Record<string, unknown>): ConfigRecord {
  return {
    tenantId: "acme",
    revision,
    layers: [],
    provenance: `sha256:${revision}`,
    layerDigests: [],
    values,
    checksum: `sha256:c${revision}`,
    languageVersion: "1.0.0",
    publishedBy: "operator:one",
    publishedAt: "2026-08-02T00:00:00.000Z",
    activateAt: "2026-08-02T00:00:00.000Z",
    rollbackTo: revision === 1 ? null : revision - 1,
    plan: {
      blocked: false,
      blockers: [],
      rejections: [],
      violations: [],
      excused: [],
      lint: [],
      diff: [],
      humanDiff: "",
      impact: { keysAdded: 0, keysRemoved: 0, keysChanged: 1, modulesAffected: [], fixturesAffected: [] },
      simulations: [],
      rollbackTo: revision === 1 ? null : revision - 1,
      activateAt: "2026-08-02T00:00:00.000Z",
    },
  }
}

const LIVE = record(3, { [MODEL_TOKEN_BUDGET_KEY]: 1_000_000, "platform.branding.wordmark": "Tenure" })
const TARGET_2 = record(2, { [MODEL_TOKEN_BUDGET_KEY]: 250_000, "platform.branding.wordmark": "Tenure" })
const TARGET_1 = record(1, { [MODEL_TOKEN_BUDGET_KEY]: 1_000_000, "platform.branding.wordmark": "Tenure" })

/**
 * Exactly what `ConfigurationPage` computes, by the same route.
 *
 * Kept as one function so the arguments and their ORDER are stated once. The
 * direction is the thing most easily got wrong and least visibly wrong.
 */
function previewsFor(live: ConfigRecord, targets: readonly ConfigRecord[]): RollbackPreview[] {
  return targets.map((target) => {
    const diff = rollbackChangeDiff(live, target)
    return {
      revision: target.revision,
      summary: rollbackSummary(diff, target.revision),
      changed: diff.entries.length,
      rendered: renderComparison(diff),
    }
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(previews: RollbackPreview[]) {
  act(() => {
    root.render(
      <RollbackControls slug="acme" revisions={[1, 2, 3]} live={3} previews={previews} />,
    )
  })
}

/** Choose a revision the way an operator does, through the real `<select>`. */
function choose(revision: number) {
  const select = container.querySelector<HTMLSelectElement>("select#toRevision")!
  act(() => {
    select.value = String(revision)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("the rollback control's consequence preview", () => {
  it("says nothing about consequences until a revision is chosen", () => {
    // A preview for a revision nobody selected is a preview for the wrong
    // revision. There is no default choice, so there is no default consequence.
    mount(previewsFor(LIVE, [TARGET_1, TARGET_2]))
    expect(container.querySelector('[data-testid="rollback-preview"]')).toBeNull()
  })

  it("states what rolling back to the chosen revision would do", () => {
    mount(previewsFor(LIVE, [TARGET_1, TARGET_2]))
    choose(2)

    const preview = container.querySelector('[data-testid="rollback-preview"]')!
    expect(preview.textContent).toContain("Rolling back to revision 2 changes 1 key.")

    // The diff itself, in the notation the rest of the console uses, and in the
    // direction the operator is about to move: 1,000,000 is live, 250,000 is
    // what revision 2 would restore.
    const diff = container.querySelector('[data-testid="rollback-preview-diff"]')!
    expect(diff.textContent).toBe(`~ ${MODEL_TOKEN_BUDGET_KEY}: 1000000 -> 250000`)
  })

  it("follows the selection rather than showing the first preview it was given", () => {
    // Revision 1 resolves to what is live; revision 2 does not. A control that
    // rendered `previews[0]` would show "changes nothing" for both, which is
    // the most dangerous wrong answer this surface can give.
    mount(previewsFor(LIVE, [TARGET_1, TARGET_2]))

    choose(1)
    expect(container.querySelector('[data-testid="rollback-preview"]')!.textContent).toContain(
      "Revision 1 resolves to exactly what is live. Rolling back would change nothing.",
    )
    // Nothing changes, so there is no diff block to read.
    expect(container.querySelector('[data-testid="rollback-preview-diff"]')).toBeNull()

    choose(2)
    expect(container.querySelector('[data-testid="rollback-preview"]')!.textContent).toContain(
      "Rolling back to revision 2 changes 1 key.",
    )
    expect(container.querySelector('[data-testid="rollback-preview-diff"]')).not.toBeNull()
  })

  it("says so plainly when it was handed no preview for the chosen revision", () => {
    // The honest arm. A missing preview must read as "no comparison is
    // available", never as "nothing would change" — those are opposite
    // statements and only one of them is safe to act on.
    mount(previewsFor(LIVE, [TARGET_1]))
    choose(2)
    expect(container.querySelector('[data-testid="rollback-preview"]')!.textContent).toContain(
      "No comparison is available for revision 2.",
    )
  })
})
