#!/bin/bash

source ../../azure-prod-build.values.sh

if [ -z "$1" ]
then
      echo "Error: Must provide number of minutes"
      echo ""
else
    kubectl config use-context $PROD_AKS_CLUSTER
    stern "horizon-sb|horizon-be|horizon-prc|horizon-fs" --since=$1m
fi