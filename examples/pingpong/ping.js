const Queue = require('../../');
const pingQueue = Queue('ping');
const pongQueue = Queue('pong');

pongQueue.process(function (job, done) {
  console.log('Ping received back pong');
  done();
});

const sendPing = function () {
  pingQueue.createJob().save(function () {
    console.log('Ping sent ping');
  });
};

sendPing();
setTimeout(sendPing, 2000);
