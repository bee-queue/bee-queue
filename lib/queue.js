var redis = require('redis');

var events = require('events');
var util = require('util');

var barrier = require('./helpers').barrier;
var defaults = require('./defaults');
var lua = require('./lua');
var Job = require('./job');

function Queue(name, settings) {
  if (!(this instanceof Queue)) {
    return new Queue(name, settings);
  }

  this.name = name;
  this.paused = false;

  settings = settings || {};
  this.settings = {
    options: settings.options || {},
    db: settings.db || 0,
    stallInterval: typeof settings.stallInterval === 'number' ?
      settings.stallInterval :
      defaults.stallInterval,
    isWorker: settings.isWorker === false ? false : true,
    removeOnSuccess: settings.removeOnSuccess || defaults.removeOnSuccess,
    globalKeyPrefix: settings.globalKeyPrefix || defaults.globalKeyPrefix,
    keyPrefix: (settings.globalKeyPrefix || defaults.globalKeyPrefix) + ':' + this.name + ':',
    catchExceptions: settings.catchExceptions === true ? true : false
  };

  if (settings.socket) {
    this.settings.socket = settings.socket;
    this.connParams = [this.settings.socket, this.settings.options];
  } else {
    this.settings.port = settings.port || 6379;
    this.settings.host = settings.host || '127.0.0.1';
    this.connParams = [this.settings.port, this.settings.host, this.settings.options];
  }

  var reportReady = barrier(2 + this.settings.isWorker * 1, this.emit.bind(this, 'ready'));

  this.client = redis.createClient.apply(redis, this.connParams);
  this.client.on('error', this.emit.bind(this, 'error'));
  this.client.select(this.settings.db, reportReady);

  if (this.settings.isWorker) {
    this.bclient = redis.createClient.apply(redis, this.connParams);
    this.bclient.on('error', this.emit.bind(this, 'error'));
    this.bclient.select(this.settings.db, reportReady);
  }

  this.settings.serverKey = settings.socket || settings.host + ':' + settings.port;
  lua.buildCache(this.settings.serverKey, this.client, reportReady);
}

util.inherits(Queue, events.EventEmitter);

Queue.prototype.close = function (cb) {
  this.paused = true;

  var closeTimeout = setTimeout(function () {
    return cb(Error('Timed out closing redis connections'));
  }, 5000);

  var clients = this.settings.isWorker ? [this.client, this.bclient] : [this.client];
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
  // todo clean up key passing here
  return this.client.evalsha(lua.shas.emptyQueue, 1, 'keyprefix', this.toKey(''), cb);
};

Queue.prototype.add = function (data, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  }

  var job = new Job(this, null, data, options);

  this.client.evalsha(lua.shas.addJob, 3,
    this.toKey('id'),
    this.toKey('jobs'),
    this.toKey('waiting'),
    job.toData(), function (err, jobId) {
    if (cb) {
      if (err) {
        return cb(err);
      }
      job.jobId = jobId;
      return cb(null, job);
    }
  });
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
    self.client.srem(self.toKey('stalling'), job.jobId, function () {
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

    var status = err ? 'failed' : 'succeeded';
    job.moveToSet(status, function (errMove) {
      if (errMove) {
        return cb(errMove);
      }
      self.emit(status, job, err ? err : data);
      return cb(err);
    });
  };

  if (job.options.timeout) {
    var msg = 'Job ' + job.jobId + ' timed out (' + job.options.timeout + ' ms)';
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
      // todo decide how best to handle these two error cases
      if (err) {
        console.log('getNextJob failed: ', err);
        return setImmediate(jobTick);
      }

      self.running += 1;
      self.queued -= 1;
      if (self.running + self.queued < self.maxRunning) {
        self.queued += 1;
        setImmediate(jobTick);
      }

      self.runJob(job, function (errRun) {
        if (errRun) {
          console.log('runJob failed: ', errRun);
        }
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
