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

  describe('Connection', function () {
    describe('Close', function () {
      it('should call end on the clients', function (done) {
        queue = Queue('test');
        var clientSpy = sinon.spy(queue.client, 'end');
        var bclientSpy = sinon.spy(queue.bclient, 'end');
        var eclientSpy = sinon.spy(queue.eclient, 'end');

        queue.on('ready', function () {
          queue.close(function (err) {
            assert.isNull(err);
            assert.isTrue(clientSpy.calledOnce);
            assert.isTrue(bclientSpy.calledOnce);
            assert.isTrue(eclientSpy.calledOnce);
            queue = undefined;
            done();
          });
        });
      });

      it('should work without a callback', function (done) {
        queue = Queue('test');
        queue.on('ready', function () {
          queue.close();
          setTimeout(function () {
            assert.isFalse(queue.client.connected);
            queue = undefined;
            done();
          }, 20);
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

      queue.createJob({foo: 'bar'}).save();
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

      queue.createJob({foo: 'bar'}).save();
      queue.bclient.emit('end');
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
        redis: {
          host: 'localhost',
          db: 1
        }
      });

      queue.once('ready', function () {
        assert.strictEqual(queue.client.connectionOption.host, 'localhost');
        assert.strictEqual(queue.bclient.connectionOption.host, 'localhost');
        assert.strictEqual(queue.client.selected_db, 1);
        assert.strictEqual(queue.bclient.selected_db, 1);
        done();
      });
    });

    it('creates a queue with isWorker false', function (done) {
      queue = Queue('test', {
        isWorker: false
      });

      queue.once('ready', function () {
        assert.strictEqual(queue.client.connectionOption.host, '127.0.0.1');
        assert.isUndefined(queue.bclient);
        done();
      });
    });

  });

  it('adds a job with correct prefix', function (done) {
    queue = Queue('test');

    queue.createJob({foo: 'bar'}).save(function (err, job) {
      assert.isNull(err);
      assert.ok(job.id);
      queue.client.hget('bq:test:jobs', job.id, function (getErr, jobData) {
        assert.isNull(getErr);
        assert.strictEqual(jobData, job.toData());
        done();
      });
    });
  });

  describe('Health Check', function () {
    it('reports a waiting job', function (done) {
      queue = Queue('test');

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        queue.checkHealth(function (healthErr, counts) {
          assert.isNull(healthErr);
          assert.strictEqual(counts.waiting, 1);
          done();
        });
      });
    });

    it('reports an active job', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        queue.checkHealth(function (healthErr, counts) {
          assert.isNull(healthErr);
          assert.strictEqual(counts.active, 1);
          jobDone();
          done();
        });
      });

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
      });
    });

    it('reports a succeeded job', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone();
      });

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
      });

      queue.on('succeeded', function (job) {
        assert.ok(job);
        queue.checkHealth(function (healthErr, counts) {
          assert.isNull(healthErr);
          assert.strictEqual(counts.succeeded, 1);
          done();
        });
      });
    });

    it('reports a failed job', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(Error('failed!'));
      });

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
      });

      queue.on('failed', function (job) {
        assert.ok(job);
        queue.checkHealth(function (healthErr, counts) {
          assert.isNull(healthErr);
          assert.strictEqual(counts.failed, 1);
          done();
        });
      });
    });
  });

  describe('getJob', function () {
    it('gets an job created by the same queue instance', function (done) {
      queue = Queue('test');

      var createdJob = queue.createJob({foo: 'bar'});
      createdJob.save(function (err, createdJob) {
        assert.isNull(err);
        assert.ok(createdJob.id);
        queue.getJob(createdJob.id, function (getErr, job) {
          assert.isNull(getErr);
          assert.strictEqual(job.toData(), createdJob.toData());
          done();
        });
      });
    });

    it('gets a job created by another queue instance', function (done) {
      queue = Queue('test');
      var reader = Queue('test');

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, createdJob) {
        assert.isNull(err);
        assert.ok(createdJob.id);
        reader.getJob(createdJob.id, function (getErr, job) {
          assert.isNull(getErr);
          assert.strictEqual(job.toData(), createdJob.toData());
          done();
        });
      });
    });
  });

  describe('Processing jobs', function () {
    it('processes a job', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(null, 'baz');
      });

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      queue.on('succeeded', function (job, data) {
        assert.ok(job);
        assert.strictEqual(data, 'baz');
        job.isInSet('succeeded', function (err, isMember) {
          assert.isTrue(isMember);
          done();
        });
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

      queue.createJob({foo: 'bar'}).save(function (err, job) {
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

    it('processes a job that fails', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(Error('failed!'));
      });

      var job = queue.createJob({foo: 'bar'});
      job.save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      queue.on('failed', function (job, err) {
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, 'failed!');
        job.isInSet('failed', function (err, isMember) {
          assert.isTrue(isMember);
          done();
        });
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

      queue.createJob({foo: 'bar'}).save(function (err, job) {
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

    it('processes and retries a job that fails', function (done) {
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

      queue.createJob({foo: 'bar'}).save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });
    });

    it('processes a job that times out', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        setTimeout(jobDone, 20);
      });

      queue.createJob({foo: 'bar'}).timeout(10).save(function (err, job) {
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

      queue.createJob({foo: 'bar'}).retries(retries).save(function (err, job) {
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


    it('processes a job that times out and auto-retries', function (done) {
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

      queue.createJob({foo: 'bar'}).timeout(10).retries(retries).save(function (err, job) {
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

    it('Refuses to process when isWorker is false', function (done) {
      queue = Queue('test', {
        isWorker: false
      });

      try {
        queue.process();
      } catch (err) {
        assert.strictEqual(err.message, 'Cannot call Queue.prototype.process on a non-worker');
        done();
      }
    });

    it('Refuses to be called twice', function (done) {
      queue = Queue('test');

      queue.process(function () {});
      try {
        queue.process();
      } catch (err) {
        assert.strictEqual(err.message, 'Cannot call Queue.prototype.process twice');
        done();
      }
    });
  });

  describe('Processing many jobs', function () {
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
        queue.createJob({count: i}).save();
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
        queue.createJob({count: i}).save();
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

      var addJob = function (i) {
        queue.createJob({count: i}).save();
      };

      for (var i = 0; i < numJobs; i++) {
        setTimeout(addJob.bind(null, i), Math.random() * 50);
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
        queue.createJob({count: i}).save();
      }
    });
  });

  describe('Resets', function () {
    it('resets and processes stalled jobs when starting a queue', function (done) {
      var deadQueue = Queue('test', {
        stallInterval: 0
      });

      var processJobs = function () {
        queue = Queue('test', {
          stallInterval: 0
        });
        var reportDone = barrier(3, done);
        queue.checkStalledJobs(function () {
          queue.process(function (job, jobDone) {
            jobDone();
            reportDone();
          });
        });
      };

      var processAndClose = function () {
        deadQueue.process(function () {
          deadQueue.close(processJobs);
        });
      };

      var reportAdded = barrier(3, processAndClose);

      deadQueue.createJob({foo: 'bar1'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar2'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar3'}).save(reportAdded);
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
        queue.createJob({foo: 'bar'}).save(function () {
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
        deadQueue.createJob({count: i}).save(reportAdded);
      }
    });

    it('should reset without a callback', function (done) {
      var deadQueue = Queue('test', {
        stallInterval: 0
      });

      var processJobs = function () {
        queue = Queue('test', {
          stallInterval: 0
        });
        var reportDone = barrier(3, done);
        queue.checkStalledJobs();
        setTimeout(function () {
          queue.process(function (job, jobDone) {
            reportDone();
            jobDone();
          });
        }, 20);
      };

      var processAndClose = function () {
        deadQueue.process(function () {
          deadQueue.close(processJobs);
        });
      };

      var reportAdded = barrier(3, processAndClose);

      deadQueue.createJob({foo: 'bar1'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar2'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar3'}).save(reportAdded);
    });

    it('should reset with an interval', function (done) {
      var deadQueue = Queue('test', {
        stallInterval: 0
      });

      var processJobs = function () {
        queue = Queue('test', {
          stallInterval: 0
        });
        var reportDone = barrier(6, done);
        queue.checkStalledJobs(10, reportDone);
        setTimeout(function () {
          queue.process(function (job, jobDone) {
            reportDone();
            jobDone();
          });
        }, 20);
      };

      var processAndClose = function () {
        deadQueue.process(function () {
          deadQueue.close(processJobs);
        });
      };

      var reportAdded = barrier(3, processAndClose);

      deadQueue.createJob({foo: 'bar1'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar2'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar3'}).save(reportAdded);
    });
  });

  describe('Startup', function () {
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

      deadQueue.createJob({foo: 'bar1'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar2'}).save(reportAdded);
      deadQueue.createJob({foo: 'bar3'}).save(reportAdded);
    });

    it('does not process an in-progress job when a new queue starts', function (done) {
      queue = Queue('test');
      queue.createJob({foo: 'bar'}).save(function () {
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
  });

  describe('Pubsub events', function () {
    it('emits a job succeeded event', function (done) {
      queue = Queue('test');
      var worker = Queue('test');
      var queueEvent = false;

      var job = queue.createJob({foo: 'bar'});
      job.once('succeeded', function (result) {
        assert.isTrue(queueEvent);
        assert.strictEqual(result, 'barbar');
        worker.close(done);
      });
      queue.once('job succeeded', function (jobId, result) {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(result, 'barbar');
      });
      job.save();

      worker.process(function (job, jobDone) {
        jobDone(null, job.data.foo + job.data.foo);
      });
    });

    it('emits a job succeeded event with no result', function (done) {
      queue = Queue('test');
      var worker = Queue('test');
      var queueEvent = false;

      var job = queue.createJob({foo: 'bar'});
      job.on('succeeded', function (result) {
        assert.isTrue(queueEvent);
        assert.strictEqual(result, undefined);
        worker.close(done);
      });
      queue.once('job succeeded', function (jobId, result) {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(result, undefined);
      });
      job.save();

      worker.process(function (job, jobDone) {
        jobDone(null);
      });
    });

    it('emits a job failed event', function (done) {
      queue = Queue('test');
      var worker = Queue('test');
      var queueEvent = false;

      var job = queue.createJob({foo: 'bar'});
      job.on('failed', function (err) {
        assert.isTrue(queueEvent);
        assert.strictEqual(err.message, 'fail!');
        worker.close(done);
      });
      queue.once('job failed', function (jobId, err) {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(err.message, 'fail!');
      });
      job.save();

      worker.process(function (job, jobDone) {
        jobDone(Error('fail!'));
      });
    });

    it('emits a job progress event', function (done) {
      queue = Queue('test');
      var worker = Queue('test');
      var reportedProgress = false;
      var queueEvent = false;

      var job = queue.createJob({foo: 'bar'});
      job.on('progress', function (progress) {
        assert.isTrue(queueEvent);
        assert.strictEqual(progress, 20);
        reportedProgress = true;
      });

      queue.once('job progress', function (jobId, progress) {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(progress, 20);
      });


      job.on('succeeded', function () {
        assert.isTrue(reportedProgress);
        assert.isTrue(queueEvent);
        worker.close(done);
      });
      job.save();

      worker.process(function (job, jobDone) {
        job.reportProgress(20);
        setTimeout(jobDone, 20);
      });
    });

    it('emits a job retrying event', function (done) {
      queue = Queue('test');
      var worker = Queue('test');
      var retried = false;
      var queueEvent = false;

      var job = queue.createJob({foo: 'bar'}).retries(1);
      job.on('retrying', function (err) {
        assert.strictEqual(job.options.retries, 0);
        assert.strictEqual(err.message, 'failing to retry');
      });
      queue.once('job retrying', function (jobId, err) {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(err.message, 'failing to retry');
      });
      job.on('succeeded', function (result) {
        assert.isTrue(retried);
        assert.isTrue(queueEvent);
        assert.strictEqual(result, 'retried');
        worker.close(done);
      });
      job.save();

      worker.process(function (job, jobDone) {
        if (retried) {
          jobDone(null, 'retried');
        } else {
          retried = true;
          jobDone(Error('failing to retry'));
        }
      });
    });

    it('are not received when getEvents is false', function (done) {
      queue = Queue('test', {
        getEvents: false
      });
      var worker = Queue('test');

      assert.isUndefined(queue.eclient);

      var job = queue.createJob({foo: 'bar'});
      job.on('succeeded', function () {
        assert.fail();
      });
      job.save();

      worker.process(function (job, jobDone) {
        jobDone(null, job.data.foo);
        setTimeout(worker.close.bind(worker, done), 20);
      });
    });

    it('are not sent when sendEvents is false', function (done) {
      queue = Queue('test');
      var worker = Queue('test', {
        sendEvents: false
      });

      var job = queue.createJob({foo: 'bar'});
      job.on('succeeded', function () {
        assert.fail();
      });
      job.save();

      worker.process(function (job, jobDone) {
        jobDone(null, job.data.foo);
        setTimeout(worker.close.bind(worker, done), 20);
      });
    });

    it('properly emits events with multiple jobs', function (done) {
      queue = Queue('test');
      var worker = Queue('test');

      var reported = 0;
      var jobIdSum = 0;
      var job1 = queue.createJob({foo: 'bar'});
      var job2 = queue.createJob({foo: 'baz'});
      job1.on('succeeded', function (result) {
        reported += 1;
        assert.strictEqual(result, 'barbar');
      });
      job2.on('succeeded', function (result) {
        reported += 1;
        assert.strictEqual(result, 'bazbaz');
      });
      queue.on('job succeeded', function (id) {
        jobIdSum += id;
      });
      job1.save();
      job2.save();

      worker.process(function (job, jobDone) {
        jobDone(null, job.data.foo + job.data.foo);
        setTimeout(function () {
          assert.strictEqual(jobIdSum, 3);
          assert.strictEqual(reported, 2);
          worker.close(done);
        }, 20);
      });
    });
  });

  describe('Destroy', function () {
    it('should remove all associated redis keys', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone();
      });

      queue.createJob({foo: 'bar'}).save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      var checkForKeys = function (err) {
        assert.isNull(err);
        queue.client.keys(queue.toKey('*'), function (keysErr, keys) {
          assert.isNull(keysErr);
          assert.deepEqual(keys, []);
          done();
        });
      };

      queue.on('succeeded', function (job) {
        assert.ok(job);
        queue.destroy(checkForKeys);
      });
    });

    it('should work without a callback', function (done) {
      queue = Queue('test');

      queue.process(function (job, jobDone) {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone();
      });

      queue.createJob({foo: 'bar'}).save(function (err, job) {
        assert.isNull(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      var checkForKeys = function () {
        queue.client.keys(queue.toKey('*'), function (err, keys) {
          assert.isNull(err);
          assert.deepEqual(keys, []);
          done();
        });
      };

      queue.on('succeeded', function (job) {
        assert.ok(job);
        queue.destroy();
        setTimeout(checkForKeys, 20);
      });
    });
  });

});
