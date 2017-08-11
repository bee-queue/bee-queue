'use strict';

const redis = require('./redis');
const Emitter = require('events').EventEmitter;

const Job = require('./job');
const defaults = require('./defaults');
const lua = require('./lua');
const helpers = require('./helpers');
const backoff = require('./backoff');
const EagerTimer = require('./eager-timer');

class Queue extends Emitter {
  constructor(name, settings) {
    super();

    this.name = name;
    this.paused = false;
    this.jobs = new Map();
    this.activeJobs = new Set();
    this.checkTimer = null;

    this._closed = null;
    this._isClosed = false;

    this.client = null;
    this.bclient = null;
    this.eclient = null;

    settings = settings || {};
    this.settings = {
      redis: settings.redis || {},
      quitCommandClient: settings.quitCommandClient,
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
      this.settings.redis = Object.assign({}, this.settings.redis, {
        path: this.settings.redis.socket
      });
    }

    // By default, if we're given a redis client and no additional instructions,
    // don't quit the connection on Queue#close.
    if (typeof this.settings.quitCommandClient !== 'boolean') {
      this.settings.quitCommandClient = !redis.isClient(this.settings.redis);
    }

    // To avoid changing the hidden class of the Queue.
    this._delayedTimer = this.settings.activateDelayedJobs
      ? new EagerTimer(this.settings.nearTermWindow)
      : null;
    if (this._delayedTimer) {
      this._delayedTimer.on('trigger', this._activateDelayed.bind(this));
    }

    const makeClient = (clientName, createNew) => {
      return redis.createClient(this.settings.redis, createNew)
        .then((client) => {
          client.on('error', this.emit.bind(this, 'error'));
          return this[clientName] = client;
        });
    };

    let eventsPromise = null;

    if (this.settings.getEvents || this.settings.activateDelayedJobs) {
      eventsPromise = makeClient('eclient', true).then(() => {
        this.eclient.on('message', this._onMessage.bind(this));
        const channels = [];
        if (this.settings.getEvents) {
          channels.push(this.toKey('events'));
        }
        if (this.settings.activateDelayedJobs) {
          channels.push(this.toKey('earlierDelayed'));
        }
        return Promise.all(channels.map((channel) => {
          const promise = helpers.deferred();
          this.eclient.subscribe(channel, promise.defer());
          return promise;
        }));
      });
    }

    this._isReady = false;

    // Wait for Lua scripts and client connections to load. Also wait for
    // bclient and eclient/subscribe if they're needed.
    this._ready = Promise.all([
      // Make the clients
      makeClient('client', false),
      this.settings.isWorker ? makeClient('bclient', true) : null,
      eventsPromise
    ]).then(() => {
      if (this.settings.ensureScripts) {
        return lua.buildCache(this.client);
      }
    }).then(() => {
      this._isReady = true;
      setImmediate(() => this.emit('ready'));
      return this;
    });
  }

  _onMessage(channel, message) {
    if (channel === this.toKey('earlierDelayed')) {
      // We should only receive these messages if activateDelayedJobs is
      // enabled.
      this._delayedTimer.schedule(parseInt(message, 10));
      return;
    }

    message = JSON.parse(message);
    if (message.event === 'failed' || message.event === 'retrying') {
      message.data = new Error(message.data);
    }

    this.emit('job ' + message.event, message.id, message.data);

    const job = this.jobs.get(message.id);
    if (job) {
      if (message.event === 'progress') {
        job.progress = message.data;
      } else if (message.event === 'retrying') {
        job.options.retries -= 1;
      }

      job.emit(message.event, message.data);

      if (message.event === 'succeeded' || message.event === 'failed') {
        this.jobs.delete(message.id);
      }
    }
  }

  isRunning() {
    return !this.paused;
  }

  ready(cb) {
    if (cb) this._ready.then(() => cb(null), cb);

    return this._ready;
  }

  _commandable(requireBlocking) {
    if (requireBlocking ? this.paused : this._isClosed) {
      return Promise.reject(new Error('closed'));
    }

    if (this._isReady) {
      return Promise.resolve(requireBlocking ? this.bclient : this.client);
    }

    return this._ready.then(() => this._commandable(requireBlocking));
  }

