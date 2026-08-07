import type { ZodType } from "zod"

import { priceProblems, type OptionPrice } from "@tenure/finops"

import type { ConfigScope } from "./scopes"
import { isConfigScope } from "./scopes"
import type { MergeStrategy } from "./merge"
import { MERGE_STRATEGIES } from "./merge"

/**
 * How much damage disclosing a value does. Drives redaction in logs, audit
 * records and support views — not access control, which is `requiresCapability`.
 */
export const SENSITIVITIES = ["public", "internal", "confidential", "secret"] as const
export type Sensitivity = (typeof SENSITIVITIES)[number]

/**
 * One configurable thing, declared once by whoever owns it.
 *
 * A definition is the contract. Nothing may set a key that has no definition,
 * which is what stops configuration from becoming an untyped bag that every
 * caller reads defensively.
 */
export interface ConfigDefinition<T = unknown> {
  /**
   * Namespaced key, `<owner>.<name>`, e.g. `platform.terminology.staffOffice`
   * or `finance.budget.approvalThreshold`.
   *
   * The prefix is enforced against `owner` rather than asked for politely. The
   * platform architecture document states the rule and then breaks it in its own
   * worked example — declaring pack id `pack.finance` alongside capabilities
   * named `finance.budget.read` — which is what an unenforced convention always
   * eventually looks like.
   */
  key: string

  /** `platform`, or the module key that owns this setting. */
  owner: string

  /** Runtime validation. Every value from every layer is parsed through this. */
  type: ZodType<T>

  /** Used when no layer sets the key. Validated at registration, not at first read. */
  default: T

  /** Scopes at which an override may be set. A scope not listed is refused. */
  allowedScopes: readonly ConfigScope[]

  /** How a higher layer combines with a lower one. See merge.ts. */
  mergeStrategy: MergeStrategy

  sensitivity: Sensitivity

  /**
   * False pins the value to its default: no layer may override it at all.
   *
   * For things that are configurable in principle but frozen for now — a safer
   * statement than silently omitting every scope, because it says the intent.
   */
  overridable: boolean

  /**
   * Capability a principal must hold to SET this. Reading is governed elsewhere.
   *
   * Declared here and enforced in `planPublication`, which refuses a proposal
   * touching this key unless the publisher's held capabilities include it. It
   * was declared and enforced NOWHERE until PAY-000-007: a field that only
   * documents an intention is indistinguishable from no field, and the first
   * key that actually needed it would have been publishable by anyone.
   */
  requiresCapability?: string

  /**
   * True when this key means nothing until the tenant is in live mode.
   *
   * The separation PAY-000-007 exists for, expressed where it can be enforced.
   * A tenant in `test` mode publishing a live-only value has recorded a
   * decision that governs money it is not moving — a legal entity that signs
   * for nothing, a descriptor that appears on no statement — and the value then
   * silently becomes effective the moment somebody flips the mode, which is the
   * one moment nobody re-reads the configuration.
   *
   * So `planPublication` blocks it while the tenant's current resolved mode is
   * `test`. Flipping the mode is its own publication, with its own diff and its
   * own capability, and the live-only values follow it.
   */
  liveOnly?: boolean

  /**
   * What choosing this option costs — per seat AND for the whole organisation.
   *
   * Required, and required for a reason. NEXT-SESSION §7 is a standing product
   * requirement: every option a tenant chooses, at every stage of setup, carries
   * a price with a running total, "so cost is never a surprise at the end", and
   * "a new config option without a price is incomplete."
   *
   * Required rather than optional is the whole enforcement. An optional field a
   * caller does not set is invisible to `tsc` — it compiles, every unit test
   * passes because tests build their own fixtures, and the gap appears only when
   * a customer is looking at a quote with a blank cell in it. Declared required,
   * a new definition that does not price itself fails to compile, and one built
   * by spreading an older object fails `validateDefinition` at registration.
   *
   * An option that genuinely costs nothing writes zero on both axes AND says
   * why, in `includedBecause`. Zero is a commercial statement — it says Tenure
   * gives this away — and it is indistinguishable on a form from "nobody has
   * priced this yet", so the reason is required rather than implied.
   *
   * `OptionPrice` is the platform's one price shape, shared with the module
   * catalog's option prices, so a quote assembled from modules and one assembled
   * from configuration are the same arithmetic rather than two that agree until
   * they do not.
   */
  price: OptionPrice

  /** What it is for, in a sentence. Surfaced in the Studio. */
  description: string
}

export class ConfigDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigDefinitionError"
  }
}

const KEY_SEGMENT = /^[a-z][a-zA-Z0-9]*$/

/**
 * Check one definition in isolation.
 *
 * Runs at registration, so a malformed definition is a startup failure rather
 * than a surprise on the first request that reads it.
 */
