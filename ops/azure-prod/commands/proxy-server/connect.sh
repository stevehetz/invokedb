#!/bin/bash

source ../../azure-prod-build.values.sh

cd ../ssh

bash connect.sh $PROD_REVERSE_PROXY_PUB_IP