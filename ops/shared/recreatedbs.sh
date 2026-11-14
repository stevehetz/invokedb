#!/bin/bash

export PGPASSWORD=$HORIZON_POSTGRES_PASSWORD

psql \
    -h $HORIZON_POSTGRES_HOST \
    -p $HORIZON_POSTGRES_PORT \
    -d $HORIZON_POSTGRES_DB \
    -U $HORIZON_POSTGRES_USERNAME \
    -c "select pg_terminate_backend(pg_stat_activity.pid) from pg_stat_activity where pg_stat_activity.datname='horizon' AND pid <> pg_backend_pid();"
psql \
    -h $HORIZON_POSTGRES_HOST \
    -p $HORIZON_POSTGRES_PORT \
    -U $HORIZON_POSTGRES_USERNAME \
    -c "DROP DATABASE horizon"
psql \
    -h $HORIZON_POSTGRES_HOST \
    -p $HORIZON_POSTGRES_PORT \
    -U $HORIZON_POSTGRES_USERNAME \
    -c "CREATE DATABASE horizon"
echo "SELECT 'CREATE DATABASE horizon_logs' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'horizon_logs')\gexec" | \
    psql \
    -h $HORIZON_POSTGRES_HOST \
    -p $HORIZON_POSTGRES_PORT \
    -U $HORIZON_POSTGRES_USERNAME
psql \
    -f "log-table.sql" \
    -h $HORIZON_POSTGRES_HOST \
    -p $HORIZON_POSTGRES_PORT \
    -d 'horizon_logs' \
    -U $HORIZON_POSTGRES_USERNAME