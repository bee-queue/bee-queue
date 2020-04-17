import {describe} from 'ava-spec';

import Queue from '../lib/queue';
import helpers from '../lib/helpers';
import sinon from 'sinon';

import redis from '../lib/redis';

import {EventEmitter as Emitter} from 'events';

function delKeys(client, pattern) {
  const promise = helpers.deferred(),
    done = promise.defer();
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

// A promise-based barrier.
function reef(n = 1) {
  const done = helpers.deferred(),
    end = done.defer();
  return {
    done,
    next() {
      --n;
      if (n < 0) return false;
      if (n === 0) end();
      return true;
    },
  };
}

describe('Delayed jobs', (it) => {
  const redisUrl = process.env.BEE_QUEUE_TEST_REDIS;
  const gclient = redis.createClient(redisUrl);

  it.before(() => gclient);

  let uid = 0;
  it.beforeEach((t) => {
    const ctx = t.context;

    Object.assign(ctx, {
      queueName: `test-delay-${uid++}`,
      queues: [],
      queueErrors: [],
      makeQueue,
      handleErrors,
    });

    function makeQueue(...args) {
      if (redisUrl) {
        if (args.length === 0) {
          args.push({});
        }
        if (!args[0].redis) {
          // Note: we don't fuss with isClient(redis) because it's simpler to just
          // add the host setting in the test code itself when redis is used
          args[0].redis = redisUrl;
        }
      }
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
      return Promise.all(
        t.context.queues.map((queue) => {
          if (!queue.paused) {
            return queue.close();
          }
        })
      );
    }
  });

  it.beforeEach(async (t) =>
    delKeys(await gclient, `bq:${t.context.queueName}:*`)
  );
  it.afterEach(async (t) =>
    delKeys(await gclient, `bq:${t.context.queueName}:*`)
  );

  it('should process delayed jobs', async (t) => {
    const queue = t.context.makeQueue({
      activateDelayedJobs: true,
      getEvents: false,
    });

    const processSpy = sinon.spy(async () => {});
    queue.process(processSpy);

    const raised = helpers.waitOn(queue, 'raised jobs');
    const succeeded = helpers.waitOn(queue, 'succeeded');

    const start = Date.now();
    await queue
      .createJob({iamdelayed: true})
      .delayUntil(start + 500)
      .save();
    await helpers.delay(start + 10 - Date.now());
    t.false(processSpy.called);
    await Promise.all([raised, succeeded]);

    t.true(processSpy.calledOnce);
    t.true(processSpy.firstCall.args[0].data.iamdelayed);

    t.context.handleErrors(t);
  });

  // This test cannot be as strict as we'd like, because we're dealing with the constraints of
  // distributed systems and inconsistent clocks. As such, we can't reject delayed publish
  // notifications, so if our local redis has a delayed publish, it'll show up and trigger an
  // extra raiseDelayedJobs invocation.
  it('should process two proximal delayed jobs', async (t) => {
    const queue = t.context.makeQueue({
      activateDelayedJobs: true,
      delayedDebounce: 150,

      // Set this far later than the timeout to ensure we pull the
      nearTermWindow: 10000,
    });

    const processSpy = sinon.spy(async () => {});
    queue.process(processSpy);

    const successSpy = sinon.spy();
    queue.on('succeeded', successSpy);

    await queue.ready();

    sinon.spy(queue, '_evalScript');
    const start = Date.now();

    await Promise.all([
      queue
        .createJob({is: 'early'})
        .delayUntil(start + 10)
        .save(),

      // These should process together.
      queue
        .createJob({is: 'late', uid: 1})
        .delayUntil(start + 200)
        .save(),
      queue
        .createJob({is: 'late', uid: 2})
        .delayUntil(start + 290)
        .save(),
    ]);

    // Wait for the three jobs to completely succeed.
    await helpers.waitOn(queue, 'succeeded', true);
    await helpers.waitOn(queue, 'succeeded', true);
    await helpers.waitOn(queue, 'succeeded', true);

    t.true(Date.now() >= start + 290);
    t.true(processSpy.calledThrice);
    t.deepEqual(processSpy.firstCall.args[0].data.is, 'early');
    t.deepEqual(processSpy.secondCall.args[0].data.is, 'late');
    t.deepEqual(processSpy.thirdCall.args[0].data.is, 'late');
    t.true(successSpy.calledThrice);
    t.deepEqual(successSpy.firstCall.args[0].data.is, 'early');
    t.deepEqual(successSpy.secondCall.args[0].data.is, 'late');
    t.deepEqual(successSpy.thirdCall.args[0].data.is, 'late');

    t.context.handleErrors(t);
  });

  it('should process a distant delayed job', async (t) => {
    const queue = t.context.makeQueue({
      activateDelayedJobs: true,
      nearTermWindow: 100,
    });

    let scheduled = helpers.deferred(),
      onSchedule = scheduled.defer();

    const mockTimer = new Emitter();
    mockTimer.schedule = sinon.spy((value) => onSchedule(null, value));
    mockTimer.stop = sinon.spy();
    for (const listener of queue._delayedTimer.listeners('trigger')) {
      mockTimer.on('trigger', listener);
    }
    queue._delayedTimer = mockTimer;

    await queue.ready();

    const processSpy = sinon.spy(async () => {});
    queue.process(processSpy);

    const success = helpers.waitOn(queue, 'succeeded', true);

    const start = Date.now();

    // Wait until after fetching the delayed jobs for the first time.
    t.is(await scheduled, -1);

    // For when Job#save calls schedule, and the subsequent call from onMessage.
    ({done: scheduled, next: onSchedule} = reef(2));

    await queue
      .createJob({is: 'distant'})
      .delayUntil(start + 150)
      .save();
    t.is(mockTimer.schedule.secondCall.args[0], start + 150);
    await scheduled;

    scheduled = helpers.deferred();
    onSchedule = scheduled.defer();
    mockTimer.emit('trigger');
    t.is(await scheduled, start + 150);

    await helpers.delay(Date.now() - start + 151);
    onSchedule = () => {};
    mockTimer.emit('trigger');

    await success;
    t.true(Date.now() >= start + 150);
    t.true(processSpy.calledOnce);
    t.deepEqual(processSpy.firstCall.args[0].data, {is: 'distant'});

    t.context.handleErrors(t);
  });

  it('should process delayed jobs from other workers', async (t) => {
    const queue = t.context.makeQueue({
      getEvents: false,
      activateDelayedJobs: false,
    });

    const processSpy = sinon.spy(async () => {});
    queue.process(processSpy);

    const success = helpers.waitOn(queue, 'succeeded', true);

    const queue2 = t.context.makeQueue({
      isWorker: false,
      getEvents: false,
      activateDelayedJobs: true,
    });

    const start = Date.now();
    await queue2.ready();

    // Save after the second queue is ready to avoid a race condition between the addDelayedJob
    // script and the SUBSCRIBE command.
    await queue
      .createJob({is: 'delayed'})
      .delayUntil(start + 150)
      .save();
    await success;
    t.true(processSpy.calledOnce);
  });

  it('should process the delayed job the first time it was created', async (t) => {
    const queue = t.context.makeQueue({
      getEvents: false,
      sendEvents: false,
      activateDelayedJobs: true,
    });

    const processSpy = sinon.spy(async () => {});
    queue.process(processSpy);

    const success = helpers.waitOn(queue, 'succeeded', true);

    await queue.ready();

    const start = Date.now();
    await queue
      .createJob({is: 'delayed'})
      .setId('awesomejob')
      .delayUntil(start + 150)
      .save();
    await helpers.delay(Date.now() - start + 75);
    await queue
      .createJob({is: 'delayed'})
      .setId('awesomejob')
      .delayUntil(start + 250)
      .save();

    const job = await success;

    // Verify that we don't overwrite the job.
    t.is(job.options.delay, start + 150);
  });
});
