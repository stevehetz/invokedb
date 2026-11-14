#!/bin/bash

source ../azure-prod-build.values.sh

function deploy_horizon_be() {
  bash docker-build.sh horizon-be
  bash docker-push.sh horizon-be
  cd aks
  bash aks-restart-deploys.sh
  cd ../
}

function deploy_horizon_fe() {
  bash docker-build.sh horizon-fe
  deploy_proxy_server
}

function deploy_horizon_auth_fe() {
  bash docker-build.sh horizon-auth-fe
  deploy_proxy_server
}

function deploy_fe() {
  bash docker-build.sh horizon-fe
  bash docker-build.sh horizon-auth-fe
  deploy_proxy_server
}

function deploy_ops() {
  bash docker-build.sh horizon-ops
  bash docker-push.sh horizon-ops
  cd aks
  bash aks-restart-deploys.sh
}

function deploy_proxy_server() {
  bash docker-build.sh proxy-server
  bash docker-push.sh proxy-server
  cd ./proxy-server
  bash deploy.sh
}

function deploy_proxy_server_fs() {
  bash docker-build.sh proxy-server-fs
  bash docker-push.sh proxy-server-fs
  cd ./proxy-server
  bash deploy-fs.sh
}

function deploy_all() {
    bash docker-build.sh horizon-fe
    bash docker-build.sh horizon-auth-fe
    deploy_proxy_server
    deploy_proxy_server_fs
    deploy_horizon_be
    deploy_ops
}

if [ "$1" == "all" ]; then
  deploy_all
elif [ "$1" == "horizon-be" ]; then
  deploy_horizon_be
elif [ "$1" == "horizon-fe" ]; then
  deploy_horizon_fe
elif [ "$1" == "horizon-auth-fe" ]; then
  deploy_horizon_auth_fe
elif [ "$1" == "fe" ]; then
  deploy_fe
elif [ "$1" == "ops" ]; then
  deploy_ops
elif [ "$1" == "proxy-server" ]; then
  deploy_proxy_server
elif [ "$1" == "proxy-server-fs" ]; then
  deploy_proxy_server_fs
else
  echo "Must pass in a parameter"
fi
