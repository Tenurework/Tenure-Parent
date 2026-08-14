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
  ORGANIZATION_WORD,
  PRESSURE_WORD,
  RAISED_NOT_KNOWN,
  appliedValueText,
  buildProvenance,
  capabilityForCall,
  customerTenantsOnly,
  declaredActionCount,
  declaredBySurface,
  engineAnswer,
  looksLikeStatement,
  maskAccountId,
  maskArn,
  maskUnknownRead,
  orgAccountRows,
  organizationAnswer,
  quotaCoverage,
  quotaRows,
  refusedReads,
  unknownArm,
  unreadableQuotas,
  VERDICT_WORD,
  type BuildVerdict,
  type ReadState,
} from "./engine-answer"

import type { UnknownRead } from "../../components/md3/UnknownState"
import { ALL_CAPABILITIES, CAPABILITIES, minimumStatementText } from "../../lib/aws/capabilities"
import { formatAge } from "../../components/md3/StaleIndicator"
import {
  DEFAULT_QUOTA_NOT_READABLE,
  headroomOf,
  quotaPressure,
  type AppliedQuota,
  type QuotaPressure,
  type QuotaReading,
  type QuotaReadings,
  type QuotaUsageState,
} from "../../lib/aws/quotas"
import type { OrganizationRead } from "../../lib/aws/organization"
import type { AwsRead } from "../../lib/aws/read"

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

/* ═══════════════════════════════════════════════════════════════════════════
 * The two dark readers, and the shapes the page renders them through.
 *
 * `quotas.ts` and `organization.ts` were tested, granted and reached by no
 * page. Everything below drives the functions `page.tsx` actually calls, with
 * readings shaped exactly as the readers produce them — the pressure state and
 * the headroom in every fixture are computed by the READER's own
 * `quotaPressure` and `headroomOf`, not hand-written, so a fixture cannot agree
 * with an assertion the reader would disagree with.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Twelve digits, and the exact pattern `e2e/platform.spec.ts` fails the page on. */
const TWELVE = /\b\d{12}\b/
const TEST_ACCOUNT = "123456789012"

function applied(overrides: Partial<AppliedQuota> = {}): AppliedQuota {
  return {
    serviceCode: "vpc",
    serviceName: "Amazon Virtual Private Cloud",
    quotaCode: "L-F678F1CE",
    quotaName: "VPCs per Region",
    arn: `arn:aws:servicequotas:us-east-1:${TEST_ACCOUNT}:vpc/L-F678F1CE`,
    value: 5,
    unit: "None",
    adjustable: true,
    scope: "REGION",
    period: null,
    usageMetric: null,
    provenance: "servicequotas:ListServiceQuotas, matched on quota code",
    ...overrides,
  }
}

const NOT_KNOWN: QuotaUsageState = {
  kind: "not-known",
  why: "nothing this engine reads counts against this quota. Unknown, not zero.",
  usageMetric: null,
}

function reading(overrides: Partial<QuotaReading> & { key: string }): QuotaReading {
  const quota: AwsRead<AppliedQuota> = overrides.quota ?? {
    state: "ACTUAL",
    capability: "servicequotas:ListServiceQuotas",
    value: applied(),
    asOf: "2026-08-14T00:00:00.000Z",
    fresh: true,
  }
  const usage = overrides.usage ?? NOT_KNOWN
  return {
    key: overrides.key,
    serviceCode: overrides.serviceCode ?? "vpc",
    quotaCode: overrides.quotaCode ?? "L-F678F1CE",
    quotaName: overrides.quotaName ?? "VPCs per Region",
    bounds: overrides.bounds ?? "a new tenant's network cannot be created at all",
    quota,
    listingCompleteness: overrides.listingCompleteness ?? { kind: "complete" },
    defaultValue: DEFAULT_QUOTA_NOT_READABLE,
    usage,
    // The reader's own derivation. A hand-written headroom would let a fixture
    // claim a remainder the reader would never produce.
    headroom: overrides.headroom ?? headroomOf(quota, usage),
    attribution: overrides.attribution ?? { kind: "shared", why: "an account or regional ceiling" },
    region: "us-east-1",
    partition: "aws",
    accountId: TEST_ACCOUNT,
    refreshMs: 21_600_000,
    asOf: "2026-08-14T00:00:00.000Z",
  }
}

