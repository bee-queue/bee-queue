var redis = require('redis');

var events = require('events');
var util = require('util');
var crypto = require('crypto');

var barrier = require('./helpers').barrier;
var defaults = require('./defaults');
var lua = require('./lua');
var Job = require('./job');

function Queue(name, settings) {
  if (!(this instanceof Queue)) {
    return new Queue(name, settings);
  }

  settings = settings || {};
  this.settings = {
    options: settings.options || {},
    db: settings.db || 0,
    stallInterval: typeof settings.stallInterval === 'number' ?
      settings.stallInterval :
      defaults.stallInterval,
    isWorker: settings.isWorker === false ? false : true,
    globalKeyPrefix: settings.globalKeyPrefix || defaults.globalKeyPrefix,
    keyPrefix: this.globalKeyPrefix + ':' + this.name + ':',
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

  this.name = name;
  this.paused = false;
  this.token = crypto.pseudoRandomBytes(16).toString('hex');

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
    this.toKey('wait'),
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
  this.bclient.brpoplpush(this.toKey('wait'), this.toKey('active'), 0, function (err, jobId) {
    if (err) {
      return cb(err);
    }

    return Job.fromId(self, jobId, cb);
  });
};

Queue.prototype.runJob = function (job, cb) {
  var self = this;
  var psTimeout;
  var psCounter = 2;
  var handled = false;

  var preventStalling = function () {
    self.client.srem(self.toKey('stalling'), job.jobId, function () {
      // psCounter: 2 means job is processing, 1 means job just finished
      // needed to make sure job is removed from stalling set after its completion
      if (psCounter > 0) {
        psTimeout = setTimeout(preventStalling, self.settings.stallInterval / 2);
        psCounter -= 1;
      }
    });
  };
  preventStalling();

  var handleOutcome = function (err, data) {
    if (handled) {
      return;
    }

    handled = true;
    psCounter -= 1;

    if (err) {
      job.moveToSet('failed', function (errMove) {
        clearTimeout(psTimeout);
        if (errMove) {
          return cb(errMove);
        }
        self.emit('failed', job, err);
        return cb(err);
      });
    } else {
      job.moveToSet('succeeded', function (errMove) {
        clearTimeout(psTimeout);
        if (errMove) {
          return cb(errMove);
        }
        self.emit('succeeded', job, data);
        return cb();
      });
    }
  };

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
    this.toKey('wait'),
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
