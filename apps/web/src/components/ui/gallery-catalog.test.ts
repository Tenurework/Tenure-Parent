/**
 * TTES-020-004 — the catalogue is derived, not transcribed.
 *
 * `e2e/visual-baselines.spec.ts` fails on a missing baseline when a new entry
 * appears, but that only helps if a new state actually produces a new entry.
 * A catalogue that re-listed the fourteen states by hand would keep rendering
 * fourteen after somebody added a fifteenth, every baseline would still match,
 * and the suite would report green over a state nobody had ever looked at.
 *
 * These assertions are the link. They compare the catalogue against the modules
 * it claims to read — `states.ts`, Button's variant maps, Badge's tone map — so
 * the derivation is checked rather than trusted to the comment on it.
 */
import { BADGE_VARIANT_STYLES } from "./Badge"
import { BUTTON_SIZES, BUTTON_VARIANTS } from "./Button"
import { GALLERY_ENTRIES, GALLERY_GROUPS } from "./gallery-catalog"
import { ALL_STATES } from "./states"

const idsOfKind = (kind: string) => GALLERY_ENTRIES.filter((e) => e.kind === kind).map((e) => e.id)

describe("gallery catalogue", () => {
  it("renders every SurfaceState, bare and wrapping rows", () => {
    // Twice per state: the "Incomplete — do not read this as the full result"
    // marker in StateSurface only renders when an incomplete state is given
    // children, and it is the single most load-bearing element in the state
    // system. A catalogue that only photographed the bare card would never see
    // it change.
    const surfaces = idsOfKind("surface")
    for (const state of ALL_STATES) {
      expect(surfaces).toContain(`surface-${state}`)
      expect(surfaces).toContain(`surface-${state}-rows`)
    }
    expect(surfaces).toHaveLength(ALL_STATES.length * 2)
  })

  it("renders every button variant at every size, and every variant disabled", () => {
    const buttons = idsOfKind("button")
    const variants = Object.keys(BUTTON_VARIANTS)
    const sizes = Object.keys(BUTTON_SIZES)

    const slug = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    for (const variant of variants) {
      for (const size of sizes) expect(buttons).toContain(`button-${slug(variant)}-${slug(size)}`)
      expect(buttons).toContain(`button-${slug(variant)}-disabled`)
    }
    expect(buttons).toHaveLength(variants.length * sizes.length + variants.length)
  })

  it("renders every badge tone", () => {
    const badges = idsOfKind("badge")
    for (const variant of Object.keys(BADGE_VARIANT_STYLES)) expect(badges).toContain(`badge-${variant}`)
    expect(badges).toHaveLength(Object.keys(BADGE_VARIANT_STYLES).length)
  })

  it("gives every entry a unique, stable id", () => {
    // The id becomes the screenshot filename. A duplicate would have two
    // renderings comparing against one baseline, and whichever ran second would
    // look like a regression of the first.
    const ids = GALLERY_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it("explains why every group is in the matrix", () => {
    // A group with no stated reason is a group nobody can decide to remove.
    for (const group of GALLERY_GROUPS) {
      expect(group.entries.length).toBeGreaterThan(0)
      expect(group.rationale.length).toBeGreaterThan(40)
    }
  })
})
