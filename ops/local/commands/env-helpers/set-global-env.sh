#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../local-env.values.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"


# Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    BASH_PATH=~/.bash_profile
# Linux
else
    BASH_PATH=~/.bashrc
fi


# Add to bash file
for i in "${local_dev[@]}"
do
    echo "export $i" >> $BASH_PATH
done