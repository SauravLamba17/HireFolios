# Caddy with the Cloudflare DNS plugin (needed for option A; harmless for option B).
FROM caddy:2.10-builder-alpine AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.10-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
