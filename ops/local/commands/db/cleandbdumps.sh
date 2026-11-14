#!/bin/bash

# Prerequisites - set minikube password
# login to minikube >> `minikube ssh`
# set password >> `sudo passwd docker`
# exit minikube terminal >> `exit`

minikube ssh "sudo rm -r /data/share/minikube/dumps"