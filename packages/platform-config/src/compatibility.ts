/**
 * GE-022-005 — configuration compatibility with the engine running it.
 *
 * The engine ships to cells, and a cell is not upgraded the instant the engine
 * is. So there is a window — sometimes a long one — where a tenant's published
 * configuration names a key that the running build has never heard of, or sets
 * a value whose meaning changed.
 *
 * The two ways to be wrong here are both silent:
 *
 *   * **Ignore the unknown key.** The tenant published a configuration, the
 *     Studio shows it as published, and the cell quietly does something else.
 *     Nobody finds out until someone asks why a setting had no effect.
 *   * **Apply it anyway.** An older build reading `workingDays: [0,1,2,3,4]`
 *     with no concept of a working week does not fail; it computes deadlines on
 *     an assumption the tenant explicitly overrode.
 *
 * So a configuration declares the engine version it needs, and a cell that is
 * older **refuses the release** rather than half-applying it. Refusing is
 * visible; both alternatives are not.
 */

/**
 * `major.minor.patch`, compared numerically, and owned HERE.
 *
 * The extension and package catalogs (GE-030-005) need the same comparison, and
 * two copies of a version comparator is two chances to disagree about whether
 * 1.10.0 is newer than 1.9.0 — the answer differs between a numeric compare and
 * a string one, a bug that would only show on the tenth minor. So there is one
 * copy, and it lives in the package the CELL is allowed to import.
 *
 * It briefly lived in `@tenure/provisioning` instead, and
 * `cell-independence.test.mjs` refused the result: `apps/web/src/lib/ai.ts`
 * reaching into the engine's control plane for a version comparator is the
 * boundary eroding one convenience at a time. `provisioning` depends on this
 * package; never the reverse.
 *
 * Deliberately not semver-with-ranges. A range expression is a small language,
 * and every question asked here is "is this at least that".
 */
export interface EngineVersion {
  major: number
  minor: number
  patch: number
}

export class VersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VersionError"
  }
}

export function parseVersion(input: string): EngineVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(input.trim())
  if (!match) {
    // Throws rather than defaulting to 0.0.0. A version that parses to zero
    // compares as older than everything, so every compatibility check would
    // pass and the guard would be silently inert.
    throw new VersionError(`not a version: ${JSON.stringify(input)} — expected major.minor.patch`)
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Negative when `a` is older, 0 when equal, positive when newer. */
export function compareVersions(a: EngineVersion, b: EngineVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * The same comparison over raw strings, for callers that hold versions as text.
 *
 * Exists so `@tenure/module-runtime` can check a module's declared dependency
 * range without a second comparator. That package cannot import this one —
 * platform-config imports IT (see modules.ts) — so it takes the function as an
 * argument, and this is the adapter every caller passes. Deliberately not a
 * reimplementation: it is `parseVersion` and `compareVersions`, the same two.
 *
 * Throws on an unparseable version, which is what `parseVersion` already does
 * and for the reason stated there: a version that silently became 0.0.0 would
 * compare as older than everything and make every check pass.
 */
export function compareVersionStrings(a: string, b: string): number {
  return compareVersions(parseVersion(a), parseVersion(b))
}

export interface CompatibilityVerdict {
  compatible: boolean
  /** Empty when compatible. One entry per key the running engine cannot honour. */
  problems: readonly {
    key: string
    requires: string
    running: string
    reason: "engine-too-old" | "unknown-key"
  }[]
}

/**
 * Whether a running engine can honour a configuration.
 *
 * `requirements` is the minimum engine version per key, as published with the
 * release. `known` is what the running build actually implements — a key that is
 * not in it is refused even if no minimum was declared, because "the engine has
 * never heard of this" and "this needs a newer engine" are the same outcome for
 * the tenant and only differ in whose mistake it was.
 *
 * Fails closed: an unparseable version is a problem, not a pass.
 */
export function checkCompatibility(
  runningVersion: string,
  requirements: Readonly<Record<string, string>>,
  known: ReadonlySet<string>,
): CompatibilityVerdict {
  const problems: CompatibilityVerdict["problems"] = []
  let running: EngineVersion
  try {
    running = parseVersion(runningVersion)
  } catch {
    // The engine cannot say how old it is, so it cannot claim to be new enough.
    return {
      compatible: false,
      problems: Object.keys(requirements).map((key) => ({
        key,
        requires: requirements[key],
        running: runningVersion,
        reason: "engine-too-old" as const,
      })),
    }
  }

  const mutable = problems as {
    key: string
    requires: string
    running: string
    reason: "engine-too-old" | "unknown-key"
  }[]

  for (const [key, requires] of Object.entries(requirements)) {
    if (!known.has(key)) {
      mutable.push({ key, requires, running: runningVersion, reason: "unknown-key" })
      continue
    }
    let required: EngineVersion
    try {
      required = parseVersion(requires)
    } catch {
      // A requirement nobody can parse cannot be satisfied. Treating it as
      // "no requirement" would let a malformed release through.
      mutable.push({ key, requires, running: runningVersion, reason: "engine-too-old" })
      continue
    }
    if (compareVersions(running, required) < 0) {
      mutable.push({ key, requires, running: runningVersion, reason: "engine-too-old" })
    }
  }

  return { compatible: mutable.length === 0, problems: mutable }
}
