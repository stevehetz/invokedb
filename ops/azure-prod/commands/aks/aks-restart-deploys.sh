#!/bin/bash

source ../../azure-prod-build.values.sh
source ../env-helpers/export-env.sh
source ../env-helpers/export-env.sh

kubectl config use-context $PROD_AKS_CLUSTER

bash aks-replicas-clear.sh

sleep 3

cmd="helm upgrade horizon"
for i in "${env[@]}"
do
  cmd="$cmd --set $i"
done
cmd="$cmd ../helm-charts -f ../helm-charts/values.yaml --recreate-pods"

eval $(echo $cmd)

bash aks-replicas-start.sh