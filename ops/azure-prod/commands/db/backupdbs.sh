#!/bin/bash

source ../../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER

DATETIME=`date '+%Y.%m.%d_%H.%M.%S'`
POSTGRES_POD_NAME=`echo $(kubectl get pod -l "run=horizon-postgres" -o name) | cut -c5-`
MONGO_POD_NAME=`echo $(kubectl get pod -l "run=horizon-mongo" -o name) | cut -c5-`
BACKUP_DIR=/data/share/db_backups/$DATETIME

kubectl exec -it $POSTGRES_POD_NAME -- mkdir $BACKUP_DIR/postgres -p -v
kubectl exec -it $POSTGRES_POD_NAME -- pg_dump -v --username=postgres --format=c --file=$BACKUP_DIR/postgres/horizon.bak horizon

kubectl exec -it $MONGO_POD_NAME -- mkdir $BACKUP_DIR/mongo -p -v
kubectl exec -it $MONGO_POD_NAME -- mongodump --out $BACKUP_DIR/mongo

echo "Version name: $DATETIME"