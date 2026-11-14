#!/bin/bash

# --- Mailgun ---


source ../azure-base/azure-base.values.sh

# Mailgun
az network dns record-set txt add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n mg \
  --value "v=spf1 include:mailgun.org ~all"

az network dns record-set txt add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n "mx._domainkey.mg" \
  --value "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5Q8Tz8+/eoMxeFJuVqv7Doe5c3K8YSpcbw5A+yIPVos3Vt08cgIT1yCh7DlNU8fdw30RfEXQE9tz39bGF+x+BqJW4WIk/nYctzYG2clFPXRc3sT2ZoGACd2cM5xzriGYA+LqRuSSbFOLL0DEstvwM3EUSvdVRIbtuY9fuH2Ce4QIDAQAB"

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n mg \
  -e mxa.mailgun.org \
  -p 10

az network dns record-set mx add-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n mg \
  -e mxb.mailgun.org \
  -p 10

az network dns record-set cname set-record \
  -z $DNS_ZONE \
  -g $GROUP \
  -n email.mg \
  -c "mailgun.org"