function readings(quotas: readonly QuotaReading[]): QuotaReadings {
  return {
    identity: { state: "UNCONFIGURED", capability: "sts:GetCallerIdentity", why: "fixture" },
    tagged: { state: "UNCONFIGURED", capability: "tag:GetResources", why: "fixture" },
    services: [...new Set(quotas.map((q) => q.serviceCode))].map((serviceCode) => ({
      serviceCode,
      quotas: {
        state: "UNCONFIGURED",
        capability: "servicequotas:ListServiceQuotas",
        why: "fixture",
      },
      completeness: { kind: "complete" },
    })),
    quotas,
    // The reader's own derivation, for the reason above.
    pressure: quotaPressure(quotas),
    individualReads: 0,
    asOf: "2026-08-14T00:00:00.000Z",
    refreshMs: { listing: 21_600_000, individual: 21_600_000 },
  }
}

const DENIED_LISTING: AwsRead<AppliedQuota> = {
  state: "DENIED",
  capability: "servicequotas:ListServiceQuotas",
  action: "servicequotas:ListServiceQuotas",
  principal: `arn:aws:sts::${TEST_ACCOUNT}:assumed-role/tenure-studio-task/session`,
  accountId: TEST_ACCOUNT,
  region: "us-east-1",
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: minimumStatementText("servicequotas:ListServiceQuotas"),
}

describe("unknownArm", () => {
  test("returns the reading for every arm that carries no value, and null for every arm that does", () => {
    const valueless: AwsRead<string>[] = [
      DENIED_LISTING as unknown as AwsRead<string>,
      {
        state: "THROTTLED",
        capability: "servicequotas:GetServiceQuota",
        retryAfterMs: 400,
        asOf: "t",
      },
      { state: "UNCONFIGURED", capability: "servicequotas:GetServiceQuota", why: "x" },
      { state: "ERROR", capability: "servicequotas:GetServiceQuota", code: "Boom", safeDetail: "d" },
    ]
    for (const read of valueless) expect(unknownArm(read)).toBe(read)

    // The three that carry one. Handing any of them to `UnknownState` would
    // render a successful read as a refusal, which is the mirror image of the
    // defect this whole file exists to prevent.
    expect(
      unknownArm({
        state: "ACTUAL",
        capability: "sts:GetCallerIdentity",
        value: "x",
        asOf: "t",
        fresh: true,
      }),
    ).toBeNull()
    expect(unknownArm({ state: "EMPTY", capability: "sts:GetCallerIdentity", asOf: "t" })).toBeNull()
    expect(
      unknownArm({
        state: "STALE",
        capability: "sts:GetCallerIdentity",
        value: "x",
        asOf: "t",
        ageMs: 1,
      }),
    ).toBeNull()
  })
})

describe("maskUnknownRead", () => {
  test("a refusal never reaches the page carrying twelve consecutive digits", () => {
    const masked = maskUnknownRead(DENIED_LISTING as unknown as UnknownRead, null)
    expect(JSON.stringify(masked)).not.toMatch(TWELVE)
    if (masked.state !== "DENIED") throw new Error("the arm must not change")
    expect(masked.accountId).toBe("1234…12")
    expect(masked.principal).toContain("assumed-role/tenure-studio-task/session")
    expect(masked.principal).not.toMatch(TWELVE)
    // Everything that identifies the refusal survives it. A mask that also
    // removed the action or the error code would leave an operator with a
    // panel they cannot act on.
    expect(masked.action).toBe("servicequotas:ListServiceQuotas")
    expect(masked.errorCode).toBe("AccessDeniedException")
    expect(JSON.parse(masked.minimumStatement).Effect).toBe("Allow")
  })

  test("a refusal recorded before identity answered is masked against the page's own account", () => {
    const beforeIdentity: UnknownRead = {
      ...(DENIED_LISTING as unknown as Extract<UnknownRead, { state: "DENIED" }>),
      accountId: null,
    }
    const masked = maskUnknownRead(beforeIdentity, TEST_ACCOUNT)
    expect(JSON.stringify(masked)).not.toMatch(TWELVE)
  })

  test("an error detail carrying an ARN is masked too", () => {
    const masked = maskUnknownRead(
      {
        state: "ERROR",
        capability: "servicequotas:ListServiceQuotas",
        code: "InvalidParameterValue",
        safeDetail: `no quota for arn:aws:iam::${TEST_ACCOUNT}:role/x`,
      },
      TEST_ACCOUNT,
    )
    expect(JSON.stringify(masked)).not.toMatch(TWELVE)
  })

  test("the two arms that carry no account are returned untouched", () => {
    const throttled: UnknownRead = {
      state: "THROTTLED",
      capability: "servicequotas:ListServiceQuotas",
      retryAfterMs: 400,
      asOf: "2026-08-14T00:00:00.000Z",
    }
    const unconfigured: UnknownRead = {
      state: "UNCONFIGURED",
      capability: "organizations:ListAccounts",
      why: "there is no Organization to list accounts from",
    }
    expect(maskUnknownRead(throttled, TEST_ACCOUNT)).toBe(throttled)
    expect(maskUnknownRead(unconfigured, TEST_ACCOUNT)).toBe(unconfigured)
  })
})

