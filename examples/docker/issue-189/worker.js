const Queue = require('bee-queue');

const { queueName, concurrency } = require('./config');

console.log(`worker constructing Queue '${queueName}' and connecting to Redis`);

const queue = new Queue(queueName, {
  redis: {
    host: 'redis',
    // Reconnect with linear backoff to a 15 second interval
    retry_strategy: options => Math.min(options.attempt * 250, 15000),
  },
  isWorker: true,
  activateDelayedJobs: true,
  getEvents: false,
  removeOnFailure: true,
  removeOnSuccess: true,
  sendEvents: true,
  storeJobs: false,
});

// Return the job's data
queue.process(concurrency, async ({data}) => ({data}));

queue.ready()
  .then(queue => console.log(`worker for Queue '${queue.name}' is ready`));
