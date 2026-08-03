import { ROLE_TEMPLATES } from "@tenure/authorization"

import { seatTemplateFromForm } from "./seat-template"

/**
 * GE-051-005 — an unrecognised bundle is refused, not quietly downgraded.
 */

const form = (value?: string) => ({
  get: (name: string) => (name === "templateKey" && value !== undefined ? value : null),
})

describe("choosing what a new seat carries", () => {
  it("accepts every template the platform ships", () => {
    for (const template of ROLE_TEMPLATES) {
      expect(seatTemplateFromForm(form(template.key))).toBe(template.key)
    }
  })

  it("refuses a key nobody declared", () => {
    // Silently substituting the smallest bundle would look like a working form
    // and produce a finance officer who cannot touch a budget, with nothing
    // anywhere saying why.
    expect(() => seatTemplateFromForm(form("finance.everything"))).toThrow(
      /not a role template this platform ships/,
    )
  })

  it("refuses a near-miss of a real key", () => {
    expect(() => seatTemplateFromForm(form("unit.leader"))).toThrow(/not a role template/)
  })

  it("takes the smallest bundle when the field is absent", () => {
    // Absent is different from wrong: an older client or a scripted call said
    // nothing, and the right answer to "nobody said" is the least authority.
    expect(seatTemplateFromForm(form())).toBe("unit.member")
  })

  it("takes the smallest bundle when the field is blank", () => {
    expect(seatTemplateFromForm(form(""))).toBe("unit.member")
    expect(seatTemplateFromForm(form("   "))).toBe("unit.member")
  })

  it("trims what was sent rather than refusing it", () => {
    expect(seatTemplateFromForm(form("  finance.officer  "))).toBe("finance.officer")
  })
})
