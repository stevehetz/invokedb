#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

az account clear
az login
az aks get-credentials --resource-group $GROUP --name $PROD_AKS_CLUSTER
kubectl config use-context $PROD_AKS_CLUSTER