#!/bin/bash

# Note: Make sure to adjust size as needed

# Prerequisites for restoring
#   1. kubectl delete pod horizon-postgres
#   2. Wait for disk to be unattached
#   3. delete disk
#   4. then run npm run dev:snapshot postgres restore
#
# $1 - create/restore
# $2 - mongo/postgres
# $3 - full id of snapshot (restore only)

source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER

DATETIME=`date '+%Y.%m.%d_%H.%M.%S'`

if [ "$1" == "create" ]; then
    if [ "$2" == "postgres" ]; then
        az snapshot create -g $GROUP --source /subscriptions/$SUBSCRIPTION_ID/resourceGroups/Horizon/providers/Microsoft.Compute/disks/$PROD_POSTGRES_DATA_DISK -n postgres-snapshot-$DATETIME
    elif [ "$2" == "mongo" ]; then
        az snapshot create -g $GROUP --source /subscriptions/$SUBSCRIPTION_ID/resourceGroups/Horizon/providers/Microsoft.Compute/disks/$PROD_MONGO_DATA_DISK -n mongo-snapshot-$DATETIME
    else
        echo "Invalid disk type: " $1
    fi
elif [ "$1" == "restore" ]; then
    if [ "$2" == "postgres" ]; then
        az disk create -n $PROD_POSTGRES_DATA_DISK -g $GROUP --size-gb 30 --query id --output tsv --source $3
    elif [ "$2" == "mongo" ]; then
        az disk create -n $PROD_MONGO_DATA_DISK -g $GROUP --size-gb 30 --query id --output tsv --source $3
    else
        echo "Invalid disk type: " $1
    fi
fi