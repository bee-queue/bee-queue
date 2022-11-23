'use strict';

module.exports = {
  stallInterval: 5000,
  // Avoid scheduling timers for further out than this period of time. The
  // workers will all poll on this interval, at minimum, to find new delayed
  // jobs.
  nearTermWindow: 20 * 60 * 1000,
  // Avoids rapid churn during processing of nearly-concurrent events.
  delayedDebounce: 1000,
  prefix: 'bq',
  isWorker: true,
  getEvents: true,
  ensureScripts: true,
  activateDelayedJobs: false,
  sendEvents: true,
  storeJobs: true,
  removeOnSuccess: false,
  removeOnFailure: false,
  redisScanCount: 100,
  // first retry period after a brpoplpush failure, backoff is exponential
  initialRedisFailureRetryDelay: 1000,

  // quitCommandClient is dependent on whether the redis setting was an actual
  // redis client, or just configuration options to create such a client.

  // Method-specific defaults.
  '#close': {
    timeout: 5000,
  },

  '#process': {
    concurrency: 1,
  },
};
