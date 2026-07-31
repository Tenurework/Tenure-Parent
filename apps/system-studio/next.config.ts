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
  ],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }]
  },
}

export default nextConfig
