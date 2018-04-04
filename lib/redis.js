'use strict';

const Redis = require('ioredis');
const helpers = require('./helpers');

// todo utilize ioredis [options.keyPrefix]
// todo maybe utilize ioredis redis.defineCommand for lua scripts

async function createClient(settings, createNew) {
  let client;
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
    }
  } else {
    // todo ensure ioredis does not mutate the options object we provide it
    client = new Redis(settings);
  }

  // Make sure the client is "ready" (connected etc) before we return it
  await helpers.waitOn(client, 'ready', true);
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
  return err.message === 'Connection is closed.';
}

function isClient(object) {
  if (!object || typeof object !== 'object') return false;
  const name = object.constructor.name;
  // todo make sure this is right name for ioredis
  return name === 'Redis';
}

function isReady(client) {
  return client.status === 'ready';
}

exports.createClient = createClient;
exports.disconnect = disconnect;
exports.isAbortError = isAbortError;
exports.isClient = isClient;
exports.isReady = isReady;
