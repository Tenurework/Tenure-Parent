import type { Prisma } from "@prisma/client"

import { currentScope } from "./context"
import { TENANT_SCOPED } from "./registry"

/**
 * GE-021-005 — a repository you cannot use without a resolved tenant.
 *
 * `tenancyExtension` already refuses an unscoped query at the Prisma layer, and
 * that is the control that matters. This is the layer above it, and it exists
 * for a different reason: the extension refuses at *execution*, when the query
 * has already been written, reviewed and shipped. A repository that cannot be
 * constructed without a scope refuses at *authoring*, which is where refusing
 * is cheap.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Not an abstraction over Prisma. Wrapping every method would be a second query
 * language to learn, kept in sync by hand, worse at the thing Prisma is good
 * at. `for()` hands back the real delegate — the whole contribution is that
 * getting hold of it requires proving a scope first, and that the model you
 * asked for is one the registry says is tenant-scoped.
 */

export class RepositoryScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RepositoryScopeError"
  }
}

/** Models the registry classifies as tenant-scoped, as a set for cheap lookup. */
const SCOPED = new Set<string>(TENANT_SCOPED)

/**
 * A tenant-bound view of the database.
 *
 * Constructed only through `boundRepository()`, which reads the ambient scope
 * and throws without one. Holding an instance is therefore proof that a tenant
 * was resolved — which is the property the type system can carry into a
 * function signature, where a comment cannot.
 */
export class BoundRepository {
  private constructor(
    readonly tenantId: string,
    private readonly client: Record<string, unknown>,
  ) {}

  /** @internal — use `boundRepository()`. */
  static __create(tenantId: string, client: Record<string, unknown>): BoundRepository {
    return new BoundRepository(tenantId, client)
  }

  /**
   * The Prisma delegate for a tenant-scoped model.
   *
   * Refuses a model the registry does not classify as scoped. Reaching for
   * `Institution` or `Blueprint` through a *tenant-bound* repository is either
   * a mistake or a misunderstanding, and both are worth stopping: the extension
   * would let it through, because those rows genuinely are platform-global.
   */
  for<K extends string>(model: K): Prisma.TypeMap["model"] extends never ? unknown : unknown {
    if (!SCOPED.has(model)) {
      throw new RepositoryScopeError(
        `"${model}" is not a tenant-scoped model. Platform-global rows are read through the ` +
          `unscoped client with a stated reason, not through a tenant repository — asking here ` +
          `means either the model is misclassified in lib/tenancy/registry.ts, or this code is ` +
          `reaching for something that does not belong to a tenant.`,
      )
    }

    const delegate = this.client[model]
    if (!delegate) {
      throw new RepositoryScopeError(
        `"${model}" is classified as tenant-scoped but the client has no such delegate. The ` +
          `registry and the schema have drifted.`,
      )
    }
    return delegate as never
  }
}

/**
 * Bind a repository to the ambient tenant, or refuse.
 *
 * The throw is the point. Returning null would let a caller write
 * `repo?.for("Organization")` and get an undefined back, and undefined behaves
 * like "no rows" everywhere downstream — an unscoped read silently becoming an
 * empty result is worse than an error, because it looks like data.
 */
export function boundRepository(client: unknown): BoundRepository {
  const scope = currentScope()

  if (!scope) {
    throw new RepositoryScopeError(
      "No tenant scope. A tenant-bound repository cannot be constructed outside a resolved " +
        "tenant — if this is platform work that legitimately spans tenants, use runUnscoped() " +
        "with a reason, which is recorded.",
    )
  }

  return BoundRepository.__create(scope.institutionId, client as Record<string, unknown>)
}

/** Exported so the test can assert the classification it depends on. */
export const __scoped = SCOPED
