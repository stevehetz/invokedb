#!/bin/bash

source ../../azure-prod-build.values.sh

scp \
  -o "IdentitiesOnly=yes" \
  -i keys/$PROD_HORIZON_SSH_KEY_NAME \
  $1 \
  azhorizon@$2:$3
  