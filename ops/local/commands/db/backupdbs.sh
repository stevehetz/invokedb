#/bin/bash

# Cleans all the dumps off minikiube

# password for docker is tcuser

source ../env-helpers/export-env.sh
source ../env-helpers/export-env.sh

kubectl config use-context minikube

sudo rm ~/.ssh/known_hosts

DATETIME=`date '+%Y.%m.%d_%H.%M.%S'`

POSTGRES_DIR=/data/share/dumps/postgres/$DATETIME
MONGO_DIR=/data/share/dumps/mongo/$DATETIME

kubectl exec -it horizon-postgres -- mkdir $POSTGRES_DIR -p -v
kubectl exec -it horizon-postgres -- pg_dump -v --username=postgres --format=c --file=$POSTGRES_DIR/horizon.bak horizon

kubectl exec -it horizon-mongo -- mkdir $MONGO_DIR -p -v
kubectl exec -it horizon-mongo -- mongodump --out $MONGO_DIR

mkdir -p /data/share/minikube/dumps/$DATETIME/postgres
mkdir -p /data/share/minikube/dumps/$DATETIME/mongo

scp -r $(minikube ssh-key) docker@$(minikube ip):/data/share/dumps/postgres/$DATETIME/* /data/share/minikube/dumps/$DATETIME/postgres
rm /data/share/minikube/dumps/$DATETIME/postgres/id_rsa

scp -r $(minikube ssh-key) docker@$(minikube ip):/data/share/dumps/mongo/$DATETIME/* /data/share/minikube/dumps/$DATETIME/mongo
rm /data/share/minikube/dumps/$DATETIME/mongo/id_rsa

mkdir -p dumps/$DATETIME/postgres
mkdir -p dumps/$DATETIME/mongo
mv /data/share/minikube/dumps/$DATETIME/postgres/* dumps/$DATETIME/postgres
mv /data/share/minikube/dumps/$DATETIME/mongo/* dumps/$DATETIME/mongo

minikube ssh "sudo rm -r /data/share/dumps/postgres/$DATETIME"
minikube ssh "sudo rm -r /data/share/dumps/mongo/$DATETIME"

echo "Version name: $DATETIME"