export function validateDefinition(def: ConfigDefinition): void {
  const where = `Configuration definition "${def.key}"`

  if (!def.owner || !KEY_SEGMENT.test(def.owner)) {
    throw new ConfigDefinitionError(
      `${where} has owner ${JSON.stringify(def.owner)}, which must be a lowerCamelCase identifier.`,
    )
  }

  const segments = def.key.split(".")
  if (segments.length < 2) {
    throw new ConfigDefinitionError(`${where} must be namespaced as "<owner>.<name>".`)
  }
  if (segments[0] !== def.owner) {
    throw new ConfigDefinitionError(
      `${where} is owned by "${def.owner}" but namespaced under "${segments[0]}". ` +
        `The key must begin with its owner, so that reading a key tells you who is responsible for it.`,
    )
  }
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) {
      throw new ConfigDefinitionError(
        `${where} has segment ${JSON.stringify(segment)}; each must be lowerCamelCase.`,
      )
    }
  }

  if (!MERGE_STRATEGIES.includes(def.mergeStrategy)) {
    throw new ConfigDefinitionError(
      `${where} declares unknown merge strategy ${JSON.stringify(def.mergeStrategy)}.`,
    )
  }

  if (def.allowedScopes.length === 0 && def.overridable) {
    throw new ConfigDefinitionError(
      `${where} is overridable but lists no allowed scopes, so nothing could ever set it. ` +
        `Set overridable: false to pin it to its default, which says the same thing on purpose.`,
    )
  }
  for (const scope of def.allowedScopes) {
    if (!isConfigScope(scope)) {
      throw new ConfigDefinitionError(`${where} lists unknown scope ${JSON.stringify(scope)}.`)
    }
  }

  // NEXT-SESSION §7. Checked here, at registration, so an unpriced option is a
  // startup failure — the same class of failure as an unnamed owner — rather
  // than a blank column on the screen where a customer decides what to buy.
  //
  // `priceProblems` is the pricing engine's own rule set (missing price,
  // fractional minor units, negative list price, bad currency, unstated
  // rounding), reused rather than restated: a second copy here would be a second
  // answer to "is this price usable".
  const pricing = priceProblems(def.price, where)
  if (pricing.length > 0) {
    throw new ConfigDefinitionError(
      `${pricing.join(" ")} Every configuration option is priced per seat AND for the whole ` +
        `organisation (NEXT-SESSION §7); an option without a price is incomplete.`,
    )
  }
  // Zero on both axes is a commercial statement — it says Tenure gives this
  // away — and on a form it is indistinguishable from "nobody has priced this
  // yet". The reason is what tells them apart, so it is required exactly where
  // the amounts are zero and nowhere else.
  if (
    def.price.perSeatMinor === 0 &&
    def.price.perOrgMinor === 0 &&
    (typeof def.price.includedBecause !== "string" || def.price.includedBecause.trim() === "")
  ) {
    throw new ConfigDefinitionError(
      `${where} is priced at zero per seat and zero for the organisation with no ` +
        `includedBecause. "Included" is a promise somebody has to be able to withdraw, and one ` +
        `nobody wrote down is indistinguishable from an option nobody has priced.`,
    )
  }

  // A default that does not satisfy its own schema is a bug that would otherwise
  // surface only for the tenants who never override it.
  const parsed = def.type.safeParse(def.default)
  if (!parsed.success) {
    throw new ConfigDefinitionError(
      `${where} has a default that fails its own schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    )
  }
}

/**
 * The set of definitions a running system knows about.
 *
 * Immutable once built. Modules contribute definitions when they are enabled,
 * which produces a new registry rather than mutating this one — so a request
 * that is mid-resolution cannot observe a half-applied module change.
 */
export class ConfigRegistry {
  private readonly byKey: ReadonlyMap<string, ConfigDefinition>

  private constructor(byKey: ReadonlyMap<string, ConfigDefinition>) {
    this.byKey = byKey
  }

  static of(definitions: readonly ConfigDefinition[]): ConfigRegistry {
    const byKey = new Map<string, ConfigDefinition>()
    for (const def of definitions) {
      validateDefinition(def)
      const existing = byKey.get(def.key)
      if (existing) {
        throw new ConfigDefinitionError(
          `Duplicate configuration key "${def.key}", declared by "${existing.owner}" and "${def.owner}". ` +
            `Two owners for one key means neither can reason about its value.`,
        )
      }
      byKey.set(def.key, def)
    }
    return new ConfigRegistry(byKey)
  }

  /** A registry with more definitions — for enabling a module. Never mutates. */
  with(definitions: readonly ConfigDefinition[]): ConfigRegistry {
    return ConfigRegistry.of([...this.byKey.values(), ...definitions])
  }

  get(key: string): ConfigDefinition | undefined {
    return this.byKey.get(key)
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  keys(): string[] {
    return [...this.byKey.keys()].sort()
  }

  all(): ConfigDefinition[] {
    return this.keys().map((k) => this.byKey.get(k)!)
  }

  ownedBy(owner: string): ConfigDefinition[] {
    return this.all().filter((d) => d.owner === owner)
  }

  get size(): number {
    return this.byKey.size
  }
}

/** Helper that keeps `T` inferred from the schema instead of widening to unknown. */
export function defineConfig<T>(def: ConfigDefinition<T>): ConfigDefinition<T> {
  validateDefinition(def as ConfigDefinition)
  return def
}