  close(timeout, cb) {
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

    if (this._delayedTimer) {
      this._delayedTimer.stop();
    }

    const cleanup = () => {
      this._isClosed = true;

      const clients = [];
      if (this.settings.quitCommandClient) {
        clients.push(this.client);
      }
      if (this.settings.getEvents) {
        clients.push(this.eclient);
      }

      return Promise.all(clients.map((client) => {
        const promise = helpers.deferred();
        client.quit(promise.defer());
        return promise;
      }));
    };

    const closed = helpers.withTimeout(this._ready.then(() => {
      // Stop the blocking connection, ensures that we don't accept additional
      // jobs while waiting for the ongoing jobs to terminate.
      if (this.settings.isWorker) {
        redis.disconnect(this.bclient);
      }

      // Wait for all the jobs to complete. Ignore job errors during shutdown.
      const waitJobs = Array.from(this.activeJobs);
      return Promise.all(waitJobs.map((promise) => promise.catch(() => {})));
    }), timeout).then(() => {
      return cleanup().then(() => undefined);
    }, (err) => {
      return cleanup().then(() => Promise.reject(err));
    });

    this._closed = closed;

    if (cb) helpers.asCallback(closed, cb);
    return closed;
  }

  destroy(cb) {
    const promise = this._commandable().then((client) => {
      const deleted = helpers.deferred();
      const args = ['id', 'jobs', 'stallBlock', 'stalling', 'waiting', 'active',
        'succeeded', 'failed', 'delayed']
        .map((key) => this.toKey(key));
      args.push(deleted.defer());
      client.del.apply(client, args);
      return deleted;
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  checkHealth(cb) {
    const promise = this._commandable().then((client) => {
      const multi = helpers.deferred();
      client.multi()
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

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  _scanForJobs(key, cursor, size, set, cb) {
    const batchCount = Math.min(size, this.settings.redisScanCount);
    this.client.sscan(key, cursor, 'COUNT', batchCount, (err, results) => {
      /* istanbul ignore if */
      if (err) {
        return cb(err);
      }

      const nextCursor = results[0];
      const ids = results[1];

      // A given element may be returned multiple times in SSCAN.
      // So, we use a set to remove duplicates.
      // https://redis.io/commands/scan#scan-guarantees
      for (let id of ids) {
        // For small sets, encoded as intsets, SSCAN will ignore COUNT.
        // https://redis.io/commands/scan#the-count-option
        if (set.size === size) break;

        set.add(id);
      }

      if (nextCursor === '0' || set.size >= size) {
        return cb(null, set);
      }

      this._scanForJobs(key, nextCursor, size, set, cb);
    });
  }

  _addJobsByIds(jobs, ids) {
    // We need to re-ensure the queue is commandable, as we might be shutting
    // down during this operation.
    return this._commandable().then((client) => {
      const got = helpers.deferred();
      const commandArgs = [this.toKey('jobs')].concat(ids, got.defer());
      client.hmget.apply(client, commandArgs);
      return got;
    }).then((dataArray) => {
      const count = ids.length;
      // Some jobs returned by the scan may have already been removed, so filter
      // them out.
      for (let i = 0; i < count; ++i) {
        const jobData = dataArray[i];
        /* istanbul ignore else: not worth unit-testing this edge case */
        if (jobData) {
          jobs.push(Job.fromData(this, ids[i], jobData));
        }
      }
      return jobs;
    });
  }

  /**
   * Get jobs from queue type.
   *
   * @param {String} type The queue type (failed, succeeded, waiting, etc.)
   * @param {?Object=} page An object containing some of the following fields.
   * @param {Number=} page.start Start of query range for waiting/active/delayed
   *   queue types. Defaults to 0.
   * @param {Number=} page.end End of query range for waiting/active/delayed
   *   queue types. Defaults to 100.
   * @param {Number=} page.size Number jobs to return for failed/succeeded (SET)
   *   types. Defaults to 100.
   * @param {Function=} callback Called with the equivalent of the returned
   *   promise.
   * @return {Promise<Job[]>} Resolves to the jobs the function found.
   */
  getJobs(type, page, cb) {
    if (typeof page === 'function') {
      cb = page;
      page = null;
    }
    // Set defaults.
    page = Object.assign({
      size: 100,
      start: 0,
      end: 100
    }, page);
    const promise = this._commandable().then((client) => {
      const idsPromise = helpers.deferred(), next = idsPromise.defer();
      const key = this.toKey(type);
      switch (type) {
        case 'failed':
        case 'succeeded':
          this._scanForJobs(key, '0', page.size, new Set(), next);
          break;
        case 'waiting':
        case 'active':
          client.lrange(key, page.start, page.end, next);
          break;
        case 'delayed':
          client.zrange(key, page.start, page.end, next);
          break;
        default:
          throw new Error('Improper queue type');
      }

      return idsPromise;
    }).then((ids) => {
      const jobs = [], idsToFetch = [];
      // ids might be a Set or an Array, but this will iterate just the same.
      for (let jobId of ids) {
        const job = this.jobs.get(jobId);
        if (job) {
          jobs.push(job);
        } else {
          idsToFetch.push(jobId);
        }
      }
      if (!idsToFetch.length) {
        return jobs;
      }
      return this._addJobsByIds(jobs, idsToFetch);
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  createJob(data) {
    return new Job(this, null, data);
  }

  getJob(jobId, cb) {
    const promise = this._commandable().then(() => {
      if (this.jobs.has(jobId)) {
        return this.jobs.get(jobId);
      }
      return Job.fromId(this, jobId);
    }).then((job) => {
      if (job && this.settings.storeJobs) {
        this.jobs.set(jobId, job);
      }
      return job;
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  removeJob(jobId, cb) {
    const promise = this._evalScript('removeJob', 7,
      this.toKey('succeeded'), this.toKey('failed'), this.toKey('waiting'),
      this.toKey('active'), this.toKey('stalling'), this.toKey('jobs'),
      this.toKey('delayed'), jobId)
      .then(() => this);

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  _waitForJob() {
    const idPromise = helpers.deferred();
    this.bclient.brpoplpush(this.toKey('waiting'), this.toKey('active'), 0,
      idPromise.defer());

    return idPromise.then((jobId) => {
      // Note that the job may be null in the case that the client has removed
      // the job before processing can take place, but after the brpoplpush has
      // returned the job id.
      return Job.fromId(this, jobId);
    }, (err) => {
      if (redis.isAbortError(err) && this.paused) {
        return null;
      }
      throw err;
    });
  }

  _getNextJob() {
    // Under normal calling conditions, commandable will not reject because we
    // will have just checked paused in Queue#process.
    return this._commandable(true).then(() => this._waitForJob());
  }

  _runJob(job) {
    let psTimeout = null, completed = false;

    const preventStalling = () => {
      psTimeout = null;
      if (this._isClosed) return;
      this._preventStall(job.id).then(() => {
        if (completed || this._isClosed) return;
        const interval = this.settings.stallInterval / 2;
        psTimeout = setTimeout(preventStalling, interval);
      });
    };
    preventStalling();

    const handleOutcome = (err, data) => {
      completed = true;
      if (psTimeout) {
        clearTimeout(psTimeout);
        psTimeout = null;
      }

      return this._finishJob(err, data, job);
    };

    let promise = this.handler(job);

    if (job.options.timeout) {
      const message = `Job ${job.id} timed out (${job.options.timeout} ms)`;
      promise = helpers.withTimeout(promise, job.options.timeout, message);
    }

    const jobPromise = promise
      .then((data) => handleOutcome(null, data), handleOutcome)
      .then((data) => {
        this.activeJobs.delete(jobPromise);
        return data;
      }, (err) => {
        // The only error that can happen here is either network- or
        // Redis-related, or if Queue#close times out while a job is processing,
        // and the job later finishes.
        this.activeJobs.delete(jobPromise);
        throw err;
      });

    // We specifically use the value produced by then to avoid cases where the
    // process handler returns the same Promise object each invocation.
    this.activeJobs.add(jobPromise);
    return jobPromise;
  }

  _preventStall(jobId) {
    const promise = helpers.deferred(), cb = promise.defer();
    this.client.srem(this.toKey('stalling'), jobId, cb);
    /* istanbul ignore next: these errors are only redis or network errors */
    return promise.catch((err) => this.emit('error', err));
  }

  _finishJob(err, data, job) {
    const status = err ? 'failed' : 'succeeded';

    if (this._isClosed) {
      throw new Error(`unable to update the status of ${status} job ${job.id}`);
    }

    const multi = this.client.multi()
      .lrem(this.toKey('active'), 0, job.id)
      .srem(this.toKey('stalling'), job.id);

    const jobEvent = {
      id: job.id,
      event: status,
      data: err ? err.message : data
    };

    if (err) {
      const errInfo = err.stack || err.message || err;
      job.options.stacktraces.unshift(errInfo);

      const strategyName = job.options.backoff
        ? job.options.backoff.strategy
        : 'immediate';
      const strategy = job.options.retries > 0
        ? backoff.get(strategyName)
        : null;
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

    const result = err || data;

    const promise = helpers.deferred();
    multi.exec(promise.defer());

    return promise.then(() => [status, result]);
  }

  process(concurrency, handler) {
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

    // If the handler throws a synchronous exception (only applicable to
    // non-`async` functions), catch it, and fail the job.
    const catchExceptions = true;
    this.handler = helpers.wrapAsync(handler, catchExceptions);
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
      this._getNextJob().then((job) => {
        // We're shutting down.
        if (this.paused) {
          // This job will get picked up later as a stalled job if we happen to
          // get here. We can't easily process this job because at this point
          // Queue#close has already captured the activeJobs set in a
          // Promise.all call, and we'd prefer to delay a job than half-process
          // it.
          this.queued -= 1;
          return;
        }

        this.running += 1;
        this.queued -= 1;
        if (this.running + this.queued < this.concurrency) {
          this.queued += 1;
          setImmediate(jobTick);
        }

        if (!job) {
          // Per comment in Queue#_waitForJob, this branch is possible when the
          // job is removed before processing can take place, but after being
          // initially acquired.
          setImmediate(jobTick);
          return;
        }

        return this._runJob(job).catch((err) => {
          this.emit('error', err);
        }).then((results) => {
          this.running -= 1;
          this.queued += 1;

          setImmediate(jobTick);

          /* istanbul ignore else */
          if (results) {
            const status = results[0], result = results[1];
            this.emit(status, job, result);
          }
        });
      }, (err) => {
        setImmediate(jobTick);
        throw err;
      }).catch((err) => this.emit('error', err));
    };

    this.checkStalledJobs(jobTick);
    this._activateDelayed();

    return this;
  }

  _doStalledJobCheck() {
    return this._evalScript('checkStalledJobs', 4, this.toKey('stallBlock'),
      this.toKey('stalling'), this.toKey('waiting'), this.toKey('active'),
      this.settings.stallInterval)
      .then((stalled) => {
        for (let jobId of stalled) {
          this.emit('stalled', jobId);
        }
        return stalled.length;
      });
  }

  _checkStalledJobs(interval, cb) {
    const promise = this._doStalledJobCheck();
    if (cb) helpers.asCallback(promise, cb);

    if (interval && !this.checkTimer) {
      promise.then(() => {
        if (this.checkTimer || this.paused) return;
        this.checkTimer = setTimeout(() => {
          // The checkTimer is removed when Queue#close is called, so we don't
          // need to check for it here.
          this.checkTimer = null;
          const postStalled = this._checkStalledJobs(interval, cb);
          // If it's not the first call, and a callback is not defined, then we
          // must emit errors to avoid unnecessary unhandled rejections.
          /* istanbul ignore next: these are only redis and connection errors */
          postStalled.catch(cb ? (err) => this.emit('error', err) : null);
        }, interval);
      });
    }

    return promise;
  }

  /**
   * Check for stalled jobs.
   *
   * @param {Number=} interval The interval on which to check for stalled jobs.
   *   This should be set to half the stallInterval setting, to avoid
   *   unnecessary work.
   * @param {Function=} callback Called with the equivalent of the returned
   *   promise. If interval is provided, the callback will be invoked after each
   *   invocation of checkStalledJobs.
   * @return {Promise<Number>} Resolves to the number of stalled jobs the
   *   function found.
   */
  checkStalledJobs(interval, cb) {
    if (typeof interval === 'function') {
      cb = interval;
      interval = null;
    } else if (!Number.isSafeInteger(interval)) {
      interval = null;
    }
    return this._checkStalledJobs(interval, cb);
  }

  _activateDelayed() {
    if (!this.settings.activateDelayedJobs) return;
    this._evalScript('raiseDelayedJobs', 2,
      this.toKey('delayed'),
      this.toKey('waiting'),
      Date.now(), this.settings.delayedDebounce)
      .then((results) => {
        const numRaised = results[0], nextOpportunity = results[1];
        if (numRaised) {
          this.emit('raised jobs', numRaised);
        }
        this._delayedTimer.schedule(parseInt(nextOpportunity, 10));
      }, /* istanbul ignore next */ (err) => {
        // Handle aborted redis connections.
        if (redis.isAbortError(err)) {
          if (this.paused) return;
          // Retry.
          return this._activateDelayed();
        }
        this.emit('error', err);
      });
  }

  toKey(str) {
    return this.settings.keyPrefix + str;
  }

  /**
   * Evaluate the named script, return a promise with its results.
   *
   * Same parameter list/syntax as evalsha, except for the name.
   */
  _evalScript(name) {
    // Avoid deoptimization by leaking arguments: store them directly in an
    // array instead of passing them to a helper.
    const args = new Array(arguments.length);
    // Skip the first because it's just the name, and it'll get filled in within
    // the promise.
    for (let i = 1; i < arguments.length; ++i) {
      args[i] = arguments[i];
    }

    return this._commandable().then((client) => {
      // Get the sha for the script after we're ready to avoid a race condition
      // with the lua script loader.
      args[0] = lua.shas[name];

      const promise = helpers.deferred();
      args.push(promise.defer());
      client.evalsha.apply(client, args);
      return promise;
    });
  }
}

module.exports = Queue;
