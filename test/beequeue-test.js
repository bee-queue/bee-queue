var Queue = require('../lib/queue.js');

var testQueue = new Queue('test', {
  prefix: 'bq',
  stallInterval: 5000,
  redis: {
    host: '127.0.0.1',
    port: 6379,
    db: 0,
    options: {}
  },
  getEvents: true,
  isWorker: true,
  sendEvents: true,
  removeOnSuccess: false,
  catchExceptions: false
});

testQueue.on('ready', function () {
  console.log('queue now ready to start doing things');
});

testQueue.on('error', function (err) {
  console.log('A queue error happened: ' + err.message);
});

testQueue.on('succeeded', function (job, result) {
  console.log('Job ' + job.id + ' succeeded with result: ' + result);
});

testQueue.on('retrying', function (job, err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message + ' but is being retried!');
});

testQueue.on('failed', function (job, err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message);
});

var job = testQueue.createJob({x: 2, y: 3});
job.timeout(30000).retries(2).delay(200).save(function (err, job) {
  if(err)console.error(err);
  else console.log(job+" add to queue");
});

job.on('progress', function (progress) {
  console.log('Job ' + job.id + ' reported progress: ' + progress + '%');
});

testQueue.schedule(3000);

testQueue.process(function (job, done) {
  console.log('Processing job ' + job.id);
  // do some work
  job.reportProgress(30);
  // do more work
  job.reportProgress(80);
  // do the rest
  job.reportProgress(100);
  done(null, job.data.x + job.data.y);
});