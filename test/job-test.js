/*eslint-disable no-shadow, handle-callback-err */

var Job = require('../lib/job');
var Queue = require('../lib/queue');

var chai = require('chai');
var assert = chai.assert;

describe('Job', function () {
  var queue = new Queue('test');
  var data;
  var options;
  var job;

  var clearKeys = function (done) {
    queue.client.keys(queue.toKey('*'), function(err, keys) {
      if (keys.length) {
        queue.client.del(keys, done);
      } else {
        done();
      }
    });
  };

  before(clearKeys);
  after(clearKeys);

  beforeEach(function (done) {
    data = {foo: 'bar'};
    options = {retries: 1};
    return queue.add(data, options, function (err, newJob) {
      job = newJob;
      done();
    });
  });

  describe('Constructor', function () {
    it('creates a job', function () {
      assert.ok(job, 'fails to return a job');
      assert.property(job, 'jobId', 'job has no jobId');
      assert.property(job, 'data', 'job has no data');
    });

    it('saves the job in redis', function (done) {
      Job.fromId(queue, job.jobId, function (err, storedJob) {
        assert.ok(storedJob, 'fails to return a job');
        assert.property(storedJob, 'jobId', 'stored job has no jobId');
        assert.deepEqual(storedJob.data, data, 'stored job data is wrong');
        assert.deepEqual(storedJob.options, options, 'stored job properties are wrong');
        done();
      });
    });
  });

  describe('remove', function () {
    it('removes the job from redis', function (done) {
      job.remove(function (err) {
        assert.isNull(err);
        queue.client.get(queue.toKey(job.jobId), function (err, results) {
          assert.isNull(err);
          assert.isNull(results);
          done();
        });
      });
    });
  });

  describe('moveToSet', function () {
    var markJobTest = function (status) {
      return function (done) {
        job.isInSet(status, function (err, isMember) {
          assert.isNull(err);
          assert.isFalse(isMember);
          job.moveToSet(status, function (err) {
            assert.isNull(err);
            job.isInSet(status, function (err, isMember) {
              assert.isNull(err);
              assert.isTrue(isMember);
              done();
            });
          });
        });
      };
    };

    it('marks the job as succeeded', markJobTest('succeeded'));
    it('marks the job as failed', markJobTest('failed'));
  });
});
