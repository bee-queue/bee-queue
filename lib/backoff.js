'use strict';

const strategies = new Map();

strategies.set('immediate', () => 0);

strategies.set('fixed', (job) => job.options.backoff.delay);

strategies.set('exponential', (job) => {
  const backoff = job.options.backoff,
    delay = backoff.delay;
  backoff.delay *= 2;
  return delay;
});

module.exports = strategies;
