const helpers = require('../../lib/helpers');
const kue = require('kue');
const queue = kue.createQueue();

// A promise-based barrier.
function reef(n = 1) {
  const done = helpers.deferred(),
    end = done.defer();
  return {
    done,
    next() {
      --n;
      if (n < 0) return false;
      if (n === 0) end();
      return true;
    },
  };
}

module.exports = (options) => {
  const {done, next} = reef(options.numRuns);

  queue.process('test', options.concurrency, (job, jobDone) => {
    next();
    jobDone();
  });

  const startTime = Date.now();
  for (let i = 0; i < options.numRuns; ++i) {
    queue.create('test', {i}).removeOnComplete(true).save();
  }
  return done.then(() => {
    const elapsed = Date.now() - startTime;
    const promise = helpers.deferred();
    queue.shutdown(promise.defer());
    return promise.then(() => elapsed);
  });
};

if (require.main === module) {
  const jobs = parseInt(process.env.NUM_RUNS || '10000', 10);
  const concurrency = parseInt(process.env.CONCURRENCY || '1', 10);
  module
    .exports({
      numRuns: jobs,
      concurrency,
    })
    .then((time) => {
      if (process.stdout.isTTY) {
        console.log(
          `Ran ${jobs} jobs through Kue with concurrency ${concurrency} in ${time} ms`
        );
      } else {
        console.log(time);
      }
    });
}
