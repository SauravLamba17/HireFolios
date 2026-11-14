# Hirefolios container image (AWS deploy: docs/DEPLOY-AWS.md). Supported since Phase 5.
# Multi-stage: dependencies → build → a small runtime with only the standalone server, migrations and the PostgreSQL 16
# client tools (pg_dump / pg_restore for the nightly S3 backup). Runs as a non-root user. No secrets in the image: every
# setting comes from the environment file on the server (or AWS SSM Parameter Store) at run time.
#
#   docker build -f deploy/docker/Dockerfile -t hirefolios:<version> .
#
# Node.js major pinned with deploy/windows/versions.json (24); the app refuses another major at start-up.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Nothing connects during the build; real values are given at run time.
RUN npm run build \
 && rm -f .next/standalone/.env .next/standalone/.env.*

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MIGRATIONS_DIR=/app/drizzle \
    LOG_FORMAT=json \
    PG_DUMP_PATH=/usr/bin/pg_dump \
    PG_RESTORE_PATH=/usr/bin/pg_restore
# postgresql16-client: pg_dump / pg_restore matching the pinned PostgreSQL 16; tini: clean shutdown on docker stop
RUN apk add --no-cache postgresql16-client tini \
 && addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
# The standalone folder already holds .next/static and public/ (copied by the postbuild script).
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
