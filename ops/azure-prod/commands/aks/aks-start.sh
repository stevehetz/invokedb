#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh
# Need to run twice cause variables within variables
source ../env-helpers/export-env.sh
source ../env-helpers/export-env.sh

kubectl config use-context $PROD_AKS_CLUSTER

cmd="helm install"
for i in "${env[@]}"
do
  cmd="$cmd --set $i"
done
cmd="$cmd --name horizon -f ../helm-charts/values.yaml ../helm-charts"

eval $(echo $cmd)

bash aks-replicas-start.sh

kubectl delete clusterrolebinding kubernetes-dashboard
kubectl create clusterrolebinding kubernetes-dashboard --clusterrole=cluster-admin --serviceaccount=kube-system:kubernetes-dashboard --user=clusterUser