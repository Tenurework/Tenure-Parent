/**
 * Next.js runs this once per server process, before it serves anything.
 *
 * Validating here means a misconfigured environment is a boot failure with a
 * named variable and a reason, rather than a 500 on whichever page happens to
 * touch the missing value first. In production that boot failure is the point:
 * ECS's deployment circuit breaker rolls back to the last good task definition
 * instead of leaving an unsafe configuration serving traffic.
 */
export async function register() {
  // Edge and browser bundles get a different, much smaller environment; the
  // contract described in src/lib/env.ts only applies to the Node server.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { assertEnv } = await import("@/lib/env")
  assertEnv()
}
