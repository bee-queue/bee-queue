const Queue = require('../../');

const pingQueue = Queue('ping');
const pongQueue = Queue('pong');

pingQueue.process(function (job, done) {
  console.log('Pong received ping');
  pongQueue.createJob().save(function () {
    console.log('Pong sent back pong');
    done();
  });
});
