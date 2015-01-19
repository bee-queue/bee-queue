var Queue = require('../index');
var testQueue = new Queue('test');

testQueue.process(function (job, done) {
  console.log('processing job ' + job.jobId);
  console.log('the sum is: ' + job.data.x + job.data.y);
  done();
});

var reportEnqueued = function (err, job) {
  console.log('enqueued job ' + job.jobId);
};

testQueue.add({x: 1, y: 1}, reportEnqueued);
testQueue.add({x: 1, y: 2}, reportEnqueued);

setTimeout(testQueue.add.bind(testQueue, {x: 1, y: 3}, reportEnqueued), 1500);
