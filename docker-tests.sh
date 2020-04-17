#!/bin/bash

# Build a Docker image and run tests in a container on a virtual network with an ephemeral
# Redis server container. Run ./tests.sh by default.  A user script can be provided in $1

# Strict, and loud failure
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"

cd $DIR

# Use tests.sh by default, or a user-provided script
export TEST_SCRIPT="${1:-tests.sh}"
if [[ !(-f "$TEST_SCRIPT" && -x "$TEST_SCRIPT") ]] ; then
    echo
    echo "error: expected '$TEST_SCRIPT' to be an executable file"
    exit 1
fi

echo
echo "Running $TEST_SCRIPT in the Docker harness"
echo

set -x

# Housekeeping and build
docker-compose --file docker-compose-tests.yml down || true
docker-compose --file docker-compose-tests.yml build

# Run the tests using an ephemeral Redis server
docker-compose --file docker-compose-tests.yml up --force-recreate --renew-anon-volumes --remove-orphans --abort-on-container-exit --timeout 3

set +x
