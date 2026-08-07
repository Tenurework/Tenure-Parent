import type {
  ObjectAuthority,
  SyncDirection,
  SystemOfRecordAuthority,
} from "@tenure/provisioning"

/**
 * WRK-020-004 — reading object- and field-level authority off the compose form.
 *
 * The domain grain is a checkbox group, because the domain vocabulary is closed
 * and short. The object grain is not: an object is a canonical record name and
 * a field is one of its columns, so neither can be a list the console holds.
 * This is the line grammar the form documents, in one place, parsed on the
 * server — the browser is not where trust lives, and the same text an operator
 * typed is what ends up on the manifest an approver diffs.
 *
 *   finance.Invoice external INBOUND
 *   finance.Invoice.internalNote tenure
 *
 * A two-part path is an object: `<domain>.<Object> <authority> <DIRECTION>`.
 * A three-part path is a field of the object above it:
 * `<domain>.<Object>.<field> <authority>`. Blank lines and `#` comments are
 * ignored.
 *
 * ## Why this checks shape and not vocabulary
 *
 * It does NOT check that `external` is an authority or that `INBOUND` is a
 * direction, deliberately. `coexistenceProblems` in `@tenure/module-runtime` is
 * the one place that decides what those words may be, and a second copy here
 * would be a second answer — the failure mode the manifest validator's own
 * comment names ("a manifest cannot be accepted under looser rules than
 * `resolveModules` applies"). What this owns is the part that has no other
 * owner: whether the text is a declaration at all.
 */

export interface ObjectAuthorityParse {
  entries: ObjectAuthority[]
  problems: Array<{ field: string; reason: string; detail: string }>
}

const FIELD = "objectAuthority"

export function parseObjectAuthority(text: string): ObjectAuthorityParse {
  const entries: ObjectAuthority[] = []
  const problems: ObjectAuthorityParse["problems"] = []
  const byKey = new Map<string, ObjectAuthority>()

  const lines = (text ?? "").split(/\r?\n/)

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue

    const at = `line ${index + 1} ("${line}")`
    const tokens = line.split(/\s+/)
    const path = tokens[0].split(".")

    if (path.length === 2) {
      if (tokens.length !== 3) {
        problems.push({
          field: FIELD,
          reason: "malformed-object-line",
          detail:
            `${at} names an object, so it needs an authority and a sync direction: ` +
            `"<domain>.<Object> <tenure|external> <INBOUND|OUTBOUND|BIDIRECTIONAL|NONE>". ` +
            `An object with no stated direction is a copy nobody can say is allowed.`,
        })
        continue
      }
      const [domain, object] = path
      if (!domain || !object) {
        problems.push({
          field: FIELD,
          reason: "malformed-object-line",
          detail: `${at} has an empty domain or object name.`,
        })
        continue
      }
      const key = `${domain}.${object}`
      const entry: ObjectAuthority = {
        domain,
        object,
        // Cast, not checked. See the header: the vocabulary has exactly one
        // owner and it is not this file.
        authority: tokens[1] as SystemOfRecordAuthority,
        direction: tokens[2] as SyncDirection,
      }
      entries.push(entry)
      // A duplicate is NOT collapsed here. `coexistenceProblems` refuses it by
      // name, and silently keeping the last one would be this file deciding
      // which of two contradictory declarations the operator meant.
      if (!byKey.has(key)) byKey.set(key, entry)
      continue
    }

    if (path.length === 3) {
      if (tokens.length !== 2) {
        problems.push({
          field: FIELD,
          reason: "malformed-field-line",
          detail:
            `${at} names a field, so it needs exactly one authority: ` +
            `"<domain>.<Object>.<field> <tenure|external>". A field carries no direction of its ` +
            `own — the channel belongs to the object it travels in.`,
        })
        continue
      }
      const [domain, object, field] = path
      const key = `${domain}.${object}`
      const owner = byKey.get(key)
      if (!owner) {
        problems.push({
          field: FIELD,
          reason: "field-without-object",
          detail:
            `${at} refines "${key}", which no line above declares. A field owner is only ` +
            `meaningful against the object's own owner, so the object has to be declared first.`,
        })
        continue
      }
      if (!field) {
        problems.push({
          field: FIELD,
          reason: "malformed-field-line",
          detail: `${at} has an empty field name.`,
        })
        continue
      }
      owner.fields = [
        ...(owner.fields ?? []),
        { field, authority: tokens[1] as SystemOfRecordAuthority },
      ]
      continue
    }

    problems.push({
      field: FIELD,
      reason: "malformed-line",
      detail:
        `${at} is neither "<domain>.<Object> <authority> <DIRECTION>" nor ` +
        `"<domain>.<Object>.<field> <authority>". Leave the box empty to declare authority at ` +
        `the domain grain only, which is what every tenant here does today.`,
    })
  }

  return { entries, problems }
}
