#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../local-env.values.sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"


# Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
  BASH_PATH=~/.bash_profile
  osed=gsed
# Linux
else
  BASH_PATH=~/.bashrc
  osed=sed
fi


# Remove from bash file
for i in "${local_dev[@]}"
do
  # this stopped working for mac, so just adding the line below
  # index=`expr index "$i" =`
  # $osed -i "\:export ${i:0:index}:d" $BASH_PATH
  $osed -i "\:export ${i:0:10}:d" $BASH_PATH
done