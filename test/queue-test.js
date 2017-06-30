const Queue = require('../lib/queue');

const sinon = require('sinon');
const assert = require('chai').assert;

const helpers = require('../lib/helpers');

// Effectively _.after
function barrier(n, done) {
  return () => {
    n -= 1;
    if (n === 0) {
      done();
    }
  };
}

describe('Queue', function () {
  const pqueue = new Queue('test', {
    isWorker: false,
    getEvents: false,
    sendEvents: false,
  });

  before(() => pqueue.ready());

  function closeQueue() {
    const queue = this.queue;
    if (queue) {
      this.queue = undefined;
      if (!queue.paused) {
        return queue.close();
      }
    }
  }

  function clearKeys(done) {
    pqueue.client.keys(pqueue.toKey('*'), (err, keys) => {
      if (err) return done(err);
      if (keys.length) {
        pqueue.client.del(keys, done);
      } else {
        done();
      }
    });
  }

  before(clearKeys);
  beforeEach(closeQueue);
  afterEach(closeQueue);
  afterEach(clearKeys);

  it('should convert itself to a Queue instance', function () {
    this.queue = Queue('test');

    assert.isTrue(this.queue instanceof Queue);
  });

  it('should initialize without ensuring scripts', function () {
    this.queue = new Queue('test', {
      ensureScripts: false
    });

    return this.queue.ready();
  });

  it('should support a ready callback', function (done) {
    this.timeout(500);
    this.queue = new Queue('test');
    this.queue.ready(done);
  });

  it('should indicate whether it is running', function () {
    this.queue = new Queue('test');

    // The queue should be "running" immediately - different from ready because it can accept jobs
    // immediately.
    assert.isTrue(this.queue.isRunning());
    return this.queue.ready()
      .then(() => {
        assert.isTrue(this.queue.isRunning());
        return this.queue.close();
      })
      .then(() => assert.isFalse(this.queue.isRunning()));
  });

  describe('Connection', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    describe('Close', function () {
      beforeEach(closeQueue);
      afterEach(closeQueue);

      it('should close the redis clients', function (done) {
        this.queue = new Queue('test');

        this.queue.once('ready', () => {
          assert.isTrue(this.queue.client.ready);
          assert.isTrue(this.queue.bclient.ready);
          assert.isTrue(this.queue.eclient.ready);
          this.queue.close((err) => {
            if (err) return done(err);
            assert.isFalse(this.queue.client.ready);
            assert.isFalse(this.queue.bclient.ready);
            assert.isFalse(this.queue.eclient.ready);
            done();
          });
        });
      });

      it('should support promises', function () {
        this.queue = new Queue('test');

        return this.queue.ready()
          .then(() => this.queue.close());
      });

      it('should not fail after a second call', function () {
        this.queue = new Queue('test');

        return this.queue.ready()
          .then(() => this.queue.close())
          .then(() => this.queue.close());
      });

      it('should stop processing even with a redis retry strategy', function () {
        this.queue = new Queue('test', {
          redis: {
            // Retry after 1 millisecond.
            retryStrategy: () => 1
          }
        });

        const processSpy = sinon.spy(() => Promise.resolve());
        this.queue.process(processSpy);

        return this.queue.createJob({is: 'first'}).save()
          .then(() => helpers.waitOn(this.queue, 'succeeded', true))
          .then(() => {
            assert.isTrue(processSpy.calledOnce);
            processSpy.reset();

            this.queue.close();

            this.queue2 = new Queue('test', {
              // If the other queue is still somehow running, don't take work from it.
              isWorker: false
            });

            return this.queue2.createJob({is: 'second'}).save();
          })
          .then(() => helpers.delay(50))
          .then(() => this.queue2.close())
          .then(() => {
            this.queue3 = new Queue('test');

            this.newSpy = sinon.spy(() => Promise.resolve());
            this.queue3.process(this.newSpy);

            return helpers.waitOn(this.queue3, 'succeeded', true);
          })
          .then(() => {
            return this.queue3.close();
          })
          .then(() => {
            assert.isTrue(this.newSpy.calledOnce);
            assert.isFalse(processSpy.called);
          });
      });

      it('should gracefully shut down', function () {
        this.queue = new Queue('test');

        const errorSpy = sinon.spy();
        this.queue.on('error', errorSpy);

        const started = helpers.deferred(), resume = helpers.deferred();
        this.queue.process(() => {
          setImmediate(started.defer(), null);
          return resume;
        });

        const success = helpers.waitOn(this.queue, 'succeeded', true);

        return this.queue.createJob({}).save()
          .then(() => started)
          .then(() => {
            setTimeout(resume.defer(), 20, null);
            return this.queue.close();
          })
          .then(() => success)
          .then(() => {
            if (errorSpy.called) {
              throw errorSpy.firstCall.args[0];
            }
          });
      });

      it('should not accept new jobs while shutting down', function () {
        this.queue = new Queue('test');

        const errorSpy = sinon.spy();
        this.queue.on('error', errorSpy);

        const started = helpers.deferred(), resume = helpers.deferred();
        const processSpy = sinon.spy(() => {
          setImmediate(started.defer(), null);
          return resume;
        });
        this.queue.process(processSpy);

        const success = helpers.waitOn(this.queue, 'succeeded', true);

        return this.queue.createJob({is: 'first'}).save()
          .then(() => started)
          .then(() => {
            this.queue.createJob({is: 'second'}).save();
            setTimeout(resume.defer(), 20, null);
            return this.queue.close();
          })
          .then(() => success)
          .then(() => {
            assert.isTrue(processSpy.calledOnce);
            assert.deepEqual(processSpy.firstCall.args[0].data, {is: 'first'});

            if (errorSpy.called) {
              throw errorSpy.firstCall.args[0];
            }
          });
      });

      it('should stop the check timer', function () {
        this.queue = new Queue('test', {
          stallInterval: 100
        });

        this.queue.checkStalledJobs(50);

        return helpers.delay(25)
          .then(() => {
            this.spy = sinon.spy(this.queue, 'checkStalledJobs');
            return this.queue.close();
          })
          .then(() => helpers.delay(50))
          .then(() => {
            assert.isFalse(this.spy.called);
            this.spy.restore();
          });
      });
    });

    it('should not error on close', function (done) {
      this.queue = new Queue('test');

      // No errors!
      this.queue.on('error', done);

      // Close the queue
      helpers.asCallback(this.queue.close()
        .then(() => helpers.delay(30)), done);
    });

    it('should recover from a connection loss', function () {
      this.queue = new Queue('test', {
        redis: {
          // Retry after 1 millisecond.
          retryStrategy: () => 1
        }
      });

      this.queue.process((job) => {
        assert.strictEqual(job.data.foo, 'bar');
        return Promise.resolve();
      });

      this.queue.ready()
        .then(() => this.queue.bclient.stream.destroy());

      this.queue.createJob({foo: 'bar'}).save();

      // We don't expect errors because destroy doesn't cause an actual error - it just forces redis
      // to reconnect.
      return helpers.waitOn(this.queue, 'succeeded', true);
    });

    it('should reconnect when the blocking client disconnects', function () {
      this.queue = new Queue('test');

      const jobSpy = sinon.spy(this.queue, 'getNextJob');

      this.queue.process(() => {
        // First getNextJob fails on the disconnect, second should succeed
        assert.strictEqual(jobSpy.callCount, 2);
        return Promise.resolve();
      });

      // Not called at all yet because queue.process uses setImmediate
      assert.strictEqual(jobSpy.callCount, 0);

      this.queue.createJob({foo: 'bar'}).save();
      this.queue.ready()
        .then(() => this.queue.bclient.stream.destroy());

      return helpers.waitOn(this.queue, 'succeeded', true)
        .then(() => {
          assert.strictEqual(jobSpy.callCount, 2);
        });
    });
  });

  describe('Constructor', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('creates a queue with default redis settings', function (done) {
      this.queue = new Queue('test');
      this.queue.once('ready', () => {
        assert.strictEqual(this.queue.client.connection_options.host, '127.0.0.1');
        assert.strictEqual(this.queue.bclient.connection_options.host, '127.0.0.1');
        assert.strictEqual(this.queue.client.connection_options.port, 6379);
        assert.strictEqual(this.queue.bclient.connection_options.port, 6379);
        assert.isTrue(this.queue.client.selected_db == null);
        assert.isTrue(this.queue.bclient.selected_db == null);
        done();
      });
    });

    it('creates a queue with passed redis settings', function (done) {
      this.queue = new Queue('test', {
        redis: {
          host: 'localhost',
          db: 1
        }
      });

      this.queue.once('ready', () => {
        assert.strictEqual(this.queue.client.connection_options.host, 'localhost');
        assert.strictEqual(this.queue.bclient.connection_options.host, 'localhost');
        assert.strictEqual(this.queue.client.selected_db, 1);
        assert.strictEqual(this.queue.bclient.selected_db, 1);
        done();
      });
    });

    it('creates a queue with isWorker false', function (done) {
      this.queue = new Queue('test', {
        isWorker: false
      });

      this.queue.once('ready', () => {
        assert.strictEqual(this.queue.client.connection_options.host, '127.0.0.1');
        assert.isUndefined(this.queue.bclient);
        done();
      });
    });

  });

  it('adds a job with correct prefix', function (done) {
    this.queue = new Queue('test');

    this.queue.createJob({foo: 'bar'}).save((err, job) => {
      if (err) return done(err);
      assert.ok(job.id);
      this.queue.client.hget('bq:test:jobs', job.id, (getErr, jobData) => {
        if (getErr) return done(getErr);
        assert.strictEqual(jobData, job.toData());
        done();
      });
    });
  });

  describe('Health Check', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('reports a waiting job', function (done) {
      this.queue = new Queue('test', {
        isWorker: false
      });

      this.queue.createJob({foo: 'bar'}).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        this.queue.checkHealth((healthErr, counts) => {
          if (err) return done(healthErr);
          assert.strictEqual(counts.waiting, 1);
          done();
        });
      });
    });

    it('reports an active job', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        this.queue.checkHealth((healthErr, counts) => {
          if (healthErr) return done(healthErr);
          assert.strictEqual(counts.active, 1);
          jobDone();
          done();
        });
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
      });
    });

    it('reports a succeeded job', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone();
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
      });

      this.queue.once('succeeded', (job) => {
        assert.ok(job);
        this.queue.checkHealth((healthErr, counts) => {
          if (healthErr) return done(healthErr);
          assert.strictEqual(counts.succeeded, 1);
          done();
        });
      });
    });

    it('reports a failed job', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(new Error('failed!'));
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
      });

      this.queue.once('failed', (job) => {
        assert.ok(job);
        this.queue.checkHealth((healthErr, counts) => {
          if (healthErr) return done(healthErr);
          assert.strictEqual(counts.failed, 1);
          done();
        });
      });
    });
  });

  describe('getJob', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('gets an job created by the same queue instance', function (done) {
      this.queue = new Queue('test');

      const createdJob = this.queue.createJob({foo: 'bar'});
      createdJob.save((err, createdJob) => {
        if (err) return done(err);
        assert.ok(createdJob.id);
        this.queue.getJob(createdJob.id, (getErr, job) => {
          if (getErr) return done(getErr);
          assert.strictEqual(job.toData(), createdJob.toData());
          done();
        });
      });
    });

    it('should return null for a nonexistent job', function () {
      this.queue = new Queue('test');

      return this.queue.getJob('deadbeef')
        .then((job) => assert.strictEqual(job, null));
    });

    it('gets a job created by another queue instance', function (done) {
      this.queue = new Queue('test', {
        isWorker: false
      });
      const reader = new Queue('test', {
        isWorker: false
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, createdJob) => {
        if (err) return done(err);
        assert.ok(createdJob.id);
        reader.getJob(createdJob.id, (getErr, job) => {
          if (getErr) return done(getErr);
          assert.strictEqual(job.toData(), createdJob.toData());
          done();
        });
      });
    });

    it('should get a job with a specified id', function () {
      this.queue = new Queue('test', {
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
      });

      return this.queue.createJob({foo: 'bar'}).setId('amazingjob').save()
        .then(() => this.queue.getJob('amazingjob'))
        .then((job) => {
          assert.ok(job);
          assert.strictEqual(job.id, 'amazingjob');
          assert.deepEqual(job.data, {foo: 'bar'});
        });
    });
  });

  describe('Processing jobs', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('processes a job', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(null, 'baz');
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      this.queue.once('succeeded', (job, data) => {
        assert.ok(job);
        assert.strictEqual(data, 'baz');
        job.isInSet('succeeded', (err, isMember) => {
          if (err) return done(err);
          assert.isTrue(isMember);
          done();
        });
      });
    });

    it('should process a job with a non-numeric id', function () {
      this.queue = new Queue('test', {
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
      });

      this.queue.process((job) => {
        assert.strictEqual(job.id, 'amazingjob');
        assert.strictEqual(job.data.foo, 'baz');
        return Promise.resolve();
      });

      const success = helpers.waitOn(this.queue, 'succeeded', true);

      return this.queue.createJob({foo: 'baz'}).setId('amazingjob').save()
        .then(() => success)
        .then(() => this.queue.getJob('amazingjob'))
        .then((job) => {
          assert.ok(job);
          assert.strictEqual(job.id, 'amazingjob');
          assert.deepEqual(job.data, {foo: 'baz'});
          return job.isInSet('succeeded');
        })
        .then((isMember) => assert.isTrue(isMember));
    });

    it('processes a job with removeOnSuccess', function (done) {
      this.queue = new Queue('test', {
        removeOnSuccess: true
      });

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(null);
      });

      this.queue.createJob({foo: 'bar'}).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      this.queue.once('succeeded', (job) => {
        this.queue.client.hget(this.queue.toKey('jobs'), job.id, (err, jobData) => {
          if (err) return done(err);
          assert.isNull(jobData);
          done();
        });
      });
    });

    it('processes a job that fails', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone(new Error('failed!'));
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      this.queue.once('failed', (job, err) => {
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, 'failed!');
        job.isInSet('failed', (err, isMember) => {
          if (err) return done(err);
          assert.isTrue(isMember);
          done();
        });
      });
    });

    it('processes a job that throws an exception', function (done) {
      this.queue = new Queue('test', {
        catchExceptions: true
      });

      this.queue.process((job) => {
        setImmediate(() => {
          assert.strictEqual(job.data.foo, 'bar');
        });
        throw new Error('exception!');
      });

      this.queue.createJob({foo: 'bar'}).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      this.queue.on('failed', (job, err) => {
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, 'exception!');
        done();
      });
    });

    it('processes and retries a job that fails', function (done) {
      this.queue = new Queue('test');
      let callCount = 0;

      this.queue.process((job, jobDone) => {
        callCount++;
        assert.strictEqual(job.data.foo, 'bar');
        if (callCount > 1) {
          return jobDone();
        } else {
          return jobDone(new Error('failed!'));
        }
      });

      this.queue.on('failed', (job, err) => {
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, 'failed!');
        job.retry();
      });

      this.queue.once('succeeded', () => {
        assert.strictEqual(callCount, 2);
        done();
      });

      this.queue.createJob({foo: 'bar'}).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });
    });

    it('processes a job that times out', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        setTimeout(jobDone, 20);
      });

      this.queue.createJob({foo: 'bar'}).timeout(10).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(job.options.timeout, 10);
      });

      this.queue.on('failed', (job, err) => {
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, 'Job 1 timed out (10 ms)');
        done();
      });
    });

    it('processes a job that auto-retries', function (done) {
      this.queue = new Queue('test');
      const retries = 1;
      const failMsg = 'failing to auto-retry...';

      let failCount = 0;

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        if (job.options.retries === 0) {
          assert.strictEqual(failCount, retries);
          jobDone();
          done();
        } else {
          jobDone(new Error(failMsg));
        }
      });

      this.queue.createJob({foo: 'bar'}).retries(retries).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(job.options.retries, retries);
      });

      this.queue.on('failed', (job, err) => {
        failCount += 1;
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(err.message, failMsg);
      });
    });


    it('processes a job that times out and auto-retries', function (done) {
      this.queue = new Queue('test');
      const retries = 1;

      let failCount = 0;

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        if (job.options.retries === 0) {
          assert.strictEqual(failCount, retries);
          jobDone();
          done();
        } else {
          setTimeout(jobDone, 20);
        }
      });

      this.queue.createJob({foo: 'bar'}).timeout(10).retries(retries).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
        assert.strictEqual(job.options.retries, retries);
      });

      this.queue.on('failed', (job) => {
        failCount += 1;
        assert.ok(job);
        assert.strictEqual(job.data.foo, 'bar');
      });
    });

    it('refuses to process when isWorker is false', function () {
      this.queue = new Queue('test', {
        isWorker: false
      });

      const errorSpy = sinon.spy();
      this.queue.on('error', errorSpy);

      assert.throws(() => {
        this.queue.process();
      }, 'Cannot call Queue#process on a non-worker');
      assert.isFalse(errorSpy.called);
    });

    it('refuses to be called twice', function () {
      this.queue = new Queue('test');

      const errorSpy = sinon.spy();
      this.queue.on('error', errorSpy);

      this.queue.process(() => {});

      assert.throws(() => {
        this.queue.process();
      }, 'Cannot call Queue#process twice');
      assert.isFalse(errorSpy.called);
    });
  });

  describe('Processing many jobs', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('processes many jobs in a row with one processor', function (done) {
      this.queue = new Queue('test');
      const numJobs = 20;

      let counter = 0;

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.count, counter);
        counter++;
        jobDone();
        if (counter === numJobs) {
          done();
        }
      });

      for (let i = 0; i < numJobs; i++) {
        this.queue.createJob({count: i}).save();
      }
    });

    it('processes many jobs with one concurrent processor', function (done) {
      this.queue = new Queue('test');
      const concurrency = 5;
      const numJobs = 20;

      let counter = 0;

      this.queue.process(concurrency, (job, jobDone) => {
        assert.isTrue(this.queue.running <= concurrency);
        setTimeout(() => {
          jobDone();
          assert.strictEqual(job.data.count, counter);
          counter++;
          if (counter === numJobs) {
            done();
          }
        }, 10);
      });

      for (let i = 0; i < numJobs; i++) {
        this.queue.createJob({count: i}).save();
      }
    });

    it('processes many randomly delayed jobs with one concurrent processor', function (done) {
      this.queue = new Queue('test');
      const concurrency = 5;
      const numJobs = 20;

      let counter = 0;

      this.queue.process(concurrency, (job, jobDone) => {
        assert.isTrue(this.queue.running <= concurrency);
        setTimeout(() => {
          jobDone();
          counter++;
          if (counter === numJobs) {
            done();
          }
        }, 10);
      });

      for (let i = 0; i < numJobs; i++) {
        setTimeout(() => {
          this.queue.createJob({count: i}).save();
        }, Math.random() * 50);
      }
    });

    it('processes many jobs with multiple processors', function (done) {
      this.queue = new Queue('test');
      const processors = [
        new Queue('test'),
        new Queue('test'),
        new Queue('test')
      ];
      const numJobs = 20;
      const processed = new Set();

      let counter = 0;

      const handleJob = (job, jobDone) => {
        jobDone();
      };

      const success = (job) => {
        if (processed.has(job.data.count)) {
          assert.fail('job already processed');
        }
        processed.add(job.data.count);
        counter++;

        if (counter < numJobs) return;
        assert.strictEqual(counter, numJobs);

        for (let i = 0; i < numJobs; i++) {
          assert.isTrue(processed.has(i));
        }
        helpers.asCallback(Promise.all(processors.map((queue) => queue.close())), done);
      };

      processors.forEach((queue) => {
        queue.process(handleJob).on('succeeded', success);
      });

      for (let i = 0; i < numJobs; i++) {
        this.queue.createJob({count: i}).save();
      }
    });
  });

  describe('Delayed jobs', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('should process delayed jobs', function () {
      this.queue = new Queue('test', {
        processDelayed: true,
        getEvents: false
      });

      const errorSpy = sinon.spy();
      this.queue.on('error', errorSpy);

      const processSpy = sinon.spy(() => {
        return Promise.resolve();
      });
      this.queue.process(processSpy);

      const raised = helpers.waitOn(this.queue, 'raised jobs');
      const succeeded = helpers.waitOn(this.queue, 'succeeded');

      const start = Date.now();
      return this.queue.createJob({iamdelayed: true})
        .delayUntil(start + 50)
        .save()
        .then(() => {
          return helpers.delay(start + 10 - Date.now());
        })
        .then(() => {
          assert.isFalse(processSpy.called);
          return helpers.delay(start + 51 - Date.now());
        })
        .then(() => {
          return Promise.all([raised, succeeded]);
        })
        .then(() => {
          assert.isTrue(processSpy.calledOnce);
          assert.isTrue(processSpy.firstCall.args[0].data.iamdelayed);
          if (errorSpy.called) {
            throw errorSpy.firstCall.args[0];
          }
        });
    });

    it('should process two proximal delayed jobs', function () {
      this.queue = new Queue('test', {
        processDelayed: true,
        delayedDebounce: 150,

        // Set this far later than the timeout to ensure we pull the
        nearTermWindow: 10000
      });

      const errorSpy = sinon.spy();
      this.queue.on('error', errorSpy);

      const processSpy = sinon.spy(() => {
        return Promise.resolve();
      });
      this.queue.process(processSpy);

      const successSpy = sinon.spy();
      this.queue.on('succeeded', successSpy);


      return this.queue.ready()
        .then(() => {
          sinon.spy(this.queue, '_evalScript');
          this.start = Date.now();
          return Promise.all([
            this.queue.createJob({is: 'early'}).delayUntil(this.start + 10).save(),

            // These should process together.
            this.queue.createJob({is: 'late', uid: 1}).delayUntil(this.start + 200).save(),
            this.queue.createJob({is: 'late', uid: 2}).delayUntil(this.start + 290).save(),
          ]);
        })
        .then(() => helpers.waitOn(this.queue, 'succeeded', true))
        .then(() => helpers.waitOn(this.queue, 'succeeded', true))
        .then(() => helpers.waitOn(this.queue, 'succeeded', true))
        .then(() => {
          assert.isTrue(Date.now() >= this.start + 290);
          assert.isTrue(processSpy.calledThrice);
          assert.deepEqual(processSpy.firstCall.args[0].data, {is: 'early'});
          assert.deepEqual(processSpy.secondCall.args[0].data.is, 'late');
          assert.deepEqual(processSpy.thirdCall.args[0].data.is, 'late');
          assert.isTrue(successSpy.calledThrice);
          assert.deepEqual(successSpy.firstCall.args[0].data, {is: 'early'});
          assert.deepEqual(successSpy.secondCall.args[0].data.is, 'late');
          assert.deepEqual(successSpy.thirdCall.args[0].data.is, 'late');
          if (errorSpy.called) {
            throw errorSpy.firstCall.args[0];
          }
        });
    });

    it('should process a distant delayed job', function () {
      this.queue = new Queue('test', {
        processDelayed: true,
        nearTermWindow: 100
      });

      const errorSpy = sinon.spy();
      this.queue.on('error', errorSpy);

      const processSpy = sinon.spy(() => Promise.resolve());
      this.queue.process(processSpy);

      sinon.spy(this.queue, '_evalScript');

      const success = helpers.waitOn(this.queue, 'succeeded', true);

      const start = Date.now();
      const job = this.queue.createJob({is: 'distant'}).delayUntil(start + 150);
      return job.save()
        .then(() => helpers.delay(start + 80 - Date.now()))
        .then(() => this.queue._evalScript.reset())
        .then(() => helpers.delay(start + 120 - Date.now()))
        .then(() => {
          assert.isTrue(this.queue._evalScript.calledOnce);
          assert.isTrue(this.queue._evalScript.calledWith('raiseDelayedJobs'));
          return success;
        })
        .then(() => {
          assert.isTrue(Date.now() >= start + 150);
          assert.isTrue(processSpy.calledOnce);
          assert.deepEqual(processSpy.firstCall.args[0].data, {is: 'distant'});
          if (errorSpy.called) {
            throw errorSpy.firstCall.args[0];
          }
        });
    });

    it('should process delayed jobs from other workers', function () {
      this.queue = new Queue('test', {
        getEvents: false,
        processDelayed: false
      });

      const processSpy = sinon.spy(() => Promise.resolve());
      this.queue.process(processSpy);

      const success = helpers.waitOn(this.queue, 'succeeded', true);

      this.queue2 = new Queue('test', {
        isWorker: false,
        getEvents: false,
        processDelayed: true
      });

      const start = Date.now();
      const job = this.queue.createJob({is: 'delayed'}).delayUntil(start + 150);
      return this.queue2.ready()
        // Save after the second queue is ready to avoid a race condition between the addDelayedJob
        // script and the SUBSCRIBE command.
        .then(() => job.save())
        .then(() => success)
        .then(() => this.queue2.close());
    });

    it('should process the delayed job the first time it was created', function () {
      this.queue = new Queue('test', {
        getEvents: false,
        sendEvents: false,
        processDelayed: true
      });

      const processSpy = sinon.spy(() => Promise.resolve());
      this.queue.process(processSpy);

      const success = helpers.waitOn(this.queue, 'succeeded', true);

      return this.queue.ready()
        .then(() => {
          this.start = Date.now();
          return this.queue.createJob({is: 'delayed'}).setId('awesomejob').delayUntil(this.start + 150).save();
        })
        .then(() => helpers.delay(Date.now() - this.start + 75))
        // Verify that we don't overwrite the job.
        .then(() => this.queue.createJob({is: 'delayed'}).setId('awesomejob').delayUntil(this.start + 10000).save())
        .then(() => success);
    });
  });

  describe('Backoff', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('should fail for invalid backoff strategies and delays', function () {
      this.queue = new Queue('test');
      assert.throws(() => this.queue.createJob({}).backoff('wow', 100), 'unknown strategy');
      assert.throws(() => this.queue.createJob({}).backoff('fixed', -100), /positive integer/i);
      assert.throws(() => this.queue.createJob({}).backoff('fixed', 44.5), /positive integer/i);
    });

    it('should handle fixed backoff', function () {
      this.queue = new Queue('test', {
        processDelayed: true
      });

      let calls = [];

      this.queue.process((job) => {
        assert.deepEqual(job.options.backoff, {
          strategy: 'fixed',
          delay: 100
        });
        assert.deepEqual(job.data, {is: 'fixed'});
        calls.push(Date.now());
        if (calls.length === 1) {
          return Promise.reject(new Error('forced retry'));
        }
        assert.strictEqual(calls.length, 2);
        return Promise.resolve();
      });

      const succeed = helpers.waitOn(this.queue, 'succeeded', true);

      const job = this.queue.createJob({is: 'fixed'})
        .retries(2)
        .backoff('fixed', 100);

      return job.save()
        .then(() => succeed)
        .then(() => {
          assert.strictEqual(calls.length, 2);

          // Ensure there was a delay.
          assert.isTrue(calls[1] - calls[0] >= 100);
        });
    });

    it('should handle exponential backoff', function () {
      this.queue = new Queue('test', {
        processDelayed: true
      });

      let calls = [];

      this.queue.process((job) => {
        assert.deepEqual(job.options.backoff, {
          strategy: 'exponential',
          delay: 30 * Math.pow(2, calls.length)
        });
        assert.deepEqual(job.data, {is: 'exponential'});
        calls.push(Date.now());
        if (calls.length < 3) {
          return Promise.reject(new Error('forced retry'));
        }
        return Promise.resolve();
      });

      const succeed = helpers.waitOn(this.queue, 'succeeded', true);

      const job = this.queue.createJob({is: 'exponential'})
        .retries(3)
        .backoff('exponential', 30);

      return job.save()
        .then(() => succeed)
        .then(() => {
          assert.strictEqual(calls.length, 3);

          // Ensure there was a delay.
          assert.isTrue(calls[1] - calls[0] >= 30);
          assert.isTrue(calls[2] - calls[1] >= 60);
        });
    });
  });

  describe('Resets', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('should reset and process stalled jobs when starting a queue', function (done) {
      const deadQueue = new Queue('test', {
        stallInterval: 0
      });

      const processJobs = () => {
        this.queue = new Queue('test', {
          stallInterval: 0
        });
        const reportDone = barrier(3, () => {
          helpers.asCallback(deadQueue.close(10)
            .then(() => {
              throw new Error('expected timeout');
            }, (err) => {
              assert.isTrue(err instanceof Error);
              assert.strictEqual(err.message, 'Operation timed out.');
            }), done);
        });
        this.queue.checkStalledJobs((err) => {
          if (err) return done(err);
          this.queue.process((job, jobDone) => {
            jobDone();
            reportDone();
          });
        });
      };

      // Disable stall prevention for the dead queue.
      sinon.stub(deadQueue, '_preventStall', () => Promise.resolve());

      Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
        deadQueue.createJob({foo: 'bar3'}).save(),
      ]).then(() => deadQueue.process(processJobs)).catch(done);
    });

    it('resets and processes jobs from multiple stalled queues', function () {
      const final = helpers.deferred(), finalDone = final.defer();

      const processJobs = () => {
        this.queue = new Queue('test', {
          stallInterval: 0
        });
        this.queue.checkStalledJobs((err) => {
          if (err) return finalDone(err);
          const reportDone = barrier(5, finalDone);
          this.queue.process((job, jobDone) => {
            assert.strictEqual(job.data.foo, 'bar');
            jobDone();
            reportDone();
          });
        });
      };

      const createAndStall = () => {
        const queue = new Queue('test', {
          stallInterval: 0
        });

        // Disable stall prevention for the queue.
        sinon.stub(queue, '_preventStall', () => Promise.resolve());

        final.catch(() => {}).then(() => queue.close());

        // Do nada.
        queue.process(() => {});

        return queue.createJob({foo: 'bar'}).save();
      };

      const made = [];
      for (let i = 0; i < 5; i++) {
        made.push(createAndStall());
      }

      Promise.all(made).then(() => processJobs()).catch(finalDone);

      return final;
    });

    it('resets and processes stalled jobs from concurrent processor', function () {
      const final = helpers.deferred(), finalDone = final.defer();

      const deadQueue = new Queue('test', {
        stallInterval: 0
      });
      const concurrency = 5;
      const numJobs = 10;

      let counter = 0;

      final.then(() => deadQueue.close());

      // Disable stall prevention for the dead queue.
      sinon.stub(deadQueue, '_preventStall', () => Promise.resolve());

      const processJobs = () => {
        this.queue = new Queue('test', {
          stallInterval: 0
        });
        this.queue.checkStalledJobs((err) => {
          if (err) return finalDone(err);
          this.queue.process((job, jobDone) => {
            counter += 1;
            jobDone();
            if (counter < numJobs) return;
            assert.strictEqual(counter, numJobs);
            finalDone();
          });
        });
      };

      const processAndClose = () => {
        deadQueue.process(concurrency, () => {
          // wait for it to get all spooled up...
          if (deadQueue.running === concurrency) {
            processJobs();
          }
        });
      };

      const made = [];
      for (let i = 0; i < numJobs; i++) {
        made.push(deadQueue.createJob({count: i}).save());
      }

      Promise.all(made).then(() => processAndClose()).catch(finalDone);

      return final;
    });

    it('should reset without a callback', function (done) {
      const deadQueue = new Queue('test', {
        stallInterval: 0
      });

      // Disable stall prevention for the dead queue.
      sinon.stub(deadQueue, '_preventStall', () => Promise.resolve());

      const processJobs = () => {
        this.queue = new Queue('test', {
          stallInterval: 0
        });
        const reportDone = barrier(3, done);
        this.queue.checkStalledJobs().then(() => {
          const expected = new Set(['bar1', 'bar2', 'bar3']);
          this.queue.process((job, jobDone) => {
            assert.isTrue(expected.has(job.data.foo));
            expected.delete(job.data.foo);
            reportDone();
            jobDone();
          });
        }).catch(done);
      };

      const processAndClose = () => {
        deadQueue.process(() => {
          processJobs();
        });
      };

      Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
        deadQueue.createJob({foo: 'bar3'}).save(),
      ]).then(() => processAndClose()).catch(done);
    });

    it('should reset with an interval', function (done) {
      const deadQueue = new Queue('test', {
        stallInterval: 0
      });

      deadQueue.on('error', done);

      const processJobs = () => {
        this.queue = new Queue('test', {
          stallInterval: 0
        });
        const reportDone = barrier(6, done);
        this.queue.checkStalledJobs(10, reportDone);
        setTimeout(() => {
          this.queue.process((job, jobDone) => {
            reportDone();
            jobDone();
          });
        }, 20);
      };

      const processAndClose = () => {
        deadQueue.process(() => {
          processJobs();
        });
      };

      Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
        deadQueue.createJob({foo: 'bar3'}).save(),
      ]).then(() => processAndClose()).catch(done);
    });
  });

  describe('Startup', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('processes pre-existing jobs when starting a queue', function (done) {
      const deadQueue = new Queue('test');

      deadQueue.on('error', () => {});

      const processJobs = () => {
        this.queue = new Queue('test');
        let jobCount = 0;
        this.queue.process((job, jobDone) => {
          assert.strictEqual(job.data.foo, 'bar' + ++jobCount);
          jobDone();
          if (jobCount < 3) return;
          assert.strictEqual(jobCount, 3);
          done();
        });
      };

      Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
        deadQueue.createJob({foo: 'bar3'}).save(),
      ]).then(() => deadQueue.close(processJobs)).catch(done);
    });

    it('does not process an in-progress job when a new queue starts', function (done) {
      this.queue = new Queue('test');
      this.queue.createJob({foo: 'bar'}).save(() => {
        this.queue.process((job, jobDone) => {
          assert.strictEqual(job.data.foo, 'bar');
          setTimeout(jobDone, 30);
        });

        const queue2 = new Queue('test');
        setTimeout(() => {
          queue2.process(() => {
            assert.fail('queue2 should not process a job');
          });
          this.queue.on('succeeded', () => queue2.close(done));
        }, 10);
      });
    });
  });

  describe('Pubsub events', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('emits a job succeeded event', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');
      let queueEvent = false;

      const job = this.queue.createJob({foo: 'bar'});
      job.once('succeeded', (result) => {
        assert.isTrue(queueEvent);
        assert.strictEqual(result, 'barbar');
        worker.close(done);
      });
      this.queue.once('job succeeded', (jobId, result) => {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(result, 'barbar');
      });
      job.save();

      worker.process((job, jobDone) => {
        jobDone(null, job.data.foo + job.data.foo);
      });
    });

    it('emits a job succeeded event with no result', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');
      let queueEvent = false;

      const job = this.queue.createJob({foo: 'bar'});
      job.on('succeeded', (result) => {
        assert.isTrue(queueEvent);
        assert.strictEqual(result, undefined);
        worker.close(done);
      });
      this.queue.once('job succeeded', (jobId, result) => {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(result, undefined);
      });
      job.save();

      worker.process((job, jobDone) => {
        jobDone(null);
      });
    });

    it('emits a job failed event', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');
      let queueEvent = false;

      const job = this.queue.createJob({foo: 'bar'});
      job.on('failed', (err) => {
        assert.isTrue(queueEvent);
        assert.strictEqual(err.message, 'fail!');
        worker.close(done);
      });
      this.queue.once('job failed', (jobId, err) => {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(err.message, 'fail!');
      });
      job.save();

      worker.process((job, jobDone) => {
        jobDone(new Error('fail!'));
      });
    });

    it('emits a job progress event', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');
      let reportedProgress = false;
      let queueEvent = false;

      const job = this.queue.createJob({foo: 'bar'});
      job.on('progress', (progress) => {
        assert.isTrue(queueEvent);
        assert.strictEqual(progress, 20);
        reportedProgress = true;
      });

      this.queue.once('job progress', (jobId, progress) => {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(progress, 20);
      });


      job.on('succeeded', () => {
        assert.isTrue(reportedProgress);
        assert.isTrue(queueEvent);
        worker.close(done);
      });
      job.save();

      worker.process((job, jobDone) => {
        job.reportProgress(20);
        setTimeout(jobDone, 20);
      });
    });

    it('emits a job retrying event', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');
      let retried = false;
      let queueEvent = false;

      const job = this.queue.createJob({foo: 'bar'}).retries(1);
      job.on('retrying', (err) => {
        assert.strictEqual(job.options.retries, 0);
        assert.strictEqual(err.message, 'failing to retry');
      });
      this.queue.once('job retrying', (jobId, err) => {
        queueEvent = true;
        assert.strictEqual(jobId, job.id);
        assert.strictEqual(err.message, 'failing to retry');
      });
      job.on('succeeded', (result) => {
        assert.isTrue(retried);
        assert.isTrue(queueEvent);
        assert.strictEqual(result, 'retried');
        worker.close(done);
      });
      job.save();

      worker.process((job, jobDone) => {
        if (retried) {
          jobDone(null, 'retried');
        } else {
          retried = true;
          jobDone(new Error('failing to retry'));
        }
      });
    });

    it('are not received when getEvents is false', function (done) {
      this.queue = new Queue('test', {
        getEvents: false
      });
      const worker = new Queue('test');

      assert.isUndefined(this.queue.eclient);

      const job = this.queue.createJob({foo: 'bar'});
      job.on('succeeded', () => {
        assert.fail();
      });
      job.save();

      worker.process((job, jobDone) => {
        jobDone(null, job.data.foo);
        setTimeout(worker.close.bind(worker, done), 20);
      });
    });

    it('are not sent when sendEvents is false', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test', {
        sendEvents: false
      });

      const job = this.queue.createJob({foo: 'bar'});
      job.on('succeeded', () => {
        assert.fail();
      });
      job.save();

      worker.process((job, jobDone) => {
        jobDone(null, job.data.foo);
        setTimeout(worker.close.bind(worker, done), 20);
      });
    });

    it('properly emits events with multiple jobs', function (done) {
      this.queue = new Queue('test');
      const worker = new Queue('test');

      let reported = 0;
      const jobIds = new Set();
      const job1 = this.queue.createJob({foo: 'bar'});
      const job2 = this.queue.createJob({foo: 'baz'});
      job1.on('succeeded', (result) => {
        assert.strictEqual(result, 'barbar');
        next();
      });
      job2.on('succeeded', (result) => {
        assert.strictEqual(result, 'bazbaz');
        next();
      });
      this.queue.on('job succeeded', (id) => {
        jobIds.add(id);
      });
      job1.save();
      job2.save();

      function next() {
        reported += 1;
        if (reported < 2) return;
        assert.deepEqual(jobIds, new Set(['1', '2']));
        assert.strictEqual(reported, 2);
        worker.close(done);
      }

      worker.process((job, jobDone) => {
        jobDone(null, job.data.foo + job.data.foo);
      });
    });
  });

  describe('Destroy', function () {
    beforeEach(closeQueue);
    afterEach(closeQueue);

    it('should remove all associated redis keys', function (done) {
      this.queue = new Queue('test');

      this.queue.process((job, jobDone) => {
        assert.strictEqual(job.data.foo, 'bar');
        jobDone();
      });

      this.queue.createJob({foo: 'bar'}).save((err, job) => {
        if (err) return done(err);
        assert.ok(job.id);
        assert.strictEqual(job.data.foo, 'bar');
      });

      const checkForKeys = (err) => {
        if (err) return done(err);
        this.queue.client.keys(this.queue.toKey('*'), (keysErr, keys) => {
          if (err) return done(keysErr);
          assert.deepEqual(keys, []);
          done();
        });
      };

      this.queue.on('succeeded', (job) => {
        assert.ok(job);
        this.queue.destroy(checkForKeys);
      });
    });
  });

});
