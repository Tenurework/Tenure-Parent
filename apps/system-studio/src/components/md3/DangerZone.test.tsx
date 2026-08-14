import fs from "node:fs"
import path from "node:path"

import { renderToStaticMarkup } from "react-dom/server"

import { ALL_STATES, type TenantState } from "@tenure/provisioning"

import {
  NO_RETAINED_AWS_OBSERVATION,
  canReachServing,
  observedFor,
  riskOf,
} from "../../lib/tenant-state"
import type { HighRisk } from "../states"
import {
  DANGER_ZONE_ATTRIBUTE,
  DANGER_ZONE_GROUP,
  DANGER_ZONE_LEGEND,
  DANGER_ZONE_REGION,
  DangerZone,
  IRREVERSIBLE,
  REVERSIBLE,
  RISK_ATTRIBUTE,
  classifyConsequence,
  isIrreversible,
  type DangerAction,
} from "./DangerZone"

/**
 * STUDIO-030-004 — the region, proven to separate rather than described as
 * separating.
 *
 * Four things have to hold, and each is the kind of thing that quietly stops
 * holding:
 *
 *   1. The classifier agrees with the engine that writes the sentence. Not for
 *      one transition — for every state in the lifecycle graph, compared
 *      against `canReachServing`, which is the fact `riskOf` derives the words
 *      from. A regex that stopped matching would put PURGING in the ordinary
 *      row, and a single hand-picked example is exactly the test that would
 *      still pass.
 *   2. The irreversible control is INSIDE the separated region and the ordinary
 *      one is OUTSIDE it, in that order in the markup. Asserted on the rendered
 *      HTML, not on the props.
 *   3. An unreadable consequence throws. The default that would be taken
 *      otherwise is "ordinary", and it would be taken about the actions nobody
 *      has reviewed.
 *   4. The attribute names the guard reads are the ones the component emits.
 *      `e2e/destructive-separation.spec.ts` looks for `data-risk`; a component
 *      emitting `data-risk-level` would leave that guard finding nothing and
 *      passing.
 *
 * Rendering assertions live here rather than in `e2e/` because Playwright
 * transforms JSX with its own component-locator pragma and cannot build a React
 * tree — the same reason `aws-outcomes.test.tsx` is beside its components. jest
 * roots include `apps/system-studio/src`; see `apps/web/jest.config.js`.
 *
 * Assertions carry no message argument: jest's `expect` takes one, unlike the
 * Playwright `expect` used across `e2e/`. Where a bare boolean would produce an
 * unreadable failure, the value compared contains the explanation instead.
 */

/** What a pooled, deployed, non-serving tenant is holding — a real observation. */
const OBSERVED = observedFor({
  isolation: "pooled",
  hasDeployment: true,
  serving: false,
  evidenceRecords: 2,
})

const SLUG = "acme-collective"

function risk(from: TenantState, to: TenantState): HighRisk {
  return riskOf(SLUG, from, to, NO_RETAINED_AWS_OBSERVATION, OBSERVED)
}

/** PURGE_PENDING is the one state whose successors include both kinds. */
const PURGE = risk("PURGE_PENDING", "PURGING")
const HOLD = risk("PURGE_PENDING", "LEGAL_HOLD")
const OFFBOARD = risk("PURGE_PENDING", "OFFBOARDING")

const ACTIONS: DangerAction[] = [
  { label: "LEGAL_HOLD", risk: HOLD },
  { label: "PURGING", risk: PURGE, note: "deletes every row" },
  { label: "OFFBOARDING", risk: OFFBOARD },
]

function render(actions: readonly DangerAction[] = ACTIONS): string {
  return renderToStaticMarkup(
    <DangerZone id="advance-acme" subject={SLUG} actions={actions} />,
  )
}

/** The separated region's markup, from its opening tag to its close. */
function regionOf(html: string): string {
  const start = html.indexOf("<fieldset")
  const end = html.indexOf("</fieldset>")
  // A nested fieldset would make this slice a lie, so it is checked rather than
  // assumed: the region this component renders contains exactly one.
  expect(html.split("<fieldset").length - 1).toBe(1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end + "</fieldset>".length)
}

/* ── 1. The classifier and the engine cannot disagree ─────────────────────── */

