#!/bin/bash

# --- Storage account ---


source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

# Postgres database disk
az disk create --resource-group $GROUP --name $PROD_POSTGRES_DATA_DISK --size-gb 30 --query id --output tsv

# Mongo database disk
az disk create --resource-group $GROUP --name $PROD_MONGO_DATA_DISK --size-gb 60 --query id --output tsv

# Create the storage account
az storage account create -n $PROD_STORAGE_ACCT -g $GROUP -l eastus --sku Standard_LRS

# Export the connection string as an environment variable, this is used when creating the Azure file share
export AZURE_STORAGE_CONNECTION_STRING=`az storage account show-connection-string -n $PROD_STORAGE_ACCT -g $GROUP -o tsv`

# Create the file share
az storage share create -n $PROD_FILE_SHARE

# Get storage account key
STORAGE_KEY=$(az storage account keys list --resource-group $GROUP --account-name $PROD_STORAGE_ACCT --query "[0].value" -o tsv)

# Echo storage account name and key
echo ""
echo "--- MANUAL STEP ---"
echo ""
echo "***ADD NEW KEY TO azure-prod-build.values.sh"
echo Storage account name: $PROD_STORAGE_ACCT
echo Storage account key: $STORAGE_KEY