const Queue = require('../../');
const pingQueue = new Queue('ping');

pingQueue.process(function (job, done) {
  console.log('processing job, waiting 2sec', job.id);

  job.on('removed', () => {
    console.log('REMOVED');
  });

  pingQueue.on('job removed', (jobId) => {
    console.log('REMOVED', jobId);
  });

  setTimeout(() => {
    console.log('done!');
    done();
  }, 2000);
});
