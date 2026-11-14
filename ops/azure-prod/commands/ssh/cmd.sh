#!/bin/bash

source ../../azure-prod-build.values.sh

ssh \
  -o "IdentitiesOnly=yes" \
  -i keys/$PROD_HORIZON_SSH_KEY_NAME \
  -t \
  azhorizon@$1 \
  $2