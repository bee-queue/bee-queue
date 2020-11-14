'use strict';

const Redis = require('ioredis');
const helpers = require('./helpers');

// todo utilize ioredis [options.keyPrefix]
// todo maybe utilize ioredis redis.defineCommand for lua scripts

const clientIDs = new WeakMap();

class AbortError extends Error {
  constructor() {
    super('Connection is closed.');
    this.name = this.constructor.name;
  }
}

async function createClient(
  settings,
  { createNew = false, getClientID = false } = {}
) {
  let client,
    isNewClient = true;
  const clientType = getClientType(settings);
  if (clientType === 'NodeRedis') {
    throw new TypeError(
      "clients produced by the NodeRedis library ('redis' on npm) are no longer supported as of bee-queue@2"
    );
  }
  if (clientType) {
    // We've actually been passed an existing client instance
    client = settings;

    if (createNew) {
      client = client.duplicate();
    } else if (isReady(client)) {
      // If we were given a redis client, and we don't want to clone it (to
      // enable connection sharing between Queue instances), and it's already
      // ready, then just return it.
      return client;
    } else {
      isNewClient = false;
    }
  } else {
    client = Redis.createClient(settings);
  }

  if (getClientID && isNewClient) {
    // Best-effort attempt to get the client ID. Might fail due to connection
    // errors or due to an incompatible redis version.
    client.client('ID').then(
      (id) => clientIDs.set(client, id),
      () => {}
    );
  }

  // Make sure the client is "ready" (connected etc) before we return it
  try {
    await helpers.waitOn(client, 'ready', true);
  } catch (err) {
    // If we receive an error before the client becomes ready, we won't retain a
    // reference to it, so we should disconnect the client to prevent uncaught
    // exceptions.
    if (isNewClient) {
      disconnect(client);
    }
    throw err;
  }
  return client;
}

async function cleanDisconnect(client, commandClient) {
  if (!clientIDs.has(client)) {
    // Disable auto-reconnection.
    client.options.retryStrategy = false;
    try {
      await commandClient.client(
        'KILL',
        'ID',
        String(clientIDs.get(client)),
        'SKIPME',
        'no'
      );
      await helpers.waitOn(client, 'end', true);
      clientIDs.delete(client);
      return;
    } catch (err) {
      // Fallthrough.
    }
  }
  disconnect(client);
}

function disconnect(client) {
  // HACK: flushQueue is, according to ioredis, private. This is unfortunate,
  // because we need this in order to properly clean up during brpoplpush
  // commands.
  client.flushQueue(new AbortError());
  client.disconnect();
}

function isAbortError(err) {
  // Checking for a particular constant message defined in ioredis's utils
  // TODO: can we use some other field?
  return err.name === 'AbortError' || err.message === 'Connection is closed.';
}

const rBoundary = /\b/g;
function errorCode(err) {
  rBoundary.lastIndex = 1;
  const { message } = err,
    match = rBoundary.exec(err.message);
  return err.message.slice(0, match ? match.index : undefined);
}

function getClientType(object) {
  if (!object || typeof object !== 'object') return null;
  const name = object.constructor.name;
  if (name === 'Redis') return 'ioredis';
  if (name === 'RedisClient') return 'NodeRedis';
  return null;
}

function isReady(client) {
  // HACK: manuallyClosing is, according to ioredis, private. This is necessary
  // to work around https://github.com/luin/ioredis/issues/614.
  return client.status === 'ready' && !client.manuallyClosing;
}

exports.createClient = createClient;
exports.cleanDisconnect = cleanDisconnect;
exports.disconnect = disconnect;
exports.isAbortError = isAbortError;
exports.isClient = (object) => getClientType(object) === 'ioredis';
exports.isReady = isReady;
