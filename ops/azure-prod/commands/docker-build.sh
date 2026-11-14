#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../azure-prod-build.values.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/env-helpers/export-env.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/env-helpers/export-env.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

if [ "$1" == "horizon-be" ]; then
  docker build -f ../../../packages/horizon-be/Dockerfile -t horizon-be ../../../packages/horizon-be
elif [ "$1" == "horizon-fe" ]; then
  rm -r $DIR/proxy-server/generated/horizon-fe

  docker build \
    -f ../../../packages/horizon-fe/Dockerfile \
    -t horizon-fe-builder-prod \
    ../../../packages/horizon-fe

  docker run \
    -dit \
    -e "HORIZON_ENV_LOADED=$HORIZON_ENV_LOADED" \
    -e "ENV=$ENV" \
    -e "HORIZON_FS_PUB_HTTP_URL=$HORIZON_FS_PUB_HTTP_URL" \
    -e "HORIZON_SB_PUB_WS_URL=$HORIZON_SB_PUB_WS_URL" \
    -e "HORIZON_FE_PUB_HTTP_PORT=$HORIZON_FE_PUB_HTTP_PORT" \
    -e "HORIZON_BE_PUB_HTTP_URL=$HORIZON_BE_PUB_HTTP_URL" \
    -e "HORIZON_PRC_PUB_HTTP_URL=$HORIZON_PRC_PUB_HTTP_URL" \
    -e "HORIZON_AUTH_FE_PUB_HTTP_URL=$HORIZON_AUTH_FE_PUB_HTTP_URL" \
    -e "HORIZON_API_PUB_HTTP_URL=$HORIZON_API_PUB_HTTP_URL" \
    --name horizon-fe-builder-prod \
    horizon-fe-builder-prod

  docker exec horizon-fe-builder-prod npm run env dist
  mkdir -p $DIR/proxy-server/generated/horizon-fe
  docker cp horizon-fe-builder-prod:/app/dist/. proxy-server/generated/horizon-fe

  docker stop horizon-fe-builder-prod
  docker rm horizon-fe-builder-prod
elif [ "$1" == "horizon-auth-fe" ]; then
  rm -r $DIR/proxy-server/generated/horizon-auth-fe

  docker build \
    -f ../../../packages/horizon-auth-fe/Dockerfile \
    -t horizon-auth-fe-builder-prod \
    ../../../packages/horizon-auth-fe

  docker run \
    -dit \
    -e "HORIZON_ENV_LOADED=$HORIZON_ENV_LOADED" \
    -e "ENV=$ENV" \
    -e "HORIZON_FE_PUB_HTTP_URL=$HORIZON_FE_PUB_HTTP_URL" \
    -e "HORIZON_BE_PUB_HTTP_URL=$HORIZON_BE_PUB_HTTP_URL" \
    -e "HORIZON_AUTH_FE_PUB_HTTP_URL=$HORIZON_AUTH_FE_PUB_HTTP_URL" \
    -e "HORIZON_AUTH_FE_PUB_HTTP_PORT=$HORIZON_AUTH_FE_PUB_HTTP_PORT" \
    --name horizon-auth-fe-builder-prod \
    horizon-auth-fe-builder-prod

  docker exec horizon-auth-fe-builder-prod npm run env dist
  mkdir -p $DIR/proxy-server/generated/horizon-auth-fe
  docker cp horizon-auth-fe-builder-prod:/app/dist/. proxy-server/generated/horizon-auth-fe

  docker stop horizon-auth-fe-builder-prod
  docker rm horizon-auth-fe-builder-prod
elif [ "$1" == "horizon-ops" ]; then
  docker build -f ../../Dockerfile -t horizon-ops ../../../
elif [ "$1" == "nginx-proxy" ]; then
  docker build -f proxy-server/nginx-proxy.Dockerfile -t nginx-proxy proxy-server
elif [ "$1" == "proxy-server" ]; then
  docker build -f proxy-server/proxy-server.Dockerfile -t proxy-server proxy-server
elif [ "$1" == "proxy-server-fs" ]; then
  docker build -f proxy-server/proxy-server-fs.Dockerfile -t proxy-server-fs proxy-server
fi