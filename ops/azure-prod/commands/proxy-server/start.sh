#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../env-helpers/export-env.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../env-helpers/export-env.sh

cd ../ssh

echo $1

echo ""
echo "--Logging into azure"
bash cmd.sh $1 "az login --service-principal --username $SERVICE_PRINCIPAL_ID --password \"$SERVICE_PRINCIPAL_PW\" --tenant $TENANT_ID"
echo ""
echo "--Logging into azure container registry"
bash cmd.sh $1 "sudo az acr login --name $CONTAINER_REGISTRY"
echo ""
echo "--Stopping containers"
bash cmd.sh $1 "sudo docker stop nginx-proxy-letsencrypt"
bash cmd.sh $1 "sudo docker stop nginx-proxy"
echo ""
echo "--Removing containers"
bash cmd.sh $1 "sudo docker rm nginx-proxy-letsencrypt"
bash cmd.sh $1 "sudo docker rm nginx-proxy"
echo ""
echo "--Pulling fresh copy of nginx-proxy container"
bash cmd.sh $1 "sudo docker pull $CONTAINER_REGISTRY.azurecr.io/nginx-proxy"
echo ""
echo "--Starting nginx-proxy container"
bash cmd.sh $1 "sudo docker run --detach \
    --name nginx-proxy \
    --publish 80:80 \
    --publish 443:443 \
    --volume /etc/nginx/certs \
    --volume /etc/nginx/vhost.d \
    --volume /usr/share/nginx/html \
    --volume /var/run/docker.sock:/tmp/docker.sock:ro \
    $CONTAINER_REGISTRY.azurecr.io/nginx-proxy"
echo ""
echo "--Starting letsencrypt-nginx-proxy-companion container"
bash cmd.sh $1 "sudo docker run --detach \
    --name nginx-proxy-letsencrypt \
    --volumes-from nginx-proxy \
    --volume /var/run/docker.sock:/var/run/docker.sock:ro \
    --env "DEFAULT_EMAIL=steveh@invokedb.com" \
    jrcs/letsencrypt-nginx-proxy-companion"