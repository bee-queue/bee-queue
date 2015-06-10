require('./harness')({
  numRuns: 10000,
  concurrency: 50
}, function (err, time) {
  console.log('Ran 10000 jobs through Bee-Queue with concurrency 50 in %d ms', time);
});
