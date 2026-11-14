#!/bin/bash

source ../azure-prod-build.values.sh

if [ -z "$1" ]
then
      echo "Error: Must provide a directory to clear"
      echo ""
else
    az storage file delete-batch \
        --account-key $PROD_STORAGE_ACCT_KEY \
        --account-name $PROD_STORAGE_ACCT \
        --source $PROD_FILE_SHARE/$1
fi