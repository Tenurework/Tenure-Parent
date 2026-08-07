/**
 * The fourteen states, tested as decisions rather than as styling.
 *
 * Nothing here checks a colour. Every assertion is about something that goes
 * wrong quietly: a loading spinner that interrupts a screen reader, a refusal
 * that confirms what it is hiding, a retry button that can never work, or —
 * the one that actually misleads people — data presented as a complete answer
 * when it is not.
 */
import { describe, expect, it } from "@jest/globals"

import fs from "node:fs"
import path from "node:path"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { Skeleton, skeletonColumnShares, skeletonHeight } from "./Skeleton"
import { StateSurface } from "./StateSurface"
import {
  ALL_STATES,
  DEFAULT_COPY,
  INCOMPLETE_STATES,
  STATE_SEMANTICS,
  retryAdvice,
} from "./states"

describe("coverage", () => {
  it("covers exactly the fourteen states the item names", () => {
    // Named individually rather than counted, so dropping one and adding
    // another still fails.
    expect([...ALL_STATES].sort()).toEqual(
      [
        "archived",
        "conflict",
        "empty",
        "error",
        "high-risk-confirm",
        "loading",
        "no-results",
        "offline",
        "partial",
        "pending-purge",
        "permission-denied",
        "read-only",
        "stale",
        "syncing",
      ].sort(),
    )
  })

  it("gives every state semantics and copy", () => {
    for (const state of ALL_STATES) {
      expect(STATE_SEMANTICS[state]).toBeDefined()
      expect(DEFAULT_COPY[state].title.length).toBeGreaterThan(3)
      expect(DEFAULT_COPY[state].detail.length).toBeGreaterThan(15)
    }
  })
})

describe("what may be read as a complete answer", () => {
  it("marks exactly the states that render an incomplete result", () => {
    // The load-bearing one. A reader who cannot tell stale from current makes a
    // decision on old data, which is the failure mode of every dashboard that
    // has ever misled someone.
    expect([...INCOMPLETE_STATES].sort()).toEqual(
      [
        "conflict",
        "error",
        "high-risk-confirm",
        "loading",
        "offline",
        "partial",
        "pending-purge",
        "permission-denied",
        "stale",
        "syncing",
      ].sort(),
    )
  })

  it("treats empty and archived as complete, because they are", () => {
    // Empty IS the answer. A panel reading "nothing yet" when the query failed
    // is exactly the confusion this distinction prevents — and archived data is
    // correct, just no longer live.
    expect(STATE_SEMANTICS.empty.presentsAsComplete).toBe(true)
    expect(STATE_SEMANTICS.archived.presentsAsComplete).toBe(true)
  })

  it("treats no-results and read-only as complete too", () => {
    // A filter that matched nothing HAS its answer, and a viewer seat is
    // looking at live, current data. Marking either incomplete would put
    // "do not read this as the full result" over a result that is full.
    expect(STATE_SEMANTICS["no-results"].presentsAsComplete).toBe(true)
    expect(STATE_SEMANTICS["read-only"].presentsAsComplete).toBe(true)
  })

  it("does not let syncing or pending-purge read as settled", () => {
    // A write in flight has not been agreed to by the server, and a record on
    // a deletion countdown is not the durable answer it looks like.
    expect(STATE_SEMANTICS.syncing.presentsAsComplete).toBe(false)
    expect(STATE_SEMANTICS["pending-purge"].presentsAsComplete).toBe(false)
  })
})

describe("how loudly a screen reader is interrupted", () => {
  it("never interrupts for progress or freshness", () => {
    // Interrupting a reader for a spinner, or for data being slightly old,
    // trains them to dismiss the alert that will matter.
    for (const state of ["loading", "stale", "offline", "partial", "syncing", "no-results"] as const) {
      expect(STATE_SEMANTICS[state].live).toBe("polite")
      expect(STATE_SEMANTICS[state].role).toBe("status")
    }
  })

  it("interrupts for things that must be known now", () => {
    // pending-purge earns assertive: the window to stop an irreversible
    // deletion closes on a clock the reader cannot see.
    for (const state of ["error", "permission-denied", "conflict", "pending-purge"] as const) {
      expect(STATE_SEMANTICS[state].live).toBe("assertive")
      expect(STATE_SEMANTICS[state].role).toBe("alert")
    }
  })

  it("does not announce archived or read-only at all", () => {
    // Both are properties of the record or the seat, not events. Announcing
    // "read-only" every time a region mounts is the noise that gets live
    // regions switched off.
    expect(STATE_SEMANTICS.archived.live).toBe("off")
    expect(STATE_SEMANTICS["read-only"].live).toBe("off")
    expect(STATE_SEMANTICS["read-only"].role).toBe("region")
  })
})

