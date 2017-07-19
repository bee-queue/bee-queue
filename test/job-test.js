import test, {describe} from 'ava-spec';

import Job from '../lib/job';
import Queue from '../lib/queue';
import helpers from '../lib/helpers';

import {promisify} from 'promise-callbacks';

describe('Job', (it) => {
  const data = {foo: 'bar'};
  const options = {test: 1};

  let uid = 0;

  it.beforeEach(async(t) => {
    const queue = new Queue(`test-job-${uid++}`);

    function makeJob() {
      const job = queue.createJob(data);
      job.options = options;
      return job.save();
    }

    await queue.ready();

    Object.assign(t.context, {queue, makeJob});
  });

  it.afterEach.cb((t) => {
    const {queue} = t.context;
    clearKeys(queue.client, queue, t.end);
  });

  it('creates a job', async(t) => {
    const {queue, makeJob} = t.context;

    const job = await makeJob();
    t.truthy(job, 'fails to return a job');
    t.true(helpers.has(job, 'id'), 'job has no id');
    t.true(helpers.has(job, 'data'), 'job has no data');
  });

  it('creates a job without data', async(t) => {
    const {queue, makeJob} = t.context;

    const job = await queue.createJob().save();
    t.deepEqual(job.data, {});
  });

  it.describe('Chaining', (it) => {
    it('sets retries', (t) => {
      const {queue, makeJob} = t.context;

      const job = queue.createJob({foo: 'bar'}).retries(2);
      t.is(job.options.retries, 2);
    });

    it('rejects invalid retries count', (t) => {
      const {queue, makeJob} = t.context;

      t.throws(() => {
        queue.createJob({foo: 'bar'}).retries(-1);
      }, 'Retries cannot be negative');
    });

    it('sets timeout', (t) => {
      const {queue, makeJob} = t.context;

      const job = queue.createJob({foo: 'bar'}).timeout(5000);
      t.is(job.options.timeout, 5000);
    });

    it('rejects invalid timeout', (t) => {
      const {queue, makeJob} = t.context;

      t.throws(() => {
        queue.createJob({foo: 'bar'}).timeout(-1);
      }, 'Timeout cannot be negative');
    });

    it('saves the job in redis', async(t) => {
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
    it('rejects out-of-bounds progress', async(t) => {
      const {queue, makeJob} = t.context;

      const job = await makeJob();
      await t.throws(job.reportProgress(101), 'Progress must be between 0 and 100');
    });
  });

  it.describe('Remove', (it) => {
    it('removes the job from redis', async(t) => {
      const {queue, makeJob} = t.context;

      const {hget} = promisify.methods(queue.client, ['hget']);

      const job = await makeJob();
      t.is(job, await job.remove());

      t.is(await hget(queue.toKey('jobs'), job.id), null);
    });

    it('should work with a callback', async(t) => {
      const {queue, makeJob} = t.context;

      const {hget} = promisify.methods(queue.client, ['hget']);

      const job = await makeJob();
      const removed = helpers.deferred();
      job.remove(removed.defer());
      await removed;

      t.is(await hget(queue.toKey('jobs'), job.id), null);
    });
  });
});

process.on('unhandledRejection', (err) => console.log(err.stack));

function clearKeys(client, queue, done) {
  client.keys(queue.toKey('*'), (err, keys) => {
    if (err) return done(err);
    if (keys.length) {
      client.del(keys, done);
    } else {
      done();
    }
  });
}
