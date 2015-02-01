var helpers = require('./helpers');
var lua = require('./lua');

function Job(queue, jobId, data, options) {
  this.queue = queue;
  this.id = jobId;
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

Job.prototype.save = function (cb) {
  cb = cb || helpers.defaultCb;
  var self = this;
  this.queue.client.evalsha(lua.shas.addJob, 3,
    this.queue.toKey('id'),
    this.queue.toKey('jobs'),
    this.queue.toKey('waiting'),
    this.toData(),
    function (err, jobId) {
      if (err) {
        return cb(err);
      }
      self.id = jobId;
      return cb(null, self);
    }
  );
};

Job.prototype.retries = function (n) {
  if (n < 0) {
    throw Error('Retries cannot be negative');
  }
  this.options.retries = n;
  return this;
};

Job.prototype.timeout = function (ms) {
  if (ms < 0) {
    throw Error('Timeout cannot be negative');
  }
  this.options.timeout = ms;
  return this;
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
    this.queue.toKey('waiting'),
    this.queue.toKey('active'),
    this.queue.toKey('stalling'),
    this.queue.toKey('jobs'),
    this.id,
    cb
  );
};

Job.prototype.retry = function (cb) {
  this.queue.client.multi()
    .srem(this.queue.toKey('failed'), this.id)
    .lpush(this.queue.toKey('waiting'), this.id)
    .exec(cb);
};

Job.prototype.moveToSet = function (set, cb) {
  var multi = this.queue.client.multi()
    .lrem(this.queue.toKey('active'), 0, this.id)
    .srem(this.queue.toKey('stalling'), this.id);
  if (this.options.retries > 0 && set === 'failed') {
    this.options.retries -= 1;
    multi.hset(this.queue.toKey('jobs'), this.id, this.toData())
      .lpush(this.queue.toKey('waiting'), this.id)
      .exec(cb);
  } else if (this.queue.settings.removeOnSuccess && set === 'succeeded') {
      multi.hdel(this.queue.toKey('jobs'), this.id)
        .exec(cb);
  } else {
    multi.sadd(this.queue.toKey(set), this.id)
      .exec(cb);
  }
};

Job.prototype.isInSet = function (set, cb) {
  this.queue.client.sismember(this.queue.toKey(set), this.id, function (err, result) {
    if (err) {
      return cb(err);
    }
    return cb(null, result === 1);
  });
};

module.exports = Job;
