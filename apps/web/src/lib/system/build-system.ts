/**
 * The cell's view of its own system.
 *
 * The assembler itself lives in `@tenure/platform-config`, not here. It used to
 * live in this file, and its docstring said it was "the function the System
 * Studio's validate button calls, the one provisioning calls before it creates
 * anything". That was not true and could not become true: the Studio is a
 * different application and cannot import a file out of this one, so it
 * re-derived its own assembly a repository away — exactly the drift that having
 * one function was supposed to prevent.
 *
 * So the assembler moved to the package that exists for this reason. In its own
 * words: both the tenant application and the System Studio need the same answer
 * to what an institution's system is, and two copies of that answer is two
 * answers. This module stays as the cell's import surface so nothing in
 * `apps/web` spells the same import two ways.
 *
 * Callers, named rather than implied — a docstring listing callers it does not
 * have is worse than one listing none: `reference-systems.test.ts` and
 * `build-system.test.ts` here, and `apps/system-studio/src/app/tenants/[slug]`,
 * which imports `buildSystem` and `planPromotion` from the package directly.
 */
export {
  ROLLOUT_PATH,
  buildSystem,
  planPromotion,
  systemUnderValidation,
} from "@tenure/platform-config"
export type {
  AssembledSystem,
  BuildSystemOptions,
  PromotionInput,
  PromotionPlan,
  PromotionStep,
  SystemParts,
} from "@tenure/platform-config"
