import {describe} from 'ava-spec';

import Queue from '../lib/queue';
import helpers from '../lib/helpers';
import sinon from 'sinon';

import {promisify} from 'promise-callbacks';

import redis from '../lib/redis';

// A promise-based barrier.
function reef(n = 1) {
  const done = helpers.deferred(), end = done.defer();
  return {
    done,
    next() {
      --n;
      if (n < 0) return false;
      if (n === 0) end();
      return true;
    }
  };
}

async function recordUntil(emitter, trackedEvents, lastEvent) {
  const recordedEvents = [];

  const done = helpers.waitOn(emitter, lastEvent);
  for (let event of trackedEvents) {
    const handler = (...values) => {
      recordedEvents.push([event, ...values]);
    };
    emitter.on(event, handler);
    done.then(() => emitter.removeListener(event, handler));
  }

  await done;
  return recordedEvents;
}

function delKeys(client, pattern) {
  const promise = helpers.deferred(), done = promise.defer();
  client.keys(pattern, (err, keys) => {
    if (err) return done(err);
    if (keys.length) {
      client.del(keys, done);
    } else {
      done();
    }
  });
  return promise;
}

function spitter() {
  const values = [], resume = [];

  function push(value) {
    if (resume.length) {
      resume.shift()(value);
    } else {
      values.push(value);
    }
  }

  return {
    push,
    pushSuspend(value) {
      return new Promise((resolve) => push([value, resolve]));
    },
    count() {
      return values.length;
    },
    shift() {
      if (values.length) {
        return Promise.resolve(values.shift());
      }
      return new Promise((resolve) => resume.push(resolve));
    }
  };
}

