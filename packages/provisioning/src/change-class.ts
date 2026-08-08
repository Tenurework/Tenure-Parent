import type { TenantState } from "./lifecycle"

/**
 * STUDIO-060-007 — the C1–C7 change taxonomy, and what each class costs.
 *
 * Before this existed the only risk vocabulary in the platform was
 * `riskClass?: "read" | "write" | "irreversible"` on a module manifest
 * (`packages/module-runtime/src/manifest.ts`), which is a hint for a module
 * menu. Nothing on the mutating path had a class at all, so "typed confirmation
 * for C6" and "two-person approval, cooling-off and non-automatable for C7"
 * were requirements with nothing to attach to: the Studio's high-risk panel
 * DISPLAYED five sentences and demanded nothing, approval was a boolean pair,
 * and no operation anywhere was marked as one a machine must not perform.
 *
 * ── The seven classes ──────────────────────────────────────────────────────
 *
 *   C1  observation. Reads. Nothing changes.
 *   C2  self-healing. Reversible with no operator action — a cache invalidation
 *       repopulates itself; the worst case is latency.
 *   C3  reversible configuration inside one tenant. No data moves, no money is
 *       spent, and the previous revision can be re-published.
 *   C4  capacity. Costs money from the moment it applies, and is undone by
 *       setting the number back.
 *   C5  creation. Brings resources into existence for a tenant. Reversible by
 *       tearing them down, which is itself a C7.
 *   C6  customer-visible. Routes real users at a system, or changes one that is
 *       already serving them. Reversible, but not before somebody noticed.
 *   C7  irreversible. Destroys data or capability that cannot be recreated from
 *       anything this platform holds.
 *
 * The boundary that matters is C6/C7, and it is not "how expensive" — it is
 * whether the previous state can be restored from something we still have. A
 * $40,000 mistake that can be undone is C4. Deleting a term's worth of student
 * records is C7 at any price.
 *
 * ── Why the token names the target ─────────────────────────────────────────
 *
 * `typedConfirmation` is not "type YES". A constant token is one an operator
 * types from muscle memory within a week, and a confirmation nobody reads is a
 * confirmation that trains people to click through — which `states.tsx` already
 * says about dialogs and was true of its own high-risk panel. The token embeds
 * the slug, so typing it is the act of reading which tenant is about to be
 * affected.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Nothing here reads a clock. `coolingOffMs` is a duration; whether it has
 * elapsed is decided by the dispatcher against a PERSISTED start time, because
 * a caller that supplies both the start and the now can satisfy any waiting
 * period instantly.
 */

export const CHANGE_CLASSES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"] as const

export type ChangeClass = (typeof CHANGE_CLASSES)[number]

/**
 * Everything the platform can be asked to change, as a closed union.
 *
 * Closed on purpose. `classify` switches exhaustively, so adding a surface is a
 * compile error until somebody decides which class it is — which is the whole
 * mechanism. An open `{ surface: string }` would let a new mutating path ship
 * unclassified and default to whatever the fallback happened to be.
 *
 * `fleet-capacity` and `edge-cache` are here although no code performs them
 * yet. They are the two operations the control-plane brief names first, both
 * are refused rather than automated, and `REFUSED_OPERATIONS` in the Studio
 * renders that refusal with the command a human runs instead — so the arms are
 * reached by a surface an operator reads, not held for a future caller.
 */
export type ChangeOperation =
  /** Reading the estate, the registry or a bill. */
  | { surface: "estate"; action: "read"; target: string }
  /** Moving a tenant along the lifecycle. `action` is the DESTINATION state. */
  | { surface: "tenant-lifecycle"; action: TenantState; target: string }
  /** Composing or publishing a tenant's configuration revision. */
  | { surface: "tenant-configuration"; action: "preview" | "publish"; target: string }
  /** Changing how many tasks a service runs. */
  | { surface: "fleet-capacity"; action: "update-desired-count"; target: string }
  /** Invalidating a CloudFront path. */
  | { surface: "edge-cache"; action: "invalidate"; target: string }

/**
 * Lifecycle destinations that destroy something nothing can recreate.
 *
 * `PURGING` is the only one, and it is deliberately the only one: SUSPENDED and
 * HIBERNATED retain everything, OFFBOARDING moves a tenant toward deletion
 * without performing any, and `PURGE_PENDING` is the state where the decision
 * is still reversible. `PURGING` is where the rows go.
 */
const IRREVERSIBLE: ReadonlySet<TenantState> = new Set<TenantState>(["PURGING"])

/**
 * Lifecycle destinations a real user can feel.
 *
 * ACTIVATING switches routing on; SUSPENDING and HIBERNATING take a serving
 * tenant off the air. All three are recoverable and all three are noticed.
 */
