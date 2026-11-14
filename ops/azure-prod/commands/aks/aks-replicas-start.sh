#!/bin/bash

sleep 3

kubectl scale deployment.apps/horizon-mongo --replicas=1
kubectl scale deployment.apps/horizon-mongo-tracking --replicas=1
kubectl scale deployment.apps/horizon-ops --replicas=1
kubectl scale deployment.apps/horizon-sb --replicas=1

sleep 5

kubectl scale deployment.apps/horizon-postgres --replicas=1

sleep 10

kubectl scale deployment.apps/horizon-fs --replicas=1
kubectl scale deployment.apps/horizon-prc --replicas=3
kubectl scale deployment.apps/horizon-be --replicas=4