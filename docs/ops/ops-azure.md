# Kubernetes context
```bash

# Change
kubectl config use-context DevHorizonAKSCluster

# Delete
GROUP=Horizon
CLUSTER=DevHorizonAKSCluster
kubectl config delete-cluster $CLUSTER
kubectl config delete-context $CLUSTER
kubectl config unset users.clusterUser_${GROUP}_${CLUSTER}

```

# Ingress
```bash

kubectl get service -l app=nginx-ingress --namespace kube-system

```


# Delete Cluster and Group
```bash

az aks delete --resource-group Horizon --name DevHorizonAKSCluster

az group delete --resource-group Horizon

```