import { describe } from 'ava-spec';

import * as redis from '../lib/redis';
import Redis from 'ioredis';

// Fake NodeRedis implementation.
class RedisClient {}

describe('redis', (it) => {
  it('should bail on NodeRedis instances', async (t) => {
    await t.throws(redis.createClient(new RedisClient()), TypeError);
  });
});