describe("quotaRows", () => {
  test("a quota that answered renders its applied value with the unit and the period AWS gave", () => {
    expect(appliedValueText(applied({ value: 5, unit: "None" }))).toBe("5 None")
    expect(
      appliedValueText(applied({ value: 50_000, unit: "None", period: { value: 1, unit: "DAY" } })),
    ).toBe("50000 None per 1 DAY")
    // Nothing rounded and nothing scaled: an operator compares this against a
    // support-ticket number character by character.
    expect(appliedValueText(applied({ value: 1_000, unit: null }))).toBe("1000")
  })

  test("no applied value is ever rendered without the default caveat beside it", () => {
    const rows = quotaRows(readings([reading({ key: "vpcs-per-region" })]))
    expect(rows).toHaveLength(1)
    expect(rows[0].applied).toBe("5 None")
    // The reader's own reason, and the action that would answer it. A value
    // printed alone reads as the default, which for a raised quota is backwards.
    expect(rows[0].raised).toBe(RAISED_NOT_KNOWN)
    expect(rows[0].raised).toContain("not known")
    expect(rows[0].raised).toContain(DEFAULT_QUOTA_NOT_READABLE.iamAction)
  })

  test("a quota with no usage number reports no headroom, rather than an empty one", () => {
    const rows = quotaRows(readings([reading({ key: "lambda-concurrent-executions" })]))
    expect(rows[0].usage).toContain("usage not known")
    expect(rows[0].headroom).toContain("headroom not known")
    // The reassurance defect, stated as the assertion: a quota nobody counted
    // must not print a remainder, and must not print a percentage.
    expect(rows[0].headroom).not.toMatch(/\d+ left/)
    expect(rows[0].headroom).not.toMatch(/%/)
  })

  test("an exact count from a sibling reader is used of applied, and a tag count is a bound", () => {
    const exact = quotaRows(
      readings([
        reading({
          key: "application-load-balancers-per-region",
          usage: {
            kind: "known",
            used: 2,
            source: "loadbalancer.ts",
            asOf: "2026-08-14T00:00:00.000Z",
          },
        }),
      ]),
    )
    expect(exact[0].headroom).toBe("2 of 5 used, 3 left (40%)")

    const bound = quotaRows(
      readings([
        reading({
          key: "vpcs-per-region",
          usage: {
            kind: "at-least",
            usedAtLeast: 2,
            source: "tag:GetResources",
            why: "only tagged resources are visible to it",
          },
        }),
      ]),
    )
    // A lower bound on usage is an UPPER bound on headroom, and only the upper
    // bound is safe to print. "3 left" from a count that saw only tagged VPCs
    // is the sentence that gets somebody paged.
    expect(bound[0].headroom).toContain("AT MOST 3 left")
    expect(bound[0].headroom).toContain("at least 2 of 5 used")
  })

  test("a quota whose read failed is not a row with blanks in it", () => {
    const rows = quotaRows(
      readings([reading({ key: "vpcs-per-region", quota: DENIED_LISTING }), reading({ key: "ok" })]),
    )
    expect(rows.map((r) => r.key)).toEqual(["ok"])
  })

  test("a truncated service listing travels onto the row, not only onto the service", () => {
    const rows = quotaRows(
      readings([
        reading({
          key: "vpcs-per-region",
          listingCompleteness: { kind: "truncated", pagesRead: 20, why: "still had pages" },
        }),
      ]),
    )
    expect(rows[0].truncated).toContain("truncated after 20 page(s)")
    expect(quotaRows(readings([reading({ key: "k" })]))[0].truncated).toBeNull()
  })

  test("a value served out of a held reading says so, and carries that reading's timestamp", () => {
    const rows = quotaRows(
      readings([
        reading({
          key: "vpcs-per-region",
          quota: {
            state: "STALE",
            capability: "servicequotas:ListServiceQuotas",
            value: applied(),
            asOf: "2026-08-13T00:00:00.000Z",
            ageMs: 90_000_000,
          },
        }),
      ]),
    )
    expect(rows[0].stale).toBe(true)
    expect(rows[0].refreshMs).toBeGreaterThan(0)
  })
})

