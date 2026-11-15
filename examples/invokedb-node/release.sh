#!/bin/bash

rm -r bundle
npm run build
git add -A
git commit -m "$1"
git push origin master
npm version patch -m "$1"
npm publish