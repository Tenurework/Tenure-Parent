import type { ModelEntry } from "./model-entry"

/**
 * GE-030-005 — the models Relay is allowed to invoke.
 *
 * `lib/ai.ts` read `process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-…"` with
 * no allowlist, so whatever that variable held went on the wire. A typo becomes
 * a 404 from the provider; a plausible-but-wrong id becomes a silently
 * different model; and a model nobody reviewed becomes one whose data-handling
 * terms nobody has read, invoked on tenant content.
 *
 * ## Why it lives in platform-config and not with the other catalogs
 *
 * The extension, package and connector catalogs are control-plane concerns —
 * the engine certifies and distributes them. Which model a cell may invoke is
 * POLICY the engine distributes TO a cell, like localization and flags, and the
 * cell has to read it at request time. Putting it in `@tenure/provisioning`
 * made `apps/web/src/lib/ai.ts` import the engine's control plane, which
 * `cell-independence.test.mjs` correctly refused: a cell serves one tenant, the
 * engine composes and signs for all of them, and the boundary erodes one
 * convenience at a time.
 *
 * The bible calls for a "Global Relay model policy, evaluation results,
 * allowed-model catalog, prompt/tool versions, and AI cost controls". This is
 * the allowed-model catalog: the part that can be true today.
 *
 * ## Only what is actually in use
 *
 * Two entries, both Anthropic, both what the application already calls. Listing
 * models nobody has reviewed would make the catalog a wish list, and a wish
 * list that gates production is worse than no gate — it looks like a control.
 *
 * `regions` is `["*"]` for the Anthropic API because it is a global endpoint
 * rather than a regional one. That is a real difference from Bedrock, where a
 * model available in us-east-1 and not eu-west-1 means a European cell either
 * fails or routes tenant content out of the region residency promised.
 */
export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    kind: "model",
    key: "anthropic.haiku-4-5",
    displayName: "Claude Haiku 4.5",
    modelId: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    lifecycle: "PUBLISHED",
    publisher: "platform",
    regions: ["*"],
  },
  {
    kind: "model",
    key: "anthropic.sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    modelId: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    lifecycle: "PUBLISHED",
    publisher: "platform",
    regions: ["*"],
  },
]

const BY_MODEL_ID = new Map(MODEL_CATALOG.map((m) => [m.modelId, m]))

/**
 * Whether a model id may be invoked from a region.
 *
 * Takes the id the caller would actually send, not a catalog key, because the
 * value that needs checking is the one going on the wire.
 */
export function modelIsAllowed(
  modelId: string,
  region: string,
  /**
   * The catalog to check against. Defaults to the shipped one.
   *
   * A parameter because a module-level constant nothing can vary makes the
   * revoked and region-limited branches unreachable from a test — and an
   * unreachable branch is one nothing proves. Two mutations (a revoked model
   * still allowed, a model ignoring its region list) passed the whole suite
   * until this existed. It is also the shape a per-cell catalog will need.
   */
  catalog: readonly ModelEntry[] = MODEL_CATALOG,
): boolean {
  const entry =
    catalog === MODEL_CATALOG
      ? BY_MODEL_ID.get(modelId)
      : catalog.find((c) => c.modelId === modelId)
  if (!entry) return false
  // PUBLISHED or DEPRECATED, and nothing else. REVOKED, DRAFT, SUBMITTED and
  // CERTIFIED all fall out of this one check — an explicit `=== "REVOKED"`
  // line above it could not change any outcome, and a mutation deleting it
  // passed every test. A line that cannot change an outcome is one that will
  // be trusted to do something it does not.
  //
  // `isUsable` DOES check revocation separately, because it returns a reason
  // and "revoked" and "not published" are different things to tell someone.
  // This returns a boolean, so there is nothing to distinguish.
  if (entry.lifecycle !== "PUBLISHED" && entry.lifecycle !== "DEPRECATED") return false
  return entry.regions.includes("*") || entry.regions.includes(region)
}

export function allowedModelIds(): readonly string[] {
  return MODEL_CATALOG.map((m) => m.modelId)
}
