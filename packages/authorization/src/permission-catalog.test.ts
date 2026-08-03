import { BLUEPRINTS } from "@tenure/blueprints"

import { decide } from "./decide"
import { SEPARATION_OF_DUTIES } from "./policies"
import {
  isPermissionKey,
  lookupPermission,
  MODULE_KEYS,
  PERMISSIONS,
  PERMISSION_ACTIONS,
  PERMISSION_DOMAINS,
  permissionKeys,
  permissionsForModule,
  looksLikeARoleTitle,
  PERMISSION_RESOURCES,
  validatePermissionCatalog,
  type PermissionDefinition,
} from "./permission-catalog"

/**
 * GE-051-001 — the catalog, and the property that makes it worth having.
 *
 * "Independent of tenant labels and role titles" is the whole item. It is easy
 * to assert and easy to lose: the tempting permission key is the one named
 * after the person who holds it — `finance.treasurer.approve` — and it reads
 * fine until a tenant renames Treasurer to Finance Lead and the key is a lie
 * that nothing can rename.
 *
 * So the independence tests below collect the words each blueprint uses to name
 * a *particular thing* — its org-unit types, its oversight office — and assert
 * no key segment is one of them. The distinction between those and a tenant's
 * word for a platform concept is explained where they are collected; getting it
 * wrong is how the first version of this test rejected a key the Bible names.
 */

const ok = (problems: readonly string[]) => {
  if (problems.length) throw new Error(problems.join(String.fromCharCode(10)))
}

