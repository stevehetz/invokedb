# The React example's server (examples/react-demo, #340), served at
# https://examples.<SITE_DOMAIN>/react-demo by Caddy. Build context: examples/ (the app imports
# the invokedb client from examples/invokedb-node). The server uses only Node's own modules, so
# the runtime image has no node_modules.
FROM node:22-slim AS build
WORKDIR /examples/react-demo
COPY react-demo/package.json react-demo/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY invokedb-node/src /examples/invokedb-node/src
COPY react-demo/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /examples/react-demo/package.json ./
COPY --from=build /examples/react-demo/server ./server
COPY --from=build /examples/react-demo/seed/seed.json ./seed/seed.json
COPY --from=build /examples/react-demo/dist ./dist
RUN rm -rf server/test
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
