const Queue = require('../../');
const queue = Queue('express-example');

queue.on('ready', function () {
  queue.process(function (job, done) {
    console.log('processing job ' + job.id);
    setTimeout(function () {
      done(null, job.data.x + job.data.y);
    }, 10);
  });

  console.log('processing jobs...');
});
