# Prerequisites
```
# Install minikube w/ virtualbox
# Install kubernetes
# Install node v13 with nvm
# Install stripe: https://stripe.com/docs/stripe-cli
# Install helm v2 (mac: https://medium.com/@Joachim8675309/install-helm3-helm2-on-macos-d65f61509799)
# Install mongo
brew install postgresql
npm install -g lerna
```

# Startup fresh
```
stripe login
npm run minikube
npm run install
npm run start
npm run setupdbs
```

# Versioning
```
npm run push "your commit message"
```

# Startup after reboot
```
npm run minikube
npm run start
```

# Default login
```
username: shetzel84@gmail.com
password: password
```

# Setup db
```
npm run setupdbs
# or
npm run setupdbs-demo
```