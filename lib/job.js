var lua = require('./lua');

function Job(queue, jobId, data, options) {
  this.queue = queue;
  this.jobId = jobId;
  this.data = data || {};
  this.options = options || {};
}

Job.fromId = function (queue, jobId, cb) {
  queue.client.hget(queue.toKey('jobs'), jobId, function (err, data) {
    if (err) {
      return cb(err);
    }
    // no need for try-catch here since we made the JSON ourselves in job#toData
    data = JSON.parse(data);
    return cb(null, new Job(queue, jobId, data.data, data.options));
  });
};

Job.prototype.toData = function () {
  return JSON.stringify({
    data: this.data,
    options: this.options
  });
};

Job.prototype.remove = function (cb) {
  this.queue.client.evalsha(lua.shas.removeJob, 6,
    this.queue.toKey('succeeded'),
    this.queue.toKey('failed'),
    this.queue.toKey('wait'),
    this.queue.toKey('active'),
    this.queue.toKey('stalling'),
    this.queue.toKey('jobs'),
    this.jobId,
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
