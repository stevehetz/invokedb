#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source $DIR/../../azure-prod-env.values.sh


# Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
  BASH_PATH=~/.bash_profile
  osed=gsed
# Linux
else
  BASH_PATH=~/.bashrc
  osed=sed
fi


for i in "${env[@]}"
do
  index=`expr index "$i" =`
  $osed -i "\:export ${i:0:index}:d" $BASH_PATH
done