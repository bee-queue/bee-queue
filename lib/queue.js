var redis = require('redis');
var events = require('events');
var util = require('util');

var Job = require('./job');
var defaults = require('./defaults');
var lua = require('./lua');
var helpers = require('./helpers');
var barrier = helpers.barrier;

function Queue(name, settings) {
  if (!(this instanceof Queue)) {
    return new Queue(name, settings);
  }

  this.name = name;
  this.paused = false;
  this.jobs = {};

  settings = settings || {};
  this.settings = {
    options: settings.options || {},
    db: settings.db || 0,
    stallInterval: typeof settings.stallInterval === 'number' ?
      settings.stallInterval :
      defaults.stallInterval,
    removeOnSuccess: settings.removeOnSuccess || defaults.removeOnSuccess,
    keyPrefix: (settings.globalKeyPrefix || defaults.globalKeyPrefix) + ':' + this.name + ':',
    catchExceptions: settings.catchExceptions === true ? true : false,
    isWorker: settings.isWorker === false ? false : true,
    getEvents: settings.getEvents === false ? false : true,
    sendEvents: settings.sendEvents === false ? false : true
  };

  if (settings.socket) {
    this.settings.socket = settings.socket;
    this.connParams = [this.settings.socket, this.settings.options];
  } else {
    this.settings.port = settings.port || 6379;
    this.settings.host = settings.host || '127.0.0.1';
    this.connParams = [this.settings.port, this.settings.host, this.settings.options];
  }

  // Wait for Lua loading and client connection; bclient and eclient/subscribe if needed
  var reportReady = barrier(2 + this.settings.isWorker + this.settings.getEvents * 2,
    this.emit.bind(this, 'ready')
  );

  var makeClient = function (clientName) {
    this[clientName] = redis.createClient.apply(redis, this.connParams);
    this[clientName].on('error', this.emit.bind(this, 'error'));
    this[clientName].select(this.settings.db, reportReady);
  }.bind(this);

  makeClient('client');

  if (this.settings.isWorker) {
    makeClient('bclient');
  }

  if (this.settings.getEvents) {
    makeClient('eclient');
    this.eclient.subscribe(this.toKey('events'));
    this.eclient.on('message', this.onMessage.bind(this));
    this.eclient.on('subscribe', reportReady);
  }

  this.settings.serverKey = settings.socket || settings.host + ':' + settings.port;
  lua.buildCache(this.settings.serverKey, this.client, reportReady);
}

util.inherits(Queue, events.EventEmitter);

Queue.prototype.onMessage = function (channel, message) {
  message = JSON.parse(message);
  if (this.jobs[message.id]) {
    this.jobs[message.id].handleEvent(message);

    if (message.event === 'succeeded' || message.event === 'failed') {
      delete this.jobs[message.id];
    }
  }
};

Queue.prototype.close = function (cb) {
  cb = cb || helpers.defaultCb;
  this.paused = true;

  var closeTimeout = setTimeout(function () {
    return cb(Error('Timed out closing redis connections'));
  }, 5000);

  var clients = [this.client];
  if (this.settings.isWorker) {
    clients.push(this.bclient);
  }

  if (this.settings.getEvents) {
    clients.push(this.eclient);
  }

  var handleEnd = barrier(clients.length, function () {
    clearTimeout(closeTimeout);
    return cb(null);
  });

  clients.forEach(function (client) {
    client.end();
    client.stream.on('close', handleEnd);
  });
};

Queue.prototype.empty = function (cb) {
  return this.client.evalsha(lua.shas.emptyQueue, 2, this.toKey('active'), this.toKey('jobs'), cb);
};

Queue.prototype.createJob = function (data, options) {
  return new Job(this, null, data, options);
};

Queue.prototype.getNextJob = function (cb) {
  var self = this;
  this.bclient.brpoplpush(this.toKey('waiting'), this.toKey('active'), 0, function (err, jobId) {
    if (err) {
      return cb(err);
    }

    return Job.fromId(self, jobId, cb);
  });
};

