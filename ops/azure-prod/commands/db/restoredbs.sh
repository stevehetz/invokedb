#!/bin/bash

source ../../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER

if [ -z "$1" ]
then
      echo "Error: Must provide backup name"
      echo ""
else
    BACKUP_DIR=/data/share/db_backups/$1

    OPS_POD_NAME=`echo $(kubectl get pod -l "run=horizon-ops" -o name) | cut -c5-`
    POSTGRES_POD_NAME=`echo $(kubectl get pod -l "run=horizon-postgres" -o name) | cut -c5-`
    MONGO_POD_NAME=`echo $(kubectl get pod -l "run=horizon-mongo" -o name) | cut -c5-`

    kubectl exec -i -t $OPS_POD_NAME -- bash -c "cd ops/shared && bash recreatedbs.sh"

    kubectl exec -i -t $POSTGRES_POD_NAME -- pg_restore -v --clean --username=postgres --dbname=horizon $BACKUP_DIR/postgres/horizon.bak

    kubectl exec -i -t $MONGO_POD_NAME -- mongo mongodb://127.0.0.1:27017 --eval 'db.getMongo().getDBNames().forEach(function(i){db.getSiblingDB(i).dropDatabase()})'
    kubectl exec -i -t $MONGO_POD_NAME -- mongorestore -v --drop $BACKUP_DIR/mongo

    kubectl exec -i -t $OPS_POD_NAME -- npm run migration:run
fi