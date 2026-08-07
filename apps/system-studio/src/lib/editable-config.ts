import { CONFIG_DOMAINS, domainOf, type ConfigDomain, type OptionPrice } from "@tenure/configuration"
import { PLATFORM_DEFINITIONS } from "@tenure/platform-config"

/**
 * GE-032-001 — what a tenant administrator may edit, derived rather than listed.
 *
 * The item names fourteen editor surfaces. Eleven of their domains are
 * `reserved` in `domains.ts` — there are no keys to edit, because the data does
 * not exist yet. Building empty editors for them would be fourteen forms, three
 * of which work, and no way to tell which from the screen.
 *
 * So the editable set is computed from two facts the engine already holds:
 * whether the domain permits a tenant administrator to write it
 * (`tenantAdminMayWrite`, declared in GE-031-002), and whether any definition
 * actually falls in it. Nothing here decides policy; it reads it.
 *
 * The consequence worth stating: the day `workflows` gains its first key, it
 * appears in this editor with no code change here. That is the point of
 * deriving it — an editor that has to be extended by hand is one that lags the
 * engine, and the lag is invisible.
 */

export interface EditableField {
  key: string
  description: string
  domain: string
  /** The platform default, shown so "unset" and "set to the default" are distinguishable. */
  defaultValue: unknown
  /** `string`, `number`, `boolean` — what the form should render. */
  input: "string" | "number" | "boolean" | "unsupported"
  /**
   * What choosing this option costs — per seat AND for the whole organisation
   * (NEXT-SESSION §7).
   *
   * Carried on the field rather than looked up beside it, so the form cannot
   * render a row without the money for it. The running total on the page is the
   * resolver's, not a sum of these — see `ConfigurationPage` — because a total
   * assembled in the UI is a second answer to the same question.
   */
  price: OptionPrice
}

/** A domain a tenant admin may write, with the fields it currently has. */
export interface EditableDomain {
  domain: ConfigDomain
  fields: readonly EditableField[]
}

/** Which of the fourteen the engine refuses to let a tenant administrator touch. */
export interface WithheldDomain {
  domain: ConfigDomain
  why: string
}

function inputFor(value: unknown): EditableField["input"] {
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  // Arrays and objects — holidays, working days, the flag kill list. A text box
  // for a JSON array is a way to corrupt configuration by typo, so they are
  // shown read-only until there is a real editor for them.
  return "unsupported"
}

/**
 * The domains and definitions are parameters, defaulting to the real ones.
 *
 * Not for mocking — for reaching the authority gate at all. Every domain the
 * engine withholds today (`deployment`, `recovery`, `observability`, `cost`)
 * is also reserved and has no keys, so the empty-domain filter below removes
 * them whether or not `tenantAdminMayWrite` is honoured. A mutation deleting
 * that check passed every test until this signature let one be supplied WITH a
 * key. The gate is not load-bearing today; it becomes load-bearing the day
 * `deployment` gains its first key, and that is precisely when nobody will be
 * looking at it.
 */
export function editableDomains(
  domains: readonly ConfigDomain[] = CONFIG_DOMAINS,
  definitions: readonly {
    key: string
    description: string
    default: unknown
    overridable: boolean
    allowedScopes: readonly string[]
    // Required here too, not optional. A definition without a price cannot
    // reach this function — `validateDefinition` refuses to register it — so
    // making it optional would only let a test build a field the real editor
    // can never receive, and the "no price on the screen" defect would come
    // back through the one door the type system was not watching.
    price: OptionPrice
  }[] = PLATFORM_DEFINITIONS,
): readonly EditableDomain[] {
  return domains
    .filter((d) => d.tenantAdminMayWrite)
    .map((domain) => ({
      domain,
      fields: definitions
        .filter((definition) => (domainOf(definition.key)?.id ?? null) === domain.id)
        .filter((definition) => definition.overridable)
        // A key a tenant cannot set at their own scope is not theirs to edit,
        // whatever the domain permits. Both gates apply.
        .filter((definition) => definition.allowedScopes.includes("tenant"))
        .map((definition) => ({
          key: definition.key,
          description: definition.description,
          domain: domain.id,
          defaultValue: definition.default,
          input: inputFor(definition.default),
          price: definition.price,
        }))
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    }))
    .filter((entry) => entry.fields.length > 0)
}

/**
 * Domains a tenant administrator may NOT write, and why.
 *
 * Shown rather than hidden. An administrator who cannot find where to change
 * their data residency will ask; one who is told it is not theirs to change,
 * and why, has an answer — and GE-032-002 is the item that enforces it.
 */
export function withheldDomains(): readonly WithheldDomain[] {
  return CONFIG_DOMAINS.filter((d) => !d.tenantAdminMayWrite).map((domain) => ({
    domain,
    why: `${domain.governs} Only Tenure operators change this.`,
  }))
}

/** Domains an admin may write that have no keys yet, named with the item that fills them. */
export function reservedDomains(domains: readonly ConfigDomain[] = CONFIG_DOMAINS): readonly ConfigDomain[] {
  const withFields = new Set(editableDomains(domains).map((e) => e.domain.id))
  return domains.filter((d) => d.tenantAdminMayWrite && !withFields.has(d.id))
}

/**
 * Parse one submitted value back to its declared type.
 *
 * Returns `undefined` for "leave this alone", which is different from an empty
 * string: clearing a text field must not silently publish `""` as a tenant's
 * name for a seat.
 */
export function parseField(field: EditableField, raw: string | null): unknown | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined

  switch (field.input) {
    case "number": {
      const value = Number(trimmed)
      return Number.isFinite(value) ? value : undefined
    }
    case "boolean":
      return trimmed === "true"
    case "string":
      return trimmed
    default:
      return undefined
  }
}