Queue.prototype.runJob = function (job, cb) {
  var self = this;
  var psTimeout;
  var handled = false;

  var preventStalling = function () {
    self.client.srem(self.toKey('stalling'), job.id, function () {
      if (!handled) {
        psTimeout = setTimeout(preventStalling, self.settings.stallInterval / 2);
      }
    });
  };
  preventStalling();

  var handleOutcome = function (err, data) {
    // silently ignore any multiple calls
    if (handled) {
      return;
    }

    handled = true;
    clearTimeout(psTimeout);

    self.finishJob(err, data, job, cb);
  };

  if (job.options.timeout) {
    var msg = 'Job ' + job.id + ' timed out (' + job.options.timeout + ' ms)';
    setTimeout(handleOutcome.bind(null, Error(msg)), job.options.timeout);
  }

  if (this.settings.catchExceptions) {
    try {
      this.handler(job, handleOutcome);
    } catch (err) {
      handleOutcome(err);
    }
  } else {
    this.handler(job, handleOutcome);
  }
};

Queue.prototype.finishJob = function (err, data, job, cb) {
  var status = err ? 'failed' : 'succeeded';

  var multi = this.client.multi()
    .lrem(this.toKey('active'), 0, job.id)
    .srem(this.toKey('stalling'), job.id);

  var jobEvent = {
    id: job.id,
    event: status,
    data: err ? err.message : data
  };

  if (status === 'failed') {
    if (job.options.retries > 0) {
      job.options.retries -= 1;
      jobEvent.event = 'retrying';
      multi.hset(this.toKey('jobs'), job.id, job.toData())
           .lpush(this.toKey('waiting'), job.id);
    } else {
      multi.sadd(this.toKey('failed'), job.id);
    }
  } else {
    if (this.settings.removeOnSuccess) {
      multi.hdel(this.toKey('jobs'), job.id);
    } else {
      multi.sadd(this.toKey('succeeded'), job.id);
    }
  }

  if (this.settings.sendEvents) {
    multi.publish(this.toKey('events'), JSON.stringify(jobEvent));
  }

  var self = this;
  multi.exec(function (errMulti) {
    if (errMulti) {
      // todo decide how to handle this; right now itll just be ignored in runJob's cb
      return cb(errMulti);
    }
    self.emit(status, job, err ? err : data);
    return cb(err);
  });
};

Queue.prototype.process = function (maxRunning, handler) {
  if (!this.settings.isWorker) {
    throw Error('Cannot call Queue.prototype.process on a non-worker');
  }

  if (this.handler) {
    throw Error('Cannot call Queue.prototype.process twice');
  }

  if (typeof maxRunning === 'function') {
    handler = maxRunning;
    maxRunning = 1;
  }

  var self = this;
  this.handler = handler;
  this.running = 0;
  this.queued = 1;
  this.maxRunning = maxRunning || 1;

  var jobTick = function () {
    if (self.paused) {
      return;
    }

    // invariant: in this code path, self.running < self.maxRunning, always
    // after spoolup, self.running + self.queued === self.maxRunning
    self.getNextJob(function (err, job) {
      if (err) {
        // todo decide how to handle this case
        console.log('getNextJob failed: ', err);
        return setImmediate(jobTick);
      }

      self.running += 1;
      self.queued -= 1;
      if (self.running + self.queued < self.maxRunning) {
        self.queued += 1;
        setImmediate(jobTick);
      }

      self.runJob(job, function () {
        self.running -= 1;
        self.queued += 1;
        setImmediate(jobTick);
      });
    });
  };

  var restartProcessing = function () {
    self.bclient.once('ready', jobTick);
  };
  this.bclient.on('error', restartProcessing);
  this.bclient.on('end', restartProcessing);

  this.checkStalledJobs(setImmediate.bind(null, jobTick));
};

Queue.prototype.checkStalledJobs = function (cb) {
  cb = cb || helpers.defaultCb;
  this.client.evalsha(lua.shas.checkStalledJobs, 4,
    this.toKey('stallTime'),
    this.toKey('stalling'),
    this.toKey('waiting'),
    this.toKey('active'),
    Date.now(),
    this.settings.stallInterval,
    cb
  );
};

Queue.prototype.toKey = function (str) {
  return this.settings.keyPrefix + str;
};

module.exports = Queue;
