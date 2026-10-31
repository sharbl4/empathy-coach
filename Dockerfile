FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
RUN test ! -e apps/api/dist/server.js && test ! -e apps/api/dist/app.js

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./apps/api/migrations
COPY --from=build --chown=node:node /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build --chown=node:node /app/apps/bot/dist ./apps/bot/dist
COPY --from=build --chown=node:node /app/scripts/bot-health.mjs ./scripts/bot-health.mjs
RUN test ! -e node_modules/fastify && test ! -e node_modules/@supabase/supabase-js && test ! -e apps/web
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node","scripts/bot-health.mjs"]
CMD ["node","apps/bot/dist/main.js"]
