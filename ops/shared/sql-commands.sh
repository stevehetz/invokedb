#!/bin/bash

# Connect
psql \
  -h $HORIZON_POSTGRES_HOST \
  -p $HORIZON_POSTGRES_PORT \
  -d $HORIZON_POSTGRES_DB \
  -U $HORIZON_POSTGRES_USERNAME

# List account rows
psql \
  -h $HORIZON_POSTGRES_HOST \
  -p $HORIZON_POSTGRES_PORT \
  -d $HORIZON_POSTGRES_DB \
  -U $HORIZON_POSTGRES_USERNAME \
  -c "select * from account"