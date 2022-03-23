const Queue = require('../../');
const pingQueue = new Queue('ping');

pingQueue.process(function (job, done) {
  console.log('processing job, waiting 6 sec', job.id);

  job.on('removed', () => {
    console.log('REMOVED');
  });

  job.on('progress', (i) => {
    console.log('PROGRESS', i);
  });

  pingQueue.on('job removed', (jobId) => {
    console.log('REMOVED', jobId);
  });

  setTimeout(() => {
    console.log('done!');
    done();
  }, 6000);
});
