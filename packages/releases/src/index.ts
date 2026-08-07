/**
 * @tenure/releases — what a system is, frozen and citable.
 *
 * A running organization system is the sum of a blueprint, a set of enabled
 * modules, a resolved configuration, an org topology and a set of policies. All
 * five can change independently, and nothing otherwise records which
 * combination was live when a workflow ran or an approval was decided.
 *
 * A release is that combination, hashed and immutable:
 *
 *   const candidate = signRelease(createRelease({ tenantId, modules, schemaVersion, ... }), key)
 *   const { valid, problems } = validateSystem({ input: candidate, ... })
 *   const approved = transition(transition(candidate, "validated"), "approved", { actor, at })
 *   const active   = transition(transition(transition(approved, "scheduled"), "canary"), "active")
 *
 * Signing is not optional: `transition(_, "approved")` refuses an unsigned
 * artifact, because a checksum proves the bytes are consistent and not who
 * produced them. `active` is reachable only through `canary`, so approval
 * cannot mean "everyone takes it at once".
 *
 * Rollback publishes the old content as a NEW revision rather than reactivating
 * the old artifact, so history stays append-only and "what was live at 14:05?"
 * keeps one answer.
 */

export {
  ReleaseError,
  TRANSITIONS,
  breakingChanges,
  checksumOfRelease,
  createRelease,
  diffReleases,
  rollbackTo,
  signRelease,
  transition,
  verifyRelease,
} from "./release"
export type {
  ModulePin,
  ReleaseContent,
  ReleaseDiffEntry,
  ReleaseInput,
  ReleaseSignature,
  ReleaseState,
  ReleaseVerification,
  SigningKey,
  SystemRelease,
} from "./release"

export { validateSystem } from "./validate"
export type { SystemUnderValidation, ValidationProblem, ValidationResult } from "./validate"
