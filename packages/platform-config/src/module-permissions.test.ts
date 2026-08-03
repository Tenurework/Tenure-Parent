import { isPermissionKey, lookupPermission, MODULE_KEYS } from "@tenure/authorization"
import { MODULE_CATALOG } from "@tenure/modules"

/**
 * The module catalog and the permission catalog have to be the same catalog.
 *
 * They were not, and the way that surfaced is the point. GE-051-001 made
 * `decide()` refuse a permission nothing declares. `navigation-capabilities.ts`
 * was moved onto real keys; the Admin Console link still did not appear,
 * because the *nav entry* asked for `administration.access` — a string the
 * module manifest declared and nothing else in the platform had heard of. Two
 * halves of one gate, agreeing with each other and with nobody.
 *
 * A module declaring permissions that do not exist is the failure the manifest's
 * own header warns about: "a manifest that declares workflow actions, form
 * components and integration hooks before any of those engines exist is a
 * manifest whose declarations cannot be wrong, because nothing checks them."
 * This is what checks them.
 */

const permissionsOf = (m: { permissions?: readonly string[] }) => m.permissions ?? []

/** `ModuleCatalog` is a class keyed by module id, not an array. */
const MODULES = MODULE_CATALOG.all()

describe("every permission a module declares is in the catalog", () => {
  it("has modules to check", () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(10)
    expect(MODULES.flatMap(permissionsOf).length).toBeGreaterThanOrEqual(30)
  })

  it("declares no permission the catalog does not", () => {
    const unknown: string[] = []
    for (const module of MODULES) {
      for (const permission of permissionsOf(module)) {
        if (!isPermissionKey(permission)) unknown.push(`${module.key} -> "${permission}"`)
      }
    }
    expect(unknown).toEqual([])
  })

  it("declares only permissions the catalog gates on that same module", () => {
    // A module claiming somebody else's permission is a module that appears to
    // grant something turning it on cannot actually give.
    const mismatched: string[] = []
    for (const module of MODULES) {
      for (const permission of permissionsOf(module)) {
        const entry = lookupPermission(permission)
        if (!entry) continue
        if (entry.module !== null && entry.module !== module.key) {
          mismatched.push(
            `${module.key} declares "${permission}", which the catalog gates on "${entry.module}"`,
          )
        }
      }
    }
    expect(mismatched).toEqual([])
  })
})

describe("every capability a nav entry requires is in the catalog", () => {
  const required = MODULES.flatMap((m) =>
    (m.navigation ?? [])
      .filter((n) => n.requiresCapability)
      .map((n) => ({ module: m.key, entry: n.id, capability: n.requiresCapability as string })),
  )

  it("has nav entries that require something", () => {
    // Otherwise the check below passes by finding nothing to check.
    expect(required.length).toBeGreaterThan(0)
  })

  it("requires only capabilities the catalog declares", () => {
    // This is the exact assertion that would have turned a red e2e into a red
    // unit test: the link is filtered out when the required capability is not in
    // the set, and a capability nobody can hold is never in the set.
    const unknown = required
      .filter((r) => !isPermissionKey(r.capability))
      .map((r) => `${r.module}/${r.entry} requires "${r.capability}"`)
    expect(unknown).toEqual([])
  })

  it("requires capabilities its own module declares", () => {
    // A nav entry gated on a permission its module does not confer is a link
    // nobody can ever see, which looks identical to a link nobody has permission
    // for — and the difference is a bug versus a policy.
    const orphans: string[] = []
    for (const module of MODULES) {
      const declared = new Set(permissionsOf(module))
      for (const entry of module.navigation ?? []) {
        if (entry.requiresCapability && !declared.has(entry.requiresCapability)) {
          orphans.push(
            `${module.key}/${entry.id} requires "${entry.requiresCapability}", which ${module.key} does not declare`,
          )
        }
      }
    }
    expect(orphans).toEqual([])
  })
})

describe("the two module lists agree on what the platform ships", () => {
  it("gates permissions only on modules the module catalog has", () => {
    // `MODULE_KEYS` in the permission catalog is a second list of module ids.
    // Two lists that can disagree eventually do.
    const shipped = new Set(MODULES.map((m) => m.key))
    expect(MODULE_KEYS.filter((k) => !shipped.has(k))).toEqual([])
  })
})
