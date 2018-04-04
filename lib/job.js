'use strict';

const Emitter = require('events').EventEmitter;

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

  static async fromId(queue, jobId) {
    const client = await queue._commandable();
    const data = await client.hget(queue.toKey('jobs'), jobId);
    if (!data) return null;
    return Job.fromData(queue, jobId, data);
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

  save() {
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

  reportProgress(progress) {
    let promise;
    if (progress != null) {
      this.progress = progress;
      promise = this.queue._commandable().then((client) => {
        const payload = JSON.stringify({
          id: this.id,
          event: 'progress',
          data: progress
        });
        const publishPromise = client.publish(
          this.queue.toKey('events'),
          payload
        );
        return publishPromise;
      });
    } else {
      promise = Promise.reject(new Error('Progress cannot be empty'));
    }

    return promise;
  }

  remove() {
    const promise = this.queue.removeJob(this.id).then(() => this);

    return promise;
  }

  retry() {
    const promise = this.queue._commandable().then((client) => {
      const retryPromise = client.multi()
        .srem(this.queue.toKey('failed'), this.id)
        .lpush(this.queue.toKey('waiting'), this.id)
        .exec();
      return retryPromise;
    });

    return promise;
  }

  isInSet(set) {
    const promise = this.queue._commandable().then((client) => {
      const memberPromise = client.sismember(this.queue.toKey(set), this.id);
      return memberPromise;
    }).then((result) => result === 1);

    return promise;
  }
}

module.exports = Job;
