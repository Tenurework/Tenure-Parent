/**
 * The tenant-bound repository, tested on the ways it can be used without a
 * tenant.
 *
 * `tenancyExtension` already refuses an unscoped query at execution. This
 * refuses at authoring — you cannot get hold of a delegate without first
 * proving a scope — so every test here is an attempt to get one anyway.
 */
import { describe, expect, it } from "@jest/globals"

import { runInTenantScope, runUnscoped } from "./context"
import { TENANT_SCOPED, PLATFORM_GLOBAL } from "./registry"
import { RepositoryScopeError, __scoped, boundRepository } from "./repository"

/** A stand-in client: every model name maps to a marker object. */
const client = Object.fromEntries(
  [...TENANT_SCOPED, ...PLATFORM_GLOBAL].map((m) => [m, { __delegate: m }]),
)

const scope = {
  institutionId: "t-roch",
  environment: "test" as const,
  purpose: "interactive" as const,
  actor: { principalId: "u", principalType: "user" as const },
}

describe("binding", () => {
  it("binds inside a tenant scope", () => {
    runInTenantScope(scope, () => {
      const repo = boundRepository(client)
      expect(repo.tenantId).toBe("t-roch")
    })
  })

  it("refuses outside any scope", () => {
    // Throwing rather than returning null is deliberate: `repo?.for("X")` would
    // yield undefined, and undefined behaves like "no rows" everywhere
    // downstream — an unscoped read silently becoming an empty result is worse
    // than an error, because it looks like data.
    expect(() => boundRepository(client)).toThrow(RepositoryScopeError)
    expect(() => boundRepository(client)).toThrow(/No tenant scope/)
  })

  it("refuses inside an explicitly unscoped block", () => {
    // runUnscoped is for platform work that spans tenants. A tenant-bound
    // repository inside one is a contradiction.
    runUnscoped("control-plane", "provisioning", () => {
      expect(() => boundRepository(client)).toThrow(RepositoryScopeError)
    })
  })

  it("names the escape hatch in the refusal", () => {
    // An error that says only "no" sends the reader to the source. This one
    // says what to do instead.
    try {
      boundRepository(client)
    } catch (err) {
      expect((err as Error).message).toMatch(/runUnscoped\(\)/)
    }
  })
})

describe("model classification", () => {
  it("hands back the delegate for a tenant-scoped model", () => {
    runInTenantScope(scope, () => {
      const repo = boundRepository(client)
      expect(repo.for(TENANT_SCOPED[0])).toEqual({ __delegate: TENANT_SCOPED[0] })
    })
  })

  it("refuses a platform-global model", () => {
    // The extension would allow these — those rows genuinely are global. Asking
    // for one through a TENANT repository is a mistake or a misunderstanding,
    // and both are worth stopping.
    runInTenantScope(scope, () => {
      const repo = boundRepository(client)
      for (const model of PLATFORM_GLOBAL) {
        expect(() => repo.for(model)).toThrow(/not a tenant-scoped model/)
      }
    })
  })

  it("refuses a model that does not exist at all", () => {
    runInTenantScope(scope, () => {
      expect(() => boundRepository(client).for("NotAModel")).toThrow(/not a tenant-scoped model/)
    })
  })

  it("reports registry/schema drift distinctly from misclassification", () => {
    // A model the registry calls scoped but the client does not have means the
    // two have drifted — a different problem from asking for a global model,
    // and worth a different message.
    runInTenantScope(scope, () => {
      const thin = boundRepository({})
      expect(() => thin.for(TENANT_SCOPED[0])).toThrow(/have drifted/)
    })
  })

  it("classifies every scoped model and no global one", () => {
    // Guards against the set quietly emptying, which would turn the check above
    // into a pass for everything.
    expect(__scoped.size).toBe(TENANT_SCOPED.length)
    expect(__scoped.size).toBeGreaterThan(10)
    for (const model of PLATFORM_GLOBAL) {
      expect(__scoped.has(model)).toBe(false)
    }
  })
})
