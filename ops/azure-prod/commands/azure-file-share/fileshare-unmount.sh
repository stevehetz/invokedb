#!/bin/bash

source ../../../azure-base/azure-base.values.sh
source ../../azure-prod-build.values.sh

mntPath="$HOME/horizon/$PROD_FILE_SHARE"


function unmount() {
    sudo umount $mntPath
}

unmount