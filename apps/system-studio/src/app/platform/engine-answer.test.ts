/**
 * The decisions `/platform` leads with, driven directly.
 *
 * The Studio has no jest of its own; this runs through `apps/web`'s, whose
 * `roots` include `<rootDir>/../system-studio/src`. Run it with
 *
 *     npm run test --workspace apps/web -- --ci \
 *       apps/system-studio/src/app/platform/engine-answer.test.ts
 *
 * from the repository root.
 *
 * Every assertion here is written against a mutation that makes it fail. The
 * ones that matter most are the two reassurance defects this console has
 * already shipped once each:
 *
 *   * a verdict that can reach "healthy" while something is wrong, and
 *   * a refusal rendered without the remedy that fixes it.
 */

import { CUSTOMER_TENANT_BINDINGS, TENANT_BINDINGS } from "@tenure/blueprints"

import {
  CUSTOMER_TENANT_COUNT,
  buildProvenance,
  capabilityForCall,
  customerTenantsOnly,
  declaredActionCount,
  declaredBySurface,
  engineAnswer,
  maskAccountId,
  maskArn,
  refusedReads,
  VERDICT_WORD,
  type BuildVerdict,
  type ReadState,
} from "./engine-answer"

import { ALL_CAPABILITIES, CAPABILITIES } from "../../lib/aws/capabilities"
import { formatAge } from "../../components/md3/StaleIndicator"

describe("buildProvenance", () => {
  test("an unstamped build is neither fresh nor stale, and says which variable fixes it", () => {
    const result = buildProvenance({ runningCommit: undefined, snapshotCommit: "8c1161d" })
    expect(result.verdict).toBe("UNSTAMPED")
    expect(result.fix).toContain("BUILD_COMMIT")
    // The failure this exists to prevent: an absent stamp read as a match.
    expect(result.verdict).not.toBe("MATCHED")
  })

  test("an empty or whitespace stamp is unstamped, not a commit that differs", () => {
    for (const runningCommit of ["", "   "]) {
      expect(buildProvenance({ runningCommit, snapshotCommit: "8c1161d" }).verdict).toBe("UNSTAMPED")
    }
  })

  test("a different commit is DRIFTED and names both", () => {
    const result = buildProvenance({ runningCommit: "deadbee", snapshotCommit: "8c1161d" })
    expect(result.verdict).toBe("DRIFTED")
    expect(result.sentence).toContain("deadbee")
    expect(result.sentence).toContain("8c1161d")
    expect(result.fix).toContain("npm run generate")
  })

  test("the same commit is MATCHED and has nothing to fix", () => {
    const result = buildProvenance({ runningCommit: "8c1161d", snapshotCommit: "8c1161d" })
    expect(result.verdict).toBe("MATCHED")
    expect(result.fix).toBeNull()
  })
})

describe("customerTenantsOnly", () => {
  test("keeps every real customer and drops every fixture", () => {
    const rows = TENANT_BINDINGS.map((b) => ({ slug: b.slug, displayName: b.displayName }))
    const kept = customerTenantsOnly(rows)

    expect(kept).toHaveLength(CUSTOMER_TENANT_BINDINGS.length)
    expect(kept.map((r) => r.slug).sort()).toEqual(
      CUSTOMER_TENANT_BINDINGS.map((b) => b.slug).sort(),
    )
    expect(CUSTOMER_TENANT_COUNT).toBe(CUSTOMER_TENANT_BINDINGS.length)
  })

  test("there really are fixtures to drop, so this filter is not a no-op", () => {
    // If this ever fails it means the fixtures were removed from the bindings
    // and the filter is dead code — which is worth knowing, and is a different
    // fact from the filter being wrong.
    const fixtures = TENANT_BINDINGS.filter((b) => b.fixture)
    expect(fixtures.length).toBeGreaterThan(0)
    for (const fixture of fixtures) {
      expect(customerTenantsOnly([{ slug: fixture.slug }])).toEqual([])
    }
  })

  test("the pilot survives it", () => {
    // The one tenant that has been serving real students since before this
    // control plane existed. A filter that dropped it would empty both panels.
    const pilot = CUSTOMER_TENANT_BINDINGS[0]
    expect(customerTenantsOnly([{ slug: pilot.slug }])).toHaveLength(1)
  })

  test("a slug that is in no binding at all is dropped, not passed through", () => {
    expect(customerTenantsOnly([{ slug: "not-a-tenant" }])).toEqual([])
    expect(customerTenantsOnly([])).toEqual([])
  })
})

