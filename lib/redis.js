'use strict';

const Redis = require('ioredis');
const helpers = require('./helpers');

// todo utilize ioredis [options.keyPrefix]
// todo maybe utilize ioredis redis.defineCommand for lua scripts

async function createClient(settings, createNew) {
  let client;
  // TODO: separately support node_redis client conversion?
  if (isClient(settings)) {
    // We've actually been passed an existing client instance
    client = settings;

    if (createNew) {
      client = client.duplicate();
    } else if (isReady(client)) {
      // If we were given a redis client, and we don't want to clone it (to
      // enable connection sharing between Queue instances), and it's already
      // ready, then just return it.
      return client;
    } // TODO: otherwise, don't disconnect!!
  } else {
    // todo ensure ioredis does not mutate the options object we provide it
    client = Redis.createClient(settings);
  }

  // Make sure the client is "ready" (connected etc) before we return it
  try {
    await helpers.waitOn(client, 'ready', true);
  } catch (err) {
    // If we receive an error before the client becomes ready, we won't retain a
    // reference to it, so we should disconnect the client to prevent uncaught
    // exceptions.
    disconnect(client);
    throw err;
  }
  return client;
}

function disconnect(client) {
  client.disconnect();
  // todo ensure pending promises/actions abort correctly
  // } else {
  //   true indicates that it should invoke all pending callbacks with an
  //   AbortError; we need this behavior.
  //   client.end(true);
  // }
}

function isAbortError(err) {
  // Checking for a particular constant message defined in ioredis's utils
  // TODO: can we use some other field?
  return err.message === 'Connection is closed.';
}

function isClient(object) {
  if (!object || typeof object !== 'object') return false;
  const name = object.constructor.name;
  // todo make sure this is right name for ioredis
  // TODO: this would be name == 'RedisClient' for node_redis, possibly.
  return name === 'Redis';
}

function isReady(client) {
  // TODO: this would be client.ready as a bool if we coerce the node_redis client
  return client.status === 'ready';
}

exports.createClient = createClient;
exports.disconnect = disconnect;
exports.isAbortError = isAbortError;
exports.isClient = isClient;
exports.isReady = isReady;
