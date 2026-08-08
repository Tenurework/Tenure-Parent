import { describe, expect, it } from "@jest/globals"

import {
  patternMatches,
  selectorDiff,
  selectorProblems,
  selectorSelects,
  type KnownResource,
  type ResourceSelector,
} from "./resource-selector"

/**
 * WRK-020-002 — the selector itself, and the one rule everything else rests on.
 *
 * The gate-level tests (a `selector-invalid` reason coming out of
 * `availabilityDecisions`) live in `catalogs.test.ts`, because that is what the
 * production path emits. What is here is the semantics: exclude beats include,
 * a diff says which objects stop being reachable, and a version that cannot be
 * ordered is refused.
 */

const KNOWN: readonly KnownResource[] = [
  { externalId: "root", kind: "container", ancestors: [] },
  { externalId: "finance", kind: "container", ancestors: ["root"] },
  { externalId: "payroll", kind: "container", ancestors: ["root", "finance"] },
  { externalId: "budget.xlsx", kind: "object", ancestors: ["root", "finance"] },
  { externalId: "salaries.xlsx", kind: "object", ancestors: ["root", "finance", "payroll"] },
  { externalId: "handbook.pdf", kind: "object", ancestors: ["root"] },
]

const at = (externalId: string): KnownResource => KNOWN.find((r) => r.externalId === externalId)!

describe("a pattern covers a resource in exactly two ways", () => {
  it("matches the resource it names, at the same kind", () => {
    expect(
      patternMatches({ kind: "object", externalId: "budget.xlsx", recursive: false }, at("budget.xlsx")),
    ).toBe(true)
    // Kind is load-bearing, not decoration: an `object` pattern that matched a
    // folder would be a selection nobody wrote.
    expect(
      patternMatches({ kind: "object", externalId: "finance", recursive: false }, at("finance")),
    ).toBe(false)
  })

  it("carries descendants only when a container says recursive", () => {
    const recursive = { kind: "container" as const, externalId: "finance", recursive: true }
    const shallow = { kind: "container" as const, externalId: "finance", recursive: false }

    expect(patternMatches(recursive, at("budget.xlsx"))).toBe(true)
    expect(patternMatches(recursive, at("salaries.xlsx"))).toBe(true)
    // "Index this folder's metadata, not the thousand files in it" is a real
    // selection, and a non-recursive container is how it is said.
    expect(patternMatches(shallow, at("budget.xlsx"))).toBe(false)
    expect(patternMatches(shallow, at("finance"))).toBe(true)
  })

  it("does not reach outside the subtree it names", () => {
    const recursive = { kind: "container" as const, externalId: "finance", recursive: true }
    expect(patternMatches(recursive, at("handbook.pdf"))).toBe(false)
  })
})

describe("exclude always wins", () => {
  const selector: ResourceSelector = {
    version: 3,
    include: [{ kind: "container", externalId: "finance", recursive: true }],
    exclude: [{ kind: "container", externalId: "payroll", recursive: true }],
  }

  it("drops an object matched by both", () => {
    // The direction this rule gets wrong is the one where an excluded folder is
    // indexed anyway, which is why it is stated once and not re-derived.
    expect(selectorSelects(selector, at("salaries.xlsx"))).toBe(false)
    expect(selectorSelects(selector, at("payroll"))).toBe(false)
    expect(selectorSelects(selector, at("budget.xlsx"))).toBe(true)
  })

  it("does not select something no include matched, exclusion or not", () => {
    expect(selectorSelects(selector, at("handbook.pdf"))).toBe(false)
  })
})

