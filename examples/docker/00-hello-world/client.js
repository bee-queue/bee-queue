const Queue = require('bee-queue');

// Core client logic, run one job and then close the queue
const clientProcess = (queue) => {
  const job = queue.createJob({name: 'World'});
  job.on('succeeded', (result) => {
    console.log();
    console.log(result.greeting);
    console.log();

    queue.close();
  });

  job.save();
};

const go = () => {
  return new Queue('hello-world', {redis: {host: 'redis'}, isWorker: false})
    .ready()
    .then(clientProcess)
    .catch((err) =>
      process.nextTick(() => {
        throw err;
      })
    );
};

go();
