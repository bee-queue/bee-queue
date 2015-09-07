/*eslint-disable no-shadow, handle-callback-err */

var Job = require('../lib/job');
var Queue = require('../lib/queue');

var chai = require('chai');
var assert = chai.assert;

describe('Job', function () {
  var queue = new Queue('test');
  var data = {foo: 'bar'};
  var options = {test: 1};

  var clearKeys = function (done) {
    queue.client.keys(queue.toKey('*'), function (err, keys) {
      if (keys.length) {
        queue.client.del(keys, done);
      } else {
        done();
      }
    });
  };

  var makeJob = function (cb) {
    var job = queue.createJob(data);
    job.options = options;
    job.save(cb);
  };

  before(clearKeys);
  afterEach(clearKeys);

  describe('Constructor', function () {
    it('creates a job', function () {
      makeJob(function (err, job) {
        assert.isNull(err);
        assert.ok(job, 'fails to return a job');
        assert.property(job, 'id', 'job has no id');
        assert.property(job, 'data', 'job has no data');
      });
    });

    it('creates a job without data', function () {
      queue.createJob().save(function (err, job) {
        assert.isNull(err);
        assert.deepEqual(job.data, {});
      });
    });
  });

  describe('Chaining', function () {
    it('sets retries', function () {
      var job = queue.createJob({foo: 'bar'}).retries(2);
      assert.strictEqual(job.options.retries, 2);
    });

    it('rejects invalid retries count', function () {
      try {
        queue.createJob({foo: 'bar'}).retries(-1);
      } catch (err) {
        assert.strictEqual(err.message, 'Retries cannot be negative');
      }
    });

    it('sets timeout', function () {
      var job = queue.createJob({foo: 'bar'}).timeout(5000);
      assert.strictEqual(job.options.timeout, 5000);
    });

    it('rejects invalid timeout', function () {
      try {
        queue.createJob({foo: 'bar'}).timeout(-1);
      } catch (err) {
        assert.strictEqual(err.message, 'Timeout cannot be negative');
      }
    });

    it('saves the job in redis', function (done) {
      makeJob(function (err, job) {
        Job.fromId(queue, job.id, function (err, storedJob) {
          assert.ok(storedJob);
          assert.property(storedJob, 'id');
          assert.deepEqual(storedJob.data, data);
          assert.deepEqual(storedJob.options, options);
          done();
        });
      });
    });
  });

  describe('Progress', function () {
    it('rejects out-of-bounds progress', function (done) {
      makeJob(function (err, job) {
        job.reportProgress(101, function (err) {
          assert.strictEqual(err.message, 'Progress must be between 0 and 100');
          done();
        });
      });
    });
  });

  describe('Remove', function () {
    it('removes the job from redis', function (done) {
      makeJob(function (err, job) {
        job.remove(function (err) {
          assert.isNull(err);
          queue.client.hget(queue.toKey('jobs'), job.id, function (err, results) {
            assert.isNull(err);
            assert.isNull(results);
            done();
          });
        });
      });
    });

    it('should work without a callback', function (done) {
      makeJob(function (err, job) {
        job.remove();
        setTimeout(function () {
          queue.client.hget(queue.toKey('jobs'), job.id, function (err, results) {
            assert.isNull(err);
            assert.isNull(results);
            done();
          });
        }, 20);
      });
    });
  });

});
