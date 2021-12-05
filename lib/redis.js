'use strict';

const Redis = require('ioredis');
const helpers = require('./helpers');

// todo utilize ioredis [options.keyPrefix]
// todo maybe utilize ioredis redis.defineCommand for lua scripts

const clientIDs = new WeakMap();
const originalIDPromise = Symbol();

class AbortError extends Error {
  constructor() {
    super('Connection is closed.');
    this.name = this.constructor.name;
  }
}

function trackClientID(client) {
  if (clientIDs.has(client)) return;
  clientIDs.set(client, null);

  function refreshClientID() {
    // This might be set to an existing promise.
    const oldValue = clientIDs.get(client);
    const idPromise =
      (oldValue && oldValue[originalIDPromise]) ||
      client.client('ID').catch(() => null);

    const fastPromise = helpers.waitRace(idPromise, client, 'close', null);
    fastPromise[originalIDPromise] = idPromise;
    clientIDs.set(client, fastPromise);
    idPromise.then((id) => clientIDs.set(client, id));
  }

  client.on('reconnecting', refreshClientID);
  client.on('close', () => {
    const oldValue = clientIDs.get(client);
    if (oldValue && !oldValue[originalIDPromise]) {
      clientIDs.set(client, null);
    }
  });
  refreshClientID();
}

// TODO: verify that we correctly identify the client ID after a reconnect for
// existing connections.
async function createClient(
  settings,
  { createNew = false, getClientID = false } = {}
) {
  let client;
  const clientType = getClientType(settings);
  if (clientType === 'NodeRedis') {
    throw new TypeError(
      "clients produced by the NodeRedis library ('redis' on npm) are no longer supported as of bee-queue@2"
    );
  }
  if (clientType) {
    // We've actually been passed an existing client instance
    client = settings;

    if (!createNew) {
      await waitReady(client);
      if (getClientID) trackClientID(client);
      // If we were given a redis client, and we don't want to clone it (to
      // enable connection sharing between Queue instances), and it's already
      // ready, then just return it.
      return client;
    }

    client = client.duplicate();
  } else {
    client = Redis.createClient(settings);
  }

  if (getClientID) trackClientID(client);

  // Make sure the client is "ready" (connected etc) before we return it
  try {
    await waitReady(client);
  } catch (err) {
    // If we receive an error before the client becomes ready, we won't retain a
    // reference to it, so we should disconnect the client to prevent uncaught
    // exceptions.
    disconnect(client);
    throw err;
  }
  return client;
}

/**
 * Attempt a clean disconnect from the client using the command client to issue
 * the appropriate command. This will only work for Redis server versions that
 * support the CLIENT ID command, which is necessary to populate clientIDs.
 */
async function cleanDisconnect(client, commandClient) {
  // This promise should complete fairly quickly; it may be prudent to add a
  // timeout to this entire routine, though.
  const clientID = await clientIDs.get(client);
  try {
    if (clientID) {
      // Disable auto-reconnection.
      client.options.retryStrategy = false;
      await Promise.all([
        helpers.waitOn(client, 'end', true),
        // We could instead use CLIENT UNBLOCK, but we'd need to UNBLOCK a
        // difficult-to-identify number of BRPOPLPUSH commands that are already
        // enqueued.
        commandClient.client(
          'KILL',
          'ID',
          String(clientID),
          'SKIPME',
          client === commandClient ? 'no' : 'yes'
        ),
      ]);
      clientIDs.delete(client);
      return true;
    }
  } finally {
    disconnect(client);
  }
  return false;
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

async function waitReady(client, { complete = true } = {}) {
  (await isReady(client))
    ? Promise.resolve()
    : helpers.waitOn(client, 'ready', true);
  if (clientIDs.has(client)) await clientIDs.get(client);
}

function isReady(client, { complete = true } = {}) {
  // HACK: manuallyClosing is, according to ioredis, private. This is necessary
  // to work around https://github.com/luin/ioredis/issues/614.
  return (
    client.status === 'ready' &&
    !client.manuallyClosing &&
    (!clientIDs.has(client) || clientIDs.get(client))
  );
}

exports.cleanDisconnect = cleanDisconnect;
exports.createClient = createClient;
exports.disconnect = disconnect;
exports.errorCode = errorCode;
exports.isAbortError = isAbortError;
exports.isClient = (object) => getClientType(object) === 'ioredis';
exports.isReady = isReady;
exports.waitReady = waitReady;