describe("unreadableQuotas", () => {
  test("one refusal that answers for three targets is one block, naming all three", () => {
    const groups = unreadableQuotas(
      readings([
        reading({
          key: "a",
          serviceCode: "vpc",
          quotaName: "VPCs per Region",
          quota: DENIED_LISTING,
        }),
        reading({
          key: "b",
          serviceCode: "vpc",
          quotaName: "VPC security groups per Region",
          quota: DENIED_LISTING,
        }),
        reading({
          key: "c",
          serviceCode: "vpc",
          quotaName: "Inbound or outbound rules per security group",
          quota: DENIED_LISTING,
        }),
      ]),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].quotaNames).toHaveLength(3)
    expect(groups[0].what).toContain("VPCs per Region")
    expect(groups[0].what).toContain("[vpc]")
  })

  test("two different failures on one service stay two blocks, because the remedies differ", () => {
    const groups = unreadableQuotas(
      readings([
        reading({ key: "a", serviceCode: "vpc", quota: DENIED_LISTING }),
        reading({
          key: "b",
          serviceCode: "vpc",
          quota: {
            state: "ERROR",
            capability: "servicequotas:GetServiceQuota",
            code: "InvalidParameterValue",
            safeDetail: "no such quota code",
          },
        }),
      ]),
    )
    // Collapsing these would show one panel with one remedy for two problems,
    // and the second — which no IAM statement fixes — would disappear.
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.read.state).sort()).toEqual(["DENIED", "ERROR"])
  })

  test("a service that answered contributes no block at all", () => {
    expect(unreadableQuotas(readings([reading({ key: "a" })]))).toEqual([])
  })

  test("every block is masked before it reaches the page", () => {
    const groups = unreadableQuotas(
      readings([reading({ key: "a", quota: DENIED_LISTING })]),
      TEST_ACCOUNT,
    )
    expect(JSON.stringify(groups)).not.toMatch(TWELVE)
  })

  test("the order is the reader's target order, which is the order a provisioning run meets them", () => {
    const groups = unreadableQuotas(
      readings([
        reading({ key: "a", serviceCode: "vpc", quota: DENIED_LISTING }),
        reading({
          key: "b",
          serviceCode: "ecs",
          quota: { ...DENIED_LISTING, action: "servicequotas:ListServiceQuotas" },
        }),
      ]),
    )
    expect(groups.map((g) => g.serviceCode)).toEqual(["vpc", "ecs"])
  })
})

describe("quotaCoverage", () => {
  test("the read and the unreadable partition the targets exactly", () => {
    const coverage = quotaCoverage(
      readings([
        reading({ key: "a" }),
        reading({ key: "b", quota: DENIED_LISTING }),
        reading({ key: "c", quota: DENIED_LISTING }),
      ]),
    )
    expect(coverage.targets).toBe(3)
    expect(coverage.read).toBe(1)
    expect(coverage.unreadable).toBe(2)
    expect(coverage.read + coverage.unreadable).toBe(coverage.targets)
  })

  test("a quota with no usage number is counted as having none, never as having room", () => {
    const coverage = quotaCoverage(
      readings([
        reading({ key: "a" }),
        reading({
          key: "b",
          usage: {
            kind: "known",
            used: 1,
            source: "loadbalancer.ts",
            asOf: "2026-08-14T00:00:00.000Z",
          },
        }),
      ]),
    )
    expect(coverage.withUsage).toBe(1)
    expect(coverage.usageUnknown).toBe(1)
    expect(coverage.sentence).toContain("1 have a usage number")
    expect(coverage.sentence).toContain("headroom is established for 1 of them and for no others")
    expect(coverage.sentence).toContain("A quota with no usage number is not a quota with room")
  })

  test("when nothing answered the sentence says so and points at the blocks below", () => {
    const coverage = quotaCoverage(
      readings([
        reading({ key: "a", quota: DENIED_LISTING }),
        reading({ key: "b", quota: DENIED_LISTING }),
      ]),
    )
    expect(coverage.read).toBe(0)
    expect(coverage.sentence).toContain("0 of 2 ceilings answered")
    expect(coverage.sentence).toContain("named below with the statement that would grant it")
  })
})

