/**
 * @tenure/metadata — configurable fields and forms, without EAV.
 *
 * A closed set of field types, each with its own validation, so a field is as
 * configurable as it needs to be and no more. Entity-attribute-value would make
 * every field addable without a migration and every query untypeable,
 * unindexable and unvalidatable — the cost landing entirely on whoever reads the
 * data back.
 *
 *   const form = publishForm({ key: "resource", version: "1.0.0", fields, sections })
 *   const { valid, errors } = validateForm(form, values)
 *   firstError(...)   // the shape a caller returning one message wants
 *
 * Hidden fields are not validated: a field nobody can see cannot be filled in,
 * and validating it produces a form that refuses to submit and will not say why.
 */

export { FIELD_TYPES, FieldDefinitionError, validateField, validateFieldDefinition } from "./field"
export type { EnumOption, FieldDefinition, FieldError, FieldType } from "./field"

export {
  FormDefinitionError,
  firstError,
  isVisible,
  publishForm,
  validateForm,
  validateFormDefinition,
} from "./form"
export type {
  FormDefinition,
  FormSection,
  FormValidationResult,
  FormValues,
  VisibilityRule,
} from "./form"