describe("the consequence is read off the lifecycle graph, not off a list", () => {
  it("classifies every state in the graph the way canReachServing does", () => {
    // `riskOf` writes IRREVERSIBLE exactly when no serving state is reachable
    // from the destination. Walking all of ALL_STATES is what makes this a
    // binding rather than an example: one hand-picked pair would keep passing
    // after a rename that broke every other state.
    const disagreements = ALL_STATES.filter((state) => {
      const expected = canReachServing(state) ? REVERSIBLE : IRREVERSIBLE
      return classifyConsequence(risk("ACTIVE", state)) !== expected
    })
    expect(disagreements).toEqual([])
  })

  it("finds both kinds in the graph, so neither branch is untested", () => {
    // An absence check over a one-sided input passes for the wrong reason.
    const oneWay = ALL_STATES.filter((s) => isIrreversible(risk("ACTIVE", s)))
    const ordinary = ALL_STATES.filter((s) => !isIrreversible(risk("ACTIVE", s)))
    expect(oneWay).toEqual(["PURGING", "PURGED_ZERO_INCREMENTAL_COST"])
    expect(ordinary.length).toBe(ALL_STATES.length - 2)
  })

  it("refuses a consequence it cannot read, rather than filing it as ordinary", () => {
    const unreadable: HighRisk = { ...PURGE, reversibility: "This one is fine, honestly." }
    expect(() => classifyConsequence(unreadable)).toThrow(/neither IRREVERSIBLE nor Reversible/)
    // The offending sentence is in the message: a refusal that does not quote
    // what it refused sends the reader to the wrong file.
    expect(() => classifyConsequence(unreadable)).toThrow(/This one is fine, honestly/)
  })

  it("does not accept a sentence that merely mentions the word", () => {
    // Anchored at the start, because `riskOf` puts it there. A sentence reading
    // "Reversible, unlike the IRREVERSIBLE ones" must classify as reversible.
    const mentions: HighRisk = {
      ...HOLD,
      reversibility: "Reversible. Unlike the IRREVERSIBLE ones, a serving state is reachable.",
    }
    expect(classifyConsequence(mentions)).toBe(REVERSIBLE)
  })
})

/* ── 2. The separation, in the rendered markup ────────────────────────────── */

describe("an irreversible control is not in the group with the ordinary ones", () => {
  it("renders the irreversible action inside the separated region", () => {
    const html = render()
    const region = regionOf(html)
    // The CONTROL, not the word. The region also prints the risk's own sentence,
    // which names the destination — an assertion for the bare string passes on a
    // region that contains only prose about a button somewhere else.
    expect(region).toMatch(/<button[^>]*>PURGING/)
    expect(region).toContain(`${DANGER_ZONE_ATTRIBUTE}="${DANGER_ZONE_REGION}"`)
    expect(html.replace(region, "")).not.toMatch(/<button[^>]*>PURGING/)
  })

  it("renders every ordinary action outside that region", () => {
    const html = render()
    const region = regionOf(html)
    const outside = html.replace(region, "")
    for (const label of ["LEGAL_HOLD", "OFFBOARDING"]) {
      expect(region.includes(label)).toBe(false)
      expect(outside).toContain(label)
    }
  })

  it("puts the region after the ordinary group, so nobody passes over it", () => {
    const html = render()
    expect(html.indexOf("LEGAL_HOLD")).toBeLessThan(html.indexOf("<fieldset"))
    expect(html.indexOf(DANGER_ZONE_GROUP)).toBeLessThan(html.indexOf("<fieldset"))
  })

  it("says what cannot be undone in words, not only in colour", () => {
    const region = regionOf(render())
    expect(region).toContain(DANGER_ZONE_LEGEND)
    expect(DANGER_ZONE_LEGEND).toMatch(/irreversible/i)
    // The engine's own sentence, printed — not a slogan written in this file.
    expect(region).toContain(PURGE.reversibility)
    expect(region).toContain(SLUG)
  })

  it("describes the irreversible control by that sentence", () => {
    const region = regionOf(render())
    expect(region).toContain('aria-describedby="advance-acme-consequence"')
    expect(region).toContain('id="advance-acme-consequence"')
  })

  it("emits exactly the attribute names the console-wide guard reads", () => {
    const html = render()
    expect(RISK_ATTRIBUTE).toBe("data-risk")
    expect(DANGER_ZONE_ATTRIBUTE).toBe("data-danger-zone")
    const region = regionOf(html)
    expect(region).toContain(`${RISK_ATTRIBUTE}="${IRREVERSIBLE}"`)
    const outside = html.replace(region, "")
    expect(outside).toContain(`${RISK_ATTRIBUTE}="${REVERSIBLE}"`)
    // And not the other way round, in either half.
    expect(region.includes(`${RISK_ATTRIBUTE}="${REVERSIBLE}"`)).toBe(false)
    expect(outside.includes(`${RISK_ATTRIBUTE}="${IRREVERSIBLE}"`)).toBe(false)
  })

  it("gives the irreversible control a different emphasis and tone", () => {
    // The third axis. Not the carrier of the meaning — the spatial separation
    // and the legend are — but a control that looks identical to its neighbours
    // is one an operator has no reason to slow down for.
    const html = render()
    const region = regionOf(html)
    expect(region).toContain('data-tone="danger"')
    expect(region).toContain('data-variant="outlined"')
    const outside = html.replace(region, "")
    expect(outside).toContain('data-tone="neutral"')
    expect(outside.includes('data-tone="danger"')).toBe(false)
  })

  it("renders no region at all when nothing in the group is irreversible", () => {
    const html = render([{ label: "LEGAL_HOLD", risk: HOLD }])
    expect(html.includes("<fieldset")).toBe(false)
    expect(html).toContain("LEGAL_HOLD")
  })

  it("renders only the region when everything in the group is irreversible", () => {
    const html = render([{ label: "PURGING", risk: PURGE }])
    expect(regionOf(html)).toContain("PURGING")
    expect(html.replace(regionOf(html), "").includes("<button")).toBe(false)
  })
})

