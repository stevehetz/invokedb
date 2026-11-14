#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

mntPath="$HOME/horizon/$PROD_FILE_SHARE"

function setup() {
    sudo apt update
    sudo apt install cifs-utils

    httpEndpoint=$(az storage account show \
        --resource-group $GROUP \
        --name $PROD_STORAGE_ACCT \
        --query "primaryEndpoints.file" | tr -d '"')
    smbPath=$(echo $httpEndpoint | cut -c7-$(expr length $httpEndpoint))
    fileHost=$(echo $smbPath | tr -d "/")

    nc -zvw3 $fileHost 445
}

function mount() {
    sudo mkdir -p $mntPath

    httpEndpoint=$(az storage account show \
        --resource-group $GROUP \
        --name $PROD_STORAGE_ACCT \
        --query "primaryEndpoints.file" | tr -d '"')
    smbPath=$(echo $httpEndpoint | cut -c7-$(expr length $httpEndpoint))$PROD_FILE_SHARE

    storageAccountKey=$(az storage account keys list \
        --resource-group $GROUP \
        --account-name $PROD_STORAGE_ACCT \
        --query "[0].value" | tr -d '"')
    
    sudo mount -t cifs $smbPath $mntPath -o vers=3.0,username=$PROD_STORAGE_ACCT,password=$storageAccountKey,serverino,dir_mode=0777
}

#setup
mount
