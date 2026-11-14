#!/bin/bash

# --- AKS Cluster ---


cd ../commands

bash docker-build.sh horizon-fe
bash docker-build.sh horizon-auth-fe
bash docker-build.sh nginx-proxy
bash docker-build.sh proxy-server
bash docker-build.sh proxy-server-fs
bash docker-build.sh horizon-be
bash docker-build.sh horizon-ops
