#!/bin/bash

source ../azure-dev-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER
kubectl exec -it $1 -- bash -c "$2"