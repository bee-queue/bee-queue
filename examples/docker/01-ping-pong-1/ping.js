const Queue = require('bee-queue');

const config = {redis: {host: 'redis'}};
const pingQueue = new Queue('ping', config);
const pongQueue = new Queue('pong', config);

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


// Close the queues so that this node process exits
const close = function () {
  pingQueue.close();
  pongQueue.close();
};

setTimeout(close, 3000);
