'use strict';

const Emitter = require('events').EventEmitter;

const helpers = require('./helpers');
const strategies = require('./backoff');

class Job extends Emitter {
  constructor(queue, jobId, data, options) {
    super();

    this.queue = queue;
    this.id = jobId;
    this.progress = 0;
    this.data = data || {};
    this.options = options || {};
    this.options.timestamp = this.options.timestamp || Date.now();
    this.options.stacktraces = this.options.stacktraces || [];
    this.status = 'created';
  }

  static fromId(queue, jobId, cb) {
    const promise = queue._commandable().then((client) => {
      const jobPromise = helpers.deferred();
      client.hget(queue.toKey('jobs'), jobId, jobPromise.defer());
      return jobPromise;
    }).then((data) => data ? Job.fromData(queue, jobId, data) : null);

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  static fromData(queue, jobId, data) {
    // no need for try-catch here since we made the JSON ourselves in Job#toData
    data = JSON.parse(data);
    const job = new Job(queue, jobId, data.data, data.options);
    job.status = data.status;
    return job;
  }

  toData() {
    return JSON.stringify({
      data: this.data,
      options: this.options,
      status: this.status
    });
  }

  save(cb) {
    const toKey = this.queue.toKey.bind(this.queue);

    let promise;
    if (this.options.delay) {
      promise = this.queue._evalScript('addDelayedJob', 4,
        toKey('id'), toKey('jobs'), toKey('delayed'), toKey('earlierDelayed'),
        this.id || '', this.toData(), this.options.delay);

      if (this.queue.settings.activateDelayedJobs) {
        promise = promise.then((jobId) => {
          // Only reschedule if the job was actually created.
          if (jobId) {
            this.queue._delayedTimer.schedule(this.options.delay);
          }
          return jobId;
        });
      }
    } else {
      promise = this.queue._evalScript('addJob', 3,
        toKey('id'), toKey('jobs'), toKey('waiting'),
        this.id || '', this.toData());
    }

    promise = promise.then((jobId) => {
      this.id = jobId;
      // If the jobId is not null, then store the job in the job map.
      if (jobId && this.queue.settings.storeJobs) {
        this.queue.jobs.set(jobId, this);
      }
      return this;
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  setId(id) {
    this.id = id;
    return this;
  }

  retries(n) {
    if (n < 0) {
      throw new Error('Retries cannot be negative');
    }
    this.options.retries = n;
    return this;
  }

  delayUntil(timestamp) {
    // Get the timestamp from Date objects.
    if (timestamp && typeof timestamp.getTime === 'function') {
      timestamp = timestamp.getTime();
    } else {
      timestamp = parseInt(timestamp, 10);
    }
    if (isNaN(timestamp) || timestamp < 0) {
      throw new Error('invalid delay timestamp');
    }
    if (timestamp > Date.now()) {
      this.options.delay = timestamp;
    }
    return this;
  }

  timeout(ms) {
    if (ms < 0) {
      throw new Error('Timeout cannot be negative');
    }
    this.options.timeout = ms;
    return this;
  }

  backoff(strategy, delay) {
    if (!strategies.has(strategy)) {
      throw new Error('unknown strategy');
    }
    if (!Number.isSafeInteger(delay) || delay <= 0) {
      throw new Error('delay must be a positive integer');
    }
    this.options.backoff = {
      strategy,
      delay
    };
    return this;
  }

  reportProgress(progress, cb) {
    // right now we just send the pubsub event
    // might consider also updating the job hash for persistence
    progress = parseInt(progress, 10);

    let promise;
    if (progress >= 0 && progress <= 100) {
      this.progress = progress;
      promise = this.queue._commandable().then((client) => {
        const publishPromise = helpers.deferred();
        const payload = JSON.stringify({
          id: this.id,
          event: 'progress',
          data: progress
        });
        client.publish(this.queue.toKey('events'), payload,
          publishPromise.defer());
        return publishPromise;
      });
    } else {
      promise = Promise.reject(new Error('Progress must be between 0 and 100'));
    }

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  remove(cb) {
    const promise = this.queue.removeJob(this.id).then(() => this);
    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  retry(cb) {
    const promise = this.queue._commandable().then((client) => {
      const retryPromise = helpers.deferred();
      client.multi()
        .srem(this.queue.toKey('failed'), this.id)
        .lpush(this.queue.toKey('waiting'), this.id)
        .exec(retryPromise.defer());
      return retryPromise;
    });

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }

  isInSet(set, cb) {
    const promise = this.queue._commandable().then((client) => {
      const memberPromise = helpers.deferred();
      client.sismember(this.queue.toKey(set), this.id, memberPromise.defer());
      return memberPromise;
    }).then((result) => result === 1);

    if (cb) helpers.asCallback(promise, cb);
    return promise;
  }
}

module.exports = Job;
