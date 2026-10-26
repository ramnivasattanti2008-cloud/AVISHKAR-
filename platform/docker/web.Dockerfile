# UNTESTED AS AN IMAGE: written on a machine whose Docker engine could not run, so `docker build` has never been run on this file.
# The layout it builds was run outside Docker: `next build` with output "standalone", the static files and the public folder (which
# holds the map's worker files) copied beside server.js, then `node server.js`; `pnpm smoke` against it passed, and /api through it
# reached the API.
#
#   docker build -f platform/docker/web.Dockerfile --build-arg API_URL=http://api:8080 -t avishkar-web platform
#
# API_URL is read when the app is BUILT (the proxy rewrite of /api/* is fixed then, not at start), so it is a build argument.
FROM node:24-slim AS build

ARG API_URL=http://api:8080
ARG NEXT_PUBLIC_OSM_TILE_URL=
ENV API_URL=${API_URL} NEXT_PUBLIC_OSM_TILE_URL=${NEXT_PUBLIC_OSM_TILE_URL} NEXT_TELEMETRY_DISABLED=1 CI=true
RUN npm install -g pnpm@11.25.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY api/package.json api/package.json
COPY web ./web
RUN pnpm install --frozen-lockfile --filter @avishkar/web... && pnpm --filter @avishkar/web build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# the standalone output of a workspace keeps the app under web/ and the packages it needs under node_modules/
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public

RUN useradd --system --no-create-home --uid 10001 web
USER web

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "web/server.js"]
