#!/bin/bash

source ../../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER
kubectl exec -it $1 -- /bin/bash