describe("retry", () => {
  it("offers a retry only where the same request could succeed", () => {
    expect(retryAdvice("error").offerRetry).toBe(true)
    expect(retryAdvice("offline").offerRetry).toBe(true)
    expect(retryAdvice("stale").offerRetry).toBe(true)
    expect(retryAdvice("partial").offerRetry).toBe(true)
  })

  it("refuses a retry where it can never work, and says why", () => {
    // A button that will never succeed teaches people to click it.
    expect(retryAdvice("permission-denied")).toEqual({
      offerRetry: false,
      because: "retrying cannot grant a permission",
    })
    expect(retryAdvice("conflict")).toEqual({
      offerRetry: false,
      because: "retrying the identical write reproduces the conflict",
    })
  })

  it("offers no retry for the four states added by GE-143-022", () => {
    // Each for a different reason, and each reason is a real one:
    //   no-results   — the same filters return the same nothing
    //   syncing      — the write is already out; a second is a duplicate write
    //   read-only    — nothing failed
    //   pending-purge— a re-read does not move the deletion date
    for (const state of ["no-results", "syncing", "read-only", "pending-purge"] as const) {
      expect(retryAdvice(state).offerRetry).toBe(false)
    }
    expect(retryAdvice("syncing").because).toMatch(/twice|duplicate/)
    expect(retryAdvice("no-results").because).toMatch(/filter/)
    expect(retryAdvice("pending-purge").because).toMatch(/restore/)
  })

  it("gives a reason for every state that has no retry", () => {
    for (const state of ALL_STATES) {
      const advice = retryAdvice(state)
      expect(advice.because.length).toBeGreaterThan(10)
      expect(advice.offerRetry).toBe(STATE_SEMANTICS[state].retryable)
    }
  })

  it("gives each non-retryable state its own reason, not the fallback", () => {
    // The switch in retryAdvice ends in a `default` that returns the generic
    // "not retryable". Without this, adding a state and forgetting its branch
    // ships a surface that declines to retry and cannot say why — and every
    // other assertion in this file still passes.
    for (const state of ALL_STATES) {
      if (STATE_SEMANTICS[state].retryable) continue
      expect(retryAdvice(state).because).not.toBe("not retryable")
    }
  })
})

describe("copy", () => {
  it("never says what a permission denial is hiding", () => {
    // "You cannot see the Rochester budget" confirms a Rochester budget exists.
    // The API refusals already avoid that oracle; a UI that leaks it back undoes
    // the work.
    const { title, detail } = DEFAULT_COPY["permission-denied"]
    const text = `${title} ${detail}`.toLowerCase()
    for (const leak of ["budget", "rochester", "does not exist", "no such"]) {
      expect(text).not.toContain(leak)
    }
    expect(text).toMatch(/seat|administrator/)
  })

  it("tells a conflicting writer to reload, not to retry", () => {
    // Retrying the identical write reproduces the conflict.
    expect(DEFAULT_COPY.conflict.detail.toLowerCase()).toMatch(/reload/)
    expect(DEFAULT_COPY.conflict.detail.toLowerCase()).not.toMatch(/try again/)
  })

  it("does not let empty read as a failure", () => {
    const text = DEFAULT_COPY.empty.detail.toLowerCase()
    expect(text).toMatch(/up to date|nothing to show/)
    for (const wrong of ["error", "failed", "could not"]) {
      expect(text).not.toContain(wrong)
    }
  })

  it("sends a filtered miss to the filter, not hunting for missing records", () => {
    // This is the whole reason no-results is not empty. Empty says "this is up
    // to date — there is simply nothing to show"; saying that to someone whose
    // filter matched nothing sends them looking for records that are sitting
    // right there behind a chip they forgot to clear.
    const noResults = DEFAULT_COPY["no-results"]
    expect(noResults.detail).not.toBe(DEFAULT_COPY.empty.detail)
    expect(noResults.detail.toLowerCase()).toMatch(/filter/)
    expect(noResults.detail.toLowerCase()).not.toMatch(/up to date/)
  })

  it("never tells someone mid-save that their changes will not save", () => {
    // offline says exactly that, and it is the precise opposite of what is
    // happening while a write is in flight. Collapsing syncing onto offline
    // tells a user their save was lost while it is succeeding.
    expect(DEFAULT_COPY.offline.detail.toLowerCase()).toContain("will not save")
    expect(DEFAULT_COPY.syncing.detail.toLowerCase()).not.toContain("will not save")
    expect(DEFAULT_COPY.syncing.detail.toLowerCase()).not.toContain("offline")
  })

  it("tells a pending purge it is a countdown, not a filing cabinet", () => {
    // archived is "kept for the record". Reading pending-purge that way is how
    // someone fails to restore it before it is gone.
    const purge = DEFAULT_COPY["pending-purge"]
    expect(purge.detail.toLowerCase()).toMatch(/restore/)
    expect(purge.detail.toLowerCase()).toMatch(/permanent|deleted|removed/)
    expect(purge.detail).not.toBe(DEFAULT_COPY.archived.detail)
  })

  it("does not let read-only read as a refusal to show anything", () => {
    // permission-denied hides the data. read-only shows all of it and removes
    // only the edit affordances; borrowing the denial copy would make a viewer
    // seat think the page is broken.
    const text = DEFAULT_COPY["read-only"].detail.toLowerCase()
    expect(text).toMatch(/view|see/)
    expect(text).not.toMatch(/not available|cannot see/)
  })
})

