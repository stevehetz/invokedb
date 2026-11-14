# Helm
```bash

helm ls -a
helm del --purge horizon
helm del --purge horizon-localdev
helm upgrade --recreate-pods --set version=latest test-api-dev ../charts/test-api

```