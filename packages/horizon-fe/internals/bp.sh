#!/bin/bash
git add -A
git commit -m "$1"
npm version patch -m "$1"
git push origin master