const CUSTOMER_VISIBLE: ReadonlySet<TenantState> = new Set<TenantState>([
  "ACTIVATING",
  "SUSPENDING",
  "HIBERNATING",
  "REACTIVATING",
])

/** Destinations that bring resources into existence. */
const CREATES: ReadonlySet<TenantState> = new Set<TenantState>(["PROVISIONING", "CONFIGURING"])

export function classify(operation: ChangeOperation): ChangeClass {
  switch (operation.surface) {
    case "estate":
      return "C1"

    case "edge-cache":
      // Repopulates itself from the origin. The worst case is a latency spike,
      // which is why this is C2 and not C3 — nothing has to be put back.
      return "C2"

    case "tenant-configuration":
      return operation.action === "preview" ? "C1" : "C3"

    case "fleet-capacity":
      return "C4"

    case "tenant-lifecycle":
      if (IRREVERSIBLE.has(operation.action)) return "C7"
      if (CUSTOMER_VISIBLE.has(operation.action)) return "C6"
      if (CREATES.has(operation.action)) return "C5"
      // Every remaining move — VALIDATING, PLANNED, READY, EXPORTING,
      // OFFBOARDING, LEGAL_HOLD — changes where the tenant is recorded as being
      // and nothing else. Recoverable by moving it back, where the graph allows.
      return "C3"
  }
}

/** What a class demands before anything happens. */
export interface ChangeRequirements {
  /**
   * The exact string the operator must type, or null when none is required.
   *
   * Compared with `===`. Not trimmed, not lower-cased, not "starts with": a
   * confirmation that accepts a near miss is a confirmation that accepts a
   * paste of the wrong tenant's slug.
   */
  typedConfirmation: string | null
  /** How many distinct people must agree. Two means the requester is not one of them. */
  approvers: 1 | 2
  /** How long between asking and being allowed. Zero for everything below C7. */
  coolingOffMs: number
  /**
   * Whether this platform may perform it at all.
   *
   * False is not "hard"; it is a refusal. The engine holds credentials that can
   * delete a term's worth of student records, and a console that will do that
   * because a form was filled in correctly is the wrong shape of tool.
   */
  automatable: boolean
  /** Present exactly when `automatable` is false: what a human runs instead. */
  refusedWithCliCommand?: string
}

/** Fifteen minutes. Long enough to reconsider, short enough that nobody works around it. */
export const C7_COOLING_OFF_MS = 15 * 60 * 1000

/**
 * The token for an operation, or null when the class needs none.
 *
 * Exported separately because the dispatcher compares it and the UI renders it,
 * and those must be the same string produced by the same function — a form that
 * asks for one thing while the server compares another is a control that always
 * refuses, which gets removed rather than fixed.
 */
export function confirmationTokenFor(cls: ChangeClass, target: string): string | null {
  // The target itself, for both classes. Not "PURGE <slug>" or any other
  // decorated phrase: the Studio's confirmation panel already asks an operator
  // to type the tenant slug, and a token this function invents that the field
  // never asks for is a control that always refuses — which gets removed rather
  // than fixed. What matters is that the token NAMES THE TARGET, so typing it
  // is the act of reading which tenant is about to be affected.
  if (cls === "C7" || cls === "C6") return target
  return null
}

/**
 * What a class demands, for a named target.
 *
 * Takes the target as well as the class, because a token that does not name
 * what it applies to can be typed once and reused for anything — see the note
 * at the top of this file.
 */
export function requirementsFor(cls: ChangeClass, target: string): ChangeRequirements {
  switch (cls) {
    case "C1":
    case "C2":
      return { typedConfirmation: null, approvers: 1, coolingOffMs: 0, automatable: true }
    case "C3":
    case "C4":
      return { typedConfirmation: null, approvers: 1, coolingOffMs: 0, automatable: true }
    case "C5":
      // Spends money the moment it applies, so a second person agrees. No typed
      // token: it is undone by tearing the resources down, and a token here
      // would be the one operators learn to type without reading.
      return { typedConfirmation: null, approvers: 2, coolingOffMs: 0, automatable: true }
    case "C6":
      return {
        typedConfirmation: confirmationTokenFor(cls, target),
        approvers: 2,
        coolingOffMs: 0,
        automatable: true,
      }
    case "C7":
      return {
        typedConfirmation: confirmationTokenFor(cls, target),
        approvers: 2,
        coolingOffMs: C7_COOLING_OFF_MS,
        automatable: false,
        refusedWithCliCommand:
          `aws dynamodb delete-item --table-name "$TENANT_TABLE" ` +
          `--key '{"pk":{"S":"TENANT#${target}"},"sk":{"S":"STATE"}}'  # and the tenant's rows, in the cell, by hand`,
      }
  }
}
