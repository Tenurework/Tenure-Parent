/**
 * The ten states, tested as decisions rather than as styling.
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

import {
  ALL_STATES,
  DEFAULT_COPY,
  INCOMPLETE_STATES,
  STATE_SEMANTICS,
  retryAdvice,
} from "./states"

describe("coverage", () => {
  it("covers exactly the ten states the item names", () => {
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
        "offline",
        "partial",
        "permission-denied",
        "stale",
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
        "permission-denied",
        "stale",
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
})

describe("how loudly a screen reader is interrupted", () => {
  it("never interrupts for progress or freshness", () => {
    // Interrupting a reader for a spinner, or for data being slightly old,
    // trains them to dismiss the alert that will matter.
    for (const state of ["loading", "stale", "offline", "partial"] as const) {
      expect(STATE_SEMANTICS[state].live).toBe("polite")
      expect(STATE_SEMANTICS[state].role).toBe("status")
    }
  })

  it("interrupts for things that must be known now", () => {
    for (const state of ["error", "permission-denied", "conflict"] as const) {
      expect(STATE_SEMANTICS[state].live).toBe("assertive")
      expect(STATE_SEMANTICS[state].role).toBe("alert")
    }
  })

  it("does not announce archived at all", () => {
    // It is a property of the record, not an event.
    expect(STATE_SEMANTICS.archived.live).toBe("off")
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

  it("gives a reason for every state that has no retry", () => {
    for (const state of ALL_STATES) {
      const advice = retryAdvice(state)
      expect(advice.because.length).toBeGreaterThan(10)
      expect(advice.offerRetry).toBe(STATE_SEMANTICS[state].retryable)
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
