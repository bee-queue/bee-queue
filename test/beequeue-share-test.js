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

exports.queue = testQueue;