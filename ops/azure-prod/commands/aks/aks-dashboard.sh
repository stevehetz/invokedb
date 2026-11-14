#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

az aks browse --resource-group $GROUP --name $PROD_AKS_CLUSTER