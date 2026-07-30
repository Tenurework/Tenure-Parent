import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  TENANT_SCOPED,
  PLATFORM_GLOBAL,
  UNENFORCEABLE,
  allRegisteredModels,
  isTenantScoped,
  isPlatformGlobal,
} from "./registry"

/**
 * The registry is only worth having if it cannot drift from the schema.
 *
 * These tests read prisma/schema.prisma directly, so adding a model without
 * classifying it is a failing build rather than a silent hole in the
 * chokepoint. That is the whole mechanism — not the lists themselves.
 */

type ParsedModel = { name: string; hasInstitutionId: boolean }

function parseSchemaModels(): ParsedModel[] {
  // Anchored on this file, not on process.cwd(). This is the only filesystem
  // read in src/, and it is the guard that a new Prisma model cannot be added
  // without being classified here — so it must not quietly ENOENT the first
  // time jest is invoked from the monorepo root instead of from apps/web.
  const schema = readFileSync(
    join(__dirname, "..", "..", "..", "prisma", "schema.prisma"),
    "utf8",
  )
  const models: ParsedModel[] = []

  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.push({
      name: match[1],
      hasInstitutionId: /^\s*institutionId\s/m.test(match[2]),
    })
  }
  return models
}

describe("the registry matches prisma/schema.prisma", () => {
  const schemaModels = parseSchemaModels()

  it("parses the schema at all", () => {
    // Guards the rest of this file: a broken regex would make every assertion
    // below vacuously pass over an empty list.
    expect(schemaModels.length).toBeGreaterThan(30)
    expect(schemaModels.map((m) => m.name)).toContain("Organization")
  })

  it("classifies every model in the schema", () => {
    const registered = new Set(allRegisteredModels())
    const unclassified = schemaModels.map((m) => m.name).filter((n) => !registered.has(n))

    expect(unclassified).toEqual([])
  })

  it("does not classify models that no longer exist", () => {
    const inSchema = new Set(schemaModels.map((m) => m.name))
    const stale = allRegisteredModels().filter((n) => !inSchema.has(n))

    expect(stale).toEqual([])
  })

  it("puts every model in exactly one bucket", () => {
    const all = allRegisteredModels()
    const duplicates = all.filter((n, i) => all.indexOf(n) !== i)

    expect(duplicates).toEqual([])
  })

  // The load-bearing one. If a model carries institutionId, the query layer can
  // and therefore must filter on it — leaving it out would be a scoped model
  // the chokepoint silently ignores.
  it("treats every model carrying institutionId as tenant-scoped", () => {
    const shouldBeScoped = schemaModels.filter((m) => m.hasInstitutionId).map((m) => m.name)
    const missing = shouldBeScoped.filter((n) => !isTenantScoped(n))

    expect(missing).toEqual([])
  })

  // The inverse: nothing may claim to be enforceable without the column that
  // makes enforcement possible.
  it("does not claim to scope a model that has no institutionId", () => {
    const withColumn = new Set(schemaModels.filter((m) => m.hasInstitutionId).map((m) => m.name))
    const lying = TENANT_SCOPED.filter((n) => !withColumn.has(n))

    expect(lying).toEqual([])
  })

  it("counts what we expect today", () => {
    // A tripwire, not a spec: if these move, the change was intentional and
    // this number should be updated deliberately along with the reasoning.
    expect(TENANT_SCOPED).toHaveLength(15)
    expect(PLATFORM_GLOBAL).toHaveLength(5)
    expect(Object.keys(UNENFORCEABLE)).toHaveLength(19)
    expect(schemaModels).toHaveLength(39)
  })
})

describe("classification helpers", () => {
  it("identifies tenant-scoped models", () => {
    expect(isTenantScoped("Organization")).toBe(true)
    expect(isTenantScoped("User")).toBe(false)
    expect(isTenantScoped(undefined)).toBe(false)
  })

  it("identifies platform-global models", () => {
    expect(isPlatformGlobal("User")).toBe(true)
    expect(isPlatformGlobal("Organization")).toBe(false)
  })

  it("treats an unknown model as neither", () => {
    // Matters because the extension decides what to do from these two answers;
    // an unknown model must not accidentally read as global.
    expect(isTenantScoped("NotAModel")).toBe(false)
    expect(isPlatformGlobal("NotAModel")).toBe(false)
  })

  it("records how each unenforceable model reaches its tenant", () => {
    for (const [model, info] of Object.entries(UNENFORCEABLE)) {
      expect(info.reachableVia).toBeTruthy()
      expect(typeof info.reachableVia).toBe("string")
      expect(model).not.toBe("")
    }
  })
})
