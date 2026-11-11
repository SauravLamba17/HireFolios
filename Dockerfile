# Production image: Next.js standalone server, non-root, migrations + seed on start.
# Built by docker-compose.yml (`docker compose --env-file .env.production up -d --build`).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only (nothing connects during the build); the real values come from .env.production.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads \
    RUN_MIGRATIONS=1 \
    SEED_ON_START=1 \
    MIGRATIONS_DIR=/app/drizzle
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app \
 && mkdir -p /data/uploads && chown app:app /data/uploads
# The standalone folder already holds .next/static and public/ (copied by the postbuild script).
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
