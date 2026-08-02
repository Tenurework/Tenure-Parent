/**
 * The shape of an allowed-model entry.
 *
 * Declared here rather than imported from `@tenure/provisioning` so a cell can
 * read model policy without importing the engine's control plane. The catalog
 * lifecycle vocabulary is shared; extension and package catalogs are not, and
 * `provisioning` re-exports this type so there is still one definition.
 */
export type ModelLifecycle =
  | "DRAFT"
  | "SUBMITTED"
  | "CERTIFIED"
  | "PUBLISHED"
  | "DEPRECATED"
  | "REVOKED"

export interface ModelEntry {
  kind: "model"
  key: string
  displayName: string
  lifecycle: ModelLifecycle
  publisher: "platform" | "third-party"
  /** The provider's own identifier, sent on the wire. */
  modelId: string
  provider: "anthropic" | "bedrock"
  /**
   * Regions this model may be invoked from.
   *
   * A real constraint, not bookkeeping: a model available in us-east-1 and not
   * in eu-west-1 means a European cell calling it either fails or, worse,
   * succeeds by routing the request out of the region the tenant's residency
   * promised. `"*"` is a global endpoint, which the Anthropic API is and
   * Bedrock is not.
   */
  regions: readonly string[]
}
