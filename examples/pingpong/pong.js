const Queue = require('../../');

const pingQueue = new Queue('ping');
const pongQueue = new Queue('pong');

pingQueue.process(function (job, done) {
  console.log('Pong received ping');
  pongQueue.createJob().save(function () {
    console.log('Pong sent back pong');
    done();
  });
});
