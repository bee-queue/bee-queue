#!/bin/bash

# Strict, and loud failure
set -euo pipefail
trap 'rc=$?;set +ex;if [[ $rc -ne 0 ]];then trap - ERR EXIT;echo 1>&2;echo "*** fail *** : code $rc : $DIR/$SCRIPT $ARGS" 1>&2;echo 1>&2;exit $rc;fi' ERR EXIT
ARGS="$*"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "${BASH_SOURCE[0]}")"


if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] ; then
  cat <<EOF

$SCRIPT -- Run standard Bee-Queue tests in a Docker container with an ephemeral Redis server

Usage: $SCRIPT [command [...args]]

The optional command and args specify what to run in the container (default: npm test).

You can use tools or run scripts from package.json, e.g.

  ./$SCRIPT  npx ava --serial --fail-fast --verbose --no-color --timeout 30000
  ./$SCRIPT  npm run coverage

If you want to work interactively in the container, run a shell, e.g.

  ./$SCRIPT  bash

Notes:

- The very first time this script is used it takes a while for Docker to download the base
  image and to populate its caches.
- You can ignore any Transparent Huge Pages warning from the Redis server.

EOF

  exit 0
fi

image=bee-queue-test

cd $DIR

# Make ENTRYPOINT script for Docker
cat > entrypoint.sh <<"EOF"
#!/bin/sh

# Docker ENTRYPOINT target
# - start a background Redis
# - evalate user-provided arguments

set -eu

# See: https://raw.githubusercontent.com/antirez/redis/5.0/redis.conf
# We don't use --daemonize because this is a dev configuration and we want to see warnings from Redis.
# If someone knows how to prevent the "Transparent Huge Page" warning on Docker for Mac, please advise.
/usr/bin/redis-server --tcp-backlog 128 --loglevel warning &

eval "$@"

EOF
chmod +x entrypoint.sh

# Make a minimal version of package.json to avoid unnecessary `npm ci` when rebuilding the image
node > package-min.json <<EOF
const {dependencies, devDependencies} = require('./package.json');
console.log(JSON.stringify({dependencies, devDependencies}));
EOF

# Build the image
docker build --tag $image --file - . <<EOF
FROM node:lts

RUN apt-get update && apt-get install --yes --no-install-recommends redis-server

WORKDIR /bee-queue

COPY package-lock.json ./
COPY package-min.json ./package.json
RUN npm --version && npm ci

ENTRYPOINT ["./entrypoint.sh"]
CMD "npm test"

COPY . ./
RUN rm package-min.json

EOF

# Clean up build cruft
rm entrypoint.sh package-min.json

docker run --init -it --rm $image "$@"
