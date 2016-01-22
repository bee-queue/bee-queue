// var testQueue = require('./beequeue-share-test.js').queue;

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
  console.log('111queue now ready to start doing things');
});

testQueue.on('error', function (err) {
  console.log('111A queue error happened: ' + err.message);
});

testQueue.on('succeeded', function (job, result) {
  console.log('111Job ' + job.id + ' succeeded with result: ' + result);
});

testQueue.on('retrying', function (job, err) {
  console.log('111Job ' + job.id + ' failed with error ' + err.message + ' but is being retried!');
});

testQueue.on('failed', function (job, err) {
  console.log('111Job ' + job.id + ' failed with error ' + err.message);
});


var job = testQueue.createJob({x: 2, y: 3});
job.on('succeeded', function (result) {
  console.log('Received result for job ' + job.id + ': ' + result);
});
job.timeout(30000).retries(2).save(function (err, job) {
  if(err)console.error(err);
  else console.log(job+" add to queue");
});