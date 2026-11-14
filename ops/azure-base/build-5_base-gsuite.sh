#!/bin/bash

# --- GSuite ---


source ../azure-base/azure-base.values.sh


# invokedb.com
az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ASPMX.L.GOOGLE.COM. \
  -p 1 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT1.ASPMX.L.GOOGLE.COM. \
  -p 5 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT2.ASPMX.L.GOOGLE.COM. \
  -p 5 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT3.ASPMX.L.GOOGLE.COM. \
  -p 10 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT4.ASPMX.L.GOOGLE.COM. \
  -p 10 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e wr6ag6kxgpt325d4fhnjs672euwavqoeym6e2ztcrnvkgemylkda.mx-verification.google.com. \
  -p 15 \
  --ttl 3600

# webhorizonllc.com
az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ASPMX.L.GOOGLE.COM. \
  -p 1 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT1.ASPMX.L.GOOGLE.COM. \
  -p 5 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT2.ASPMX.L.GOOGLE.COM. \
  -p 5 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT3.ASPMX.L.GOOGLE.COM. \
  -p 10 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e ALT4.ASPMX.L.GOOGLE.COM. \
  -p 10 \
  --ttl 3600

az network dns record-set mx add-record \
  -z $WEB_HORIZON_DNS_ZONE \
  -g $GROUP \
  -n @ \
  -e wr6ag6kxgpt325d4fhnjs672euwavqoeym6e2ztcrnvkgemylkda.mx-verification.google.com. \
  -p 15 \
  --ttl 3600