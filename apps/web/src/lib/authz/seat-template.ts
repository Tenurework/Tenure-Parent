import { lookupRoleTemplate } from "@tenure/authorization"

/**
 * GE-051-005 — which authority bundle a new seat carries.
 *
 * Its own function rather than four lines inside a server action, because the
 * decision it makes is the one worth testing: an unrecognised key is **refused**
 * rather than quietly replaced with the smallest bundle.
 *
 * A silent fall-back would look like a working form. The seat would be created,
 * the page would refresh, and the club's new finance officer would find they
 * cannot touch a budget — with nothing anywhere saying why, because nothing went
 * wrong. Refusing puts the failure in front of the person who can fix it, while
 * they are still looking at the form.
 *
 * Absent is different from wrong. A form that does not send the field at all is
 * an older client or a scripted call, and the smallest bundle is the right
 * answer to "nobody said": it confers the least, not the most.
 */
export function seatTemplateFromForm(formData: {
  get(name: string): FormDataEntryValue | null
}): string {
  const raw = formData.get("templateKey")
  if (raw == null || String(raw).trim() === "") return "unit.member"

  const templateKey = String(raw).trim()
  if (!lookupRoleTemplate(templateKey)) {
    throw new Error(
      `"${templateKey}" is not a role template this platform ships. A seat carries one of the ` +
        `declared bundles, never a name somebody typed.`,
    )
  }
  return templateKey
}
