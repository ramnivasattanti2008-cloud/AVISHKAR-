# UNTESTED AS AN IMAGE: written on a machine whose Docker engine could not run, so `docker build` has never been run on this file.
# The commands in it are the ones DEPLOYMENT.md says were run on the development machine: pnpm install, `pnpm build`,
# `node dist/server.js`, `pnpm db:migrate`.
#
#   docker build -f platform/docker/api.Dockerfile -t avishkar-api platform
#
# The image keeps the whole workspace install of the API, development packages included, so that the same image can run the
# one-off commands that need them (`pnpm db:migrate`, `pnpm db:seed`, `pnpm db:make-admin <email>`). It is therefore larger than
# a runtime-only image would be: trimming it is an optimisation nobody has measured the need for.
FROM node:24-slim

ENV NODE_ENV=production CI=true
# the lock file pins pnpm through the "packageManager" field of platform/package.json
RUN npm install -g pnpm@11.25.0 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY web/package.json web/package.json
COPY api ./api
# development packages are needed to build (typescript, prisma's CLI): NODE_ENV=production would skip them
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @avishkar/api... \
    && pnpm --filter @avishkar/api build

WORKDIR /app/api
RUN useradd --system --no-create-home --uid 10001 api && chown -R api /app/api
USER api

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
