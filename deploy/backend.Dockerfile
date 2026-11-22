# Backend image (build context: packages/horizon-be). One image runs every role; the compose
# file picks the roles per container with the IS_HORIZON_* vars.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=optional skips the native Postgres log transport (needs a C toolchain)
RUN npm ci --omit=optional --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --omit=optional --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Upload/processing share (a named volume; it takes this ownership when first created)
RUN mkdir -p /data/files/temp && chown -R node:node /data
USER node
CMD ["node", "dist/main.js"]
