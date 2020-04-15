const Queue = require('bee-queue');

// Core worker logic, return an object with a job.data-based greeting
const workerProcess = async (job) => {
  return {greeting: 'Hello ' + job.data.name + '!'};
};

const go = () => {
  return new Queue('hello-world', {redis: {host: 'redis'}, isWorker: true})
    .ready()
    .then((queue) => queue.process(workerProcess))
    .catch((err) =>
      process.nextTick(() => {
        throw err;
      })
    );
};

go();
