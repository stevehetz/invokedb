#!/bin/sh
# Writes the browser's runtime env (/env.txt, read by src/root.vue) from the container env, then
# starts Caddy.
set -eu
api="https://${API_DOMAIN}"
cat > /srv/env.txt <<EOF
{
    "ENV": "production",
    "LOG_LEVEL": "INFO",
    "HORIZON_BE_PUB_HTTP_URL": "${api}",
    "HORIZON_PRC_PUB_HTTP_URL": "${api}",
    "HORIZON_FS_PUB_HTTP_URL": "${api}",
    "HORIZON_API_PUB_HTTP_URL": "${api}/api",
    "HORIZON_SB_PUB_WS_URL": "wss://${WS_DOMAIN}"
}
EOF
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
