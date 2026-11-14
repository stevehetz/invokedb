#!/bin/bash

source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER
kubectl scale deployment.v1.apps/$1 --replicas=$2