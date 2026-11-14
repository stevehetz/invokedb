#!/bin/bash

source ../../azure-prod-build.values.sh

kubectl config use-context $PROD_AKS_CLUSTER
kubectl exec -i -t $(kubectl get pod -l "run=horizon-ops" -o name) -- bash -c "cd ops/shared && bash migrate-postgres.sh"