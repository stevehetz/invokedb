#!/bin/bash

# --- VNet ---


source azure-base.values.sh

az network vnet create \
  --resource-group $GROUP \
  --name $PRIVATE_VNET \
  --address-prefix 10.3.0.0/16 \
  --subnet-name $PRIVATE_SUBNET \
  --subnet-prefix 10.3.1.0/24

# Add service principal to Private Subnet
az role assignment create --assignee $SERVICE_PRINCIPAL_ID --role Owner --scope $PRIVATE_SUBNET_ID