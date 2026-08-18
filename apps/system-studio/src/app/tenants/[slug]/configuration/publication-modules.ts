import type { ModuleLike } from "@tenure/configuration"
import { MODULES } from "@tenure/modules"

/**
 * The module closure this Studio hands to `planPublication`.
 *
 * It was written out three times in `actions.ts` — review, publish and rollback
 * — and all three dropped `version`. That was not cosmetic. Without a version
 * every package resolved as unversioned, and the graph snapshot said so: its
 * digest could detect a CHANGED declaration and could not detect the same
 * declarations republished as `2.0.0`. An approval bound to that digest would
 * have accepted the republished package as the thing it approved, which is the
 * one replay a digest exists to refuse (CFG-030-005).
 *
 * One function, so a fourth caller cannot invent a fourth shape, and so a test
 * can assert what production actually passes rather than a copy of it.
 *
 * `provides` is not optional decoration either: a dependency may name a
 * CAPABILITY another module supplies rather than a module key — `reimbursements`
 * depends on `finance.ledger`, which `budgeting` provides — and without it the
 * graph check reports a dangling reference and blocks EVERY publication.
 */
export function publicationModules(): readonly (ModuleLike & { version?: string })[] {
  return MODULES.map((m) => ({
    key: m.key,
    version: m.version,
    dependsOn: m.dependsOn,
    provides: m.provides,
    entitlement: m.requiresEntitlement,
  }))
}
