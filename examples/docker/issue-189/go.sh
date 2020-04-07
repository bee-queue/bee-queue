#!/bin/bash

# Build and run bee-queue Docker containers

# strict and loud failure
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"

cd $DIR

set -x

# Copy sources from local bee-queue branch
rsync --archive --delete --delete-excluded --exclude .git/ --exclude node_modules/ --exclude examples/ ../../.. bee-queue

# docker-compose makes it surprisingly hard to have new, empty persistence, so we use clubs
touch redisData
rm -r redisData
mkdir redisData

# Build image and run containers
docker-compose up --build --no-color --force-recreate --remove-orphans --abort-on-container-exit --timeout 3 "$@"

set +x
