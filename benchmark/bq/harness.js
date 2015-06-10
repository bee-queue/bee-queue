var Queue = require('../../index');
var queue = new Queue('test');

module.exports = function (options, cb) {
  var finished = 0;
  var finishTime, startTime;

  var reportResult = function (result) {
    finished += 1;
    if (finished === options.numRuns) {
      finishTime = (new Date()).getTime();
      cb(null, finishTime - startTime);
    }
  };

  queue.process(options.concurrency, function (job, done) {
    reportResult();
    return done();
  });

  startTime = (new Date()).getTime();

  for (var i = 0; i < options.numRuns; i++) {
    queue.createJob({i: i}).save();
  }
};
