require('./harness')({
  numRuns: 10000,
  concurrency: 20
}, function (err, time) {
  console.log('Ran 10000 jobs through Bee-Queue with concurrency 20 in %d ms', time);
});
