#!/bin/bash

# --- Service Principal ---


source ../azure-base/azure-base.values.sh

# Set active subscription 
az account set --subscription $SUBSCRIPTION_ID

# Create Service Principal
az ad sp create-for-rbac --skip-assignment

echo ""
echo "1. Add values to azure-dev-build.values.sh"
echo "2. Add appId to SERVICE_PRINCIPAL_ID"
echo "3. Add password to SERVICE_PRINCIPAL_PW"