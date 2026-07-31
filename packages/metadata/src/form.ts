import {
  validateField,
  validateFieldDefinition,
  type FieldDefinition,
  type FieldError,
} from "./field"

/**
 * Where fields appear, in what order, and when.
 *
 * Separate from the field definitions because the same field belongs on several
 * forms, and because a field's validity does not depend on which form it was
 * typed into.
 */

export interface FormSection {
  key: string
  label?: string
  fieldKeys: readonly string[]
}

/** Show this field only when another field has one of these values. */
export interface VisibilityRule {
  whenField: string
  equals?: readonly unknown[]
  isTruthy?: boolean
}

export interface FormDefinition {
  key: string
  version: string
  label: string
  fields: readonly FieldDefinition[]
  sections: readonly FormSection[]
  /** fieldKey → rule. A field with no rule is always visible. */
  visibility?: Readonly<Record<string, VisibilityRule>>
}

export class FormDefinitionError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid form definition:\n  ${problems.join("\n  ")}`)
    this.name = "FormDefinitionError"
    this.problems = problems
  }
}

export function validateFormDefinition(def: FormDefinition): void {
  const problems: string[] = []
  const byKey = new Map<string, FieldDefinition>()

  for (const f of def.fields) {
    try {
      validateFieldDefinition(f)
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err))
      continue
    }
    if (byKey.has(f.key)) problems.push(`Form "${def.key}" declares field "${f.key}" twice.`)
    byKey.set(f.key, f)
  }

  const placed = new Set<string>()
  for (const s of def.sections) {
    for (const key of s.fieldKeys) {
      if (!byKey.has(key)) {
        problems.push(`Section "${s.key}" places unknown field "${key}".`)
      }
      if (placed.has(key)) {
        problems.push(`Field "${key}" appears in more than one section.`)
      }
      placed.add(key)
    }
  }

  // A declared field nobody placed will never be shown, and — because it is
  // still validated — can make a form unsubmittable for a reason invisible on
  // screen. That is among the worst failures a form can have.
  for (const key of byKey.keys()) {
    if (!placed.has(key)) problems.push(`Field "${key}" is declared but appears in no section.`)
  }

  for (const [key, rule] of Object.entries(def.visibility ?? {})) {
    if (!byKey.has(key)) problems.push(`Visibility rule names unknown field "${key}".`)
    if (!byKey.has(rule.whenField)) {
      problems.push(`Visibility rule for "${key}" depends on unknown field "${rule.whenField}".`)
    }
    if (rule.whenField === key) problems.push(`Field "${key}" depends on its own visibility.`)
    if (rule.equals === undefined && rule.isTruthy === undefined) {
      problems.push(`Visibility rule for "${key}" states no condition.`)
    }
  }

  if (problems.length > 0) throw new FormDefinitionError(problems)
}

export function publishForm(def: FormDefinition): FormDefinition {
  validateFormDefinition(def)
  return Object.freeze({
    ...def,
    fields: Object.freeze(def.fields.map((f) => Object.freeze({ ...f }))),
    sections: Object.freeze(def.sections.map((s) => Object.freeze({ ...s }))),
  })
}

export type FormValues = Readonly<Record<string, unknown>>

/** Is this field currently shown, given what has been entered so far? */
export function isVisible(def: FormDefinition, fieldKey: string, values: FormValues): boolean {
  const rule = def.visibility?.[fieldKey]
  if (!rule) return true

  const other = values[rule.whenField]
  if (rule.isTruthy !== undefined) return Boolean(other) === rule.isTruthy
  return (rule.equals ?? []).some((v) => v === other)
}

export interface FormValidationResult {
  valid: boolean
  /** In the order the fields appear on the form, so focus lands on the first. */
  errors: readonly FieldError[]
}

/**
 * Validate a submission.
 *
 * **Hidden fields are not validated.** A field the person cannot see cannot be
 * filled in, so validating it produces an error with nothing on screen to fix —
 * a form that refuses to submit and will not say why. This is the single most
 * common way a conditional form becomes unusable.
 *
 * Errors come back in form order rather than declaration order, so a caller
 * focusing `errors[0]` lands on the first problem the person can actually see.
 */
export function validateForm(def: FormDefinition, values: FormValues): FormValidationResult {
  const byKey = new Map(def.fields.map((f) => [f.key, f]))
  const errors: FieldError[] = []

  for (const section of def.sections) {
    for (const key of section.fieldKeys) {
      const field = byKey.get(key)
      if (!field) continue
      if (!isVisible(def, key, values)) continue

      const error = validateField(field, values[key])
      if (error) errors.push(error)
    }
  }

  return { valid: errors.length === 0, errors }
}

/** The first error, or null — the shape a caller returning one message wants. */
export function firstError(result: FormValidationResult): string | null {
  return result.errors[0]?.message ?? null
}
