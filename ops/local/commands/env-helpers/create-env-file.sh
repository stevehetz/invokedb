#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../local-env.values.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Create file
rm -r $DIR/generated
mkdir $DIR/generated
touch $DIR/generated/.env


# Add to bash file
for i in "${local_dev[@]}"
do
    echo "$i" >> $DIR/generated/.env
done
chmod 777 $DIR/generated/.env
