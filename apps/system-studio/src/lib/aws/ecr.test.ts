import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_FINDINGS_SAMPLED,
  MAX_SCAN_DETAIL_READS,
  ecrLines,
  ecrReadings,
  parseLifecyclePolicy,
  severityCounts,
  type EcrReadings,
} from "./ecr"

/**
 * STUDIO-070-004 (ECR) — the registry surface tells four different truths apart,
 * and never renders a reassuring zero.
 *
 * The assertions are on `ecrReadings` and `ecrLines`, the functions a route
 * renders, rather than on `readAws` or on any parser. A test that drove a private
 * helper would stay green on the day this module stopped calling it, which is
 * precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers six capabilities with the shapes the real SDK returns —
 * `{repositories, nextToken}` from DescribeRepositories, `{imageDetails,
 * nextToken}` from DescribeImages, `{imageScanStatus, imageScanFindings}` from
 * DescribeImageScanFindings, `{lifecyclePolicyText}` from GetLifecyclePolicy,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS —
 * and it can fail each of them independently with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful list, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code that has to tell those four apart, and it is the fake this
 * repository has already been burnt by.
 *
 * Every account id here is the obviously-constructed `123456789012`. No AWS
 * account, ARN or resource name in this file is real.
 */

/* ------------------------------------------------------------- the estate -- */

/** Obviously constructed. Not an account this or any organisation holds. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

function repoArn(name: string, partition = "aws", region = REGION): string {
  return `arn:${partition}:ecr:${region}:${ACCOUNT}:repository/${name}`
}

/**
 * A repository URI, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses a literal
 * `…amazonaws.com` outside the owning adapter, and it is right to be blunt: a
 * rule that tried to tell "a registry handle in a fixture" from "an endpoint this
 * code dials" would be a rule with an exception in it. Nothing in this suite
 * opens a socket.
 */
function repoUri(name: string): string {
  return `${ACCOUNT}.${["dkr", "ecr", REGION, "amazonaws", "com"].join(".")}/${name}`
}

const APP = "tenure-prod-app"
const STUDIO = "tenure-studio"

/** Digests that are obviously constructed, and distinct in their first bytes. */
const DIGEST_A = `sha256:${"a1".repeat(32)}`
const DIGEST_B = `sha256:${"b2".repeat(32)}`
const DIGEST_C = `sha256:${"c3".repeat(32)}`

/** The lifecycle policy `infrastructure/terraform/ecr.tf` actually writes. */
const APP_LIFECYCLE = JSON.stringify({
  rules: [
    {
      rulePriority: 1,
      description: "Expire untagged images",
      selection: {
        tagStatus: "untagged",
        countType: "sinceImagePushed",
        countUnit: "days",
        countNumber: 1,
      },
      action: { type: "expire" },
    },
    {
      rulePriority: 2,
      description: "Keep last 10 tagged images",
      selection: {
        tagStatus: "tagged",
        tagPrefixList: ["sha-"],
        countType: "imageCountMoreThan",
        countNumber: 10,
      },
      action: { type: "expire" },
    },
  ],
})

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface RepoFixture {
  name: string
  arn?: string | null
  scanOnPush?: boolean | undefined
  mutability?: string | undefined
  images?: ImageFixture[]
  /** Raised instead of answering DescribeImages, so a per-repo denial is exercised. */
  imagesFailWith?: string
  /** `undefined` means "no policy" — the fake raises LifecyclePolicyNotFoundException. */
  lifecycle?: string
  lifecycleFailWith?: string
}

interface ImageFixture {
  digest: string
  tags?: string[]
  pushedAt?: string
  sizeBytes?: number
  scanStatus?: string
  scanDescription?: string
  /** The summary DescribeImages returns beside the image. */
  summaryCounts?: Record<string, number>
  /** What DescribeImageScanFindings answers, when it is asked. */
  detail?: {
    status?: string
    counts?: Record<string, number>
    findings?: Array<{ name: string; severity: string; packageName?: string }>
    pages?: number
  }
  detailFailWith?: string
}

