var events = require('events');
var util = require('util');

var helpers = require('./helpers');
var lua = require('./lua');

function Job(queue, jobId, data, options) {
  this.queue = queue;
  this.id = jobId;
  this.progress = 0;
  this.data = data || {};
  this.options = options || {};
  this.status = 'created';
}

util.inherits(Job, events.EventEmitter);

Job.fromId = function (queue, jobId, cb) {
  queue.client.hget(queue.toKey('jobs'), jobId, function (err, data) {
    /* istanbul ignore if */
    if (err || !data) return cb(new Error('Can not get job info'));
    return cb(null, Job.fromData(queue, jobId, data));
  });
};

Job.fromData = function (queue, jobId, data) {
  // no need for try-catch here since we made the JSON ourselves in job#toData
  data = JSON.parse(data);
  var job = new Job(queue, jobId, data.data, data.options);
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
  cb = cb || helpers.defaultCb;
  var self = this;
  if(self.options.delay){
    var delayVal = new Date().getTime() + self.options.delay*1000;
    this.queue.client.evalsha(lua.shas.addDelayJob, 3,
    this.queue.toKey('id'), this.queue.toKey('jobs'), this.queue.toKey('schedule'),
    this.toData(),
    delayVal, 
    function (err, jobId) {
      /* istanbul ignore if */
      if (err) return cb(err);
      self.id = jobId;
      self.queue.jobs[jobId] = self;
      return cb(null, self);
    }
    );
  }else{
    this.queue.client.evalsha(lua.shas.addJob, 3,
    this.queue.toKey('id'), this.queue.toKey('jobs'), this.queue.toKey('waiting'),
    this.toData(),
    function (err, jobId) {
      /* istanbul ignore if */
      if (err) return cb(err);
      self.id = jobId;
      self.queue.jobs[jobId] = self;
      return cb(null, self);
    }
    );
  }
  return this;
};

Job.prototype.retries = function (n) {
  if (n < 0) {
    throw Error('Retries cannot be negative');
  }
  this.options.retries = n;
  return this;
};

Job.prototype.delay = function (n) {
  if (n <= 0) {
    throw Error('delay cannot be negative');
  }
  this.options.delay = n;
  return this;
};

Job.prototype.timeout = function (ms) {
  if (ms < 0) {
    throw Error('Timeout cannot be negative');
  }
  this.options.timeout = ms;
  return this;
};

Job.prototype.reportProgress = function (progress, cb) {
  // right now we just send the pubsub event
  // might consider also updating the job hash for persistence
  cb = cb || helpers.defaultCb;
  progress = Number(progress);
  if (progress < 0 || progress > 100) {
    return process.nextTick(cb.bind(null, Error('Progress must be between 0 and 100')));
  }
  this.progress = progress;
  this.queue.client.publish(this.queue.toKey('events'), JSON.stringify({
    id: this.id,
    event: 'progress',
    data: progress
  }), cb);
};

Job.prototype.remove = function (cb) {
  cb = cb || helpers.defaultCb;
  this.queue.client.evalsha(lua.shas.removeJob, 6,
    this.queue.toKey('succeeded'), this.queue.toKey('failed'), this.queue.toKey('waiting'),
    this.queue.toKey('active'), this.queue.toKey('stalling'), this.queue.toKey('jobs'),
    this.id,
    cb
  );
};

Job.prototype.retry = function (cb) {
  cb = cb || helpers.defaultCb;
  this.queue.client.multi()
    .srem(this.queue.toKey('failed'), this.id)
    .lpush(this.queue.toKey('waiting'), this.id)
    .exec(cb);
};

Job.prototype.isInSet = function (set, cb) {
  this.queue.client.sismember(this.queue.toKey(set), this.id, function (err, result) {
    /* istanbul ignore if */
    if (err) return cb(err);
    return cb(null, result === 1);
  });
};

module.exports = Job;
