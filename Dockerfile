# ── build: full toolchain, builds webs + server ─────────────────────
# Node pinned to the exact engines version — the image tag itself is
# the guarantee inside the build (.npmrc's engine-strict only guards
# local and CI installs; .npmrc arrives after COPY . .). Bookworm
# (glibc), not Alpine — better-sqlite3 ships glibc prebuilds only.
FROM node:22.23.2-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/web-mobile/package.json apps/web-mobile/
COPY packages/contract/package.json packages/contract/

# The prepare script (simple-git-hooks) needs a .git directory that does
# not exist in a build context — drop it after the manifests land and
# before pnpm install. The later `COPY . .` overwrites package.json with
# the original from the context; that is harmless, because prepare only
# runs during install and nothing installs again.
RUN npm pkg delete scripts.prepare
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ── runtime: monorepo relative layout, node_modules carried over ────
# The layout is preserved on purpose: config.ts resolves the repository
# root by finding pnpm-workspace.yaml at startup, and the server reads
# apps/server/package.json for its version. node_modules is copied
# wholesale from the build stage, dev dependencies included.
FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web-mobile/dist ./apps/web-mobile/dist
COPY --from=build /app/packages/contract ./packages/contract

# The server binds TOBY_HOST (compose sets 0.0.0.0); data comes from the
# mounted volume. No HEALTHCHECK here — compose owns the probe, because
# the auth exemption surface determines whether /api/system/health is
# reachable (see compose.yaml).
EXPOSE 8629

CMD ["node", "--env-file-if-exists=.env", "apps/server/dist/main.js"]
