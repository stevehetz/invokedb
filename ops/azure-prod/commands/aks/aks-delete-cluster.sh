#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh


az aks delete --resource-group $GROUP --name $PROD_AKS_CLUSTER --no-wait

kubectl config delete-cluster $PROD_AKS_CLUSTER
kubectl config delete-context $PROD_AKS_CLUSTER
kubectl config unset users.clusterUser_${GROUP}_${PROD_AKS_CLUSTER}

