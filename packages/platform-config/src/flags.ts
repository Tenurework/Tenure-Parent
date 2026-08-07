import { z } from "zod"
import {
  defineConfig,
  includedInPlan,
  type ConfigDefinition,
  type ConfigScope,
  type MergeStrategy,
  type OptionPrice,
  type ResolvedConfig,
} from "@tenure/configuration"

/**
 * Feature flags, cohort rollout and emergency kill switches — as configuration,
 * under one law.
 *
 * ## The law: a flag may only restrict, never grant
 *
 * This is the whole design and everything else follows from it. A flag that can
 * turn a feature *on* is a second authorization system: it decides who may do
 * what, it is written by whoever can edit a tenant overlay, and it is not the
 * one that `@tenure/authorization` and the route's own `auth()` check answer to.
 * Two systems that both decide access is one system nobody can audit.
 *
 * So the platform default is the ceiling. A blueprint, a tenant, an org unit —
 * anyone below the platform — can only lower it:
 *
 *   platform.flags.<name>.enabled          `and`        false is permanent downward
 *   platform.flags.<name>.rolloutPercent   `min`        a layer can only shrink the cohort
 *   platform.flags.killed                  `unionSet`   a deny list only ever grows
 *
 * The first two are in `RESTRICTIVE_STRATEGIES` in the engine. The third is not,
 * and that is not an exception being smuggled in: `unionSet` is permissive about
 * the *value* and the value here is a deny list, so growing it narrows what runs.
 * Union is the only strategy that makes a kill un-revokable by a lower-privileged
 * layer, which is exactly the property an emergency switch needs.
 *
 * `assertRestrictOnly` runs at module load, so a flag declared with `or`, `max`
 * or `replace` is a startup failure rather than a silent privilege escalation.
 * `flags.test.ts` proves the property end-to-end by trying to grant from every
 * layer and failing.
 *
 * ## Why this is safe next to `resolveSystemConfig`'s default-fallback
 *
 * `resolve.ts` deliberately resolves an institution with no binding to platform
 * defaults instead of throwing, on the grounds that every key in this registry
 * is a word on a screen. A flag is not a word on a screen — so the reason it is
 * still safe has to be stated rather than inherited. It is safe because of the
 * law: an unbound tenant resolving to defaults can obtain exactly what the
 * platform ships and never more, and what the platform ships is what every
 * tenant already had before this file existed. The flag subtracts; the absence
 * of a subtraction is the status quo, not an escalation. Authorization is
 * untouched — the consuming route still runs `auth()` and its own checks, and
 * the flag runs after them.
 *
 * ## Cohort rollout
 *
 * `rolloutPercent` admits a deterministic slice of subjects: bucket = a stable
 * hash of (flag, subject) into 0–99, admitted while bucket < percent. No
 * randomness, no stored assignment, no coordination — the same user gets the
 * same answer on every request and in every process, and two flags roll out to
 * different slices because the flag name is in the hash. `min` merging means a
 * tenant can dial the platform's 100% down to 10%, and cannot dial 10% up.
 */

/**
 * Every flag the platform ships.
 *
 * Exactly one, on purpose. A flag with no consumer is a declaration pretending
 * to be a control, and the registry is not a place to park intentions — adding
 * a second is a one-line `defineFlag` call plus the route that reads it.
 */
export const FLAG_NAMES = ["aiAssistant"] as const
export type FlagName = (typeof FLAG_NAMES)[number]

export const FLAG_KILL_LIST_KEY = "platform.flags.killed"

export function flagEnabledKey(flag: FlagName): string {
  return `platform.flags.${flag}.enabled`
}

export function flagRolloutKey(flag: FlagName): string {
  return `platform.flags.${flag}.rolloutPercent`
}

/**
 * The strategy each kind of flag key must carry, keyed by its last key segment.
 *
 * A table rather than a rule so the reasoning is legible at the point of the
 * check: these three are the only shapes a flag takes, and each has exactly one
 * strategy under which a lower-privileged layer cannot widen.
 */
const REQUIRED_STRATEGY: Readonly<Record<string, MergeStrategy>> = {
  enabled: "and",
  rolloutPercent: "min",
  killed: "unionSet",
}

export class FlagDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FlagDefinitionError"
  }
}

/**
 * Refuse a flag that could grant.
 *
 * Called at module load over the shipped definitions, and exported so a module
 * that contributes its own flags can be held to the same law before its
 * definitions reach a registry.
 */
