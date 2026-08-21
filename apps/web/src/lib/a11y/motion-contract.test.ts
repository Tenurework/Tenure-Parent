/**
 * GE-143-038 — the motion contract, and the proof each detector works.
 *
 * Same shape as `density-contract.test.ts` and for the same reason: the group
 * that asserts the shipped stylesheet is clean is worth nothing unless the
 * groups above it have shown the audit says something when the stylesheet is
 * dirty. Each clause of the requirement gets a stylesheet that violates it.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  CONTINUOUS_MOTION,
  MOTION_BAND,
  REDUCED_MOTION_PROPERTIES,
  auditMotion,
  auditShippedMotion,
  motionScale,
  scanForcedFeedback,
  scanShippedForcedFeedback,
} from "./motion-contract"
import { rulesIn } from "./density-contract"

const REDUCE_BLOCK = `  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }`

const SCALE = `  :root {
    --motion-fast: 120ms;
    --motion-base: 180ms;
    --motion-slow: 220ms;
    --ease-entry: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  }`

const KEYFRAMES = `  @keyframes tenure-panel-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes tenure-panel-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(6px); }
  }`

const RULES = `  .overlay-panel[data-entering] { animation: tenure-panel-in var(--motion-base) var(--ease-entry); }
  .overlay-panel[data-exiting] { animation: tenure-panel-out var(--motion-fast) var(--ease-exit); }`

function sheet(parts: { scale?: string; keyframes?: string; rules?: string; reduce?: string }) {
  return `@layer base {
${parts.scale ?? SCALE}
${parts.reduce ?? REDUCE_BLOCK}
}
@layer components {
${parts.keyframes ?? KEYFRAMES}
${parts.rules ?? RULES}
}`
}

describe("motionScale", () => {
  it("reads the governed durations in milliseconds, whatever unit they are written in", () => {
    const scale = motionScale(rulesIn(`:root { --motion-fast: 120ms; --motion-slow: 0.22s; }`))
    expect([...scale]).toEqual([
      ["--motion-fast", 120],
      ["--motion-slow", 220],
    ])
  })
})

describe("the audit detects each clause being broken", () => {
  it("names a duration outside the 120–220ms band", () => {
    const audit = auditMotion(sheet({ scale: SCALE.replace("220ms", "240ms") }))
    const out = audit.findings.filter((f) => f.code === "duration-out-of-band")
    expect(out).toHaveLength(1)
    expect(out[0].where).toBe("--motion-slow")
    expect(out[0].detail).toBe(
      `240ms is outside the governed ${MOTION_BAND.minMs}–${MOTION_BAND.maxMs}ms band`,
    )
  })

  it("names a duration below the band too, not only above it", () => {
    // 60ms is not "restrained", it is a flicker.
    const audit = auditMotion(sheet({ scale: SCALE.replace("--motion-fast: 120ms", "--motion-fast: 60ms") }))
    expect(audit.findings.filter((f) => f.code === "duration-out-of-band").map((f) => f.where)).toEqual([
      "--motion-fast",
    ])
  })

  it("names a hand-picked literal duration in a rule", () => {
    const audit = auditMotion(
      sheet({ rules: `  .thing { transition: opacity 320ms var(--ease-entry); }` }),
    )
    expect(audit.findings.filter((f) => f.code === "ungoverned-duration")).toHaveLength(1)
    expect(audit.findings[0].detail).toContain("320ms")
  })

  it("names a hand-written timing function", () => {
    const audit = auditMotion(
      sheet({ rules: `  .thing { transition: opacity var(--motion-fast) ease-in-out; }` }),
    )
    expect(audit.findings.filter((f) => f.code === "ungoverned-easing")).toHaveLength(1)
  })

  it("names an arrival eased like a departure", () => {
    // The defect that makes an interface feel wrong without looking wrong.
    const audit = auditMotion(
      sheet({ rules: RULES.replace("tenure-panel-in var(--motion-base) var(--ease-entry)", "tenure-panel-in var(--motion-base) var(--ease-exit)") }),
    )
    const reversed = audit.findings.filter((f) => f.code === "easing-reversed")
    expect(reversed).toHaveLength(1)
    expect(reversed[0].detail).toContain("--ease-entry")
  })

  it("names a panel that appears without travelling", () => {
    const audit = auditMotion(
      sheet({
        keyframes: `  @keyframes tenure-panel-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes tenure-panel-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(6px); } }`,
      }),
    )
    const still = audit.findings.filter((f) => f.code === "spatial-transition-does-not-travel")
    expect(still).toHaveLength(1)
    expect(still[0].where).toBe("@keyframes tenure-panel-in")
  })

  it("lets a scrim fade, because a scrim has no position to preserve", () => {
    const audit = auditMotion(
      sheet({
        keyframes: `${KEYFRAMES}
  @keyframes tenure-overlay-in { from { opacity: 0; } to { opacity: 1; } }`,
        rules: `${RULES}
  .overlay-backdrop[data-entering] { animation: tenure-overlay-in var(--motion-base) var(--ease-entry); }`,
      }),
    )
    expect(audit.findings.filter((f) => f.code === "spatial-transition-does-not-travel")).toEqual([])
  })

  it("names an unregistered continuous animation", () => {
    const audit = auditMotion(
      sheet({
        keyframes: `${KEYFRAMES}\n  @keyframes shimmer { from { opacity: 1; } to { opacity: 0.4; } }`,
        rules: `${RULES}\n  .hero-glow { animation: shimmer 3s ease-in-out infinite; }`,
      }),
    )
    const unregistered = audit.findings.filter((f) => f.code === "unregistered-continuous-motion")
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0].where).toBe(".hero-glow")
  })

  it("names a register entry the stylesheet does not back", () => {
    // The register is a claim about the product; a claim about a rule that does
    // not exist is the kind of documentation that outlives its subject.
    const audit = auditMotion(sheet({}))
    const stale = audit.findings.filter((f) => f.code === "register-disagrees-with-stylesheet")
    expect(stale.map((f) => f.where)).toEqual(CONTINUOUS_MOTION.map((c) => c.selector))
  })

  it("names a register entry whose duration has drifted from the stylesheet", () => {
    const audit = auditMotion(
      sheet({
        keyframes: `${KEYFRAMES}\n  @keyframes tenure-pulse-soft { 0% { opacity: 1; } 50% { opacity: 0.45; } }`,
        rules: `${RULES}\n  .live-dot { animation: tenure-pulse-soft 5s ease-in-out infinite; }`,
      }),
    )
    const drift = audit.findings.filter((f) => f.code === "register-disagrees-with-stylesheet")
    expect(drift).toHaveLength(1)
    expect(drift[0].detail).toContain("register says tenure-pulse-soft at 2s")
  })

  it("names each reduced-motion property that is missing", () => {
    for (const property of REDUCED_MOTION_PROPERTIES) {
      const audit = auditMotion(
        sheet({ reduce: REDUCE_BLOCK.split("\n").filter((l) => !l.includes(`${property}:`)).join("\n") }),
      )
      const gaps = audit.findings.filter((f) => f.code === "reduced-motion-incomplete")
      expect({ property, count: gaps.length }).toEqual({ property, count: 1 })
      expect(gaps[0].detail).toContain(property)
    }
  })

  it("names a reduced-motion override without !important", () => {
    const audit = auditMotion(
      sheet({ reduce: REDUCE_BLOCK.replace("transition-duration: 0.01ms !important;", "transition-duration: 0.01ms;") }),
    )
    const gaps = audit.findings.filter((f) => f.code === "reduced-motion-incomplete")
    expect(gaps).toHaveLength(1)
    expect(gaps[0].detail).toContain("!important")
  })

  it("names a reduced-motion override that does not reach every element", () => {
    const audit = auditMotion(
      sheet({ reduce: REDUCE_BLOCK.replace("*, *::before, *::after", ".panel") }),
    )
    expect(
      audit.findings.filter(
        (f) => f.code === "reduced-motion-incomplete" && f.detail.includes("every element"),
      ),
    ).toHaveLength(1)
  })

  it("says so when there is no reduced-motion override at all", () => {
    const audit = auditMotion(sheet({ reduce: "" }))
    expect(
      audit.findings.filter((f) => f.detail === "there is no reduced-motion override at all"),
    ).toHaveLength(1)
  })
})

describe("forced sound and haptics", () => {
  it("finds each kind when it is there", () => {
    // The detector is fed a positive fixture rather than trusted because the
    // repository is clean: an empty result from a scanner nobody has ever seen
    // return a hit is indistinguishable from a scanner that cannot look.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forced-feedback-"))
    fs.writeFileSync(path.join(dir, "buzz.ts"), "export const go = () => navigator.vibrate(200)\n")
    fs.writeFileSync(path.join(dir, "ping.ts"), "const a = new Audio('/ping.mp3'); a.play()\n")
    fs.writeFileSync(path.join(dir, "Clip.tsx"), "export const C = () => <video autoPlay src=\"/x.mp4\" />\n")
    fs.writeFileSync(path.join(dir, "quiet.ts"), "export const nothing = 1\n")
    try {
      const found = scanForcedFeedback(dir)
      expect(found.map((f) => `${f.file}:${f.kind}`)).toEqual([
        "buzz.ts:haptics",
        "Clip.tsx:autoplay",
        "ping.ts:sound",
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("does not read a hit out of a comment", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forced-feedback-"))
    fs.writeFileSync(path.join(dir, "note.ts"), "// we deliberately never call navigator.vibrate(200)\nexport const x = 1\n")
    try {
      expect(scanForcedFeedback(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("finds none in the product", () => {
    expect(scanShippedForcedFeedback()).toEqual([])
  })
})

describe("the shipped stylesheet", () => {
  const audit = auditShippedMotion()

  it("animates enough rules for the audit to be looking at something", () => {
    expect(audit.animated.length).toBeGreaterThanOrEqual(10)
    expect(audit.scale.size).toBe(3)
  })

  it("has no finding", () => {
    expect(audit.findings).toEqual([])
  })

  it("keeps every governed duration inside the band", () => {
    for (const [token, ms] of audit.scale) {
      expect({ token, inBand: ms >= MOTION_BAND.minMs && ms <= MOTION_BAND.maxMs }).toEqual({
        token,
        inBand: true,
      })
    }
  })

  it("registers every continuous animation with a reduced-motion reading", () => {
    expect(CONTINUOUS_MOTION.length).toBeGreaterThan(0)
    for (const entry of CONTINUOUS_MOTION) {
      // A justification and a reduced-motion account, not a placeholder.
      expect(entry.justification.length).toBeGreaterThan(80)
      expect(entry.whenMotionReduced.length).toBeGreaterThan(80)
    }
  })
})
