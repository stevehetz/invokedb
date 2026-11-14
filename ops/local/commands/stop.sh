#!/bin/bash

kubectl config use-context minikube

bash env-helpers/unset-global-env.sh
helm del --purge horizon

tmux kill-session -t horizon