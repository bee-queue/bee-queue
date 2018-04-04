'use strict';

const Emitter = require('events').EventEmitter;

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
      status: this.status,
    });
  }

  // For Queue#saveAll, this method is guaranteed to invoke evalScript
  // synchronously.
  async _save(evalScript) {
    const toKey = (str) => this.queue.toKey(str);

    let jobId;
    if (this.options.delay) {
      jobId = await evalScript([
        'addDelayedJob',
        4,
        toKey('id'),
        toKey('jobs'),
        toKey('delayed'),
        toKey('earlierDelayed'),
        this.id || '',
        this.toData(),
        this.options.delay,
      ]);

      if (this.queue.settings.activateDelayedJobs) {
        if (jobId) this.queue._delayedTimer.schedule(this.options.delay);
      }
    } else {
      jobId = await evalScript([
        'addJob',
        3,
        toKey('id'),
        toKey('jobs'),
        toKey('waiting'),
        this.id || '',
        this.toData(),
      ]);
    }

    this.id = jobId;
    // If the jobId is not null, then store the job in the job map.
    if (jobId && this.queue.settings.storeJobs) {
      this.queue.jobs.set(jobId, this);
    }
    return this;
  }

  save() {
    const promise = this._save((args) => this.queue._evalScript(...args));

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
    if (!this.queue.backoffStrategies.has(strategy)) {
      throw new Error('unknown strategy');
    }

    const isInvalidDelay = !Number.isSafeInteger(delay) || delay <= 0;
    if (strategy !== 'immediate' && isInvalidDelay) {
      throw new Error('delay must be a positive integer');
    }
    this.options.backoff = {
      strategy,
      delay,
    };
    return this;
  }

  async reportProgress(progress) {
    if (progress == null) {
      throw new Error('Progress cannot be empty');
    }
    this.progress = progress;
    const client = await this.queue._commandable();
    const payload = JSON.stringify({
      id: this.id,
      event: 'progress',
      data: progress,
    });
    return client.publish(this.queue.toKey('events'), payload);
  }

  async remove() {
    await this.queue.removeJob(this.id);
    return this;
  }

  async retry() {
    const client = await this.queue._commandable();
    return client
      .multi()
      .srem(this.queue.toKey('failed'), this.id)
      .lpush(this.queue.toKey('waiting'), this.id)
      .exec();
  }

  async isInSet(set) {
    const client = await this.queue._commandable();
    const result = await client.sismember(this.queue.toKey(set), this.id);
    return result === 1;
  }
}

module.exports = Job;
