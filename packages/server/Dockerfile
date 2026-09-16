# syntax=docker/dockerfile:1
#
# @cafe/server — the API and the one-shot migrate container (they are the same
# image with a different command; the migration files have to travel with the
# code that applies them).
#
# Built from the REPO ROOT, not from this directory: `@cafe/shared` is a workspace
# package resolved through the root `node_modules`, so a context rooted here could
# not install it. See `compose.yml`.
#
# Debian slim rather than Alpine on purpose. `argon2` is a native module, and it
# ships prebuilt binaries for glibc; on musl it falls back to compiling, which
# means a toolchain in the build stage and a class of failure that only shows up
# on someone else's machine. Boring beats small here.

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Manifests first, so an ordinary code change reuses the install layer. All four
# are needed even though only two are installed: npm reads every workspace named
# in the root `package.json` before it resolves anything.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Scoped to the two workspaces that ship. Installing the whole tree would pull
# the SPA's devDependencies — `puppeteer` among them, which downloads a browser.
# The root is included because `typescript` lives there.
RUN npm ci --include-workspace-root --workspace @cafe/shared --workspace @cafe/server

COPY packages/shared packages/shared
COPY packages/server packages/server

# `prebuild` compiles `@cafe/shared` first — its `exports` map points at `dist`,
# so the server cannot typecheck against it until it exists.
RUN npm run build --workspace @cafe/server

# Drop the devDependencies the runtime stage would otherwise carry: `typescript`,
# `vitest`, `tsx` and the `@types/*` packages. The runtime stage copies the root
# `node_modules` only, which is safe exactly as long as everything a running
# server needs hoists there — so that stops being an assumption and becomes a
# build failure.
#
# It looks for a `package.json`, not for a directory. `@types/node` does not hoist
# (the workspaces pin different versions), so `npm prune` deletes it and leaves the
# empty `@types/` scope directory standing — which a directory check reads as a
# stranded dependency and fails the build on. A package is a `package.json`; an
# empty directory the runtime stage would not miss is not.
RUN npm prune --omit=dev \
 && if find packages -path '*/node_modules/*/package.json' | grep -q .; then \
      echo 'ERROR: a production dependency did not hoist to the root node_modules;' >&2; \
      echo 'the runtime stage copies only /app/node_modules and would miss it.' >&2; \
      find packages -path '*/node_modules/*/package.json' >&2; \
      exit 1; \
    fi

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# An allow-list, not a copy of the build stage: `dist/` is production code only
# (`tsconfig.build.json` excludes `**/*.test.ts` and `src/testing/`), so the
# shipped image contains no SMTP sink, no HTTP harness and no conformance suite.
# `node_modules/@cafe/shared` is a symlink into `packages/shared`, which is why
# that package's manifest and `dist` come along.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/packages/server/package.json packages/server/package.json
COPY --from=build --chown=node:node /app/packages/server/dist packages/server/dist
COPY --from=build --chown=node:node /app/packages/server/migrations packages/server/migrations

# `node` is an unprivileged user the base image already provides. Nothing here is
# written to at runtime — the database holds the state — so there is no directory
# that needs to be writable.
USER node
WORKDIR /app/packages/server

EXPOSE 3000

# Overridden to `dist/migrate.js` by the one-shot migrate service. The server
# installs its own SIGTERM handler and drains in-flight requests, so it must
# receive the signal directly — no shell form, no init wrapper swallowing it.
CMD ["node", "dist/index.js"]
