'use strict';

const Emitter = require('events').EventEmitter;
const util = require('util');

const helpers = require('./helpers');
const strategies = require('./backoff');

function Job(queue, jobId, data, options) {
  Emitter.call(this);

  this.queue = queue;
  this.id = jobId;
  this.progress = 0;
  this.data = data || {};
  this.options = options || {};
  this.options.timestamp = this.options.timestamp || Date.now();
  this.options.stacktraces = this.options.stacktraces || [];
  this.status = 'created';
}

util.inherits(Job, Emitter);

Job.fromId = function (queue, jobId, cb) {
  const promise = queue._commandable().then((client) => {
    const jobPromise = helpers.deferred();
    client.hget(queue.toKey('jobs'), jobId, jobPromise.defer());
    return jobPromise;
  }).then((data) => data ? Job.fromData(queue, jobId, data) : null);

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Job.fromData = function (queue, jobId, data) {
  // no need for try-catch here since we made the JSON ourselves in Job#toData
  data = JSON.parse(data);
  const job = new Job(queue, jobId, data.data, data.options);
  job.status = data.status;
  return job;
};

Job.prototype.toData = function () {
  return JSON.stringify({
    data: this.data,
    options: this.options,
    status: this.status
  });
};

Job.prototype.save = function (cb) {
  const toKey = this.queue.toKey.bind(this.queue);

  let promise;
  if (this.options.delay) {
    promise = this.queue._evalScript('addDelayedJob', 4,
      toKey('id'), toKey('jobs'), toKey('delayed'), toKey('earlierDelayed'),
      this.id || '', this.toData(), this.options.delay);

    if (this.queue.settings.processDelayed) {
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
};

Job.prototype.setId = function (id) {
  this.id = id;
  return this;
};

Job.prototype.retries = function (n) {
  if (n < 0) {
    throw new Error('Retries cannot be negative');
  }
  this.options.retries = n;
  return this;
};

Job.prototype.delayUntil = function (timestamp) {
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
};

Job.prototype.timeout = function (ms) {
  if (ms < 0) {
    throw new Error('Timeout cannot be negative');
  }
  this.options.timeout = ms;
  return this;
};

Job.prototype.backoff = function (strategy, delay) {
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
};

Job.prototype.reportProgress = function (progress, cb) {
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
      client.publish(this.queue.toKey('events'), payload, publishPromise.defer());
      return publishPromise;
    });
  } else {
    promise = Promise.reject(new Error('Progress must be between 0 and 100'));
  }

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Job.prototype.remove = function (cb) {
  const promise = this.queue.removeJob(this.id).then(() => this);
  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

Job.prototype.retry = function (cb) {
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
};

Job.prototype.isInSet = function (set, cb) {
  const promise = this.queue._commandable().then((client) => {
    const memberPromise = helpers.deferred();
    client.sismember(this.queue.toKey(set), this.id, memberPromise.defer());
    return memberPromise;
  }).then((result) => result === 1);

  if (cb) helpers.asCallback(promise, cb);
  return promise;
};

module.exports = Job;
