import {
  ALL_SERVICES,
  PARTITION_SERVICES,
  PartitionServiceError,
  requireService,
  serviceAvailableHere,
  serviceAvailableIn,
  type ServiceId,
} from "./partition-services"
import { ALL_PARTITIONS, __resetCellContext } from "./cell-context"

/**
 * GE-010-007 — the partition is resolved, and now something asks it a question.
 *
 * The test that carries the item is the last one: a cell running in `aws-cn`
 * with a perfectly valid `ANTHROPIC_API_KEY` must report the assistant as
 * unavailable, because `api.anthropic.com` is a public-internet endpoint the
 * partition does not contain. Before this, `aiConfigured()` was a key check and
 * returned true, and tenant content went to a commercial SaaS endpoint from a
 * cell whose whole reason for existing is that it does not do that.
 *
 * The matrix tests exist so the decision is a decision: a partition row that is
 * quietly widened has to fail something.
 */

const ORIGINAL_ENV = { ...process.env }

/**
 * `NODE_ENV` is typed read-only by Next's globals, and one test below genuinely
 * needs to move it: an unrecognised `AWS_PARTITION` only survives resolution in
 * production mode — outside it `cellContext()` falls back wholesale to the
 * development defaults, which are commercial `aws`.
 */
function setNodeEnv(value: string): void {
  Reflect.set(process.env, "NODE_ENV", value)
}

/** Put this process in a partition, the way the task definition would. */
function runningIn(partition: string, region: string): void {
  process.env.AWS_PARTITION = partition
  process.env.AWS_ACCOUNT_ID = "047385673922"
  process.env.AWS_REGION = region
  process.env.DEPLOY_ENVIRONMENT = "production"
  process.env.CELL_ID = "cell-test-a"
  __resetCellContext()
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  __resetCellContext()
})

/**
 * The guard that has to hold when nobody is looking.
 *
 * Every assertion below iterates `ALL_SERVICES` and `ALL_PARTITIONS` rather
 * than naming services, so a service added tomorrow is covered by tests written
 * today. That is the whole point: the previous version of this file named `s3`
 * and `anthropic-public-api` in hand-written assertions, and a third service was
 * therefore checked by nothing at all.
 */
describe("every service has a decision, in every partition", () => {
  it("reads a non-empty matrix on both axes", () => {
    // A loop over an empty collection asserts nothing and reports clean. If the
    // derivation of either list breaks, this suite must fail rather than pass
    // emptily — every test below is a loop over one of these two.
    expect(ALL_SERVICES.length).toBeGreaterThan(0)
    expect(ALL_PARTITIONS.length).toBeGreaterThan(0)
  })

  it("decides every service against every partition explicitly", () => {
    // The one good state, asserted positively: a boolean somebody wrote down
    // for each cell of the grid. Not "the ones I remembered are right".
    for (const service of ALL_SERVICES) {
      for (const partition of ALL_PARTITIONS) {
        expect(typeof serviceAvailableIn(service, partition)).toBe("boolean")
      }
    }
  })

  it("has no service that is unreachable everywhere", () => {
    // A row of all-`false` is not a decision, it is a service somebody added and
    // never finished thinking about — and its symptom is a feature that is off
    // in the commercial partition with a refusal message blaming the partition.
    for (const service of ALL_SERVICES) {
      const reachableIn = ALL_PARTITIONS.filter((partition) =>
        serviceAvailableIn(service, partition),
      )
      expect(reachableIn.length).toBeGreaterThan(0)
    }
  })

  it("agrees with the partition-keyed view of itself", () => {
    // `PARTITION_SERVICES` is derived, and this is what "derived" has to mean:
    // no service appears in a partition row that the service-keyed table denies,
    // and none is missing from one the table allows.
    for (const partition of ALL_PARTITIONS) {
      const offered = PARTITION_SERVICES[partition]
      expect(offered).toBeDefined()
      for (const service of ALL_SERVICES) {
        expect(offered.has(service)).toBe(serviceAvailableIn(service, partition))
      }
      // Nothing in the row that is not a known service.
      for (const service of offered) {
        expect(ALL_SERVICES).toContain(service)
      }
    }
  })
})

