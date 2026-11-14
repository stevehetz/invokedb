#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../env-helpers/export-env.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../env-helpers/export-env.sh

cd ../ssh

echo ""
echo "--Logging into azure"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "az login --service-principal --username $SERVICE_PRINCIPAL_ID --password \"$SERVICE_PRINCIPAL_PW\" --tenant $TENANT_ID"
echo ""
echo "--Logging into azure container registry"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "sudo az acr login --name $CONTAINER_REGISTRY"
echo ""
echo "--Stopping containers"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "sudo docker stop proxy-server"
echo ""
echo "--Removing containers"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "sudo docker rm proxy-server"
echo ""
echo "--Pulling fresh copy of proxy-server container"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "sudo docker pull $CONTAINER_REGISTRY.azurecr.io/proxy-server"
echo ""
echo "--Starting proxy-server container"
bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "sudo docker run \
  -e HORIZON_BE_PRIV_HTTP_HOST='$HORIZON_BE_PRIV_HTTP_HOST' \
  -e HORIZON_BE_PRIV_HTTP_PORT='$HORIZON_BE_PRIV_HTTP_PORT' \
  -e HORIZON_PRC_PRIV_HTTP_HOST='$HORIZON_PRC_PRIV_HTTP_HOST' \
  -e HORIZON_PRC_PRIV_HTTP_PORT='$HORIZON_PRC_PRIV_HTTP_PORT' \
  -e HORIZON_SB_PRIV_WS_HOST='$HORIZON_SB_PRIV_WS_HOST' \
  -e HORIZON_SB_PRIV_WS_PORT='$HORIZON_SB_PRIV_WS_PORT' \
  -e VIRTUAL_HOST='$HORIZON_AUTH_FE_PUB_HTTP_HOST,www.$HORIZON_AUTH_FE_PUB_HTTP_HOST,$HORIZON_FE_PUB_HTTP_HOST,$HORIZON_BE_PUB_HTTP_HOST,api.$DNS_ZONE,$HORIZON_PRC_PUB_HTTP_HOST,$HORIZON_DEMO_PUB_HTTP_HOST,$HORIZON_SB_PUB_WS_HOST' \
  -e VIRTUAL_PORT='3000' \
  -e LETSENCRYPT_HOST='$HORIZON_AUTH_FE_PUB_HTTP_HOST,www.$HORIZON_AUTH_FE_PUB_HTTP_HOST,$HORIZON_FE_PUB_HTTP_HOST,$HORIZON_BE_PUB_HTTP_HOST,api.$DNS_ZONE,$HORIZON_PRC_PUB_HTTP_HOST,$HORIZON_DEMO_PUB_HTTP_HOST,$HORIZON_SB_PUB_WS_HOST' \
  --name proxy-server \
  --expose 3000 \
  -dit \
  $CONTAINER_REGISTRY.azurecr.io/proxy-server"