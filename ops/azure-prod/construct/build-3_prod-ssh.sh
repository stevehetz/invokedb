#!/bin/bash

# --- SSH Key ---


source ../azure-prod-build.values.sh

ssh-keygen -t rsa -b 2048 -f ~/.ssh/$PROD_HORIZON_SSH_KEY_NAME -C "prod@horizon"
cd ../commands/ssh
bash store-key.sh