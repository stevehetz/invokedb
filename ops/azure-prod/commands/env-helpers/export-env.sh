#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../azure-prod-env.values.sh

for i in "${env[@]}"
do
    export "$i"
done