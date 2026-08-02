/**
 * @tenure/configuration — layered, governed configuration.
 *
 * The premise the whole platform rests on: organization-specific behaviour is
 * delivered by configuration, not by organization-specific code. There is no
 * `if (tenant.slug === "rochester")` anywhere, because there is somewhere else
 * for that difference to live.
 *
 * A value is declared once (`defineConfig`), collected into a registry, and
 * resolved by folding ordered layers over the default. Resolution is
 * fail-closed, attributable, and content-hashed, so a system can cite the exact
 * configuration it ran under.
 *
 *   const registry = ConfigRegistry.of([...PLATFORM_TERMINOLOGY])
 *   const config = resolveConfigOrThrow(registry, [
 *     { scope: "tenant", id: "rochester", values: { "platform.terminology.staffOffice": "Ainslie OSE" } },
 *   ])
 *   config.get<string>("platform.terminology.staffOffice")   // "Ainslie OSE"
 *   config.explain("platform.terminology.staffOffice")       // which layer set it
 *   config.checksum                                          // "sha256:…"
 */

export { CONFIG_SCOPES, isConfigScope, scopeRank } from "./scopes"
export type { ConfigScope } from "./scopes"

export {
  MERGE_STRATEGIES,
  RESTRICTIVE_STRATEGIES,
  MergeError,
  isRestrictive,
  mergeValues,
  stableStringify,
} from "./merge"
export type { MergeStrategy } from "./merge"

export {
  ConfigDefinitionError,
  ConfigRegistry,
  SENSITIVITIES,
  defineConfig,
  validateDefinition,
} from "./definition"
export type { ConfigDefinition, Sensitivity } from "./definition"

export {
  ConfigResolutionError,
  checksumOf,
  redact,
  resolveConfig,
  resolveConfigOrThrow,
} from "./resolve"
export type {
  ConfigLayer,
  Provenance,
  ResolutionProblem,
  ResolveOptions,
  ResolveResult,
  ResolvedConfig,
} from "./resolve"

export { ConfigVersionError, diffVersions, publish, supersede } from "./version"
export type { ConfigDiffEntry, ConfigVersion, PublicationState, PublishInput } from "./version"

export {
  LAYER_KINDS,
  RESTRICT_ONLY_KINDS,
  invariantKeys,
  isEffectiveAt,
  isLayerKind,
  layerRank,
  orderLayers,
  requiresApproval,
  validateLayer,
} from "./layer-schema"
export type {
  CompatibilityRange,
  LayerKind,
  LayerMetadata,
  LayerProblem,
  OrderedLayers,
  VersionedLayer,
} from "./layer-schema"

export { SCOPE_FOR_KIND, resolveVersionedLayers } from "./layer-bridge"
export type { VersionedResolveResult } from "./layer-bridge"

export {
  CONFIG_DOMAINS,
  domainOf,
  getDomain,
  refusedByDomain,
  validateDomains,
} from "./domains"
export type { ConfigDomain, DomainProblem, DomainRefusal } from "./domains"

export {
  ENGINE_VERSION,
  compareSemver,
  immutabilityBreaches,
  incompatibleLayers,
  layerDigest,
  provenanceDigest,
} from "./integrity"
export type { CompatibilityProblem, ImmutabilityBreach, PublishedDigest } from "./integrity"

export {
  UNIMPLEMENTED_REJECTIONS,
  allRejections,
  ambiguousPrecedence,
  moduleGraphRejections,
  unentitledFeatures,
  unsafeExpressions,
} from "./rejections"
export type { ModuleLike, Rejection } from "./rejections"

export {
  DEFAULT_LIMITS,
  EXPRESSION_LANGUAGE_VERSION,
  ExpressionError,
  FUNCTIONS,
  dependencies,
  evaluate,
  expressionCycles,
  parse as parseExpression,
  run as runExpression,
  tokenize,
  typeOf,
} from "./expression"
export type { EvaluationResult, ExprType, Limits, Node as ExpressionNode, TypeEnv, ValueEnv } from "./expression"

export { lint, planPublication, renderDiff, simulate } from "./publication"
export type { Fixture, Impact, LintFinding, PublicationInput, PublicationPlan, SimulationResult } from "./publication"

export { ConfigStoreError, InMemoryConfigStore, commit, rollbackTarget } from "./store"
export type { CommitInput, ConfigRecord, ConfigStore } from "./store"