/* ── 3. The caller cannot hand it something meaningless ───────────────────── */

describe("the region refuses a call it cannot honour", () => {
  it("refuses an empty group rather than rendering a finished-looking page", () => {
    expect(() => render([])).toThrow(/was given no actions/)
  })

  it("refuses two controls with one accessible name", () => {
    expect(() =>
      render([
        { label: "PURGING", risk: PURGE },
        { label: "PURGING", risk: OFFBOARD },
      ]),
    ).toThrow(/two actions called "PURGING"/)
  })

  it("throws before rendering half a group when one consequence is unreadable", () => {
    const bad: DangerAction = {
      label: "SOMETHING",
      risk: { ...PURGE, reversibility: "" },
    }
    expect(() => render([{ label: "LEGAL_HOLD", risk: HOLD }, bad])).toThrow(
      /cannot classify the consequence/,
    )
  })
})

/* ── 4. The directory's own rule ──────────────────────────────────────────── */

describe("the component holds no colour", () => {
  /**
   * A narrower copy of the scan in `e2e/md3-tokens-logic.spec.ts`, repeated
   * here for the reason `Logo.test.tsx` repeats it: that spec runs in the
   * Playwright suite, and the check that catches the edit on the day it is made
   * is the one that runs in `npm run test`.
   */
  const source = fs
    .readFileSync(path.join(__dirname, "DangerZone.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("contains no hex, no colour function and no colour keyword", () => {
    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull()
    expect(source.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/g)).toBeNull()
    expect(
      source.match(/\b(?:color|background|border|outline|fill|stroke)\s*:\s*["']?[a-z]+\b/gi),
    ).toBeNull()
  })

  it("emits no class the stylesheet does not declare", () => {
    // The other half of the same rule, and the half that actually bites here:
    // this region deliberately reuses the screen classes the tenant page's
    // separation is already drawn with (`destructive`, `chips`, `hint`) rather
    // than inventing `md3-danger-zone`, which would need a rule in a file this
    // component does not own — and would render unstyled until somebody wrote
    // one, which in a screenshot is indistinguishable from a rule that stopped
    // matching. `md3-tokens-logic.spec.ts` only audits `md3-*` names, so an
    // undeclared plain class is invisible to it.
    const css = fs.readFileSync(
      path.join(__dirname, "..", "..", "app", "globals.css"),
      "utf8",
    )
    const emitted = [...source.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
    expect(emitted.sort()).toEqual(["chips", "chips", "destructive", "hint", "slug"])
    expect(emitted.filter((c) => !css.includes(`.${c}`))).toEqual([])
  })
})
