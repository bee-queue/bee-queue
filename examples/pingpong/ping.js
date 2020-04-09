let Queue = require('../../');
let pingQueue = Queue('ping');
let pongQueue = Queue('pong');

pongQueue.process(function (job, done) {
  console.log('Ping received back pong');
  done();
});

let sendPing = function () {
  pingQueue.createJob().save(function () {
    console.log('Ping sent ping');
  });
};

sendPing();
setTimeout(sendPing, 2000);
