#/bin/bash

source ../env-helpers/export-env.sh
source ../env-helpers/export-env.sh

kubectl config use-context minikube

sudo rm ~/.ssh/known_hosts

cd ../../../shared
bash recreatedbs.sh
cd ../local/commands/db

minikube ssh "sudo mkdir -p /data/share/temp/$1/postgres"
minikube ssh "sudo chmod 777 /data/share/temp/$1/postgres"
minikube ssh "sudo mkdir -p /data/share/temp/$1/mongo"
minikube ssh "sudo chmod 777 /data/share/temp/$1/mongo"
scp -r $(minikube ssh-key) ../../../shared/dumps/$1/postgres/* docker@$(minikube ip):/data/share/temp/$1/postgres
scp -r $(minikube ssh-key) ../../../shared/dumps/$1/mongo/* docker@$(minikube ip):/data/share/temp/$1/mongo

POSTGRES_DIR=/data/share/temp/$1/postgres
MONGO_DIR=/data/share/temp/$1/mongo
kubectl exec -it horizon-postgres -- pg_restore -v --clean --username=postgres --dbname=horizon $POSTGRES_DIR/horizon.bak

mongo mongodb://$HORIZON_MONGO_HOST:$HORIZON_MONGO_PORT/horizon --eval 'db.getMongo().getDBNames().forEach(function(i){db.getSiblingDB(i).dropDatabase()})'

kubectl exec -it horizon-mongo -- mongorestore -v --drop $MONGO_DIR

minikube ssh "sudo rm -r /data/share/temp"

npm run migration:run
