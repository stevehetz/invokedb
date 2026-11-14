#!/bin/bash

# Note: Pod needs to be deleted before this can be done
#   - check portal and wait for disk to be Unattached
# ex: kubectl delete pod horizon-postgres
# $1 - mongo/postgres
# $2 - size in gb

source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER

if [ "$1" == "postgres" ]; then
  az disk update --name $PROD_POSTGRES_DATA_DISK -g $GROUP --size-gb $2
  cd aks
  bash aks-restart-deploys.sh
elif [ "$1" == "mongo" ]; then
  az disk update --name $PROD_MONGO_DATA_DISK -g $GROUP --size-gb $2
  cd aks
  bash aks-restart-deploys.sh
else
  echo "Invalid disk type: " $1
fi