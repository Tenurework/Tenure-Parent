/**
 * GE-012-001 — where this process is running, resolved once and validated.
 *
 * Partition, account, region, environment and cell. Five facts that every AWS
 * client, every residency check and every routing decision depends on, and that
 * were previously spelled `process.env.AWS_REGION ?? "us-east-1"` at each call
 * site.
 *
 * ## Why a default region is the bug, not the convenience
 *
 * A cell deployed in `eu-west-1` whose `AWS_REGION` is unset does not fail. It
 * quietly talks to `us-east-1` — creating S3 objects, invoking models and
 * writing logs in a region the tenant's residency did not permit. Nothing
 * errors, nothing alerts, and the breach is discovered by an audit rather than
 * by the software. `GE-030-001` made residency a checked constraint on the
 * registry record; a `??` in a client constructor walks straight around it.
 *
 * ## What fails closed, and what does not, and why the line is where it is
 *
 * **Region fails closed in production.** It is the field that moves data, and
 * it is the one the task definition already sets (`infrastructure/terraform/
 * ecs.tf`), so requiring it breaks nothing that works today.
 *
 * The other four — partition, account, environment, cell — are **reported as
 * unresolved, not fatal**. Production does not set them yet. Making them
 * required here would fail the next deploy of a system that is currently
 * serving students, to enforce a contract nothing has been updated to meet:
 * the correct order is to add them to the task definition first, then tighten
 * this. `unresolved` names exactly which are missing so that tightening is a
 * decision with a list rather than a guess, and `tests/security` ratchets the
 * list downward.
 *
 * In development everything defaults, loudly, because a developer with no AWS
 * should still be able to run the app.
 *
 * ## Not read at import
 *
 * Resolved on first call and cached, not evaluated when the module loads. A
 * module-level `throw` runs during the import graph, before any error boundary
 * exists, and surfaces as a blank page with a digest — which tells an operator
 * nothing about a missing environment variable.
 */

export type Partition = "aws" | "aws-us-gov" | "aws-cn"
export type DeployEnvironment = "development" | "staging" | "production"

export interface CellContext {
  partition: Partition
  /** Twelve digits. The first question asked in an incident. */
  accountId: string
  region: string
  environment: DeployEnvironment
  /** Which cell this process is. Matches a `cellId` in the cell registry. */
  cellId: string
  /**
   * Whether these were resolved from the environment or fell back.
   *
   * Recorded rather than inferred, because "us-east-1 because we are in
   * us-east-1" and "us-east-1 because nobody said" are the same string and
   * completely different facts.
   */
  resolved: "environment" | "partial" | "development-default"
  /**
   * Fields the environment did not supply, named.
   *
   * Empty when `resolved` is "environment". A caller that cares — a residency
   * check, an audit record — can refuse on a specific gap rather than on a
   * boolean that cannot say which.
   */
  unresolved: readonly string[]
}

export class CellContextError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `This process cannot say where it is running:\n  ${problems.join("\n  ")}\n` +
        `Every AWS client, residency check and routing decision depends on these. ` +
        `Guessing a region is how a tenant's data ends up outside the region its contract allows.`,
    )
    this.name = "CellContextError"
  }
}

const PARTITIONS: ReadonlySet<string> = new Set(["aws", "aws-us-gov", "aws-cn"])
const ENVIRONMENTS: ReadonlySet<string> = new Set(["development", "staging", "production"])

/**
 * The development fallback.
 *
 * Only reachable when `NODE_ENV !== "production"`. Deliberately NOT the pilot's
 * real account id — a developer running with no AWS should not have a real
 * account number in their process, because the one thing worse than no context
 * is a plausible wrong one.
 */
const DEVELOPMENT_DEFAULT: Omit<CellContext, "resolved" | "unresolved"> = {
  partition: "aws",
  accountId: "000000000000",
  region: "us-east-1",
  environment: "development",
  cellId: "cell-local",
}

export function resolveCellContext(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CellContext {
  const isProduction = env.NODE_ENV === "production"
  const problems: string[] = []

  const partition = env.AWS_PARTITION ?? "aws"
  if (!PARTITIONS.has(partition)) {
    problems.push(`AWS_PARTITION="${partition}" is not a partition (aws, aws-us-gov, aws-cn)`)
  }

  const accountId = env.AWS_ACCOUNT_ID ?? ""
  if (!/^\d{12}$/.test(accountId)) {
    problems.push(
      accountId
        ? `AWS_ACCOUNT_ID="${accountId}" is not twelve digits`
        : `AWS_ACCOUNT_ID is not set — "which account did that happen in" has no answer`,
    )
  }

  const region = env.AWS_REGION ?? ""
  if (!/^[a-z]{2}(-gov)?(-iso[a-z]?)?-[a-z]+-\d$/.test(region)) {
    problems.push(
      region
        ? `AWS_REGION="${region}" is not a region name`
        : `AWS_REGION is not set — a default here silently moves data out of the region a contract permits`,
    )
  }

  const environment = env.DEPLOY_ENVIRONMENT ?? ""
  if (!ENVIRONMENTS.has(environment)) {
    problems.push(
      environment
        ? `DEPLOY_ENVIRONMENT="${environment}" is not one of development, staging, production`
        : `DEPLOY_ENVIRONMENT is not set — a production tenant in a staging cell is on staging's backup schedule`,
    )
  }

  const cellId = env.CELL_ID ?? ""
  if (!/^cell-[a-z0-9-]{3,40}$/.test(cellId)) {
    problems.push(
      cellId ? `CELL_ID="${cellId}" is not a cell id` : `CELL_ID is not set`,
    )
  }

  const regionProblem = problems.find((p) => p.startsWith("AWS_REGION"))

  if (problems.length === 0) {
    return {
      partition: partition as Partition,
      accountId,
      region,
      environment: environment as DeployEnvironment,
      cellId,
      resolved: "environment",
      unresolved: [],
    }
  }

  if (isProduction) {
    // Only the region is fatal. See the note at the top: the other four are not
    // in the task definition yet, and failing the deploy of a running system to
    // enforce a contract nothing has been updated to meet is the wrong order.
    if (regionProblem) throw new CellContextError([regionProblem])

    console.warn(
      `[cell-context] ${problems.length} field(s) unresolved in production:\n  ` +
        problems.join("\n  "),
    )
    return {
      partition: partition as Partition,
      accountId: accountId || DEVELOPMENT_DEFAULT.accountId,
      region,
      environment: (ENVIRONMENTS.has(environment) ? environment : "production") as DeployEnvironment,
      cellId: cellId || DEVELOPMENT_DEFAULT.cellId,
      resolved: "partial",
      unresolved: problems,
    }
  }

  // Loud, once. A silent fallback is the thing this module exists to remove,
  // and a developer who never sees the warning has no way to know the values
  // are invented.
  console.warn(
    `[cell-context] using development defaults; ${problems.length} value(s) unresolved:\n  ` +
      problems.join("\n  "),
  )
  return { ...DEVELOPMENT_DEFAULT, resolved: "development-default", unresolved: problems }
}

let cached: CellContext | null = null

/** The context for this process. Resolved on first call, then reused. */
export function cellContext(): CellContext {
  if (!cached) cached = resolveCellContext()
  return cached
}

/** For tests, which need to resolve more than one environment in a process. */
export function __resetCellContext(): void {
  cached = null
}
