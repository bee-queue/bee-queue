var Queue = require('../../');
var pingQueue = Queue('ping');
var pongQueue = Queue('pong');

pongQueue.process(function (job, done) {
  console.log('Ping received back pong');
  done();
});

var sendPing = function () {
  pingQueue.createJob().save(function () {
    console.log('Ping sent ping');
  });
};

sendPing();
setTimeout(sendPing, 2000);
