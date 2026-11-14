# Using env vars locally
```bash
source ops/local/_set_env_vars.sh
```

# Stripe CLI Setup
* Must login before running local env
* https://stripe.com/docs/stripe-cli

# Minikube Setup
``` bash

# Host to minikube mount - only need to do once
sudo mkdir /home/minikube
sudo chmod 777 /home/minikube

# Minikube
minikube start --memory 4096 --cpus 2

# Deploy resources
kubectl create configmap env-config --from-env-file=.env
kubectl apply -f horizon-postgres.yml
kubectl apply -f horizon-mongo.yml

```

# Management
``` bash

# Minikube ip - 192.168.99.100

# Delete kubernetes resoures resources
kubectl delete pod horizon-mongo
kubectl delete pod horizon-postgres

kubectl delete service/horizon-mongo-svc
kubectl delete service/horizon-postgres-svc

kubectl delete configmap env-config

# Connect to pod
kubectl exec -it horizon-postgres -- /bin/bash
kubectl exec -it horizon-mongo -- /bin/bash

# Access postgres volume on minikube vm
minikube ssh
su -
cd /data/postgres

# Access mongo volume on minikube vm
minikube ssh
su -
cd /data/mongo

# Clear databases
# From shared
bash "mongodb/remove_horizon_dbs.sh" $HORIZON_MONGO_HOST $HORIZON_MONGO_PORT
export PGPASSWORD='<HORIZON_POSTGRES_PASSWORD>'
psql -h "192.168.99.100" -p 30000 -U postgres -c "DROP DATABASE horizon"

# Setup postgresql horizon
export PGPASSWORD='<HORIZON_POSTGRES_PASSWORD>'
psql -h "192.168.99.100" -p 30000 -U postgres -c "DROP DATABASE horizon"
psql -h "192.168.99.100" -p 30000 -U postgres -c "CREATE DATABASE horizon"
psql -f "../shared/sql/create_horizon.sql" -h "192.168.99.100" -p 30000 -d horizon -U postgres

# Dump postgresql horizon
kubectl exec -it horizon-postgres -- pg_dump --username=postgres --format=c --file=/data/dumps/horizon.bak horizon

# Restore postgresql horizon
kubectl exec -it horizon-postgres -- pg_restore --clean --username=postgres --dbname=teamcitydb /data/dumps/teamcitydb.bak


# Setup mongodb horizon
bash "../shared/mongodb/create_horizon.sh" 192.168.99.100 30001
bash "../shared/mongodb/create_horizon2.sh" 192.168.99.100 30001
bash "../shared/mongodb/create_horizon3.sh" 192.168.99.100 30001
bash "../shared/mongodb/create_horizon4.sh" 192.168.99.100 30001

# Remove mongodb horizon
bash "../shared/mongodb/remove_horizon_dbs.sh" 192.168.99.100 30001

# Connect from local and run queries
mongo --host 192.168.99.100 --port 30001
use horizon
db.data_grid_row.find({file_directory_id: 3, row_index: 1})

# Dump mongodb horizon
# NOTE: If you want to dump as json, look at mongoexport utility
kubectl exec -it horizon-mongo -- mongodump --db horizon --out /data/dumps

# Restore mongodb horizon
kubectl exec -it horizon-mongo -- mongorestore --drop /data/dumps


# Minikube
minikube stop
minikube delete
```

# Archive
```
# I used to need this for tmux in my start script but seemed to start working when I removed it
tmux send-keys -t horizon 'export NODE_VER='$NODE_VER C-m
tmux send-keys -t horizon 'export PATH="$PATH:$NVM_DIR/versions/node/$NODE_VER/bin"' C-m
```