# Build context is the MONOREPO ROOT, not this directory:
#   docker build -f apps/web/Dockerfile .
# (.github/workflows/deploy.yml passes `context: .` + `file: apps/web/Dockerfile`.)
# The context has to be the root because the single npm-workspaces lockfile
# lives there; every COPY below is therefore root-relative.
FROM node:20-alpine AS base
# openssl is required by Prisma's engines on alpine
RUN apk add --no-cache libc6-compat openssl

# ── deps: install production + dev deps (needed for build) ──────────────────
FROM base AS deps
WORKDIR /app
# Root manifest + the single workspace lockfile. .npmrc carries
# legacy-peer-deps so this resolves the same tree CI does.
COPY package.json package-lock.json .npmrc ./
# Every workspace's manifest must be present before `npm ci`.
COPY apps/web/package.json ./apps/web/
# prisma/ must be present: apps/web's postinstall hook runs `prisma generate`,
# and npm runs a workspace's lifecycle scripts with cwd set to that workspace.
COPY apps/web/prisma ./apps/web/prisma
RUN npm ci --legacy-peer-deps

# ── prisma-cli: self-contained CLI install for runtime migrations ───────────
# Cherry-picking CLI deps from the app tree breaks on transitive modules
# (@prisma/debug, effect, ...) — a real npm install gets the complete tree.
FROM base AS prisma-cli
WORKDIR /cli
RUN npm install --no-save --no-audit --no-fund prisma@6

# ── builder: generate Prisma client and build Next.js ───────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Standalone server bundle (see apps/web/next.config.ts)
ENV NEXT_STANDALONE=1

# Generate Prisma client (schema must be present, no DB connection needed).
# cwd is the monorepo root, so the schema needs an explicit path. Kept even
# though postinstall also generates: a skipped workspace lifecycle script must
# not be able to ship a client-less image.
RUN npx prisma generate --schema apps/web/prisma/schema.prisma

# Build Next.js (output: standalone in apps/web/next.config.ts)
RUN npm run build --workspace apps/web

# Fail the build, not production, if the standalone layout is not what the
# runner stage below copies. next.config.ts pins outputFileTracingRoot to the
# monorepo root, which puts server.js under apps/web/ inside the payload and
# hoists the traced deps to its node_modules/. If that ever changes silently,
# these two assertions are where it surfaces.
RUN test -f apps/web/.next/standalone/apps/web/server.js \
 && test -d apps/web/.next/standalone/node_modules/@prisma/client

# ── runner: minimal production image ────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# The Next payload keeps its apps/web/ prefix — the generated server.js does
# process.chdir(__dirname), so public/ and .next/static must sit beside it.
# The standalone tree also carries the traced node_modules; do NOT add a
# separate node_modules COPY, it would overwrite the traced tree with the full
# dev-dependency tree.
COPY --from=builder /app/apps/web/public                                 ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static     ./apps/web/.next/static

# Prisma CLI (own dependency tree) + schema + bootstrap scripts: the
# entrypoint runs the migration bootstrap against RDS (only reachable in-VPC).
#
# These three are deliberately FLATTENED to /app rather than /app/apps/web.
# Three consumers resolve paths against cwd=/app and none of them take a
# --schema or a --prefix: the ENTRYPOINT's `sh scripts/entrypoint.sh`, the
# prisma-cli probe in scripts/db-bootstrap.mjs, and the Prisma CLI's implicit
# ./prisma/schema.prisma lookup inside `migrate deploy` / `migrate resolve`.
COPY --from=prisma-cli --chown=nextjs:nodejs /cli/node_modules  ./prisma-cli/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma  ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/scripts ./scripts

USER nextjs

EXPOSE 3000

# 127.0.0.1, not localhost: busybox wget prefers ::1 but node binds IPv4 only
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["sh", "scripts/entrypoint.sh"]
