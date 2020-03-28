#!/bin/bash

# Strict, and loud failure
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"

# A command or the name of a script to run in the container
# Note: scripts must be in ./docker-scripts/ in order to get copied into the Docker image
scriptName=${1:-docker-scripts/default-docker-script.sh}
shift || true

if [ "$scriptName" = -h -o "$scriptName" = --help ] ; then
  cat <<EOF

$SCRIPT -- Run a default test script or commands of your choice in a Docker
container with the bee-queue library and a Redis server.

Usage: $SCRIPT [command ...args]

The optional command argument is an executable or or a script to run in the
container.  The default command is docker-scripts/default-docker-script.sh which
runs tests, the linter, and test coverage.

You can run Node JS tools and scripts, e.g.

  $SCRIPT  npx ava --fail-fast --verbose

If you want to work interactively in the container, use bash, e.g.

  $SCRIPT  bash

Scripts must be in the ./docker-scripts directory.  E.g. your custom testing
script ./docker-scripts/my-testing.sh would be run via

  $SCRIPT  docker-scripts/my-testing.sh

Notes:
- The very first time this script is used it takes a while for Docker to
  populate its caches.
- You can ignore the Transparent Huge Pages warning from the Redis server.
EOF

exit 0
fi

image=bee-queue-docker

cd $DIR

docker build --tag $image --file Dockerfile-docker-scripts .

docker run --init -it --rm $image $scriptName "$@"
