#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../azure-base/azure-base.values.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER

push() {
  az acr login --name $CONTAINER_REGISTRY
  docker tag $1 $CONTAINER_REGISTRY.azurecr.io/$1
  docker push $CONTAINER_REGISTRY.azurecr.io/$1
}


if [ "$1" == "all" ]; then
  push horizon-be
  push horizon-ops
  push proxy-server
  push proxy-server-fs
  push nginx-proxy
else
  push $1
fi

if [ -z $1 ]; then
    echo "You must pass in an agrument"
fi