describe("the component renders from the table, not from its own opinions", () => {
  const source = fs.readFileSync(path.join(__dirname, "StateSurface.tsx"), "utf8")

  it("takes role and politeness from the semantics, never from a prop", () => {
    // A component that accepted `role` as a prop would let one call site
    // announce a spinner assertively over whatever the reader was doing.
    expect(source).toMatch(/role=\{semantics\.role\}/)
    expect(source).toMatch(/aria-live=\{semantics\.live/)
    expect(source).not.toMatch(/role\?\s*:/)
    expect(source).not.toMatch(/live\?\s*:/)
  })

  it("renders a textual marker when the surface is incomplete", () => {
    // Colour alone fails for a reader who cannot distinguish it, and "this is
    // not everything" is the thing they must not miss.
    expect(source).toMatch(/!semantics\.presentsAsComplete/)
    expect(source).toMatch(/state-incomplete-marker/)
  })

  it("gates the retry control on the advice, not on the caller", () => {
    expect(source).toMatch(/advice\.offerRetry && onRetry/)
  })

  it("has a tone entry for every tone the table can produce", () => {
    // A missing entry is `undefined.frame` at render — a blank panel in
    // production for whichever state used the tone nobody exercised.
    const tones = new Set(ALL_STATES.map((s) => STATE_SEMANTICS[s].tone))
    const declared = source.slice(source.indexOf("const TONE"), source.indexOf("export function"))
    for (const tone of tones) {
      expect(declared).toContain(`${tone}: {`)
    }
  })

  it("draws every colour from a token, never a literal", () => {
    // A hex here is a colour that does not move with the theme — it survives
    // the dark-mode switch and the high-contrast media query unchanged.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/\b(?:rgb|hsl)a?\(/)
  })
})

/**
 * The geometry arithmetic, separately from the markup.
 *
 * An off-by-one on the gap count is invisible at three rows and is 300px of
 * reflow at forty. Literal expected values, not the formula restated — a test
 * that recomputes `rows * h + (rows - 1) * g` agrees with the bug.
 */
describe("skeleton geometry", () => {
  it("puts n - 1 gaps between n rows, not n", () => {
    expect(skeletonHeight({ rows: 5, rowHeight: 44, gap: 8 })).toBe(252)
  })

  it("puts no gap under a single row", () => {
    expect(skeletonHeight({ rows: 1, rowHeight: 44, gap: 8 })).toBe(44)
  })

  it("reserves nothing for no rows", () => {
    expect(skeletonHeight({ rows: 0, rowHeight: 44, gap: 8 })).toBe(0)
  })

  it("defaults the gap to 8 so a caller may state only rows and height", () => {
    expect(skeletonHeight({ rows: 3, rowHeight: 20 })).toBe(76)
  })

  it("charges a header its own height plus one gap", () => {
    expect(skeletonHeight({ rows: 3, rowHeight: 20, gap: 8, headerHeight: 36 })).toBe(120)
  })

  it("does not charge a gap under a header with nothing beneath it", () => {
    expect(skeletonHeight({ rows: 0, rowHeight: 20, gap: 8, headerHeight: 36 })).toBe(36)
  })

  it("is unaffected by the column split, which is horizontal", () => {
    expect(skeletonHeight({ rows: 5, rowHeight: 44, gap: 8, columns: [3, 1, 1] })).toBe(252)
  })

  it("normalises column weights to shares of the row", () => {
    expect(skeletonColumnShares([3, 1, 1])).toEqual([0.6, 0.2, 0.2])
  })

  it("treats no columns as one full-width column", () => {
    expect(skeletonColumnShares()).toEqual([1])
    expect(skeletonColumnShares([])).toEqual([1])
  })

  it("does not collapse a row when the weights are unusable", () => {
    // A placeholder is never worth an exception, and zero-width columns are a
    // row that renders as nothing at all.
    expect(skeletonColumnShares([0, 0])).toEqual([0.5, 0.5])
    expect(skeletonColumnShares([Number.NaN, 1])).toEqual([0, 1])
  })
})

describe("the skeleton renders the box it computed", () => {
  // Rendered, not read as source. The arithmetic being right is worth nothing
  // if the number never reaches a style attribute.
  const html = renderToStaticMarkup(
    createElement(Skeleton, {
      geometry: { rows: 6, rowHeight: 32, gap: 6, headerHeight: 40, columns: [3, 1, 1] },
    }),
  )

  it("puts the reserved height on the element", () => {
    // 40 header + 6 gap + (6 * 32 + 5 * 6) rows = 268
    expect(html).toContain("height:268px")
    expect(html).toContain("min-height:268px")
    expect(html).toContain('data-skeleton-height="268"')
  })

  it("draws one placeholder row per content row and one cell per column", () => {
    // Anchored on the class attribute: a bare /skeleton-row/ also matches the
    // `data-skeleton-rows` attribute and would count seven.
    expect(html.match(/class="skeleton-row /g)).toHaveLength(6)
    expect(html.match(/class="skeleton-cell /g)).toHaveLength(18)
  })

  it("splits the row by the normalised shares", () => {
    expect(html).toContain("flex-grow:0.6")
    expect(html).toContain("flex-grow:0.2")
  })

  it("is hidden from assistive technology", () => {
    // The surrounding StateSurface announces "Loading" once, politely. A
    // reader must not be read eighteen empty bars.
    expect(html).toContain('aria-hidden="true"')
  })
})

describe("StateSurface hands the loading state to the skeleton", () => {
  it("reserves the content box rather than a one-line card", () => {
    const html = renderToStaticMarkup(
      createElement(StateSurface, { state: "loading", geometry: { rows: 4, rowHeight: 40, gap: 8 } }),
    )
    // 4 * 40 + 3 * 8 = 184
    expect(html).toContain('data-skeleton-height="184"')
    expect(html).toContain('aria-busy="true"')
  })

  it("keeps the announcement while taking the copy out of the layout", () => {
    // Visible title + detail would stack their own height on top of the
    // reservation, which is the reflow this exists to remove — but silently
    // dropping them would take "Loading" out of the accessibility tree.
    const html = renderToStaticMarkup(
      createElement(StateSurface, { state: "loading", geometry: { rows: 4, rowHeight: 40 } }),
    )
    expect(html).toContain("Loading")
    expect(html).toContain("state-title sr-only")
    // No card chrome: a border and 12px of padding around a height-matched
    // placeholder is a height-mismatched placeholder.
    expect(html).not.toContain("px-4 py-3")
  })

  it("still renders the plain card when no geometry is supplied", () => {
    const html = renderToStaticMarkup(createElement(StateSurface, { state: "loading" }))
    expect(html).not.toContain("skeleton")
    expect(html).toContain("px-4 py-3")
  })

  it("never stands in for content in a state that already has its answer", () => {
    for (const state of ALL_STATES) {
      if (state === "loading") continue
      const html = renderToStaticMarkup(
        createElement(StateSurface, { state, geometry: { rows: 3, rowHeight: 40 } }),
      )
      expect(html).not.toContain("data-skeleton-height")
    }
  })

  it("renders every state with the role and politeness from the table", () => {
    // Also the only check that catches a tone with no TONE entry: that is
    // `undefined.frame` at render, a blank panel in production for whichever
    // state used the tone nobody exercised.
    for (const state of ALL_STATES) {
      const semantics = STATE_SEMANTICS[state]
      const html = renderToStaticMarkup(createElement(StateSurface, { state }))
      expect(html).toContain(`role="${semantics.role}"`)
      expect(html).toContain(`data-state="${state}"`)
      if (semantics.live === "off") {
        expect(html).not.toContain("aria-live")
      } else {
        expect(html).toContain(`aria-live="${semantics.live}"`)
      }
    }
  })
})