export function assertRestrictOnly(definitions: readonly ConfigDefinition[]): void {
  for (const def of definitions) {
    const segment = def.key.split(".").pop()!
    const required = REQUIRED_STRATEGY[segment]

    if (!required) {
      throw new FlagDefinitionError(
        `Flag definition "${def.key}" ends in "${segment}", which is not one of the flag ` +
          `shapes (${Object.keys(REQUIRED_STRATEGY).join(", ")}). A flag key whose shape is ` +
          `unknown has no proven merge direction, so it cannot be shown to only restrict.`,
      )
    }

    if (def.mergeStrategy !== required) {
      throw new FlagDefinitionError(
        `Flag definition "${def.key}" merges with "${def.mergeStrategy}", which lets a lower ` +
          `layer widen what a higher one allowed. A "${segment}" key must merge with ` +
          `"${required}". A flag that can turn a feature on is a second authorization system.`,
      )
    }

    if (def.requiresCapability !== undefined) {
      throw new FlagDefinitionError(
        `Flag definition "${def.key}" declares requiresCapability ` +
          `"${def.requiresCapability}". Flags and capabilities are separate systems on ` +
          `purpose; tying one to the other makes a configuration edit an authorization edit.`,
      )
    }

    if (!def.overridable) {
      throw new FlagDefinitionError(
        `Flag definition "${def.key}" is not overridable, so nothing could ever turn it off. ` +
          `A flag nobody can restrict is a constant with extra steps.`,
      )
    }
  }
}

interface FlagSpec {
  name: FlagName
  /** Whether the platform ships the feature switched on. The ceiling, per the law. */
  shipsOn: boolean
  /**
   * Scopes an override may be written at.
   *
   * Kept to the layers `resolve.ts` actually supplies. Listing `user` or
   * `orgUnit` would be safe under the law and dishonest under it — nothing
   * writes those layers yet, and a scope that no writer can reach is a promise,
   * not a control.
   */
  scopes: readonly ConfigScope[]
  /**
   * What the feature costs while it is switched on (NEXT-SESSION §7).
   *
   * On the spec rather than defaulted inside `defineFlag`, so adding a flag is
   * a decision about what it costs as well as what it does. A default here
   * would make every future flag free by omission, which is the exact shape §7
   * calls incomplete — and it would be free in the direction that loses money
   * rather than the one anybody notices.
   */
  price: OptionPrice
  description: string
}

function defineFlag(spec: FlagSpec): readonly ConfigDefinition[] {
  const enabled = defineConfig({
    key: flagEnabledKey(spec.name),
    owner: "platform",
    type: z.boolean(),
    default: spec.shipsOn,
    allowedScopes: spec.scopes,
    mergeStrategy: "and",
    // Internal, not confidential: knowing a feature is off discloses an
    // operational fact, not a secret, and `redact` is about disclosure while
    // `allowedScopes` is about authority. See resolve.test.ts, which fails if a
    // key in this registry ever becomes confidential or capability-gated.
    sensitivity: "internal",
    overridable: true,
    // The switch carries the charge, because the switch is what is on. A boolean
    // option is charged by `isChargeable` while its effective value is `true`,
    // so turning the flag off removes the charge — which is the only direction
    // that makes sense for a restrict-only flag.
    price: spec.price,
    description: spec.description,
  })

  const rolloutPercent = defineConfig({
    key: flagRolloutKey(spec.name),
    owner: "platform",
    type: z.number().int().min(0).max(100),
    // 100 means "everyone the enabled flag already admits". The rollout dial is
    // a way to expose *less* than the flag allows, never more, so its default
    // has to be the top of the range — a default below 100 would make the dial
    // a second switch that a tenant could not open.
    default: 100,
    allowedScopes: spec.scopes,
    mergeStrategy: "min",
    sensitivity: "internal",
    overridable: true,
    // Always included, for every flag, and not a `FlagSpec` field: the dial can
    // only narrow who the `enabled` key already admits, so it cannot add a seat
    // and there is nothing for it to charge for. Pricing it would bill twice for
    // one feature.
    price: includedInPlan(
      "The rollout dial only narrows who the flag already admits — it cannot add a subject, so " +
        "there is nothing here to charge for. The feature itself is priced on its enabled key.",
    ),
    description: `Percentage of subjects admitted to "${spec.name}", 0–100. Deterministic per subject.`,
  })

  return [enabled, rolloutPercent]
}