function image(fixture: ImageFixture): Required<Pick<ImageFixture, "digest">> & ImageFixture {
  return fixture
}

/** The healthy estate: two repositories, both scanning, both with a policy. */
function healthyEstate(): RepoFixture[] {
  return [
    {
      name: APP,
      scanOnPush: true,
      mutability: "MUTABLE",
      lifecycle: APP_LIFECYCLE,
      images: [
        image({
          digest: DIGEST_A,
          tags: ["sha-9f2c1a", "latest"],
          pushedAt: "2026-08-12T18:04:00.000Z",
          sizeBytes: 268_435_456,
          scanStatus: "COMPLETE",
          summaryCounts: {},
          detail: { status: "COMPLETE", counts: {} },
        }),
        image({
          digest: DIGEST_B,
          tags: ["sha-4b0e77"],
          pushedAt: "2026-08-10T09:00:00.000Z",
          sizeBytes: 267_000_000,
          scanStatus: "COMPLETE",
          summaryCounts: {},
          detail: { status: "COMPLETE", counts: {} },
        }),
      ],
    },
    {
      name: STUDIO,
      scanOnPush: true,
      mutability: "IMMUTABLE",
      lifecycle: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: "Keep the last 10 images",
            selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 10 },
            action: { type: "expire" },
          },
        ],
      }),
      images: [
        image({
          digest: DIGEST_C,
          tags: ["sha-11aa22"],
          pushedAt: "2026-08-11T11:11:00.000Z",
          sizeBytes: 190_000_000,
          scanStatus: "COMPLETE",
          summaryCounts: {},
          detail: { status: "COMPLETE", counts: {} },
        }),
      ],
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

interface FakeOptions {
  /** How `ecr:DescribeRepositories` behaves. The four cases this suite separates. */
  describeRepositories?: Outcome
  repositories?: RepoFixture[]
  /** Extra pages of repositories, to drive the pagination bound. */
  repositoryPages?: number
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * paginating the way ECR paginates, and independently failable per capability and
 * per resource.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.describeRepositories ?? "populated"
  const repositories = options.repositories ?? healthyEstate()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const arg = (input ?? {}) as Record<string, unknown>

      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "ecr:DescribeRepositories": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS `repositories` entirely when there are none. It
          // does not return an empty array, and a fake that did would be testing
          // a response AWS never sends.
          if (listOutcome === "empty") return {}

