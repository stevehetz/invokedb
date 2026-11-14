#!/bin/bash

# For local_test mode, build all new docker images
DOCKER_BUILD=false

function source_env_vars() {
  # Strangly I have to run this twice,
  # since there are variables that reference variable
  # within the env.sh file
  source env-helpers/export-env.sh
  source env-helpers/export-env.sh
}

function create_directories() {
  if [ ! -d "$HORIZON_FILE_SHARE" ]; then
    sudo mkdir -p $HORIZON_FILE_SHARE
    sudo chmod 777 $HORIZON_FILE_SHARE
  fi
}

function docker() {
  if [ "$DOCKER_BUILD" = true ]; then
    bash docker.sh horizon-be
    bash docker.sh horizon-fe
  fi
}

function kubernetes() {
  # Switch to minikube context
  kubectl config use-context minikube

  # Set env vars
  vars=("${local_dev[@]}")


  # Build helm command from env vars array
  cmd="helm install"
  for i in "${vars[@]}"
  do
    cmd="$cmd --set $i"
  done
  cmd="$cmd --name horizon helm-charts"
  
  eval $(echo $cmd)
  return 0
}

function create_env_file() {
  bash env-helpers/create-env-file.sh
}

function set_global_env_vars() {
  bash env-helpers/unset-global-env.sh
  bash env-helpers/set-global-env.sh
}

function create_session() {
  tmux new -s horizon -d
  tmux rename-window -t horizon horizon
}

function create_panes() {
  tmux split-window -v -t horizon
  tmux select-pane -t 0
  tmux split-window -h -t horizon
  tmux select-pane -t 2
  tmux split-window -h -t horizon
}

function horizon_ops() {
  tmux select-pane -t 0
  tmux send-keys -t horizon 'cd ../../../' C-m
  #tmux send-keys -t horizon 'stripe login' C-m
  #tmux send-keys -t horizon '' C-m
  tmux send-keys -t horizon 'stripe listen --forward-to http://127.0.0.1:8001/webhook/stripe' C-m
}

function horizon_be() {
  tmux select-pane -t 1
  tmux send-keys -t horizon 'source env-helpers/export-env.sh' C-m
  tmux send-keys -t horizon 'cd ../../../packages/horizon-be' C-m
  tmux send-keys -t horizon 'npm run start' C-m
}

function horizon_fe() {
  tmux select-pane -t 2
  tmux send-keys -t horizon 'source env-helpers/export-env.sh' C-m
  tmux send-keys -t horizon 'cd ../../../packages/horizon-fe' C-m
  tmux send-keys -t horizon 'npm start' C-m
}

function horizon_auth_fe() {
  tmux select-pane -t 3
  tmux send-keys -t horizon 'source env-helpers/export-env.sh' C-m
  tmux send-keys -t horizon 'cd ../../../packages/horizon-auth-fe' C-m
  tmux send-keys -t horizon 'npm start' C-m
}

function select_start_pane() {
  tmux select-pane -t 0
}

function connect_to_session() {
  tmux attach -t horizon
}

source_env_vars
create_directories

kubernetes
create_env_file
set_global_env_vars
create_session
create_panes
horizon_ops
horizon_be
horizon_fe
horizon_auth_fe
select_start_pane
connect_to_session