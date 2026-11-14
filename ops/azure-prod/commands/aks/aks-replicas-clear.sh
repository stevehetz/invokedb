#!/bin/bash

kubectl scale deployment.apps/horizon-ops --replicas=0
kubectl scale deployment.apps/horizon-prc --replicas=0
kubectl scale deployment.apps/horizon-be --replicas=0
kubectl scale deployment.apps/horizon-fs --replicas=0
kubectl scale deployment.apps/horizon-sb --replicas=0
kubectl scale deployment.apps/horizon-postgres --replicas=0
kubectl scale deployment.apps/horizon-mongo --replicas=0
kubectl scale deployment.apps/horizon-mongo-tracking --replicas=0