import fs from "node:fs"
import path from "node:path"

import { ALL_CAPABILITIES, CAPABILITIES, type Capability } from "../../../lib/aws/capabilities"
import { estateInventory, estateLines } from "../../../lib/aws/inventory"
import type { AwsGateway } from "../../../lib/aws/read"

import {
  coverageAnswer,
  coverageRows,
  coverageTally,
  declarationAnswer,
  declarationRows,
  groupByService,
  parseTerraformDeclarations,
  readerWord,
  serviceFor,
  serviceOf,
  unknownDeclaration,
  unmappedSentence,
  type DeclaredEstate,
  type TerraformFile,
} from "./estate-coverage"

/**
 * COVERAGE and drift, driven through the same functions `/platform/estate`
 * renders.
 *
 * ── Why this drives `estateInventory` rather than hand-built readings ──────
 *
 * Every `EstateLine` here comes out of the real production reader, through a
 * stand-in gateway that answers the way the AWS APIs answer — `serviceArns` and
 * `DBInstances` and `DistributionList.Items`, not a convenient array. A test
 * that constructed `AwsRead` literals of its own would agree with whatever this
 * module did on the day it was written and stay green when `inventory.ts`
 * changed the shape it produces. The page calls `estateInventory()` and
 * `estateLines()`; so does this.
 *
 * ── Why the Terraform is the repository's own ──────────────────────────────
 *
 * `parseTerraformDeclarations` is asserted against `infrastructure/terraform`
 * and `infrastructure/studio` as they actually are, not against a fixture. The
 * parser exists to survive `terraform fmt` output containing IAM policy
 * heredocs full of braces and blocks carrying `count = var.x != "" ? 1 : 0`,
 * and a fixture is precisely where those never appear. Where an assertion needs
 * a shape the repository does not contain, the input is written out inline and
 * says so.
 */

/* ------------------------------------------------------------- stand-ins -- */

/** An error shaped the way the AWS SDK shapes one: the `name` carries the code. */
function awsError(name: string): Error {
  const error = new Error(`${name}: simulated by the stand-in gateway`)
  error.name = name
  return error
}

/** A gateway that answers per capability; anything unnamed answers `{}`. */
function standIn(answers: Partial<Record<Capability, () => unknown>>): AwsGateway {
  return {
    async call(capability) {
      const answer = answers[capability]
      return answer ? answer() : {}
    },
    async resolvedRegion() {
      return "eu-west-2"
    },
  }
}

const NOW = () => new Date("2026-08-13T09:00:00.000Z")

const IDENTITY = () => ({
  Account: "123456789012",
  Arn: "arn:aws:sts::123456789012:assumed-role/tenure-studio-ecs-task/abc",
  UserId: "AROAEXAMPLE:abc",
})

/** One ECS service, answered the way ECS answers. */
const ECS_ANSWERS: Partial<Record<Capability, () => unknown>> = {
  "sts:GetCallerIdentity": IDENTITY,
  "ecs:ListClusters": () => ({
    clusterArns: ["arn:aws:ecs:eu-west-2:123456789012:cluster/tenure-prod"],
  }),
  "ecs:ListServices": () => ({
    serviceArns: ["arn:aws:ecs:eu-west-2:123456789012:service/tenure-prod/tenure-prod-app"],
  }),
  "ecs:DescribeServices": () => ({
    services: [
      {
        serviceArn: "arn:aws:ecs:eu-west-2:123456789012:service/tenure-prod/tenure-prod-app",
        serviceName: "tenure-prod-app",
        status: "ACTIVE",
        clusterArn: "arn:aws:ecs:eu-west-2:123456789012:cluster/tenure-prod",
        desiredCount: 2,
        runningCount: 2,
        tags: [{ key: "tenure:tenant", value: "SHARED" }],
      },
    ],
  }),
}

async function linesFrom(answers: Partial<Record<Capability, () => unknown>>) {
  return estateLines(await estateInventory(standIn(answers), { now: NOW }))
}

/* -------------------------------------------------------- real Terraform -- */

