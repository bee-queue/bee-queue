/* eslint-disable no-console */
'use strict';

const Queue = require('../../');

const pingQueue = new Queue('ping');
const pongQueue = new Queue('pong');

pingQueue.process(async (job) => {
  console.log(`Ping job received: (ID: ${job.id})`);

  await pongQueue.createJob().save();
  console.log('Created pong job');
});

console.log('Pong queue is ready to process jobs');