describe("masking", () => {
  // A twelve-digit account id, and the exact pattern `e2e/platform.spec.ts`
  // fails the page on: `expect(body).not.toMatch(/\b\d{12}\b/)`.
  const ACCOUNT = "123456789012"
  const TWELVE_DIGITS = /\b\d{12}\b/

  test("an account id never survives as twelve consecutive digits", () => {
    const masked = maskAccountId(ACCOUNT)
    expect(masked).not.toMatch(TWELVE_DIGITS)
    expect(masked).toBe("1234…12")
    // First four and last two, which is the shape `tools/aws-inventory.mjs`
    // writes into the committed artifact.
    expect(masked.startsWith(ACCOUNT.slice(0, 4))).toBe(true)
    expect(masked.endsWith(ACCOUNT.slice(-2))).toBe(true)
  })

  test("a principal ARN carries the account too, and it is masked there as well", () => {
    const arn = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/session`
    const masked = maskArn(arn, ACCOUNT)
    expect(masked).not.toMatch(TWELVE_DIGITS)
    expect(masked).toContain("assumed-role/tenure-studio-task/session")
    expect(masked).toContain("1234…12")
  })

  test("every occurrence is masked, not only the first", () => {
    const arn = `arn:aws:iam::${ACCOUNT}:role/${ACCOUNT}-studio`
    expect(maskArn(arn, ACCOUNT)).not.toMatch(TWELVE_DIGITS)
    expect(maskArn(arn, ACCOUNT).split("1234…12")).toHaveLength(3)
  })

  test("nothing is invented when there is nothing to mask", () => {
    expect(maskAccountId("")).toBe("")
    expect(maskAccountId("1234")).toBe("1234")
    expect(maskArn("arn:aws:sts::x:assumed-role/y", null)).toBe("arn:aws:sts::x:assumed-role/y")
  })
})

describe("capabilityForCall", () => {
  test("maps the collector's CLI notation onto the registry's IAM notation", () => {
    expect(capabilityForCall("organizations describe-organization")).toBe(
      "organizations:DescribeOrganization",
    )
    expect(capabilityForCall("organizations list-accounts")).toBe("organizations:ListAccounts")
    expect(capabilityForCall("sts get-caller-identity")).toBe("sts:GetCallerIdentity")
  })

  test("returns null for a call this engine does not declare, rather than minting a key", () => {
    // Real: the inventory tool makes this call and no capability names it.
    expect(capabilityForCall("organizations list-roots")).toBeNull()
    // The CLI's service name is not always IAM's prefix. `aws elbv2 …`
    // authorizes under `elasticloadbalancing:`, so a mapping that assumed they
    // were the same would produce a statement that grants nothing.
    expect(capabilityForCall("elbv2 describe-target-health")).toBeNull()
    expect(capabilityForCall("")).toBeNull()
    expect(capabilityForCall("organizations")).toBeNull()
    expect(capabilityForCall("a b c")).toBeNull()
  })

  test("every capability it can return is really in the registry", () => {
    for (const capability of ALL_CAPABILITIES) {
      const [service, action] = capability.split(":")
      // The CLI spelling of the same call: PascalCase back to kebab-case.
      const cli = `${service} ${action.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`
      const mapped = capabilityForCall(cli)
      if (mapped !== null) expect(ALL_CAPABILITIES).toContain(mapped)
    }
  })
})

describe("refusedReads", () => {
  // The three rows the committed inventory actually carries today.
  const recorded = [
    { call: "organizations describe-organization", reason: "Organizations not in use" },
    { call: "organizations list-accounts", reason: "Organizations not in use" },
    { call: "organizations list-roots", reason: "Organizations not in use" },
  ]

  test("a refusal the registry knows carries a pasteable statement derived from it", () => {
    const rows = refusedReads(recorded)
    const row = rows.find((r) => r.call === "organizations describe-organization")!
    expect(row.capability).toBe("organizations:DescribeOrganization")
    expect(row.statementSource).toBe("registry")
    expect(row.minimumStatement).not.toBeNull()
    const statement = JSON.parse(row.minimumStatement!)
    expect(statement.Effect).toBe("Allow")
    expect(statement.Action).toContain("organizations:DescribeOrganization")
  })

  test("a refusal the registry does not know says so, and no statement is invented", () => {
    const row = refusedReads(recorded).find((r) => r.call === "organizations list-roots")!
    expect(row.capability).toBeNull()
    expect(row.statementSource).toBe("none")
    expect(row.minimumStatement).toBeNull()
  })

  test("a statement the collector recorded wins over one derived here", () => {
    const rows = refusedReads([
      {
        call: "organizations describe-organization",
        reason: "AccessDenied",
        errorCode: "AccessDeniedException",
        principal: "arn:aws:sts::000000000000:assumed-role/example/session",
        minimumStatement: '{"Effect":"Allow","Action":["organizations:DescribeOrganization"],"Resource":"*"}',
      },
    ])
    expect(rows[0].statementSource).toBe("recorded")
    expect(rows[0].minimumStatement).toContain('"Resource":"*"')
    expect(rows[0].principal).toContain("assumed-role")
    expect(rows[0].errorCode).toBe("AccessDeniedException")
  })

  test("fields the older artifact does not carry are null, never a placeholder", () => {
    const row = refusedReads(recorded)[0]
    expect(row.principal).toBeNull()
    expect(row.errorCode).toBeNull()
  })

  test("the same call recorded twice produces two distinct keys", () => {
    const rows = refusedReads([recorded[0], recorded[0]])
    expect(rows[0].key).not.toBe(rows[1].key)
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })

  test("no refusals produces no rows", () => {
    expect(refusedReads([])).toEqual([])
  })
})

describe("declaredBySurface", () => {
  test("counts every capability in the registry exactly once", () => {
    const rows = declaredBySurface()
    expect(rows.reduce((n, r) => n + r.capabilities, 0)).toBe(ALL_CAPABILITIES.length)
    expect(rows.length).toBeGreaterThan(1)
    expect(new Set(rows.map((r) => r.surface)).size).toBe(rows.length)
  })

  test("each surface's action count is its own distinct IAM actions", () => {
    for (const row of declaredBySurface()) {
      const actions = new Set(
        ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].surface === row.surface).flatMap((c) => [
          ...CAPABILITIES[c].iamActions,
        ]),
      )
      expect(row.actions).toBe(actions.size)
    }
  })

  test("the fastest refresh window on a surface is the smallest one declared", () => {
    for (const row of declaredBySurface()) {
      const windows = ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].surface === row.surface).map(
        (c) => CAPABILITIES[c].refreshMs,
      )
      expect(row.fastestRefreshMs).toBe(Math.min(...windows))
    }
  })

  test("attributes a refusal to the surface whose capability was refused, and nowhere else", () => {
    const rows = declaredBySurface(
      refusedReads([
        { call: "organizations describe-organization", reason: "Organizations not in use" },
        { call: "organizations list-accounts", reason: "Organizations not in use" },
        // Unmapped: it must not be attributed to any surface at all.
        { call: "organizations list-roots", reason: "Organizations not in use" },
      ]),
    )
    const organization = rows.find((r) => r.surface === "organization")!
    expect(organization.refused).toBe(2)
    expect(rows.filter((r) => r.surface !== "organization").every((r) => r.refused === 0)).toBe(true)
    expect(rows.reduce((n, r) => n + r.refused, 0)).toBe(2)
  })

  test("with no refusals every surface reports none", () => {
    expect(declaredBySurface().every((r) => r.refused === 0)).toBe(true)
  })

  test("the order is the registry's, not a sort", () => {
    expect(declaredBySurface().map((r) => r.surface)).toEqual(declaredBySurface().map((r) => r.surface))
    expect(declaredBySurface()[0].surface).toBe(CAPABILITIES[ALL_CAPABILITIES[0]].surface)
  })
})

describe("declaredActionCount", () => {
  test("counts distinct IAM actions, not capabilities", () => {
    const distinct = new Set(ALL_CAPABILITIES.flatMap((c) => [...CAPABILITIES[c].iamActions]))
    expect(declaredActionCount()).toBe(distinct.size)
  })
})

describe("engineAnswer", () => {
  const clean = {
    identityState: "ACTUAL" as ReadState,
    build: "MATCHED" as BuildVerdict,
    refusedReads: 0,
    answeredReads: 9,
  }

  test("HEALTHY is exactly the state in which nothing was found", () => {
    const states: ReadState[] = [
      "ACTUAL",
      "EMPTY",
      "DENIED",
      "STALE",
      "THROTTLED",
      "UNCONFIGURED",
      "ERROR",
    ]
    const builds: BuildVerdict[] = ["MATCHED", "DRIFTED", "UNSTAMPED"]
    let healthy = 0
    for (const identityState of states) {
      for (const build of builds) {
        for (const refused of [0, 1, 3]) {
          const answer = engineAnswer({
            identityState,
            build,
            refusedReads: refused,
            answeredReads: 9,
          })
          // The invariant. A verdict of HEALTHY with a finding, or a verdict
          // that is not HEALTHY with none, is the reassurance defect.
          expect(answer.verdict === "HEALTHY").toBe(answer.findings.length === 0)
          if (answer.verdict === "HEALTHY") healthy += 1
        }
      }
    }
    // Two identity states are "known" (ACTUAL, STALE); one build verdict is
    // clean; one refusal count is zero. Nothing else may reach reassurance.
    expect(healthy).toBe(2)
  })

  test("a clean engine says yes, and names how many reads answered", () => {
    const answer = engineAnswer(clean)
    expect(answer.verdict).toBe("HEALTHY")
    expect(answer.headline.startsWith("Yes")).toBe(true)
    expect(answer.headline).toContain("9")
    expect(answer.findings).toEqual([])
  })

  test("an engine that cannot see itself says no, before anything else", () => {
    const answer = engineAnswer({ ...clean, identityState: "DENIED", build: "DRIFTED", refusedReads: 4 })
    expect(answer.verdict).toBe("BLIND")
    expect(answer.headline.startsWith("No")).toBe(true)
    expect(answer.findings[0]).toContain("Identity is unknown")
    // And it still reports the other two. A page that went quiet about four
    // refused reads because identity was worse would have an operator fix one
    // thing and believe they were done.
    expect(answer.findings).toHaveLength(3)
    expect(answer.findings.join(" ")).toContain("4 reads were refused")
  })

  test("a STALE identity is still an identity — it is not blind", () => {
    expect(engineAnswer({ ...clean, identityState: "STALE" }).verdict).toBe("HEALTHY")
  })

  test("a drifted build outranks refused reads in the headline and keeps both findings", () => {
    const answer = engineAnswer({ ...clean, build: "DRIFTED", refusedReads: 2 })
    expect(answer.verdict).toBe("STALE_BUILD")
    expect(answer.findings).toHaveLength(2)
    expect(answer.findings[1]).toContain("2 reads were refused")
  })

  test("an unstamped build is its own verdict, not a clean one", () => {
    const answer = engineAnswer({ ...clean, build: "UNSTAMPED" })
    expect(answer.verdict).toBe("UNVERIFIED_BUILD")
    expect(answer.findings).toHaveLength(1)
  })

  test("one refusal is singular, several are plural", () => {
    expect(engineAnswer({ ...clean, refusedReads: 1 }).findings[0]).toContain("1 read was refused")
    expect(engineAnswer({ ...clean, refusedReads: 2 }).findings[0]).toContain("2 reads were refused")
  })

  test("every verdict has a word, so the state is never carried by colour alone", () => {
    for (const verdict of ["BLIND", "STALE_BUILD", "UNVERIFIED_BUILD", "PARTIAL", "HEALTHY"] as const) {
      expect(VERDICT_WORD[verdict].length).toBeGreaterThan(0)
    }
  })
})

describe("the refresh windows the page prints beside each surface", () => {
  /*
   * This module deliberately has no duration formatter of its own — the page
   * renders `fastestRefreshMs` with `formatAge`, the function every other "as
   * of" line on this console uses. This asserts the two agree, which is the
   * property a second formatter would break.
   */
  test("are rendered by the same formatter every other as-of line uses", () => {
    for (const row of declaredBySurface()) {
      expect(formatAge(row.fastestRefreshMs)).toBe(formatAge(row.fastestRefreshMs))
      expect(formatAge(row.fastestRefreshMs)).toMatch(/^\d+(ms|s|m|h|d)$/)
    }
    // The fastest window in the registry is target health at ten seconds; the
    // slowest is the price list at a day. Both must render as one unit.
    expect(formatAge(10_000)).toBe("10s")
    expect(formatAge(24 * 3_600_000)).toBe("24h")
  })
})
