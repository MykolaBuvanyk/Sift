# syntax=docker/dockerfile:1.7
FROM node:22.22.0-alpine3.22 AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY src/contracts/package.json ./src/contracts/package.json
COPY src/server/package.json ./src/server/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS source
COPY tsconfig.json tsconfig.base.json next.config.ts ./
COPY drizzle ./drizzle
COPY src ./src

FROM source AS backend-builder
RUN npm run build:backend

FROM source AS dashboard-builder
RUN npm run build --workspace=@sift/contracts && npm run build:dashboard

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.22.0-alpine3.22 AS backend-runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-builder --chown=node:node /app/dist ./dist
COPY --from=backend-builder --chown=node:node /app/drizzle/migrations ./drizzle/migrations
COPY --from=backend-builder --chown=node:node /app/package.json ./package.json
COPY --from=backend-builder --chown=node:node /app/src/contracts/package.json ./src/contracts/package.json
COPY --from=backend-builder --chown=node:node /app/src/contracts/dist ./src/contracts/dist
COPY --from=backend-builder --chown=node:node /app/src/server/package.json ./src/server/package.json

USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/api/main.js"]

FROM node:22.22.0-alpine3.22 AS dashboard-runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY --from=dashboard-builder --chown=node:node /app/.next/standalone ./
COPY --from=dashboard-builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