describe("an impact diff answers what a scope change would do", () => {
  const before: ResourceSelector = {
    version: 1,
    include: [{ kind: "container", externalId: "finance", recursive: true }],
    exclude: [],
  }

  it("treats a first selection as all additions", () => {
    expect(selectorDiff(null, before, KNOWN)).toEqual({
      added: ["finance", "payroll", "budget.xlsx", "salaries.xlsx"],
      removed: [],
      unchanged: [],
    })
  })

  it("names what stops being reachable when a folder is excluded", () => {
    const after: ResourceSelector = {
      ...before,
      version: 2,
      exclude: [{ kind: "container", externalId: "payroll", recursive: true }],
    }
    expect(selectorDiff(before, after, KNOWN)).toEqual({
      added: [],
      removed: ["payroll", "salaries.xlsx"],
      unchanged: ["finance", "budget.xlsx"],
    })
  })

  it("names what starts being reachable when the selection widens", () => {
    const after: ResourceSelector = {
      version: 2,
      include: [{ kind: "container", externalId: "root", recursive: true }],
      exclude: [],
    }
    const diff = selectorDiff(before, after, KNOWN)
    expect(diff.added).toEqual(["root", "handbook.pdf"])
    expect(diff.removed).toEqual([])
  })

  it("reports nothing for a re-save that changes nothing", () => {
    expect(selectorDiff(before, { ...before, version: 2 }, KNOWN).removed).toEqual([])
    expect(selectorDiff(before, { ...before, version: 2 }, KNOWN).added).toEqual([])
  })
})

describe("a selection that cannot be read is refused", () => {
  it("refuses an empty include set", () => {
    // It means "everything" to whoever wrote the connect screen and "nothing"
    // to whoever wrote the sync runner, and both readings ship.
    const problems = selectorProblems({ version: 1, include: [], exclude: [] })
    expect(problems.map((p) => p.reason)).toEqual(["include-empty"])
    expect(problems[0].detail).toMatch(/everything to one reader and nothing to another/)
  })

  it("refuses an exclude rule nothing could have selected", () => {
    const dead: ResourceSelector = {
      version: 1,
      include: [{ kind: "object", externalId: "budget.xlsx", recursive: false }],
      exclude: [{ kind: "object", externalId: "salaries.xlsx", recursive: false }],
    }
    expect(selectorProblems(dead).map((p) => p.reason)).toEqual(["exclude-matches-nothing"])
  })

  it("keeps an exclusion that carves out of an exact include", () => {
    const live: ResourceSelector = {
      version: 1,
      include: [{ kind: "container", externalId: "finance", recursive: false }],
      exclude: [{ kind: "container", externalId: "finance", recursive: false }],
    }
    // Redundant, and not dead: removing the exclude rule changes the selection.
    expect(selectorProblems(live)).toEqual([])
  })

  it("keeps a sub-folder exclusion under a recursive include", () => {
    // The conservative half. A recursive include COULD contain a folder nothing
    // in the selector names, so an exclude under it is live — and a validator
    // that deleted real protections would be worse than one that kept a
    // redundant rule.
    const live: ResourceSelector = {
      version: 1,
      include: [{ kind: "container", externalId: "root", recursive: true }],
      exclude: [{ kind: "container", externalId: "payroll", recursive: true }],
    }
    expect(selectorProblems(live)).toEqual([])
  })

  it("refuses a pattern that names nothing", () => {
    const blank: ResourceSelector = {
      version: 1,
      include: [{ kind: "container", externalId: "  ", recursive: true }],
      exclude: [],
    }
    expect(selectorProblems(blank).map((p) => p.reason)).toEqual(["pattern-empty"])
  })

  it("refuses a version that did not increase over the selection it replaces", () => {
    const previous: ResourceSelector = {
      version: 4,
      include: [{ kind: "container", externalId: "finance", recursive: true }],
      exclude: [],
    }
    expect(selectorProblems({ ...previous, version: 4 }, previous).map((p) => p.reason)).toEqual([
      "version-not-increased",
    ])
    expect(selectorProblems({ ...previous, version: 3 }, previous).map((p) => p.reason)).toEqual([
      "version-not-increased",
    ])
    expect(selectorProblems({ ...previous, version: 5 }, previous)).toEqual([])
    // A first selection has nothing to have failed to increase past.
    expect(selectorProblems(previous)).toEqual([])
  })

  it("refuses a version nothing can be ordered by", () => {
    const base: ResourceSelector = {
      version: 1,
      include: [{ kind: "container", externalId: "finance", recursive: true }],
      exclude: [],
    }
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(selectorProblems({ ...base, version }).map((p) => p.reason)).toEqual([
        "version-invalid",
      ])
    }
  })
})
