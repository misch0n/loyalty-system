# syntax=docker/dockerfile:1
#
# @cafe/web — the SPA, built and served by nginx.
#
# ⚠ THIS IMAGE DOES NOT BUILD YET, AND THAT IS THE EXPECTED STATE.
#
# Phase 6 retired the IndexedDB prototype and left the screens that used it in
# place; `tsc -b` fails and so does `vite build`. The maintainer chose that on
# 2026-09-16 (SCOPE-DECISIONS §6): the backend is built first, and the UI is
# adjusted to it afterwards. So the `web` service sits behind a Compose profile
# and `docker compose up` brings up the database and the API without it — see
# `compose.yml` and `ops/README.md`.
#
# Everything here is written and reviewed against the server it has to talk to,
# so the UI pass inherits a working proxy rather than starting one. What it will
# need to change: nothing in this file, once the SPA compiles.

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# The SPA's devDependencies include `puppeteer`, which downloads a browser on
# install for the e2e suite. Nothing in an image build runs it.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --include-workspace-root --workspace @cafe/shared --workspace @cafe/web

COPY packages/shared packages/shared
COPY packages/web packages/web

# `vite.config.ts` still defaults `base` to `/loyalty-system/` for the GitHub
# Pages demo that Phase 6 deleted. Served from nginx the app lives at the root.
# (Register row X5: what the SPA's environment should actually be is a UI-pass
# decision — this is the one value the bundle cannot do without.)
ENV VITE_BASE=/
RUN npm run build --workspace @cafe/web

# --- runtime ----------------------------------------------------------------
#
# `nginx-unprivileged` runs as uid 101 and listens on 8080. The stock `nginx`
# image starts as root to bind port 80 and then drops privileges for its workers,
# which is one more root process than this needs.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --chown=nginx:nginx ops/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/packages/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1"]
