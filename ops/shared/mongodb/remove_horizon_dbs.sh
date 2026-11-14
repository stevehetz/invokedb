#!/bin/bash

mongo mongodb://$1:$2 --eval 'db.getMongo().getDBNames().forEach(function(i){db.getSiblingDB(i).dropDatabase()})'