const redis = require('./redis');
const Emitter = require('events').EventEmitter;
const util = require('util');

const Job = require('./job');
const defaults = require('./defaults');
const lua = require('./lua');
const helpers = require('./helpers');
const backoff = require('./backoff');
const EagerTimer = require('./eager-timer');

function Queue(name, settings) {
  if (!(this instanceof Queue)) {
    return new Queue(name, settings);
  }

  Emitter.call(this);

  this.name = name;
  this.paused = false;
  this.jobs = new Map();
  this.activeJobs = new Set();
  this.checkTimer = null;

  this._closed = null;

  settings = settings || {};
  this.settings = {
    redis: settings.redis || {},
    keyPrefix: (settings.prefix || defaults.prefix) + ':' + this.name + ':'
  };

  for (let prop in defaults) {
    const def = defaults[prop], setting = settings[prop], type = typeof def;
    if (type === 'boolean') {
      this.settings[prop] = typeof setting === 'boolean' ? setting : def;
    } else if (type === 'number') {
      this.settings[prop] = Number.isSafeInteger(setting) ? setting : def;
    }
  }

  /* istanbul ignore if */
  if (this.settings.redis.socket) {
    this.settings.redis = Object.assign({}, this.settings.redis, {path: this.settings.redis.socket});
  }

  this._delayedTimer = new EagerTimer(this.settings.nearTermWindow);
  this._delayedTimer.on('trigger', this._processDelayed.bind(this));

  const makeClient = (clientName) => {
    return redis.createClient(this.settings.redis)
      .then((client) => {
        client.on('error', this.emit.bind(this, 'error'));
        return this[clientName] = client;
      });
  };

  let eventsPromise = null;

  if (this.settings.getEvents || this.settings.processDelayed) {
    eventsPromise = makeClient('eclient').then(() => {
      this.eclient.on('message', this._onMessage.bind(this));
      const channels = [];
      if (this.settings.getEvents) channels.push(this.toKey('events'));
      if (this.settings.processDelayed) channels.push(this.toKey('earlierDelayed'));
      return Promise.all(channels.map((channel) => {
        const promise = helpers.deferred();
        this.eclient.subscribe(channel, promise.defer());
        return promise;
      }));
    });
  }

  this._isReady = false;

  // Wait for Lua loading and client connection; bclient and eclient/subscribe if needed
  this._ready = Promise.all([
    // Make the clients
    makeClient('client'),
    this.settings.isWorker ? makeClient('bclient') : null,
    eventsPromise
  ]).then(() => {
    if (this.settings.ensureScripts) {
      return lua.buildCache(this.client);
    }
  }).then(() => this);

  this._ready.then(() => {
    this._isReady = true;
    setImmediate(() => this.emit('ready'));
  });
}

util.inherits(Queue, Emitter);

Queue.prototype._onMessage = function (channel, message) {
  if (channel === this.toKey('earlierDelayed')) {
    // We should only receive these messages if processDelayed is enabled.
    this._delayedTimer.schedule(parseInt(message, 10));
    return;
  }

  message = JSON.parse(message);
  if (message.event === 'failed' || message.event === 'retrying') {
    message.data = new Error(message.data);
  }

  this.emit('job ' + message.event, message.id, message.data);

  if (this.jobs.has(message.id)) {
    if (message.event === 'progress') {
      this.jobs.get(message.id).progress = message.data;
    } else if (message.event === 'retrying') {
      this.jobs.get(message.id).options.retries -= 1;
    }

    this.jobs.get(message.id).emit(message.event, message.data);

    if (message.event === 'succeeded' || message.event === 'failed') {
      this.jobs.delete(message.id);
    }
  }
};

Queue.prototype.isRunning = function () {
  return !this.paused;
};

Queue.prototype.ready = function (cb) {
  if (cb) this._ready.then(() => cb(null), cb);

  return this._ready;
};

