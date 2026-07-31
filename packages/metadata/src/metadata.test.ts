import {
  FieldDefinitionError,
  FormDefinitionError,
  isVisible,
  publishForm,
  validateField,
  validateFieldDefinition,
  validateForm,
  validateFormDefinition,
  type FieldDefinition,
  type FormDefinition,
} from "./index"

const field = (over: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key: "title",
  type: "shortText",
  label: "Title",
  ...over,
})

describe("field definitions are checked when declared", () => {
  it("refuses an enum with no options", () => {
    // Nothing could ever be chosen, and the failure appears as an unsubmittable
    // form rather than as a configuration error.
    expect(() => validateFieldDefinition(field({ type: "enum", options: [] }))).toThrow(
      /declares no options/,
    )
  })

  it("refuses options on a type that will never read them", () => {
    expect(() =>
      validateFieldDefinition(field({ type: "shortText", options: [{ value: "a", label: "A" }] })),
    ).toThrow(/declares options, which nothing will read/)
  })

  it("refuses duplicate option values", () => {
    expect(() =>
      validateFieldDefinition(
        field({ type: "enum", options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }),
      ),
    ).toThrow(/twice/)
  })

  it("refuses inverted bounds", () => {
    expect(() => validateFieldDefinition(field({ type: "integer", min: 10, max: 1 }))).toThrow(FieldDefinitionError)
    expect(() => validateFieldDefinition(field({ minLength: 10, maxLength: 1 }))).toThrow(FieldDefinitionError)
  })

  it("refuses a key that is not lowerCamelCase, or no label", () => {
    expect(() => validateFieldDefinition(field({ key: "Title" }))).toThrow(/lowerCamelCase/)
    expect(() => validateFieldDefinition(field({ label: "" }))).toThrow(/no label/)
  })
})

describe("each field type validates what it claims to", () => {
  const check = (def: Partial<FieldDefinition>, value: unknown) =>
    validateField(field(def), value)?.message ?? null

  it("requires a required field and permits a blank optional one", () => {
    expect(check({ required: true }, "")).toMatch(/required/)
    expect(check({ required: true }, "   ")).toMatch(/required/)
    expect(check({ required: false }, "")).toBeNull()
  })

  it("measures length against the raw value, not the trimmed one", () => {
    // That is what gets stored and what a column limit applies to.
    expect(check({ maxLength: 3 }, "abc ")).toMatch(/under 3/)
    expect(check({ minLength: 3 }, " ab ")).toMatch(/at least 3/)
  })

  it("checks emails, https URLs and app paths distinctly", () => {
    expect(check({ type: "email" }, "not-an-email")).toMatch(/email address/)
    expect(check({ type: "email" }, "a@b.co")).toBeNull()
    expect(check({ type: "url" }, "http://x.test")).toMatch(/https:\/\//)
    expect(check({ type: "url" }, "https://x.test")).toBeNull()
    expect(check({ type: "appPath" }, "resources")).toMatch(/starting with \//)
    expect(check({ type: "appPath" }, "/resources")).toBeNull()
  })

  it("separates whole numbers from decimals", () => {
    expect(check({ type: "integer" }, 1.5)).toMatch(/whole number/)
    expect(check({ type: "decimal" }, 1.5)).toBeNull()
    expect(check({ type: "integer" }, "12")).toBeNull()
    expect(check({ type: "integer" }, "twelve")).toMatch(/must be a number/)
  })

  it("applies numeric bounds", () => {
    expect(check({ type: "integer", min: 1, max: 5 }, 0)).toMatch(/at least 1/)
    expect(check({ type: "integer", min: 1, max: 5 }, 6)).toMatch(/at most 5/)
  })

  it("rejects a non-boolean for a boolean", () => {
    expect(check({ type: "boolean" }, "yes")).toMatch(/yes or no/)
    expect(check({ type: "boolean" }, false)).toBeNull()
  })

  it("rejects an unparseable date", () => {
    expect(check({ type: "date" }, "someday")).toMatch(/must be a date/)
    expect(check({ type: "date" }, "2026-07-31")).toBeNull()
  })

  it("constrains enum and multiEnum to their options", () => {
    const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }]
    expect(check({ type: "enum", options: opts }, "c")).toMatch(/Choose a valid/)
    expect(check({ type: "enum", options: opts }, "a")).toBeNull()
    expect(check({ type: "multiEnum", options: opts }, ["a", "c"])).toMatch(/Choose a valid/)
    expect(check({ type: "multiEnum", options: opts }, ["a", "b"])).toBeNull()
  })

  it("counts multiEnum selections", () => {
    const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }]
    expect(check({ type: "multiEnum", options: opts, required: true }, [])).toMatch(/at least one/)
    expect(check({ type: "multiEnum", options: opts, maxSelected: 1 }, ["a", "b"])).toMatch(/at most 1/)
    expect(check({ type: "multiEnum", options: opts, required: false }, [])).toBeNull()
  })

  it("uses the authored message when there is one", () => {
    // "A title is required." beats "title: expected string, min 1".
    expect(check({ required: true, message: "A title is required." }, "")).toBe("A title is required.")
  })
})

