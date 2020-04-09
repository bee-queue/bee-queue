let Queue = require('../../');

let pingQueue = Queue('ping');
let pongQueue = Queue('pong');

pingQueue.process(function (job, done) {
  console.log('Pong received ping');
  pongQueue.createJob().save(function () {
    console.log('Pong sent back pong');
    done();
  });
});
