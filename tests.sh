#!/bin/bash

# Default script used by the Docker testing harness in the container run by ./docker-tests.sh

# Strict, and loud failure
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"

set -x

# Dev-centric test steps based on scripts in package.json
PATH="$(npm bin):$PATH"

# If ava testing hangs (which, sadly, happens all too often), add --serial to get a more
# deterministic record that will log up to the test prior to the one that hangs... But, as
# is often the case with race conditions, the instrumentation may eliminate the problem
# you're trying to track down...
ava --no-color --timeout 30000 --verbose
eslint .
prettier --check '**/*.(html|json|md|sublime-project|ts|yml)'
nyc ava

# To do what Travis does, but, to date, the ava tests will intermittently hang
#npm test
