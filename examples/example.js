var Queue = require('../index');
var queue = new Queue('test');

queue.on('ready', function () {
  queue.process(function (job, done) {
    console.log('processing job ' + job.id);
    console.log('the sum is: ' + (job.data.x + job.data.y));
    done();
  });

  var reportEnqueued = function (err, job) {
    console.log('enqueued job ' + job.id);
  };

  queue.add({x: 1, y: 1}, reportEnqueued);
  queue.add({x: 1, y: 2}, reportEnqueued);
  setTimeout(queue.add.bind(queue, {x: 1, y: 3}, reportEnqueued), 500);
});
