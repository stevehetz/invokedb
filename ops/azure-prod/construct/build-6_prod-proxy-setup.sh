#! /bin/bash

# --- Proxy Deploy ---


source ../azure-prod-build.values.sh

cd ../commands/ssh

#bash scp.sh ../../construct/_vm_setup.sh $PROD_REVERSE_PROXY_PUB_IP ./
#bash cmd.sh $PROD_REVERSE_PROXY_PUB_IP "bash _vm_setup.sh"

#bash scp.sh ../../construct/_vm_setup.sh $PROD_REVERSE_PROXY_FS_PUB_IP ./
#bash cmd.sh $PROD_REVERSE_PROXY_FS_PUB_IP "bash _vm_setup.sh"

cd ../proxy-server

bash start.sh $PROD_REVERSE_PROXY_PUB_IP
#bash start.sh $PROD_REVERSE_PROXY_FS_PUB_IP