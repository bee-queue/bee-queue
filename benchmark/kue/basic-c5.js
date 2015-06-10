require('./harness')({
  numRuns: 10000,
  concurrency: 5
}, function (err, time) {
  console.log('Ran 10000 jobs through Kue with concurrency 5 in %d ms', time);
});
