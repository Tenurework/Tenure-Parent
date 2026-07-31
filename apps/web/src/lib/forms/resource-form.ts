import { firstError, publishForm, validateForm, type FormDefinition } from "@tenure/metadata"

import { SEAT_LABELS, isSeatKey, type SeatKey } from "@/lib/resources"

/**
 * The board-resource publish form, as a definition.
 *
 * A transcription of the hand-rolled `validate()` in `resources-data.ts`, not a
 * redesign — same rules, same messages, same order. `resource-form.test.ts`
 * checks it against the original across a generated input space rather than on
 * a few examples, for the same reason the approval workflow did: the risk of
 * moving a rule into data is changing it while claiming to have merely moved it.
 *
 * The messages are carried explicitly rather than generated. A generated message
 * says "title: expected string, min 1"; the authored one says "A title is
 * required." Only one of those is something a person can act on, and the
 * hand-rolled validator already had the good ones.
 */

const SEAT_OPTIONS = (Object.keys(SEAT_LABELS) as SeatKey[])
  .filter(isSeatKey)
  .map((value) => ({ value, label: SEAT_LABELS[value] }))

export const RESOURCE_FORM: FormDefinition = publishForm({
  key: "resource",
  version: "1.0.0",
  label: "Publish a board resource",
  fields: [
    {
      key: "title",
      type: "shortText",
      label: "Title",
      required: true,
      maxLength: 160,
      message: undefined, // two distinct messages; see the overrides below
    },
    {
      key: "description",
      type: "longText",
      label: "Description",
      required: true,
      maxLength: 600,
    },
    {
      key: "href",
      type: "shortText",
      label: "Link",
      required: true,
    },
    {
      key: "seats",
      type: "multiEnum",
      label: "Seats",
      required: true,
      minSelected: 1,
      options: SEAT_OPTIONS,
    },
  ],
  sections: [
    { key: "main", fieldKeys: ["title", "description", "href", "seats"] },
  ],
})

/**
 * The original's messages, keyed by field and by which rule failed.
 *
 * The engine carries one `message` per field, and this form needs two for
 * `title` — one for missing, one for too long. Rather than widen the engine for
 * one form, the caller maps them. If a second form needs the same thing, that is
 * the signal to add per-rule messages to the definition; one is not.
 */
const MESSAGES: Record<string, { missing?: string; tooLong?: string; invalid?: string }> = {
  title: { missing: "A title is required.", tooLong: "Keep the title under 160 characters." },
  description: {
    missing: "A short description is required.",
    tooLong: "Keep the description under 600 characters.",
  },
  href: { missing: "Enter a full https:// link or an internal path starting with /." },
  seats: { missing: "Choose at least one seat to route this to." },
}

export interface ResourceFormInput {
  title: string
  description: string
  href: string
  seats: readonly string[]
}

/**
 * Validate a resource submission, returning the original's message or null.
 *
 * `href` is checked by the caller's `normaliseHref`, which accepts an https URL
 * OR an internal path and also rewrites it. That is a normalising parser rather
 * than a validator, and folding it into a field type would either lose the
 * rewrite or duplicate it — so it stays where it is and is passed in.
 */
export function validateResourceForm(
  input: ResourceFormInput,
  hrefIsValid: (href: string) => boolean,
): string | null {
  const values = {
    title: input.title,
    description: input.description,
    // Substituted so the engine sees a value that reflects the caller's parse:
    // present and acceptable, or blank. The engine's own `required` rule then
    // produces the message.
    href: hrefIsValid(input.href) ? input.href : "",
    seats: [...input.seats],
  }

  const result = validateForm(RESOURCE_FORM, values)
  if (result.valid) return null

  const failure = result.errors[0]
  const messages = MESSAGES[failure.key] ?? {}

  // Distinguish missing from too-long for the two fields that say different
  // things about each.
  const raw = values[failure.key as keyof typeof values]
  const isMissing =
    raw === "" || raw === undefined || (Array.isArray(raw) && raw.length === 0) ||
    (typeof raw === "string" && raw.trim() === "")

  if (isMissing && messages.missing) return messages.missing
  if (!isMissing && messages.tooLong) return messages.tooLong
  return messages.missing ?? messages.invalid ?? firstError(result)
}