describe("a service with no entry is unavailable, not allowed", () => {
  // `ServiceId` is `keyof` the table, so a service with no row cannot be NAMED
  // in typed code — `requireService("ses")` is a compile error that says so.
  // These cover the untyped ways a name still arrives: a cast, a value read out
  // of config, anything that crossed a JSON boundary.
  const unknownService = "ses-email" as ServiceId

  it("fails closed in every partition, including the commercial one", () => {
    for (const partition of ALL_PARTITIONS) {
      expect(serviceAvailableIn(unknownService, partition)).toBe(false)
    }
  })

  // Every name an object inherits without anyone declaring it. Read off
  // `Object.prototype` rather than listed, so a runtime that adds another
  // inherited member is covered by this test without it being edited.
  const inheritedNames = Object.getOwnPropertyNames(Object.prototype)

  it("treats an inherited property name as no service at all", () => {
    // `key in table` and `table[key]` both walk the prototype chain, so
    // "toString" and "constructor" once answered as though they had a row.
    expect(inheritedNames.length).toBeGreaterThan(0)
    for (const name of inheritedNames) {
      for (const partition of ALL_PARTITIONS) {
        expect(serviceAvailableIn(name as ServiceId, partition)).toBe(false)
      }
      expect(() => requireService(name as ServiceId, "aws")).toThrow(
        /is not a service this build has decided about/,
      )
    }
  })

  it("treats an inherited property name as no partition either", () => {
    for (const name of inheritedNames) {
      expect(serviceAvailableIn("s3", name)).toBe(false)
      expect(() => requireService("s3", name)).toThrow(
        /is not a partition this build knows/,
      )
    }
  })

  it("refuses, and says the service is the thing it cannot vouch for", () => {
    // The distinction matters to whoever reads the log: "not in this partition"
    // sends an operator to the partition, and this is not that problem.
    try {
      requireService(unknownService, "aws")
      throw new Error("should have refused")
    } catch (err) {
      expect(err).toBeInstanceOf(PartitionServiceError)
      expect((err as Error).message).toMatch(/is not a service this build has decided about/)
      expect((err as Error).message).toMatch(/ses-email/)
    }
  })
})

describe("the matrix says what exists where", () => {
  it("keeps the public vendor endpoint commercial-only", () => {
    // Not an AWS service. A GovCloud or China cell has no partition-local route
    // to it, and a configured key does not create one.
    expect(serviceAvailableIn("anthropic-public-api", "aws")).toBe(true)
    expect(serviceAvailableIn("anthropic-public-api", "aws-us-gov")).toBe(false)
    expect(serviceAvailableIn("anthropic-public-api", "aws-cn")).toBe(false)
  })

  it("has S3 in every partition, because S3 really is in every partition", () => {
    // The matrix is a statement about reality, not a convenient way to say no.
    for (const partition of ALL_PARTITIONS) {
      expect(serviceAvailableIn("s3", partition)).toBe(true)
    }
  })

  it("has a row for every partition the context can resolve", () => {
    // A partition added to `cell-context.ts` with no row here would answer
    // "nothing exists" for everything, which is a decision that should be made
    // on purpose rather than discovered in production.
    for (const partition of ALL_PARTITIONS) {
      expect(PARTITION_SERVICES[partition]).toBeDefined()
    }
    expect(Object.keys(PARTITION_SERVICES).sort()).toEqual([...ALL_PARTITIONS].sort())
  })
})

describe("a partition this build cannot name offers nothing", () => {
  // `cellContext()` reports an unrecognised AWS_PARTITION in `unresolved` and
  // still returns the string typed as a Partition — deliberately, so a missing
  // variable does not fail the deploy of a running system. Which means an
  // unreviewed partition string does reach this module.

  it("does not fall through to commercial AWS", () => {
    expect(serviceAvailableIn("s3", "aws-mars")).toBe(false)
    expect(serviceAvailableIn("anthropic-public-api", "aws-mars")).toBe(false)
  })

  it("says it cannot say, rather than saying no", () => {
    try {
      requireService("s3", "aws-mars")
      throw new Error("should have refused")
    } catch (err) {
      expect(err).toBeInstanceOf(PartitionServiceError)
      expect((err as Error).message).toMatch(/is not a partition this build knows/)
      expect((err as Error).message).toMatch(/aws-mars/)
    }
  })
})