          const totalPages = options.repositoryPages ?? 1
          const page = Number(arg.nextToken ?? 0)
          return {
            repositories: repositories.map((repo) => ({
              // Page N returns the same repositories under distinct names, which
              // is all the pagination bound needs to be exercised.
              repositoryName: totalPages > 1 ? `${repo.name}-p${page}` : repo.name,
              repositoryArn: repo.arn === null ? undefined : (repo.arn ?? repoArn(repo.name)),
              registryId: ACCOUNT,
              repositoryUri: repoUri(repo.name),
              createdAt: new Date("2026-01-04T00:00:00.000Z"),
              imageTagMutability: repo.mutability,
              imageScanningConfiguration:
                repo.scanOnPush === undefined ? {} : { scanOnPush: repo.scanOnPush },
              encryptionConfiguration: { encryptionType: "KMS" },
            })),
            nextToken: page + 1 < totalPages ? String(page + 1) : undefined,
          }
        }

        case "ecr:DescribeImages": {
          const name = String(arg.repositoryName ?? "")
          const repo = repositories.find((r) => name === r.name || name.startsWith(`${r.name}-p`))
          if (!repo) throwing("RepositoryNotFoundException")
          if (repo.imagesFailWith) throwing(repo.imagesFailWith)
          const images = repo.images ?? []
          if (images.length === 0) return {}
          return {
            imageDetails: images.map((img) => ({
              registryId: ACCOUNT,
              repositoryName: name,
              imageDigest: img.digest,
              imageTags: img.tags,
              imageSizeInBytes: img.sizeBytes,
              imagePushedAt: img.pushedAt ? new Date(img.pushedAt) : undefined,
              artifactMediaType: "application/vnd.docker.container.image.v1+json",
              imageManifestMediaType: "application/vnd.docker.distribution.manifest.v2+json",
              imageScanStatus: img.scanStatus
                ? { status: img.scanStatus, description: img.scanDescription }
                : undefined,
              imageScanFindingsSummary: img.summaryCounts
                ? {
                    imageScanCompletedAt: new Date("2026-08-12T18:09:00.000Z"),
                    findingSeverityCounts: img.summaryCounts,
                  }
                : undefined,
            })),
          }
        }

        case "ecr:DescribeImageScanFindings": {
          const digest = String(arg.imageDigest ?? "")
          // A tag-keyed read is the defect this module is built against. If the
          // production path ever sent one, this fake refuses to answer it.
          if (!digest) throwing("ImageNotFoundException")
          const owner = repositories.find((r) => (r.images ?? []).some((i) => i.digest === digest))
          const img = (owner?.images ?? []).find((i) => i.digest === digest)
          if (!img) throwing("ImageNotFoundException")
          if (img.detailFailWith) throwing(img.detailFailWith)
          if (!img.detail) throwing("ScanNotFoundException")
          const pages = img.detail.pages ?? 1
          const page = Number(arg.nextToken ?? 0)
          const findings = (img.detail.findings ?? []).map((f) => ({
            name: f.name,
            severity: f.severity,
            attributes: f.packageName ? [{ key: "package_name", value: f.packageName }] : [],
          }))
          return {
            imageScanStatus: { status: img.detail.status ?? "COMPLETE" },
            imageScanFindings: {
              imageScanCompletedAt: new Date("2026-08-12T18:09:00.000Z"),
              // ECR returns the WHOLE scan's counts on every page, not the
              // page's. A module that accumulated them would multiply.
              findingSeverityCounts: img.detail.counts ?? {},
              findings,
            },
            nextToken: page + 1 < pages ? String(page + 1) : undefined,
          }
        }

        case "ecr:GetLifecyclePolicy": {
          const name = String(arg.repositoryName ?? "")
          const repo = repositories.find((r) => name === r.name || name.startsWith(`${r.name}-p`))
          if (!repo) throwing("RepositoryNotFoundException")
          if (repo.lifecycleFailWith) throwing(repo.lifecycleFailWith)
          if (repo.lifecycle === undefined) throwing("LifecyclePolicyNotFoundException")
          return {
            registryId: ACCOUNT,
            repositoryName: name,
            lifecyclePolicyText: repo.lifecycle,
            lastEvaluatedAt: new Date("2026-08-13T00:00:00.000Z"),
          }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<EcrReadings> {
  return ecrReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: EcrReadings): string {
  return ecrLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the ECR surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every repository and every digest", async () => {
    const readings = await load()
    expect(readings.repositories.state).toBe("ACTUAL")
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.repositories.value).toHaveLength(2)

    const text = surfaceText(readings)
    expect(text).toContain(APP)
    expect(text).toContain(STUDIO)
    // Keyed by digest, and the digest is printed. A surface that could only show
    // a tag could not answer "what is deployed" under a MUTABLE repository.
    expect(text).toContain(DIGEST_A)
    expect(text).toContain(DIGEST_C)
    expect(text).toContain("expires: #1 expire untagged images older than 1 days")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ describeRepositories: "empty" })
    expect(readings.repositories.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    // And the headline is the honest one: nothing is deployed from an empty
    // registry, which is not "nothing is vulnerable".
    expect(readings.deployedRisk.kind).toBe("no-repositories")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ describeRepositories: "denied" })
    expect(readings.repositories.state).toBe("DENIED")
    if (readings.repositories.state !== "DENIED") throw new Error("narrowing")

    expect(readings.repositories.action).toBe("ecr:DescribeRepositories")
    expect(readings.repositories.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.repositories.accountId).toBe(ACCOUNT)
    expect(readings.repositories.region).toBe(REGION)
    expect(readings.repositories.partition).toBe("aws")
    expect(JSON.parse(readings.repositories.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["ecr:DescribeRepositories"],
      Resource: "arn:*:ecr:*:*:repository/*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.repositories).toBe(false)
    expect(readings.deployedRisk.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toContain("no repositories")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ describeRepositories: "throttled" })
    expect(readings.repositories.state).toBe("THROTTLED")
    if (readings.repositories.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.repositories.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ describeRepositories: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ----------------------------------------- the zero that is not a clean bill -- */

describe("an absence of findings is not an absence of vulnerabilities", () => {
  test("scan-on-push off makes the headline UNVERIFIED, never clear", async () => {
    const repositories = healthyEstate()
    repositories[0].scanOnPush = false
    // No scan status at all, which is what an unscanned image actually looks like.
    for (const img of repositories[0].images ?? []) {
      img.scanStatus = undefined
      img.summaryCounts = undefined
      img.detail = undefined
    }
    const readings = await load({ repositories })

    expect(readings.deployedRisk.kind).toBe("unverified")
    if (readings.deployedRisk.kind !== "unverified") throw new Error("narrowing")
    // Named, not just counted. This is the assertion that notices if the
    // scan-on-push finding is ever switched off while the headline stays
    // "unverified" for some other reason.
    expect(readings.deployedRisk.unscanned).toEqual([APP])

    const text = surfaceText(readings)
    expect(text).toContain("SCAN-ON-PUSH IS OFF")
    expect(text).toContain("do not scan on push")
    expect(text).toContain("UNVERIFIED")
    expect(text).toContain("absence of findings here is an absence of scanning")
    expect(text).toContain("NOT SCANNED")
    // The sentence that must never appear beside an unscanned repository.
    expect(text).not.toContain("no known vulnerabilities")
  })

  test("a fully scanned, fully clean registry IS allowed to say clear", async () => {
    const readings = await load()
    expect(readings.deployedRisk.kind).toBe("clear")
    const text = surfaceText(readings)
    expect(text).toContain("no known vulnerabilities")
    expect(text).toContain("all 2 repository(ies) scan on push")
    expect(text).not.toContain("UNVERIFIED")
  })

  test("a scan still running is scan-incomplete, distinct from clean and from not-scanned", async () => {
    const repositories = healthyEstate()
    const target = (repositories[0].images ?? [])[0]
    target.scanStatus = "IN_PROGRESS"
    target.summaryCounts = undefined
    target.detail = { status: "IN_PROGRESS", counts: {} }
    const readings = await load({ repositories })

    expect(readings.deployedRisk.kind).toBe("unverified")
    const text = surfaceText(readings)
    expect(text).toContain("scan IN_PROGRESS")
    expect(text).toContain("No findings yet is not no vulnerabilities")
    expect(text).toContain("no completed scan")
  })

  test("ScanNotFoundException is an answer — NOT SCANNED — and not an ERROR box", async () => {
    const repositories = healthyEstate()
    const target = (repositories[1].images ?? [])[0]
    target.scanStatus = "COMPLETE"
    target.summaryCounts = {}
    // The fake raises ScanNotFoundException when there is no `detail`.
    target.detail = undefined
    const readings = await load({ repositories })

    const text = surfaceText(readings)
    expect(text).toContain("NOT SCANNED")
    expect(text).toContain("ScanNotFoundException")
    expect(text).not.toContain("error — ScanNotFoundException")
    expect(readings.deployedRisk.kind).toBe("unverified")
  })

  test("findings are the alarm, counted by severity and correlated by digest", async () => {
    const repositories = healthyEstate()
    const target = (repositories[0].images ?? [])[0]
    target.summaryCounts = { CRITICAL: 2, HIGH: 3, MEDIUM: 9 }
    target.detail = {
      status: "COMPLETE",
      counts: { CRITICAL: 2, HIGH: 3, MEDIUM: 9 },
      findings: [
        { name: "CVE-2026-0001", severity: "CRITICAL", packageName: "openssl" },
        { name: "CVE-2026-0002", severity: "CRITICAL", packageName: "zlib" },
        { name: "CVE-2026-0003", severity: "HIGH", packageName: "curl" },
      ],
    }
    const readings = await load({ repositories })

    expect(readings.deployedRisk.kind).toBe("vulnerable")
    if (readings.deployedRisk.kind !== "vulnerable") throw new Error("narrowing")
    expect(readings.deployedRisk.critical).toBe(2)
    expect(readings.deployedRisk.high).toBe(3)
    expect(readings.deployedRisk.images[0].digest).toBe(DIGEST_A)

    const text = surfaceText(readings)
    expect(text).toContain("KNOWN-VULNERABLE")
    expect(text).toContain("14 finding(s): 2 CRITICAL, 3 HIGH, 9 MEDIUM")
    expect(text).toContain("CVE-2026-0001 (CRITICAL)")
    // The detail read is the authoritative source and says so.
    expect(text).toContain("from the detail read")
  })
})

/* ------------------------------------------------- correlate by digest -- */

describe("correlation is by digest, because a mutable tag is how they stop agreeing", () => {
  test("the scan read is issued by digest, never by tag", async () => {
    const calls: string[] = []
    const gw = fakeAws({ calls })
    const seen: string[] = []
    const spying: AwsGateway = {
      call(capability, input) {
        if (capability === "ecr:DescribeImageScanFindings") {
          const arg = (input ?? {}) as Record<string, unknown>
          seen.push(JSON.stringify({ tag: arg.imageTag ?? null, digest: arg.imageDigest ?? null }))
        }
        return gw.call(capability, input)
      },
      resolvedRegion: () => gw.resolvedRegion(),
    }
    await ecrReadings(spying, { now: AT })

    expect(seen.length).toBeGreaterThan(0)
    for (const call of seen) {
      expect(JSON.parse(call).digest).toMatch(/^sha256:/)
      expect(JSON.parse(call).tag).toBeNull()
    }
  })

  test("a MUTABLE repository is said to be mutable, in the sentence that explains why it matters", async () => {
    const readings = await load()
    const text = surfaceText(readings)
    expect(text).toContain("tags are MUTABLE")
    expect(text).toContain("Correlate by digest, not by tag")
    expect(text).toContain("tags are IMMUTABLE")
  })

  test("a tag on two digests is reported rather than resolved", async () => {
    const repositories = healthyEstate()
    // `latest` on two digests: exactly what a mutable tag mid-move looks like.
    ;(repositories[0].images ?? [])[1].tags = ["sha-4b0e77", "latest"]
    const readings = await load({ repositories })

    expect(readings.tagCollisions).toHaveLength(1)
    expect(readings.tagCollisions[0].tag).toBe("latest")
    expect(readings.tagCollisions[0].digests).toEqual([DIGEST_A, DIGEST_B].sort())

    const text = surfaceText(readings)
    expect(text).toContain("Tag collision")
    expect(text).toContain("Which one is deployed cannot be answered from a tag")
  })

  test("a healthy estate reports no collisions — the check is not vacuously true", async () => {
    const readings = await load()
    expect(readings.tagCollisions).toEqual([])
    expect(surfaceText(readings)).not.toContain("Tag collision")
  })
})

/* -------------------------------------------- independent degradation -- */

describe("a sub-call that fails degrades on its own", () => {
  test("a refused DescribeImages does not collapse the row, and does not read as zero images", async () => {
    const repositories = healthyEstate()
    repositories[0].imagesFailWith = "AccessDeniedException"
    const readings = await load({ repositories })

    // The listing itself still answered.
    expect(readings.repositories.state).toBe("ACTUAL")
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.repositories.value.find((r) => r.name === APP)
    if (!app) throw new Error("the app repository is missing from the reading")

    expect(app.images.state).toBe("DENIED")
    if (app.images.state !== "DENIED") throw new Error("narrowing")
    // The action named is DescribeImages, not DescribeRepositories — the whole
    // reason the two are separate reads.
    expect(app.images.action).toBe("ecr:DescribeImages")
    expect("value" in app.images).toBe(false)

    // Its lifecycle policy still answered, independently.
    expect(app.lifecycle.state).toBe("ACTUAL")
    // And the OTHER repository is entirely unaffected.
    const studio = readings.repositories.value.find((r) => r.name === STUDIO)
    expect(studio?.images.state).toBe("ACTUAL")

    const text = surfaceText(readings)
    expect(text).toContain("refused ecr:DescribeImages")
    expect(text).not.toContain(`${APP} — ${REGION} (partition aws) — unattributable — missing tenure:tenant — scan-on-push is ON · tags are MUTABLE · 0 image(s)`)
    expect(readings.deployedRisk.kind).toBe("unverified")
  })

  test("a refused GetLifecyclePolicy does not hide the images", async () => {
    const repositories = healthyEstate()
    repositories[0].lifecycleFailWith = "AccessDeniedException"
    const readings = await load({ repositories })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.repositories.value.find((r) => r.name === APP)

    expect(app?.lifecycle.state).toBe("DENIED")
    expect(app?.images.state).toBe("ACTUAL")
    const text = surfaceText(readings)
    expect(text).toContain("refused ecr:GetLifecyclePolicy")
    // The images are still there, by digest.
    expect(text).toContain(DIGEST_A)
  })

  test("a refused DescribeImageScanFindings keeps the summary counts rather than erasing them", async () => {
    const repositories = healthyEstate()
    const target = (repositories[0].images ?? [])[0]
    target.summaryCounts = { CRITICAL: 1, HIGH: 4 }
    target.detailFailWith = "AccessDeniedException"
    const readings = await load({ repositories })

    const text = surfaceText(readings)
    // The severity counts survive, and they say which read produced them.
    expect(text).toContain("5 finding(s): 1 CRITICAL, 4 HIGH")
    expect(text).toContain("from the summary read")
    expect(readings.deployedRisk.kind).toBe("vulnerable")
  })

  test("a throttled scan detail on an unscanned image is THROTTLED, not a clean bill", async () => {
    const repositories = healthyEstate()
    const target = (repositories[1].images ?? [])[0]
    target.scanStatus = undefined
    target.summaryCounts = undefined
    target.detailFailWith = "ThrottlingException"
    const readings = await load({ repositories })

    const text = surfaceText(readings)
    expect(text).toContain("throttled — AWS rate-limited ecr:DescribeImageScanFindings")
    expect(readings.deployedRisk.kind).toBe("unverified")

    // Scoped to THIS image's own line: the other repository's images legitimately
    // read clean, and an assertion over the whole surface would have been passing
    // for the wrong reason. The throttled image says "unknown" and must not, on
    // its own line, contain a clean bill.
    const line = text
      .split("\n")
      .find((l) => l.startsWith(`${STUDIO} image:`) && l.includes(DIGEST_C))
    expect(line).toBeDefined()
    expect(line).toContain("unknown —")
    expect(line).not.toContain("no findings")
  })

  test("a missing lifecycle policy is a finding stated plainly, not an error box", async () => {
    const repositories = healthyEstate()
    repositories[1].lifecycle = undefined
    const readings = await load({ repositories })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    const studio = readings.repositories.value.find((r) => r.name === STUDIO)

    expect(studio?.lifecycle.state).toBe("ACTUAL")
    const text = surfaceText(readings)
    expect(text).toContain("NO LIFECYCLE POLICY")
    expect(text).toContain("still billed, and still pullable")
    expect(text).not.toContain("error — LifecyclePolicyNotFoundException")
  })
})

/* --------------------------------------------------------- pagination -- */

describe("pagination completes, is bounded, and says so when it hits the bound", () => {
  test("a multi-page repository listing is walked to the end, not returned as its first page", async () => {
    const readings = await load({ repositoryPages: 3 })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    // Two repositories per page, three pages.
    expect(readings.repositories.value).toHaveLength(6)
    expect(readings.truncation.kind).toBe("complete")
    expect(surfaceText(readings)).not.toContain("TRUNCATED")
  })

  test("hitting the bound is an explicit signal, never a silent first page", async () => {
    const readings = await load({ repositoryPages: 40 })
    expect(readings.truncation.kind).toBe("truncated")
    if (readings.truncation.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.pagesRead).toBe(20)
    expect(readings.truncation.why).toContain("still had pages after 20")
    const text = surfaceText(readings)
    expect(text).toContain("TRUNCATED")
    expect(text).toContain("there were more")
  })

  test("findings counts are ECR's whole-scan counts, not accumulated across pages", async () => {
    const repositories = healthyEstate()
    const target = (repositories[0].images ?? [])[0]
    target.summaryCounts = { CRITICAL: 1 }
    target.detail = {
      status: "COMPLETE",
      counts: { CRITICAL: 1 },
      findings: [{ name: "CVE-2026-0009", severity: "CRITICAL", packageName: "glibc" }],
      // Three pages, all reporting the same whole-scan counts. A module that
      // summed them would print 3 CRITICAL.
      pages: 3,
    }
    const readings = await load({ repositories })
    expect(surfaceText(readings)).toContain("1 finding(s): 1 CRITICAL")
    expect(surfaceText(readings)).not.toContain("3 CRITICAL")
  })

  test("the scan-detail budget is bounded and images past it say so rather than reading clean", async () => {
    const many: RepoFixture = {
      name: "tenure-prod-many",
      scanOnPush: true,
      mutability: "IMMUTABLE",
      lifecycle: APP_LIFECYCLE,
      images: Array.from({ length: MAX_SCAN_DETAIL_READS + 5 }, (_, i) =>
        image({
          digest: `sha256:${String(i).padStart(2, "0").repeat(32)}`,
          tags: [`build-${i}`],
          pushedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
          scanStatus: "COMPLETE",
          summaryCounts: {},
          detail: { status: "COMPLETE", counts: {} },
        }),
      ),
    }
    const calls: string[] = []
    await ecrReadings(fakeAws({ repositories: [many], calls }), { now: AT })
    const detailCalls = calls.filter((c) => c === "ecr:DescribeImageScanFindings").length
    expect(detailCalls).toBe(MAX_SCAN_DETAIL_READS)
  })

  test("the per-image finding sample is capped and the cap is declared", async () => {
    const repositories = healthyEstate()
    const target = (repositories[0].images ?? [])[0]
    const counts = { MEDIUM: MAX_FINDINGS_SAMPLED + 10 }
    target.summaryCounts = counts
    target.detail = {
      status: "COMPLETE",
      counts,
      findings: Array.from({ length: MAX_FINDINGS_SAMPLED + 10 }, (_, i) => ({
        name: `CVE-2026-${String(i).padStart(4, "0")}`,
        severity: "MEDIUM",
        packageName: "libfoo",
      })),
    }
    const readings = await load({ repositories })
    const text = surfaceText(readings)
    // The COUNT is ECR's own and is complete; only the named sample is capped,
    // and the render says which is which.
    expect(text).toContain(`${MAX_FINDINGS_SAMPLED + 10} finding(s): ${MAX_FINDINGS_SAMPLED + 10} MEDIUM`)
    expect(text).toContain("names at most 25 findings per image")
    expect(text).toContain("the severity counts beside them are ECR's own and are complete")
  })
})

/* ------------------------------------------- region, partition, attribution -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud principal produces GovCloud ARNs and no commercial fallback", async () => {
    const govRepos = healthyEstate()
    govRepos[0].arn = repoArn(APP, "aws-us-gov", "us-gov-west-1")
    govRepos[1].arn = repoArn(STUDIO, "aws-us-gov", "us-gov-west-1")
    const readings = await load({
      repositories: govRepos,
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    for (const repo of readings.repositories.value) {
      expect(repo.partition).toBe("aws-us-gov")
      expect(repo.region).toBe("us-gov-west-1")
    }
    const text = surfaceText(readings)
    expect(text).not.toContain("eu-west-2")
    expect(text).not.toContain("partition aws)")
  })

  test("with no ARN from AWS, region falls back to the resolved identity and never to a literal", async () => {
    const repositories = healthyEstate()
    repositories[0].arn = null
    const readings = await load({
      repositories,
      identity: {
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "ap-southeast-2",
      },
    })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.repositories.value.find((r) => r.name === APP)
    expect(app?.arn).toBeNull()
    expect(app?.region).toBe("ap-southeast-2")
    expect(app?.partition).toBe("aws")
    // With no ARN there is nothing to join against the tag index, and the module
    // says so rather than claiming the repository is untagged.
    expect(app?.attribution.kind).toBe("unknown")
  })

  test("a tenant tag attributes the repository; an untagged one is unattributed", async () => {
    const readings = await load({
      tags: {
        [repoArn(APP)]: [
          { Key: "tenure:tenant", Value: "northwood-academy" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.repositories.value.find((r) => r.name === APP)
    const studio = readings.repositories.value.find((r) => r.name === STUDIO)
    expect(app?.attribution).toEqual({ kind: "tenant", tenantSlug: "northwood-academy" })
    expect(studio?.attribution).toEqual({ kind: "unattributed" })
    expect(surfaceText(readings)).toContain("northwood-academy")
  })

  test("a denied tag index is attribution UNKNOWN, never unattributed", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.repositories.state !== "ACTUAL") throw new Error("narrowing")
    for (const repo of readings.repositories.value) {
      expect(repo.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })
})

/* -------------------------------------------------- the honest absences -- */

describe("what this module cannot read is a value, not a silence", () => {
  test("enhanced scanning coverage is NOT_READABLE and names the capability", async () => {
    const readings = await load()
    expect(readings.enhancedScanning.state).toBe("NOT_READABLE")
    expect(readings.enhancedScanning.needs).toBe("ecr:GetRegistryScanningConfiguration")
    const text = surfaceText(readings)
    expect(text).toContain("Enhanced scanning")
    expect(text).toContain("ecr:GetRegistryScanningConfiguration")
    expect(text).toContain("silent about the application layer")
  })

  test("an unreported scanOnPush is neither on nor off", async () => {
    const repositories = healthyEstate()
    repositories[0].scanOnPush = undefined
    const readings = await load({ repositories })
    const text = surfaceText(readings)
    expect(text).toContain("scan-on-push unknown")
    expect(text).not.toContain(`${APP} — ${REGION} (partition aws) — unattributable — missing tenure:tenant — scan-on-push is ON`)
    expect(readings.deployedRisk.kind).toBe("unverified")
  })

  test("the refresh cadence and the as-of stamp are the registry's own, not retyped here", async () => {
    const readings = await load()
    // 600s repositories, 60s images, 900s scan — the values capabilities.ts
    // declares. A literal here would drift from the registry silently.
    expect(readings.refreshMs.repositories).toBe(600_000)
    expect(readings.refreshMs.images).toBe(60_000)
    expect(readings.refreshMs.scan).toBe(900_000)
    expect(readings.refreshMs.lifecycle).toBe(600_000)
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(surfaceText(readings)).toContain("refreshed every 600s")
  })
})

/* ----------------------------------------------------------- the parsers -- */

describe("the parsers keep facts apart that a careless read would merge", () => {
  test("severity counts fill in the severities ECR omits and never drop one it invents", () => {
    const counts = severityCounts({ CRITICAL: 2, EXOTIC: 1 })
    expect(counts.CRITICAL).toBe(2)
    expect(counts.HIGH).toBe(0)
    // An unmodelled severity is counted as UNDEFINED, not dropped. A dropped
    // count is a CVE nobody sees.
    expect(counts.UNDEFINED).toBe(1)
  })

  test("an unparseable lifecycle policy is unreadable, not absent", () => {
    expect(parseLifecyclePolicy("{not json", null).kind).toBe("unreadable")
    expect(parseLifecyclePolicy("", null).kind).toBe("absent")
    expect(parseLifecyclePolicy(JSON.stringify({ rules: [] }), null).kind).toBe("absent")
    const parsed = parseLifecyclePolicy(APP_LIFECYCLE, null)
    expect(parsed.kind).toBe("policy")
    if (parsed.kind !== "policy") throw new Error("narrowing")
    expect(parsed.rules).toHaveLength(2)
    expect(parsed.rules[0].priority).toBe(1)
  })
})
