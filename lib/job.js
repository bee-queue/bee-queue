var lua = require('./lua');

function Job(queue, jobId, data) {
  this.queue = queue;
  this.jobId = jobId;
  this.data = data || {};
  this.lockKey = this.queue.toKey(this.jobId) + ':lock';
}

Job.fromId = function (queue, jobId, cb) {
  queue.client.get(queue.toKey(jobId), function (err, data) {
    if (err) {
      return cb(err);
    }

    try {
      data = JSON.parse(data);
    } catch (e) {
      return cb(e);
    }

    return cb(null, new Job(queue, jobId, data));
  });
};

var handleLock = function (cb) {
  return function (err, result) {
    if (err) {
      return cb(err);
    }
    return cb(null, result === 'OK');
  }
};

Job.prototype.acquireLock = function (cb) {
  this.queue.client.set(this.lockKey, this.queue.token, 'PX', this.queue.lockTimeout, 'NX', handleLock(cb));
};

Job.prototype.renewLock = function (cb) {
  this.queue.client.set(this.lockKey, this.queue.token, 'PX', this.queue.lockTimeout, handleLock(cb));
};

Job.prototype.releaseLock = function (cb) {
  this.queue.client.evalsha(lua.shas.releaseLock, 1, this.lockKey, this.queue.token, function (err, result) {
    if (err) {
      return cb(err);
    }
    return cb(null, result === 1);
  });
};

Job.prototype.remove = function (cb) {
  this.queue.client.evalsha(lua.shas.removeJob, 1,
    this.jobId,
    this.queue.toKey(''),
    cb
  );
};

Job.prototype.retry = function (cb) {
  this.queue.client.multi()
    .srem(this.queue.toKey('failed'), this.jobId)
    .lpush(this.queue.toKey('wait'), this.jobId)
    .exec(cb);
};

Job.prototype.moveToSet = function (set, cb) {
  this.queue.client.multi()
    .lrem(this.queue.toKey('active'), 0, this.jobId)
    .sadd(this.queue.toKey(set), this.jobId)
    .exec(cb);
};

Job.prototype.isInSet = function (set, cb) {
  this.queue.client.sismember(this.queue.toKey(set), this.jobId, function (err, result) {
    if (err) {
      return cb(err);
    }
    return cb(null, result === 1);
  });
};

module.exports = Job;
