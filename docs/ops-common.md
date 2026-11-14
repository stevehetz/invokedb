# Common Opperations
```bash
helm ls
helm install
helm upgrade
kubectl rollout restart deployment/frontend
kubectl delete pod [podname]
kubectl scale deployment.apps/horizon-prc --replicas=0
kubectl scale deployment.apps/horizon-prc --replicas=1
kubectl get deployments
kubectl get service --all-namespaces
kubectl get pods -w
kubectl describe pod horizon-mongo
kubectl exec -it horizon-be -- /bin/bash
docker rm -f $(docker ps -a -q)
docker rmi -f $(docker images -q)
source ops/azure-base/azure-base.values.sh
source ops/azure-prod/azure-prod-build.values.sh


# login to azure for the first time and get context
az account clear
az login
source ops/azure-base/azure-base.values.sh
source ops/azure-prod/azure-prod-build.values.sh
az aks get-credentials --resource-group $GROUP --name $PROD_AKS_CLUSTER
npm run dev:context
kubectl get pods

kubectl logs horizon-prc-659bb7b86d-rqmbb --previous

kubectl config use-context minikube
kubectl config use-context DevHorizonAKSCluster
kubectl config current-context
kubectl config view

kubectl delete pod horizon-be
kubectl delete service/horizon-horizon-be

kubectl port-forward service/horizon-be 8000:8001

kubectl exec -it horizon-postgres -- /bin/bash

docker build -f Dockerfile -t horizon-fe ../../
docker run --name horizon-fe -p 80:80 -dit horizon-fe
docker exec -it horizon-fe /bin/bash

docker stop horizon-fe
docker rm horizon-fe

helm ls -a
helm del --purge horizon
helm install
helm upgrade --recreate-pods --set version=latest test-api-dev ../charts/test-api

GROUP=Horizon
CLUSTER=DevHorizonAKSCluster
kubectl config delete-cluster $CLUSTER
kubectl config delete-context $CLUSTER
kubectl config unset users.clusterUser_${GROUP}_${CLUSTER}

az aks get-credentials \
  --resource-group $GROUP \
  --name $CLUSTER

az group delete --resource-group $GROUP

kubectl apply -f ingress.yml
kubectl delete -f ingress.yml
kubectl get service -l app=nginx-ingress --namespace kube-system
kubectl delete service enervated-marsupial-nginx-ingress-controller --namespace kube-system
kubectl delete service enervated-marsupial-nginx-ingress-default-backend --namespace kube-system
ping dev-horizon-be.eastus.cloudapp.azure.com

az aks delete --resource-group Horizon --name DevHorizonAKSCluster --no-wait

az storage directory delete \
  --name 2019-01-06.095639 \
  --share-name $DEV_FILE_SHARE \
  --account-name $DEV_STORAGE_ACCT \
  --account-key $DEV_STORAGE_ACCT_KEY

az disk update \
  --resource-group $GROUP \
  --name $DEV_POSTGRES_DISK \
  --size-gb 50

eval $(minikube docker-env)
eval $(minikube docker-env -u)

```