import { describe } from 'ava-spec';
import sinon from 'sinon';
import * as helpers from '../lib/helpers';

import * as redis from '../lib/redis';
import Redis from 'ioredis';

// Fake NodeRedis implementation.
class RedisClient {}

describe('redis', (it) => {
  const redisUrl = process.env.BEE_QUEUE_TEST_REDIS;
  const gclient = new Redis(redisUrl);

  it('should bail on NodeRedis instances', async (t) => {
    await t.throws(redis.createClient(new RedisClient()), TypeError);
  });

  it('should track the client ID', async (t) => {
    const client = await redis.createClient(redisUrl, { getClientID: true });
    client.stream.destroy();
    await redis.waitReady(client);
    t.true(await redis.cleanDisconnect(client, gclient));
  });

  it('should track existing clients', async (t) => {
    const client = new Redis({ autoResendUnfulfilledCommands: false });
    await redis.createClient(client, { getClientID: true });
    client.stream.destroy();
    await redis.waitReady(client);
    t.true(await redis.cleanDisconnect(client, gclient));
  });

  // Memory leak prevention. Tests guts which sucks.
  it.only('should re-use the first client ID call', async (t) => {
    const client = await redis.createClient(redisUrl, { getClientID: true });
    // Does not capture the initial invocation.
    const spy = sinon.spy(client, 'client');
    let closed = helpers.waitOn(client, 'close', true);
    client.stream.destroy();
    await closed;
    await helpers.waitOn(client, 'connect', true);
    closed = helpers.waitOn(client, 'close', true);
    client.stream.destroy();
    await closed;
    await redis.waitReady(client);
    // Once after the first destroy, but not after the second destroy.
    t.true(spy.calledOnce);
    t.true(await redis.cleanDisconnect(client, gclient));
    t.true(spy.calledOnce);
  });
});
