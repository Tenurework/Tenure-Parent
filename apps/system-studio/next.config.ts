import path from "node:path"
import type { NextConfig } from "next"

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // This console must never be indexed. It is not reachable without credentials,
  // but a hostname in a search index is a hostname someone starts guessing at.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
]

const nextConfig: NextConfig = {
  /**
   * Version-skew protection.
   *
   * Without this, someone with the page open during a deploy holds HTML and a
   * client bundle from the old build while the server serves the new one. The
   * router then requests chunks that no longer exist and React throws
   * "Application error: a client-side exception has occurred" — which is what a
   * user hit after three redeploys in an afternoon.
   *
   * With a deployment id, assets are requested as `?dpl=<id>`, a mismatched
   * request 404s, and Next recovers with a hard navigation instead of failing.
   * The value must be IDENTICAL at build and at run time, which is why the
   * Dockerfile bakes it in rather than the task definition supplying it.
   */
  deploymentId: process.env.DEPLOYMENT_ID,
  // Self-contained server bundle for the container.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  transpilePackages: [
    "@tenure/configuration",
    "@tenure/blueprints",
    "@tenure/organization-model",
    "@tenure/module-runtime",
    "@tenure/modules",
    "@tenure/releases",
    "@tenure/platform-config",
    "@tenure/provisioning",
  ],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }]
  },
}

export default nextConfig
