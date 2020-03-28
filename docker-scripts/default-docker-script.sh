#!/bin/sh

# Default script to run in bee-queue-docker container

# We don't do `npm run ci` because we may not have credentials to publish to coveralls

set -eux

# This ordering supports quick iteration on new testing
npx ava
npm run eslint
npm run coverage
