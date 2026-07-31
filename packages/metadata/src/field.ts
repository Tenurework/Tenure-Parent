/**
 * Typed custom fields, from a controlled list.
 *
 * Deliberately NOT entity-attribute-value. EAV makes every field addable
 * without a migration and every query untypeable, unindexable and unvalidatable
 * — the cost lands entirely on whoever has to read the data back. What is here
 * instead is a closed set of types, each with its own validation, so a field is
 * as configurable as it needs to be and no more.
 *
 * A definition says what a field IS. `form.ts` says where it appears and when.
 * They are separate because the same field belongs on several forms, and
 * because a field's validity does not depend on the form it was typed into.
 */

export const FIELD_TYPES = [
  "shortText",
  "longText",
  "integer",
  "decimal",
  "currency",
  "boolean",
  "date",
  "dateTime",
  "enum",
  "multiEnum",
  "email",
  "url",
  "appPath",
  "userRef",
  "organizationRef",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export interface EnumOption {
  value: string
  label: string
}

export interface FieldDefinition {
  /** Stable key. Renaming one is a migration, not an edit. */
  key: string
  type: FieldType
  label: string
  help?: string
  required?: boolean
  /** shortText / longText / email / url: maximum length. */
  maxLength?: number
  minLength?: number
  /** integer / decimal / currency: inclusive bounds. */
  min?: number
  max?: number
  /** enum / multiEnum: the permitted values. */
  options?: readonly EnumOption[]
  /** multiEnum: how many may be chosen. */
  minSelected?: number
  maxSelected?: number
  /**
   * Message shown when the value is missing or malformed.
   *
   * Authored rather than generated. A generated message says
   * "title: expected string, min 1"; a written one says "A title is required."
   * The second is the one a person can act on, and this engine exists to replace
   * hand-rolled validators that already had good messages.
   */
  message?: string
  sensitivity?: "public" | "internal" | "confidential" | "secret"
}

export class FieldDefinitionError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid field definition:\n  ${problems.join("\n  ")}`)
    this.name = "FieldDefinitionError"
    this.problems = problems
  }
}

const KEY = /^[a-z][a-zA-Z0-9]*$/

export function validateFieldDefinition(def: FieldDefinition): void {
  const problems: string[] = []
  const where = `Field "${def.key}"`

  if (!KEY.test(def.key ?? "")) problems.push(`Field key ${JSON.stringify(def.key)} must be lowerCamelCase.`)
  if (!FIELD_TYPES.includes(def.type)) problems.push(`${where} has unknown type ${JSON.stringify(def.type)}.`)
  if (!def.label) problems.push(`${where} has no label.`)

  const isEnum = def.type === "enum" || def.type === "multiEnum"
  if (isEnum && (!def.options || def.options.length === 0)) {
    problems.push(`${where} is ${def.type} but declares no options, so nothing could ever be chosen.`)
  }
  if (!isEnum && def.options) {
    problems.push(`${where} is ${def.type} but declares options, which nothing will read.`)
  }
  if (def.options) {
    const seen = new Set<string>()
    for (const o of def.options) {
      if (seen.has(o.value)) problems.push(`${where} declares option "${o.value}" twice.`)
      seen.add(o.value)
    }
  }

  if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
    problems.push(`${where} has min above max.`)
  }
  if (def.minLength !== undefined && def.maxLength !== undefined && def.minLength > def.maxLength) {
    problems.push(`${where} has minLength above maxLength.`)
  }

  if (problems.length > 0) throw new FieldDefinitionError(problems)
}

export interface FieldError {
  key: string
  message: string
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")

/**
 * Validate one value against one field.
 *
 * Returns the first problem, not all of them. A field has one input; telling
 * someone their title is both too long and not a URL is noise, and the caller
 * collects one error per field into a form-level list.
 */
export function validateField(def: FieldDefinition, value: unknown): FieldError | null {
  const fail = (fallback: string): FieldError => ({ key: def.key, message: def.message ?? fallback })

  if (isBlank(value)) {
    // An empty multiEnum is an empty array, not a blank — handled below.
    if (def.type !== "multiEnum") {
      return def.required ? fail(`${def.label} is required.`) : null
    }
  }

  switch (def.type) {
    case "shortText":
    case "longText":
    case "email":
    case "url":
    case "appPath": {
      if (typeof value !== "string") return fail(`${def.label} must be text.`)
      const trimmed = value.trim()
      if (def.minLength !== undefined && trimmed.length < def.minLength) {
        return fail(`${def.label} must be at least ${def.minLength} characters.`)
      }
      // Length is checked against the raw value, not the trimmed one, because
      // that is what gets stored and what a column limit applies to.
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return fail(`Keep ${def.label.toLowerCase()} under ${def.maxLength} characters.`)
      }
      if (def.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return fail(`${def.label} must be an email address.`)
      }
      if (def.type === "url" && !/^https:\/\/[^\s]+$/.test(trimmed)) {
        return fail(`${def.label} must be a full https:// link.`)
      }
      if (def.type === "appPath" && !/^\/[^\s]*$/.test(trimmed)) {
        return fail(`${def.label} must be a path starting with /.`)
      }
      return null
    }

    case "integer":
    case "decimal":
    case "currency": {
      const n = typeof value === "number" ? value : Number(value)
      if (!Number.isFinite(n)) return fail(`${def.label} must be a number.`)
      if (def.type === "integer" && !Number.isInteger(n)) {
        return fail(`${def.label} must be a whole number.`)
      }
      if (def.min !== undefined && n < def.min) return fail(`${def.label} must be at least ${def.min}.`)
      if (def.max !== undefined && n > def.max) return fail(`${def.label} must be at most ${def.max}.`)
      return null
    }

    case "boolean":
      return typeof value === "boolean" ? null : fail(`${def.label} must be yes or no.`)

    case "date":
    case "dateTime": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return fail(`${def.label} must be a date.`)
      }
      return null
    }

    case "enum": {
      const allowed = (def.options ?? []).map((o) => o.value)
      return allowed.includes(String(value)) ? null : fail(`Choose a valid ${def.label.toLowerCase()}.`)
    }

    case "multiEnum": {
      if (!Array.isArray(value)) return fail(`${def.label} must be a list.`)
      const allowed = new Set((def.options ?? []).map((o) => o.value))
      for (const v of value) {
        if (!allowed.has(String(v))) return fail(`Choose a valid ${def.label.toLowerCase()}.`)
      }
      const min = def.minSelected ?? (def.required ? 1 : 0)
      if (value.length < min) {
        return fail(
          min === 1
            ? `Choose at least one ${def.label.toLowerCase()}.`
            : `Choose at least ${min} ${def.label.toLowerCase()}.`,
        )
      }
      if (def.maxSelected !== undefined && value.length > def.maxSelected) {
        return fail(`Choose at most ${def.maxSelected} ${def.label.toLowerCase()}.`)
      }
      return null
    }

    case "userRef":
    case "organizationRef": {
      // Referential integrity is the caller's — this package has no database.
      // Shape is all it can honestly check.
      return typeof value === "string" && value.trim() !== ""
        ? null
        : fail(`${def.label} must be selected.`)
    }

    default: {
      const never: never = def.type
      return fail(`Unhandled field type ${String(never)}.`)
    }
  }
}
