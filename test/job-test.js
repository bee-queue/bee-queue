'use strict';

const Job = require('../lib/job');
const Queue = require('../lib/queue');
const helpers = require('../lib/helpers');

const assert = require('chai').assert;

describe('Job', function () {
  const data = {foo: 'bar'};
  const options = {test: 1};

  function clearKeys(done) {
    this.queue.client.keys(this.queue.toKey('*'), (err, keys) => {
      if (err) return done(err);
      if (keys.length) {
        this.queue.client.del(keys, done);
      } else {
        done();
      }
    });
  }

  before(function () {
    this.queue = new Queue('test');

    this.makeJob = () => {
      const job = this.queue.createJob(data);
      job.options = options;
      return job.save();
    };

    return this.queue.ready();
  });

  before(clearKeys);
  afterEach(clearKeys);

  it('creates a job', function () {
    return this.makeJob().then((job) => {
      assert.ok(job, 'fails to return a job');
      assert.property(job, 'id', 'job has no id');
      assert.property(job, 'data', 'job has no data');
    });
  });

  it('creates a job without data', function () {
    return this.queue.createJob().save().then((job) => {
      assert.deepEqual(job.data, {});
    });
  });

  describe('Chaining', function () {
    it('sets retries', function () {
      const job = this.queue.createJob({foo: 'bar'}).retries(2);
      assert.strictEqual(job.options.retries, 2);
    });

    it('rejects invalid retries count', function () {
      assert.throws(() => {
        this.queue.createJob({foo: 'bar'}).retries(-1);
      }, 'Retries cannot be negative');
    });

    it('sets timeout', function () {
      const job = this.queue.createJob({foo: 'bar'}).timeout(5000);
      assert.strictEqual(job.options.timeout, 5000);
    });

    it('rejects invalid timeout', function () {
      assert.throws(() => {
        this.queue.createJob({foo: 'bar'}).timeout(-1);
      }, 'Timeout cannot be negative');
    });

    it('saves the job in redis', function () {
      return this.makeJob().then((job) => {
        return Job.fromId(this.queue, job.id);
      }).then((storedJob) => {
        assert.ok(storedJob);
        assert.property(storedJob, 'id');
        assert.deepEqual(storedJob.data, data);
        assert.deepInclude(storedJob.options, options);
      });
    });
  });

  describe('Progress', function () {
    it('rejects out-of-bounds progress', function (done) {
      helpers.asCallback(this.makeJob().then((job) => {
        return job.reportProgress(101);
      }), (err) => {
        assert.strictEqual(err.message, 'Progress must be between 0 and 100');
        done();
      });
    });
  });

  describe('Remove', function () {
    it('removes the job from redis', function (done) {
      this.makeJob().then((job) => {
        return job.remove();
      }).then((job) => {
        this.queue.client.hget(this.queue.toKey('jobs'), job.id, (err, results) => {
          if (err) return done(err);
          assert.isNull(results);
          done();
        });
      }).catch(done);
    });

    it('should work with a callback', function (done) {
      this.makeJob().then((job) => {
        job.remove((err) => {
          if (err) return done(err);
          this.queue.client.hget(this.queue.toKey('jobs'), job.id, (err, results) => {
            if (err) return done(err);
            assert.isNull(results);
            done();
          });
        });
      });
    });
  });

});
