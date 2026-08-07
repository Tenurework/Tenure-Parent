/**
 * Refuses to run the destructive seed against a database it was not meant to
 * reset.
 *
 * `scripts/seed.mjs` is a development and e2e fixture, not a data pipeline. It
 * issues deletes to reset test state, and one of them —
 * `db.approvalDelegation.deleteMany({})` — carries no tenant filter at all, so
 * it removes every approval delegation in the database including rows a
 * customer created. `scripts/entrypoint.sh` says exactly this in prose, but the
 * protection it offers is one environment variable deep: `SEED_ON_BOOT=true` on
 * any task, or a `seed` command override, and the deletes run. A copied task
 * definition, a manual `aws ecs run-task`, or a local shell pointed at
 * DATABASE_URL by mistake all reach them with nothing in between.
 *
 * This module is the refusal that lives with the deletes rather than beside
 * them. `infrastructure/terraform/ecs.tf` sets `NODE_ENV=production` on the
 * pilot task definition, so the production branch below is what a redeploy —
 * boot, scale-out, health-check replacement, or a hand-run task — actually
 * meets.
 *
 * Pure: no I/O, and it reads no environment of its own. seed.mjs passes the
 * environment in, this decides, so the whole decision table is unit-testable
 * without a Postgres and without mutating `process.env`. It is the same split
 * as `planBootstrap` in db-bootstrap.mjs.
 */

/** The one explicit opt-in. Nothing else turns a refusal back into a run. */
export const OPT_IN_VAR = "SEED_DESTRUCTIVE"

/**
 * Hosts whose database is the developer's own machine. Anything else — RDS, a
 * staging box, a colleague's tunnel — is somebody's data.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/**
 * The host DATABASE_URL points at, or `null` when the URL cannot be read.
 *
 * Only the host is ever returned: the URL carries the database password, and
 * the refusal message this feeds is printed to container logs.
 *
 * @param {string} databaseUrl
 * @returns {string|null}
 */
function hostOf(databaseUrl) {
  try {
    const host = new URL(databaseUrl).hostname
    return host === "" ? null : host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The reason this environment must not be reset, or `null` if it may be.
 *
 * @param {string} nodeEnv  already trimmed; "" means unset
 * @param {string|undefined} databaseUrl
 * @returns {string|null}
 */
function whyRefused(nodeEnv, databaseUrl) {
  if (nodeEnv === "production") {
    return (
      'NODE_ENV is "production". This seed deletes rows it did not create — ' +
      "`approvalDelegation.deleteMany({})` is unscoped across every tenant — so " +
      "it must not run against a production database, on a redeploy or otherwise."
    )
  }

  // NODE_ENV unset is the local-shell and one-off-task case: nothing has
  // declared what this database is, so the URL has to say. A URL that is
  // present but unreadable is treated as unproven, not as absent — the only
  // safe reading of a host we cannot see.
  if (nodeEnv === "") {
    const url = typeof databaseUrl === "string" ? databaseUrl.trim() : ""
    if (url === "") return null

    const host = hostOf(url)
    if (host === null) {
      return (
        "NODE_ENV is unset and DATABASE_URL cannot be parsed, so the database " +
        "it points at cannot be shown to be a local one."
      )
    }
    if (!LOCAL_HOSTS.has(host)) {
      return (
        `NODE_ENV is unset and DATABASE_URL points at "${host}", which is not a ` +
        "local database. Only a database on this machine may be reset by a fixture."
      )
    }
  }

  return null
}

/**
 * Decide whether the destructive seed may run.
 *
 * @param {object} env
 * @param {string} [env.nodeEnv]          process.env.NODE_ENV
 * @param {string} [env.databaseUrl]      process.env.DATABASE_URL
 * @param {string} [env.seedDestructive]  process.env.SEED_DESTRUCTIVE
 * @returns {{ allowed: boolean, reason: string }}
 */
export function decideSeedAllowed({ nodeEnv, databaseUrl, seedDestructive } = {}) {
  const env = typeof nodeEnv === "string" ? nodeEnv.trim() : ""
  const refusal = whyRefused(env, databaseUrl)

  if (refusal === null) {
    return {
      allowed: true,
      reason: `NODE_ENV is ${env === "" ? "unset and DATABASE_URL is local" : `"${env}"`} — a database a fixture may reset.`,
    }
  }

  // The opt-in is deliberately exact-match "true": an operator who means to
  // reset a production database has to type the whole word, and a stray "1" or
  // "yes" inherited from somewhere else does not silently arm the deletes.
  if (seedDestructive === "true") {
    return {
      allowed: true,
      reason: `${refusal} Overridden by ${OPT_IN_VAR}="true".`,
    }
  }

  return {
    allowed: false,
    reason: `${refusal} Set ${OPT_IN_VAR}="true" on the task or shell that runs it to override this deliberately.`,
  }
}
