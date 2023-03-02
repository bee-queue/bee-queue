const {describe} = require('ava-spec');

const Job = require('../lib/job');
const Queue = require('../lib/queue');
const helpers = require('../lib/helpers');

const {promisify} = require('promise-callbacks');

const withCallback = (fn) => async (t) => {
  await promisify(fn)(t);
  t.pass(); // There must be at least one passing assertion for the test to pass
};

describe.skip('Job', (it) => {
  const redisUrl = process.env.BEE_QUEUE_TEST_REDIS;

  const data = {foo: 'bar'};
  const options = {test: 1};

  let uid = 0;

  it.beforeEach(async (t) => {
    const queue = new Queue(`test-job-${uid++}`, {
      redis: redisUrl,
    });

    function makeJob() {
      const job = queue.createJob(data);
      job.options = options;
      return job.save();
    }

    await queue.ready();

    Object.assign(t.context, {queue, makeJob});
  });

  it.afterEach(async (t) => {
    const {queue} = t.context;
    clearKeys(queue.client, queue);
  });

  it('creates a job', async (t) => {
    const {makeJob} = t.context;

    const job = await makeJob();
    t.truthy(job, 'fails to return a job');
    t.true(helpers.has(job, 'id'), 'job has no id');
    t.true(helpers.has(job, 'data'), 'job has no data');
  });

  it('creates a job without data', async (t) => {
    const {queue} = t.context;

    const job = await queue.createJob().save();
    t.deepEqual(job.data, {});
  });

  it(
    'should save with a callback',
    withCallback((t, end) => {
      const {queue} = t.context;
      queue.createJob().save(end);
    })
  );

  it.describe('Chaining', (it) => {
    it('sets retries', (t) => {
      const {queue} = t.context;

      const job = queue.createJob({foo: 'bar'}).retries(2);
      t.is(job.options.retries, 2);
    });

    it('rejects invalid retries count', (t) => {
      const {queue} = t.context;

      t.throws(
        () => {
          queue.createJob({foo: 'bar'}).retries(-1);
        },
        {message: 'Retries cannot be negative'}
      );
    });

    it('should reject invalid delay timestamps', (t) => {
      const {queue} = t.context;

      const job = queue.createJob({foo: 'bar'});
      t.notThrows(() => job.delayUntil(new Date(Date.now() + 10000)));
      t.notThrows(() => job.delayUntil(Date.now() + 10000));
      t.throws(() => job.delayUntil(null), {message: /timestamp/i});
      t.throws(() => job.delayUntil(NaN), {message: /timestamp/i});
      t.throws(() => job.delayUntil('wobble'), {message: /timestamp/i});
      t.throws(() => job.delayUntil(-8734), {message: /timestamp/i});
    });

    it('should not save a delay to a past date', (t) => {
      const {queue} = t.context;

      const job = queue.createJob({foo: 'bar'});
      const until = Date.now() - 1000;
      job.delayUntil(until);
      t.not(job.options.delay, until);
    });

    it('sets timeout', (t) => {
      const {queue} = t.context;

      const job = queue.createJob({foo: 'bar'}).timeout(5000);
      t.is(job.options.timeout, 5000);
    });

    it('rejects invalid timeout', (t) => {
      const {queue} = t.context;

      t.throws(
        () => {
          queue.createJob({foo: 'bar'}).timeout(-1);
        },
        {message: 'Timeout cannot be negative'}
      );
    });

    it('saves the job in redis', async (t) => {
      const {queue, makeJob} = t.context;

      const job = await makeJob();
      const storedJob = await Job.fromId(queue, job.id);
      t.truthy(storedJob);
      t.true(helpers.has(storedJob, 'id'));
      t.deepEqual(storedJob.data, data);
      t.is(storedJob.options.test, options.test);
    });
  });

  it.describe('Progress', (it) => {
    it('requires a progress value', async (t) => {
      const {makeJob} = t.context;

      const job = await makeJob();
      await t.throwsAsync(() => job.reportProgress(), {
        message: 'Progress cannot be empty',
      });
    });

    it('should support passing a data object', async (t) => {
      const {makeJob} = t.context;

      const job = await makeJob();
      const progressData = {a: 'value'};
      return new Promise((resolve) => {
        job.on('progress', (data) => {
          t.deepEqual(data, progressData);
          resolve();
        });
        job.reportProgress(progressData);
      });
    });

    it(
      'should support callbacks',
      withCallback((t, end) => {
        const {makeJob} = t.context;

        makeJob().then((job) => job.reportProgress(50, end), end);
      })
    );
  });

  it.describe('Remove', (it) => {
    it('removes the job from redis', async (t) => {
      const {queue, makeJob} = t.context;

      const {hget} = promisify.methods(queue.client, ['hget']);

      const job = await makeJob();
      t.is(job, await job.remove());

      t.is(await hget(queue.toKey('jobs'), job.id), null);
    });

    it('should work with a callback', async (t) => {
      const {queue, makeJob} = t.context;

      const {hget} = promisify.methods(queue.client, ['hget']);

      const job = await makeJob();
      const removed = helpers.deferred();
      job.remove(removed.defer());
      await removed;

      t.is(await hget(queue.toKey('jobs'), job.id), null);
    });
  });

  it.describe('Retry', (it) => {
    it(
      'should support callbacks',
      withCallback((t, end) => {
        const {makeJob} = t.context;

        makeJob().then((job) => job.retry(end), end);
      })
    );
  });

  it.describe('IsInSet', (it) => {
    it(
      'should support callbacks',
      withCallback((t, end) => {
        const {makeJob} = t.context;

        makeJob().then((job) => job.isInSet('stalling', next), end);

        function next(err, inSet) {
          t.falsy(err);
          t.is(inSet, false);
          end();
        }
      })
    );
  });

  it.describe('fromId', (it) => {
    it('should support callbacks', async (t) => {
      const {queue, makeJob} = t.context;

      const job = await makeJob();
      const promise = helpers.deferred();
      Job.fromId(queue, job.id, promise.defer());
      const storedJob = await promise;
      t.truthy(storedJob);
      t.true(helpers.has(storedJob, 'id'));
      t.deepEqual(storedJob.data, data);
      t.is(storedJob.options.test, options.test);
    });
  });
});

async function clearKeys(client, queue) {
  const keys = await client.keys(queue.toKey('*'));
  if (keys.length) {
    return await client.del(keys);
  }
}
