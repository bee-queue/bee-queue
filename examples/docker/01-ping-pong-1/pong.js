const Queue = require('bee-queue');

const config = {redis: {host: 'redis'}};
const pingQueue = new Queue('ping', config);
const pongQueue = new Queue('pong', config);

pingQueue.process(function (job, done) {
  console.log('Pong received ping');
  pongQueue.createJob().save(function () {
    console.log('Pong sent back pong');
    done();
  });
});