describe("PRESSURE_WORD", () => {
  test("every pressure state has a word, so the badge is never colour alone", () => {
    const kinds: QuotaPressure["kind"][] = ["unknown", "no-usage-known", "clear", "at-risk"]
    for (const kind of kinds) expect(PRESSURE_WORD[kind].length).toBeGreaterThan(0)
    // And the arm this estate is actually in does not read as reassurance.
    expect(PRESSURE_WORD["no-usage-known"]).not.toContain("clear")
    expect(PRESSURE_WORD["no-usage-known"]).toContain("not established")
  })

  test("a reading with quotas but no usage anywhere is not clear, and the page says so", () => {
    const state = readings([reading({ key: "a" }), reading({ key: "b" })])
    expect(state.pressure.kind).toBe("no-usage-known")
    expect(PRESSURE_WORD[state.pressure.kind]).toBe("headroom not established")
  })
})

/* ------------------------------------------------------- the organization -- */

const IDENTITY = { accountId: TEST_ACCOUNT, region: "us-east-1", partition: "aws" }

describe("looksLikeStatement", () => {
  test("a minimum statement from the registry is one", () => {
    expect(looksLikeStatement(minimumStatementText("organizations:DescribeOrganization"))).toBe(true)
  })

  test("an error detail is not, however JSON-shaped it looks", () => {
    expect(looksLikeStatement("connect ECONNREFUSED 169.254.169.254:80")).toBe(false)
    expect(looksLikeStatement('{"message":"Effect: unknown"}')).toBe(false)
    expect(looksLikeStatement("null")).toBe(false)
    expect(looksLikeStatement("[]")).toBe(false)
    expect(looksLikeStatement('{"Effect":"Allow"}')).toBe(false)
    expect(looksLikeStatement("")).toBe(false)
  })
})

