import { describe } from 'ava-spec';

import Job from '../lib/job';
import Queue from '../lib/queue';

async function clearKeys(client, queue) {
  const keys = await client.keys(queue.toKey('*'));
  if (keys.length) {
    await client.del(keys);
  }
}

describe('Job', (it) => {
  const data = { foo: 'bar' };
  const options = { test: 1 };

  let uid = 0;

  it.beforeEach(async (t) => {
    const queue = new Queue(`test-job-${uid++}`);

    function makeJob() {
      const job = queue.createJob(data);
      job.options = options;
      return job.save();
    }

    await queue.ready();

    Object.assign(t.context, { queue, makeJob });
  });

  it.afterEach((t) => {
    const { queue } = t.context;
    return clearKeys(queue.client, queue);
  });

  it('creates a job', async (t) => {
    const { makeJob } = t.context;

    const job = await makeJob();
    t.truthy(job, 'fails to return a job');
    t.true(job.hasOwnProperty('id'), 'job has no id');
    t.true(job.hasOwnProperty('data'), 'job has no data');
  });

  it('creates a job without data', async (t) => {
    const { queue } = t.context;

    const job = await queue.createJob().save();
    t.deepEqual(job.data, {});
  });

  it.describe('Chaining', (it) => {
    it('sets retries', (t) => {
      const { queue } = t.context;

      const job = queue.createJob({ foo: 'bar' }).retries(2);
      t.is(job.options.retries, 2);
    });

    it('rejects invalid retries count', (t) => {
      const { queue } = t.context;

      t.throws(() => {
        queue.createJob({ foo: 'bar' }).retries(-1);
      }, 'Retries cannot be negative');
    });

    it('should reject invalid delay timestamps', (t) => {
      const { queue } = t.context;

      const job = queue.createJob({ foo: 'bar' });
      t.notThrows(() => job.delayUntil(new Date(Date.now() + 10000)));
      t.notThrows(() => job.delayUntil(Date.now() + 10000));
      t.throws(() => job.delayUntil(null), /timestamp/i);
      t.throws(() => job.delayUntil(NaN), /timestamp/i);
      t.throws(() => job.delayUntil('wobble'), /timestamp/i);
      t.throws(() => job.delayUntil(-8734), /timestamp/i);
    });

    it('should not save a delay to a past date', (t) => {
      const { queue } = t.context;

      const job = queue.createJob({ foo: 'bar' });
      const until = Date.now() - 1000;
      job.delayUntil(until);
      t.not(job.options.delay, until);
    });

    it('sets timeout', (t) => {
      const { queue } = t.context;

      const job = queue.createJob({ foo: 'bar' }).timeout(5000);
      t.is(job.options.timeout, 5000);
    });

    it('rejects invalid timeout', (t) => {
      const { queue } = t.context;

      t.throws(() => {
        queue.createJob({ foo: 'bar' }).timeout(-1);
      }, 'Timeout cannot be negative');
    });

    it('saves the job in redis', async (t) => {
      const { queue, makeJob } = t.context;

      const job = await makeJob();
      const storedJob = await Job.fromId(queue, job.id);
      t.truthy(storedJob);
      t.true(storedJob.hasOwnProperty('id'));
      t.deepEqual(storedJob.data, data);
      t.is(storedJob.options.test, options.test);
    });
  });

  it.describe('Progress', (it) => {
    it('requires a progress value', async (t) => {
      const { makeJob } = t.context;

      const job = await makeJob();
      await t.throws(job.reportProgress(), 'Progress cannot be empty');
    });

    it('should support passing a data object', async (t) => {
      const { makeJob } = t.context;

      const job = await makeJob();
      const progressData = { a: 'value' };
      return new Promise((resolve) => {
        job.on('progress', (data) => {
          t.deepEqual(data, progressData);
          resolve();
        });
        job.reportProgress(progressData);
      });
    });
  });

  it.describe('Remove', (it) => {
    it('removes the job from redis', async (t) => {
      const { queue, makeJob } = t.context;

      const job = await makeJob();
      t.is(job, await job.remove());

      t.is(await queue.client.hget(queue.toKey('jobs'), job.id), null);
    });

    it('should work with a callback NO MORE', async (t) => {
      const { queue, makeJob } = t.context;

      const job = await makeJob();
      await job.remove();

      t.is(await queue.client.hget(queue.toKey('jobs'), job.id), null);
    });
  });

  it.describe('Retry', (it) => {
    it('should resolve', async (t) => {
      t.plan(0);
      const { makeJob } = t.context;

      const job = await makeJob();
      return job.retry();
    });
  });

  it.describe('IsInSet', (it) => {
    it('should support callbacks NO MORE', async (t) => {
      // todo consider whether we still need this test or if redundant
      const { makeJob } = t.context;

      const job = await makeJob();
      const inSet = await job.isInSet('stalling');
      t.is(inSet, false);
    });
  });

  it.describe('fromId', (it) => {
    it('should support callbacks NO MORE', async (t) => {
      // todo consider whether we still need this test or if redundant
      const { queue, makeJob } = t.context;

      const job = await makeJob();
      const storedJob = await Job.fromId(queue, job.id);
      t.truthy(storedJob);
      t.true(storedJob.hasOwnProperty('id'));
      t.deepEqual(storedJob.data, data);
      t.is(storedJob.options.test, options.test);
    });
  });
});
