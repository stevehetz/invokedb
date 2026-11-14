#!/bin/bash

# --- DNS ---


source ../../azure-base/azure-base.values.sh
source ../azure-prod-build.values.sh

# horizon-fe
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_FE_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_FE_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_PUB_IP

# horizon-auth-fe
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n @ \
  --yes

az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n www \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n @ \
  -a $PROD_REVERSE_PROXY_PUB_IP

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n www \
  -a $PROD_REVERSE_PROXY_PUB_IP

# horizon-be
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_BE_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_BE_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_PUB_IP
  
# api
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n api \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n api \
  -a $PROD_REVERSE_PROXY_PUB_IP

# horizon-prc
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_PRC_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_PRC_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_PUB_IP

# horizon-sb
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_SB_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_SB_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_PUB_IP

# horizon-fs
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_FS_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_FS_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_FS_PUB_IP

#horizon-demo
az network dns record-set a delete \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_DEMO_DNS_PREFIX \
  --yes

az network dns record-set a add-record \
  -g $GROUP \
  -z $DNS_ZONE \
  -n $PROD_PUB_DEMO_DNS_PREFIX \
  -a $PROD_REVERSE_PROXY_PUB_IP