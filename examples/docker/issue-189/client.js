const Queue = require('bee-queue');

const { queueName, numChains } = require('./config');

console.log(`client constructing Queue '${queueName}' and connecting to Redis`);

const stats = {
  numJobSaveSuccess: 0,
  numJobSaveError: 0,

  numQueueSucceeded: 0,
  numQueueFailed: 0,

  numJobSucceeded: 0,
};

const queue = new Queue(queueName, {
  redis: {
    host: 'redis',
    // Reconnect with linear backoff to a 15 second interval
    retry_strategy: options => Math.min(options.attempt * 250, 15000),
  },
  isWorker: false,
  getEvents: true,
  sendEvents: false,
  storeJobs: true,
});

// One of these two callbacks is called for each job; they maintain job pressure by starting a new job
queue.on('job succeeded', () => {
  ++stats.numQueueSucceeded;
  createJob();
});

queue.on('job failed', () => {
  ++stats.numQueueFailed;
  createJob();
});

const createJob = () => {
  const job = queue.createJob({timestamp: Date.now()});
  job.on('succeeded', () => ++stats.numJobSucceeded);
  job.save()
    .then(() => ++stats.numJobSaveSuccess)
    .catch(() => ++stats.numJobSaveError);
};


const start = () => {
  for (let i = 0; i < numChains; ++i) {
    createJob();
  }
};

let startTime;
const logStats = () => {
  const sample = {...stats};
  sample.throughput = ((sample.numQueueSucceeded + sample.numQueueFailed) * 1000 / (Date.now() - startTime)).toFixed(0);
  sample.numSucceededLost = sample.numQueueSucceeded - sample.numJobSucceeded;
  sample.succededLossPercent = (sample.numSucceededLost * 100 / sample.numQueueSucceeded).toFixed(1);
  console.log(JSON.stringify(sample));
};

queue.ready()
  .then(start)
  .then(() => (startTime = Date.now()))
  .then(() => setInterval(logStats, 3000))
  .then(() => console.log(`client for Queue '${queue.name}' is running`));
