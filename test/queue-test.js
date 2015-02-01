/*eslint-disable no-shadow, handle-callback-err */

var Queue = require('../lib/queue');
var barrier = require('../lib/helpers').barrier;

var sinon = require('sinon');
var chai = require('chai');
var assert = chai.assert;

describe('Queue', function () {
  var pqueue = Queue('test');
  var queue;

  var clearKeys = function (done) {
    var reportDone = barrier(2, done);
    if (queue) {
      queue.close(reportDone);
      queue = undefined;
    } else {
      reportDone();
    }

    pqueue.client.keys(pqueue.toKey('*'), function (err, keys) {
      if (keys.length) {
        pqueue.client.del(keys, reportDone);
      } else {
        reportDone();
      }
    });
  };

  before(clearKeys);
  afterEach(clearKeys);

  describe('.close', function () {
    it('should call end on the clients', function (done) {
      queue = Queue('test');
      var clientSpy = sinon.spy(queue.client, 'end');
      var bclientSpy = sinon.spy(queue.bclient, 'end');

      queue.close(function (err) {
        assert.isNull(err);
        assert.isTrue(clientSpy.calledOnce);
        assert.isTrue(bclientSpy.calledOnce);
        queue = undefined;
        done();
      });
    });
  });

  describe('Constructor', function () {
    it('creates a queue with default redis settings', function (done) {
      queue = Queue('test');
      queue.once('ready', function () {
        assert.strictEqual(queue.client.connectionOption.host, '127.0.0.1');
        assert.strictEqual(queue.bclient.connectionOption.host, '127.0.0.1');
        assert.strictEqual(queue.client.connectionOption.port, 6379);
        assert.strictEqual(queue.bclient.connectionOption.port, 6379);
        assert.strictEqual(queue.client.selected_db, 0);
        assert.strictEqual(queue.bclient.selected_db, 0);
        done();
      });
    });

    it('creates a queue with passed redis settings', function (done) {
      queue = Queue('test', {
        host: 'localhost',
        db: 1
      });

      queue.once('ready', function () {
        assert.strictEqual(queue.client.connectionOption.host, 'localhost');
        assert.strictEqual(queue.bclient.connectionOption.host, 'localhost');
        assert.strictEqual(queue.client.connectionOption.port, 6379);
        assert.strictEqual(queue.bclient.connectionOption.port, 6379);
        assert.strictEqual(queue.client.selected_db, 1);
        assert.strictEqual(queue.bclient.selected_db, 1);
        done();
      });
    });
  });

  it('should recover from a connection loss', function (done) {
    queue = Queue('test');
    queue.on('error', function () {
      // Prevent errors from bubbling up into exceptions
    });

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      jobDone();
      done();
    });

    queue.bclient.stream.end();
    queue.bclient.emit('error', new Error('ECONNRESET'));

    queue.add({'foo': 'bar'});
  });


  it('should reconnect when the blocking client triggers an "end" event', function (done) {
    queue = Queue('test');

    var jobSpy = sinon.spy(queue, 'getNextJob');
    queue.process(function (job, jobDone) {
      // First getNextJob fails on the disconnect, second should succeed
      assert.strictEqual(jobSpy.callCount, 2);
      jobDone();
      done();
    });

    // Not called at all yet because queue.process uses setImmediate
    assert.strictEqual(jobSpy.callCount, 0);

    queue.add({'foo': 'bar'}, function () {});
    queue.bclient.emit('end');
  });

  it('adds a job with correct prefix', function (done) {
    queue = Queue('test');

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      queue.client.hget('bq:test:jobs', job.id, function (getErr, jobData) {
        assert.isNull(getErr);
        assert.strictEqual(jobData, job.toData());
        done();
      });
    });
  });

  it('processes a job', function (done) {
    queue = Queue('test');

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      jobDone(null, 'baz');
    });

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
    });

    queue.on('succeeded', function (job, data) {
      assert.ok(job);
      assert.strictEqual(data, 'baz');
      done();
    });
  });

  it('processes a job with removeOnSuccess', function (done) {
    queue = Queue('test', {
      removeOnSuccess: true
    });

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      jobDone(null);
    });

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
    });

    queue.on('succeeded', function (job) {
      queue.client.hget(queue.toKey('jobs'), job.id, function (err, jobData) {
        assert.isNull(err);
        assert.isNull(jobData);
        done();
      });
    });
  });

  it('processes many jobs in a row with one processor', function (done) {
    queue = Queue('test');
    var counter = 0;
    var numJobs = 20;

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.count, counter);
      counter++;
      jobDone();
      if (counter === numJobs) {
        done();
      }
    });

    for (var i = 0; i < numJobs; i++) {
      queue.add({count: i});
    }
  });

  it('processes many jobs with one concurrent processor', function (done) {
    queue = Queue('test');
    var counter = 0;
    var concurrency = 5;
    var numJobs = 20;

    queue.process(concurrency, function (job, jobDone) {
      assert.isTrue(queue.running <= concurrency);
      setTimeout(function () {
        jobDone();
        assert.strictEqual(job.data.count, counter);
        counter++;
        if (counter === numJobs) {
          done();
        }
      }, 10);
    });

    for (var i = 0; i < numJobs; i++) {
      queue.add({count: i});
    }
  });

  it('processes many randomly delayed jobs with one concurrent processor', function (done) {
    queue = Queue('test');
    var counter = 0;
    var concurrency = 5;
    var numJobs = 20;

    queue.process(concurrency, function (job, jobDone) {
      assert.isTrue(queue.running <= concurrency);
      setTimeout(function () {
        jobDone();
        counter++;
        if (counter === numJobs) {
          done();
        }
      }, 10);
    });

    for (var i = 0; i < numJobs; i++) {
      setTimeout(queue.add.bind(queue, {count: i}), Math.random() * 50);
    }
  });

  it('processes many jobs with multiple processors', function (done) {
    queue = Queue('test');
    var processors = [
      Queue('test'),
      Queue('test'),
      Queue('test')
    ];
    var counter = 0;
    var numJobs = 20;
    var processed = [];

    var handleJob = function (job, jobDone) {
      counter++;
      processed[job.data.count] = true;
      jobDone();

      if (counter === numJobs) {
        for (var i = 0; i < numJobs; i++) {
          assert.isTrue(processed[i]);
        }
        var reportClosed = barrier(3, done);
        processors.forEach(function (queue) {
          queue.close(reportClosed);
        });
      }
    };

    processors.forEach(function (queue) {
      queue.process(handleJob);
    });

    for (var i = 0; i < numJobs; i++) {
      queue.add({count: i});
    }
  });

  it('processes a job that fails', function (done) {
    queue = Queue('test');

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      jobDone(Error('failed!'));
    });

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
    });

    queue.on('failed', function (job, err) {
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(err.message, 'failed!');
      done();
    });
  });

  it('processes a job that throws an exception', function (done) {
    queue = Queue('test', {
      catchExceptions: true
    });

    queue.process(function (job) {
      assert.strictEqual(job.data.foo, 'bar');
      throw Error('exception!');
    });

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
    });

    queue.on('failed', function (job, err) {
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(err.message, 'exception!');
      done();
    });
  });

  it('processes a job that times out', function (done) {
    queue = Queue('test');

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      setTimeout(jobDone, 20);
    });

    queue.add({foo: 'bar'}, {timeout: 10}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(job.options.timeout, 10);
    });

    queue.on('failed', function (job, err) {
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(err.message, 'Job 1 timed out (10 ms)');
      done();
    });
  });

  it('processes a job that auto-retries', function (done) {
    queue = Queue('test');
    var failCount = 0;
    var retries = 1;
    var failMsg = 'failing to auto-retry...';

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      if (job.options.retries === 0) {
        assert.strictEqual(failCount, retries);
        jobDone();
        done();
      } else {
        jobDone(Error(failMsg));
      }
    });

    queue.add({foo: 'bar'}, {retries: retries}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(job.options.retries, retries);
    });

    queue.on('failed', function (job, err) {
      failCount += 1;
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(err.message, failMsg);
    });
  });


  it('processes a job that times out and retries', function (done) {
    queue = Queue('test');
    var failCount = 0;
    var retries = 1;

    queue.process(function (job, jobDone) {
      assert.strictEqual(job.data.foo, 'bar');
      if (job.options.retries === 0) {
        assert.strictEqual(failCount, retries);
        jobDone();
        done();
      } else {
        setTimeout(jobDone, 20);
      }
    });

    queue.add({foo: 'bar'}, {timeout: 10, retries: retries}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(job.options.retries, retries);
    });

    queue.on('failed', function (job) {
      failCount += 1;
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
    });
  });

  it('resets and processes stalled jobs when starting a queue', function (done) {
    var deadQueue = Queue('test', {
      stallInterval: 0
    });

    var processJobs = function () {
      queue = Queue('test', {
        stallInterval: 0
      });
      var jobCount = 0;
      queue.checkStalledJobs(function () {
        queue.process(function (job, jobDone) {
          assert.strictEqual(job.data.foo, 'bar' + (++jobCount));
          jobDone();
          if (jobCount === 3) {
            done();
          }
        });
      });
    };

    var processAndClose = function () {
      deadQueue.process(function () {
        deadQueue.close(processJobs);
      });
    };

    var reportAdded = barrier(3, processAndClose);

    deadQueue.add({foo: 'bar1'}, reportAdded);
    deadQueue.add({foo: 'bar2'}, reportAdded);
    deadQueue.add({foo: 'bar3'}, reportAdded);
  });

  it('resets and processes jobs from multiple stalled queues', function (done) {
    var processJobs = function () {
      queue = Queue('test', {
        stallInterval: 0
      });
      var reportDone = barrier(5, done);
      queue.checkStalledJobs(function () {
        queue.process(function (job, jobDone) {
          assert.strictEqual(job.data.foo, 'bar');
          jobDone();
          reportDone();
        });
      });
    };

    var reportClosed = barrier(5, processJobs);

    var createAndStall = function () {
      var queue = Queue('test', {
        stallInterval: 0
      });
      queue.add({foo: 'bar'}, function () {
        queue.process(function () {
          queue.close(reportClosed);
        });
      });
    };

    for (var i = 0; i < 5; i++) {
      createAndStall();
    }
  });

  it('resets and processes stalled jobs from concurrent processor', function (done) {
    var deadQueue = Queue('test', {
      stallInterval: 0
    });
    var counter = 0;
    var concurrency = 5;
    var numJobs = 10;

    var processJobs = function () {
      queue = Queue('test', {
        stallInterval: 0
      });
      queue.checkStalledJobs(function () {
        queue.process(function (job, jobDone) {
          counter += 1;
          jobDone();
          if (counter === numJobs) {
            done();
          }
        });
      });
    };

    var processAndClose = function () {
      deadQueue.process(concurrency, function () {
        // wait for it to get all spooled up...
        if (deadQueue.running === concurrency) {
          deadQueue.close(processJobs);
        }
      });
    };

    var reportAdded = barrier(numJobs, processAndClose);

    for (var i = 0; i < numJobs; i++) {
      deadQueue.add({count: i}, reportAdded);
    }
  });

  it('processes pre-existing jobs when starting a queue', function (done) {
    var deadQueue = Queue('test');

    var processJobs = function () {
      queue = Queue('test');
      var jobCount = 0;
      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar' + (++jobCount));
        jobDone();
        if (jobCount === 3) {
          done();
        }
      });
    };

    var reportAdded = barrier(3, deadQueue.close.bind(deadQueue, processJobs));

    deadQueue.add({foo: 'bar1'}, reportAdded);
    deadQueue.add({foo: 'bar2'}, reportAdded);
    deadQueue.add({foo: 'bar3'}, reportAdded);
  });

  it('does not process an in-progress job when a new queue starts', function (done) {
    queue = Queue('test');
    queue.add({foo: 'bar'}, function () {
      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        setTimeout(jobDone, 30);
      });

      var queue2 = Queue('test');
      setTimeout(function () {
        queue2.process(function () {
          assert.fail('queue2 should not process a job');
        });
        queue.on('succeeded', queue2.close.bind(queue2, done));
      }, 10);
    });
  });

  it('retries a job that fails', function (done) {
    queue = Queue('test');
    var callCount = 0;

    queue.process(function (job, jobDone) {
      callCount++;
      assert.strictEqual(job.data.foo, 'bar');
      if (callCount > 1) {
        return jobDone();
      } else {
        return jobDone(Error('failed!'));
      }
    });

    queue.on('failed', function (job, err) {
      assert.ok(job);
      assert.strictEqual(job.data.foo, 'bar');
      assert.strictEqual(err.message, 'failed!');
      job.retry();
    });

    queue.on('succeeded', function () {
      assert.strictEqual(callCount, 2);
      done();
    });

    queue.add({foo: 'bar'}, function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      assert.strictEqual(job.data.foo, 'bar');
    });
  });

});