Queue.prototype.close = function (timeout, cb) {
  if (typeof timeout === 'function') {
    cb = timeout;
    timeout = defaults['#close'].timeout;
  } else if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    timeout = defaults['#close'].timeout;
  }

  if (this.paused) {
    return this._closed;
  }

  this.paused = true;

  if (this.checkTimer) {
    clearTimeout(this.checkTimer);
    this.checkTimer = null;
  }

  this._delayedTimer.stop();

  const closed = helpers.withTimeout(this._ready.then(() => {
    // Stop the blocking connection, ensures that we don't accept additional jobs while waiting for
    // the ongoing jobs to terminate.
    if (this.settings.isWorker) {
      this.bclient.end(true);
    }

    // Wait for all the jobs to complete.
    return Promise.all(Array.from(this.activeJobs).map((promise) => promise.catch(() => {})));
  }).then(() => {
    const clients = [this.client];
    if (this.settings.getEvents) {
      clients.push(this.eclient);
    }

    return Promise.all(clients.map((client) => {
      const promise = helpers.deferred();
      client.quit(promise.defer());
      return promise;
    }));
  }), timeout);

  this._closed = closed;

  if (cb) helpers.asCallback(closed, cb);
  return closed;
};

Queue.prototype.destroy = function (cb) {
  const promise = helpers.deferred();
  const args = ['id', 'jobs', 'stallTime', 'stalling', 'waiting', 'active', 'succeeded', 'failed']
    .map((key) => this.toKey(key));
  args.push(promise.defer());
  this.client.del.apply(this.client, args);

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Queue.prototype.checkHealth = function (cb) {
  let promise;
  if (this.paused) {
    promise = Promise.reject(new Error('closed'));
  } else {
    promise = this._ready.then(() => {
      if (this.paused) {
        throw new Error('closed');
      }
      const multi = helpers.deferred();
      this.client.multi()
        .llen(this.toKey('waiting'))
        .llen(this.toKey('active'))
        .scard(this.toKey('succeeded'))
        .scard(this.toKey('failed'))
        .zcard(this.toKey('delayed'))
        .get(this.toKey('id'))
        .exec(multi.defer());
      return multi;
    }).then((results) => ({
      waiting: results[0],
      active: results[1],
      succeeded: results[2],
      failed: results[3],
      delayed: results[4],
      newestJob: results[5] ? parseInt(results[5], 10) : 0
    }));
  }

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Queue.prototype.createJob = function (data) {
  return new Job(this, null, data);
};

Queue.prototype.getJob = function (jobId, cb) {
  let promise;
  if (this.jobs.has(jobId)) {
    promise = Promise.resolve(this.jobs.get(jobId));
  } else {
    promise = this._ready
      .then(() => Job.fromId(this, jobId))
      .then((job) => {
        if (job && this.settings.storeJobs) {
          this.jobs.set(jobId, job);
        }
        return job;
      });
  }

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Queue.prototype.removeJob = function (jobId, cb) {
  const promise = this._evalScript('removeJob', 7,
    this.toKey('succeeded'), this.toKey('failed'), this.toKey('waiting'), this.toKey('active'),
    this.toKey('stalling'), this.toKey('jobs'), this.toKey('delayed'), jobId)
    .then(() => this);

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Queue.prototype.getNextJob = function (cb) {
  const promise = new Promise((resolve, reject) => {
    if (this.paused) return resolve(null);

    this.bclient.brpoplpush(this.toKey('waiting'), this.toKey('active'), 0, (err, jobId) => {
      /* istanbul ignore if */
      if (err) {
        if (err.name === 'AbortError' && this.paused) {
          return resolve(null);
        }
        return reject(err);
      }
      resolve(Job.fromId(this, jobId)
        .then((job) => {
          // This case indicates a problem with bee-queue, and the error is included to make finding
          // related regressions easier.
          /* istanbul ignore if */
          if (!job) throw new Error(`could not load job ${jobId}: not found`);
          return job;
        }));
    });
  });

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Queue.prototype.runJob = function (job, cb) {
  if (this.paused) {
    throw new Error('closed');
  }

  let psTimeout = null, handled = false;

  const preventStalling = () => {
    this._preventStall(job.id).then(() => {
      if (!handled) {
        psTimeout = setTimeout(preventStalling, this.settings.stallInterval / 2);
      }
    });
  };
  preventStalling();

  const handleOutcome = (err, data) => {
    handled = true;
    if (psTimeout) {
      clearTimeout(psTimeout);
      psTimeout = null;
    }

    return this._finishJob(err, data, job);
  };

  let promise = this.handler(job);

  if (job.options.timeout) {
    const timeoutMessage = `Job ${job.id} timed out (${job.options.timeout} ms)`;
    promise = helpers.withTimeout(promise, job.options.timeout, timeoutMessage);
  }

  const jobPromise = promise
    .then((data) => handleOutcome(null, data), handleOutcome)
    .then((data) => {
      this.activeJobs.delete(jobPromise);
      return data;
    }, (err) => {
      this.activeJobs.delete(jobPromise);
      throw err;
    });

  this.activeJobs.add(jobPromise);

  if (cb) helpers.asCallback(jobPromise, cb);
  return jobPromise;
};

Queue.prototype._preventStall = function (jobId) {
  const promise = helpers.deferred(), cb = promise.defer();
  this.client.srem(this.toKey('stalling'), jobId, () => {
    // Ignore errors wholesale.
    cb(null);
  });
  return promise;
};

Queue.prototype._finishJob = function (err, data, job, cb) {
  const status = err ? 'failed' : 'succeeded';

  const multi = this.client.multi()
    .lrem(this.toKey('active'), 0, job.id)
    .srem(this.toKey('stalling'), job.id);

  const jobEvent = {
    id: job.id,
    event: status,
    data: err ? err.message : data
  };

  if (err) {
    const strategyName = job.options.backoff ? job.options.backoff.strategy : 'immediate';
    const strategy = job.options.retries > 0 ? backoff.get(strategyName) : null;
    const delay = strategy ? strategy(job) : -1;
    if (delay < 0) {
      job.status = 'failed';
      if (this.settings.removeOnFailure) {
        multi.hdel(this.toKey('jobs'), job.id);
      } else {
        multi.hset(this.toKey('jobs'), job.id, job.toData());
        multi.sadd(this.toKey('failed'), job.id);
      }
    } else {
      job.options.retries -= 1;
      job.status = 'retrying';
      jobEvent.event = 'retrying';
      multi.hset(this.toKey('jobs'), job.id, job.toData());
      if (delay === 0) {
        multi.lpush(this.toKey('waiting'), job.id);
      } else {
        const time = Date.now() + delay;
        multi.zadd(this.toKey('delayed'), time, job.id)
          .publish(this.toKey('earlierDelayed'), time);
      }
    }
  } else {
    job.status = 'succeeded';
    if (this.settings.removeOnSuccess) {
      multi.hdel(this.toKey('jobs'), job.id);
    } else {
      multi.hset(this.toKey('jobs'), job.id, job.toData());
      multi.sadd(this.toKey('succeeded'), job.id);
    }
  }

  if (this.settings.sendEvents) {
    multi.publish(this.toKey('events'), JSON.stringify(jobEvent));
  }

  const result = err ? err : data;

  const promise = helpers.deferred();
  multi.exec(promise.defer());

  if (cb) promise.then(() => cb(null, status, result), cb);
  return promise.then(() => [status, result]);
};

Queue.prototype.process = function (concurrency, handler) {
  if (!this.settings.isWorker) {
    throw new Error('Cannot call Queue#process on a non-worker');
  }

  if (this.handler) {
    throw new Error('Cannot call Queue#process twice');
  }

  if (this.paused) {
    throw new Error('closed');
  }

  if (typeof concurrency === 'function') {
    handler = concurrency;
    concurrency = defaults['#process'].concurrency;
  }

  this.handler = helpers.wrapAsync(handler, this.settings.catchExceptions);
  this.running = 0;
  this.queued = 1;
  this.concurrency = concurrency;

  const jobTick = () => {
    if (this.paused) {
      this.queued -= 1;
      return;
    }

    // invariant: in this code path, this.running < this.concurrency, always
    // after spoolup, this.running + this.queued === this.concurrency
    this.getNextJob((getErr, job) => {
      /* istanbul ignore if */
      if (getErr) {
        this.emit('error', getErr);
        return setImmediate(jobTick);
      }

      // We're shutting down.
      if (this.paused) {
        this.queued -= 1;
        return;
      }

      this.running += 1;
      this.queued -= 1;
      if (this.running + this.queued < this.concurrency) {
        this.queued += 1;
        setImmediate(jobTick);
      }

      // Should runJob throw a synchronous error uncaught by wrapAsync, it'll hit the event loop
      // because getNextJob is called with a callback.
      this.runJob(job).catch((err) => {
        this.emit('error', err);
      }).then((results) => {
        this.running -= 1;
        this.queued += 1;

        /* istanbul ignore else */
        if (results) {
          const status = results[0], result = results[1];
          this.emit(status, job, result);
        }

        setImmediate(jobTick);
      });
    });
  };

  this._ready.then(() => {
    const restartProcessing = () => {
      // maybe need to increment queued here?
      this.bclient.once('ready', jobTick);
    };
    this.bclient.on('error', restartProcessing);
    this.bclient.on('end', restartProcessing);
  });

  this.checkStalledJobs(() => setImmediate(jobTick));
  this._processDelayed();

  return this;
};

/**
 * Check for stalled jobs.
 *
 * @param {Number=} interval The interval on which to check for stalled jobs. This should be set to
 *   half the stallInterval setting, to avoid unnecessary work.
 * @param {Function=} callback Called with the equivalent of the returned promise. If interval is
 *   provided, the callback will be invoked after each invocation of checkStalledJobs.
 * @return {Promise<Number>} Resolves to the number of stalled jobs the function found.
 */
Queue.prototype.checkStalledJobs = function (interval, cb) {
  if (typeof interval === 'function') {
    cb = interval;
    interval = null;
  }

  if (this.paused) {
    const promise = Promise.resolve(-1);

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  const promise = this._evalScript('checkStalledJobs', 4,
    this.toKey('stallTime'), this.toKey('stalling'), this.toKey('waiting'), this.toKey('active'),
    Date.now(), this.settings.stallInterval)
    .then((stalled) => {
      for (let jobId of stalled) {
        this.emit('stalled', jobId);
      }
      return stalled.length;
    });

  if (cb) helpers.asCallback(promise, cb);

  if (Number.isSafeInteger(interval) && !this.checkTimer) {
    promise.then(() => {
      if (this.checkTimer || this.paused) return;
      this.checkTimer = setTimeout(() => {
        this.checkTimer = null;
        this.checkStalledJobs(interval, cb);
      }, interval);
    });
  }

  return promise;
};

Queue.prototype._processDelayed = function () {
  if (!this.settings.processDelayed) return;
  this._evalScript('raiseDelayedJobs', 2, this.toKey('delayed'), this.toKey('waiting'),
    Date.now(), this.settings.delayedDebounce)
    .then((results) => {
      const numRaised = results[0], nextOpportunity = results[1];
      if (numRaised) {
        this.emit('raised jobs', numRaised);
      }
      this._delayedTimer.schedule(nextOpportunity);
    }, (err) => {
      // Handle aborted redis connections.
      if (err.name === 'AbortError') {
        if (this.paused) return;
        // Retry.
        return this._processDelayed();
      }
      this.emit('error', err);
    });
};

Queue.prototype.toKey = function (str) {
  return this.settings.keyPrefix + str;
};

/**
 * Evaluate the named script, return a promise with its results.
 *
 * Same parameter list/syntax as evalsha, except for the name.
 */
Queue.prototype._evalScript = function (name) {
  const args = helpers.toArray(arguments);

  return this._ready.then(() => {
    // Get the sha for the script after we're ready to avoid a race condition with the lua script
    // loader.
    args[0] = lua.shas[name];

    const promise = helpers.deferred();
    args.push(promise.defer());
    this.client.evalsha.apply(this.client, args);
    return promise;
  });
};

module.exports = Queue;
