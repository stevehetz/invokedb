#!/bin/bash

# --- AKS Create Cluster ---


#!/bin/bash

source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

# Create AKS Cluster
az aks create \
  --name $PROD_AKS_CLUSTER \
  --admin-username azhorizon \
  --resource-group $GROUP \
  --service-principal $SERVICE_PRINCIPAL_ID \
  --client-secret $SERVICE_PRINCIPAL_PW \
  --vnet-subnet-id $PRIVATE_SUBNET_ID \
  --node-count 1 \
  --nodepool-name cluster \
  --node-vm-size Standard_D2_v3 \
  --generate-ssh-keys

# Create Backend Nodepool
az aks nodepool add \
    --resource-group $GROUP \
    --cluster-name $PROD_AKS_CLUSTER \
    --name horizonbe \
    --node-count 1 \
    --vnet-subnet-id $PRIVATE_SUBNET_ID \
    --node-taints sku=be:NoSchedule \
    --node-vm-size Standard_D2_v3

# Create Processor Nodepool
az aks nodepool add \
    --resource-group $GROUP \
    --cluster-name $PROD_AKS_CLUSTER \
    --name horizonprc \
    --node-count 1 \
    --vnet-subnet-id $PRIVATE_SUBNET_ID \
    --node-taints sku=pr:NoSchedule \
    --node-vm-size Standard_F2s_v2

# Create File Server Nodepool
az aks nodepool add \
    --resource-group $GROUP \
    --cluster-name $PROD_AKS_CLUSTER \
    --name horizonfs \
    --node-count 1 \
    --vnet-subnet-id $PRIVATE_SUBNET_ID \
    --node-taints sku=fs:NoSchedule \
    --node-vm-size Standard_D2_v3

# Create Mongo Nodepool
az aks nodepool add \
    --resource-group $GROUP \
    --cluster-name $PROD_AKS_CLUSTER \
    --name horizondb \
    --node-count 1 \
    --vnet-subnet-id $PRIVATE_SUBNET_ID \
    --node-taints sku=db:NoSchedule \
    --node-vm-size Standard_E2s_v3

# Save credentials locally for kubectl
az aks get-credentials \
  --resource-group $GROUP \
  --name $PROD_AKS_CLUSTER

# Add service principal
az role assignment create --assignee $SERVICE_PRINCIPAL_ID --role Owner --resource-group MC_${GROUP}_${PROD_AKS_CLUSTER}_eastus

# Setup helm and tiller
kubectl apply -f ../commands/aks/tiller.yaml
helm init --service-account tiller --override spec.selector.matchLabels.'name'='tiller',spec.selector.matchLabels.'app'='helm' --output yaml | sed 's@apiVersion: extensions/v1beta1@apiVersion: apps/v1@' | kubectl apply -f -
# kubectl create serviceaccount --namespace kube-system tiller
kubectl create clusterrolebinding tiller-cluster-rule --clusterrole=cluster-admin --serviceaccount=kube-system:tiller
kubectl patch deploy --namespace kube-system tiller-deploy -p '{"spec":{"template":{"spec":{"serviceAccount":"tiller"}}}}'

# Create storage account secret secret
kubectl create secret generic $PROD_FILE_SHARE_SECRET \
  --from-literal=azurestorageaccountname=$PROD_STORAGE_ACCT \
  --from-literal=azurestorageaccountkey=$PROD_STORAGE_ACCT_KEY
