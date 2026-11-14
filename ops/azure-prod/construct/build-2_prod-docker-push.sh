#!/bin/bash

# --- AKS Cluster ---


cd ../commands

bash docker-push.sh nginx-proxy
bash docker-push.sh proxy-server
bash docker-push.sh proxy-server-fs
bash docker-push.sh horizon-be
bash docker-push.sh horizon-ops