const FORM: FormDefinition = publishForm({
  key: "expense",
  version: "1.0.0",
  label: "Expense",
  fields: [
    { key: "amount", type: "currency", label: "Amount", required: true, min: 1 },
    { key: "needsReceipt", type: "boolean", label: "Has a receipt" },
    { key: "receiptUrl", type: "url", label: "Receipt link", required: true },
    { key: "note", type: "longText", label: "Note", maxLength: 20 },
  ],
  sections: [
    { key: "money", label: "Money", fieldKeys: ["amount", "needsReceipt", "receiptUrl"] },
    { key: "extra", fieldKeys: ["note"] },
  ],
  visibility: { receiptUrl: { whenField: "needsReceipt", isTruthy: true } },
})

describe("form definitions are checked when declared", () => {
  const base = { key: "f", version: "1", label: "F", fields: [field()], sections: [{ key: "s", fieldKeys: ["title"] }] }

  it("refuses a field declared but placed nowhere", () => {
    // Still validated, never shown: the form refuses to submit and nothing on
    // screen explains why.
    expect(() =>
      validateFormDefinition({ ...base, fields: [field(), field({ key: "ghost", label: "Ghost" })] }),
    ).toThrow(/declared but appears in no section/)
  })

  it("refuses a section placing a field that does not exist", () => {
    expect(() =>
      validateFormDefinition({ ...base, sections: [{ key: "s", fieldKeys: ["title", "nope"] }] }),
    ).toThrow(/places unknown field "nope"/)
  })

  it("refuses a field placed in two sections", () => {
    expect(() =>
      validateFormDefinition({
        ...base,
        sections: [{ key: "a", fieldKeys: ["title"] }, { key: "b", fieldKeys: ["title"] }],
      }),
    ).toThrow(/more than one section/)
  })

  it("refuses a visibility rule that is self-referential or points nowhere", () => {
    expect(() =>
      validateFormDefinition({ ...base, visibility: { title: { whenField: "title", isTruthy: true } } }),
    ).toThrow(/its own visibility/)
    expect(() =>
      validateFormDefinition({ ...base, visibility: { title: { whenField: "ghost", isTruthy: true } } }),
    ).toThrow(FormDefinitionError)
  })
})

describe("a hidden field is not validated", () => {
  it("does not demand a receipt link when no receipt is claimed", () => {
    // The most common way a conditional form becomes unusable: an error with
    // nothing on screen to fix.
    const r = validateForm(FORM, { amount: 10, needsReceipt: false })
    expect(r.valid).toBe(true)
  })

  it("demands it once the field is shown", () => {
    const r = validateForm(FORM, { amount: 10, needsReceipt: true })
    expect(r.valid).toBe(false)
    expect(r.errors[0].key).toBe("receiptUrl")
  })

  it("answers visibility directly", () => {
    expect(isVisible(FORM, "receiptUrl", { needsReceipt: true })).toBe(true)
    expect(isVisible(FORM, "receiptUrl", { needsReceipt: false })).toBe(false)
    expect(isVisible(FORM, "amount", {})).toBe(true)
  })
})

describe("errors come back in form order", () => {
  it("reports the first field a person can see, not the first declared", () => {
    // A caller focusing errors[0] must land on the first visible problem.
    const r = validateForm(FORM, { amount: 0, needsReceipt: true, note: "x".repeat(21) })
    expect(r.errors.map((e) => e.key)).toEqual(["amount", "receiptUrl", "note"])
  })

  it("is valid when everything passes", () => {
    expect(
      validateForm(FORM, { amount: 10, needsReceipt: true, receiptUrl: "https://x.test/r", note: "ok" }).valid,
    ).toBe(true)
  })
})
