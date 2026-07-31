# The System Studio — the Tenure platform engine.
#
# Built from the monorepo root, because the app imports workspace packages
# (@tenure/configuration, @tenure/blueprints, @tenure/modules …) that live
# outside apps/system-studio and are resolved through the root lockfile.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc* ./
COPY apps/system-studio/package.json apps/system-studio/
# Every workspace's manifest, because npm ci resolves the whole workspace graph
# and fails on a missing one even when nothing here imports it.
COPY apps/web/package.json apps/web/
COPY packages/ packages/
COPY blueprints/package.json blueprints/
COPY modules/package.json modules/
# --ignore-scripts: apps/web's postinstall runs `prisma generate`, which this
# image has no schema for and no need of.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/ packages/
COPY blueprints/ blueprints/
COPY modules/ modules/
COPY apps/system-studio/ apps/system-studio/
# A build-time value only: the runtime one arrives from Secrets Manager. Next
# evaluates the auth config while prerendering, and an absent secret fails the
# build rather than the deploy.
ENV AUTH_SECRET=build-time-only-not-the-runtime-secret
RUN npm run build --workspace apps/system-studio

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S studio -u 1001

COPY --from=builder --chown=studio:nodejs /app/apps/system-studio/.next/standalone ./
COPY --from=builder --chown=studio:nodejs /app/apps/system-studio/.next/static ./apps/system-studio/.next/static

USER studio
EXPOSE 3100

# The standalone server, at the path Next writes it to when the tracing root is
# the monorepo root rather than the app directory.
CMD ["node", "apps/system-studio/server.js"]
