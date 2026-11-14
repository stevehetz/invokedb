#!/bin/bash

function recreate() {
  bash recreatedbs.sh
}

function postgres() {
  bash migrate-postgres.sh
}

function mongo() {
  bash "mongodb/remove_horizon_dbs.sh" $HORIZON_MONGO_HOST $HORIZON_MONGO_PORT
}

recreate
postgres
mongo