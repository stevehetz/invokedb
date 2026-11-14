#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../azure-prod-env.values.sh


# Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    BASH_PATH=~/.bash_profile
# Linux
else
    BASH_PATH=~/.bashrc
fi

for i in "${env[@]}"
do
    echo "export $i" >> $BASH_PATH
done