describe("requireService names the service and the partition", () => {
  it("throws for a service the partition does not have", () => {
    const err = (() => {
      try {
        requireService("anthropic-public-api", "aws-cn")
      } catch (e) {
        return e as PartitionServiceError
      }
      throw new Error("should have refused")
    })()

    expect(err).toBeInstanceOf(PartitionServiceError)
    expect(err.service).toBe("anthropic-public-api")
    expect(err.partition).toBe("aws-cn")
    // An operator reading a log line needs both halves, or the next question is
    // "which partition was that cell in".
    expect(err.message).toMatch(/anthropic-public-api/)
    expect(err.message).toMatch(/aws-cn/)
  })

  it("passes for a service the partition does have", () => {
    expect(() => requireService("s3", "aws-cn")).not.toThrow()
    expect(() => requireService("s3", "aws-us-gov")).not.toThrow()
    expect(() => requireService("anthropic-public-api", "aws")).not.toThrow()
  })
})

describe("serviceAvailableHere reads the partition this process is in", () => {
  it("answers for aws-cn", () => {
    runningIn("aws-cn", "cn-north-1")
    expect(serviceAvailableHere("s3")).toBe(true)
    expect(serviceAvailableHere("anthropic-public-api")).toBe(false)
  })

  it("answers for aws-us-gov", () => {
    runningIn("aws-us-gov", "us-gov-west-1")
    expect(serviceAvailableHere("anthropic-public-api")).toBe(false)
  })

  it("answers for commercial aws", () => {
    runningIn("aws", "us-east-1")
    expect(serviceAvailableHere("anthropic-public-api")).toBe(true)
  })
})

describe("the assistant is unavailable where the vendor endpoint is not", () => {
  // This is the item. `aiConfigured()` gates every AI surface in the app —
  // /api/ai/chat (`available = flag.enabled && aiConfigured()`), /api/ai/draft
  // (503), the search page's answer block, DraftAssist on the compose/memory/
  // event forms, and the document summary page. One check, every call site.

  it("refuses in aws-cn even with a key configured, and says why", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key-for-tests"
      runningIn("aws-cn", "cn-north-1")

      const { aiConfigured } = await import("./ai")
      expect(aiConfigured()).toBe(false)

      // An operator who set the key and sees the assistant off must not be left
      // hunting for a typo in a variable that is set correctly.
      const said = warn.mock.calls.map((c) => c.join(" ")).join("\n")
      expect(said).toMatch(/aws-cn/)
      expect(said).toMatch(/api\.anthropic\.com is not available/)
    } finally {
      warn.mockRestore()
    }
  })

  it("refuses in aws-us-gov even with a key configured", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key-for-tests"
      runningIn("aws-us-gov", "us-gov-west-1")

      const { aiConfigured } = await import("./ai")
      expect(aiConfigured()).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it("still works in the commercial partition the pilot runs in", async () => {
    // The guard must not turn the assistant off for the cell that has it today.
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key-for-tests"
    runningIn("aws", "us-east-1")

    const { aiConfigured } = await import("./ai")
    expect(aiConfigured()).toBe(true)
  })

  it("still reports unconfigured when there is no key at all", async () => {
    delete process.env.ANTHROPIC_API_KEY
    runningIn("aws", "us-east-1")

    const { aiConfigured } = await import("./ai")
    expect(aiConfigured()).toBe(false)
  })
})

describe("S3 refuses to build a client for a partition nobody decided about", () => {
  it("rejects rather than constructing one for an unrecognised partition", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
      // The bucket is read at module load, so it has to be set before the import.
      process.env.S3_DOCUMENTS_BUCKET = "tenure-documents-test"
      // An unrecognised partition only survives resolution in production mode —
      // outside it, `cellContext()` falls back wholesale to the development
      // defaults, which are commercial `aws`.
      setNodeEnv("production")
      runningIn("aws-mars", "us-east-1")

      const { getDocumentBytes } = await import("./s3")
      // Fails before any network call, at client construction.
      await expect(getDocumentBytes("orgs/1/receipt.pdf")).rejects.toThrow(PartitionServiceError)
    } finally {
      warn.mockRestore()
    }
  })
})
