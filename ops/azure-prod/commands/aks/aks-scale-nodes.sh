#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

az aks scale --name $PROD_AKS_CLUSTER --node-count $1 --resource-group $GROUP