/** The repository root, found by the thing this parser exists to read. */
function repositoryRoot(): string | null {
  let directory = __dirname
  for (let ascent = 0; ascent < 10; ascent += 1) {
    if (fs.existsSync(path.join(directory, "infrastructure", "terraform"))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return null
}

function realTerraform(): readonly TerraformFile[] {
  const root = repositoryRoot()
  // Not skipped when absent. A test that quietly passes because it could not
  // find its input is the "guard that cannot fail" shape; this fails loudly.
  if (root === null) throw new Error("infrastructure/terraform was not found from this test file")

  const files: TerraformFile[] = []
  for (const relative of ["infrastructure/terraform", "infrastructure/studio"]) {
    const directory = path.join(root, relative)
    if (!fs.existsSync(directory)) continue
    for (const entry of fs.readdirSync(directory).sort()) {
      if (!entry.endsWith(".tf")) continue
      files.push({
        path: `${relative}/${entry}`,
        text: fs.readFileSync(path.join(directory, entry), "utf8"),
      })
    }
  }
  return files
}

/* ================================================ 1. a gap is not an absence */

describe("a service with no reader is a gap, never an empty account", () => {
  test("an AWS service this page does not read renders as NO_READER with a null count", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = coverageRows({ lines, declared: unknownDeclaration("no Terraform in this test") })

    // S3 is declared as an estate capability (`s3:ListBuckets`) and nothing
    // feeds this page's inventory with it.
    const s3 = rows.find((row) => row.service === "s3")
    expect(s3).toBeDefined()
    expect(s3?.reader).toBe("NO_READER")

    // The whole point, in one assertion: NOT zero. A zero here is the
    // substitution `AwsRead` exists to end, one level up — it would render as
    // "S3 holds nothing" on an account holding buckets.
    expect(s3?.count).toBeNull()
    expect(s3?.because).toContain("wires none of them into this page's inventory")
  })

  /**
   * The sentence must say only what was checked.
   *
   * This row used to read "no capability in this build names cloudwatch at all
   * — neither a reader nor an IAM grant. It cannot be read from here even in
   * principle." The check behind it was `capabilitiesFor("estate")`, which is 42
   * of the 114 capabilities declared; the other 72 sit on posture, health,
   * security, retention, identity, cost and organization.
   *
   * So the deployed console told an operator that cloudwatch, cognito-idp and
   * iam had no reader and no grant, when all three have both — and it
   * contradicted `every-provisioned-service-has-a-reader.test.mjs`, which passes
   * BECAUSE those readers exist. A surface asserting the opposite of a guard is
   * worse than either being wrong alone: whichever an operator believes depends
   * on which they opened.
   */
  test("a service read on another surface is not reported as unreadable in principle", async () => {
    // The REPOSITORY's own Terraform, because that is what puts cloudwatch,
    // cognito-idp and iam into the service set at all — they arrive as DECLARED
    // resources this page does not read, which is exactly the row that was
    // making the false claim in production.
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = coverageRows({ lines, declared: parseTerraformDeclarations(realTerraform()) })

    // Every service the console declares a capability for, anywhere, that this
    // page does not itself read. Derived, so a capability moved between surfaces
    // keeps this test honest instead of stale.
    const readElsewhere = rows.filter((row) => {
      if (row.reader !== "NO_READER") return false
      if (row.capabilities.length > 0) return false
      return ALL_CAPABILITIES.some((capability) => serviceOf(capability) === row.service)
    })

    // Guards against a vacuous pass: if no service is in this position the
    // assertions below prove nothing and this should say so rather than go green.
    expect(readElsewhere.length).toBeGreaterThan(0)

    for (const row of readElsewhere) {
      const surfaces = [
        ...new Set(
          ALL_CAPABILITIES.filter((capability) => serviceOf(capability) === row.service).map(
            (capability) => CAPABILITIES[capability].surface,
          ),
        ),
      ]

      if (row.because.includes("no capability anywhere in this build")) {
        throw new Error(
          `${row.service} is read on ${surfaces.join(", ")}, but the row claims no capability names it anywhere`,
        )
      }
      expect(row.because).toContain("The console DOES read")
      // And it names WHERE, so the row is actionable rather than merely hedged.
      for (const surface of surfaces) expect(row.because).toContain(surface)
    }
  })

  test("a service nothing anywhere declares still says so plainly", () => {
    // The third sentence must stay reachable. If every service the estate could
    // name were read somewhere, the honest "nothing can read this" arm would be
    // dead code that reads like a live guarantee.
    const declaredOnly = coverageRows({
      lines: [],
      declared: {
        known: true,
        byService: new Map([["madeupservice", { definite: 1, conditional: 0 }]]),
        byResourceType: new Map(),
        unmapped: [],
        files: ["infrastructure/terraform/imaginary.tf"],
        because: "",
      },
    })

    const row = declaredOnly.find((r) => r.service === "madeupservice")
    expect(row).toBeDefined()
    expect(row?.reader).toBe("NO_READER")
    expect(row?.because).toContain("no capability anywhere in this build")
  })

  test("the badge claims this page, not the whole console", () => {
    // `no reader in this build` was a statement about the engine made by a check
    // that only looked at one page's capabilities.
    expect(readerWord("NO_READER")).toBe("not read on this page")
    expect(readerWord("NO_READER")).not.toContain("build")
  })

  test("the gap is counted in the tally and said out loud in the answer", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = coverageRows({ lines, declared: unknownDeclaration("no Terraform in this test") })
    const tally = coverageTally(rows)

    expect(tally.noReader).toBeGreaterThan(0)
    expect(tally.read).toBeLessThan(tally.total)

    const answer = coverageAnswer(rows)
    expect(answer).toContain("NO READER")
    expect(answer).toContain("invisible here, which is not the same as absent")
    expect(answer).toContain("floor, not a total")
  })

  test("gaps sort above the services that answered", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = coverageRows({ lines, declared: unknownDeclaration("no Terraform in this test") })
    const firstRead = rows.findIndex((row) => row.reader === "READ" || row.reader === "EMPTY")
    const lastGap = rows.map((row) => row.reader).lastIndexOf("NO_READER")
    expect(lastGap).toBeLessThan(firstRead)
  })
})

