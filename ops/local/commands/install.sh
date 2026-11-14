#!/bin/bash

cd ../../../packages

# horizon-be
cd ./horizon-be
npm install
cd ../

# horizon-fe
cd ./horizon-fe
npm install
cd ../

# horizon-auth-fe
cd ./horizon-auth-fe
npm install
cd ../