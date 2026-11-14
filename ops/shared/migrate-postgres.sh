#!/bin/bash

  cd ../../packages/horizon-be
  npm run migration:run
  cd ../../ops/shared