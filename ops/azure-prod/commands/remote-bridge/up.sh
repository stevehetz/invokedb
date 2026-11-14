#!/bin/bash

source ../../azure-dev-build.values.sh
source ../env-helpers/export-env.sh

function create_session() {
  tmux new -s bridge -d
  tmux rename-window -t bridge bridge
}

function create_panes() {
  tmux split-window -v -t bridge
  tmux select-pane -t 0
  tmux split-window -h -t bridge
  tmux select-pane -t 2
  tmux split-window -h -t bridge
  tmux select-pane -t 2
  tmux split-window -h -t bridge
  tmux select-pane -t 3
}

function context() {
  tmux select-pane -t 0
  #tmux send-keys -t bridge 'source ../../../azure-dev-build.sh' C-m
  tmux send-keys -t bridge 'kubectl config use-context $DEV_AKS_CLUSTER' C-m
}

function postgres() {
  tmux select-pane -t 0
  #tmux send-keys -t bridge 'source ../../../azure-dev-build.sh' C-m
  tmux send-keys -t bridge 'source ../env-helpers/export-env.sh' C-m
  tmux send-keys -t bridge 'kubectl port-forward service/horizon-postgres 5434:$HORIZON_POSTGRES_PORT' C-m
}

function mongo() {
  tmux select-pane -t 1
  #tmux send-keys -t bridge 'source ../../../azure-dev-build.sh' C-m
  tmux send-keys -t bridge 'source ../env-helpers/export-env.sh' C-m
  tmux send-keys -t bridge 'kubectl port-forward service/horizon-mongo 27218:$HORIZON_MONGO_PORT' C-m
}

function mongo_tracking() {
  tmux select-pane -t 2
  #tmux send-keys -t bridge 'source ../../../azure-dev-build.sh' C-m
  tmux send-keys -t bridge 'source ../env-helpers/export-env.sh' C-m
  tmux send-keys -t bridge 'kubectl port-forward service/horizon-mongo-tracking 27219:$HORIZON_MONGO_TRACKING_PORT' C-m
}

``
function horizon_be() {
  tmux select-pane -t 3
  #tmux send-keys -t bridge 'source ../../../azure-dev-build.sh' C-m
  tmux send-keys -t bridge 'source ../env-helpers/export-env.sh' C-m
  tmux send-keys -t bridge 'kubectl port-forward service/horizon-be 9001:$HORIZON_BE_PRIV_HTTP_PORT' C-m
}

function select_start_pane() {
  tmux select-pane -t 4
}

function connect_to_session() {
  tmux attach -t bridge
}

create_session
create_panes
context
mongo
mongo_tracking
postgres
horizon_be
select_start_pane
connect_to_session