const aiAssistant = defineFlag({
  name: "aiAssistant",
  shipsOn: true,
  scopes: ["blueprint", "tenant"],
  // Per seat, because the cost driver is per seat: every question is a paid call
  // to the model vendor, and a faculty of two hundred asks two hundred people's
  // worth of them. Nothing for the organisation — there is no fixed cost to
  // having the feature available, only to people using it.
  //
  // The flag ships on, so this is what an unmodified tenant sees on their
  // running total. Turning it off removes the line, which is the whole reason
  // the price sits on the switch.
  price: { perSeatMinor: 400, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
  description:
    "Tenure AI: the retrieval assistant behind /api/ai/chat and the drafting helper behind " +
    "/api/ai/draft. Off means this tenant's content is not sent to the model vendor — chat " +
    "degrades to ranked sources from the user's own workspace, drafting refuses.",
})

/**
 * The emergency switch. Naming a flag here stops it, everywhere below the layer
 * that named it.
 *
 * Deliberately a list of free strings rather than `z.enum(FLAG_NAMES)`. Strict
 * validation here would be fail-closed in the wrong direction: an entry naming a
 * flag that has since been deleted would fail resolution for that whole tenant,
 * turning a stale kill entry into a 500 on every page. Killing a flag that does
 * not exist is harmless; taking a tenant down because of a typo is not.
 * `flags.test.ts` asserts every entry in every shipped binding names a real
 * flag, so the typo is caught in CI rather than by an outage.
 */
const killed = defineConfig({
  key: FLAG_KILL_LIST_KEY,
  owner: "platform",
  type: z.array(z.string().min(1).max(64)),
  default: [],
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "unionSet",
  sensitivity: "internal",
  overridable: true,
  price: includedInPlan(
    "An emergency stop is never billable. A tenant that hesitates over the cost of killing a " +
      "misbehaving feature is a tenant this platform has priced into an outage.",
  ),
  description:
    "Flags stopped in an emergency. A deny list, merged by union, so a layer can add a kill " +
    "and no layer below it can remove one.",
})

export const FLAG_DEFINITIONS: readonly ConfigDefinition[] = [
  ...aiAssistant,
  killed,
] as ConfigDefinition[]

// The law, enforced at load rather than asserted in prose.
assertRestrictOnly(FLAG_DEFINITIONS)

/** Why a flag resolved the way it did. The answer to "why is this off for me?". */
export type FlagReason =
  /** Every check passed. */
  | "enabled"
  /** Named on `platform.flags.killed` by some layer. */
  | "killed"
  /** A layer set `enabled` to false. */
  | "turnedOff"
  /** On, but this subject's bucket is outside the rollout percentage. */
  | "outsideCohort"
  /** No stable subject id, so no honest cohort assignment. Fails closed. */
  | "unidentifiedSubject"

export interface FlagDecision {
  flag: FlagName
  enabled: boolean
  reason: FlagReason
  /** 0–99. Stable for a (flag, subject) pair, in every process, forever. */
  bucket: number
  /** The effective rollout ceiling after merging. */
  rolloutPercent: number
}

/**
 * Which rollout bucket a subject falls in for a flag.
 *
 * FNV-1a over `flag:subject`, mod 100. Chosen because it is deterministic,
 * dependency-free, and computable in a client bundle if a surface ever needs to
 * agree with the server — `node:crypto` would satisfy the first two and fail the
 * third, and this is not a security decision, so a cryptographic digest would
 * buy nothing. The flag name is in the input so two flags at 10% do not roll out
 * to the same 10% of people.
 */
export function cohortBucket(flag: string, subjectId: string): number {
  const input = `${flag}:${subjectId}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // Math.imul keeps the multiply in 32 bits; `*` would lose the low bits to
    // float rounding and collapse the distribution.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100
}

/**
 * Decide a flag for one subject, against an already-resolved configuration.
 *
 * Takes a `ResolvedConfig` rather than an institution slug so this file stays
 * free of the registry — `resolve.ts` builds the registry from `definitions.ts`,
 * which imports this module, and a resolver here would close that cycle. The
 * same reason `localizationFor` is not in `localization.ts`.
 *
 * Order of checks is the order of the reasons a human would want back: an
 * emergency kill outranks a deliberate switch-off, which outranks a cohort
 * boundary. All three produce `enabled: false`; only the reason differs, and the
 * reason is what makes "why is this off for me?" answerable without a debugger.
 */
export function decideFlag(
  config: ResolvedConfig,
  flag: FlagName,
  subjectId: string,
): FlagDecision {
  const rolloutPercent = config.get<number>(flagRolloutKey(flag))
  const bucket = cohortBucket(flag, subjectId)
  const base = { flag, bucket, rolloutPercent }

  const killList = config.get<readonly string[]>(FLAG_KILL_LIST_KEY)
  if (killList.includes(flag)) return { ...base, enabled: false, reason: "killed" }

  if (!config.get<boolean>(flagEnabledKey(flag))) {
    return { ...base, enabled: false, reason: "turnedOff" }
  }

  // A subject with no id cannot be placed in a cohort, and guessing would make
  // the rollout percentage a lie for exactly the callers who forgot to identify
  // anyone. Full rollout is unaffected — 100% admits everyone by definition, so
  // this only bites where a cohort was actually asked for.
  if (!subjectId) {
    return rolloutPercent >= 100
      ? { ...base, enabled: true, reason: "enabled" }
      : { ...base, enabled: false, reason: "unidentifiedSubject" }
  }

  if (bucket >= rolloutPercent) {
    return { ...base, enabled: false, reason: "outsideCohort" }
  }

  return { ...base, enabled: true, reason: "enabled" }
}
