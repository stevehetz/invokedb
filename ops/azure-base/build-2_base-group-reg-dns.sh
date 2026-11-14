#!/bin/bash

# --- Main Group and Resources ---


source ../azure-base/azure-base.values.sh

# Create main resource group
az group create --name $GROUP --location eastus

# Add service principal to Resource Group
az role assignment create --assignee $SERVICE_PRINCIPAL_ID --role Owner --resource-group $GROUP

# DNS Zone
az network dns zone create -g $GROUP -n $DNS_ZONE

# Create container registry
az acr create --resource-group $GROUP --name $CONTAINER_REGISTRY --sku Basic

# Login to container registry
az acr login --name $CONTAINER_REGISTRY

# Get container registry domain
CONTAINER_REGISTRY_URI=$(az acr list --resource-group $GROUP --query "[].{acrLoginServer:loginServer}" --output tsv)