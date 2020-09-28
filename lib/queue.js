'use strict';

const redis = require('./redis');
const Emitter = require('events').EventEmitter;

const Job = require('./job');
const defaults = require('./defaults');
const lua = require('./lua');
const helpers = require('./helpers');
const backoff = require('./backoff');
const EagerTimer = require('./eager-timer');
const finally_ = require('p-finally');
const crypto = require('crypto');

const CLIENT_ID_BYTES = 16;

const randomBytes = helpers.promisify(crypto.randomBytes);

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

    this._emitError = (err) => void this.emit('error', err);
    this._emitErrorAfterTick = (err) =>
      void process.nextTick(() => this.emit('error', err));

    this.client = null;
    this.bclient = null;
    this.eclient = null;

    settings = settings || {};
    this.settings = {
      redis: settings.redis || {},
      quitCommandClient: settings.quitCommandClient,
      keyPrefix: (settings.prefix || defaults.prefix) + ':' + this.name + ':',
    };

    for (const prop in defaults) {
      const def = defaults[prop],
        setting = settings[prop],
        type = typeof def;
      if (type === 'boolean') {
        this.settings[prop] = typeof setting === 'boolean' ? setting : def;
      } else if (type === 'number') {
        this.settings[prop] = Number.isSafeInteger(setting) ? setting : def;
      }
    }

    this._generateLocalJobID = !!(
      this.settings.clientUUID ||
      (this.settings.storeJobs && this.settings.getEvents)
    );
    this._resolvedClientUUID = null;
    this._clientUUID = null;
    if (settings.clientUUID || this._generateLocalJobID) {
      const clientUUID = settings.clientUUID
        ? Promise.resolve(settings.clientUUID)
        : randomBytes(CLIENT_ID_BYTES).then((buffer) =>
            buffer
              .toString('base64')
              .replace(/=+$/, '')
              .replace(/=/g, '_')
              .replace(/\//g, '-')
          );
      clientUUID.catch(() => {
        this._jobsByLocalID = null;
        this._generateLocalJobID = false;
      });
      this._clientUUID = finally_(
        clientUUID,
        () => (this._clientUUID = null)
      ).then((value) => (this._resolvedClientUUID = value));
    }
    this._localJobIDCounter = 0;
    this._jobsByLocalID = this._generateLocalJobID ? new Map() : null;

    /* istanbul ignore if */
    if (this.settings.redis.socket) {
      this.settings.redis = Object.assign({}, this.settings.redis, {
        path: this.settings.redis.socket,
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
      return redis
        .createClient(this.settings.redis, createNew)
        .then((client) => {
          // This event gets cleaned up and removed in Queue#close for the
          // primary client if quitCommandClient is disabled.
          client.on('error', this._emitError);
          return (this[clientName] = client);
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
        return Promise.all(
          channels.map((channel) =>
            helpers.callAsync((done) => this.eclient.subscribe(channel, done))
          )
        );
      });
    }

    this._isReady = false;

    // Wait for Lua scripts and client connections to load. Also wait for
    // bclient and eclient/subscribe if they're needed.
    this._ready = Promise.all([
      // Make the clients
      makeClient('client', false),
      this.settings.isWorker ? makeClient('bclient', true) : null,
      eventsPromise,
      this._clientUUID,
    ])
      .then(() => {
        if (this.settings.ensureScripts) {
          return lua.buildCache(this.client);
        }
      })
      .then(() => {
        this._isReady = true;
        setImmediate(() => this.emit('ready'));
        return this;
      });
  }

  _emitHandleErrors(args) {
    helpers.emitHandleErrors(this, args);
  }

  _onJobMessage(job, message) {
    if (!job) return;

    const event = message.event;
    switch (event) {
      case 'progress':
        job.progress = message.data;
        break;
      case 'retrying':
        --job.options.retries;
      // fallthrough
      case 'succeeded':
      case 'failed':
        job.status = event;
        break;
    }

    helpers.emitHandleErrors(job, [event, message.data]);

    if (event === 'succeeded' || event === 'failed') {
      this.jobs.delete(message.id);
    }
  }

  _identifyJobFromMessage(message) {
    const job = this.jobs.get(message.id);
    if (job) return job;

    const localJobID = message.localID;
    // If the clientUUID hasn't resolved yet, then there's no way we've already
    // published a job. We can just ignore any unattributed messages at this
    // point if that's the case.
    if (!this._jobsByLocalID || !this._resolvedClientUUID || !localJobID) {
      return null;
    }

    const prefix = `${this._resolvedClientUUID}:`;
    return localJobID.startsWith(prefix)
      ? this._jobsByLocalID.get(localJobID.slice(prefix.length))
      : null;
  }

  _onMessageInner(channel, message) {
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

    this._emitHandleErrors([`job ${message.event}`, message.id, message.data]);

    this._onJobMessage(this._identifyJobFromMessage(message), message);
  }

  _onMessage() {
    try {
      this._onMessageInner.apply(this, arguments);
    } catch (err) {
      this._emitError(err);
    }
  }

  isRunning() {
    return !this.paused;
  }

  ready(cb) {
    if (cb) {
      helpers.asCallback(
        this._ready.then(() => {}),
        cb
      );
    }

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
      if (cb) helpers.asCallback(this._closed, cb);
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

    const drain = () =>
      helpers.finallyRejectsWithInitial(this._ready, () => {
        // Stop the blocking connection, ensures that we don't accept additional
        // jobs while waiting for the ongoing jobs to terminate.
        if (this.settings.isWorker) {
          redis.disconnect(this.bclient);
        }

        // Wait for all the jobs to complete. Ignore job errors during shutdown.
        return Promise.all(
          Array.from(this.activeJobs, (promise) => promise.catch(() => {}))
        ).then(() => {});
      });

    const cleanup = () => {
      this._isClosed = true;

      const clients = [];
      if (this.client) {
        if (this.settings.quitCommandClient) {
          clients.push(this.client);
        } else {
          this.client.removeListener('error', this._emitError);
        }
      }
      if (this.eclient) {
        clients.push(this.eclient);
      }

      // node_redis' implementation of the QUIT command does not permit it to
      // fail. We do not need to consider the case that the quit command aborts.
      return Promise.all(
        clients.map((client) => helpers.callAsync((done) => client.quit(done)))
      );
    };

    const closed = helpers.finallyRejectsWithInitial(
      helpers.withTimeout(drain(), timeout),
      () => cleanup()
    );

    this._closed = closed;

    if (cb) helpers.asCallback(closed, cb);
    return closed;
  }

  destroy(cb) {
    const promise = this._commandable().then((client) =>
      helpers.callAsync((done) => {
        const args = [
          'id',
          'jobs',
          'stallBlock',
          'stalling',
          'waiting',
          'active',
          'succeeded',
          'failed',
          'delayed',
        ].map((key) => this.toKey(key));
        args.push(done);
        client.del.apply(client, args);
      })
    );

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  checkHealth(cb) {
    const promise = this._commandable()
      .then((client) =>
        helpers.callAsync((done) =>
          client
            .multi()
            .llen(this.toKey('waiting'))
            .llen(this.toKey('active'))
            .scard(this.toKey('succeeded'))
            .scard(this.toKey('failed'))
            .zcard(this.toKey('delayed'))
            .get(this.toKey('id'))
            .exec(done)
        )
      )
      .then((results) => ({
        waiting: results[0],
        active: results[1],
        succeeded: results[2],
        failed: results[3],
        delayed: results[4],
        newestJob: results[5] ? parseInt(results[5], 10) : 0,
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
      for (const id of ids) {
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
    return this._commandable()
      .then((client) =>
        helpers.callAsync((done) =>
          client.hmget.apply(client, [this.toKey('jobs')].concat(ids, done))
        )
      )
      .then((dataArray) => {
        const count = ids.length;
        // Some jobs returned by the scan may have already been removed, so
        // filter them out.
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
    page = Object.assign(
      {
        size: 100,
        start: 0,
        end: 100,
      },
      page
    );
    const promise = this._commandable()
      .then((client) =>
        helpers.callAsync((next) => {
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
        })
      )
      .then((ids) => {
        const jobs = [],
          idsToFetch = [];
        // ids might be a Set or an Array, but this will iterate just the same.
        for (const jobId of ids) {
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
    const promise = this._commandable()
      .then(() =>
        this.jobs.has(jobId) ? this.jobs.get(jobId) : Job.fromId(this, jobId)
      )
      .then((job) => {
        if (job && this.settings.storeJobs) {
          this.jobs.set(jobId, job);
        }
        return job;
      });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  removeJob(jobId, cb) {
    const promise = this._evalScript(
      'removeJob',
      7,
      this.toKey('succeeded'),
      this.toKey('failed'),
      this.toKey('waiting'),
      this.toKey('active'),
      this.toKey('stalling'),
      this.toKey('jobs'),
      this.toKey('delayed'),
      jobId
    ).then(() => {
      if (this.settings.storeJobs) {
        this.jobs.delete(jobId);
      }
      return this;
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  _waitForJob() {
    return helpers
      .callAsync((done) =>
        this.bclient.brpoplpush(
          this.toKey('waiting'),
          this.toKey('active'),
          0,
          done
        )
      )
      .then(
        (jobId) =>
          // Note that the job may be null in the case that the client has
          // removed the job before processing can take place, but after the
          // brpoplpush has returned the job id.
          Job.fromId(this, jobId),
        (err) =>
          redis.isAbortError(err) && this.paused ? null : Promise.reject(err)
      );
  }

  _getNextJob() {
    // Under normal calling conditions, commandable will not reject because we
    // will have just checked paused in Queue#process.
    return this._commandable(true).then(() => this._waitForJob());
  }

  _runJob(job) {
    let psTimeout = null,
      completed = false;

    const preventStalling = () => {
      psTimeout = null;
      if (this._isClosed) return;
      finally_(this._preventStall(job.id), () => {
        if (completed || this._isClosed) return;
        const interval = this.settings.stallInterval / 2;
        psTimeout = setTimeout(preventStalling, interval);
      }).catch(this._emitErrorAfterTick);
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

    const jobPromise = finally_(
      promise.then((data) => handleOutcome(null, data), handleOutcome),
      // The only error that can happen here is either network- or
      // Redis-related, or if Queue#close times out while a job is processing,
      // and the job later finishes.
      () => this.activeJobs.delete(jobPromise)
    );

    // We specifically use the value produced by then to avoid cases where the
    // process handler returns the same Promise object each invocation.
    this.activeJobs.add(jobPromise);
    return jobPromise;
  }

  _preventStall(jobId) {
    return helpers.callAsync((done) =>
      this.client.srem(this.toKey('stalling'), jobId, done)
    );
  }

  _finishJob(err, data, job) {
    const status = err ? 'failed' : 'succeeded';

    if (this._isClosed) {
      throw new Error(`unable to update the status of ${status} job ${job.id}`);
    }

    const multi = this.client
      .multi()
      .lrem(this.toKey('active'), 0, job.id)
      .srem(this.toKey('stalling'), job.id);

    const jobEvent = {
      id: job.id,
      localID: job.options.localID || undefined,
      event: status,
      data: err ? err.message : data,
    };

    if (err) {
      const errInfo = err.stack || err.message || err;
      job.options.stacktraces.unshift(errInfo);

      const strategyName = job.options.backoff
        ? job.options.backoff.strategy
        : 'immediate';
      const strategy =
        job.options.retries > 0 ? backoff.get(strategyName) : null;
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
          multi
            .zadd(this.toKey('delayed'), time, job.id)
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

    return helpers
      .callAsync((done) => multi.exec(done))
      .then(() => [status, result]);
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
      finally_(
        this._getNextJob().then((job) => {
          // We're shutting down.
          if (this.paused) {
            // This job will get picked up later as a stalled job if we happen
            // to get here. We can't easily process this job because at this
            // point Queue#close has already captured the activeJobs set in a
            // Promise.all call, and we'd prefer to delay a job than
            // half-process it.
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
            // Per comment in Queue#_waitForJob, this branch is possible when
            // the job is removed before processing can take place, but after
            // being initially acquired.
            return;
          }

          return this._runJob(job).then((results) => {
            this.running -= 1;
            this.queued += 1;

            /* istanbul ignore else */
            if (results) {
              const status = results[0],
                result = results[1];
              this._emitHandleErrors([status, job, result]);
            }
          }, this._emitErrorAfterTick);
        }),
        () => setImmediate(jobTick)
      ).catch(this._emitErrorAfterTick);
    };

    this._doStalledJobCheck().then(jobTick).catch(this._emitErrorAfterTick);
    this._activateDelayed();

    return this;
  }

  _doStalledJobCheck() {
    return this._evalScript(
      'checkStalledJobs',
      4,
      this.toKey('stallBlock'),
      this.toKey('stalling'),
      this.toKey('waiting'),
      this.toKey('active'),
      this.settings.stallInterval
    )
      .then((stalled) => {
        for (const jobId of stalled) {
          this._emitHandleErrors(['stalled', jobId]);
        }
        return stalled.length;
      })
      .catch(this._emitErrorAfterTick);
  }

  _safeCheckStalledJobs(interval, cb) {
    const promise = this._checkStalledJobs(interval, cb);
    // If a callback is not defined, then we must emit errors to avoid unhandled
    // rejections. If there is a callback, then _checkStalledJobs will attach it
    // as an error handler to `promise`.
    if (!cb) promise.catch(this._emitErrorAfterTick);
  }

  _scheduleStalledCheck(interval, cb) {
    if (this.checkTimer || this.paused) return;
    this.checkTimer = setTimeout(() => {
      // The checkTimer is unset and cleared when Queue#close is called,
      // so we don't need to check for it here.
      this.checkTimer = null;
      this._safeCheckStalledJobs(interval, cb);
    }, interval);
  }

  _checkStalledJobs(interval, cb) {
    const promise = this._doStalledJobCheck();
    if (cb) helpers.asCallback(promise, cb);
    return interval && !this.checkTimer
      ? finally_(promise, () => {
          try {
            this._scheduleStalledCheck(interval, cb);
          } catch (err) {
            // istanbul ignore next: safety belts
            this._emitErrorAfterTick(err);
          }
        })
      : promise;
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
    this._evalScript(
      'raiseDelayedJobs',
      2,
      this.toKey('delayed'),
      this.toKey('waiting'),
      Date.now(),
      this.settings.delayedDebounce
    ).then(
      (results) => {
        const numRaised = results[0],
          nextOpportunity = results[1];
        if (numRaised) {
          this._emitHandleErrors(['raised jobs', numRaised]);
        }
        this._delayedTimer.schedule(parseInt(nextOpportunity, 10));
      },
      /* istanbul ignore next */ (err) => {
        // Handle aborted redis connections.
        if (redis.isAbortError(err)) {
          if (this.paused) return;
          // Retry.
          return this._activateDelayed();
        }
        this._emitErrorAfterTick(err);
      }
    );
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

    return this._commandable().then((client) =>
      helpers.callAsync((done) => {
        // Get the sha for the script after we're ready to avoid a race
        // condition with the lua script loader.
        args[0] = lua.shas[name];

        args.push(done);
        client.evalsha.apply(client, args);
      })
    );
  }
}

module.exports = Queue;
