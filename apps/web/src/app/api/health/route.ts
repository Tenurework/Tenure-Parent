import { db } from "@/lib/db"

/**
 * ALB target-group health endpoint — and the only thing watching the database.
 *
 * This check is deliberately deep. RDS manages (and rotates) the master
 * password, while the container composes DATABASE_URL once at boot from
 * DB_CREDS. A task that outlives a rotation therefore holds a dead password
 * and 500s on every page that touches Postgres — but a shallow health check
 * reports that task perfectly healthy, so ECS never replaces it and the
 * outage is permanent. Pinging the DB here makes the state self-healing: the
 * ALB fails the task, ECS starts a fresh one, and it reads the current secret.
 *
 * Blast-radius control: unhealthy_threshold=3 at a 30s interval means the DB
 * must be unreachable for ~90 consecutive seconds before a task is recycled,
 * so a transient blip does not cycle the service.
 */

export const dynamic = "force-dynamic"

// The ALB polls every 30s, but Next can fan out concurrent requests; a short
// cache keeps this from amplifying queries without hiding a real outage.
const CACHE_MS = 5_000
const PING_TIMEOUT_MS = 2_500

let cachedAt = 0
let cachedOk: boolean | null = null

async function pingDatabase(): Promise<boolean> {
  const now = Date.now()
  if (cachedOk !== null && now - cachedAt < CACHE_MS) return cachedOk

  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db ping timeout")), PING_TIMEOUT_MS)
      }),
    ])
    cachedOk = true
  } catch {
    cachedOk = false
  } finally {
    if (timer) clearTimeout(timer)
    cachedAt = Date.now()
  }

  return cachedOk
}

export async function GET() {
  const ok = await pingDatabase()

  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      db: ok ? "ok" : "unreachable",
      version: process.env.IMAGE_TAG ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  )
}
