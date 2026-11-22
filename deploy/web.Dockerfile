# Frontend + reverse proxy image (build context: packages/horizon-fe). Caddy serves the built
# site, gets TLS certificates from Let's Encrypt, and proxies the API and websocket subdomains.
# The Caddyfile and entrypoint are mounted by the compose file.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN rm -f public/env.txt && npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
