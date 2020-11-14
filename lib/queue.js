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
    this.backoffStrategies = new Map(backoff);

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
      this._delayedTimer.on('trigger', () => this._activateDelayed());
    }

    const makeClient = async (createNew, getClientID) => {
      const client = await redis.createClient(this.settings.redis, {
        createNew,
        getClientID,
      });
      // This event gets cleaned up and removed in Queue#close for the
      // primary client if quitCommandClient is disabled.
      client.on('error', this._emitError);
      return client;
    };

    const makeEventClient = async () => {
      if (!this.settings.getEvents && !this.settings.activateDelayedJobs) {
        return;
      }
      const eclient = await makeClient(true, false);
      this.eclient = eclient;
      eclient.on('message', (channel, message) =>
        this._onMessage(channel, message)
      );
      const channels = [];
      if (this.settings.getEvents) {
        channels.push(this.toKey('events'));
      }
      if (this.settings.activateDelayedJobs) {
        channels.push(this.toKey('earlierDelayed'));
      }
      return Promise.all(channels.map((channel) => eclient.subscribe(channel)));
    };

    this._isReady = false;

    // Wait for needed client connections, event subs, and Lua script caching
    this._ready = (async () => {
      await Promise.all([
        makeClient(false, false).then((client) => (this.client = client)),
        this.settings.isWorker
          ? makeClient(true, true).then((bclient) => (this.bclient = bclient))
          : null,
        makeEventClient(),
      ]);
      if (this.settings.ensureScripts) {
        await lua.buildCache(this.client);
      }
      this._isReady = true;
      setImmediate(() => this.emit('ready'));
      return this;
    })();
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

  ready() {
    return this._ready;
  }

  async _commandable(requireBlocking) {
    if (requireBlocking ? this.paused : this._isClosed) {
      throw new Error('closed');
    }

    if (this._isReady) {
      return requireBlocking ? this.bclient : this.client;
    }

    await this._ready;
    return this._commandable(requireBlocking);
  }

  close(timeout) {
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
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

    const drain = () =>
      helpers.finallyRejectsWithInitial(this._ready, async () => {
        // Stop the blocking connection, to ensure that we don't accept
        // additional jobs while waiting for the ongoing jobs to terminate.
        if (this.settings.isWorker) {
          await redis.cleanDisconnect(this.bclient, this.client);
        }

        // Wait for all the jobs to complete. Ignore job errors during shutdown.
        await Promise.all(
          Array.from(this.activeJobs, (promise) => promise.catch(() => {}))
        );
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

      return Promise.all(
        clients.map((client) =>
          client.quit().catch(() => redis.disconnect(client))
        )
      );
    };

    this._closed = helpers.finallyRejectsWithInitial(
      helpers.withTimeout(drain(), timeout),
      () => cleanup()
    );

    return this._closed;
  }

  async destroy() {
    const client = await this._commandable();
    const args = [
      'id',
      'jobs',
      'waiting',
      'active',
      'succeeded',
      'failed',
      'delayed',
      'stallBlock',
      'stalling',
    ].map((key) => this.toKey(key));
    return client.del(args);
  }

  async checkHealth() {
    const client = await this._commandable();
    const [
      [, waiting],
      [, active],
      [, succeeded],
      [, failed],
      [, delayed],
      [, newestJob],
    ] = await client
      .multi()
      .llen(this.toKey('waiting'))
      .llen(this.toKey('active'))
      .scard(this.toKey('succeeded'))
      .scard(this.toKey('failed'))
      .zcard(this.toKey('delayed'))
      .get(this.toKey('id'))
      .exec();
    return {
      waiting,
      active,
      succeeded,
      failed,
      delayed,
      newestJob: newestJob ? parseInt(newestJob, 10) : 0,
    };
  }

  async _scanForJobs(key, cursor, size, set) {
    const batchCount = Math.min(size, this.settings.redisScanCount);
    const results = await this.client.sscan(key, cursor, 'COUNT', batchCount);
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
      return set;
    }

    return this._scanForJobs(key, nextCursor, size, set);
  }

  async _addJobsByIds(jobs, ids) {
    // We need to re-ensure the queue is commandable, as we might be shutting
    // down during this operation.
    const client = await this._commandable();
    const dataArray = await client.hmget([this.toKey('jobs'), ...ids]);
    // Some jobs returned by the scan may have already been removed, so filter
    // them out.
    for (let i = 0; i < ids.length; ++i) {
      const jobData = dataArray[i];
      /* istanbul ignore else: not worth unit-testing this edge case */
      if (jobData) {
        jobs.push(Job.fromData(this, ids[i], jobData));
      }
    }
    return jobs;
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
  async getJobs(type, page) {
    // Set defaults.
    page = Object.assign(
      {
        size: 100,
        start: 0,
        end: 100,
      },
      page
    );
    const client = await this._commandable();

    let ids;
    const key = this.toKey(type);
    switch (type) {
      case 'failed':
      case 'succeeded':
        ids = await this._scanForJobs(key, '0', page.size, new Set());
        break;
      case 'waiting':
      case 'active':
        ids = await client.lrange(key, page.start, page.end);
        break;
      case 'delayed':
        ids = await client.zrange(key, page.start, page.end);
        break;
      default:
        throw new Error('Improper queue type');
    }

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
  }

  createJob(data) {
    return new Job(this, null, data);
  }

  async getJob(jobId) {
    const job = this.jobs.has(jobId)
      ? this.jobs.get(jobId)
      : await Job.fromId(this, jobId);

    if (job && this.settings.storeJobs) {
      this.jobs.set(jobId, job);
    }
    return job;
  }

  async removeJob(jobId) {
    await this._evalScript(
      'removeJob',
      7,
      this.toKey('jobs'),
      this.toKey('waiting'),
      this.toKey('active'),
      this.toKey('succeeded'),
      this.toKey('failed'),
      this.toKey('delayed'),
      this.toKey('stalling'),
      jobId
    );

    if (this.settings.storeJobs) {
      this.jobs.delete(jobId);
    }
    return this;
  }

  async _waitForJob() {
    let jobId;
    try {
      jobId = await this.bclient.brpoplpush(
        this.toKey('waiting'),
        this.toKey('active'),
        0
      );
    } catch (err) {
      if (redis.isAbortError(err) && this.paused) {
        return null;
      }
      throw err;
    }
    // Note that the job may be null in the case that the client has removed
    // the job before processing can take place, but after the brpoplpush has
    // returned the job id.
    return Job.fromId(this, jobId);
  }

  async _getNextJob() {
    // Under normal calling conditions, commandable will not reject because we
    // will have just checked paused in Queue#process.
    await this._commandable(true);
    return this._waitForJob();
  }

  async _runJob(job) {
    let psTimeout = null,
      completed = false;

    const preventStalling = async () => {
      psTimeout = null;
      if (this._isClosed) return;
      await this._preventStall(job.id);
      if (completed || this._isClosed) return;
      const interval = this.settings.stallInterval / 2;
      psTimeout = setTimeout(preventStalling, interval);
    };
    preventStalling();

    let handlerPromise = Promise.resolve(this.handler(job));
    // todo maybe check for this thing being promise-y for helpful error message

    if (job.options.timeout) {
      const message = `Job ${job.id} timed out (${job.options.timeout} ms)`;
      handlerPromise = helpers.withTimeout(
        handlerPromise,
        job.options.timeout,
        message
      );
    }

    const evaluateJob = async (promise) => {
      let successData, failureErr;
      try {
        successData = await promise;
      } catch (err) {
        failureErr = err || new Error('unspecified job error');
      }
      completed = true;
      if (psTimeout) {
        clearTimeout(psTimeout);
        psTimeout = null;
      }
      // The only error that can happen here is either network- or
      // Redis-related, or if Queue#close times out while a job is
      // processing, and the job later finishes.
      // In those cases, throwing to reject is what we want.
      return this._finishJob(failureErr, successData, job);
    };

    // We specifically use the value produced by the async to avoid cases where
    // the process handler returns the same Promise object each invocation.
    const jobPromise = evaluateJob(handlerPromise).finally(() =>
      this.activeJobs.delete(jobPromise)
    );
    this.activeJobs.add(jobPromise);
    return jobPromise;
  }

  _preventStall(jobId) {
    // todo figure out coverage/refactor here
    const promise = this.client.srem(this.toKey('stalling'), jobId);
    /* istanbul ignore next: these errors are only redis or network errors */
    return promise.catch(this._emitErrorAfterTick);
  }

  async _finishJob(err, data, job) {
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
        job.options.retries > 0
          ? this.backoffStrategies.get(strategyName)
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

    await multi.exec();

    return [status, result];
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

    // handler now *must* return a promise - no more callback calling
    this.handler = handler;
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
      this._getNextJob()
        .then((job) => {
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
              this.emit(status, job, result);
            }
          }, this._emitErrorAfterTick);
        })
        .finally(() => setImmediate(jobTick))
        .catch(this._emitErrorAfterTick);
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
    ).then((stalled) => {
      for (const jobId of stalled) {
        this.emit('stalled', jobId);
      }
      return stalled.length;
    });
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
    // TODO: what DO
    // TODO: reintroduce tests
    if (cb) {
      promise.then(
        (value) => process.nextTick(() => cb(null, value)),
        (err) => process.nextTick(() => cb(err))
      );
    }
    //if (cb) helpers.asCallback(promise, cb);
    return interval && !this.checkTimer
      ? promise.finally(() => {
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

  /**
   * Save all the provided jobs, without waiting for each job to be created.
   * This pipelines the requests which avoids the waiting 2N*RTT for N jobs -
   * the client waits to receive each command result before sending the next
   * command. Note that this method does not support a callback parameter - you
   * must use the returned Promise.
   *
   * @param {Iterable<Job>} jobs The jobs to save. Jobs that have no ID will be
   *   assigned one by mutation.
   * @return {Promise<Map<Job, Error>>} The errors that occurred when saving
   *   jobs. Will be empty if no errors occurred. Will reject if there was an
   *   exception executing the batch or readying the connection.
   * @modifies {arguments}
   */
  async saveAll(jobs) {
    const client = await this._commandable();
    const batch = client.pipeline(),
      errors = new Map(),
      defers = [];

    const final = Promise.all(
      jobs.map((job) => {
        const defer = helpers.defer();
        return job
          ._save((evalArgs) => {
            this._evalScriptOn(batch, evalArgs);
            defers.push(defer);
            return defer.promise;
          })
          .catch((err) => {
            // Catch both errors from defer.reject below (from the EVALSHA), and
            // from any serialization failures.
            errors.set(job, err);
          });
      })
    );
    const results = await batch.exec();
    for (const [defer, [error, jobId]] of helpers.zip(defers, results)) {
      if (error) {
        defer.reject(error);
      } else {
        defer.resolve(jobId);
      }
    }
    await final;
    return errors;
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
          this.emit('raised jobs', numRaised);
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
   * Evaluate the named script on the given commandable object, which might be a
   * RedisClient or a Batch or Multi object. This exists to facilitate
   * command pipelining.
   *
   * @modifies {arguments}
   */
  _evalScriptOn(commandable, args) {
    // Precondition: Queue is ready - otherwise lua.shas may not have loaded.
    args[0] = lua.shas[args[0]];
    return commandable.evalsha(args);
  }

  /**
   * Evaluate the named script, return a promise with its results.
   *
   * Same parameter list/syntax as evalsha, except for the name.
   *
   * @param {string} name
   */
  async _evalScript(...args) {
    // Get the sha for the script after we're ready to avoid a race condition
    // with the lua script loader.
    return this._evalScriptOn(await this._commandable(), args);
  }
}

module.exports = Queue;
