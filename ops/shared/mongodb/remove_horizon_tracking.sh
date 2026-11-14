#!/bin/bash

mongo mongodb://$HORIZON_MONGO_TRACKING_HOST:$HORIZON_MONGO_TRACKING_PORT/horizon:tracking --eval 'db.dropDatabase()'