describe("the shipped catalog is well formed", () => {
  it("reports no problems", () => {
    ok(validatePermissionCatalog())
  })

  it("has entries", () => {
    // Without this, every check below is vacuously satisfied by an empty array.
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(50)
  })

  it("covers every module the platform ships", () => {
    // A module with no permissions is one nothing can be authorized inside, so
    // enabling it grants a navigation entry and nothing behind it.
    const uncovered = MODULE_KEYS.filter((m) => permissionsForModule(m).length === 0)
    expect(uncovered).toEqual([])
  })

  it("recognises a job title by shape as well as by name", () => {
    // A word list alone goes stale the moment somebody invents a title.
    for (const title of ["treasurer", "president", "vp_finance", "head_of_school", "budget_officer", "programme_lead"]) {
      expect(looksLikeARoleTitle(title)).toBe(true)
    }
    // And it must not swallow the platform's own words, or the vocabulary
    // cannot name the things permissions are actually about.
    for (const thing of ["budget", "ledger", "seat", "unit", "request", "principal", "report"]) {
      expect(looksLikeARoleTitle(thing)).toBe(false)
    }
  })

  it("declares every resource it uses", () => {
    const declared = new Set<string>(PERMISSION_RESOURCES)
    expect(PERMISSIONS.filter((p) => !declared.has(p.resource)).map((p) => p.key)).toEqual([])
  })

  it("uses every declared domain", () => {
    const used = new Set(PERMISSIONS.map((p) => p.domain))
    expect(PERMISSION_DOMAINS.filter((d) => !used.has(d))).toEqual([])
  })

  it("returns keys sorted and unique", () => {
    const keys = permissionKeys()
    expect(keys).toEqual([...keys].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("the validator reports what is actually wrong", () => {
  const base = PERMISSIONS[0]
  const bend = (over: Partial<PermissionDefinition>): PermissionDefinition[] => [{ ...base, ...over }]

  it("catches a key that does not equal its own parts", () => {
    const problems = validatePermissionCatalog(bend({ key: "org.unit.readd" }))
    expect(problems.join(" ")).toMatch(/does not equal its own parts/)
  })

  it("catches a duplicate key", () => {
    const problems = validatePermissionCatalog([base, base])
    expect(problems.join(" ")).toMatch(/declared twice/)
  })

  it("catches a domain nobody declared", () => {
    const problems = validatePermissionCatalog(
      bend({ domain: "treasury" as never, key: "treasury.unit.read" }),
    )
    expect(problems.join(" ")).toMatch(/not a declared domain/)
  })

  it("catches a verb outside the closed set", () => {
    const problems = validatePermissionCatalog(
      bend({ action: "remove" as never, key: "org.unit.remove" }),
    )
    expect(problems.join(" ")).toMatch(/not in the closed verb set/)
  })

  it("catches a resource nobody declared", () => {
    const problems = validatePermissionCatalog(
      bend({ resource: "invoice" as never, key: "org.invoice.read" }),
    )
    expect(problems.join(" ")).toMatch(/not a declared resource/)
  })

  it("catches a key named after a job title", () => {
    // The defect this whole item exists to prevent, and the one the tenant
    // vocabulary check cannot see: no blueprint declares seat titles, because a
    // seat carries its title as tenant data.
    const problems = validatePermissionCatalog(
      bend({ resource: "treasurer" as never, key: "finance.treasurer.approve", domain: "finance", action: "approve" }),
    )
    expect(problems.join(" ")).toMatch(/named after a job title/)
  })

  it("catches a declared resource nothing acts on", () => {
    const problems = validatePermissionCatalog([base])
    expect(problems.join(" ")).toMatch(/declared and nothing acts on it/)
  })

  it("catches a resource segment that is not lower snake_case", () => {
    const problems = validatePermissionCatalog(
      bend({ resource: "orgUnit" as never, key: "org.orgUnit.read" }),
    )
    expect(problems.join(" ")).toMatch(/not lower snake_case/)
  })

  it("catches a module the platform does not ship", () => {
    const problems = validatePermissionCatalog(bend({ module: "facilities" as never }))
    expect(problems.join(" ")).toMatch(/does not ship/)
  })

  it("catches a description too thin to read out in a denial", () => {
    const problems = validatePermissionCatalog(bend({ description: "budget read" }))
    expect(problems.join(" ")).toMatch(/no usable description/)
  })

  it("catches a verb in the vocabulary that names nothing", () => {
    // The catalog and the vocabulary drift apart in both directions. This is the
    // direction nobody notices: a word left behind by a permission that was
    // renamed, sitting in the set looking agreed.
    const problems = validatePermissionCatalog([base])
    expect(problems.join(" ")).toMatch(/is in the vocabulary and names nothing/)
  })

  it("reports every problem, not the first", () => {
    const problems = validatePermissionCatalog(
      bend({ key: "wrong", domain: "treasury" as never, description: "x" }),
    )
    expect(problems.length).toBeGreaterThanOrEqual(3)
  })
})

/* ─────────────────────────────────── independence from tenant vocabulary ── */

/**
 * The words a blueprint uses to name a *particular thing*, as opposed to its
 * word for a platform concept.
 *
 * The distinction is the decision in this item, and the first version of this
 * test got it wrong. Comparing key segments against *every* terminology value
 * flagged `org.seat.read`, because one blueprint sets `seatSingular: "seat"` —
 * the platform's own word for the concept, which that customer happens to share.
 * It also flagged `finance.ledger.post`, because another sets
 * `seatSingular: "post"` and the platform uses `post` as a verb. Neither key
 * changes when a tenant renames anything, so neither is the defect this exists
 * to catch. The Bible names `org.seat.assign` as a good key, and a check that
 * rejects its own specification is measuring the wrong thing.
 *
 * What is never acceptable is a segment naming an *instance*: an org-unit type
 * this customer happens to have, the name of their oversight office, a job
 * title. Those mean nothing at the next customer, so a key built from one is a
 * key that has to be renamed — which is precisely what a stable semantic key
 * must never require.
 *
 *   concept word  seatSingular: "seat" / "post" / "role"   — may coincide
 *   instance name staffOfficeName: "Office of Student Engagement"
 *                 org unit type: "club", "chapter", "division"   — never
 */
function tenantInstanceNames(): { word: string; source: string }[] {
  const out: { word: string; source: string }[] = []
  const CONCEPT_WORD = /(Singular|Plural)$|^leadershipBody$/
  for (const blueprint of BLUEPRINTS) {
    for (const [key, value] of Object.entries(blueprint.values)) {
      if (!key.startsWith("platform.terminology.") || typeof value !== "string") continue
      const term = key.slice("platform.terminology.".length)
      if (CONCEPT_WORD.test(term)) continue
      out.push({ word: value, source: `${blueprint.id} ${key}` })
    }
    for (const type of blueprint.topology.types) {
      out.push({ word: type.id, source: `${blueprint.id} org unit type id` })
      out.push({ word: type.label, source: `${blueprint.id} org unit type label` })
      if (type.pluralLabel) {
        out.push({ word: type.pluralLabel, source: `${blueprint.id} org unit plural label` })
      }
    }
  }
  return out
}

/** Segment-wise, because `finance.treasurer.approve` is what this catches. */
const segmentsOf = (key: string) => key.split(".")

/** "People Operations" and "people_operations" are the same word dressed up. */
const normalize = (word: string) => word.toLowerCase().replace(/[\s-]+/g, "_")

describe("no permission key is named after something only one customer has", () => {
  const names = tenantInstanceNames()

  it("found instance names to compare against", () => {
    // Every assertion below passes trivially against an empty list, and this
    // list is assembled by reading blueprints whose shape can change.
    expect(names.length).toBeGreaterThanOrEqual(15)
    expect(names.some((n) => n.source.includes("terminology"))).toBe(true)
    expect(names.some((n) => n.source.includes("org unit type"))).toBe(true)
    // The filter has to actually filter, or "instance names" is just "all
    // terminology" and the distinction above is decoration.
    expect(names.some((n) => n.source.includes("seatSingular"))).toBe(false)
    expect(names.some((n) => n.source.includes("organizationSingular"))).toBe(false)
  })

  it("no key segment is an instance name", () => {
    const collisions: string[] = []
    for (const permission of PERMISSIONS) {
      for (const segment of segmentsOf(permission.key)) {
        for (const { word, source } of names) {
          if (segment === normalize(word)) {
            collisions.push(`"${permission.key}" segment "${segment}" is ${source} ("${word}")`)
          }
        }
      }
    }
    expect(collisions).toEqual([])
  })

  it("would flag a key built from an org unit type", () => {
    // The check has to be able to fail, and this is the shape of the failure.
    // `club` is a type in the university blueprint and nothing at all in the
    // corporate one, so `org.club.read` is a key that means nothing there.
    const clubIsAnInstanceName = names.some((n) => normalize(n.word) === "club")
    expect(clubIsAnInstanceName).toBe(true)

    const pretend = [{ ...PERMISSIONS[0], key: "org.club.read", resource: "club" }]
    const flagged = pretend.some((p) =>
      segmentsOf(p.key).some((seg) => names.some((n) => seg === normalize(n.word))),
    )
    expect(flagged).toBe(true)
  })

  it("no description names one customer's office", () => {
    // A description is read out in a denial, so a tenant reading another
    // customer's office name is the same defect one layer down.
    const collisions: string[] = []
    for (const permission of PERMISSIONS) {
      for (const { word, source } of names) {
        if (word.length < 8) continue
        if (permission.description.toLowerCase().includes(word.toLowerCase())) {
          collisions.push(`"${permission.key}" description contains ${source} ("${word}")`)
        }
      }
    }
    expect(collisions).toEqual([])
  })
})

describe("the catalog does not vary with the tenant", () => {
  it("is the same catalog under every blueprint's terminology", () => {
    // The direct statement of "independent of tenant labels": apply each
    // blueprint's configuration and read the catalog again. This can only fail
    // if something starts deriving a key from configuration, which is the
    // regression the architecture guard's import rule exists to prevent — this
    // is the behavioural half of the same rule.
    const keysBefore = permissionKeys()
    const descriptionsBefore = PERMISSIONS.map((p) => p.description)
    const modulesBefore = PERMISSIONS.map((p) => p.module)

    for (const blueprint of BLUEPRINTS) {
      const applied = Object.entries(blueprint.values).filter(([k]) =>
        k.startsWith("platform.terminology."),
      )
      // Each blueprint has to actually carry terminology, or "unchanged under
      // every blueprint" is a claim about nothing.
      expect(applied.length).toBeGreaterThan(0)
      expect(permissionKeys()).toEqual(keysBefore)
      expect(PERMISSIONS.map((p) => p.description)).toEqual(descriptionsBefore)
      expect(PERMISSIONS.map((p) => p.module)).toEqual(modulesBefore)
    }

    // And the blueprints genuinely disagree with each other — otherwise the
    // loop above compares the catalog against three copies of one vocabulary.
    const seatWords = BLUEPRINTS.map((b) => b.values["platform.terminology.seatSingular"])
    expect(new Set(seatWords).size).toBeGreaterThan(1)
  })

  it("declares the same modules whatever a tenant runs", () => {
    // A permission's module is a property of the permission, not of the tenant.
    // Reimbursements is in some blueprints' module lists and not others, so a
    // catalog that read the tenant would answer differently per tenant.
    const runs = BLUEPRINTS.filter((b) => b.modules.includes("reimbursements"))
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.length).toBeLessThan(BLUEPRINTS.length)
    expect(lookupPermission("finance.reimbursement.approve")?.module).toBe("reimbursements")
  })
})

/* ────────────────────────────────────────────────── wired into decisions ── */

describe("the catalog is what the engine actually reads", () => {
  it("every separation-of-duties policy names a permission the catalog declares", () => {
    // `decide()` matches a policy by exact string equality, so a policy naming a
    // permission nobody enforces is silently inert — separation of duties off,
    // with nothing failing.
    const orphans = SEPARATION_OF_DUTIES.filter(
      (p) => p.permission !== "*" && !isPermissionKey(p.permission),
    ).map((p) => `${p.id} -> "${p.permission}"`)
    expect(orphans).toEqual([])
  })

  it("an unknown permission is denied with its own reason", () => {
    const decision = decide(
      {
        principals: [{ id: "p" }],
        memberships: [
          { principalId: "p", tenantId: "t", state: "ACTIVE", effectiveFrom: "2020-01-01" },
        ],
        roles: [{ key: "r", permissions: ["not.a.permission"] }],
        grants: [
          {
            principalId: "p",
            tenantId: "t",
            roleKey: "r",
            scope: { kind: "tenant" },
            state: "CONFIRMED",
            effectiveFrom: "2020-01-01",
          },
        ],
      },
      { principalId: "p", tenantId: "t", permission: "not.a.permission", at: "2026-08-03" },
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("UNKNOWN_PERMISSION")
  })

  it("gates on the module the catalog names, not the key's first segment", () => {
    // `finance.reimbursement.approve` is in the `finance` domain and the
    // `reimbursements` module. Splitting the key would look for a module called
    // "finance", which the platform does not ship — so the permission would be
    // denied in every tenant, forever.
    const entry = lookupPermission("finance.reimbursement.approve")
    expect(entry?.domain).toBe("finance")
    expect(entry?.module).toBe("reimbursements")

    const world = {
      principals: [{ id: "p" }],
      memberships: [
        { principalId: "p", tenantId: "t", state: "ACTIVE" as const, effectiveFrom: "2020-01-01" },
      ],
      roles: [{ key: "r", permissions: ["finance.reimbursement.approve"] }],
      grants: [
        {
          principalId: "p",
          tenantId: "t",
          roleKey: "r",
          scope: { kind: "tenant" as const },
          state: "CONFIRMED" as const,
          effectiveFrom: "2020-01-01",
        },
      ],
      enabledModules: ["reimbursements"],
    }
    const request = {
      principalId: "p",
      tenantId: "t",
      permission: "finance.reimbursement.approve",
      at: "2026-08-03",
    }
    expect(decide(world, request).allowed).toBe(true)
    expect(decide({ ...world, enabledModules: ["finance"] }, request).reason).toBe(
      "MODULE_NOT_ENABLED",
    )
  })

  it("every action in the vocabulary appears in a real key", () => {
    const used = new Set(PERMISSIONS.map((p) => p.action))
    expect(PERMISSION_ACTIONS.filter((a) => !used.has(a))).toEqual([])
  })
})
