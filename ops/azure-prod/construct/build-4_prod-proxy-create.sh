#!/bin/bash

# --- Proxy Create ---


source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

# Reverse Proxy VM - Create
DISK_SUFFIX=OsDisk
az vm create \
  --name $PROD_REVERSE_PROXY_VM \
  --admin-username azhorizon \
  --resource-group $GROUP \
  --vnet-name $PRIVATE_VNET \
  --subnet $PRIVATE_SUBNET \
  --size Standard_D2_v3 \
  --image UbuntuLTS \
  --location eastus \
  --os-disk-name $PROD_REVERSE_PROXY_VM$DISK_SUFFIX \
  --ssh-key-value ../commands/ssh/keys/$PROD_HORIZON_SSH_KEY_NAME.pub

# Reverse Proxy VM - Open Port
az vm open-port --port 443 --resource-group $GROUP --name $PROD_REVERSE_PROXY_VM --priority 900
az vm open-port --port 80 --resource-group $GROUP --name $PROD_REVERSE_PROXY_VM --priority 901
az vm open-port --port 3389 --resource-group $GROUP --name $PROD_REVERSE_PROXY_VM --priority 902

# Reverse Proxy VM - Create
DISK_SUFFIX=OsDisk
az vm create \
  --name $PROD_REVERSE_PROXY_FS_VM \
  --admin-username azhorizon \
  --resource-group $GROUP \
  --vnet-name $PRIVATE_VNET \
  --subnet $PRIVATE_SUBNET \
  --size Standard_D2_v3 \
  --image UbuntuLTS \
  --location eastus \
  --os-disk-name $PROD_REVERSE_PROXY_FS_VM$DISK_SUFFIX \
  --ssh-key-value ../commands/ssh/keys/$PROD_HORIZON_SSH_KEY_NAME.pub

# Reverse Proxy VM - Open Port
az vm open-port --port 443 --resource-group $GROUP --name $PROD_REVERSE_PROXY_FS_VM --priority 900
az vm open-port --port 80 --resource-group $GROUP --name $PROD_REVERSE_PROXY_FS_VM --priority 901
az vm open-port --port 3389 --resource-group $GROUP --name $PROD_REVERSE_PROXY_FS_VM --priority 902


echo "--- MANUAL STEP ---"
echo ""
echo "Add reverse proxy pub ip to PROD_REVERSE_PROXY_PUB_IP in azure-prod-build.values.sh"
echo "Add reverse proxy pub ip to PROD_REVERSE_PROXY_FS_PUB_IP in azure-prod-build.values.sh"
echo ""

