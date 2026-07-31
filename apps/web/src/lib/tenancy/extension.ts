import { Prisma } from "@prisma/client"
import { currentScope, currentUnscopedGrant, TenantContextError } from "./context"
import { decideScope } from "./scope-args"

/**
 * The chokepoint: one place every query passes through.
 *
 * Enforcement mode is deliberately separate from the rule itself. The
 * application has roughly sixty call sites that do not yet open a tenant scope,
 * so switching this on in `enforce` today would take the pilot down. It runs in
 * `observe` first — applying the filter wherever a scope exists, and recording
 * where one does not — and flips to `enforce` once the recording is empty.
 *
 * `observe` is not security. It is the instrument that tells us when we can
 * have security without breaking the product.
 */

export type EnforcementMode = "enforce" | "observe"

export type TenancyViolation = {
  model: string
  operation: string
  reason: string
  at: string
}

/** Violations seen in observe mode, for a coverage report. Bounded. */
const violations: TenancyViolation[] = []
const MAX_RECORDED = 500

export function recordedViolations(): readonly TenancyViolation[] {
  return violations
}

export function clearRecordedViolations(): void {
  violations.length = 0
}

function record(model: string, operation: string, reason: string) {
  if (violations.length >= MAX_RECORDED) return
  // Deduplicate: one uncovered call site fires on every request otherwise, and
  // a log that repeats itself is a log nobody reads.
  if (violations.some((v) => v.model === model && v.operation === operation)) return

  violations.push({ model, operation, reason, at: new Date().toISOString() })
  console.warn(`[tenancy] unscoped ${operation} on ${model} — ${reason}`)
}

export function resolveMode(env: Record<string, string | undefined> = process.env): EnforcementMode {
  // Opt-in, so enabling it is a deliberate act and never a side effect of an
  // environment that happens to be missing a variable.
  return env.TENANCY_ENFORCE === "true" ? "enforce" : "observe"
}

/**
 * Build the Prisma extension.
 *
 * `mode` is captured at construction so tests can build an enforcing client
 * without touching the process environment.
 */
export function tenancyExtension(mode: EnforcementMode = resolveMode()) {
  return Prisma.defineExtension({
    name: "tenancy",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const decision = decideScope({
            model,
            operation,
            args: (args ?? {}) as Record<string, unknown>,
            scope: currentScope(),
            unscopedGrant: currentUnscopedGrant(),
            enforce: mode === "enforce",
          })

          if (decision.action === "scoped") {
            return query(decision.args)
          }

          // Only a missing context is a coverage gap. A platform-global model,
          // a model with no tenant column, or a stated unscoped grant are all
          // decisions already made, not omissions.
          if (model && decision.reason.includes("no tenant context")) {
            record(model, operation, decision.reason)
          }

          return query(args)
        },
      },
    },
  })
}

export { TenantContextError }
