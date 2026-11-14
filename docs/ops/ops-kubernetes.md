# Helpful commands
``` bash

kubectl delete deployment/teamcity-agent
kubectl scale deploy teamcity-agent --replicas 5

kubectl delete pod horizon-be

kubectl config current-context
kubectl config use-context DevHorizonAKSCluster
kubectl config use-context minikube

kubectl get service -l app=nginx-ingress --namespace kube-system

kubectl config view
kubectl config delete-cluster HorizonAKSCluster
kubectl config delete-context HorizonAKSCluster
kubectl config unset users.clusterUser_Horizon_HorizonAKSCluster

```

# Create config map from env file
```
kubectl create configmap env-config --from-env-file=local_dev/.env
```