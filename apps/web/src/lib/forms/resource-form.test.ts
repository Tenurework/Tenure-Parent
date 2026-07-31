import { validateFormDefinition } from "@tenure/metadata"

import { RESOURCE_FORM, validateResourceForm, type ResourceFormInput } from "./resource-form"

/**
 * The definition must produce the same message as the hand-rolled validator, on
 * every input that distinguishes them.
 *
 * The oracle below is the original from `resources-data.ts`, copied verbatim.
 * Moving a rule into data is only safe if the rule did not change while someone
 * claimed to have merely moved it, and the messages are the part users see —
 * so the comparison is on the exact string, not on valid/invalid.
 */

/** ORACLE — the implementation in resources-data.ts. Do not "simplify" this. */
function referenceValidate(
  input: ResourceFormInput,
  normaliseHref: (h: string) => string | null,
): string | null {
  if (!input.title.trim()) return "A title is required."
  if (input.title.length > 160) return "Keep the title under 160 characters."
  if (!input.description.trim()) return "A short description is required."
  if (input.description.length > 600) return "Keep the description under 600 characters."
  if (!normaliseHref(input.href)) {
    return "Enter a full https:// link or an internal path starting with /."
  }
  if (input.seats.length === 0) return "Choose at least one seat to route this to."
  return null
}

/** Stand-in for the real normaliser: https URL or internal path. */
const normalise = (h: string): string | null => {
  const t = h.trim()
  if (/^https:\/\/[^\s]+$/.test(t)) return t
  if (/^\/[^\s]*$/.test(t)) return t
  return null
}
const hrefIsValid = (h: string) => normalise(h) !== null

const ok: ResourceFormInput = {
  title: "Room Booking",
  description: "How to book a room.",
  href: "https://rochester.edu/rooms",
  seats: ["ALL"],
}

/**
 * Inputs chosen to sit on each rule's boundary and just past it, plus the
 * combinations where two rules could fire and the ORDER decides the message.
 */
const CASES: ResourceFormInput[] = [
  ok,
  { ...ok, title: "" },
  { ...ok, title: "   " },
  { ...ok, title: "x".repeat(160) },
  { ...ok, title: "x".repeat(161) },
  { ...ok, description: "" },
  { ...ok, description: "  " },
  { ...ok, description: "y".repeat(600) },
  { ...ok, description: "y".repeat(601) },
  { ...ok, href: "" },
  { ...ok, href: "rochester.edu" },
  { ...ok, href: "http://rochester.edu" },
  { ...ok, href: "javascript:alert(1)" },
  { ...ok, href: "/resources/internal" },
  { ...ok, seats: [] },
  { ...ok, seats: ["ALL", "PRESIDENT"] },
  // Several problems at once: the reported one must be the FIRST by form order,
  // which is what decides which field the UI focuses.
  { title: "", description: "", href: "", seats: [] },
  { ...ok, title: "x".repeat(161), description: "y".repeat(601) },
  { ...ok, title: "", seats: [] },
  { ...ok, description: "", href: "nope" },
]

describe("the definition reproduces the hand-rolled validator", () => {
  for (const [i, input] of CASES.entries()) {
    it(`case ${i}: ${JSON.stringify({ ...input, title: input.title.slice(0, 12), description: input.description.slice(0, 12) })}`, () => {
      expect(validateResourceForm(input, hrefIsValid)).toBe(referenceValidate(input, normalise))
    })
  }
})

describe("the form definition itself holds together", () => {
  it("validates", () => {
    expect(() => validateFormDefinition(RESOURCE_FORM)).not.toThrow()
  })

  it("places every field it declares", () => {
    // A declared-but-unplaced field is still validated and never shown, which
    // makes a form unsubmittable for a reason invisible on screen.
    const placed = RESOURCE_FORM.sections.flatMap((s) => s.fieldKeys)
    expect([...placed].sort()).toEqual(RESOURCE_FORM.fields.map((f) => f.key).sort())
  })

  it("offers every seat the product has", () => {
    const seats = RESOURCE_FORM.fields.find((f) => f.key === "seats")!
    expect(seats.options!.length).toBeGreaterThan(1)
    expect(seats.options!.map((o) => o.value)).toContain("ALL")
  })

  it("is frozen once published", () => {
    expect(Object.isFrozen(RESOURCE_FORM)).toBe(true)
    expect(Object.isFrozen(RESOURCE_FORM.fields)).toBe(true)
  })
})
