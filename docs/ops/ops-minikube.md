# Deploying Docker Containers
``` bash

# Walk through
# https://medium.com/@brianbmathews/getting-started-with-minikube-docker-container-images-for-testing-kubernetes-locally-on-mac-e39adb60bd41
# Fix access issue
# https://github.com/kubernetes/minikube/issues/3083

sudo vi /var/lib/snapd/apparmor/profiles/snap.docker.docker
# Add (below other lines that look similar):
owner @{HOME}/.minikube/certs/*   rwklix,
# Save and run
sudo apparmor_parser -r /var/lib/snapd/apparmor/profiles/snap.docker.docker

# Switch to minikube docker daemon
eval $(minikube docker-env)

# Switch back to local docker daemon
eval $(minikube docker-env -u)
```