/* ============================ 2. a refused read is not an empty service ==== */

describe("a refused read is UNREADABLE, never EMPTY", () => {
  test("a denied rds:DescribeDBInstances renders as not-read with a null count", async () => {
    const lines = await linesFrom({
      ...ECS_ANSWERS,
      "rds:DescribeDBInstances": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const rows = coverageRows({ lines, declared: unknownDeclaration("no Terraform in this test") })

    const rds = rows.find((row) => row.service === "rds")
    expect(rds?.reader).toBe("UNREADABLE")
    expect(rds?.count).toBeNull()
    // The reason is the reader's own sentence, so a denial cannot be worded as
    // an absence on this page and correctly on another.
    expect(rds?.because).toContain("rds:DescribeDBInstances")

    // And it must not be confused with the service that genuinely answered.
    const ecs = rows.find((row) => row.service === "ecs")
    expect(ecs?.reader).toBe("READ")
    expect(ecs?.count).toBe(1)
  })

  test("a service that answered with nothing is EMPTY and counts zero — a real absence", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = coverageRows({ lines, declared: unknownDeclaration("no Terraform in this test") })

    const acm = rows.find((row) => row.service === "acm")
    expect(acm?.reader).toBe("EMPTY")
    // A read that completed and found nothing IS a zero. That is the fact
    // NO_READER and UNREADABLE must never be collapsed into.
    expect(acm?.count).toBe(0)
  })
})

/* ================================================ 3. grouping by service === */

describe("the estate is grouped by service", () => {
  test("resources land under their service, keyed by the reading's own capability", async () => {
    const groups = groupByService(await linesFrom(ECS_ANSWERS))

    const ecs = groups.find((group) => group.service === "ecs")
    expect(ecs?.resources.map((resource) => resource.name)).toEqual(["tenure-prod-app"])
    expect(ecs?.surfaces).toEqual(["ECS services"])
    expect(ecs?.asOf).toBe("2026-08-13T09:00:00.000Z")

    // Four services, one per wired reader, and no fifth invented from a
    // resource type.
    expect(groups.map((group) => group.service)).toEqual(["acm", "cloudfront", "ecs", "rds"])
  })

  test("a service fed by two readings is as of the OLDER of them", async () => {
    // Both lines come out of the real reader; only the clock differs. Two
    // readings behind one service is what the page will have the moment
    // `estateInventory` wires a second ECS surface, and a group dated to the
    // NEWER of them would claim a freshness half its contents do not have.
    const older = (await linesFrom(ECS_ANSWERS)).filter((line) => line.surface === "ECS services")
    const newer = estateLines(
      await estateInventory(standIn(ECS_ANSWERS), {
        now: () => new Date("2026-08-13T11:30:00.000Z"),
      }),
    ).filter((line) => line.surface === "ECS services")

    expect(older).toHaveLength(1)
    expect(newer).toHaveLength(1)

    // Both orderings, so the answer is the minimum rather than "whichever came
    // last" or "whichever came first".
    for (const lines of [
      [...older, ...newer],
      [...newer, ...older],
    ]) {
      const group = groupByService(lines).find((g) => g.service === "ecs")
      expect(group?.asOf).toBe("2026-08-13T09:00:00.000Z")
      expect(group?.resources).toHaveLength(2)
    }
  })

  test("a service whose read failed carries no as-of at all", async () => {
    const lines = await linesFrom({
      ...ECS_ANSWERS,
      "cloudfront:ListDistributions": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const groups = groupByService(lines)
    expect(groups.find((group) => group.service === "cloudfront")?.asOf).toBeNull()
  })
})

/* ================================== 4. what Terraform actually declares ==== */

describe("the declaration is parsed from the Terraform, not typed here", () => {
  test("this repository's own infrastructure parses into services and resource types", () => {
    const declared = parseTerraformDeclarations(realTerraform())

    expect(declared.known).toBe(true)
    expect(declared.files.length).toBeGreaterThan(10)

    // `infrastructure/terraform/ecs.tf` and `infrastructure/studio/ecs.tf`
    // declare one `aws_ecs_service` each, neither conditional.
    expect(declared.byResourceType.get("ecs:service")).toEqual({ definite: 2, conditional: 0 })

    // `aws_db_instance.postgres` — one, unconditional.
    expect(declared.byResourceType.get("rds:db")).toEqual({ definite: 1, conditional: 0 })

    // `aws_acm_certificate.custom` carries `count = var.custom_domain != "" ? 1 : 0`.
    // It is CONDITIONAL, and asserting it as present is the false MISSING this
    // distinction exists to prevent.
    expect(declared.byResourceType.get("acm:certificate")).toEqual({ definite: 0, conditional: 1 })

    // The service map, on the three names no rule derives from the Terraform
    // type: `aws_lb` → elasticloadbalancing, `aws_cognito_*` → cognito-idp,
    // `aws_cloudwatch_event_*` → events.
    expect(declared.byService.get("elasticloadbalancing")?.definite).toBeGreaterThan(0)
    expect(declared.byService.get("cognito-idp")?.definite).toBeGreaterThan(0)
    expect(declared.byService.get("events")?.definite).toBeGreaterThan(0)

    // `random_password` is not AWS and is not an unmapped AWS type.
    expect(declared.unmapped).not.toContain("random_password")
  })

  test("a resource declared inside an IAM policy heredoc is not counted as a block", () => {
    // The one shape the repository cannot supply: a heredoc whose body contains
    // a line that looks like a resource block. Brace counting reads this as an
    // open block and swallows the rest of the file.
    const declared = parseTerraformDeclarations([
      {
        path: "inline/heredoc.tf",
        text: [
          'resource "aws_iam_role_policy" "studio" {',
          "  policy = <<-EOT",
          '    resource "aws_db_instance" "not_real" {',
          "      { nested braces }",
          "  EOT",
          "}",
          'resource "aws_ecs_service" "after" {',
          '  name = "after-the-heredoc"',
          "}",
        ].join("\n"),
      },
    ])

    // The heredoc's fake declaration is indented, so it never opens a block —
    // and the real one after it is still found, which is what proves the parser
    // did not run off the end of the file.
    expect(declared.byResourceType.get("rds:db")).toBeUndefined()
    expect(declared.byResourceType.get("ecs:service")).toEqual({ definite: 1, conditional: 0 })
  })

  test("an AWS type this build cannot map is reported, never dropped", () => {
    const declared = parseTerraformDeclarations([
      { path: "inline/unmapped.tf", text: 'resource "aws_glacier_vault" "cold" {\n}\n' },
    ])
    expect(declared.unmapped).toEqual(["aws_glacier_vault"])
    expect(unmappedSentence(declared)).toContain("aws_glacier_vault")
    expect(unmappedSentence(declared)).toContain("counted nowhere")
  })

  test("serviceFor prefers the longest matching provider prefix", () => {
    expect(serviceFor("aws_cloudwatch_event_rule")).toBe("events")
    expect(serviceFor("aws_cloudwatch_log_group")).toBe("logs")
    expect(serviceFor("aws_cloudwatch_metric_alarm")).toBe("cloudwatch")
    expect(serviceFor("aws_glacier_vault")).toBeNull()
  })
})

/* ================================= 5. drift, in both directions =========== */

describe("drift runs in both directions and the dangerous one comes first", () => {
  const DECLARES_NOTHING: DeclaredEstate = parseTerraformDeclarations([
    { path: "inline/empty.tf", text: "# declares no AWS resource at all\n" },
  ])

  test("a running resource Terraform never declared is PRESENT_NOT_DECLARED, and sorts first", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const rows = declarationRows({ lines, declared: DECLARES_NOTHING })

    expect(rows[0].resourceType).toBe("ecs:service")
    expect(rows[0].verdict).toBe("PRESENT_NOT_DECLARED")
    expect(rows[0].present).toBe(1)
    expect(rows[0].detail).toContain("more dangerous direction")

    expect(declarationAnswer({ rows, declared: DECLARES_NOTHING })).toContain(
      "the dangerous direction",
    )
  })

  test("a declaration with nothing running is DECLARED_NOT_PRESENT", async () => {
    // Nothing answers, so every surface reads EMPTY — a real absence, which is
    // the only state in which "declared and not present" may be claimed.
    const lines = await linesFrom({ "sts:GetCallerIdentity": IDENTITY })
    const declared = parseTerraformDeclarations([
      { path: "inline/one.tf", text: 'resource "aws_ecs_service" "app" {\n  name = "app"\n}\n' },
    ])

    const row = declarationRows({ lines, declared }).find((r) => r.resourceType === "ecs:service")
    expect(row?.verdict).toBe("DECLARED_NOT_PRESENT")
    expect(row?.present).toBe(0)
  })

  test("a CONDITIONAL declaration with nothing running is not a finding", async () => {
    const lines = await linesFrom({ "sts:GetCallerIdentity": IDENTITY })
    const declared = parseTerraformDeclarations([
      {
        path: "inline/conditional.tf",
        text: [
          'resource "aws_acm_certificate" "custom" {',
          '  count       = var.custom_domain != "" ? 1 : 0',
          "  domain_name = var.custom_domain",
          "}",
        ].join("\n"),
      },
    ])

    const row = declarationRows({ lines, declared }).find(
      (r) => r.resourceType === "acm:certificate",
    )
    // MATCHED, not DECLARED_NOT_PRESENT. The block declares between zero and one
    // depending on a variable this parser does not resolve, and reporting it as
    // missing would red every estate that does not set the variable.
    expect(row?.verdict).toBe("MATCHED")
    expect(row?.detail).toContain("depends on a variable")
  })

  test("a resource type whose reader failed is UNREADABLE, and claims neither direction", async () => {
    const lines = await linesFrom({
      ...ECS_ANSWERS,
      "rds:DescribeDBInstances": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const declared = parseTerraformDeclarations([
      { path: "inline/db.tf", text: 'resource "aws_db_instance" "pg" {\n  identifier = "pg"\n}\n' },
    ])

    const row = declarationRows({ lines, declared }).find((r) => r.resourceType === "rds:db")
    expect(row?.verdict).toBe("UNREADABLE")
    expect(row?.present).toBeNull()
    expect(row?.detail).toContain("Neither direction of drift can be claimed")
  })

  test("with no Terraform readable, the answer refuses to report a match", async () => {
    const lines = await linesFrom(ECS_ANSWERS)
    const declared = unknownDeclaration("the container ships the app, not the infrastructure")
    const rows = declarationRows({ lines, declared })

    expect(rows.every((row) => row.verdict === "NOT_DECLARABLE")).toBe(true)

    const answer = declarationAnswer({ rows, declared })
    expect(answer).toContain("could not be computed")
    // The arm that would be a lie. "Every resource type matches" on the strength
    // of never having read the declaration is the false green this refuses.
    expect(answer).not.toContain("matches")
  })
})
