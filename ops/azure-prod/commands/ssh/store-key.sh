#!/bin/bash

source ../../azure-prod-build.values.sh

rm -r keys
mkdir keys
cp ~/.ssh/$PROD_HORIZON_SSH_KEY_NAME* ./keys