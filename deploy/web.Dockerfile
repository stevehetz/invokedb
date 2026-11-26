# Frontend + reverse proxy image (build context: packages/horizon-fe). Caddy serves the built
# site, gets TLS certificates from Let's Encrypt, and proxies the API and websocket subdomains.
# The Caddyfile and entrypoint are mounted by the compose file.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The changelog page (#259): the copy cd.yml publishes before each deploy, if it can be fetched
# and is a list; otherwise the file in the repo stays. Public repo, so no token.
ARG CHANGELOG_URL=https://github.com/stevehetz/invokedb/releases/download/changelog/changelog.json
# Changes on every deploy (release.sh), so Docker's cache never skips the fetch below, also when
# the frontend's files didn't change (a backend-only enhancement still reaches the changelog)
ARG CHANGELOG_STAMP=none
RUN echo "changelog stamp: $CHANGELOG_STAMP" && CHANGELOG_URL="$CHANGELOG_URL" node -e "const f='src/view/pages/changelog/changelog.json'; fetch(process.env.CHANGELOG_URL, { signal: AbortSignal.timeout(20000) }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(j => { if (!Array.isArray(j) || !j.every(e => e && e.date && e.number && e.title)) throw new Error('not a changelog'); require('fs').writeFileSync(f, JSON.stringify(j, null, 4) + '\n'); console.log('changelog: ' + j.length + ' entries from the release'); }).catch(e => console.log('changelog: kept the repo copy (' + e.message + ')'));"
RUN rm -f public/env.txt && npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