describe('Queue', (it) => {
  const gclient = redis.createClient();

  it.before(() => gclient);

  let uid = 0;
  it.beforeEach((t) => {
    const ctx = t.context;

    Object.assign(ctx, {
      queueName: `test-job-${uid++}`,
      queues: [],
      queueErrors: [],
      makeQueue,
      handleErrors,
    });

    function makeQueue(...args) {
      const queue = new Queue(ctx.queueName, ...args);
      queue.on('error', (err) => ctx.queueErrors.push(err));
      ctx.queues.push(queue);
      return queue;
    }

    function handleErrors(t) {
      if (t) return t.notThrows(handleErrors);
      if (ctx.queueErrors && ctx.queueErrors.length) {
        throw ctx.queueErrors[0];
      }
    }
  });

  it.afterEach((t) => {
    const errs = t.context.queueErrors;
    if (errs && errs.length) {
      t.fail('errors were not cleaned up');
    }

    // Close all the queues that were created during the test, and wait for them to close before
    // ending the test.
    if (t.context.queues) {
      return Promise.all(t.context.queues.map((queue) => {
        if (!queue.paused) {
          return queue.close();
        }
      }));
    }
  });

  it.beforeEach(async (t) => delKeys(await gclient, `bq:${t.context.queueName}:*`));
  it.afterEach(async (t) => delKeys(await gclient, `bq:${t.context.queueName}:*`));

  it('should convert itself to a Queue instance', (t) => {
    const queue = t.context.queue = Queue(t.context.queueName);

    t.true(queue instanceof Queue);
  });

  it('should initialize without ensuring scripts', async (t) => {
    const queue = t.context.makeQueue({
      ensureScripts: false
    });

    await queue.ready();

    t.context.handleErrors(t);
  });

  it.cb('should support a ready callback', (t) => {
    const queue = t.context.makeQueue();
    queue.ready(t.end);
  });

  it('should indicate whether it is running', async (t) => {
    const queue = t.context.makeQueue();

    // The queue should be "running" immediately - different from ready because it can accept jobs
    // immediately.
    t.true(queue.isRunning());
    await queue.ready();
    t.true(queue.isRunning());
    await queue.close();
    t.false(queue.isRunning());
  });

  it.describe('Connection', (it) => {
    it.describe('Close', (it) => {
      it('should close the redis clients', async (t) => {
        const queue = t.context.makeQueue();

        await queue.ready();

        t.true(queue.client.ready);
        t.true(queue.bclient.ready);
        t.true(queue.eclient.ready);

        await queue.close();

        t.false(queue.client.ready);
        t.false(queue.bclient.ready);
        t.false(queue.eclient.ready);
      });

      it.cb('should support callbacks', (t) => {
        const queue = t.context.makeQueue();

        queue.ready().then(() => {
          queue.close(t.end);
        }).catch(t.end);
      });

      it('should not fail after a second call', async (t) => {
        const queue = t.context.makeQueue();

        await queue.ready();

        await queue.close();
        await t.notThrows(queue.close());
      });

      it('should stop processing even with a redis retry strategy', async (t) => {
        const queue = t.context.makeQueue({
          redis: {
            // Retry after 1 millisecond.
            retryStrategy: () => 1
          }
        });

        const processSpy = sinon.spy(async () => {});
        queue.process(processSpy);

        await queue.createJob({is: 'first'}).save();
        await helpers.waitOn(queue, 'succeeded', true);
        t.true(processSpy.calledOnce);
        processSpy.reset();

        // Close the queue so queue3 will process later jobs.
        queue.close();

        const queue2 = t.context.makeQueue({
          // If the other queue is still somehow running, ensure that we can't take work from it.
          isWorker: false
        });

        await queue2.createJob({is: 'second'}).save();
        await helpers.delay(50);

        const queue3 = t.context.makeQueue();

        const newSpy = sinon.spy(async () => {});
        queue3.process(newSpy);

        await helpers.waitOn(queue3, 'succeeded', true);
        await queue3.close();

        t.true(newSpy.calledOnce);
        t.false(processSpy.called);
      });

      it('should gracefully shut down', async (t) => {
        const queue = t.context.makeQueue();

        const started = helpers.deferred(), resume = helpers.deferred();
        queue.process(() => {
          setImmediate(started.defer(), null);
          return resume;
        });

        const successSpy = sinon.spy();
        queue.on('succeeded', successSpy);

        await queue.createJob({}).save();
        await started;

        // Asynchronously wait 20 seconds, then complete the process handler.
        setTimeout(resume.defer(), 20, null);

        // Meanwhile, close the queue, and verify that success is called before close completes.
        t.false(successSpy.called);
        await queue.close();
        t.true(successSpy.calledOnce);
      });

      it('should not process new jobs while shutting down', async (t) => {
        const queue = t.context.makeQueue();

        const started = helpers.deferred(),
              resumed = helpers.deferred(), resume = resumed.defer();
        const processSpy = sinon.spy(() => {
          setImmediate(started.defer(), null);
          return resumed;
        });
        queue.process(processSpy);

        const successSpy = sinon.spy();
        queue.on('succeeded', successSpy);

        await queue.createJob({is: 'first'}).save();
        await started;

        // Close the queue, save a new job, and then complete the first job.
        const closed = queue.close();
        await queue.createJob({is: 'second'}).save();
        resume(null);
        await closed;

        // Verify that the second job wasn't picked up for processing.
        t.true(processSpy.calledOnce);
        t.true(successSpy.calledOnce);
        t.deepEqual(processSpy.firstCall.args[0].data, {is: 'first'});
      });

      it('should stop the check timer', async (t) => {
        const queue = t.context.makeQueue({
          stallInterval: 100
        });

        queue.checkStalledJobs(50);

        await helpers.delay(25);

        const spy = sinon.spy(queue, 'checkStalledJobs');
        await queue.close();

        await helpers.delay(50);

        t.false(spy.called);
      });

      it('should time out', async (t) => {
        const queue = t.context.makeQueue();

        // Intentionally stall the job.
        const jobs = spitter();
        queue.process((job) => jobs.pushSuspend(job));

        await queue.createJob({}).save();
        await jobs.shift();

        await t.throws(queue.close(10), 'Operation timed out.');

        // Clean up the queues so we don't try to in the afterEach hook.
        t.context.queues = null;
      });
    });

    it('should not error on close', async (t) => {
      const queue = t.context.makeQueue();

      await queue.close();

      await helpers.delay(30);

      t.context.handleErrors(t);
    });

    it('should recover from a connection loss', async (t) => {
      const queue = t.context.makeQueue({
        redis: {
          // Retry after 1 millisecond.
          retryStrategy: () => 1
        }
      });

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
      });

      queue.ready()
        .then(() => queue.bclient.stream.destroy());

      queue.createJob({foo: 'bar'}).save();

      // We don't expect errors because destroy doesn't cause an actual error - it just forces redis
      // to reconnect.
      await helpers.waitOn(queue, 'succeeded', true);

      t.context.handleErrors();
    });

    it('should reconnect when the blocking client disconnects', async (t) => {
      const queue = t.context.makeQueue();

      const jobSpy = sinon.spy(queue, 'getNextJob');

      queue.process(async () => {
        // First getNextJob fails on the disconnect, second should succeed.
        t.is(jobSpy.callCount, 2);
      });

      // Not called at all yet because queue.process uses setImmediate.
      t.is(jobSpy.callCount, 0);

      queue.createJob({foo: 'bar'}).save();
      queue.ready()
        .then(() => queue.bclient.stream.destroy());

      await helpers.waitOn(queue, 'succeeded', true);

      t.is(jobSpy.callCount, 2);
    });
  });

  it.describe('Constructor', (it) => {
    it('creates a queue with default redis settings', async (t) => {
      const queue = t.context.makeQueue();

      await queue.ready();

      t.is(queue.client.connection_options.host, '127.0.0.1');
      t.is(queue.bclient.connection_options.host, '127.0.0.1');
      t.is(queue.client.connection_options.port, 6379);
      t.is(queue.bclient.connection_options.port, 6379);
      t.true(queue.client.selected_db == null);
      t.true(queue.bclient.selected_db == null);
    });

    it('creates a queue with passed redis settings', async (t) => {
      const queue = t.context.makeQueue({
        redis: {
          host: 'localhost',
          db: 1
        }
      });

      await queue.ready();

      t.is(queue.client.connection_options.host, 'localhost');
      t.is(queue.bclient.connection_options.host, 'localhost');
      t.is(queue.client.selected_db, 1);
      t.is(queue.bclient.selected_db, 1);
    });

    it('creates a queue with isWorker false', async (t) => {
      const queue = t.context.makeQueue({
        isWorker: false
      });

      await queue.ready();

      t.is(queue.client.connection_options.host, '127.0.0.1');
      t.is(queue.bclient, undefined);
    });
  });

  it('adds a job with correct prefix', async (t) => {
    const queue = t.context.makeQueue();

    await queue.ready();

    const {hget} = promisify.methods(queue.client, ['hget']);

    const job = await queue.createJob({foo: 'bar'}).save();
    t.truthy(job.id);

    const jobData = await hget(`bq:${t.context.queueName}:jobs`, job.id);

    t.is(jobData, job.toData());
  });

  it.describe('Health Check', (it) => {
    it('reports a waiting job', async (t) => {
      const queue = t.context.makeQueue({
        isWorker: false
      });

      const job = await queue.createJob({foo: 'bar'}).save();

      t.truthy(job.id);

      const counts = await queue.checkHealth();

      t.is(counts.waiting, 1);
    });

    it('reports an active job', async (t) => {
      const queue = t.context.makeQueue();
      const end = helpers.deferred(), finish = end.defer();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        const counts = await queue.checkHealth();
        t.is(counts.active, 1);

        finish();
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);

      return end;
    });

    it('reports a succeeded job', async (t) => {
      const queue = t.context.makeQueue();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);

      const succeededJob = await helpers.waitOn(queue, 'succeeded');
      t.is(succeededJob.id, job.id);

      const counts = await queue.checkHealth();
      t.is(counts.succeeded, 1);
    });

    it('reports a failed job', async (t) => {
      const queue = t.context.makeQueue();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        throw new Error('failed!');
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);

      const failedJob = await helpers.waitOn(queue, 'failed');
      t.is(failedJob.id, job.id);

      const counts = await queue.checkHealth();
      t.is(counts.failed, 1);
    });
  });

  it.describe('getJob', (it) => {
    it('gets an job created by the same queue instance', async (t) => {
      const queue = t.context.makeQueue();

      const createdJob = await queue.createJob({foo: 'bar'}).save();
      t.truthy(createdJob.id);

      const job = await queue.getJob(createdJob.id);
      t.is(job.toData(), createdJob.toData());
    });

    it('should return null for a nonexistent job', async (t) => {
      const queue = t.context.makeQueue();

      const job = await queue.getJob('deadbeef');
      t.is(job, null);
    });

    it('gets a job created by another queue instance', async (t) => {
      const queue = t.context.makeQueue({
        isWorker: false
      });
      const reader = t.context.makeQueue({
        isWorker: false
      });

      const createdJob = await queue.createJob({foo: 'bar'}).save();
      t.truthy(createdJob.id);

      const job = await reader.getJob(createdJob.id);
      t.is(job.toData(), createdJob.toData());
    });

    it('should get a job with a specified id', async (t) => {
      const queue = t.context.makeQueue({
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
      });

      await queue.createJob({foo: 'bar'}).setId('amazingjob').save();

      const job = await queue.getJob('amazingjob');
      t.truthy(job);
      t.is(job.id, 'amazingjob');
      t.deepEqual(job.data, {foo: 'bar'});
    });
  });

  it.describe('Processing jobs', (it) => {
    it('processes a job', async (t) => {
      const queue = t.context.makeQueue();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        return 'baz';
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      const success = sinon.spy();
      queue.once('succeeded', success);
      await helpers.waitOn(queue, 'succeeded');

      const [[succeededJob, data]] = success.args;
      t.truthy(succeededJob);
      t.is(data, 'baz');

      t.true(await succeededJob.isInSet('succeeded'));
    });

    it('should process a job with a non-numeric id', async (t) => {
      const queue = t.context.makeQueue({
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
      });

      queue.process(async (job) => {
        t.is(job.id, 'amazingjob');
        t.is(job.data.foo, 'baz');
      });

      const success = helpers.waitOn(queue, 'succeeded', true);

      await queue.createJob({foo: 'baz'}).setId('amazingjob').save();
      await success;

      const job = await queue.getJob('amazingjob');

      t.truthy(job);
      t.is(job.id, 'amazingjob');
      t.deepEqual(job.data, {foo: 'baz'});
      t.true(await job.isInSet('succeeded'));
    });

    it('processes a job with removeOnSuccess', async (t) => {
      const queue = t.context.makeQueue({
        removeOnSuccess: true
      });

      await queue.ready();

      const {hget} = promisify.methods(queue.client, ['hget']);

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      const succeededJob = await helpers.waitOn(queue, 'succeeded');
      t.is(succeededJob.id, job.id);

      const jobData = await hget(queue.toKey('jobs'), job.id);
      t.is(jobData, null);
    });

    it('processes a job that fails', async (t) => {
      const queue = t.context.makeQueue();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        throw new Error('failed!');
      });

      const fail = sinon.spy();
      queue.once('failed', fail);
      const failed = helpers.waitOn(queue, 'failed');

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      await failed;
      const [[failedJob, err]] = fail.args;

      t.truthy(failedJob);
      t.is(failedJob.data.foo, 'bar');
      t.is(err.message, 'failed!');
      t.true(await failedJob.isInSet('failed'));
    });

    it('processes a job that throws an exception', async (t) => {
      const queue = t.context.makeQueue({
        catchExceptions: true
      });

      queue.process(() => {
        throw new Error('exception!');
      });

      const fail = sinon.spy();
      queue.once('failed', fail);
      const failed = helpers.waitOn(queue, 'failed');

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      await failed;
      const [[failedJob, err]] = fail.args;

      t.truthy(failedJob);
      t.is(failedJob.data.foo, 'bar');
      t.is(err.message, 'exception!');
    });

    it('processes and retries a job that fails', async (t) => {
      const queue = t.context.makeQueue();

      let callCount = 0;
      queue.process(async (job) => {
        callCount++;
        t.is(job.data.foo, 'bar');
        if (callCount <= 1) {
          throw new Error('failed!');
        }
      });

      queue.on('failed', (job, err) => {
        t.truthy(job);
        t.is(job.data.foo, 'bar');
        t.is(err.message, 'failed!');
        job.retry();
      });

      const succeeded = helpers.waitOn(queue, 'succeeded');

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      await succeeded;
      t.is(callCount, 2);
    });

    it('processes a job that times out', async (t) => {
      const queue = t.context.makeQueue();

      queue.process((job) => {
        t.is(job.data.foo, 'bar');
        return helpers.delay(20);
      });

      const fail = sinon.spy();
      queue.once('failed', fail);
      const failed = helpers.waitOn(queue, 'failed');

      const job = await queue.createJob({foo: 'bar'}).timeout(10).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');
      t.is(job.options.timeout, 10);

      await failed;
      const [[failedJob, err]] = fail.args;

      t.truthy(failedJob);
      t.is(job.id, '1');
      t.is(failedJob.data.foo, 'bar');
      t.is(err.message, `Job ${job.id} timed out (10 ms)`);
    });

    it('processes a job that auto-retries', async (t) => {
      const queue = t.context.makeQueue();
      const retries = 1;
      const failMsg = 'failing to auto-retry...';

      const end = helpers.deferred(), finish = end.defer();

      let failCount = 0;

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        if (job.options.retries) {
          throw new Error(failMsg);
        }
        t.is(failCount, retries);
        finish();
      });

      queue.on('failed', (job, err) => {
        ++failCount;
        t.truthy(job);
        t.is(job.data.foo, 'bar');
        t.is(err.message, failMsg);
      });

      const job = await queue.createJob({foo: 'bar'}).retries(retries).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');
      t.is(job.options.retries, retries);

      return end;
    });


    it('processes a job that times out and auto-retries', async (t) => {
      const queue = t.context.makeQueue();
      const retries = 1;

      const end = helpers.deferred(), finish = end.defer();

      let failCount = 0;

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        if (job.options.retries) {
          return helpers.defer(20);
        }
        t.is(failCount, retries);
        finish();
      });

      queue.on('failed', (job) => {
        failCount += 1;
        t.truthy(job);
        t.is(job.data.foo, 'bar');
      });

      const job = await queue.createJob({foo: 'bar'}).timeout(10).retries(retries).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');
      t.is(job.options.retries, retries);

      return end;
    });

    it('refuses to process when isWorker is false', (t) => {
      const queue = t.context.makeQueue({
        isWorker: false
      });

      t.throws(() => {
        queue.process();
      }, 'Cannot call Queue#process on a non-worker');

      t.context.handleErrors(t);
    });

    it('refuses to be called twice', (t) => {
      const queue = t.context.makeQueue();

      queue.process(() => {});

      t.throws(() => {
        queue.process();
      }, 'Cannot call Queue#process twice');

      t.context.handleErrors(t);
    });
  });

  it.describe('Processing many jobs', (it) => {
    it('processes many jobs in a row with one processor', async (t) => {
      const queue = t.context.makeQueue();
      const numJobs = 20;

      const end = helpers.deferred(), finish = end.defer();

      let counter = 0;

      queue.process(async (job) => {
        t.is(job.data.count, counter);
        counter++;
        if (counter === numJobs) {
          finish();
        }
      });

      const jobs = [];
      for (let i = 0; i < numJobs; i++) {
        jobs.push(queue.createJob({count: i}));
      }

      // Save all the jobs.
      await Promise.all(jobs.map((job) => job.save()));

      return end;
    });

    it('processes many jobs with one concurrent processor', async (t) => {
      const queue = t.context.makeQueue();
      const concurrency = 5;
      const numJobs = 20;

      const end = helpers.deferred(), finish = end.defer();

      let counter = 0;

      queue.process(concurrency, async (job) => {
        t.true(queue.running <= concurrency);
        await helpers.delay(10);
        t.is(job.data.count, counter);
        counter++;
        if (counter === numJobs) {
          finish();
        }
      });

      for (let i = 0; i < numJobs; i++) {
        await queue.createJob({count: i}).save();
      }

      return end;
    });

    it('processes many randomly offset jobs with one concurrent processor', async (t) => {
      const queue = t.context.makeQueue();
      const concurrency = 5;
      const numJobs = 20;

      const end = helpers.deferred(), finish = end.defer();

      let counter = 0;

      queue.process(concurrency, async () => {
        t.true(queue.running <= concurrency);
        await helpers.delay(10);
        counter++;
        if (counter === numJobs) {
          finish();
        }
      });

      for (let i = 0; i < numJobs; i++) {
        setTimeout(() => {
          queue.createJob({count: i}).save().catch(finish);
        }, Math.random() * 50);
      }

      return end;
    });

    it('processes many jobs with multiple processors', async (t) => {
      const queue = t.context.makeQueue();
      const processors = [
        t.context.makeQueue(),
        t.context.makeQueue(),
        t.context.makeQueue(),
      ];
      const numJobs = 20;
      const processed = new Set();

      const end = helpers.deferred(), finish = end.defer();

      let counter = 0;

      const handleJob = async () => {};

      const success = (job) => {
        if (processed.has(job.data.count)) {
          t.fail('job already processed');
        }
        processed.add(job.data.count);
        counter++;

        // Don't verify that we've finished until we've processed enough jobs.
        if (counter < numJobs) return;
        t.is(counter, numJobs);

        // Make sure every job has actually been processed.
        for (let i = 0; i < numJobs; i++) {
          t.true(processed.has(i));
        }
        finish(null, Promise.all(processors.map((queue) => queue.close())));
      };

      for (let queue of processors) {
        queue.process(handleJob).on('succeeded', success);
      }

      for (let i = 0; i < numJobs; i++) {
        queue.createJob({count: i}).save();
      }

      return end;
    });
  });

  it.describe('Backoff', (it) => {
    it('should fail for invalid backoff strategies and delays', (t) => {
      const queue = t.context.makeQueue({
        isWorker: false,
        getEvents: false
      });

      const job = queue.createJob({});
      t.throws(() => job.backoff('wow', 100), 'unknown strategy');
      t.throws(() => job.backoff('fixed', -100), /positive integer/i);
      t.throws(() => job.backoff('fixed', 44.5), /positive integer/i);
    });

    it('should handle fixed backoff', async (t) => {
      const queue = t.context.makeQueue({
        processDelayed: true
      });

      const calls = [];

      queue.process(async (job) => {
        t.deepEqual(job.options.backoff, {
          strategy: 'fixed',
          delay: 100
        });
        t.deepEqual(job.data, {is: 'fixed'});
        calls.push(Date.now());
        if (calls.length === 1) {
          throw new Error('forced retry');
        }
        t.is(calls.length, 2);
      });

      const succeed = helpers.waitOn(queue, 'succeeded', true);

      await queue.createJob({is: 'fixed'})
        .retries(2)
        .backoff('fixed', 100)
        .save();

      await succeed;

      t.is(calls.length, 2);

      // Ensure there was a delay.
      t.true(calls[1] - calls[0] >= 100);
    });

    it('should handle exponential backoff', async (t) => {
      const queue = t.context.makeQueue({
        processDelayed: true
      });

      let calls = [];

      queue.process(async (job) => {
        t.deepEqual(job.options.backoff, {
          strategy: 'exponential',
          delay: 30 * Math.pow(2, calls.length)
        });
        t.deepEqual(job.data, {is: 'exponential'});
        calls.push(Date.now());
        if (calls.length < 3) {
          throw new Error('forced retry');
        }
      });

      const succeed = helpers.waitOn(queue, 'succeeded', true);

      await queue.createJob({is: 'exponential'})
        .retries(3)
        .backoff('exponential', 30)
        .save();

      await succeed;

      t.is(calls.length, 3);

      // Ensure there was a delay.
      t.true(calls[1] - calls[0] >= 30);
      t.true(calls[2] - calls[1] >= 60);
    });
  });

  it.describe('Resets', (it) => {
    it('should reset and process stalled jobs when starting a queue', async (t) => {
      t.plan(0);

      const queue = t.context.makeQueue({
        stallInterval: 1
      });

      const jobs = [
        queue.createJob({foo: 'bar1'}),
        queue.createJob({foo: 'bar2'}),
        queue.createJob({foo: 'bar3'}),
      ];

      // Save the three jobs.
      await Promise.all(jobs.map((job) => job.save()));

      // Artificially move to active.
      await queue.getNextJob();

      // Mark the jobs as stalling, so that Queue#process immediately detects them as stalled.
      await helpers.delay(1); // Just in case - somehow - we end up going too fast.
      await queue.checkStalledJobs();
      await helpers.delay(1); // Just in case - somehow - we end up going too fast.

      const {done, next} = reef(jobs.length);
      queue.process(async () => {
        next();
      });

      return done;
    });

    it('resets and processes jobs from multiple stalled queues', async (t) => {
      const queues = [];
      for (let i = 0; i < 5; i++) {
        queues.push(t.context.makeQueue());
      }

      await Promise.all(queues.map(async (stallQueue) => {
        await stallQueue.ready();

        await Promise.all([
          // Do nada.
          stallQueue.getNextJob(),
          stallQueue.createJob({foo: 'bar'}).save(),
        ]);

        await stallQueue.close();
      }));

      const queue = t.context.makeQueue({
        stallInterval: 1
      });

      await queue.checkStalledJobs();
      await helpers.delay(1); // Just in case - somehow - we end up going too fast.

      const {done, next} = reef(queues.length);
      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
        next();
      });

      return done;
    });

    it('resets and processes stalled jobs from concurrent processor', async (t) => {
      const deadQueue = t.context.makeQueue({
        stallInterval: 1
      });
      const concurrency = 5;
      const numJobs = 10;

      // Disable stall prevention for the dead queue.
      sinon.stub(deadQueue, '_preventStall').callsFake(async () => {});

      const jobs = [];
      for (let i = 0; i < numJobs; i++) {
        jobs.push(deadQueue.createJob({count: i}));
      }

      // Save all the jobs.
      await Promise.all(jobs.map((job) => job.save()));

      const {done: resume, next: spooled} = reef();
      deadQueue.process(concurrency, () => {
        // Wait for it to get all spooled up...
        if (deadQueue.running === concurrency) {
          spooled();
        }
      });

      await resume;
      await t.throws(deadQueue.close(1), 'Operation timed out.');

      const queue = t.context.makeQueue({
        stallInterval: 1
      });

      await helpers.delay(1); // Just in case - somehow - we end up going too fast.
      await queue.checkStalledJobs();
      await helpers.delay(1); // Just in case - somehow - we end up going too fast.

      const {done, next} = reef(numJobs);
      queue.process(async () => {
        next() || t.fail('processed too many jobs');
      });

      return done;
    });

    it('should reset with an interval', async (t) => {
      // Open two queues:
      // - a queue that stalls all jobs
      // - a queue that processes all jobs
      // Produce two jobs such that the "bad" queue receives a job.
      // Safely finish the job in the "good" queue.
      // Close the "bad queue".
      // Run checkStalledJobs with an interval.
      // Once the queue emits a "stalled" event, create a new "bad" queue.
      // Publish another two jobs as above.
      // Once the "bad" queue has received a job, close it.
      // Ensure the jobs both process, and that the "good" queue emits a stalled event.

      const goodQueue = t.context.makeQueue({
        stallInterval: 50
      });

      const failStalled = () => t.fail('no job should stall yet');
      goodQueue.on('stalled', failStalled);

      const goodJobs = spitter();
      goodQueue.process((job) => goodJobs.pushSuspend(job));

      let deadQueue = t.context.makeQueue({
        stallInterval: 50
      });

      let deadJobs = spitter();
      deadQueue.process((job) => deadJobs.pushSuspend(job));

      // Save the two jobs.
      const firstJobs = await Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
      ]);

      await deadJobs.shift();

      const [, finishFirstGood] = await goodJobs.shift();

      // Finish the job in the good queue.
      finishFirstGood(null);

      // Force the dead queue to close with a timeout.
      await t.throws(deadQueue.close(1), 'Operation timed out.');

      const stalls = spitter();
      goodQueue.removeListener('stalled', failStalled);
      goodQueue.on('stalled', stalls.push);

      goodQueue.checkStalledJobs(120);

      // We now have a stalled job, and the good queue has already completed its initial stalled
      // jobs check.
      const firstStalledJobId = await stalls.shift();
      t.true(firstJobs.some((job) => job.id === firstStalledJobId));

      // Process the stalled job.
      (await goodJobs.shift())[1](null);

      deadQueue = t.context.makeQueue({
        stallInterval: 50
      });

      deadJobs = spitter();
      deadQueue.process((job) => deadJobs.pushSuspend(job));

      const secondJobs = await Promise.all([
        deadQueue.createJob({foo: 'bar1'}).save(),
        deadQueue.createJob({foo: 'bar2'}).save(),
      ]);

      const secondJobIds = new Set(secondJobs.map((job) => job.id));

      const [deadJob,] = await deadJobs.shift();
      await t.throws(deadQueue.close(1), 'Operation timed out.');

      const secondGoodBatch = new Set();

      const [secondGoodJob, secondGoodJobFinish] = await goodJobs.shift();
      secondGoodBatch.add(secondGoodJob.id);
      secondGoodJobFinish(null);

      const secondStalledJobId = await stalls.shift();
      t.is(secondStalledJobId, deadJob.id);
      t.not(secondStalledJobId, secondGoodJob.id);
      t.true(secondJobIds.has(secondStalledJobId));

      const [retriedJob, retriedJobFinish] = await goodJobs.shift();
      secondGoodBatch.add(retriedJob.id);
      retriedJobFinish(null);

      t.deepEqual(secondGoodBatch, secondJobIds);

      t.is(stalls.count(), 0);
      t.is(goodJobs.count(), 0);

      t.context.handleErrors(t);
    });
  });

  it.describe('Startup', (it) => {
    it('processes pre-existing jobs when starting a queue', async (t) => {
      const deadQueue = t.context.makeQueue();

      const jobs = [
        deadQueue.createJob({foo: 'bar1'}),
        deadQueue.createJob({foo: 'bar2'}),
        deadQueue.createJob({foo: 'bar3'}),
      ];

      // Save all the jobs.
      await Promise.all(jobs.map((job) => job.save()));
      await deadQueue.close();

      const queue = t.context.makeQueue();
      let jobCount = 0;

      const {done, next} = reef();
      queue.process(async (job) => {
        t.is(job.data.foo, 'bar' + ++jobCount);
        if (jobCount < 3) return;
        t.is(jobCount, 3);
        next();
      });

      await done;

      t.context.handleErrors(t);
    });

    it('does not process an in-progress job when a new queue starts', async (t) => {
      const queue = t.context.makeQueue();

      await queue.createJob({foo: 'bar'}).save();

      const jobDone = helpers.deferred(), finishJob = jobDone.defer();
      queue.process((job) => {
        t.is(job.data.foo, 'bar');
        return jobDone;
      });

      const queue2 = t.context.makeQueue();
      queue2.process(() => {
        t.fail('queue2 should not process a job');
      });

      await helpers.delay(20);
      finishJob();

      await helpers.waitOn(queue, 'succeeded', true);
    });
  });

  it.describe('Pubsub events', (it) => {
    it('emits a job succeeded event', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job = queue.createJob({foo: 'bar'});
      const record = Promise.all([
        recordUntil(job, ['succeeded'], 'succeeded'),
        recordUntil(queue, ['job succeeded'], 'job succeeded'),
      ]);

      worker.process(async (job) => job.data.foo + job.data.foo);
      await job.save();

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [jobEvents, queueEvents] = await record;

      t.deepEqual(jobEvents, [
        ['succeeded', 'barbar'],
      ]);

      t.deepEqual(queueEvents, [
        ['job succeeded', job.id, 'barbar'],
      ]);
    });

    it('emits a job succeeded event with no result', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job = queue.createJob({foo: 'bar'});
      const record = Promise.all([
        recordUntil(job, ['succeeded'], 'succeeded'),
        recordUntil(queue, ['job succeeded'], 'job succeeded'),
      ]);

      worker.process(async () => {});
      await job.save();

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [jobEvents, queueEvents] = await record;

      t.deepEqual(jobEvents, [
        ['succeeded', undefined],
      ]);

      t.deepEqual(queueEvents, [
        ['job succeeded', job.id, undefined],
      ]);
    });

    it('emits a job failed event', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job = queue.createJob({foo: 'bar'});
      const record = Promise.all([
        recordUntil(job, ['failed'], 'failed'),
        recordUntil(queue, ['job failed'], 'job failed'),
      ]);

      worker.process(async () => {
        throw new Error('fail!');
      });
      await job.save();

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [jobEvents, queueEvents] = await record;

      const jobErr = jobEvents[0][1];
      t.is(jobErr.message, 'fail!');
      t.deepEqual(jobEvents, [
        ['failed', jobErr],
      ]);

      const queueErr = queueEvents[0][2];
      t.is(queueErr.message, 'fail!');
      t.deepEqual(queueEvents, [
        ['job failed', job.id, queueErr],
      ]);
    });

    it('emits a job progress event', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job = queue.createJob({foo: 'bar'});
      const record = Promise.all([
        recordUntil(job, ['progress', 'succeeded'], 'succeeded'),
        recordUntil(queue, ['job progress', 'job succeeded'], 'job succeeded'),
      ]);

      worker.process((job) => {
        job.reportProgress(20);
        return helpers.delay(20);
      });
      await job.save();

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [jobEvents, queueEvents] = await record;

      t.deepEqual(jobEvents, [
        ['progress', 20],
        ['succeeded', undefined],
      ]);

      t.deepEqual(queueEvents, [
        ['job progress', job.id, 20],
        ['job succeeded', job.id, undefined],
      ]);
    });

    it('emits a job retrying event', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job = queue.createJob({foo: 'bar'}).retries(1);
      const record = Promise.all([
        recordUntil(job, ['retrying', 'succeeded'], 'succeeded'),
        recordUntil(queue, ['job retrying', 'job succeeded'], 'job succeeded'),
      ]);

      let retried = false;
      worker.process(async () => {
        if (!retried) {
          retried = true;
          throw new Error('failing job to trigger retry');
        }
      });
      await job.save();

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [jobEvents, queueEvents] = await record;

      t.is(job.options.retries, 0);

      const jobErr = jobEvents[0][1];
      t.is(jobErr.message, 'failing job to trigger retry');
      t.deepEqual(jobEvents, [
        ['retrying', jobErr],
        ['succeeded', undefined],
      ]);

      const queueErr = queueEvents[0][2];
      t.is(queueErr.message, 'failing job to trigger retry');
      t.deepEqual(queueEvents, [
        ['job retrying', job.id, queueErr],
        ['job succeeded', job.id, undefined],
      ]);
    });

    it('are not received when getEvents is false', async (t) => {
      const queue = t.context.makeQueue({
        getEvents: false
      });
      const worker = t.context.makeQueue();

      t.is(queue.eclient, undefined);

      await queue.createJob({foo: 'bar'})
        // Holy race condition, batman!
        .on('succeeded', () => t.fail('should not trigger a succeeded event'))
        .save();

      worker.process(async (job) => {
        return job.data.foo;
      });

      await helpers.waitOn(worker, 'succeeded');
      await helpers.delay(20);
    });

    it('are not sent when sendEvents is false', async (t) => {
      t.plan(0);

      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue({
        sendEvents: false
      });

      await queue.createJob({foo: 'bar'})
        .on('succeeded', () => t.fail('should not trigger a succeeded event'))
        .save();

      worker.process(async (job) => {
        return job.data.foo;
      });

      await helpers.waitOn(worker, 'succeeded');
      await helpers.delay(20);
    });

    it('properly emits events with multiple jobs', async (t) => {
      const queue = t.context.makeQueue();
      const worker = t.context.makeQueue();

      const job1 = queue.createJob({foo: 'bar'});
      const job2 = queue.createJob({foo: 'baz'});
      const record = Promise.all([
        recordUntil(job1, ['succeeded'], 'succeeded'),
        recordUntil(job2, ['succeeded'], 'succeeded'),
        recordUntil(queue, ['job succeeded'], 'derped'),
      ]);

      worker.process(async (job) => job.data.foo + job.data.foo);
      await Promise.all([job1.save(), job2.save()]);

      queue.once('job succeeded', () => queue.once('job succeeded', () => queue.emit('derped')));

      // Wait for the event to show up in both, but only bind the value from the event on the job
      // object.
      const [job1Events, job2Events, queueEvents] = await record;

      t.deepEqual(job1Events, [
        ['succeeded', 'barbar'],
      ]);

      t.deepEqual(job2Events, [
        ['succeeded', 'bazbaz'],
      ]);

      // Ordering here is guaranteed assuming no network errors.
      t.deepEqual(queueEvents, [
        ['job succeeded', job1.id, 'barbar'],
        ['job succeeded', job2.id, 'bazbaz'],
      ]);
    });
  });

  it.describe('Destroy', (it) => {
    it('should remove all associated redis keys', async (t) => {
      const queue = t.context.makeQueue();

      queue.process(async (job) => {
        t.is(job.data.foo, 'bar');
      });

      const job = await queue.createJob({foo: 'bar'}).save();
      t.truthy(job.id);
      t.is(job.data.foo, 'bar');

      const successJob = await helpers.waitOn(queue, 'succeeded');
      t.truthy(successJob);
      await queue.destroy();

      const {keys: getKeys} = promisify.methods(queue.client, ['keys']);
      const keys = await getKeys(queue.toKey('*'));
      t.deepEqual(keys, []);
    });
  });

});
