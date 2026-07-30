import { z } from "zod"

/**
 * Boot-time environment contract.
 *
 * The application had no environment validation: a missing `AUTH_SECRET`, a
 * placeholder left over from CI, or a dev-login flag inherited into a real
 * environment all started the server successfully and failed later — as a
 * runtime error for one user, or not at all.
 *
 * `validateEnv` is pure so the dangerous combinations can be asserted in tests
 * rather than discovered in an environment. `assertEnv` is what runs at
 * startup (src/instrumentation.ts) and refuses to boot.
 */

/** Placeholders that exist so builds and tests can run. None may reach production. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "ci-build-secret-not-for-production", // .github/workflows/ci.yml
  "e2e-test-secret", // .github/workflows/ci.yml
  "e2e-job-secret", // .github/workflows/ci.yml
  "REPLACE_ME_AFTER_DEPLOY", // infrastructure/terraform/secrets.tf default
  "changeme",
  "secret",
  "development",
])

const flag = z
  .string()
  .optional()
  .transform((v) => v === "true")

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — the server cannot resolve tenant data without it")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgresql:// connection string"),

  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required — sessions cannot be signed without it"),
  NEXTAUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: flag,

  // Pilot sign-in with no password. See src/lib/auth.ts.
  AUTH_DEV_LOGIN: flag,
  ALLOW_DEV_LOGIN_IN_PRODUCTION: flag,
  // Interim shared secret in front of it. See src/lib/dev-login.ts.
  DEV_LOGIN_PASSPHRASE: z.string().optional(),

  OKTA_ISSUER: z.string().optional(),
  OKTA_CLIENT_ID: z.string().optional(),
  OKTA_CLIENT_SECRET: z.string().optional(),

  JOB_SECRET: z.string().optional(),
  S3_DOCUMENTS_BUCKET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  IMAGE_TAG: z.string().optional(),
})

export type Env = z.infer<typeof schema>

export type EnvProblem = {
  variable: string
  message: string
  /** `fatal` refuses to boot. `warning` is reported and allowed. */
  level: "fatal" | "warning"
}

export type EnvValidation =
  | { ok: true; env: Env; problems: EnvProblem[] }
  | { ok: false; env: null; problems: EnvProblem[] }

/** True for URLs that never leave the machine, so no cookie crosses a network. */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1"
  } catch {
    return false
  }
}

function oktaConfigured(env: Partial<Env>): boolean {
  return Boolean(env.OKTA_ISSUER?.startsWith("https://") && env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET)
}

/** Any environment-shaped bag of values. `process.env` satisfies this. */
export type RawEnv = Record<string, string | undefined>

/**
 * Validate a raw environment. Pure — takes the values, returns the verdict.
 */
