// var testQueue = require('./beequeue-share-test.js').queue;
// testQueue.schedule(3000);

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
  console.log('222queue now ready to start doing things');
});

testQueue.on('error', function (err) {
  console.log('222A queue error happened: ' + err.message);
});

testQueue.on('succeeded', function (job, result) {
  console.log('222Job ' + job.id + ' succeeded with result: ' + result);
});

testQueue.on('retrying', function (job, err) {
  console.log('222Job ' + job.id + ' failed with error ' + err.message + ' but is being retried!');
});

testQueue.on('failed', function (job, err) {
  console.log('222Job ' + job.id + ' failed with error ' + err.message);
});


testQueue.process(function (job, done) {
  console.log('Processing job ' + job.id);
  // do some work
  job.reportProgress(30);
  // do more work
  job.reportProgress(80);
  // do the rest
  job.reportProgress(100);

  setTimeout(function(){
    done(null, job.data.x + job.data.y);
  }, 10000);
  
});