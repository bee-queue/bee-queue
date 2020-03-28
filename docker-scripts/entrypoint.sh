#!/bin/sh

# Docker ENTRYPOINT target
# - start a background Redis
# - evalate user-provided arguments

# See: https://raw.githubusercontent.com/antirez/redis/5.0/redis.conf
# We don't use --daemonize because this is a dev configuration and we want to see warnings from Redis.
# If someone knows how to prevent the "Transparent Huge Page" warning on Docker for Mac, please advise.
/usr/bin/redis-server --tcp-backlog 128 --loglevel warning &

eval "$@"
