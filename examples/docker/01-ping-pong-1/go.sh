#!/bin/bash

# Build and run bee-queue Docker containers to do Hello World

# Strict and loud fail
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"

docker-compose down > /dev/null 2>&1 || true

set -x
docker-compose build --quiet
docker-compose up --abort-on-container-exit --timeout 3 --renew-anon-volumes
set +x
