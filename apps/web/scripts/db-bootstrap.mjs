/**
 * Production database bootstrap — versioned, non-destructive, fail-closed.
 *
 * Replaces the pilot-era `prisma db push --skip-generate --accept-data-loss`,
 * which reshaped the live schema from a moving target on every container start
 * and was free to drop columns to get there.
 *
 * What runs here instead is `prisma migrate deploy`: it applies only the
 * migrations in prisma/migrations/ that have not been applied yet, in order,
 * and never invents a destructive step of its own.
 *
 * The pilot database predates the migrations directory — it was built by
 * `db push`, so it has all 39 tables but no `_prisma_migrations` ledger. The
 * baseline migration reproduces exactly that shape (verified by an empty
 * `migrate diff` in both directions), so on such a database we record the
 * baseline as already-applied rather than replaying it over live tables.
 *
 * Concurrency: every task in the ECS service runs this at boot. Prisma takes a
 * Postgres advisory lock for the duration of `migrate deploy`, so parallel
 * starts serialise instead of racing.
 *
 * Failure policy: fail closed. A container that cannot prove its schema is
 * current exits non-zero rather than serving traffic against an unknown shape.
 * ECS deployment circuit breaker (infrastructure/terraform/ecs.tf) then rolls
 * back to the last good task definition.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"

/** Recorded as applied — never replayed — on a pre-migrations pilot database. */
export const BASELINE_MIGRATION = "20260730000000_baseline"

/** A table that exists in every non-empty Tenure database. */
const SENTINEL_TABLE = "Institution"

/**
 * Decide what to do, given what we found in the database.
 *
 * Pure: no I/O, no environment reads. The runner probes, this decides, so the
 * decision table is unit-testable without a Postgres.
 *
 * @param {object} state
 * @param {boolean} state.hasMigrationLedger  `_prisma_migrations` exists
 * @param {boolean} state.hasApplicationTables  the sentinel table exists
 * @returns {{ steps: Array<"baseline"|"deploy">, database: string, reason: string }}
 */
export function planBootstrap({ hasMigrationLedger, hasApplicationTables }) {
  if (hasMigrationLedger) {
    return {
      steps: ["deploy"],
      database: "managed",
      reason: "Migration ledger present — applying any pending migrations.",
    }
  }

  if (hasApplicationTables) {
    return {
      steps: ["baseline", "deploy"],
      database: "legacy-pilot",
      reason:
        `Application tables exist with no migration ledger: this is a pre-migrations ` +
        `database built by \`db push\`. Recording ${BASELINE_MIGRATION} as applied ` +
        `(not replaying it over live tables), then applying anything newer.`,
    }
  }

  return {
    steps: ["deploy"],
    database: "empty",
    reason: "Empty database — applying the full migration history from scratch.",
  }
}

/** Classify a Prisma CLI failure so only connection problems get retried. */
export function isRetryableConnectionError(output) {
  return /P1001|P1002|P1017|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Can't reach database server|Connection refused|server closed the connection/i.test(
    output ?? "",
  )
}

/**
 * Interpret the outcome of a table-existence probe.
 *
 * The distinction that matters: "the table is not there" and "the probe did not
 * run" are the same exit code, and conflating them is dangerous in one specific
 * direction. If a broken probe reads as "absent", both probes read as absent,
 * the plan becomes "empty database", and `migrate deploy` then tries to CREATE
 * TABLE over a populated production schema. So absence must be positively
 * proven by the database saying so; anything else is fatal.
 *
 * @returns {"exists"|"absent"|"retry"|"fatal"}
 */
export function classifyProbeResult({ status, output }) {
  if (status === 0) return "exists"
  const text = output ?? ""
  // P1014 is Prisma's "the underlying table for model X does not exist".
  if (/\bP1014\b/.test(text) || /(relation|table).*does not exist/i.test(text)) return "absent"
  if (isRetryableConnectionError(text)) return "retry"
  return "fatal"
}

// ── Everything below is I/O ───────────────────────────────────────────────────

/**
 * The Prisma CLI ships as its own dependency tree in the runtime image
 * (see Dockerfile: the `prisma-cli` stage) because the standalone Next build
 * does not carry dev dependencies. Locally, fall back to the workspace copy.
 */
