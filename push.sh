#!/bin/bash

git add -A
git commit -m "$1"
lerna publish --skip-npm --cd-version patch --yes
git push origin master