export function validateEnv(raw: RawEnv): EnvValidation {
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    return {
      ok: false,
      env: null,
      problems: parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "(unknown)"),
        message: issue.message,
        level: "fatal" as const,
      })),
    }
  }

  const env = parsed.data
  const isProduction = env.NODE_ENV === "production"
  const problems: EnvProblem[] = []
  const fatal = (variable: string, message: string) => problems.push({ variable, message, level: "fatal" })
  const warn = (variable: string, message: string) => problems.push({ variable, message, level: "warning" })

  if (isProduction) {
    // The control that matters most. `dev-login` signs in any seeded email with
    // no password, and the seeded set includes an OSE_DIRECTOR. Leaving it on
    // is a deliberate pilot posture, so it must be stated deliberately —
    // inheriting it from a copied task definition must not be enough.
    if (env.AUTH_DEV_LOGIN && !env.ALLOW_DEV_LOGIN_IN_PRODUCTION) {
      fatal(
        "AUTH_DEV_LOGIN",
        "Passwordless dev sign-in is enabled in production. Anyone who can reach the site " +
          "can sign in as any seeded account, including the OSE Director. Configure Okta and " +
          "set AUTH_DEV_LOGIN=false, or acknowledge the pilot posture explicitly with " +
          "ALLOW_DEV_LOGIN_IN_PRODUCTION=true.",
      )
    }

    if (env.AUTH_DEV_LOGIN && env.ALLOW_DEV_LOGIN_IN_PRODUCTION) {
      // Acknowledged is not the same as defended. While passwordless sign-in is
      // reachable from a public URL, the interim gate is mandatory, not optional
      // — otherwise "acknowledged" just means the door is open on purpose.
      if (!env.DEV_LOGIN_PASSPHRASE) {
        fatal(
          "DEV_LOGIN_PASSPHRASE",
          "Passwordless dev sign-in is enabled in production with no access passphrase. " +
            "Set DEV_LOGIN_PASSPHRASE (Terraform provisions one into Secrets Manager as " +
            "tenure-pilot/dev-login), or turn AUTH_DEV_LOGIN off.",
        )
      } else if (env.DEV_LOGIN_PASSPHRASE.length < 12) {
        fatal(
          "DEV_LOGIN_PASSPHRASE",
          `The access passphrase is ${env.DEV_LOGIN_PASSPHRASE.length} characters; it is the only ` +
            `thing standing in front of a passwordless OSE_DIRECTOR login. Use at least 12.`,
        )
      } else {
        warn(
          "AUTH_DEV_LOGIN",
          "Passwordless dev sign-in is enabled in production behind an interim passphrase. " +
            "This must not outlive the pilot — Okta is the fix.",
        )
      }
    }

    // Neither sign-in path configured is not a security hole, but it is a site
    // nobody can log into — better caught at boot than by a user.
    if (!env.AUTH_DEV_LOGIN && !oktaConfigured(env)) {
      fatal(
        "OKTA_ISSUER",
        "No sign-in method is configured: dev login is off and Okta is incomplete " +
          "(needs OKTA_ISSUER as https://…, OKTA_CLIENT_ID and OKTA_CLIENT_SECRET).",
      )
    }

    if (KNOWN_PLACEHOLDER_SECRETS.has(env.AUTH_SECRET)) {
      fatal("AUTH_SECRET", "AUTH_SECRET is a known build/test placeholder. Sessions would be forgeable.")
    } else if (env.AUTH_SECRET.length < 32) {
      fatal("AUTH_SECRET", `AUTH_SECRET is ${env.AUTH_SECRET.length} characters; production requires at least 32.`)
    }

    // `next start` runs with NODE_ENV=production, so the e2e suite and any
    // local production-mode run land here too. The risk being guarded is a
    // session cookie crossing a network in clear, which a loopback address
    // does not do — so require https only where there is a wire.
    if (env.NEXTAUTH_URL && !env.NEXTAUTH_URL.startsWith("https://") && !isLoopback(env.NEXTAUTH_URL)) {
      fatal("NEXTAUTH_URL", "NEXTAUTH_URL must be https in production — session cookies would be sent in clear.")
    }

    if (env.JOB_SECRET && KNOWN_PLACEHOLDER_SECRETS.has(env.JOB_SECRET)) {
      fatal("JOB_SECRET", "JOB_SECRET is a known test placeholder; the scheduled-job endpoint would be callable.")
    }

    if (!env.JOB_SECRET) {
      // The route already fails closed with a 503, so this is a broken feature,
      // not an open door.
      warn("JOB_SECRET", "JOB_SECRET is not set — /api/jobs/reminders will refuse every request and no deadline reminders will send.")
    }

    if (!env.S3_DOCUMENTS_BUCKET) {
      warn("S3_DOCUMENTS_BUCKET", "S3_DOCUMENTS_BUCKET is not set — document upload is disabled.")
    }
  }

  const isFatal = problems.some((p) => p.level === "fatal")
  return isFatal ? { ok: false, env: null, problems } : { ok: true, env, problems }
}

/** Format a validation result for a container log. */
export function formatEnvProblems(problems: EnvProblem[]): string {
  return problems
    .map((p) => `  ${p.level === "fatal" ? "✗" : "!"} ${p.variable}: ${p.message}`)
    .join("\n")
}

/**
 * Validate `process.env` and throw if the server must not start.
 */
export function assertEnv(raw: RawEnv = process.env): Env {
  const result = validateEnv(raw)
  const warnings = result.problems.filter((p) => p.level === "warning")

  if (warnings.length > 0) {
    console.warn(`⚠️  Environment warnings:\n${formatEnvProblems(warnings)}`)
  }

  if (!result.ok) {
    const fatals = result.problems.filter((p) => p.level === "fatal")
    throw new Error(
      `Refusing to start: the environment is not safe to serve with.\n${formatEnvProblems(fatals)}\n` +
        `See docs/RUNBOOK.md for what each variable is for.`,
    )
  }

  return result.env
}