function prismaCommand() {
  // Invoke the CLI's entrypoint with node directly rather than going through
  // npx: Node 20+ refuses to spawn `npx.cmd` without a shell (CVE-2024-27980),
  // which fails in a way that looks exactly like "the table is not there".
  // These two are cwd-relative and MUST stay in this order: the container path
  // first, so the runtime image keeps using its own dedicated CLI tree.
  const candidates = [
    "prisma-cli/node_modules/prisma/build/index.js", // runtime image (see Dockerfile)
    "node_modules/prisma/build/index.js", // local + CI, un-hoisted
  ]
  for (const entry of candidates) {
    if (existsSync(entry)) return { cmd: process.execPath, base: [entry] }
  }
  // npm workspaces hoist `prisma` to <monorepo-root>/node_modules, so neither
  // cwd-relative candidate matches when this runs from apps/web. Resolving
  // through Node's own algorithm from this module is hoisting-agnostic and
  // location-agnostic (prisma's package.json exports ./build/index.js).
  try {
    return {
      cmd: process.execPath,
      base: [createRequire(import.meta.url).resolve("prisma/build/index.js")],
    }
  } catch {
    // fall through to npx
  }
  return { cmd: "npx", base: ["prisma"], shell: process.platform === "win32" }
}

function runPrisma(args, { capture = false, input } = {}) {
  const { cmd, base, shell } = prismaCommand()
  const result = spawnSync(cmd, [...base, ...args], {
    input,
    stdio: capture || input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    shell,
    env: process.env,
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`
  // status is null when the process could not be spawned at all — never 0.
  return { ok: result.status === 0, status: result.status, output }
}

/**
 * Probe for a table by asking the database to select from it.
 *
 * Throws rather than guessing when the answer is anything other than a clear
 * yes or a clear no — see classifyProbeResult.
 */
function tableExists(table) {
  const probe = runPrisma(["db", "execute", "--url", process.env.DATABASE_URL, "--stdin"], {
    input: `SELECT 1 FROM "${table}" LIMIT 1;`,
  })

  switch (classifyProbeResult(probe)) {
    case "exists":
      return true
    case "absent":
      return false
    case "retry":
      throw Object.assign(new Error(probe.output), { retryable: true })
    default:
      throw new Error(
        `Could not determine whether table "${table}" exists. Refusing to guess, ` +
          `because guessing "no" would run CREATE TABLE over a live schema.\n${probe.output}`,
      )
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set — refusing to start without a database.")
    process.exit(1)
  }

  // The database may not accept connections the instant the task starts.
  const MAX_ATTEMPTS = 10
  let state
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      state = {
        hasMigrationLedger: tableExists("_prisma_migrations"),
        hasApplicationTables: tableExists(SENTINEL_TABLE),
      }
      break
    } catch (error) {
      if (!error.retryable || attempt === MAX_ATTEMPTS) {
        console.error(`❌ Cannot reach the database after ${attempt} attempt(s).`)
        console.error(error.message)
        process.exit(1)
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 15000)
      console.log(`⏳ Database not reachable (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${backoff}ms`)
      sleep(backoff)
    }
  }

  const plan = planBootstrap(state)
  console.log(`🗃️  Database state: ${plan.database}`)
  console.log(`   ${plan.reason}`)

  for (const step of plan.steps) {
    if (step === "baseline") {
      console.log(`📌 Recording ${BASELINE_MIGRATION} as already applied...`)
      const resolved = runPrisma(["migrate", "resolve", "--applied", BASELINE_MIGRATION], { capture: true })
      // A concurrently-starting task may have won the race and recorded it first.
      if (!resolved.ok && !/already recorded as applied|P3008/i.test(resolved.output)) {
        console.error("❌ Failed to baseline the existing database.")
        console.error(resolved.output)
        process.exit(1)
      }
      console.log(resolved.ok ? "   Baseline recorded." : "   Baseline already recorded by another task.")
    }

    if (step === "deploy") {
      console.log("🚀 Applying pending migrations (prisma migrate deploy)...")
      if (!runPrisma(["migrate", "deploy"]).ok) {
        console.error("❌ Migration failed — refusing to start the server against an unverified schema.")
        console.error("   ECS will roll back to the previous task definition.")
        process.exit(1)
      }
    }
  }

  console.log("✅ Database schema is up to date.")
}

// Only run when executed directly, so tests can import the pure functions.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main()
}