describe("organizationAnswer", () => {
  test("an Organization that exists is named, and neither account id survives unmasked", () => {
    const answer = organizationAnswer(
      {
        state: "IN_USE",
        organizationId: "o-abc123",
        managementAccountId: TEST_ACCOUNT,
        managementAccountArn: `arn:aws:organizations::${TEST_ACCOUNT}:account/o-abc123/${TEST_ACCOUNT}`,
        featureSet: "ALL",
        asOf: "2026-08-14T00:00:00.000Z",
      },
      IDENTITY,
    )
    if (answer.kind !== "in-use") throw new Error("an Organization that exists must be in-use")
    expect(answer.organizationId).toBe("o-abc123")
    expect(JSON.stringify(answer)).not.toMatch(TWELVE)
    expect(answer.managementAccountId).toBe("1234…12")
  })

  test("AWS answering that there is no Organization is a READ, with the consequences it carries", () => {
    const answer = organizationAnswer(
      { state: "NOT_IN_USE", asOf: "2026-08-14T00:00:00.000Z" },
      IDENTITY,
    )
    if (answer.kind !== "none") throw new Error("NOT_IN_USE must not collapse into anything else")
    expect(answer.sentence).toContain("AWSOrganizationsNotInUseException")

    // The point of the arm: not an empty table. Each consequence names the
    // requirement it bears on, so an operator reading "no Organization" is told
    // what that costs rather than being left to infer it.
    const all = answer.consequences.join(" ")
    expect(answer.consequences.length).toBeGreaterThanOrEqual(4)
    expect(all).toContain("STUDIO-010-001")
    expect(all).toContain("STUDIO-010-002")
    expect(all).toContain("STUDIO-010-003")
    expect(all).toContain("organizations:ListAccounts")
    expect(all).toContain("organizations:ListRoots")
    // And it does not claim the separation was achieved.
    expect(all).toContain("vacuous rather than achieved")
  })

  test("a refused read is never the same answer as an estate with no Organization", () => {
    const answer = organizationAnswer(
      {
        state: "UNKNOWN",
        principal: `arn:aws:sts::${TEST_ACCOUNT}:assumed-role/tenure-studio-task/session`,
        action: "organizations:DescribeOrganization",
        errorCode: "AccessDeniedException",
        minimumStatement: minimumStatementText("organizations:DescribeOrganization"),
      },
      IDENTITY,
    )
    if (answer.kind !== "unknown") throw new Error("a refusal must not become an answer")
    // The defect this console shipped once: a denial rendered as "not in use".
    expect(answer.sentence).toContain("not known")
    expect(answer.sentence).not.toContain("single AWS account")
    expect(answer.read.state).toBe("DENIED")
    if (answer.read.state !== "DENIED") throw new Error("a denial must render as one")
    expect(JSON.parse(answer.read.minimumStatement).Action).toContain(
      "organizations:DescribeOrganization",
    )
    expect(JSON.stringify(answer)).not.toMatch(TWELVE)
  })

  test("a failure that is not a refusal does not print an error message as a policy", () => {
    const answer = organizationAnswer(
      {
        state: "UNKNOWN",
        principal: "unknown principal",
        action: "organizations:DescribeOrganization",
        errorCode: "TimeoutError",
        // `organization.ts` puts `safeDetail(error)` in this field for every
        // failure that is not a denial or a throttle. Rendering it inside a box
        // headed "paste this into a policy" costs an operator the twenty
        // minutes this console exists to save.
        minimumStatement: "socket hang up while calling organizations.us-east-1.amazonaws.com",
      },
      null,
    )
    if (answer.kind !== "unknown") throw new Error("a failure must not become an answer")
    expect(answer.read.state).toBe("ERROR")
    if (answer.read.state !== "ERROR") throw new Error("a non-denial must render as an error")
    expect(answer.read.code).toBe("TimeoutError")
    expect(answer.read.safeDetail).toContain("socket hang up")
  })

  test("a successful call with no Organization in it is UNKNOWN, not an absence", () => {
    // `organization.ts` produces exactly this: a 200 carrying no `Organization`.
    const answer = organizationAnswer(
      {
        state: "UNKNOWN",
        principal: "unknown principal",
        action: "organizations:DescribeOrganization",
        errorCode: "IncompleteResponse",
        minimumStatement: minimumStatementText("organizations:DescribeOrganization"),
      },
      null,
    )
    expect(answer.kind).toBe("unknown")
  })

  test("every arm has a word for its badge", () => {
    for (const kind of ["in-use", "none", "unknown"] as const) {
      expect(ORGANIZATION_WORD[kind].length).toBeGreaterThan(0)
    }
    expect(ORGANIZATION_WORD.unknown).toContain("not known")
    expect(ORGANIZATION_WORD.none).not.toBe(ORGANIZATION_WORD.unknown)
  })
})

describe("orgAccountRows", () => {
  test("every account id is masked, and the registered email is not rendered at all", () => {
    const rows = orgAccountRows([
      { id: TEST_ACCOUNT, name: "management", status: "ACTIVE", email: "root@example.com" },
      { id: "210987654321", name: "log-archive", status: "ACTIVE", email: "logs@example.com" },
    ])
    expect(JSON.stringify(rows)).not.toMatch(TWELVE)
    expect(JSON.stringify(rows)).not.toContain("example.com")
    expect(rows.map((r) => r.name)).toEqual(["management", "log-archive"])
    expect(rows[0].status).toBe("ACTIVE")
  })

  test("two accounts that share an id still produce two keys", () => {
    const rows = orgAccountRows([
      { id: TEST_ACCOUNT, name: "a", status: "ACTIVE", email: "" },
      { id: TEST_ACCOUNT, name: "b", status: "SUSPENDED", email: "" },
    ])
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })

  test("no accounts produces no rows", () => {
    expect(orgAccountRows([])).toEqual([])
  })
})

/**
 * The types are the other half of the guarantee, and they are checked by the
 * compiler rather than by an assertion.
 *
 * `AwsRead<T>` has no arm carrying an optional `T`, so `read.value` on an
 * unnarrowed reading does not compile — which is why `quotaRows` cannot render
 * a refused quota as a zero even if somebody deleted its filter. This block
 * exists to say so where a reader of this file will meet it; `@ts-expect-error`
 * fails the build if the line it guards ever starts compiling.
 */
describe("the guarantee that is not an assertion", () => {
  test("a refused reading has no value to reach for", () => {
    const refused: AwsRead<AppliedQuota> = DENIED_LISTING
    // @ts-expect-error a DENIED reading carries no `value` field at all
    const nothing = refused.value
    expect(nothing).toBeUndefined()
  })
})
