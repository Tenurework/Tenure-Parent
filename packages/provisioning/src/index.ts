/**
 * @tenure/provisioning — bringing a tenant into existence, and taking it out.
 *
 * Two things live here and they are deliberately separate:
 *
 *   lifecycle.ts  where a tenant is, and which moves are legal from there
 *   manifest.ts   what a tenant IS — the thing an operator composes and the
 *                 thing provisioning reads
 *
 * Neither touches storage. That is what lets the rules be tested exhaustively
 * without AWS, and it is why the Studio can render a plan before anything has
 * been created.
 */

export {
  ALL_STATES,
  LifecycleError,
  REQUIRES_APPROVAL,
  RESIDUAL_COST,
  SERVING,
  TERMINAL,
  advance,
  canAdvance,
  needsApproval,
  nextStates,
} from "./lifecycle"
export type { Actor, AdvanceOptions, LifecycleStep, TenantState } from "./lifecycle"

export { MANIFEST_VERSION, digestOf, planFor, validateManifest } from "./manifest"
export type {
  IsolationTier,
  ManifestProblem,
  PlanStep,
  ProvisioningPlan,
  TenantManifest,
} from "./manifest"
