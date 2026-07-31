/**
 * How a higher-precedence layer combines with a lower one.
 *
 * The strategy is declared on each definition. It is deliberately NOT derived
 * from the value's shape.
 *
 * That matters because the obvious alternative — "restrictively meet the two
 * values", deciding between AND, min and intersect by looking at the schema —
 * cannot be read by the person setting the value. Two booleans have no inherent
 * answer: `notifications.enabled` should be ANDed, so a tenant switching it off
 * cannot be re-enabled beneath them, while `features.betaOptIn` should be
 * replaced, so a user can turn it on for themselves. The schema is identical.
 * Only the intent differs, so the intent is what gets written down.
 *
 * Strategies split into two families, and the distinction is a security one:
 *
 *   Permissive  replace, deepMerge, unionSet, max, or
 *               a higher layer can widen what a lower layer allowed.
 *
 *   Restrictive and, min, intersectSet
 *               a higher layer can only narrow. Whatever the platform, a
 *               blueprint or a tenant forbade stays forbidden all the way down.
 *
 * Anything that bounds authority — retention ceilings, spend limits, whether a
 * feature may be used at all — takes a restrictive strategy, so that delegating
 * configuration downward cannot delegate more authority than the delegator had.
 */
export const MERGE_STRATEGIES = [
  "replace",
  "deepMerge",
  "unionSet",
  "intersectSet",
  "min",
  "max",
  "and",
  "or",
] as const

export type MergeStrategy = (typeof MERGE_STRATEGIES)[number]

/** Strategies under which a higher layer can only narrow, never widen. */
export const RESTRICTIVE_STRATEGIES: ReadonlySet<MergeStrategy> = new Set([
  "and",
  "min",
  "intersectSet",
] as const)

export function isRestrictive(strategy: MergeStrategy): boolean {
  return RESTRICTIVE_STRATEGIES.has(strategy)
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MergeError"
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function requireNumbers(strategy: MergeStrategy, lower: unknown, higher: unknown) {
  if (typeof lower !== "number" || typeof higher !== "number") {
    throw new MergeError(
      `Merge strategy "${strategy}" needs two numbers, got ${typeof lower} and ${typeof higher}.`,
    )
  }
}

function requireBooleans(strategy: MergeStrategy, lower: unknown, higher: unknown) {
  if (typeof lower !== "boolean" || typeof higher !== "boolean") {
    throw new MergeError(
      `Merge strategy "${strategy}" needs two booleans, got ${typeof lower} and ${typeof higher}.`,
    )
  }
}

function requireArrays(strategy: MergeStrategy, lower: unknown, higher: unknown) {
  if (!Array.isArray(lower) || !Array.isArray(higher)) {
    throw new MergeError(
      `Merge strategy "${strategy}" needs two arrays, got ${
        Array.isArray(lower) ? "array" : typeof lower
      } and ${Array.isArray(higher) ? "array" : typeof higher}.`,
    )
  }
}

/**
 * Deep merge, with arrays replaced rather than concatenated.
 *
 * Concatenating is the tempting default and it is wrong here: a tenant that sets
 * `nav.items` to three entries means three, not "the platform's five plus three".
 * A definition that does want accumulation says so with `unionSet`.
 */
function deepMerge(lower: unknown, higher: unknown): unknown {
  if (!isPlainObject(lower) || !isPlainObject(higher)) return higher

  const out: Record<string, unknown> = { ...lower }
  for (const [k, v] of Object.entries(higher)) {
    // `undefined` is not an instruction to unset. Deleting a key would make the
    // resolved shape depend on whether a caller spread an object with holes in it.
    if (v === undefined) continue
    out[k] = k in lower ? deepMerge(lower[k], v) : v
  }
  return out
}

/** Stable union: lower's order first, then higher's additions, duplicates dropped. */
function unionSet(lower: unknown[], higher: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const item of [...lower, ...higher]) {
    const k = stableKey(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/** Intersection, preserving lower's order — the narrowing direction. */
function intersectSet(lower: unknown[], higher: unknown[]): unknown[] {
  const inHigher = new Set(higher.map(stableKey))
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const item of lower) {
    const k = stableKey(item)
    if (!inHigher.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/** Identity for set operations. Objects compare by content, not reference. */
function stableKey(value: unknown): string {
  return typeof value === "string" ? `s:${value}` : `j:${stableStringify(value)}`
}

/**
 * JSON with object keys sorted, so two equal values always produce equal text.
 *
 * Used for set identity and for the resolution checksum. `JSON.stringify` alone
 * is insertion-ordered, which would make the checksum depend on the order rows
 * came back from the database.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
}

/**
 * Combine one lower-precedence value with one higher-precedence value.
 *
 * Order is fixed: `lower` was established first. Every strategy is associative
 * in the direction it is folded, so resolution can apply layers one at a time.
 */
export function mergeValues(strategy: MergeStrategy, lower: unknown, higher: unknown): unknown {
  switch (strategy) {
    case "replace":
      return higher
    case "deepMerge":
      return deepMerge(lower, higher)
    case "unionSet":
      requireArrays(strategy, lower, higher)
      return unionSet(lower as unknown[], higher as unknown[])
    case "intersectSet":
      requireArrays(strategy, lower, higher)
      return intersectSet(lower as unknown[], higher as unknown[])
    case "min":
      requireNumbers(strategy, lower, higher)
      return Math.min(lower as number, higher as number)
    case "max":
      requireNumbers(strategy, lower, higher)
      return Math.max(lower as number, higher as number)
    case "and":
      requireBooleans(strategy, lower, higher)
      return (lower as boolean) && (higher as boolean)
    case "or":
      requireBooleans(strategy, lower, higher)
      return (lower as boolean) || (higher as boolean)
    default: {
      // Exhaustiveness: adding a strategy without handling it fails to compile.
      const never: never = strategy
      throw new MergeError(`Unhandled merge strategy: ${String(never)}`)
    }
  }
}
